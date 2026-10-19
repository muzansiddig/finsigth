import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, win32 } from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { checkDatabaseHealth } from './db/index.js';
import {
  DataConflictError,
  postgresStore,
  type FinSightStore,
} from './db/repository.js';
import {
  createSessionToken,
  getClearedSessionCookie,
  getSessionCookie,
  hashPassword,
  loginSchema,
  readSessionCookie,
  readSessionToken,
  registrationSchema,
  type SessionClaims,
  validateSessionSecret,
  verifyPassword,
} from './services/auth.js';
import { validateInvoice } from './services/invoice-validation.js';
import { extractInvoiceCandidate } from './services/invoice-extraction.js';
import { LocalOcrProvider, OcrProviderError, type OcrProvider } from './services/ocr-provider.js';

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const acceptedContentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const statusTransitionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'needs_review']),
  reason: z.string().trim().min(3).max(1000),
});
const dummyPasswordHash = hashPassword(randomUUID());
type AuthenticatedSession = SessionClaims & Pick<
  NonNullable<Awaited<ReturnType<FinSightStore['findUserById']>>>,
  'email' | 'fullName'
>;

function detectDocumentType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function safeOriginalName(name: string) {
  return win32.basename(name.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 255) || 'document';
}

function safeErrorMetadata(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  return {
    type: error instanceof Error ? error.name : 'UnknownError',
    ...(code ? { code } : {}),
  };
}

