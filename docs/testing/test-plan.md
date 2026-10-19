# Test plan

## Commands currently available

Run from the repository root:

```bash
npm test
npm run build
```

The current automated suite uses Node's built-in test runner and Supertest. It covers deterministic invoice validation and HTTP upload/download behavior. Tests use synthetic data and temporary directories; they do not connect to PostgreSQL or an OCR provider.

## Implemented coverage

| Area | Current verification |
| --- | --- |
| Invoice validation | Valid invoice, arithmetic mismatch, invalid required fields. |
| File upload | PDF signature acceptance, content/MIME mismatch rejection, unsupported type rejection, missing file response. |
| File download | Generated ID, attachment response, unknown ID response. |
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
| T-07 | OCR timeout, malformed provider response, or unavailable provider | Explicit bounded failure; no invented fields | Planned |
| T-08 | Reviewer corrects and approves a field | Versioned correction and audit event | Planned |
| T-09 | Concurrent reviewer edits | Stale update rejected | Planned |
| T-10 | User from tenant A requests tenant B object | Denied without revealing object existence | Planned |
| T-11 | Viewer calls write endpoint directly | Denied at API | Planned |
| T-12 | CSV cell begins with formula characters | Export neutralizes formula injection | Planned |
| T-13 | Arabic and bilingual invoices | RTL layout and field normalization verified independently | Planned |
| T-14 | Worker restarts during processing | Job recovers or reaches explicit terminal failure | Planned |
| T-15 | Mobile keyboard-only review | Core fields/actions remain reachable and labeled | Planned |

## Evaluation discipline

- Use synthetic fixtures until consent, privacy, and retention rules allow real documents.
- Keep development and holdout fixtures separate; do not tune rules on the holdout set.
- Record software/model versions and fixture hashes for reproducibility.
- Measure field exact match, document exact match, review precision/recall, false auto-approval rate, processing time, and cost/resource use.
- Never publish accuracy claims without the dataset definition, sample count, and measured results.
- Add API integration tests with an isolated PostgreSQL service only when persistence is connected; add Playwright journeys after the UI uses persistent API records.
