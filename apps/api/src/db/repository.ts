import { and, desc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import { auditLogs, documentExtractions, invoices, invoiceItems, reviewHistory, tenants, uploadedDocuments, users } from './schema.js';
import { invoiceInputSchema, type InvoicePayload } from '../services/invoice-validation.js';
import type { InvoiceExtractionCandidate } from '../services/invoice-extraction.js';
import type { OcrResult } from '../services/ocr-provider.js';

export type Account = {
  id: number;
  email: string;
  fullName: string;
  tenantId: number;
  role: 'admin' | 'reviewer' | 'viewer';
};

export type DocumentRecord = {
  id: string;
  tenantId: number;
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: 'uploaded' | 'processing' | 'needs_review' | 'failed';
  createdAt: Date;
};

export type DocumentExtractionRecord = {
  id: number;
  documentId: string;
  provider: string;
  engineVersion: string;
  languages: string;
  text: string;
  pages: OcrResult['pages'];
  structuredData: InvoiceExtractionCandidate | null;
  createdAt: Date;
};

export type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  supplier: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  confidence: string;
  status: 'needs_review' | 'approved' | 'rejected';
  createdAt: Date;
  lineItems: Array<{ description: string; quantity: string; unitPrice: string; amount: string }>;
};

export class DataConflictError extends Error {}

export interface FinSightStore {
  register(input: { email: string; fullName: string; organizationName: string; passwordHash: string }): Promise<Account>;
  findUserByEmail(email: string): Promise<(Account & { passwordHash: string; isActive: boolean }) | undefined>;
  findUserById(id: number, tenantId: number): Promise<(Account & { isActive: boolean }) | undefined>;
  addDocument(input: Omit<DocumentRecord, 'createdAt'> & { userId: number }): Promise<DocumentRecord>;
  findDocument(id: string, tenantId: number): Promise<DocumentRecord | undefined>;
  listDocuments(tenantId: number): Promise<DocumentRecord[]>;
  beginDocumentOcr(input: { id: string; tenantId: number; userId: number }): Promise<boolean>;
  saveDocumentExtraction(input: {
    id: string;
    tenantId: number;
    userId: number;
    result: OcrResult;
    structuredData: InvoiceExtractionCandidate;
  }): Promise<DocumentExtractionRecord | undefined>;
  failDocumentOcr(input: { id: string; tenantId: number; userId: number }): Promise<void>;
  findDocumentExtraction(documentId: string, tenantId: number): Promise<DocumentExtractionRecord | undefined>;
  createInvoice(input: {
    tenantId: number;
    userId: number;
    invoice: InvoicePayload;
    confidence: number;
  }): Promise<InvoiceRecord>;
  updateInvoice(input: {
    id: string;
    tenantId: number;
    userId: number;
    invoice: InvoicePayload;
    confidence: number;
  }): Promise<InvoiceRecord | undefined>;
  listInvoices(tenantId: number): Promise<InvoiceRecord[]>;
  findInvoice(id: string, tenantId: number): Promise<InvoiceRecord | undefined>;
  transitionInvoice(input: {
    id: string;
    tenantId: number;
    userId: number;
    status: 'approved' | 'rejected' | 'needs_review';
    reason: string;
  }): Promise<InvoiceRecord | undefined>;
  listReviewHistory(invoiceId: string, tenantId: number): Promise<Array<{
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    createdAt: Date;
    userName: string;
  }>>;
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') return true;
    if ('message' in current && typeof current.message === 'string' &&
      current.message.includes('duplicate key value violates unique constraint')) return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

function toInvoiceRecord(row: typeof invoices.$inferSelect, items: typeof invoiceItems.$inferSelect[]): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    supplier: row.supplier,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.createdAt,
    lineItems: items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
    })),
  };
}