export function createApp(options: {
  uploadDirectory?: string;
  store?: FinSightStore;
  sessionSecret?: string;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  ocrProvider?: OcrProvider;
} = {}) {
  const app = express();
  const uploadDirectory = options.uploadDirectory ?? process.env.UPLOAD_DIR ?? resolve(process.cwd(), 'uploads');
  const store = options.store ?? postgresStore;
  const ocrProvider = options.ocrProvider ?? new LocalOcrProvider();
  const sessionSecret = validateSessionSecret(options.sessionSecret ?? process.env.SESSION_SECRET);
  const allowedOrigins = new Set(options.allowedOrigins ?? [
    process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
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

  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, origin ?? false);
        return;
      }
      callback(null, false);
    },
  }));
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ ok: false, message: 'Origin is not allowed.' });
    }
    return next();
  });

  function sessionFor(req: Request) {
    return readSessionToken(readSessionCookie(req.get('cookie')), sessionSecret);
  }

  async function requireSession(req: Request, res: Response, next: express.NextFunction): Promise<AuthenticatedSession | null> {
    const claims = sessionFor(req);
    if (!claims) {
      res.status(401).json({ ok: false, message: 'Sign in to continue.' });
      return null;
    }
    try {
      const account = await store.findUserById(claims.userId, claims.tenantId);
      if (!account || !account.isActive) {
        res.setHeader('Set-Cookie', getClearedSessionCookie(secureCookies));
        res.status(401).json({ ok: false, message: 'Sign in to continue.' });
        return null;
      }
      return {
        ...claims,
        role: account.role,
        email: account.email,
        fullName: account.fullName,
      };
    } catch (error) {
      next(error);
      return null;
    }
  }

  async function requireWriter(req: Request, res: Response, next: express.NextFunction) {
    const session = await requireSession(req, res, next);
    if (session && session.role === 'viewer') {
      res.status(403).json({ ok: false, message: 'Reviewer or administrator access is required.' });
      return null;
    }
    return session;
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'finsight-api',
      timestamp: new Date().toISOString(),
      version: '0.2.0',
    });
  });

  app.get('/api/db/health', async (_req: Request, res: Response) => {
    try {
      const databaseReady = await checkDatabaseHealth();
      return res.status(databaseReady ? 200 : 503).json({
        ok: databaseReady,
        database: databaseReady ? 'connected' : 'unavailable',
      });
    } catch (error) {
      console.error('Database health check failed:', safeErrorMetadata(error));
      return res.status(503).json({ ok: false, database: 'unavailable' });
    }
  });

  app.post('/api/auth/register', async (req: Request, res: Response, next) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, message: 'Invalid registration details.', errors: parsed.error.flatten() });
    }
    try {
      const account = await store.register({
        ...parsed.data,
        email: parsed.data.email.toLowerCase(),
        passwordHash: await hashPassword(parsed.data.password),
      });
      const token = createSessionToken({
        userId: account.id,
        tenantId: account.tenantId,
        role: account.role,
      }, sessionSecret);
      res.setHeader('Set-Cookie', getSessionCookie(token, secureCookies));
      return res.status(201).json({ ok: true, data: account });
    } catch (error) {
      if (error instanceof DataConflictError) {
        return res.status(409).json({ ok: false, message: error.message });
      }
      return next(error);
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Invalid login details.' });
    try {
      const account = await store.findUserByEmail(parsed.data.email.toLowerCase());
      const passwordHash = account?.passwordHash ?? await dummyPasswordHash;
      const validPassword = await verifyPassword(parsed.data.password, passwordHash);
      if (!account || !account.isActive || !validPassword) {
        return res.status(401).json({ ok: false, message: 'Email or password is incorrect.' });
      }
      const token = createSessionToken({
        userId: account.id,
        tenantId: account.tenantId,
        role: account.role,
      }, sessionSecret);
      res.setHeader('Set-Cookie', getSessionCookie(token, secureCookies));
      return res.json({
        ok: true,
        data: { id: account.id, email: account.email, fullName: account.fullName, tenantId: account.tenantId, role: account.role },
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', getClearedSessionCookie(secureCookies));
    return res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    const token = createSessionToken({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
    }, sessionSecret);
    res.setHeader('Set-Cookie', getSessionCookie(token, secureCookies));
    return res.json({
      ok: true,
      data: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        tenantId: session.tenantId,
        role: session.role,
      },
    });
  });

  app.get('/api/documents', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    try {
      const documents = await store.listDocuments(session.tenantId);
      return res.json({
        ok: true,
        data: documents.map(({ id, originalName, contentType, sizeBytes, status, createdAt }) => ({
          id,
          originalName,
          contentType,
          sizeBytes,
          status,
          createdAt,
          downloadUrl: `/api/documents/${id}/file`,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/documents', async (req: Request, res: Response, next) => {
    if (!await requireWriter(req, res, next)) return;
    next();
  }, upload.single('file'), async (req: Request, res: Response, next) => {
    const session = await requireWriter(req, res, next);
    if (!session) return;
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
      const document = await store.addDocument({
        id,
        tenantId: session.tenantId,
        userId: session.userId,
        storageKey: id,
        originalName: safeOriginalName(req.file.originalname),
        contentType: detectedType,
        sizeBytes: req.file.size,
        status: 'uploaded',
      });
      return res.status(201).json({
        ok: true,
        data: {
          id: document.id,
          originalName: document.originalName,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
          status: document.status,
          downloadUrl: `/api/documents/${document.id}/file`,
        },
      });
    } catch (error) {
      try {
        await unlink(resolve(uploadDirectory, id));
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('Failed to remove an unregistered uploaded document:', safeErrorMetadata(cleanupError));
        }
      }
      return next(error);
    }
  });

  app.post('/api/documents/:id/ocr', async (req: Request, res: Response, next) => {
    const session = await requireWriter(req, res, next);
    if (!session) return;
    const documentId = req.params.id;
    if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) {
      return res.status(400).json({ ok: false, message: 'Invalid document id.' });
    }

    let started = false;
    try {
      const document = await store.findDocument(documentId, session.tenantId);
      if (!document) return res.status(404).json({ ok: false, message: 'Document not found.' });
      const contents = await readFile(resolve(uploadDirectory, document.storageKey));
      if (detectDocumentType(contents) !== document.contentType) {
        return res.status(404).json({ ok: false, message: 'Document not found.' });
      }
      started = await store.beginDocumentOcr({
        id: documentId,
        tenantId: session.tenantId,
        userId: session.userId,
      });
      if (!started) {
        return res.status(409).json({ ok: false, message: 'Document OCR is already running.' });
      }

      const result = await ocrProvider.extract({
        contents,
        contentType: document.contentType,
      });
      const structuredData = extractInvoiceCandidate(result);
      const extraction = await store.saveDocumentExtraction({
        id: documentId,
        tenantId: session.tenantId,
        userId: session.userId,
        result,
        structuredData,
      });
      if (!extraction) {
        return res.status(409).json({ ok: false, message: 'Document processing state changed. Try again.' });
      }
      return res.json({ ok: true, data: extraction });
    } catch (error) {
      if (started) {
        try {
          await store.failDocumentOcr({
            id: documentId,
            tenantId: session.tenantId,
            userId: session.userId,
          });
        } catch (statusError) {
          console.error('Failed to record document OCR failure:', safeErrorMetadata(statusError));
          return next(statusError);
        }
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ ok: false, message: 'Document not found.' });
      }
      if (error instanceof OcrProviderError) {
        return res.status(error.unavailable ? 503 : 422).json({ ok: false, message: error.message });
      }
      return next(error);
    }
  });

  app.get('/api/documents/:id/extraction', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    const documentId = req.params.id;
    if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) {
      return res.status(400).json({ ok: false, message: 'Invalid document id.' });
    }
    try {
      const document = await store.findDocument(documentId, session.tenantId);
      if (!document) return res.status(404).json({ ok: false, message: 'Document not found.' });
      const extraction = await store.findDocumentExtraction(documentId, session.tenantId);
      if (!extraction) return res.status(404).json({ ok: false, message: 'OCR result not found.' });
      return res.json({ ok: true, data: extraction });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/documents/:id/file', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    const documentId = req.params.id;
    if (typeof documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(documentId)) {
      return res.status(400).json({ ok: false, message: 'Invalid document id.' });
    }

    try {
      const document = await store.findDocument(documentId, session.tenantId);
      if (!document) return res.status(404).json({ ok: false, message: 'Document not found.' });
      const contents = await readFile(resolve(uploadDirectory, document.storageKey));
      const contentType = detectDocumentType(contents);
      if (!contentType || contentType !== document.contentType) {
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
      return res.status(400).json({ ok: false, message: result.message, errors: result.errors });
    }
    return res.json(result);
  });

  app.get('/api/invoices', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    try {
      return res.json({ ok: true, data: await store.listInvoices(session.tenantId) });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/invoices', async (req: Request, res: Response, next) => {
    const session = await requireWriter(req, res, next);
    if (!session) return;
    const validation = validateInvoice(req.body);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, message: validation.message, errors: validation.errors });
    }
    try {
      const invoice = await store.createInvoice({
        tenantId: session.tenantId,
        userId: session.userId,
        invoice: validation.extracted,
        confidence: validation.confidence,
      });
      return res.status(201).json({ ok: true, data: invoice, warnings: validation.warnings });
    } catch (error) {
      if (error instanceof DataConflictError) return res.status(409).json({ ok: false, message: error.message });
      return next(error);
    }
  });

  app.put('/api/invoices/:id', async (req: Request, res: Response, next) => {
    const session = await requireWriter(req, res, next);
    if (!session) return;
    const invoiceId = req.params.id;
    if (typeof invoiceId !== 'string') return res.status(400).json({ ok: false, message: 'Invalid invoice id.' });
    const validation = validateInvoice(req.body);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, message: validation.message, errors: validation.errors });
    }
    try {
      const invoice = await store.updateInvoice({
        id: invoiceId,
        tenantId: session.tenantId,
        userId: session.userId,
        invoice: validation.extracted,
        confidence: validation.confidence,
      });
      if (!invoice) return res.status(404).json({ ok: false, message: 'Invoice not found.' });
      return res.json({ ok: true, data: invoice, warnings: validation.warnings });
    } catch (error) {
      if (error instanceof DataConflictError) return res.status(409).json({ ok: false, message: error.message });
      return next(error);
    }
  });

  app.get('/api/invoices/:id/history', async (req: Request, res: Response, next) => {
    const session = await requireSession(req, res, next);
    if (!session) return;
    const invoiceId = req.params.id;
    if (typeof invoiceId !== 'string') return res.status(400).json({ ok: false, message: 'Invalid invoice id.' });
    try {
      const invoice = await store.findInvoice(invoiceId, session.tenantId);
      if (!invoice) return res.status(404).json({ ok: false, message: 'Invoice not found.' });
      const history = await store.listReviewHistory(invoice.id, session.tenantId);
      return res.json({ ok: true, data: history });
    } catch (error) {
      return next(error);
    }
  });

  app.patch('/api/invoices/:id/status', async (req: Request, res: Response, next) => {
    const session = await requireWriter(req, res, next);
    if (!session) return;
    const invoiceId = req.params.id;
    if (typeof invoiceId !== 'string') return res.status(400).json({ ok: false, message: 'Invalid invoice id.' });
    const parsed = statusTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, message: 'Provide a valid status and a review reason of 3–1000 characters.' });
    }
    try {
      const invoice = await store.transitionInvoice({
        id: invoiceId,
        tenantId: session.tenantId,
        userId: session.userId,
        status: parsed.data.status,
        reason: parsed.data.reason,
      });
      if (!invoice) return res.status(404).json({ ok: false, message: 'Invoice not found.' });
      return res.json({ ok: true, data: invoice });
    } catch (error) {
      if (error instanceof DataConflictError) return res.status(409).json({ ok: false, message: error.message });
      return next(error);
    }
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
    if (error instanceof Error && error.message === 'Origin is not allowed.') {
      return res.status(403).json({ ok: false, message: error.message });
    }
    console.error('Unhandled API error:', safeErrorMetadata(error));
    return res.status(500).json({ ok: false, message: 'An unexpected server error occurred.' });
  });

  return app;
}
