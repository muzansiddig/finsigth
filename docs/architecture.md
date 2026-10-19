# Architecture and implementation status

## Current prototype

```mermaid
flowchart LR
  Browser[React + Vite review UI] -->|HTTP / JSON and multipart| API[Express API]
  API --> Validate[Zod schema + deterministic checks]
  API --> LocalDisk[Local upload directory]
  Demo[Illustrative in-memory invoice data] --> API
  Schema[Drizzle PostgreSQL schema and Pool] -. scaffold only .-> PostgreSQL[(PostgreSQL)]
```

The browser uses the Vite `/api` proxy in development. Invoice examples are in-memory demo records. Uploads are signature-checked and written to a local directory under a random UUID; the local file route is not authenticated. API routes do not currently write invoice or document metadata to PostgreSQL.

## Target release architecture

```mermaid
flowchart LR
  UI[React review UI] --> Auth[Authenticated API]
  Auth --> Tenant[Role and tenant authorization]
  Tenant --> DB[(PostgreSQL)]
  Tenant --> Storage[Private object storage]
  Tenant --> Queue[Durable job queue]
  Queue --> Worker[Document worker]
  Worker --> OCR[OCR adapter]
  OCR --> Extract[Extraction adapter]
  Extract --> Validate[Schema and deterministic validation]
  Validate --> DB
  DB --> UI
```

The target is a modular monolith plus a separately scalable worker, not a collection of microservices. Provider adapters must keep OCR/LLM vendor details outside the invoice domain. Document text is untrusted input; it must never control authorization, tenant IDs, or approval state.

## Data flow and invariants

1. Authenticate and authorize the upload before accepting a document.
2. Validate file size and file signature; calculate a content hash and enforce idempotency.
3. Store the original in private object storage and create metadata/job rows transactionally or with an explicit recoverable outbox.
4. Process asynchronously. Store OCR text and structured extraction only under the owning tenant's scope.
5. Validate outputs against a versioned shared contract and deterministic rules. Unknown values remain null/unknown.
6. Present uncertain or inconsistent values for human review. Validation never implies approval.
7. Record corrections and approvals as append-only audit events. Reprocessing creates a new extraction version.

## Current data model

`apps/api/src/db/schema.ts` defines organizations (`tenants`), users, invoices, invoice items, audit logs, and uploaded document metadata. The current API remains a UI/validation prototype: the data model must be connected transactionally to routes, scoped to a tenant, and migrated before it represents persisted product data.

## Operational dependencies for a real deployment

- PostgreSQL with backups and tested migrations.
- Private object storage, encryption, access controls, lifecycle policy, and malware scanning.
- Durable queue and worker; bounded exponential retry with jitter and dead-letter handling.
- Authentication provider or securely implemented session/JWT lifecycle with key rotation.
- OCR/extraction runtime selected after measuring representative English and Arabic fixtures.
- Monitoring that redacts document contents, credentials, and personal data.
