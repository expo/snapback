# Received HTTP and CLI lifecycle review

Reviewer: Codex gpt-5.6-sol, xhigh, client lane; 2026-09-13.
Inspected: `353e170f3` against `cca6a2d0b`, HTTP host, assets, activation, CLI and vendored tiny_http changes. Static read-only review; no tests or probes. The lead transcribes the received finding below.

**Major — a truncated checked response leaves the connection reusable.** If an asset file becomes shorter than the database length, `ExactReader` returns `UnexpectedEof` after headers advertised the original Content-Length. `respond_checked` propagates the error, but dropping `SequentialWriter` merely signals the next queued writer. On a persistent/pipelined connection, a following response may be written after the truncated body and consumed as its missing bytes. The checked-response error path must make that connection non-reusable. The host lane will validate the mechanics and add a persistent-connection regression; the reviewer did not implement its finding.

No other material finding in the inspected scope: 204 framing suppression; poison recovery; advisory deploy/serve lock lifetime; per-asset/principal serialization and consumption after exact successful transfer; detached reader transactions. This scoped review does not complete the earlier broad partition/meter review.

## Received correction review

The independent client lane re-reviewed `f1581591c37de99bcca4974546acfb1bd6b6104b` against its actual first parent `a2f09cec54d52bd68b95b36fd7e7eba1f382e705` and returned **READY — no material finding remains in this correction delta**. Static only; no tests rerun. The reviewer inspected client.rs, request.rs, util/mod.rs, refined_tcp_stream.rs, sequential.rs and http-bounds.test.mjs. Invalidating the shared writer chain and shutting down the stream happens before releasing the next queued writer; queued writers check the abort bit before writes/flushes. The regression covers EOF below the advertised length, suppression of a queued response, non-consumption of the failed one-view transfer, then a complete successful fetch followed by the viewed refusal. The original handwritten parent attribution was corrected against git output before this record was retained.
