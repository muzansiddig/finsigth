# ADR 0001: Start with a modular monolith and provider boundaries

- Status: Accepted for prototype and first release
- Date: 2026-10-19

## Context

FinSight is an early-stage document-review product. It needs clear separation between upload, extraction, deterministic validation, review, and persistence, but there is no demonstrated scale that justifies a distributed microservice architecture.

## Decision

- Keep the API as a modular monolith.
- Isolate OCR and structured extraction behind replaceable interfaces.
- Move slow document processing to a durable worker/queue when processing is introduced.
- Keep deterministic financial rules and human approval independent from model output.

## Consequences

- The first release is simpler to deploy and test.
- Domain boundaries must remain explicit so a worker can be separated later without changing the data contract.
- PostgreSQL, private object storage, tenant authorization, durable processing, and operational monitoring are release prerequisites for real documents.
- Current local upload endpoints are prototype-only and must not be mistaken for this target architecture.
