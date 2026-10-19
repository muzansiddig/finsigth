import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractInvoiceCandidate } from './invoice-extraction.js';
import type { OcrResult } from './ocr-provider.js';

function ocr(text: string): OcrResult {
  return {
    provider: 'tesseract-local',
    engineVersion: '5.3.0',
    languages: 'eng+ara',
    pages: [{
      pageNumber: 2,
      text,
      tokens: [],
    }],
    text,
  };
}

describe('local invoice field extraction', () => {
  it('extracts labeled English fields, normalizes amounts, and retains source evidence', () => {
    const result = extractInvoiceCandidate(ocr([
      'Supplier: Northwind Trading',
      'Invoice Number: NW-2026-07',
      'Invoice Date: 2026-07-04',
      'Due Date: 2026-08-04',
      'Currency: USD',
      'Subtotal: $1,234.50',
      'Tax: $98.76',
      'Grand Total: $1,333.26',
    ].join('\n')));

    assert.equal(result.documentType, 'invoice');
    assert.equal(result.reviewRequired, true);
    assert.equal(result.fields.invoiceNumber.value, 'NW-2026-07');
    assert.equal(result.fields.supplier.value, 'Northwind Trading');
    assert.equal(result.fields.issueDate.value, '2026-07-04');
    assert.equal(result.fields.dueDate.value, '2026-08-04');
    assert.equal(result.fields.currency.value, 'USD');
    assert.equal(result.fields.subtotal.value, 1234.5);
    assert.equal(result.fields.tax.value, 98.76);
    assert.equal(result.fields.total.value, 1333.26);
    assert.equal(result.fields.total.pageNumber, 2);
    assert.equal(result.fields.total.evidence, 'Grand Total: $1,333.26');
  });

  it('recognizes Arabic labels and digits without guessing ambiguous dates', () => {
    const result = extractInvoiceCandidate(ocr([
      'رقم الفاتورة: ٧٢١',
      'تاريخ الفاتورة: 04/05/2026',
      'ضريبة القيمة المضافة: ١٢٫٥٠',
      'الإجمالي: ١٢٥٫٥٠ SAR',
    ].join('\n')));

    assert.equal(result.documentType, 'invoice');
    assert.equal(result.fields.invoiceNumber.value, '٧٢١');
    assert.equal(result.fields.issueDate.value, null);
    assert.equal(result.fields.tax.value, 12.5);
    assert.equal(result.fields.total.value, 125.5);
    assert.equal(result.fields.currency.value, 'SAR');
  });

  it('returns unknown and null fields rather than fabricating invoice data', () => {
    const result = extractInvoiceCandidate(ocr('Thank you for your business'));

    assert.equal(result.documentType, 'unknown');
    assert.equal(result.fields.invoiceNumber.value, null);
    assert.equal(result.fields.total.value, null);
    assert.equal(result.fields.total.confidence, 0);
    assert.ok(result.notes.some((note) => note.includes('Line items')));
  });
});