export const postgresStore: FinSightStore = {
  async register(input) {
    try {
      return await db.transaction(async (tx) => {
        const slug = `${input.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'workspace'}-${randomUUID().slice(0, 8)}`;
        const [tenant] = await tx.insert(tenants).values({
          name: input.organizationName,
          slug,
        }).returning({ id: tenants.id });
        const [user] = await tx.insert(users).values({
          email: input.email.toLowerCase(),
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          tenantId: tenant.id,
          role: 'admin',
        }).returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          tenantId: users.tenantId,
          role: users.role,
        });
        await tx.insert(auditLogs).values({
          tenantId: tenant.id,
          userId: user.id,
          action: 'account.created',
          entityType: 'tenant',
          entityId: String(tenant.id),
        });
        return user;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DataConflictError('An account with this email already exists.');
      throw error;
    }
  },

  async findUserByEmail(email) {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      tenantId: users.tenantId,
      role: users.role,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return user;
  },

  async findUserById(id, tenantId) {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      tenantId: users.tenantId,
      role: users.role,
      isActive: users.isActive,
    }).from(users).where(and(
      eq(users.id, id),
      eq(users.tenantId, tenantId),
    )).limit(1);
    return user;
  },

  async addDocument(input) {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(uploadedDocuments).values({
        id: input.id,
        tenantId: input.tenantId,
        storageKey: input.storageKey,
        originalName: input.originalName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: input.status,
      }).returning();
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'document.uploaded',
        entityType: 'document',
        entityId: row.id,
        payload: { contentType: row.contentType, sizeBytes: row.sizeBytes },
      });
      return row;
    });
  },

  async findDocument(id, tenantId) {
    const [row] = await db.select().from(uploadedDocuments).where(and(
      eq(uploadedDocuments.id, id),
      eq(uploadedDocuments.tenantId, tenantId),
    )).limit(1);
    return row;
  },

  async listDocuments(tenantId) {
    return db.select().from(uploadedDocuments)
      .where(eq(uploadedDocuments.tenantId, tenantId))
      .orderBy(desc(uploadedDocuments.createdAt));
  },

  async beginDocumentOcr(input) {
    return db.transaction(async (tx) => {
      const [document] = await tx.update(uploadedDocuments).set({ status: 'processing' }).where(and(
        eq(uploadedDocuments.id, input.id),
        eq(uploadedDocuments.tenantId, input.tenantId),
        ne(uploadedDocuments.status, 'processing'),
      )).returning({ id: uploadedDocuments.id });
      if (!document) return false;
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'document.ocr_started',
        entityType: 'document',
        entityId: input.id,
      });
      return true;
    });
  },

  async saveDocumentExtraction(input) {
    return db.transaction(async (tx) => {
      const [document] = await tx.update(uploadedDocuments).set({ status: 'needs_review' }).where(and(
        eq(uploadedDocuments.id, input.id),
        eq(uploadedDocuments.tenantId, input.tenantId),
        eq(uploadedDocuments.status, 'processing'),
      )).returning({ id: uploadedDocuments.id });
      if (!document) return undefined;
      const [row] = await tx.insert(documentExtractions).values({
        tenantId: input.tenantId,
        documentId: input.id,
        provider: input.result.provider,
        engineVersion: input.result.engineVersion,
        languages: input.result.languages,
        text: input.result.text,
        pages: input.result.pages,
        structuredData: input.structuredData,
        createdBy: input.userId,
      }).returning();
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'document.ocr_completed',
        entityType: 'document',
        entityId: input.id,
        payload: {
          extractionId: row.id,
          provider: row.provider,
          pageCount: input.result.pages.length,
          documentType: input.structuredData.documentType,
          schemaVersion: input.structuredData.schemaVersion,
        },
      });
      return {
        id: row.id,
        documentId: row.documentId,
        provider: row.provider,
        engineVersion: row.engineVersion,
        languages: row.languages,
        text: row.text,
        pages: input.result.pages,
        structuredData: input.structuredData,
        createdAt: row.createdAt,
      };
    });
  },

  async failDocumentOcr(input) {
    await db.transaction(async (tx) => {
      const [document] = await tx.update(uploadedDocuments).set({ status: 'failed' }).where(and(
        eq(uploadedDocuments.id, input.id),
        eq(uploadedDocuments.tenantId, input.tenantId),
        eq(uploadedDocuments.status, 'processing'),
      )).returning({ id: uploadedDocuments.id });
      if (!document) return;
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'document.ocr_failed',
        entityType: 'document',
        entityId: input.id,
      });
    });
  },

  async findDocumentExtraction(documentId, tenantId) {
    const [row] = await db.select().from(documentExtractions).where(and(
      eq(documentExtractions.documentId, documentId),
      eq(documentExtractions.tenantId, tenantId),
    )).orderBy(desc(documentExtractions.createdAt)).limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      documentId: row.documentId,
      provider: row.provider,
      engineVersion: row.engineVersion,
      languages: row.languages,
      text: row.text,
      pages: row.pages as OcrResult['pages'],
      structuredData: row.structuredData as InvoiceExtractionCandidate | null,
      createdAt: row.createdAt,
    };
  },

  async createInvoice(input) {
    try {
      return await db.transaction(async (tx) => {
        const { invoice, tenantId, userId } = input;
        const [row] = await tx.insert(invoices).values({
          tenantId,
          createdBy: userId,
          invoiceNumber: invoice.invoiceNumber,
          supplier: invoice.supplier,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate || null,
          currency: invoice.currency,
          subtotal: invoice.subtotal.toFixed(2),
          tax: invoice.tax.toFixed(2),
          total: invoice.total.toFixed(2),
          confidence: input.confidence.toFixed(4),
          status: 'needs_review',
          rawData: invoice,
        }).returning();
        const insertedItems = await tx.insert(invoiceItems).values(invoice.lineItems.map((item) => ({
          invoiceId: row.id,
          description: item.description,
          quantity: item.quantity.toFixed(4),
          unitPrice: item.unitPrice.toFixed(2),
          amount: item.amount.toFixed(2),
        }))).returning();
        await tx.insert(reviewHistory).values({
          tenantId,
          invoiceId: row.id,
          userId,
          action: 'created',
          toStatus: 'needs_review',
        });
        await tx.insert(auditLogs).values({
          tenantId,
          userId,
          action: 'invoice.created',
          entityType: 'invoice',
          entityId: row.id,
        });
        return toInvoiceRecord(row, insertedItems);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DataConflictError('This supplier invoice number already exists.');
      throw error;
    }
  },

  async updateInvoice(input) {
    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx.select().from(invoices).where(and(
          eq(invoices.id, input.id),
          eq(invoices.tenantId, input.tenantId),
        )).limit(1).for('update');
        if (!current) return undefined;

        const { invoice } = input;
        const previousResult = invoiceInputSchema.safeParse(current.rawData);
        if (!previousResult.success) throw new Error('Stored invoice data failed validation before update.');
        const previous = previousResult.data;
        const fields = (Object.keys(invoice) as Array<keyof InvoicePayload>)
          .filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(invoice[field]));
        if (fields.length === 0) {
          const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, current.id));
          return toInvoiceRecord(current, items);
        }
        const before = Object.fromEntries(fields.map((field) => [field, previous[field]]));
        const after = Object.fromEntries(fields.map((field) => [field, invoice[field]]));
        const [updated] = await tx.update(invoices).set({
          invoiceNumber: invoice.invoiceNumber,
          supplier: invoice.supplier,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate || null,
          currency: invoice.currency,
          subtotal: invoice.subtotal.toFixed(2),
          tax: invoice.tax.toFixed(2),
          total: invoice.total.toFixed(2),
          confidence: input.confidence.toFixed(4),
          status: 'needs_review',
          rawData: invoice,
          updatedAt: new Date(),
        }).where(eq(invoices.id, current.id)).returning();

        await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, current.id));
        const insertedItems = await tx.insert(invoiceItems).values(invoice.lineItems.map((item) => ({
          invoiceId: current.id,
          description: item.description,
          quantity: item.quantity.toFixed(4),
          unitPrice: item.unitPrice.toFixed(2),
          amount: item.amount.toFixed(2),
        }))).returning();
        await tx.insert(reviewHistory).values({
          tenantId: input.tenantId,
          invoiceId: current.id,
          userId: input.userId,
          action: 'fields_updated',
          fromStatus: current.status,
          toStatus: 'needs_review',
          changes: { fields, before, after },
        });
        await tx.insert(auditLogs).values({
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'invoice.fields_updated',
          entityType: 'invoice',
          entityId: current.id,
          payload: { fields },
        });
        return toInvoiceRecord(updated, insertedItems);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DataConflictError('This supplier invoice number already exists.');
      throw error;
    }
  },

  async listInvoices(tenantId) {
    const rows = await db.select().from(invoices).where(eq(invoices.tenantId, tenantId))
      .orderBy(desc(invoices.createdAt));
    const result: InvoiceRecord[] = [];
    for (const row of rows) {
      const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, row.id));
      result.push(toInvoiceRecord(row, items));
    }
    return result;
  },

  async findInvoice(id, tenantId) {
    const [row] = await db.select().from(invoices).where(and(
      eq(invoices.id, id),
      eq(invoices.tenantId, tenantId),
    )).limit(1);
    if (!row) return undefined;
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, row.id));
    return toInvoiceRecord(row, items);
  },

  async transitionInvoice(input) {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(invoices).where(and(
        eq(invoices.id, input.id),
        eq(invoices.tenantId, input.tenantId),
      )).limit(1).for('update');
      if (!current) return undefined;
      const allowed = current.status === 'needs_review'
        ? input.status === 'approved' || input.status === 'rejected'
        : current.status === 'rejected' && input.status === 'needs_review';
      if (!allowed) throw new DataConflictError(`Cannot transition invoice from ${current.status} to ${input.status}.`);

      const [updated] = await tx.update(invoices).set({
        status: input.status,
        updatedAt: new Date(),
      }).where(eq(invoices.id, current.id)).returning();
      await tx.insert(reviewHistory).values({
        tenantId: input.tenantId,
        invoiceId: current.id,
        userId: input.userId,
        action: 'status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        reason: input.reason,
      });
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'invoice.status_changed',
        entityType: 'invoice',
        entityId: current.id,
        payload: { fromStatus: current.status, toStatus: input.status },
      });
      const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, current.id));
      return toInvoiceRecord(updated, items);
    });
  },

  async listReviewHistory(invoiceId, tenantId) {
    const rows = await db.select({
      action: reviewHistory.action,
      fromStatus: reviewHistory.fromStatus,
      toStatus: reviewHistory.toStatus,
      reason: reviewHistory.reason,
      changes: reviewHistory.changes,
      createdAt: reviewHistory.createdAt,
      userName: users.fullName,
    }).from(reviewHistory)
      .innerJoin(users, eq(reviewHistory.userId, users.id))
      .where(and(eq(reviewHistory.invoiceId, invoiceId), eq(reviewHistory.tenantId, tenantId)))
      .orderBy(desc(reviewHistory.createdAt));
    return rows;
  },
};
