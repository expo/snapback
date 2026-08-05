# EAS Phase 0: WfP per-dispatch CPU and subrequest limits appeared unenforced

**Status:** CLOSED — resolved 2026-08-04 by a minimal control and split
handler/action dispatch topology

## Original observation

The first retained P0.1 run used Cloudflare's documented dynamic-dispatch
shape:

```js
env.DISPATCHER.get(scriptName, {}, {
  limits: { cpuMs: 20, subRequests: 5 },
  outbound: { DISPATCH_CONTEXT: context },
});
```

Cloudflare accepted the upload, but a short CPU burn and twelve allowlisted
fetches both returned 200. The run otherwise proved an untrusted namespace and
the exact `HOST`-only binding envelope on all eight user Workers.

## Diagnosis

`demos/eas-phase0/spikes/p0.1-wfp-minimal-control.mjs` now reproduces
Cloudflare's smallest documented topology on the same account: one binding-free
user Worker, one dispatcher, no host binding, and no outbound Worker. Its
retained receipt proves that the account capability works:

- all three twelve-fetch attempts failed at the configured five-subrequest
  ceiling with Cloudflare's `Too many subrequests` exception;
- a calibrated finite CPU burn was natively terminated after repeated attempts
  with `Worker exceeded CPU time limit.`

The first successful CPU attempt matches Cloudflare's documented isolate
flexibility for occasional CPU overages. A single short burn was therefore not
a valid CPU-enforcement witness.

The original combined options also hid an important topology boundary. When a
dispatch binding is configured with an outbound Worker, outbound parameters are
required; when they are supplied on this account, the same call did not exhibit
the native custom-limit behavior proved by the minimal control. That is not an
account entitlement or token problem.

## Resolution

The real P0.1 runner now uses two dispatch bindings to the same namespace:

- handlers use a binding without an outbound Worker, so the native CPU boundary
  remains effective;
- actions use a binding with the outbound allowlist and a generated-harness
  subrequest counter that returns the stable `SNAPBACK_SUBREQUEST_LIMIT`
  diagnostic before the sixth outbound handoff.

The trusted `worker.mjs` harness freezes ambient `globalThis.fetch` and only
then dynamically evaluates a separate `application.mjs`. Application code
never shares the harness's native-fetch closure, `env`, or raw `HOST` binding;
it receives a frozen invocation-scoped context. Handler operations exercise and
deny lexical `fetch`, explicit `globalThis.fetch`, and fetch captured when the
application module evaluates. Actions prove the same ambient denials and that
outbound access succeeds only through `ctx.fetch`, whose closure owns the
subrequest counter. Trusted setup revokes each `ctx.fetch` after application
settlement; a live later-request attack retains old handles in application
module state and requires `SNAPBACK_STALE_ACTION_FETCH` before the limit check
can pass. The trusted entry is also bound to the isolate's real `env.HOST`
service-binding identity; an application-module re-entry with a forged env must
return `SNAPBACK_TRUSTED_ENTRY_REQUIRED` rather than mint another counter.
The CPU witness uses a 200,000,000-iteration finite burn, records up to five
attempts, and requires an actual Cloudflare termination instead of inferring
CPU time from client wall time.

The corrected disposable run retained at
`demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json` passed all 23
checks. The native CPU witness terminated on attempt three; the action
subrequest witness returned HTTP 429 with `SNAPBACK_SUBREQUEST_LIMIT` at limit
five, the retained-handle attack returned `SNAPBACK_STALE_ACTION_FETCH`, trusted
entry re-entry returned `SNAPBACK_TRUSTED_ENTRY_REQUIRED`, and the action
ambient-global-fetch attack returned HTTP 403. The separate
minimal-control receipt preserves the native subrequest proof without the
outbound accounting boundary.

## Follow-up boundary

`issues/20260804-eas-phase0-wfp-outbound-custom-limit-interaction.md` tracks the
narrow remaining provider/topology question. The hosted capability profile
must not claim that outbound action invocations inherit native custom-limit
semantics until that interaction and the selected action kill domain are
qualified.

## Cleanup

Both the minimal and full runners deleted every resource they created. Each
receipt records independent post-delete GETs returning HTTP 404 for its exact
namespace and ordinary Worker names. No credential or account identifier is
retained.
