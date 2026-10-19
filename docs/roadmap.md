# Delivery roadmap and GitHub issue backlog

The current code is a prototype, not a public financial-document service. PostgreSQL migrations, session authentication, core role/tenant enforcement, invoice/document persistence, and review transitions are implemented. The milestones below remain the complete release backlog; partial completion does not remove their remaining acceptance criteria. Do not enable a public upload demo until the security release blockers are closed.

## Implementation status

- **Implemented foundation:** PostgreSQL persistence and migrations; signed HttpOnly sessions; admin/reviewer/viewer roles; tenant-scoped invoice/document routes and downloads; file signature/size checks; invoice validation, editing, status changes, and review/audit events; unit, HTTP, and opt-in PostgreSQL tests.
- **Still required for the P0 security/data milestone:** invitations or email verification, signup/login rate limits, paginated/filterable list APIs, private object storage, malware scanning, deletion/retention rules, and full role/object authorization matrix.
- **Implemented partial:** local Tesseract OCR service (English/Arabic), tenant-authorized API processing, persisted page/word evidence, and UI review. Conservative label-based rules suggest common English/Arabic invoice header fields with source snippets/page numbers; line items are not inferred. This is not AI and is not accuracy-evaluated.
- **Still required:** high-quality replaceable extraction providers/evaluation, durable asynchronous processing, operational reporting, and deployment.

## Milestone 1 — Persisted and protected document foundation

### [P0] Add authentication, roles, and tenant isolation — core implemented

**Issue:** Implement organization-scoped authentication and authorization.

**Acceptance criteria**

- API identifies the user and organization from a verified session/token; request bodies cannot override either.
- Admin, reviewer, and viewer permissions are enforced server-side.
- Cross-tenant read, download, edit, and delete attempts return a non-enumerating denial.
- Automated tests cover every role and BOLA/IDOR cases.

### [P0] Persist uploaded documents and invoices — core implemented

**Issue:** Connect document and invoice routes to PostgreSQL with migrations.

**Acceptance criteria**

- Database migrations create tenant-scoped documents, invoice versions, line items, and audit events.
- Metadata and storage key are written transactionally or through a recoverable outbox.
- List/detail routes are paginated, filtered, and tenant-scoped.
- Integration tests use isolated PostgreSQL and verify rollback, constraints, and tenant access.

### [P0] Replace local upload storage with private object storage

**Issue:** Implement private file storage, scanning, and retention.

**Acceptance criteria**

- No public object URLs; API authorizes every preview/download.
- File size, page count, signature, malware scan, and retention policy are enforced.
- Delete removes both metadata and object according to the documented policy.
- Tests cover malicious/mismatched files, failure cleanup, and unauthorized download.

## Milestone 2 — Processing pipeline and review

### [P1] Add durable asynchronous processing

**Issue:** Implement a durable document-processing queue and worker lifecycle.

**Acceptance criteria**

- Processing states and timestamps cover upload, OCR, extraction, validation, and review.
- Idempotency keys prevent duplicate jobs; retries are bounded and use backoff with jitter.
- Worker restart recovers or explicitly fails in-flight jobs; terminal failures are visible.
- Tests cover duplicate delivery, timeouts, retries, and restart recovery.

### [P1] Evaluate and improve local OCR

**Issue:** Evaluate the Tesseract adapter on licensed English/Arabic fixtures and improve it against the measured baseline.

**Acceptance criteria**

- A reproducible holdout dataset and baseline results exist before model selection.
- English, Arabic, bilingual, low-quality, table, and multi-page fixtures are evaluated.
- Provider versions and source-page evidence are retained; no unmeasured accuracy claims are published.
- Runtime, memory, latency, and cost/resource use are reported.

### [P1] Add structured extraction and financial validation contract

**Issue:** Add provider-independent, evidence-carrying invoice/receipt extraction.

**Acceptance criteria**

- Versioned schema distinguishes invoice, receipt, and unknown; missing values remain null.
- Every supported field has evidence/source page where available and a documented confidence policy.
- Deterministic validation does not imply authenticity, fraud detection, or human approval.
- Prompt injection fixtures cannot alter tenant, role, approval, or tool permissions.

**Status:** Initial schema-versioned, evidence-linked label extraction is implemented for invoice number, supplier, dates, currency, subtotal, tax, and total. It never auto-creates or approves invoices; robust extraction, line items, confidence calibration, and holdout evaluation remain open.

### [P1] Build source-linked human review and audit history

**Issue:** Add document preview, field evidence, review, approval, and correction history.

**Acceptance criteria**

- Source document and extracted fields are shown side by side.
- Review states distinguish extracted, needs_review, edited, validated, missing, invalid, and approved.
- Validation and approval are separate; approval/corrections are versioned audit events.
- Concurrent edits are detected; keyboard and screen-reader use is tested.

## Milestone 3 — Quality, reporting, and deployment

### [P2] Add safe search, CSV export, duplicate hints, and analytics

**Issue:** Add tenant-scoped document operations and descriptive reporting.

**Acceptance criteria**

- Search/filter/sort/pagination work server-side and preserve query state.
- Export defaults to approved rows and neutralizes CSV formula injection.
- Monetary summaries are partitioned by currency; no undocumented currency conversion occurs.
- Duplicate detection produces a review hint and never deletes automatically.

### [P2] Build the quality evaluation harness

**Issue:** Measure OCR/extraction regressions on fixed synthetic holdout data.

**Acceptance criteria**

- Report field exact match, document exact match, review precision/recall, false auto-approval rate, latency, and cost.
- English/Arabic results are separated; dataset split and tool/model versions are recorded.
- CI fails on configured regression thresholds and does not expose real documents.

### [P2] Add GitHub Actions CI and security checks

**Issue:** Expand CI with linting, type checks, tests, dependency review, and secret scanning.

**Acceptance criteria**

- Pull requests run tests and production builds for API/web.
- PostgreSQL integration tests use disposable CI service data.
- Dependency and secret checks are visible; no deployment credential is stored in repository files.
- Protected `main` requires passing checks.

### [P2] Deploy a gated preview and production smoke tests

**Issue:** Deploy a preview only after auth, storage, and abuse controls are complete.

**Acceptance criteria**

- Provider limits, storage, database, backups, logs, and privacy terms are documented.
- Public demo uses synthetic data and restricts uploads; no real financial data is included.
- Post-deployment smoke checks cover health, authentication, upload, authorization, and job status.
- Rollback and incident procedures are documented and exercised.

## QA backlog

The detailed acceptance matrix is in [`docs/testing/test-plan.md`](testing/test-plan.md). OCR/provider evaluation is in [`docs/ai/evaluation.md`](ai/evaluation.md); security blockers are in [`docs/security/threat-model.md`](security/threat-model.md).
