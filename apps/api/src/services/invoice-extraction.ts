import type { OcrResult } from './ocr-provider.js';

export type ExtractedField<T> = {
  value: T | null;
  confidence: number;
  evidence: string | null;
  pageNumber: number | null;
};

export type InvoiceExtractionCandidate = {
  schemaVersion: 1;
  documentType: 'invoice' | 'unknown';
  reviewRequired: true;
  fields: {
    invoiceNumber: ExtractedField<string>;
    supplier: ExtractedField<string>;
    issueDate: ExtractedField<string>;
    dueDate: ExtractedField<string>;
    currency: ExtractedField<string>;
    subtotal: ExtractedField<number>;
    tax: ExtractedField<number>;
    total: ExtractedField<number>;
  };
  notes: string[];
};

type SourceLine = { text: string; pageNumber: number };

const FIELD_CONFIDENCE = 0.85;
const LABELS = {
  invoiceNumber: [
    'invoice\\s*(?:number|no\\.?|#)', 'bill\\s*(?:number|no\\.?|#)', 'رقم\\s*الفاتورة',
  ],
  supplier: [
    'supplier', 'vendor', 'billed\\s*by', 'seller', 'المورد', 'البائع', 'اسم\\s*المورد',
  ],
  issueDate: [
    'invoice\\s*date', 'issue\\s*date', 'date\\s*issued', 'تاريخ\\s*الفاتورة', 'تاريخ\\s*الإصدار',
  ],
  dueDate: [
    'due\\s*date', 'payment\\s*due', 'تاريخ\\s*الاستحقاق',
  ],
  subtotal: [
    'sub\\s*total', 'subtotal', 'net\\s*amount', 'المجموع\\s*الفرعي',
  ],
  tax: [
    'tax', 'vat', 'gst', 'ضريبة(?:\\s*القيمة\\s*المضافة)?',
  ],
  total: [
    'grand\\s*total', 'amount\\s*due', 'total\\s*(?:due|amount)?', 'الإجمالي', 'المجموع\\s*الكلي', 'المبلغ\\s*المستحق',
  ],
} satisfies Record<string, string[]>;

function sourceLines(result: OcrResult): SourceLine[] {
  return result.pages.flatMap((page) => page.text
    .split(/\r?\n/)
    .map((text) => ({ text: text.trim(), pageNumber: page.pageNumber }))
    .filter((line) => line.text.length > 0));
}

function findLabeledLine(lines: SourceLine[], labels: string[]): { line: SourceLine; value: string } | null {
  const expression = new RegExp(`^\\s*(?:${labels.join('|')})\\s*(?:[:#\\-]\\s*|\\s+)(.+?)\\s*$`, 'i');
  for (const line of lines) {
    const match = line.text.match(expression);
    if (match?.[1]) return { line, value: match[1].trim() };
  }
  return null;
}

function emptyField<T>(): ExtractedField<T> {
  return { value: null, confidence: 0, evidence: null, pageNumber: null };
}

function fieldFromMatch<T>(
  match: { line: SourceLine; value: string } | null,
  parse: (value: string) => T | null,
): ExtractedField<T> {
  if (!match) return emptyField();
  const value = parse(match.value);
  return value === null
    ? emptyField()
    : {
      value,
      confidence: FIELD_CONFIDENCE,
      evidence: match.line.text,
      pageNumber: match.line.pageNumber,
    };
}

