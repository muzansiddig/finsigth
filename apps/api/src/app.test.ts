import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from './app.js';
import {
  DataConflictError,
  type Account,
  type DocumentExtractionRecord,
  type DocumentRecord,
  type FinSightStore,
  type InvoiceRecord,
} from './db/repository.js';
import { hashPassword } from './services/auth.js';
import type { InvoicePayload } from './services/invoice-validation.js';
import { extractInvoiceCandidate } from './services/invoice-extraction.js';
import type { InvoiceExtractionCandidate } from './services/invoice-extraction.js';
import type { OcrResult } from './services/ocr-provider.js';

const sessionSecret = 'test-only-session-secret-with-more-than-32-bytes';
const invoiceInput: InvoicePayload = {
  invoiceNumber: 'INV-TEST-1',
  supplier: 'Example Supplier',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  subtotal: 125,
  tax: 12.5,
  total: 137.5,
  lineItems: [{ description: 'Service', quantity: 1, unitPrice: 125, amount: 125 }],
};

class MemoryStore implements FinSightStore {
  private nextUserId = 1;
  private nextTenantId = 1;
  private nextExtractionId = 1;
  private readonly accounts = new Map<string, Account & { passwordHash: string; isActive: boolean }>();
  readonly documents = new Map<string, DocumentRecord>();
  readonly extractions = new Map<string, DocumentExtractionRecord>();
  readonly invoices = new Map<string, InvoiceRecord>();
  readonly events = new Map<string, Array<{ action: string; fromStatus: string | null; toStatus: string | null; reason: string | null; changes: Record<string, unknown>; createdAt: Date; userName: string }>>();

  async register(input: { email: string; fullName: string; organizationName: string; passwordHash: string }) {
    if (this.accounts.has(input.email)) throw new DataConflictError('An account with this email already exists.');
    const account = {
      id: this.nextUserId++,
      email: input.email,
      fullName: input.fullName,
      tenantId: this.nextTenantId++,
      role: 'admin' as const,
      passwordHash: input.passwordHash,
      isActive: true,
    };
    this.accounts.set(account.email, account);
    return { id: account.id, email: account.email, fullName: account.fullName, tenantId: account.tenantId, role: account.role };
  }

  async addAccount(input: { email: string; role: Account['role']; tenantId?: number }) {
    const account = {
      id: this.nextUserId++,
      email: input.email,
      fullName: input.email.split('@')[0] ?? 'Test user',
      tenantId: input.tenantId ?? this.nextTenantId++,
      role: input.role,
      passwordHash: await hashPassword('a secure test password'),
      isActive: true,
    };
    this.accounts.set(account.email, account);
    return account;
  }

  setAccount(email: string, changes: Partial<Pick<Account, 'role'>> & { isActive?: boolean }) {
    const account = this.accounts.get(email);
    if (account) this.accounts.set(email, { ...account, ...changes });
  }

  async findUserByEmail(email: string) {
    return this.accounts.get(email);
  }

  async findUserById(id: number, tenantId: number) {
    const account = [...this.accounts.values()].find((candidate) => candidate.id === id && candidate.tenantId === tenantId);
    if (!account) return undefined;
    return {
      id: account.id,
      email: account.email,
      fullName: account.fullName,
      tenantId: account.tenantId,
      role: account.role,
      isActive: account.isActive,
    };
  }

  async addDocument(input: Omit<DocumentRecord, 'createdAt'> & { userId: number }) {
    const document = { ...input, createdAt: new Date() };
    this.documents.set(document.id, document);
    return document;
  }

  async findDocument(id: string, tenantId: number) {
    const document = this.documents.get(id);
    return document?.tenantId === tenantId ? document : undefined;
  }

  async listDocuments(tenantId: number) {
    return [...this.documents.values()].filter((document) => document.tenantId === tenantId);
  }

  async beginDocumentOcr(input: { id: string; tenantId: number }) {
    const document = await this.findDocument(input.id, input.tenantId);
    if (!document || document.status === 'processing') return false;
    this.documents.set(input.id, { ...document, status: 'processing' });
    return true;
  }

