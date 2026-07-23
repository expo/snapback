# Preserve stream diagnostics end-to-end through the handler envelope and FFI

**Status:** Open
**Severity:** P2
**Systems:** Actions, Runtime, Diagnostics, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Diagnostics + Evidence-status gaps, src/runtime.rs (envelope allowlist), packages/snapback-harness/envelope.mjs (passthrough set), packages/snapback-harness/workerd/handler-server.mjs (detail discard), issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, diagnostics

`SNAPBACK_ACTION_STREAM_UNSUPPORTED` and `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED`
are absent from both handler-envelope allowlists and fold to
`SNAPBACK_HANDLER_FAILED`; the Workerd handler transport discards structured
diagnostic details; the Rust invalid-shape diagnostic retains raw `serde` text,
which can leak rejected input into a supposedly value-free default diagnostic.

**Done when:**

- All promised stream codes survive both the runtime and harness envelopes;
  capability-admission refusal (`SNAPBACK_CAPABILITY_UNSUPPORTED`) stays distinct
  from runtime `_UNSUPPORTED`.
- One structured diagnostic representation carries operation, limit, safe
  received summary, and repair anchor through host op → FFI → handler envelope →
  action result, without permitting handler-forged codes and without raw parser
  text.
- Exact-code and diagnostic-shape witnesses through the real action path for
  every family; the diagnostic-envelope gap row moves to closed.
- Decide the `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` rename (see the
  semantics-decisions ticket) before the code is load-bearing in retained
  receipts.
