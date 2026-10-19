# Test plan

## Commands currently available

Run from the repository root:

```bash
npm test
npm run build
```

The automated suite uses Node's built-in test runner and Supertest. Unit and HTTP tests use synthetic data, an in-memory repository, and temporary directories. PostgreSQL repository integration tests are opt-in locally and run in CI against a disposable PostgreSQL service. OCR provider boundary tests validate request/response handling; invoice candidate extraction tests validate labels, normalization, evidence, unknown fields, and Arabic digits. Real OCR accuracy is not yet evaluated.

## Implemented coverage

| Area | Current verification |
| --- | --- |
| Invoice validation | Valid invoice, arithmetic mismatch, malformed calendar dates, due-date ordering, invalid required fields. |
| File upload | Authentication and role gate, PDF signature acceptance, filename/path sanitization, content/MIME mismatch, unsupported type, missing file. |
| File download | Tenant-scoped metadata lookup before file access, authorized attachment, cross-tenant and unknown ID denial. |
| Authentication | Password hashing/verification, cookie attributes, session signature/tampering, weak registration, duplicate email, invalid login, logout. |
| Invoice workflow | Persistence contract, edit-to-review behavior, duplicate rejection, required decision reason, allowed/denied status transitions, review history. |
| OCR and candidate extraction | Local OCR adapter response validation; labeled English/Arabic invoice candidate fields; evidence/page retention; unknown/ambiguous values remain null. |
| PostgreSQL | Tenant/document/invoice persistence, decimal quantity precision, unique constraint, tenant isolation, edit and status history, duplicate rollback. |
| Type safety/build | API TypeScript build and Vite production build. |

## Release test matrix

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| T-01 | Valid supported invoice payload | Correct deterministic validation response | Implemented |
| T-02 | Inconsistent subtotal or total | `needs_review` with actionable warning | Implemented |
| T-03 | Supported PDF/image with matching signature | Stored with random ID | Implemented for PDF; add image fixtures |
| T-04 | Spoofed MIME or unsupported file | Rejected without storing | Implemented |
| T-05 | Oversized, zero-byte, corrupt, encrypted, or multi-page file | Clear rejection or processing state | Planned |
| T-06 | Same idempotency key submitted twice | One document/job | Planned |
| T-07 | OCR timeout, malformed provider response, or unavailable provider | Explicit bounded failure; no invented fields | Implemented for provider boundary |
| T-08 | Reviewer corrects and approves a field | Updated invoice returns to review and appends a field-change and status event | Implemented |
| T-09 | Concurrent reviewer edits | Stale update rejected | Planned |
| T-10 | User from tenant A requests tenant B object | Denied without revealing object existence | Implemented for invoice history, status, and document download |
| T-11 | Viewer calls write endpoint directly | Denied at API | Implemented for upload; expand matrix to every write route |
| T-12 | CSV cell begins with formula characters | Export neutralizes formula injection | Planned |
| T-13 | Arabic and bilingual invoices | RTL layout and field normalization verified independently | Partial: Arabic labels/digits covered; OCR quality and RTL document layouts remain planned |
| T-14 | Worker restarts during processing | Job recovers or reaches explicit terminal failure | Planned |
| T-15 | Mobile keyboard-only review | Core fields/actions remain reachable and labeled | Planned |

## Running PostgreSQL integration coverage

Apply migrations before running the integration tests. From PowerShell at the repository root:

```powershell
npm --prefix apps/api run db:migrate
$env:RUN_DB_INTEGRATION_TESTS = "1"
npm test
```

The test database must be disposable; integration tests create and remove synthetic tenant records.

## Evaluation discipline

- Use synthetic fixtures until consent, privacy, and retention rules allow real documents.
- Keep development and holdout fixtures separate; do not tune rules on the holdout set.
- Record software/model versions and fixture hashes for reproducibility.
- Measure field exact match, document exact match, review precision/recall, false auto-approval rate, processing time, and cost/resource use.
- Never publish accuracy claims without the dataset definition, sample count, and measured results.
- CI runs PostgreSQL integration tests with an isolated service. Add Playwright journeys for signup, upload, correction, and approval before production release.