  async saveDocumentExtraction(input: { id: string; tenantId: number; result: OcrResult; structuredData: InvoiceExtractionCandidate }) {
    const document = await this.findDocument(input.id, input.tenantId);
    if (!document || document.status !== 'processing') return undefined;
    this.documents.set(input.id, { ...document, status: 'needs_review' });
    const record: DocumentExtractionRecord = {
      id: this.nextExtractionId++,
      documentId: input.id,
      provider: input.result.provider,
      engineVersion: input.result.engineVersion,
      languages: input.result.languages,
      text: input.result.text,
      pages: input.result.pages,
      structuredData: input.structuredData,
      createdAt: new Date(),
    };
    this.extractions.set(input.id, record);
    return record;
  }

  async failDocumentOcr(input: { id: string; tenantId: number }) {
    const document = await this.findDocument(input.id, input.tenantId);
    if (document?.status === 'processing') {
      this.documents.set(input.id, { ...document, status: 'failed' });
    }
  }

  async findDocumentExtraction(documentId: string, tenantId: number) {
    const document = await this.findDocument(documentId, tenantId);
    return document ? this.extractions.get(documentId) : undefined;
  }

  async createInvoice(input: { tenantId: number; userId: number; invoice: InvoicePayload; confidence: number }) {
    if ([...this.invoices.values()].some((invoice) =>
      invoice.supplier === input.invoice.supplier &&
      invoice.invoiceNumber === input.invoice.invoiceNumber &&
      this.invoiceTenant.get(invoice.id) === input.tenantId,
    )) throw new DataConflictError('This supplier invoice number already exists.');
    const id = randomUUID();
    const invoice: InvoiceRecord = {
      id,
      invoiceNumber: input.invoice.invoiceNumber,
      supplier: input.invoice.supplier,
      issueDate: input.invoice.issueDate,
      dueDate: input.invoice.dueDate || null,
      currency: input.invoice.currency,
      subtotal: input.invoice.subtotal.toFixed(2),
      tax: input.invoice.tax.toFixed(2),
      total: input.invoice.total.toFixed(2),
      confidence: input.confidence.toFixed(4),
      status: 'needs_review',
      createdAt: new Date(),
      lineItems: input.invoice.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity.toFixed(4),
        unitPrice: item.unitPrice.toFixed(2),
        amount: item.amount.toFixed(2),
      })),
    };
    this.invoices.set(id, invoice);
    this.invoiceTenant.set(id, input.tenantId);
    this.events.set(id, [{
      action: 'created',
      fromStatus: null,
      toStatus: 'needs_review',
      reason: null,
      changes: {},
      createdAt: new Date(),
      userName: 'Test user',
    }]);
    return invoice;
  }

  async updateInvoice(input: { id: string; tenantId: number; userId: number; invoice: InvoicePayload; confidence: number }) {
    const current = await this.findInvoice(input.id, input.tenantId);
    if (!current) return undefined;
    const updated: InvoiceRecord = {
      ...current,
      invoiceNumber: input.invoice.invoiceNumber,
      supplier: input.invoice.supplier,
      issueDate: input.invoice.issueDate,
      dueDate: input.invoice.dueDate || null,
      currency: input.invoice.currency,
      subtotal: input.invoice.subtotal.toFixed(2),
      tax: input.invoice.tax.toFixed(2),
      total: input.invoice.total.toFixed(2),
      confidence: input.confidence.toFixed(4),
      status: 'needs_review',
      lineItems: input.invoice.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity.toFixed(4),
        unitPrice: item.unitPrice.toFixed(2),
        amount: item.amount.toFixed(2),
      })),
    };
    this.invoices.set(input.id, updated);
    this.events.get(input.id)?.unshift({
      action: 'fields_updated',
      fromStatus: current.status,
      toStatus: 'needs_review',
      reason: null,
      changes: { fields: ['invoiceNumber', 'supplier', 'lineItems'] },
      createdAt: new Date(),
      userName: 'Test user',
    });
    return updated;
  }

  async listInvoices(tenantId: number) {
    return [...this.invoices.values()].filter((invoice) => this.invoiceTenant.get(invoice.id) === tenantId);
  }

  async findInvoice(id: string, tenantId: number) {
    const invoice = this.invoices.get(id);
    return this.invoiceTenant.get(id) === tenantId ? invoice : undefined;
  }

  async transitionInvoice(input: { id: string; tenantId: number; userId: number; status: 'approved' | 'rejected' | 'needs_review'; reason: string }) {
    const invoice = await this.findInvoice(input.id, input.tenantId);
    if (!invoice) return undefined;
    const allowed = invoice.status === 'needs_review'
      ? input.status === 'approved' || input.status === 'rejected'
      : invoice.status === 'rejected' && input.status === 'needs_review';
    if (!allowed) throw new DataConflictError(`Cannot transition invoice from ${invoice.status} to ${input.status}.`);
    const updated = { ...invoice, status: input.status };
    this.invoices.set(invoice.id, updated);
    this.events.get(invoice.id)?.unshift({
      action: 'status_changed',
      fromStatus: invoice.status,
      toStatus: input.status,
      reason: input.reason,
      changes: {},
      createdAt: new Date(),
      userName: 'Test user',
    });
    return updated;
  }

  async listReviewHistory(invoiceId: string, tenantId: number) {
    return (await this.findInvoice(invoiceId, tenantId)) ? this.events.get(invoiceId) ?? [] : [];
  }

  readonly invoiceTenant = new Map<string, number>();
}