function normalizeDigits(value: string) {
  return value.replace(/٫/g, '.').replace(/٬/g, ',')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function parseDate(value: string): string | null {
  const normalized = normalizeDigits(value);
  const iso = normalized.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = normalized.match(/\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})\b/);
  if (dayFirst) {
    const first = Number(dayFirst[1]);
    const second = Number(dayFirst[2]);
    if (first <= 12 && second <= 12) return null;
    return first > 12
      ? validDate(Number(dayFirst[3]), second, first)
      : validDate(Number(dayFirst[3]), first, second);
  }

  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const named = normalized.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i);
  if (!named) return null;
  const month = monthNames[named[2].toLowerCase()];
  return month ? validDate(Number(named[3]), month, Number(named[1])) : null;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseAmount(value: string): number | null {
  const normalized = normalizeDigits(value);
  const token = normalized.match(/-?\d[\d\s,.\u00a0]*\d|-?\d/);
  if (!token) return null;
  const number = token[0].replace(/[\s\u00a0]/g, '');
  const comma = number.lastIndexOf(',');
  const dot = number.lastIndexOf('.');
  let decimal: string;
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    decimal = number.replace(/[,.](?=.*[,.])/g, '').replace(decimalSeparator, '.');
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.';
    const parts = number.split(separator);
    decimal = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2
      ? `${parts[0]}.${parts[1]}`
      : parts.join('');
  } else {
    decimal = number;
  }
  const parsed = Number(decimal);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}

function parseCurrency(lines: SourceLine[]): { line: SourceLine; value: string } | null {
  const patterns: Array<[RegExp, string]> = [
    [/\bUSD\b|US\s*\$/, 'USD'], [/\bSAR\b|ر\.?\s*س\.?/, 'SAR'], [/\bAED\b/, 'AED'],
    [/\bEUR\b|€/, 'EUR'], [/\bGBP\b|£/, 'GBP'], [/\bJPY\b|¥/, 'JPY'],
    [/\bCAD\b/, 'CAD'], [/\bAUD\b/, 'AUD'], [/\bINR\b|₹/, 'INR'],
  ];
  for (const line of lines) {
    for (const [expression, value] of patterns) {
      if (expression.test(line.text)) return { line, value };
    }
  }
  return null;
}

function matchAsField<T>(
  match: { line: SourceLine; value: string } | null,
  value: T | null,
): ExtractedField<T> {
  return !match || value === null
    ? emptyField()
    : {
      value,
      confidence: FIELD_CONFIDENCE,
      evidence: match.line.text,
      pageNumber: match.line.pageNumber,
    };
}

export function extractInvoiceCandidate(result: OcrResult): InvoiceExtractionCandidate {
  const lines = sourceLines(result);
  const invoiceNumberMatch = findLabeledLine(lines, LABELS.invoiceNumber);
  const supplierMatch = findLabeledLine(lines, LABELS.supplier);
  const issueDateMatch = findLabeledLine(lines, LABELS.issueDate);
  const dueDateMatch = findLabeledLine(lines, LABELS.dueDate);
  const subtotalMatch = findLabeledLine(lines, LABELS.subtotal);
  const taxMatch = findLabeledLine(lines, LABELS.tax);
  const totalMatch = findLabeledLine(lines, LABELS.total);
  const currencyMatch = parseCurrency(lines);
  const fields = {
    invoiceNumber: fieldFromMatch(invoiceNumberMatch, (value) => value.replace(/\s{2,}/g, ' ').slice(0, 100) || null),
    supplier: fieldFromMatch(supplierMatch, (value) => value.slice(0, 200) || null),
    issueDate: fieldFromMatch(issueDateMatch, parseDate),
    dueDate: fieldFromMatch(dueDateMatch, parseDate),
    currency: matchAsField(currencyMatch, currencyMatch?.value ?? null),
    subtotal: fieldFromMatch(subtotalMatch, parseAmount),
    tax: fieldFromMatch(taxMatch, parseAmount),
    total: fieldFromMatch(totalMatch, parseAmount),
  };
  const hasInvoiceEvidence = fields.invoiceNumber.value !== null || fields.total.value !== null;

  return {
    schemaVersion: 1,
    documentType: hasInvoiceEvidence ? 'invoice' : 'unknown',
    reviewRequired: true,
    fields,
    notes: ['Candidate fields are label-based local extraction and require human verification.', 'Line items are not inferred; enter or verify them manually.'],
  };
}
