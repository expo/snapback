# Diary 0052 — EAS Phase 0 real Workers for Platforms namespace spike

**Demo:** `demos/eas-phase0/spikes/p0.1-wfp-dispatch-namespace.mjs`
**Agent:** Codex
**Date:** 2026-08-03

## What I built

The P0.1 runner creates one disposable untrusted dispatch namespace, three
ordinary control-plane Workers, and eight generated user Workers: two apps ×
two releases × handler/action. Every user Worker receives exactly one binding,
the internal `HOST` service. The dispatcher mints HMAC-bound capabilities with
environment, release, operation, request, object, and deadline identity; the
host verifies that scope before touching app-partitioned Durable Object state.

The retained run exercises host queries and mutations, release-shared/app-
isolated state, idempotent retry, argument-scope rejection, stale and tampered
capabilities, handler egress denial, action allowlisting, role independence,
queue/concurrency admission, response bounds, and Cloudflare's native CPU and
subrequest options. It records the multipart request, upload-response omission,
and authoritative bindings-endpoint response for every generated Worker.

## What felt good

The WfP topology is a strong fit for Snapback's intended boundary. Generated
Workers can be genuinely tiny and untrusted while the host owns identity,
storage, retry, and policy. Two apps and two releases made the capability and
data-isolation assertions concrete rather than architectural prose. The
outbound Worker also made handler denial and action allowlisting visible without
putting secrets or policy tables into user code.

Cleanup became reliable once ordinary Workers containing Durable Object classes
used the API's forced-delete option. The runner refuses to reuse an existing
namespace or Worker, uses per-run ordinary Worker names, deletes in dependency
order, and leaves a receipt even on failure. A separate read-only verification
confirmed every final resource was absent.

## What felt hard

The direct API surface has several wire-level details that higher-level tooling
normally hides. Durable Object migrations use the API object envelope rather
than Wrangler's array shape. Namespace upload responses omitted `bindings`, so
the dedicated bindings endpoint had to be treated as authoritative while still
retaining the exact empty upload field. Rapid Workers.dev activation was
inconsistent under concurrent probes, even with unique script names.

The largest surprise was substantive: Cloudflare accepted the documented
per-dispatch `{ cpuMs: 20, subRequests: 5 }` object but did not enforce either
ceiling. Earlier versions of the probe accidentally hid that fact by dispatching
from inside the admission Durable Object and by letting the host deadline kill
an infinite CPU loop. Moving dispatch back to the top-level Worker, using real
allowlisted network fetches, and replacing the frozen-clock loop with a fixed
iteration burn produced the decisive failure: both probes returned 200.

## Compared honestly

Compared with a conventional Node container sandbox, WfP removes process
supervision, patching, and tenant code packaging, and its dispatch namespace plus
outbound Worker model is much closer to the desired least-authority shape.
Containers would make CPU and network accounting more explicit, though; a
silently ignored per-invocation limit is worse than a visibly missing feature.

Compared with the local workerd twin, the real run exposed exactly why both
evidence legs matter. The twin is fast and deterministic for capability and host
protocol tests, but it could not reveal account entitlement, multipart response
normalization, Workers.dev propagation, forced Durable Object deletion, or the
native custom-limit failure.

## Verdict

The host-bridge and isolation architecture is promising, and 21 of 23 checks
passed with exact binding evidence and complete cleanup. P0.1 is still a hard
FAIL because CPU and subrequest ceilings are security obligations. The result
narrows the next work substantially: reproduce the two ignored options in
Cloudflare's minimal example, determine whether this is account capability or a
platform regression, and rerun before qualifying Gate 0.

## 2026-08-04 — minimal control and corrected topology

The replacement-token rerun first reproduced the original 21/23 result, which
was useful because it ruled credentials out cleanly. I then built the smallest
official-shape control: one binding-free user Worker, one dispatcher, and no
HOST or outbound Worker. That control changed the diagnosis. Native subrequest
enforcement failed all three twelve-fetch attempts at five, and a deliberately
large finite CPU burn was terminated on its second attempt. The account feature
worked; the old witnesses and the combined outbound option shape did not.

CPU limits were the subtler lesson. Cloudflare documents isolate flexibility
for occasional overages, and the first 200-million-iteration burn returned 200
after about 926 ms. The second was terminated. Treating one short burn as an
exact 20 ms stopwatch had been the wrong test; the useful contract is observed
native termination under repeated sustained abuse, with every attempt retained.

The outbound interaction required a topology change rather than an assertion
change. Handler invocations now use a dispatch binding without an outbound
Worker and retain native CPU enforcement. Action invocations use the outbound
allowlist plus a generated fail-closed subrequest guard. This keeps the layers
honest: the receipt does not pretend the minimal native subrequest result was
observed through the outbound path. A focused follow-up ticket keeps the action
kill-domain question open.

Workers.dev activation was slow but convergent. The first minimal run needed 49
eight-way rounds and saw 181 generated 404s. A pre-commit full run needed 80
rounds and saw 141 404s plus one 500 before three consecutive clean rounds.
Unique URLs showed this was not just one poisoned cache key. Waiting for one
successful health response was too weak; a bounded, consecutive concurrent
barrier made the disposable run deterministic while leaving production ingress
to P0.2.

The corrected full run passed 23/23. The action guard stopped the sixth
subrequest with `SNAPBACK_SUBREQUEST_LIMIT`; the calibrated handler CPU witness
was natively terminated on attempt three. Both the minimal and full runners
deleted their resources and independently observed HTTP 404 for every exact
post-cleanup lookup.

Compared with Wrangler-driven everyday deployment, the raw API runner remains
verbose, but the verbosity paid for itself here: control-plane acknowledgement,
DNS families, Ray IDs, cache headers, dispatch option composition, and cleanup
were all visible in one reproducible artifact. Compared with a container kill
domain, Cloudflare's CPU flexibility is less stopwatch-like, so the capability
report must describe the measured semantics rather than imply a strict elapsed
cutoff.

The clean-SHA evidence rerun was slower again: the first 60-round minimal cap
failed closed (and cleaned up), so I corrected the promised maximum to 90. The
passing rerun converged at round 77 after 276 generated 404s; all three
subrequest probes failed natively, and CPU termination arrived on attempt four.
That variance reinforces why the receipts retain every attempt and why the
readiness protocol is bounded by a conservative ceiling rather than a typical
round count. The final clean full run converged at round 81 after 312 HTTP 404s;
all 23 checks passed, native CPU terminated on attempt three, and four exact
post-delete API lookups returned 404.
