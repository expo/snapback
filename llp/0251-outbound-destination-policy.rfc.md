# LLP 0251: Unified outbound destination policy

**Type:** RFC
**Status:** Review
**Systems:** Runtime, Security, Actions, Webhooks, Ask, Cloudflare, Push, Jobs, Cron
**Author:** Charlie Cheever / Grok 4.6
**Date:** 2026-08-12
**Revised:** 2026-08-12 (single-family super-refine final-budget r3 by
Codex; remains Review)
**Related:** LLP 0009, LLP 0036, LLP 0047, LLP 0049, LLP 0070, LLP 0076, LLP 0143, LLP 0204, LLP 0216, LLP 0250

## Summary

This RFC governs **application/integration egress**: HTTP selected by app input
or declaration and carrying app effects, data, or provider credentials. It
covers webhooks, local/Cloudflare action fetch, LLP 0204 Ask, Expo push, and
future app-facing workerd fetch. Only webhooks enforce the full invariant;
that split produced
[`issues/20260812-host-fetch-ssrf-parity-with-webhooks.md`](../issues/20260812-host-fetch-ssrf-parity-with-webhooks.md).

Caller admission remains with each consumer's governing contract. This RFC
defines *where* an admitted call may go, sourcing webhook `prepare_target`:
canonicalize once, require public HTTPS, classify all DNS answers, connect only
to the validated set, and disable redirects/proxies. Exact-authority allowlists
only narrow the floor. Loopback HTTP requires an internal test capability that
served applications cannot obtain.

Outside this class are S3-compatible assets/MinIO, deployment and CLI/control-
plane clients, and private workerd invocation/readiness. These operator/target
infrastructure transports need subsystem policies and inherit **no** claim from
this RFC. Rust can enforce the floor; Cloudflare cannot inspect/pin DNS, applies
the lexical/allowlist/redirect subset, and reports `Missing` for hostnames.

## Motivation

[LLP 0009](./0009-code-execution-security.rfc.md),
[LLP 0049](./0049-all-aboard-cloudflare-live.plan.md), and
[LLP 0076](./0076-bounded-streamed-actions.rfc.md) govern action egress;
[LLP 0143](./0143-expo-push-notification-seam.rfc.md) owns push; and
[LLP 0204](./0204-app-external-surfaces.rfc.md) puts Ask provider HTTP on the
egress machinery. None supplies this common classifier.

Webhook `prepare_target` rejects malformed/credential-bearing URLs,
special/private or mixed DNS answers, redirects, and env proxies, then pins.
Local action fetch uses bare ureq; Cloudflare uses platform `fetch()`. Ask uses
a manifest provider base and bearer with redirects off, but no DNS classification/
pinning or proxy refusal. Handler-authored `args.url` makes action fetch the P1
SSRF; fixed-provider Ask is a distinct instance of the architectural omission.

This conservative admission classifier is not a global-routability claim. It
rejects loopback, private, link-local/metadata, CGNAT, multicast, unspecified,
documentation/reserved, IPv6 ULA/link-local, and mapped non-public IPv4;
reserved-range updates may narrow admission.

## Design

### Canonical admission algorithm

Consumers may tighten size/method limits but must preserve this order:

1. Parse once with Rust `url`/ureq or JavaScript WHATWG `URL`; reject empty,
   oversized/control-bearing, non-HTTP(S), credentialed, fragmented, zoned, or
   hostless input.
2. Derive one canonical authority: parser-emitted ASCII/IDNA lowercase host,
   one terminal DNS dot removed, canonical IP spelling, and explicit effective
   port (`443`/`80`). Shared fixtures cover unusual IPv4 and default ports.
3. Reject caller-supplied `Host` or `:authority` headers. Match any configured
   allowlist against exact `{host, port}`; no wildcard, suffix, path, or implicit
   port. Reject floor-violating literal entries at generation/admission.
4. Select the consumer/profile scheme and loopback rule from the matrix below.
   Public destinations are HTTPS-only.
5. Resolve once, deduplicate, and classify **every** answer; refuse empty,
   mixed, or non-public sets except under the test-only all-loopback capability.
