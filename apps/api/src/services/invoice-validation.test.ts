import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateInvoice } from './invoice-validation.js';

describe('validateInvoice', () => {
  it('accepts a valid invoice and marks it verified', () => {
    const result = validateInvoice({
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
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'verified');
      assert.equal(result.warnings.length, 0);
      assert.ok(result.confidence > 0.9);
    }
  });

  it('flags mismatched totals as needing review', () => {
    const result = validateInvoice({
      invoiceNumber: 'INV-2026-0105',
      supplier: 'Omega Goods',
      issueDate: '2026-10-02',
      currency: 'USD',
      subtotal: 1200,
      tax: 100,
      total: 1300,
      lineItems: [
        { description: 'Laptop', quantity: 1, unitPrice: 400, amount: 400 },
        { description: 'Mouse', quantity: 2, unitPrice: 300, amount: 600 },
      ],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 'needs_review');
      assert.ok(result.warnings.includes('Subtotal does not match the sum of the line items.'));
    }
  });

  it('rejects invalid payloads', () => {
    const result = validateInvoice({
      invoiceNumber: '',
      supplier: '',
      issueDate: '2026-10-01',
      currency: 'US',
      subtotal: -5,
      tax: 2,
      total: 10,
      lineItems: [],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, 'Invalid invoice payload');
    }
  });

  it('rejects impossible dates and due dates before invoice dates', () => {
    const base = {
      invoiceNumber: 'INV-DATE-1',
      supplier: 'Date Test Supplier',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      subtotal: 10,
      tax: 1,
      total: 11,
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 10, amount: 10 }],
    };

    assert.equal(validateInvoice({ ...base, issueDate: '2026-02-30' }).ok, false);
    assert.equal(validateInvoice({ ...base, dueDate: '2026-09-30' }).ok, false);
  });
});
