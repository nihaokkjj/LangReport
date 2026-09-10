---
status: accepted
---

# Keep the M1-A Bailian baseline as native HTTP behind Model Gateway

## Context

LangReport first needs one auditable `chart-plan` call to Bailian Qwen's OpenAI-compatible Chat Completions endpoint. The adapter must freeze a non-secret route before queueing, select either JSON Schema or JSON Object explicitly, disable thinking for structured output, propagate cancellation, and preserve provider request IDs, usage, finish reasons, and normalized failures. Generation Worker leases protect database commits but cannot make an external model request exactly-once.

## Decision

- `@langreport/model-gateway` uses native `fetch` for Bailian M1-A. It is the only package that knows Bailian request and response fields.
- API saves a non-secret Model Route Snapshot in the Generation Job and hashes its stable route ID into the input fingerprint. Worker binds that snapshot to `BAILIAN_API_KEY`, which exists only in the Worker environment.
- The adapter makes one non-streaming `POST /chat/completions` attempt, uses `max_completion_tokens`, sends `enable_thinking=false`, and explicitly chooses `json_schema` or `json_object`. It records a bounded Model Invocation summary in Generation Audit.
- No HTTP retry, provider fallback, LangChain, LangGraph, raw prompt/response persistence, or hidden reasoning persistence is included in M1-A. Local plan and render validation remain authoritative.

## Alternatives considered

- OpenAI SDK: viable later, but does not reduce the first adapter's need to inspect every provider-specific field and retry behavior.
- LangChain `ChatOpenAI`: may be used internally after a locked-version comparison proves it retains the required Bailian fields and does not add retries or protocol selection. It is not a business-layer dependency.
- Direct provider logic in Generation Worker: rejected because it would duplicate policy and auditing concerns for every future provider.

## Consequences

The M1-A adapter owns a small amount of explicit HTTP and error-mapping code, with focused mock-transport tests. Jobs queued under a route retain that route even when environment configuration changes. A process crash after a network request and before audit commit may still cause an unknown/duplicate external call on recovery; fencing and unique Revision/Evidence constraints continue to protect only local business state. Real account validation remains a separate, explicitly authorized step because it may transmit permitted context and incur cost.
