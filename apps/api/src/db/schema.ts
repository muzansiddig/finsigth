import { boolean, decimal, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  role: text('role', { enum: ['admin', 'accountant', 'reviewer'] }).notNull().default('reviewer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  invoiceNumber: text('invoice_number').notNull(),
  supplier: text('supplier').notNull(),
  issueDate: text('issue_date').notNull(),
  dueDate: text('due_date'),
  currency: text('currency').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 12, scale: 2 }).notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  status: text('status', { enum: ['verified', 'needs_review', 'rejected'] }).notNull().default('needs_review'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }).notNull().default('0.00'),
  rawData: jsonb('raw_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const uploadedDocuments = pgTable('uploaded_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: text('status', { enum: ['uploaded', 'processing', 'processed', 'failed'] }).notNull().default('uploaded'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
