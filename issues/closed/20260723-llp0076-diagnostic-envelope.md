# Preserve stream diagnostics end-to-end through the handler envelope and FFI

**Status:** Resolved (2026-07-24 — landed on the local arm; Workerd residue reassigned, see Resolution)
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

## Resolution (2026-07-24)

Landed on the local arm:

- **Envelope survival:** all nine promised codes (eight
  `SNAPBACK_ACTION_STREAM_*` families + the renamed
  `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED`) are in both the runtime
  (`handler_envelope_code`) and harness (`envelope.mjs` PASSTHROUGH) lists;
  `SNAPBACK_CAPABILITY_UNSUPPORTED` remains a distinct code with its own
  reviewed HTTP status, so admission refusal can never fold into runtime
  `_UNSUPPORTED`.
- **Structured representation, forge-proof:** the host records the last
  stream refusal out-of-band on the invocation context (same pattern as the
  LLP 0056 trusted role denial) and result assembly restores it when the
  surfaced code matches — operation, expected shape, value-free received
  summary, and the guide repair anchor reach the action result through the
  real host-op → FFI → envelope path. Stronger than required: a handler
  throw that merely spells a stream code folds to
  `SNAPBACK_HANDLER_FAILED`, because the settle wrapper trusts only the
  host's `__snapbackCode` brand — both witnessed in
  `tests/action_stream_envelope_v0.rs`, which also executes the
  queries/mutations-cannot-stream acceptance negative.
- **No raw parser text:** the serde `error.to_string()` payloads were
  removed from every stream diagnostic (shape errors now report only the
  static expected/received summary), and the value-free property is
  witnessed (a private URL path never appears in the surfaced diagnostic).
- The rename decision (4) landed with the baseline commit; the retained
  protocol note is amendment v0.4.

Residue, reassigned: the Workerd handler transport still discards structured
details — it rides the unlanded Workerd streaming baseline tracked in the
program index. Per-family HTTP-path shape witnesses beyond INVALID ride the
existing host unit tests and the LLP 0075 instrument's real-path outcome
coverage. `cargo test --lib`: 1138 passed; envelope integration suite 3/3;
instrument PASS 6/6.
