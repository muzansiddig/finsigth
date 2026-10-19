# Non-functional requirements

These are requirements and proposed acceptance targets, not claims of measured production performance. Core session authentication and tenant-scoped routes exist, but the current prototype still lacks a production storage/operations posture and must not be used with real customer documents.

| Area | Requirement | Acceptance evidence |
| --- | --- | --- |
| Security | Enforce authentication, role checks, and tenant-scoped access server-side. | API tests cover each role and cross-tenant access. |
| Privacy | Do not use customer documents in public demos or logs; define retention and deletion. | Threat model, storage policy, and deletion integration tests. |
| Integrity | Preserve extraction versions, corrections, approvals, and audit history. | Database transaction and review-history tests. |
| Reliability | Processing work survives API/worker restarts and has bounded retries. | Worker recovery and idempotency integration tests. |
| Performance | Target P95 <= 500 ms for ordinary, non-upload API requests in a defined test environment. | Reproducible load test report with environment and dataset. |
| Upload | Stream or strictly cap file sizes; never wait for OCR in the upload request. | Size-boundary tests and separate asynchronous job lifecycle. |
| Accessibility | Target WCAG 2.2 AA for core review flows. | Keyboard, screen-reader, contrast, and automated accessibility checks. |
| Localization | Support LTR and RTL without corrupting amounts, currencies, dates, or identifiers. | English/Arabic UI and document fixtures with explicit locale rules. |
| Observability | Correlate processing stages without logging document contents or secrets. | Structured logs and redaction tests. |
| Recoverability | Recover or explicitly fail interrupted processing; users can retry eligible jobs. | Restart/failure-injection tests. |
| Cost | Measure local resource use or provider cost per processed document. | Evaluation report with sample size and tool versions. |

## Prototype limits

- The upload API stores files on the API server's local disk; no malware scanner, page limit, storage quota, retention policy, or object-storage provider is configured.
- Session registration is open and lacks email verification, invitation flow, MFA, and signup/login rate limiting.
- PostgreSQL records are persistent, but list routes do not yet provide server-side pagination or filtering.
- Local OCR and evidence-linked rule-based header candidate extraction are implemented synchronously. Durable background processing, malware scanning, and evaluated AI extraction remain unimplemented.
