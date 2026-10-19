import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { checkDatabaseHealth } from './db/index.js';
import { validateInvoice } from './services/invoice-validation.js';

const demoInvoices = [
  {
    invoiceNumber: 'INV-2026-0104',
    supplier: 'Northwind Traders',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    currency: 'USD',
    subtotal: 1250,
    tax: 125,
    total: 1375,
    lineItems: [
      { description: 'Five desktops', quantity: 5, unitPrice: 200, amount: 1000 },
      { description: 'Accessories', quantity: 1, unitPrice: 250, amount: 250 },
    ],
  },
  {
    invoiceNumber: 'INV-2026-0110',
    supplier: 'Blue Harbor Services',
    issueDate: '2026-10-07',
    dueDate: '2026-10-21',
    currency: 'USD',
    subtotal: 900,
    tax: 90,
    total: 990,
    lineItems: [
      { description: 'Consulting retainer', quantity: 3, unitPrice: 250, amount: 750 },
      { description: 'Travel', quantity: 1, unitPrice: 150, amount: 150 },
    ],
  },
  {
    invoiceNumber: 'INV-2026-0138',
    supplier: 'Helio Logistics',
    issueDate: '2026-10-11',
    dueDate: '2026-10-25',
    currency: 'EUR',
    subtotal: 2400,
    tax: 240,
    total: 2640,
    lineItems: [
      { description: 'Freight', quantity: 1, unitPrice: 1800, amount: 1800 },
      { description: 'Customs handling', quantity: 1, unitPrice: 600, amount: 600 },
    ],
  },
];

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

const acceptedContentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function detectDocumentType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function createApp(options: { uploadDirectory?: string } = {}) {
  const app = express();
  const uploadDirectory = options.uploadDirectory ?? process.env.UPLOAD_DIR ?? resolve(process.cwd(), 'uploads');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!acceptedContentTypes.has(file.mimetype)) {
        callback(new Error('Unsupported file type. Upload a PDF, JPEG, PNG, or WebP file.'));
        return;
      }
      callback(null, true);
    },
  });

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'finsight-api',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  app.get('/api/db/health', async (_req: Request, res: Response) => {
    try {
      const databaseReady = await checkDatabaseHealth();
      res.json({
        ok: databaseReady,
        database: databaseReady ? 'connected' : 'unavailable',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Database connection failed';
      res.status(503).json({
        ok: false,
        database: 'unavailable',
        reason,
      });
    }
  });

  app.get('/api/invoices/demo', (_req: Request, res: Response) => {
    res.json({ ok: true, data: demoInvoices });
  });

  app.post('/api/documents', upload.single('file'), async (req: Request, res: Response, next) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'Choose a PDF or image file to upload.' });
    }

    const detectedType = detectDocumentType(req.file.buffer);
    if (!detectedType || detectedType !== req.file.mimetype) {
      return res.status(400).json({
        ok: false,
        message: 'The file contents do not match a supported PDF or image type.',
      });
    }

    const id = randomUUID();
    try {
      await mkdir(uploadDirectory, { recursive: true });
      await writeFile(resolve(uploadDirectory, id), req.file.buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      return next(error);
    }

    return res.status(201).json({
      ok: true,
      data: {
        id,
        originalName: req.file.originalname,
        contentType: detectedType,
        sizeBytes: req.file.size,
        status: 'uploaded',
        downloadUrl: `/api/documents/${id}/file`,
      },
    });
  });

  app.get('/api/documents/:id/file', async (req: Request, res: Response, next) => {
    const documentId = req.params.id;
    if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) {
      return res.status(400).json({ ok: false, message: 'Invalid document id.' });
    }

    try {
      const contents = await readFile(resolve(uploadDirectory, documentId));
      const contentType = detectDocumentType(contents);
      if (!contentType) {
        return res.status(404).json({ ok: false, message: 'Document not found.' });
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ ok: false, message: 'Document not found.' });
      }
      return next(error);
    }
  });

  app.post('/api/invoices/parse', (req: Request, res: Response) => {
    const result = validateInvoice(req.body);

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        message: result.message,
        errors: result.errors,
      });
    }

    return res.json(result);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        ok: false,
        message: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 12 MB limit.' : error.message,
      });
    }

    if (error instanceof Error && error.message.startsWith('Unsupported file type.')) {
      return res.status(415).json({ ok: false, message: error.message });
    }

    console.error('Unhandled API error:', error);
    return res.status(500).json({ ok: false, message: 'An unexpected server error occurred.' });
  });

  return app;
}
