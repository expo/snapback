# Capability-manifest honesty and admission against the served instance manifest

**Status:** Open — narrowed to a SINGLE author-decision residue
(2026-07-24). Everything implementable without an author decision has
landed: local served-instance admission in every loader with negative and
positive witnesses (commit 065484e6); AST-derived codegen inference; honest
manifests on both targets; and the Workerd admission leg (this commit) —
this target is deploy-time compiled, so function resolution is its loader
seam (`/app/ensure` only hash-gates posted artifacts and never installs
them), and `functionByName` now refuses any known registry id the served
manifest does not support with a typed 503
`SNAPBACK_CAPABILITY_UNSUPPORTED` before the handler runs, witnessed
positively (the five stream probes declare `bounded_response_stream_v1` and
run) and negatively (`probeUnsupportedRequirement` declares
`auth.sessions.v1` and is refused) in the 28/28 Miniflare egress
acceptance. REMAINING — and deliberately NOT decided here: whether the
capability registry gains an explicit proposed/experimental maturity marker
while LLP 0076 is Draft. That is an LLP 0058 registry-semantics schema
design that belongs to the author (Charlie); until he decides, the
instance-live predicate plus the per-bullet witnesses are the honesty
mechanism (LLP 0076 ledger, "Positive capability overclaim" row). This
ticket stays open solely as the tracking handle for that decision.
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
