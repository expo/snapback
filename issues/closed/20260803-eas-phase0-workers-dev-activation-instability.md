# EAS Phase 0: disposable Workers.dev activation was unstable under concurrent probes

**Status:** CLOSED — resolved 2026-08-04 with a deterministic readiness barrier

## Original observation

Newly uploaded and enabled dispatchers served `/health` once but continued to
return intermittent Cloudflare-generated 404 pages under eight-way concurrent
probing. Per-run unique names ruled out delete/recreate reuse, and the original
runner stopped after twenty one-second rounds.

## Diagnosis

The script-subdomain POST and read-back report `enabled: true` before the
Workers.dev route is globally ready. Unique cache-busting URLs proved this was
not merely one stale negative cache key:

- the final minimal control observed 276 generated 404 responses and reached
  three consecutive clean eight-way rounds only at round 77;
- the final corrected full run observed 312 HTTP 404 responses with Cloudflare
  Ray IDs before reaching the same barrier at round 81.

Both receipts retain the control-plane state, resolved IPv4 and IPv6 address
sets, response status, Ray ID, cache headers, and server header without storing
credentials. The evidence localizes the problem to asynchronous Workers.dev
route propagation after the control plane acknowledges enablement.

## Resolution

Both runners now:

1. POST the script subdomain configuration and read it back;
2. resolve and record both address families;
3. probe unique, explicitly uncached health URLs eight at a time;
4. require three consecutive all-200, body-verified rounds;
5. allow up to ninety one-second rounds before failing closed.

P0.1 begins no application assertion until this barrier passes. The final real
run passed all 23 checks. This is a deterministic disposable-run readiness
protocol, not a claim that Workers.dev is suitable production ingress;
LLP 0105 P0.2 still owns Expo subdomains, previews, aliases, custom domains,
HTTP/WebSocket routing, and failover.

## Cleanup

The retained minimal and full receipts show successful deletion followed by
independent HTTP 404 absence checks for every exact namespace and ordinary
Worker. No route or Worker was retained.
