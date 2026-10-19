# Security threat model

## Scope and security status

This is a prototype threat register, not a certification or completed security audit. The current upload endpoint has no authentication or tenant authorization, stores files on local disk, and allows retrieval by document ID. It is not safe for real financial documents or public upload deployment.

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
| Unauthenticated document access | Present: prototype upload/download routes are unauthenticated. | Add authentication and authorization; deny by default. |
| Cross-tenant BOLA/IDOR | Tenant schema scaffold only; routes are not tenant-scoped. | Resolve tenant from authenticated membership, never request body; test cross-tenant read/write/download. |
| Malicious or disguised upload | Type allowlist, size cap, and file signature checks exist; no malware scanning or PDF parser isolation. | Scan and process in isolated worker; reject malformed/encrypted files safely. |
| Path traversal | Storage uses generated UUIDs, not caller filenames. | Keep generated storage keys and add route/path tests. |
| Data exposure at rest/in transit | Local prototype storage; deployment encryption not configured. | TLS, encrypted private storage, secret rotation, and tested access policies. |
| Prompt injection in documents | No model pipeline exists. | Treat OCR text as untrusted data; constrain model, schema-validate output, never expose tools/privileges. |
| Secret or document leakage in logs | Current API logs only startup/unhandled error summaries; production redaction is not configured. | Structured redaction tests and no document contents/provider secrets in logs. |
| CSV formula injection | No export endpoint exists. | Neutralize formula-leading user-controlled cells and test generated CSV. |
| Resource exhaustion | Upload cap is 12 MiB per file; concurrency and page count are not controlled. | Rate limits, page limits, job quotas, timeouts, and bounded retries. |
| Dependency compromise/vulnerability | Production audit currently clean; development-tool audit is being tracked. | Lock dependencies, audit in CI, review updates and pin trusted CI actions. |

## Release blockers

- Do not deploy the current upload route as a public document service.
- Do not accept sensitive documents until auth, tenant isolation, private object storage, and deletion/retention behavior are tested.
- Do not let model output select a tenant, user, role, approval, or arbitrary action.
- Make all object-level access checks server-side; UUID opacity is not authorization.
