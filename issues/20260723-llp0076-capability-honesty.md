# Capability-manifest honesty and admission against the served instance manifest

**Status:** Open
**Severity:** P2
**Systems:** Actions, Runtime, Code generation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Target contract + Evidence-status gaps, LLP 0058 (positive support = compatibility assertion), LLP 0074 (no positive capability for a Draft authority without conformance), src/manifest.rs (bounded_response_stream_v1, buffered-bytes Enforced), src/local.rs (dev loader, complete-pair preflight), issues/20260723-llp0076-boundedness.md, issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, capability

`bounded_response_stream_v1` is published as a positive `supportedCapabilities`
entry while the pattern's terminal/throttle/retry guarantees are not
host-enforced — which LLP 0058 reads as present support and LLP 0074 forbids for
a Draft authority without executable conformance. The manifest marks
buffered-bytes `Enforced` with no counter, omits the read-size and cursor rows,
and the Cloudflare runtime fact claims idle/wall/progress/watchdog/settlement
evidence its witness does not earn. Admission is also inconsistent: the raw dev
loader installs a stream-requiring artifact without resolving
`require_capabilities`, while complete-pair preflight checks a static manifest
instead of the served instance.

**Done when:**

- Until full conformance, the capability carries a proposed/experimental maturity
  admission cannot treat as support (or is split into a raw-reader capability
  plus a durable-streamed-action capability); unproved limit rows read `Missing`;
  the Cloudflare manifest claims only what its witness earns.
- Every loader resolves the requirement against the same served instance manifest
  before any handler/nested-mutation code runs; an outbound-disabled negative
  admission witness lands; codegen inference is AST-derived or explicit rather
  than a textual `fetchStream(` match.
- The capability-overclaim and admission gap rows move to closed.
