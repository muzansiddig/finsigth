import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../app.js';
import { closeDatabase, pool } from './index.js';
import { DataConflictError, postgresStore } from './repository.js';
import type { InvoicePayload } from '../services/invoice-validation.js';

const integrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const integrationInvoice: InvoicePayload = {
  invoiceNumber: `DB-${randomUUID()}`,
  supplier: 'PostgreSQL Integration Supplier',
  issueDate: '2026-10-01',
  currency: 'USD',
  subtotal: 100,
  tax: 10,
  total: 110,
  lineItems: [{ description: 'Integration test item', quantity: 2.5, unitPrice: 40, amount: 100 }],
};

describe('PostgreSQL repository integration', () => {
  it('persists tenant data, enforces duplicate constraints, and writes review history transactionally', {
    skip: !integrationEnabled,
  }, async () => {
    const email = `integration-${randomUUID()}@example.test`;
    const uploadDirectory = await mkdtemp(join(tmpdir(), 'finsight-pg-integration-'));
    const api = request.agent(createApp({
      uploadDirectory,
      sessionSecret: 'integration-test-session-secret-at-least-32-bytes',
      ocrProvider: {
        extract: async () => ({
          provider: 'tesseract-local',
          engineVersion: 'test',
          languages: 'eng+ara',
          pages: [{ pageNumber: 1, text: 'Invoice Number: DB-42\nGrand Total: 110.00', tokens: [] }],
          text: 'Invoice Number: DB-42\nGrand Total: 110.00',
        }),
      },
    }));
    const tenantIds: number[] = [];
    try {
      const registration = await api.post('/api/auth/register').send({
        email,
        fullName: 'Integration User',
        organizationName: 'Integration Workspace',
        password: 'an integration password',
      });
      assert.equal(registration.status, 201);
      assert.equal((await api.get('/api/auth/me')).body.data.fullName, 'Integration User');
      const account = await postgresStore.findUserByEmail(email);
      assert.ok(account);
      tenantIds.push(account.tenantId);

      const upload = await api.post('/api/documents').attach(
        'file',
        Buffer.from('%PDF-1.7\nintegration test\n%%EOF'),
        { filename: 'test-invoice.pdf', contentType: 'application/pdf' },
      );
      assert.equal(upload.status, 201);
      const document = await postgresStore.findDocument(upload.body.data.id, account.tenantId);
      assert.equal(document?.originalName, 'test-invoice.pdf');
      assert.equal((await api.get(upload.body.data.downloadUrl)).status, 200);
      const ocr = await api.post(`/api/documents/${upload.body.data.id}/ocr`);
      assert.equal(ocr.status, 200);
      assert.equal(ocr.body.data.text, 'Invoice Number: DB-42\nGrand Total: 110.00');
      assert.equal(ocr.body.data.structuredData.fields.invoiceNumber.value, 'DB-42');
      assert.equal(ocr.body.data.structuredData.fields.total.value, 110);
      assert.equal((await postgresStore.findDocument(upload.body.data.id, account.tenantId))?.status, 'needs_review');
      assert.equal(
        (await postgresStore.findDocumentExtraction(upload.body.data.id, account.tenantId))?.pages[0]?.text,
        'Invoice Number: DB-42\nGrand Total: 110.00',
      );
      assert.equal(
        (await postgresStore.findDocumentExtraction(upload.body.data.id, account.tenantId))?.structuredData?.fields.total.value,
        110,
      );

      const createdResponse = await api.post('/api/invoices').send(integrationInvoice);
      assert.equal(createdResponse.status, 201);
      const createdId = createdResponse.body.data.id as string;
      assert.equal(createdResponse.body.data.lineItems[0]?.quantity, '2.5000');
      assert.equal((await postgresStore.listInvoices(account.tenantId)).length, 1);

      const duplicate = await api.post('/api/invoices').send(integrationInvoice);
      assert.equal(duplicate.status, 409);
      assert.equal((await postgresStore.listInvoices(account.tenantId)).length, 1);

      const updated = await api.put(`/api/invoices/${createdId}`).send({
        ...integrationInvoice,
        supplier: 'Corrected Integration Supplier',
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.supplier, 'Corrected Integration Supplier');
      assert.equal(updated.body.data.status, 'needs_review');

      const approved = await api.patch(`/api/invoices/${createdId}/status`).send({
        status: 'approved',
        reason: 'Integration test approval.',
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.data.status, 'approved');
      await assert.rejects(
        postgresStore.transitionInvoice({
          id: createdId,
          tenantId: account.tenantId,
          userId: account.id,
          status: 'rejected',
          reason: 'Illegal transition.',
        }),
        DataConflictError,
      );
      const history = await api.get(`/api/invoices/${createdId}/history`);
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.data.map((entry: { action: string }) => entry.action), ['status_changed', 'fields_updated', 'created']);
      assert.equal(history.body.data[1].changes.before.supplier, integrationInvoice.supplier);
      assert.equal(history.body.data[1].changes.after.supplier, 'Corrected Integration Supplier');
      const storedHistory = await postgresStore.listReviewHistory(createdId, account.tenantId);
      assert.deepEqual(storedHistory.map((entry) => entry.action), ['status_changed', 'fields_updated', 'created']);
      assert.equal(storedHistory[0]?.reason, 'Integration test approval.');
      const auditActions = await pool.query(
        'SELECT action FROM audit_logs WHERE tenant_id = $1 ORDER BY id',
        [account.tenantId],
      );
      assert.deepEqual(auditActions.rows.map((row: { action: string }) => row.action), [
        'account.created',
        'document.uploaded',
        'document.ocr_started',
        'document.ocr_completed',
        'invoice.created',
        'invoice.fields_updated',
        'invoice.status_changed',
      ]);

      const otherEmail = `integration-other-${randomUUID()}@example.test`;
      const otherTenant = await request.agent(createApp({
        uploadDirectory,
        sessionSecret: 'integration-test-session-secret-at-least-32-bytes',
      }));
      const otherRegistration = await otherTenant.post('/api/auth/register').send({
        email: otherEmail,
        fullName: 'Other Tenant',
        organizationName: 'Other Integration Workspace',
        password: 'another integration password',
      });
      assert.equal(otherRegistration.status, 201);
      tenantIds.push(otherRegistration.body.data.tenantId as number);
      assert.equal((await otherTenant.get(upload.body.data.downloadUrl)).status, 404);
      assert.equal((await otherTenant.get(`/api/documents/${upload.body.data.id}/extraction`)).status, 404);
      assert.deepEqual((await otherTenant.get('/api/invoices')).body.data, []);
    } finally {
      for (const tenantId of tenantIds) {
        await pool.query('DELETE FROM review_history WHERE tenant_id = $1', [tenantId]);
        await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]);
        await pool.query('DELETE FROM uploaded_documents WHERE tenant_id = $1', [tenantId]);
        await pool.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = $1)', [tenantId]);
        await pool.query('DELETE FROM invoices WHERE tenant_id = $1', [tenantId]);
        await pool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
        await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
      }
      await rm(uploadDirectory, { recursive: true, force: true });
    }
  });
});

after(async () => {
  if (integrationEnabled) await closeDatabase();
});