6. Connect with the same authority and prepared address set, with no second
   lookup. Only after preparation may any credential materialize: action
   secret slots may alter query parameters or non-authority headers; Ask's
   bearer, webhook signing key, and push credential likewise appear only at
   send. None may alter the prepared destination.

Steps 5–6 are mandatory for an `Enforced` floor result. A target that cannot
perform them does not conform merely by blocking literal IPs.

### Consumer/profile contract

| Consumer/profile | Public scheme | Loopback HTTP | 3xx result |
|---|---|---|---|
| Webhook production | HTTPS | Refused | No follow; existing permanent delivery classification |
| Local `ctx.fetch` and `ctx.fetchStream` | HTTPS | Refused to served apps; internal test fixture only | Both refuse `SNAPBACK_OUTBOUND_REDIRECT_REFUSED` before exposing headers/body |
| Cloudflare buffered/streamed action fetch | HTTPS | Refused | Same action refusal, using `redirect: 'manual'` and discarding `Location` |
| Ask provider | HTTPS; exact manifest authority | Refused to served apps; internal test fixture only | No follow; closed Ask provider failure, no `Location` |
| Expo push production | HTTPS; exact Expo authority | Refused | No follow; closed provider-failure classification |
| Expo push deterministic fixture | n/a | Internal test fixture only | No follow; closed fixture/provider classification |
| Future app-facing workerd fetch | HTTPS | Refused | Same action refusal |

Only test code constructs unexported `TestLoopbackHttp`. It is absent from
env/config, manifests, CLI/HTTP/host operations, and handler arguments; bind,
Dev profile, or tunnel assertions never imply it.
This narrows LLP 0076's HTTP(S) shape: public action callers migrate to HTTPS.
Ask and Expo fake carriers receive the capability directly from their test
harness, never through a running application's configuration.

Redirects are never followed in v1. The shared transport returns an internal
`redirect_refused`; action consumers map it to the same public code above,
while webhook/push retain their closed outcome vocabularies. No `Location`
value enters an action result, diagnostic, or receipt. Any future follow mode
must re-run the complete admission algorithm at every bounded hop and strip
all sensitive headers and secret placements on authority change.

### Proxies

v1 is proxy-free: Rust uses `try_proxy_from_env(false)` and explicit proxy
settings fail `proxy_unsupported`. A later profile must define proxy endpoint
classification, resolution/allowlist authority, and truthful capability state.

### Cloudflare degradation and existing claims

Cloudflare applies steps 1–4, rejects canonical literal non-public IPs and
special hosts, requires exact-authority allowlists on hosted/untrusted use, and
refuses redirects. Platform `fetch()` still resolves hostname destinations and
offers no address pinning seam, so `egress_ssrf_floor` is `Missing` there.

LLP 0049's implemented `refreshFeed`/`routeEstimate` action and secret-placement
shapes are retained, not withdrawn. Their migration adds exact provider
authorities and may claim only “destination-constrained fixed-provider egress,
relying on Cloudflare platform DNS”; it may not claim the SSRF floor or general
outbound safety. User-selected/general hostname egress remains unclaimed.

### Secret-safe refusals

Destination parsing, authority-header rejection, allowlist matching, and (where
available) DNS classification/pinning happen **before any credential unwrap**.
This includes action descriptors, Ask bearer keys, webhook signing material,
and push credentials. They materialize only immediately before send, after the
prepared target is fixed. The internal reason vocabulary is closed:
`invalid_url`, `scheme_refused`, `authority_refused`, `allowlist_refused`,
`dns_unavailable`, `address_refused`, `redirect_refused`, and
`proxy_unsupported`; consumers may map these to their existing public codes.

Every refusal is value-free or passes through the invocation's staged-value
redactor. Raw URLs, `Location`, headers, bodies, substituted values, and
provider prose never enter diagnostics or retained receipts. LLP 0036's
`runtime.log`/stderr redaction gap remains a separately ticketed prerequisite;
this RFC does not claim to fix it.

### Capabilities and migration

