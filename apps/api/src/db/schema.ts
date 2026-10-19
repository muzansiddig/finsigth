import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  role: text('role', { enum: ['admin', 'reviewer', 'viewer'] }).notNull().default('reviewer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('users_tenant_id_idx').on(table.tenantId),
  check('users_role_check', sql`${table.role} in ('admin', 'reviewer', 'viewer')`),
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  invoiceNumber: text('invoice_number').notNull(),
  supplier: text('supplier').notNull(),
  issueDate: text('issue_date').notNull(),
  dueDate: text('due_date'),
  currency: text('currency').notNull(),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  tax: numeric('tax', { precision: 12, scale: 2 }).notNull(),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  status: text('status', { enum: ['needs_review', 'approved', 'rejected'] }).notNull().default('needs_review'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('0.0000'),
  rawData: jsonb('raw_data').notNull().default({}),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('invoices_tenant_created_idx').on(table.tenantId, table.createdAt),
  index('invoices_tenant_status_idx').on(table.tenantId, table.status),
  uniqueIndex('invoices_tenant_supplier_number_uidx')
    .on(table.tenantId, table.supplier, table.invoiceNumber),
  check('invoices_status_check', sql`${table.status} in ('needs_review', 'approved', 'rejected')`),
  check('invoices_amounts_nonnegative_check', sql`${table.subtotal} >= 0 and ${table.tax} >= 0 and ${table.total} >= 0`),
]);

export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('invoice_items_invoice_id_idx').on(table.invoiceId),
  check('invoice_items_amounts_nonnegative_check', sql`${table.quantity} >= 0 and ${table.unitPrice} >= 0 and ${table.amount} >= 0`),
]);

export const uploadedDocuments = pgTable('uploaded_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: text('status', { enum: ['uploaded', 'processing', 'needs_review', 'failed'] }).notNull().default('uploaded'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('documents_tenant_created_idx').on(table.tenantId, table.createdAt),
  index('documents_tenant_status_idx').on(table.tenantId, table.status),
  check('documents_status_check', sql`${table.status} in ('uploaded', 'processing', 'needs_review', 'failed')`),
  check('documents_size_check', sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 12582912`),
]);

export const documentExtractions = pgTable('document_extractions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  documentId: uuid('document_id').notNull().references(() => uploadedDocuments.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  engineVersion: text('engine_version').notNull(),
  languages: text('languages').notNull(),
  text: text('text').notNull(),
  pages: jsonb('pages').notNull(),
  structuredData: jsonb('structured_data'),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('document_extractions_tenant_document_created_idx').on(table.tenantId, table.documentId, table.createdAt),
]);

export const reviewHistory = pgTable('review_history', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  action: text('action', { enum: ['created', 'fields_updated', 'status_changed'] }).notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  changes: jsonb('changes').notNull().default({}),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('review_history_invoice_created_idx').on(table.invoiceId, table.createdAt),
  check('review_history_action_check', sql`${table.action} in ('created', 'fields_updated', 'status_changed')`),
]);

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt)]);