let uploadDirectory: string;
let store: MemoryStore;
let app: ReturnType<typeof createApp>;

before(async () => {
  uploadDirectory = await mkdtemp(join(tmpdir(), 'finsight-upload-test-'));
});

beforeEach(() => {
  store = new MemoryStore();
  app = createApp({ uploadDirectory, store, sessionSecret });
});

after(async () => {
  await rm(uploadDirectory, { recursive: true, force: true });
});

async function register(email: string, client: ReturnType<typeof request.agent> = request.agent(app)) {
  const response = await client.post('/api/auth/register').send({
    email,
    fullName: 'FinSight Reviewer',
    organizationName: 'Example Organization',
    password: 'correct horse battery staple',
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return client;
}

describe('authentication and tenant authorization', () => {
  it('registers a private tenant and returns an HttpOnly strict session cookie', async () => {
    const client = request.agent(app);
    const response = await client.post('/api/auth/register').send({
      email: 'owner@example.test',
      fullName: 'Finance Owner',
      organizationName: 'Private Team',
      password: 'a-long-enough-password',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.role, 'admin');
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);
    assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
    const current = await client.get('/api/auth/me');
    assert.equal(current.body.data.tenantId, response.body.data.tenantId);
    assert.equal(current.body.data.fullName, 'Finance Owner');
  });

  it('rejects weak registrations, duplicate emails, and invalid login credentials', async () => {
    const weak = await request(app).post('/api/auth/register').send({
      email: 'weak@example.test',
      fullName: 'Weak Password',
      organizationName: 'Example Team',
      password: 'short',
    });
    assert.equal(weak.status, 400);

    await register('owner@example.test');
    const duplicate = await request(app).post('/api/auth/register').send({
      email: 'owner@example.test',
      fullName: 'Duplicate',
      organizationName: 'Another Team',
      password: 'correct horse battery staple',
    });
    assert.equal(duplicate.status, 409);

    const invalidLogin = await request(app).post('/api/auth/login').send({
      email: 'owner@example.test',
      password: 'incorrect password',
    });
    assert.equal(invalidLogin.status, 401);
  });

  it('requires a session on private endpoints and clears the session on logout', async () => {
    assert.equal((await request(app).get('/api/invoices')).status, 401);
    const client = await register('owner@example.test');
    assert.equal((await client.post('/api/auth/logout')).status, 200);
    assert.equal((await client.get('/api/invoices')).status, 401);
  });

  it('rejects untrusted browser origins', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://attacker.example');
    assert.equal(response.status, 403);
  });
});

describe('private document storage', () => {
  it('runs OCR only for authorized tenant documents and persists page-level evidence', async () => {
    const expectedResult: OcrResult = {
      provider: 'tesseract-local',
      engineVersion: '5.3.0',
      languages: 'eng+ara',
      pages: [{
        pageNumber: 1,
        text: 'Invoice Number: INV-42\nSupplier: Example Supply\nInvoice Date: 2026-10-01\nCurrency: USD\nSubtotal: 100.00\nTax: 25.00\nGrand Total: 125.00',
        tokens: [{
          text: 'INV-42',
          confidence: 0.91,
          box: { x: 24, y: 35, width: 55, height: 14 },
        }],
      }],
      text: 'Invoice Number: INV-42\nSupplier: Example Supply\nInvoice Date: 2026-10-01\nCurrency: USD\nSubtotal: 100.00\nTax: 25.00\nGrand Total: 125.00',
    };
    app = createApp({
      uploadDirectory,
      store,
      sessionSecret,
      ocrProvider: { extract: async () => expectedResult },
    });
    const owner = await register('owner@example.test');
    const uploaded = await owner.post('/api/documents')
      .attach('file', Buffer.from('%PDF-1.7\nFinSight test document\n%%EOF'), {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      });
    const documentId = uploaded.body.data.id as string;

    assert.equal((await owner.post(`/api/documents/${documentId}/ocr`)).status, 200);
    assert.deepEqual((await owner.get(`/api/documents/${documentId}/extraction`)).body.data.text, expectedResult.text);
    assert.equal((await owner.get(`/api/documents/${documentId}/extraction`)).body.data.structuredData.fields.total.value, 125);
    assert.equal((await store.findDocument(documentId, 1))?.status, 'needs_review');
    assert.deepEqual((await store.findDocumentExtraction(documentId, 1))?.pages, expectedResult.pages);
    assert.equal((await store.findDocumentExtraction(documentId, 1))?.structuredData.fields.invoiceNumber.value, 'INV-42');

    const otherTenant = await register('other@example.test');
    assert.equal((await otherTenant.post(`/api/documents/${documentId}/ocr`)).status, 404);
    assert.equal((await otherTenant.get(`/api/documents/${documentId}/extraction`)).status, 404);

    const viewer = await store.addAccount({ email: 'viewer@example.test', role: 'viewer' });
    const viewerClient = request.agent(app);
    await viewerClient.post('/api/auth/login').send({
      email: viewer.email,
      password: 'a secure test password',
    });
    assert.equal((await viewerClient.post(`/api/documents/${documentId}/ocr`)).status, 403);
  });

  it('stores the file and metadata for the authenticated tenant and authorizes every download', async () => {
    const owner = await register('owner@example.test');
    const uploaded = await owner.post('/api/documents')
      .attach('file', Buffer.from('%PDF-1.7\nFinSight test document\n%%EOF'), {
        filename: '..\\private\\invoice.pdf',
        contentType: 'application/pdf',
      });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.data.originalName, 'invoice.pdf');
    assert.match(uploaded.body.data.id, /^[0-9a-f-]{36}$/i);

    const listing = await owner.get('/api/documents');
    assert.equal(listing.body.data.length, 1);
    assert.equal(listing.body.data[0].originalName, 'invoice.pdf');

    const download = await owner.get(uploaded.body.data.downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers['content-type'], /application\/pdf/);
    assert.equal(download.headers['content-disposition'], 'attachment');
    assert.deepEqual(download.body, Buffer.from('%PDF-1.7\nFinSight test document\n%%EOF'));

    const otherTenant = await register('other@example.test');
    assert.equal((await otherTenant.get(uploaded.body.data.downloadUrl)).status, 404);
  });

  it('rejects mismatched signatures, unsupported types, missing files, and unauthenticated uploads', async () => {
    const unauthenticated = await request(app).post('/api/documents')
      .attach('file', Buffer.from('%PDF-1.7'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
    assert.equal(unauthenticated.status, 401);

    const owner = await register('owner@example.test');
    const mismatch = await owner.post('/api/documents')
      .attach('file', Buffer.from('not a PDF'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
    assert.equal(mismatch.status, 400);

    const unsupported = await owner.post('/api/documents')
      .attach('file', Buffer.from('plain text'), { filename: 'invoice.txt', contentType: 'text/plain' });
    assert.equal(unsupported.status, 415);
    assert.equal((await owner.post('/api/documents')).status, 400);
    assert.equal((await owner.get('/api/documents/00000000-0000-4000-8000-000000000000/file')).status, 404);
  });

  it('denies uploads to viewer-role sessions', async () => {
    const viewer = await store.addAccount({ email: 'viewer@example.test', role: 'viewer' });
    const client = request.agent(app);
    await client.post('/api/auth/login').send({ email: viewer.email, password: 'a secure test password' });
    const response = await client.post('/api/documents')
      .attach('file', Buffer.from('%PDF-1.7\n'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
    assert.equal(response.status, 403);
  });

  it('uses current database roles and revokes access for disabled accounts', async () => {
    const owner = await register('owner@example.test');
    store.setAccount('owner@example.test', { role: 'viewer' });
    assert.equal((await owner.get('/api/auth/me')).body.data.role, 'viewer');
    assert.equal((await owner.post('/api/invoices').send(invoiceInput)).status, 403);

    store.setAccount('owner@example.test', { isActive: false });
    assert.equal((await owner.get('/api/invoices')).status, 401);
  });
});

describe('persisted invoice review workflow', () => {
  it('validates, persists, transitions, and records append-only review history', async () => {
    const owner = await register('owner@example.test');
    const created = await owner.post('/api/invoices').send(invoiceInput);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, 'needs_review');
    assert.equal(created.body.data.lineItems.length, 1);
    const invoiceId = created.body.data.id;
    const updated = await owner.put(`/api/invoices/${invoiceId}`).send({
      ...invoiceInput,
      supplier: 'Updated Supplier',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.supplier, 'Updated Supplier');

    const list = await owner.get('/api/invoices');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].supplier, 'Updated Supplier');

    const missingReason = await owner.patch(`/api/invoices/${invoiceId}/status`).send({ status: 'approved', reason: '' });
    assert.equal(missingReason.status, 400);

    const approved = await owner.patch(`/api/invoices/${invoiceId}/status`).send({
      status: 'approved',
      reason: 'Amounts checked against source document.',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, 'approved');

    const invalidTransition = await owner.patch(`/api/invoices/${invoiceId}/status`).send({
      status: 'rejected',
      reason: 'Attempt a second decision.',
    });
    assert.equal(invalidTransition.status, 409);

    const history = await owner.get(`/api/invoices/${invoiceId}/history`);
    assert.deepEqual(history.body.data.map((event: { action: string }) => event.action), ['status_changed', 'fields_updated', 'created']);
    assert.equal(history.body.data[0].toStatus, 'approved');
    assert.equal(history.body.data[0].reason, 'Amounts checked against source document.');
  });

  it('keeps invoice visibility scoped to the authenticated tenant', async () => {
    const owner = await register('owner@example.test');
    const invoice = await owner.post('/api/invoices').send(invoiceInput);
    assert.equal(invoice.status, 201);
    const otherTenant = await register('other@example.test');
    assert.deepEqual((await otherTenant.get('/api/invoices')).body.data, []);
    assert.equal((await otherTenant.get(`/api/invoices/${invoice.body.data.id}/history`)).status, 404);
    assert.equal((await otherTenant.patch(`/api/invoices/${invoice.body.data.id}/status`).send({
      status: 'approved',
      reason: 'Cross-tenant attempt.',
    })).status, 404);
  });

  it('allows a rejected invoice to be explicitly returned to review', async () => {
    const owner = await register('owner@example.test');
    const created = await owner.post('/api/invoices').send({
      ...invoiceInput,
      invoiceNumber: 'INV-RETURN-1',
    });
    const invoiceId = created.body.data.id;
    const rejected = await owner.patch(`/api/invoices/${invoiceId}/status`).send({
      status: 'rejected',
      reason: 'Supplier details do not match.',
    });
    assert.equal(rejected.body.data.status, 'rejected');

    const returned = await owner.patch(`/api/invoices/${invoiceId}/status`).send({
      status: 'needs_review',
      reason: 'Corrected supplier details received.',
    });
    assert.equal(returned.body.data.status, 'needs_review');
  });

  it('rejects invalid invoice data and duplicate supplier invoice numbers', async () => {
    const owner = await register('owner@example.test');
    const invalid = await owner.post('/api/invoices').send({ ...invoiceInput, total: -1 });
    assert.equal(invalid.status, 400);

    assert.equal((await owner.post('/api/invoices').send(invoiceInput)).status, 201);
    const duplicate = await owner.post('/api/invoices').send(invoiceInput);
    assert.equal(duplicate.status, 409);
  });
});
