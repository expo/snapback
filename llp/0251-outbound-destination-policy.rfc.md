# LLP 0251: Unified outbound destination policy

**Type:** RFC
**Status:** Review
**Systems:** Runtime, Security, Actions, Webhooks, Cloudflare, Push, Jobs, Cron
**Author:** Charlie Cheever / Grok 4.6
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered an author-directed, single-family Codex
super-refine loop; Draft → Review is the loop's one authorized status
transition)
**Related:** LLP 0009, LLP 0036, LLP 0047, LLP 0049, LLP 0076, LLP 0143, LLP 0216, LLP 0250

## Summary

Every host-mediated outbound hop — `ctx.fetch`, `ctx.fetchStream`, webhook
delivery, Cloudflare `hostActionFetch`, and later push-provider calls —
should share one destination policy. Today webhooks enforce it and action
fetch does not. That split is how
[`issues/20260812-host-fetch-ssrf-parity-with-webhooks.md`](../issues/20260812-host-fetch-ssrf-parity-with-webhooks.md)
shipped.

This RFC does not change *who* may call outbound (still action-only, still
`SNAPBACK_OUTBOUND_ACTIONS` / hosted allowlists). It defines *where* a
permitted call may go, and which sibling path is the source of truth.

**Proposal:** lift `src/webhooks.rs` `prepare_target` / `is_public_ip` /
pinned resolver / `redirects(0)` / `try_proxy_from_env(false)` into a
shared outbound-destination module. Every host-mediated HTTP client
consumes it. Cloudflare's coordinator applies the same predicates before
`fetch()`. Loopback HTTP is an explicit local-dev exception, not the
default. App-level host allowlists (511.org, Expo push) compose *on top*
of this floor; they never replace it.

## Motivation

[LLP 0009](./0009-code-execution-security.rfc.md) says query/mutation
handlers cannot perform arbitrary network I/O, and that actions have gated
outbound fetch. [LLP 0049](./0049-all-aboard-cloudflare-live.plan.md)
§Action Egress and [LLP 0076](./0076-bounded-streamed-actions.rfc.md) own
the call shape, settlement, and secret placement. None of them pin a
destination classifier.

The webhook path already did the work (`src/webhooks.rs:80-218`):

- refuse empty / oversized / control-character URLs
- refuse userinfo, passwords, and fragments
- HTTPS only, except an explicit test-loopback-HTTP exception
- refuse `localhost`, `*.localhost`, `metadata`, `metadata.google.internal`
- resolve, sort, dedup; refuse any non-public answer (RFC1918, link-local
  including `169.254.169.254`, CGNAT 100.64/10, multicast, IPv6 ULA/link-local,
  IPv4-mapped non-public)
- pin those addresses into the agent resolver so a later DNS answer cannot
  swing the connection
- `redirects(0)` and `try_proxy_from_env(false)`

`ctx.fetch` / `ctx.fetchStream` (`src/server.rs:1572`, `:1813`) and
Cloudflare `hostActionFetch` (`cloudflare/src/coordinator.js:2808`, `:3187`)
check only “bounded absolute http(s).” ureq 2 follows five redirects and
honors `HTTP(S)_PROXY`. `fetchStream` returns the post-redirect URL.

Ibex ambient `fetch` denies `PeerClass::Metadata | Unspecified`. Host-mediated
fetch never enters that classifier, so enabling outbound actions *weakens*
the peer policy relative to the denied ambient path.

The official guide fixture takes `args.url` and fetches it. Default function
admission is `optional-user`. Jobs and cron run as System. Combined with a
tunnelled loopback server, this is a public SSRF of the developer machine.

Capability manifests already declare `egress_destination_allowlist` /
`action_egress_per_host_allowlist` as gaps. Those rows mean “this app may
only call these hosts.” They do not mean “this runtime may hit the IMDS.”
Both are required; they are not substitutes.

## Design

### Floor vs allowlist

Two layers, always both:

1. **Floor (this RFC).** Destination is a public Internet address, or an
   explicit local-dev exception. No metadata, no unspecified, no
   non-public, no env-proxy surprise, no unvalidated redirect.
2. **Allowlist (existing capability vocabulary).** After the floor, the
   deployment or app may further restrict hosts (511.org, Expo push,
   author-declared). A missing allowlist on a trusted-local target is
   “any public Internet host.” A hosted/untrusted target must not claim
   outbound until an allowlist is Enforced (LLP 0047 / 0216).

An allowlist that contains `169.254.169.254` or `localhost` is refused at
generate or admit time. The floor is not overridable by the app.

### Shared primitive

One Rust module (suggested: `src/outbound.rs`) exports:

- `prepare_http_target(url, policy) -> PreparedTarget`
- `is_public_ip(IpAddr) -> bool` (the webhook classifier, including
  IPv4-mapped IPv6)
- a ureq `Agent` builder that pins `PreparedTarget.addresses`, sets
  `redirects(0)`, `try_proxy_from_env(false)`, and the caller's timeouts

