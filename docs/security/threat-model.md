# Security threat model

## Scope and security status

This is a prototype threat register, not a certification or completed security audit. The API now authenticates accounts, enforces role checks, scopes invoices and documents by tenant, and authorizes each file download. Uploads still use local API disk storage, self-service registration is open, and operational abuse controls are incomplete. It is not safe for real financial documents or public upload deployment.

## Assets

- Original financial documents and extracted personal/business data.
- Tenant ownership, user identities, roles, and approval decisions.
- Database credentials, signing keys, storage credentials, and provider secrets.
- Integrity of invoices, review history, and exports.

## Trust boundaries

1. Untrusted browser/client to the HTTP API.
2. Uploaded document bytes and OCR text to parsing/model components.
3. API to PostgreSQL, object storage, queue, and external providers.
4. One organization to another in a shared database and storage layer.
5. User-controlled text to CSV, logs, and operational dashboards.

## Threats and required mitigations

| Threat | Current state | Required control before real data |
| --- | --- | --- |
| Session compromise or account abuse | Signed eight-hour HttpOnly/SameSite=Strict session; password hashes use scrypt. No MFA, session revocation, signup verification, or login rate limiting. | Add verified invitations, rate limits, MFA/step-up for approvals, revocation, and monitoring. |
| Cross-tenant BOLA/IDOR | Tenant is taken from verified session claims; invoice/document queries and downloads include tenant scope; API tests cover cross-tenant reads and writes. | Keep tenant scope mandatory for every new query/route; add authorization regression tests with each feature. |
| Malicious or disguised upload | Type allowlist, size cap, and file signature checks exist; no malware scanning or PDF parser isolation. | Scan and process in isolated worker; reject malformed/encrypted files safely. |
| Path traversal | Storage uses generated UUIDs, not caller filenames. | Keep generated storage keys and add route/path tests. |
| Data exposure at rest/in transit | Local file storage is private to the API process and downloads are authorized; encryption, backups, and TLS deployment are not configured. | Use encrypted private object storage and database, TLS, secret rotation, tested backup/access policies, and retention/deletion rules. |
| Prompt injection in documents | No model pipeline exists. | Treat OCR text as untrusted data; constrain model, schema-validate output, never expose tools/privileges. |
| Secret or document leakage in logs | Current API logs only startup/unhandled error summaries; production redaction is not configured. | Structured redaction tests and no document contents/provider secrets in logs. |
| CSV formula injection | No export endpoint exists. | Neutralize formula-leading user-controlled cells and test generated CSV. |
| Resource exhaustion | Upload cap is 12 MiB per file; registration/login rate, per-tenant storage, page count, and concurrency are not controlled. | Add API and signup rate limits, page limits, job quotas, timeouts, and bounded retries. |
| Dependency compromise/vulnerability | Production audit currently clean; development-tool audit is being tracked. | Lock dependencies, audit in CI, review updates and pin trusted CI actions. |

## Release blockers

- Do not deploy the current upload route as a public document service.
- Do not accept sensitive documents until account abuse controls, private object storage, malware scanning, TLS, backups, and deletion/retention behavior are implemented and tested.
- Do not let model output select a tenant, user, role, approval, or arbitrary action.
- Make all object-level access checks server-side; UUID opacity is not authorization.
- The local Compose database credentials and example session secret are for development only; replace them before any hosted use.