`egress_ssrf_floor: Enforced` means every in-scope served request executes the
full algorithm, including pinning (or equivalent), proxy refusal, and no-follow.
Every served target reports loopback `off`; `test-only` may appear only in an
internal fixture receipt, never a runtime manifest. `egress_destination_allowlist`
is independently `Enforced` only for exact canonical authorities.

A local served target may omit an action allowlist and reach floor-admitted
public HTTPS; hosted/untrusted use requires one, but an allowlist cannot upgrade
a Missing floor. Ask always uses its exact manifest provider authority.
Webhooks retain behavior; local actions and Ask migrate to the shared primitive
and HTTPS; Expo production and its directly injected fake carrier migrate too;
Cloudflare apps add exact authorities and degraded facts. No generalized hosted
claim exists until floor, allowlist, and LLP 0047/0216 limits are Enforced.

## Non-goals

- Deciding who may call outbound or making `/api/v1/run` launchable.
- Query/mutation preemption.
- Rich allowlist authoring UX beyond v1 exact canonical authorities.
- Claiming Cloudflare hostname egress is DNS-pinned.

## Acceptance

A landing claiming this RFC Implemented must provide executable evidence that:

1. webhook delivery, local buffered/streamed action fetch, Ask, and Expo
   production plus fake carriers use the shared Rust primitive; webhook
   outcomes remain compatible with existing tests;
2. one Rust/JS fixture matrix proves canonical authority agreement (IDNA,
   terminal dots, default ports, IPv4/IPv6 spellings), malformed credentials/
   fragments, exact allowlists, and `Host`/`:authority` refusal;
3. local tests cover metadata IPv4/IPv6, localhost/private/reserved ranges,
   mixed answers, and a resolve-once/connect-pinned TOCTOU witness;
4. local and Cloudflare buffered **and** streamed actions produce the same 3xx
   refusal without `Location`; Ask no-follows under its closed failure. Rejected
   targets/redirects containing action, Ask, webhook, or push secrets leave no
   values in boundary-governed errors, logs, or receipts;
5. environment proxies are ignored, explicit proxy configuration refuses,
   and loopback succeeds only when a test directly supplies the unexported
   fixture capability; env/config, bind/profile, tunnels, and every served app
   cannot enable or obtain it;
6. Cloudflare blocks canonical literal non-public/special hosts, enforces exact
   provider authorities, uses manual redirects, and reports
   `egress_ssrf_floor: Missing`; and
7. target manifests separately assert floor and allowlist, report served
   loopback `off`, and include Ask's exact provider authority; local may report
   the floor Enforced, fixed-provider Cloudflare uses the residual wording, and
   excluded infrastructure transports gain no claim from these results.

## Implementation record

- 2026-08-12 — the concrete P1 parity landing
  (`issues/closed/20260812-host-fetch-ssrf-parity-with-webhooks.md`): Rust
  `src/outbound_policy.rs` is the shared primitive behind webhooks and both
  host action-fetch lanes (metadata/non-public answers refused, resolver
  pinned at transport time, redirects(0), env proxies ignored, authored URL
  echoed, loopback denied unless `SNAPBACK_OUTBOUND_LOOPBACK=1` or the
  `cfg(test)` harness). The Cloudflare coordinator applies a JavaScript port
  of the public-destination predicates to buffered and streamed
  `hostActionFetch` before secret placement (absolute HTTP(S) only, URL
  credentials/fragments refused, metadata/localhost names and non-public
  IPv4/IPv6 literals refused including v4-mapped v6, manual redirect handling
  refusing every hop, authored URL echoed). Workers/workerd exposes no DNS
  answer this code could pin, so the Cloudflare profile retains the
  DNS-rebinding residual and claims no floor. This landing predates this
  revision's full acceptance battery: Ask/Expo migration onto the shared
  primitive, the Rust/JS canonical-authority fixture matrix, and the manifest
  assertions of item 7 remain open toward Implemented.

## Status

Review. Filed from the 2026-08-12 review
([LLP 0250](./0250-codebase-review-20260812.research.md)); the concrete P1 may
land while author acceptance remains a separate action.
