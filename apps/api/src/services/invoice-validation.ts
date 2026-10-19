import { z } from 'zod';

export const lineItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.coerce.number().finite().min(0),
  unitPrice: z.coerce.number().finite().min(0),
  amount: z.coerce.number().finite().min(0),
}).refine(
  (item) => Math.abs(item.quantity * item.unitPrice - item.amount) <= 0.01,
  {
    message: 'Line item amount does not match quantity × unit price.',
    path: ['amount'],
  },
);

export const invoiceInputSchema = z.object({
  invoiceNumber: z.string().trim().min(1),
  supplier: z.string().trim().min(1),
  issueDate: z.string().trim().min(1),
  dueDate: z.string().trim().optional().or(z.literal('')),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  subtotal: z.coerce.number().finite().min(0),
  tax: z.coerce.number().finite().min(0),
  total: z.coerce.number().finite().min(0),
  lineItems: z.array(lineItemSchema).min(1),
});

export type InvoiceItem = z.infer<typeof lineItemSchema>;
export type InvoicePayload = z.infer<typeof invoiceInputSchema>;

export type ValidationStatus = 'verified' | 'needs_review';

export type InvoiceValidationResult = {
  ok: true;
  documentType: 'invoice';
  confidence: number;
  status: ValidationStatus;
  warnings: string[];
  extracted: InvoicePayload;
};

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function validateInvoice(payload: unknown): InvoiceValidationResult | { ok: false; message: string; errors: unknown } {
  const parsed = invoiceInputSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Invalid invoice payload',
      errors: parsed.error.flatten(),
    };
  }

  const data = parsed.data;
  const warnings: string[] = [];

  const lineSubtotal = roundMoney(
    data.lineItems.reduce((sum, item) => sum + item.amount, 0),
  );

  if (Math.abs(lineSubtotal - data.subtotal) > 0.01) {
    warnings.push('Subtotal does not match the sum of the line items.');
  }

  if (Math.abs(data.subtotal + data.tax - data.total) > 0.01) {
    warnings.push('Total does not match subtotal + tax.');
  }

  const confidence = warnings.length === 0 ? 0.96 : warnings.length === 1 ? 0.8 : 0.7;
  const status: ValidationStatus = warnings.length === 0 ? 'verified' : 'needs_review';

  return {
    ok: true,
    documentType: 'invoice',
    confidence,
    status,
    warnings,
    extracted: {
      ...data,
      dueDate: data.dueDate || undefined,
    },
  };
}
