# OCR and extraction evaluation plan

## Status

There is no OCR engine, AI model, extraction prompt, or AI evaluation result in the current prototype. The `/api/invoices/parse` route validates fields supplied by a caller; it does not parse an uploaded file. Do not interpret the UI's deterministic validation confidence as OCR or extraction accuracy.

## Dataset policy

1. Create a development set of synthetic English and Arabic invoices/receipts with manually authored ground truth.
2. Hold out a separate synthetic test set that is not used to tune prompts, rules, or thresholds.
3. Add real documents only with documented permission, privacy review, retention limits, and access controls.
4. Never put customer files, OCR text, provider responses, or API keys in Git, public fixtures, telemetry, or CI logs.

## Required fixture groups

- Clear single-page invoices and receipts.
- Missing/ambiguous invoice number, date, tax, currency, or total.
- Multiple line items, discounts, fees, tax, and rounding.
- English, Arabic, and bilingual documents, including Arabic-Indic digits and RTL layout.
- Low-resolution, rotated, cropped, skewed, and low-contrast images.
- Multi-page documents, duplicate files with different names, and non-financial documents.
- Adversarial document text that attempts prompt injection.
- Provider timeout, rate limit, invalid JSON/schema, and transient server failures.

## Metrics

- Field exact match after documented normalization, reported separately for each field and language.
- Document exact match for required fields.
- Review-detection precision and recall; false auto-approval rate is a release-blocking safety metric.
- Processing latency and failure rate by page count and document type.
- Cost per successful document or local CPU/memory/time per document.

## Acceptance rules

- The model output is untrusted. Validate it against a versioned schema before storing it.
- Keep unknown values null; do not fabricate values or coerce missing amounts to zero.
- Every extracted value should carry page/source evidence where available.
- Confidence is provider-specific and must be calibrated; do not use an arbitrary threshold.
- A financial consistency check is not proof of authenticity or fraud detection.
- Record model/OCR version and prompt/config hash for each evaluation run.

## Provider decision

Select local OCR versus a hosted service only after comparing representative licensed fixtures for English and Arabic, accuracy, latency, hardware requirements, data retention, deployment limits, and operational cost. A provider API key or OCR runtime is an explicit external dependency for this milestone; none is configured in the current repository.
