# Functional requirements

This document distinguishes implemented prototype behavior from planned product requirements. A checked box means verified in the current repository, not production readiness.

## Current prototype

- [x] **F-01 Invoice arithmetic:** validate required invoice fields and line-item arithmetic; flag subtotal and total inconsistencies for human review.
- [x] **F-02 Document intake:** accept one PDF, JPEG, PNG, or WebP file up to 12 MiB and reject unsupported types or mismatched file signatures.
- [x] **F-03 Private local document retrieval:** assign a random ID and require an authenticated tenant match before downloading from local API storage.
- [x] **F-04 Review workspace:** enter, edit, validate, and review persisted invoice fields and line items.
- [x] **F-05 Persistent records:** save document metadata, invoice values, review changes, statuses, and audit events in PostgreSQL transactions.
- [x] **F-06 Core authentication and tenant isolation:** authenticate users and scope invoice/document reads and writes to their organization; invitations, revocation, and abuse controls remain release work.

## Release 1 requirements

### Documents

- **FR-DOC-01:** An authorized user can upload a supported invoice or receipt. Invalid, empty, or oversized files are rejected with a clear error and are not queued for processing.
- **FR-DOC-02:** The system stores original documents in private storage and metadata in PostgreSQL. Responses never expose a filesystem path or accept a caller-supplied storage key.
- **FR-DOC-03:** Authorized users can search, filter, sort, paginate, preview, download, export, and delete documents they are permitted to access.
- **FR-DOC-04:** The system distinguishes invoice, receipt, and unknown document types. Missing values remain missing; they are not silently converted to zero.
- **FR-DOC-05:** Repeated upload requests with the same idempotency key do not create duplicate processing jobs.

### Processing and review

- **FR-PIPE-01:** Processing records explicit upload, OCR, extraction, validation, and review states with timestamps and a correlation ID.
- **FR-PIPE-02:** OCR and extraction providers are replaceable adapters. Provider failure is visible and does not produce success-shaped data.
- **FR-PIPE-03:** Extracted fields retain source evidence (page and source text when available), an extractor/model version, and calibrated confidence where supported.
- **FR-PIPE-04:** Deterministic financial checks produce warnings; they do not claim that a document is authentic or fraud-free.
- **FR-REV-01:** A reviewer can inspect the source document alongside extracted values, correct fields, and see why a field requires attention.
- **FR-REV-02:** Approval is a separate human decision from validation. Corrections and approval decisions are append-only audit events.
- **FR-REV-03:** Concurrent edits are detected; stale writes are rejected rather than overwriting another reviewer's changes.

### Access and reporting

- **FR-AUTH-01:** Roles are enforced in the API, not only hidden in the UI. Owner/admin can manage members; reviewers can review; viewers have read-only access.
- **FR-AUTH-02:** A user cannot enumerate, view, download, edit, approve, or delete another organization's resources.
- **FR-REPORT-01:** Descriptive reporting groups monetary totals by currency. Different currencies are never summed without an explicit, sourced exchange-rate conversion.
- **FR-REPORT-02:** CSV export includes approved records by default and neutralizes formula-leading untrusted values.
- **FR-RET-01:** Deletion and retention behavior is explicit and covers both database metadata and stored objects.

## Out of scope for the first release

Cash-flow prediction, autonomous payment, bank integrations, accounting-system replacement, definitive fraud detection, and public uploads of real financial documents.
