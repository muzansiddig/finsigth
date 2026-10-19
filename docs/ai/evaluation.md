# OCR and extraction evaluation plan

## Status

The prototype has local English/Arabic Tesseract OCR plus a schema-versioned, label-based rule extractor for common invoice header fields. It is not an AI model, has not been accuracy-evaluated, and does not extract line items. The `/api/invoices/parse` route still validates fields supplied by a caller; it does not parse an uploaded file. Candidate confidence is a fixed label-match heuristic, not calibrated extraction confidence. Do not interpret it or the UI's deterministic validation confidence as accuracy.

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
- Every extracted value should carry page/source evidence where available. The current rule extractor stores the matched OCR line and page.
- Confidence is provider-specific and must be calibrated; the current `0.85` rule-match score is not calibrated and must not drive automated decisions.
- A financial consistency check is not proof of authenticity or fraud detection.
- Record model/OCR version and prompt/config hash for each evaluation run.

## Provider decision

Select an AI extraction provider only after comparing representative licensed fixtures for English and Arabic, accuracy, latency, hardware requirements, data retention, deployment limits, and operational cost. The current OCR and rule-based candidate extraction run locally and need no hosted provider credential.