`policy` is a closed enum:

- `PublicHttpsOnly` — production / webhook default
- `PublicHttpOrHttps` — only if a future product decision admits plaintext
  to public addresses (not proposed here)
- `LocalDevLoopbackHttp` — all resolved addresses loopback, HTTP allowed,
  still no metadata / RFC1918 mix

Cloudflare JS gets a port of the same predicates (or a generated JSON
fixture of the blocked networks) applied *before* `fetch()`, plus
`redirect: 'manual'` or `'error'`. Workers cannot pin a resolver the way
ureq can; refuse any URL whose hostname is a literal non-public IP, and
document that hostname→private-IP is a residual on that target until a
fetch-with-pinned-addresses API exists.

### Consumers

| Path | Today | After |
|---|---|---|
| Webhooks | Floor already | Call the shared primitive; behavior unchanged |
| `ctx.fetch` | Shape only | Floor required; echo **authored** URL (already the buffered rule) |
| `ctx.fetchStream` | Shape only | Floor required; do **not** return post-redirect URL |
| Cloudflare `hostActionFetch` / stream | Shape only + arg scrub | Floor + `redirect: 'error'`; keep production arg scrub as defense in depth |
| Expo push | Fixed provider URL | Floor on that URL (should already be public); no user URL |
| Future workerd host fetch | n/a | Same primitive |

### Redirects

v1: do not follow. A 3xx is a response the handler sees (buffered fetch)
or a typed refusal (webhooks already treat non-2xx). If a later revision
admits following, every hop re-runs `prepare_http_target` and the hop
count is bounded (webhook-style, ≤5). Authorization headers never
propagate across hops (ureq's default; keep it).

### Proxies

v1: ignore `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` unless the operator
sets an explicit Snapback proxy config. Env-inherited proxies are how a
developer laptop's corporate MITM or a compromised env becomes an
exfil path.

### Loopback exception

Local-dev only, and only when **all** resolved addresses are loopback.
Never a mix of public + loopback. Never `169.254/16`. The exception is
off unless `SNAPBACK_OUTBOUND_LOOPBACK=1` or the process is the test
harness. A tunnelled loopback server
(`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`) must
not inherit this exception just because the bind address is loopback.

### Secrets

Unchanged from LLP 0036: local value-mode refuses descriptor slots;
hosted unwraps only at the fetch boundary and redacts. This RFC adds:
the redactor also covers `runtime.log` / stderr
(`issues/20260812-runtime-log-skips-secret-redactor.md`), which is a
sibling hygiene landing, not a destination-policy change.

### Capability honesty

After the floor lands:

- local trusted-dev reports `egress_ssrf_floor: Enforced`
- `egress_destination_allowlist` stays Missing until an app/deploy
  allowlist exists
- hosted/untrusted still cannot claim outbound until both the floor and
  an allowlist are Enforced, plus LLP 0047's kill/limit battery

Do not advertise the floor as “SSRF-proof hosted multi-tenant.” DNS
rebinding on Cloudflare without a pinned resolver is a named residual.

## Open questions

1. Should local-dev loopback HTTP be on by default for `snapback start`
   on 127.0.0.1, or always opt-in? Default-off is safer; default-on is
   what authors expect when they `ctx.fetch('http://127.0.0.1:3001')`.
2. Does the Cloudflare residual (hostname resolves to private IP after
   admit) block a hosted-outbound claim, or is it accepted until Workers
   grow a pin API?
3. Are webhook HTTP-to-loopback tests enough of a fixture, or does
   action fetch need its own matrix (metadata, redirect-to-metadata,
   env proxy, mixed A records)?
4. Should push-provider base URLs go through the same primitive even
   though they are not user-controlled? (This RFC says yes.)

## Non-goals

- Who may call outbound (still LLP 0009 / 0049 / 0076).
- Query/mutation preemption (still LLP 0009 / 0047 / 0216).
- App-declared per-host allowlist authoring UX (existing capability
  vocabulary; a later slice).
- Making `/api/v1/run` untrusted code launchable.

## Acceptance

A landing that claims this RFC is Implemented must:

1. Put local `host_fetch` and `open_response_stream` on the shared
   primitive (no bare `AgentBuilder::new()`).
2. Keep webhook behavior byte-identical on its existing SSRF tests.
3. Add action-fetch tests for: metadata IPv4/IPv6, `localhost`,
   RFC1918, mixed public+loopback A records, `https://evil.test` → 302
   to `169.254.169.254`, and `HTTP_PROXY` ignored.
4. Cloudflare: refuse literal non-public IPs and set redirect error;
   document the hostname residual.
5. Manifest: `egress_ssrf_floor: Enforced` on local; no hosted-outbound
   claim.

## Status

Draft. Filed from the 2026-08-12 review ([LLP 0250](./0250-codebase-review-20260812.research.md)).
The concrete local/Cloudflare hole is already a P1 filesystem ticket and
can land against this Draft; ratification can follow the landing.
