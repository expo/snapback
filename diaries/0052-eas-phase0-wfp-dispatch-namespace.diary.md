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
