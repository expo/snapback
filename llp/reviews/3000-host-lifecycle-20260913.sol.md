# Received HTTP and CLI lifecycle review

Reviewer: Codex gpt-5.6-sol, xhigh, client lane; 2026-09-13.
Inspected: `353e170f3` against `cca6a2d0b`, HTTP host, assets, activation, CLI and vendored tiny_http changes. Static read-only review; no tests or probes. The lead transcribes the received finding below.

**Major — a truncated checked response leaves the connection reusable.** If an asset file becomes shorter than the database length, `ExactReader` returns `UnexpectedEof` after headers advertised the original Content-Length. `respond_checked` propagates the error, but dropping `SequentialWriter` merely signals the next queued writer. On a persistent/pipelined connection, a following response may be written after the truncated body and consumed as its missing bytes. The checked-response error path must make that connection non-reusable. The host lane will validate the mechanics and add a persistent-connection regression; the reviewer did not implement its finding.

No other material finding in the inspected scope: 204 framing suppression; poison recovery; advisory deploy/serve lock lifetime; per-asset/principal serialization and consumption after exact successful transfer; detached reader transactions. This scoped review does not complete the earlier broad partition/meter review.
