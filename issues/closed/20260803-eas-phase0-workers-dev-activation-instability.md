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
- one qualifying full run needed as many as 43 attempts in one probe lane and
  absorbed 149 HTTP 404 plus two HTTP 500 responses while completing three
  body-verified eight-lane rounds; the final retained run absorbed 22 404s and
  one 500, with a maximum of three attempts in a lane.

Both receipts retain the control-plane state, resolved IPv4 and IPv6 address
sets, response status, Ray ID, cache headers, and server header without storing
credentials. The evidence localizes the problem to asynchronous Workers.dev
route propagation after the control plane acknowledges enablement.

## Resolution

Both runners POST and read back the script-subdomain configuration, resolve and
record both address families, and use unique explicitly uncached health URLs.
The minimal control's retained run crossed its conservative 90-round
consecutive-clean barrier. The full P0.1 runner uses the more robust protocol
derived from the later failures:

1. run three body-verified readiness rounds;
2. in each round, start eight independent probe lanes;
3. retry each lane's transient route misses for up to ninety one-second
   attempts, retaining every status and Ray ID;
4. fail closed immediately if any lane exhausts its budget.

The full runner additionally invokes every app × release × role script through
the dispatch namespace and requires three consecutive all-200, identity-checked
rounds before P0.1 assertions begin. Its retry loop now recognizes the
dispatcher's actual structured HTTP 502 `Worker not found.` response; the old
HTTP 500-only predicate was the direct cause of the app-B false failures in the
first hardened rerun.

The final retained run completed all 24 Workers.dev lanes after 22 transient
404s and one transient 500; the slowest lane needed three attempts. The
namespace barrier then observed 58 structured `Worker not found.` responses
before all eight scripts reached three consecutive clean rounds at round 46;
all 23 checks then passed. This is a deterministic disposable-run readiness
protocol, not a claim that Workers.dev is suitable production ingress;
LLP 0105 P0.2 still owns Expo subdomains, previews, aliases, custom domains,
HTTP/WebSocket routing, and failover.

## Cleanup

The retained minimal and full receipts show successful deletion followed by
independent HTTP 404 absence checks for every exact namespace and ordinary
Worker. No route or Worker was retained.
