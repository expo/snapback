# EAS Phase 0: disposable Workers.dev activation is unstable under concurrent probes

**Status:** OPEN — P0.2 ingress investigation; does not change the P0.1 native-limit result

## Observed

During the 2026-08-03 real WfP spike, a newly uploaded and enabled dispatcher
served `/health` successfully, but repeated eight-way concurrent probes still
returned intermittent Cloudflare-generated 404 `Page not found` or
`Script not found` responses after twenty one-second rounds. The retained final
receipt's last round was seven 200 responses and one 404:
`demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json`.

Per-run unique ordinary Worker names removed delete/recreate name reuse as a
confounder. P0.1 application calls retried only Cloudflare's activation pages;
the concurrency/queue witness moved behind one dispatcher request so edge
activation could not masquerade as an admission result.

## Impact

LLP 0105 P0.2 owns stable ingress and route-shape qualification. No Expo
subdomain, preview, production alias, custom-domain, WebSocket, or failover
claim should rely on a single successful Workers.dev health response.

## Next steps

1. Reproduce with a minimal ordinary Worker and Cloudflare-supported deployment
   tooling, retaining response Ray IDs and IPv4/IPv6/DNS observations.
2. Determine whether the script subdomain endpoint reports readiness before
   global Workers.dev propagation completes and identify a deterministic
   readiness signal.
3. Run the P0.2 HTTP/WebSocket matrix through the intended Expo ingress rather
   than treating disposable Workers.dev as production routing evidence.
4. Keep all resources disposable and record post-run absence without secrets.

## Cleanup

The observed run deleted the dispatcher, host, outbound Worker, and dispatch
namespace; independent GETs returned HTTP 404 for each exact name.
