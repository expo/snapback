# LLP 0168: Browser-carrier dev edge feasibility

**Type:** Research
**Status:** Draft
**Systems:** Developer experience, Browser carriers, Client integration, Local server lifecycle, Security, Tooling, Packaging, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Revised:** 2026-08-15 — Executes Charlie Cheever's accepted packet rulings:
the NOT-YET recommendation stands with the successor-RFC gate closed on A3
grounds; a client pointing at an already-admitted hosted target is outside this
front-edge gate; and A1 is explicitly scoped to the browser carrier studied
here. A native Metro/Expo physical-device carrier is a different carrier whose
own A1 is not stated here. Packet rulings 4–6 remain open.
**Related:** LLP 0008, LLP 0017, LLP 0030, LLP 0031, LLP 0041, LLP 0043, LLP 0060, LLP 0064, LLP 0090, LLP 0129, LLP 0166, LLP 0169, `diaries/0056-warble-local-first-microblog.diary.md`

## Summary

An ordinary browser loading a Snapback app from `http://<lan-address>` can
lose two independent properties:

1. the bundler and Snapback server are different origins, so the browser needs
   an admitted cross-origin path or a same-origin relay; and
2. ordinary LAN HTTP is not a secure context, so the Web Locks API is absent.
   Snapback's browser persistence arm requires both IndexedDB and Web Locks and
   otherwise degrades to memory.

The second failure is easy to miss. The app can remain usable online while
retained query state and durable offline custody are unavailable across reload.
LLP 0169 specifies the client-side diagnostic that makes this condition
distinct. It is independent of every topology studied here and should proceed
without waiting for an edge decision.

This document does **not** propose or authorize a dev edge, nor any edge
implementation outside the fenced spike defined in the gate — which itself
requires an RFC already opened under section A. Three rounds of
dual-family review found a new bypass in the edge's dev-auth model each time.
The current evidence also leaves a narrower benefit than the original proposal
claimed: several carriers have cheaper partial answers, and a TLS tunnel is
useful only when it fronts a route-composing relay. The present recommendation,
accepted by Charlie Cheever on 2026-08-15, is therefore **do not build the edge
on this record**. Browser-carrier demand under A1 remains distinct from the
separately established native Metro/Expo demand; a future native carrier owner
must state its own A1. Any successor also needs the security preconditions in
this Research to have a reviewable answer.

## Research question and authority

The question is not “how should the edge be implemented?” It is:

> After existing relays, port forwarding, static export, and operator-managed
> TLS are counted honestly, is a Snapback-owned front edge worth its additional
> security and lifecycle surface?

This Research owns the evidence, alternative comparison, successor constraints,
and go/no-go gate. It changes no route, profile, auth, packaging, or client
behavior.

Existing owners remain authoritative:

- **LLP 0030** owns the browser relay namespace and route-admission policy.
  This document fixes how a future edge shares that authority, but never lists
  or redefines admitted routes.
- **LLP 0031** owns server route classification and transport parity.
- **LLP 0041** owns packaged developer-loop commands. No command is reserved
  here.
- **LLP 0017** owns the admin console serving path. An app edge must never
  become a second generic admin ingress.
- **LLP 0169** owns the insecure-context client diagnostic.

## What is established

| Finding | Evidence | Confidence | Consequence |
| --- | --- | --- | --- |
| Web Locks is secure-context-only. Standard HTTP loopback origins are potentially trustworthy; an ordinary HTTP LAN origin is not. | The Web Locks `NavigatorLocks` interface is `[SecureContext]` in the [Web Locks specification](https://w3c.github.io/web-locks/). The [Secure Contexts algorithm](https://w3c.github.io/webappsec-secure-contexts/#potentially-trustworthy-origin) admits HTTPS, loopback IPs, and `localhost`; it does not generally admit private LAN addresses. | High | `http://localhost` and `http://192.168.x.y` are not equivalent browser carriers. |
| Snapback's default browser store requires IndexedDB **and** Web Locks. If either is absent and no later native/Node arm applies, it selects the memory fallback. | [`packages/snapback-client/rqs-store-default.mjs`](../packages/snapback-client/rqs-store-default.mjs) computes `hasIndexedDb && hasWebLocks` before constructing the IndexedDB store and ends with `memoryFallback('no-durable-backend')`. LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 requires the resolved implementation and degradation mode to be reported. | High | Fixing CORS alone can turn a loud boot failure into an app that runs with volatile state. |
| Cross-origin admission and secure context are independent axes. | [`crates/snapback/src/server.rs`](crates/snapback/src/server.rs) `local_dev_cors` reflects loopback origins by default and may additionally admit an exact, leased console-reachability origin. That policy changes request admission, not `isSecureContext` or Web Locks exposure. | High | No CORS-only change can establish browser persistence. |
| Browser storage identity is tied to the browser's storage key; changing the tuple origin changes the origin component of that key. | The [HTML origin model](https://html.spec.whatwg.org/multipage/browsers.html#origins) defines a tuple origin by scheme, host, and port. The [IndexedDB specification](https://w3c.github.io/IndexedDB/#database-construct) associates databases with a storage key. | High | Any future TLS path needs a stable public scheme, host, and port or it can present a different, empty store after restart. |
| Snapback's default server profile is derived from its own bind when `SNAPBACK_PROFILE` is unset or empty. | [`crates/snapback/src/admin.rs`](crates/snapback/src/admin.rs) `resolve_profile` selects `Dev` on loopback and `Prod` otherwise; exact `dev`, `demo`, `test`, and `prod` values override it, while unknown non-empty values fail closed to `Prod`. | High | A loopback-bound server behind a front still sees the loopback default. |
| The current server cannot infer public exposure through an undeclared local front. | LLP 0060#d1-plaintext-listener-fence states the limit directly: a loopback server behind a public reverse proxy still appears loopback, and the fence proves nothing about that proxy or public reachability. | High | Bind checks, forwarding-header hygiene, and a declaration of “effective exposure” cannot detect an undeclared local tunnel. |
| The Warble run observed the motivating browser state. | On 2026-08-04, headless Chrome at the LAN origin reported `isSecureContext = false`, `navigator.locks = undefined`, IndexedDB present, and the memory store with `reason: 'no-durable-backend'`; `curl` observed CORS reflection for the localhost origin and no reflection for the LAN origin. The narrative is in [Diary 0056](../diaries/0056-warble-local-first-microblog.diary.md); the exact facts were independently checked against source in both [Claude](./reviews/0168-single-origin-dev-edge.claude.md) and [gpt-5](./reviews/0168-single-origin-dev-edge.gpt-5.md) reviews. A machine-readable receipt is now retained at [`demos/warble/evidence/insecure-context-origin-comparison.json`](../demos/warble/evidence/insecure-context-origin-comparison.json), captured as a controlled two-origin comparison (same machine, same bundle, same backend, same moment; only the page origin differs) — the LAN origin resolves `memory` with `navigator.locks` undefined, and `http://localhost` resolves `indexeddb` with it defined. | High | The receipt is one machine and one Chrome version; Safari and Firefox are inference from the secure-context specification, not measurement. |

The source-backed causal chain is strong. The exact Warble measurement is
weaker only in breadth, not in retention: a machine-readable receipt is now
kept at `demos/warble/evidence/insecure-context-origin-comparison.json` as a
controlled two-origin comparison. The residual weakness is that it covers one
machine and one Chrome version; Safari and Firefox are inference from the
secure-context specification rather than measurement.

## The two-axis comparison

“Works” below means both axes are composed at one browser origin. A check mark
does not imply an approved security posture.

| Path | Same app/Snapback origin | Secure context | Coverage and residue |
| --- | --- | --- | --- |
| Same-machine `localhost` plus the LLP 0030 Vite relay | Yes | Yes under the standard loopback exception | Covers the Vite browser loop. It does not supply a Metro relay or a remote-device path. |
| Android port forwarding to device `localhost` | Only if the forwarded public port already composes app assets and the LLP 0030-owned relay policy | Yes | Forwarding a bundler and Snapback as two ports leaves two origins. Metro manifest/asset URLs must also remain on the forwarded origin. This path needs a documented, tested relay composition before it can be called a complete answer. It does not cover iOS Safari or another computer. |
| Exported static web build served with Snapback app routes | In principle | Only if that origin is trustworthy | Removes HMR and requires an app-static serving composition that is not established here. Plain LAN HTTP still fails the secure-context axis. |
| TLS tunnel to a bare bundler | No | Yes | The tunnel does not add Snapback routes to the bundler origin. It is not a complete alternative. |
| TLS tunnel to a Vite server already carrying the LLP 0030 relay | Yes | Yes | Technically composes both axes for Vite, but the tunnel is an undeclared local front and the current dev-auth posture cannot detect it. This is not an approved exposure pattern. |
| Shared Snapback relay embedded into each bundler, plus TLS | In principle | In principle | Keeps public-listener ownership with the bundler. It avoids a front process but still needs per-bundler HTTP/upgrade/TLS integration and the same exposure controls. |
| Snapback-owned front edge proxying the bundler | In principle | In principle | Centralizes TLS and upgrade behavior across bundlers. It also creates a new public dev surface over client-asserted identity; the authorization and access-capability designs are unresolved. |

The edge's residual is therefore not “everything outside Vite,” and it is not
honest to subtract “a tunnel” generically. The strongest possible residue is a
live-reload browser workflow on iOS Safari or another machine, especially with
a bundler that lacks a Snapback relay. Whether that occurs often enough to
justify a new security boundary has not been measured.

**Direct tunnelling of a dev server is unsupported.** An earlier revision of
this paragraph said "set `SNAPBACK_PROFILE` explicitly," which is a no-op:
explicit `dev`, `demo`, and `test` all permit provisioning, and only `prod`
fails closed. That advice would have granted false confidence. The accurate
statement is that the bind-derived `dev` default survives a tunnel — the server
sees only its loopback listener — and that default grants the
destructive/provisioning capability to whoever reaches the public URL. For a
deliberately controlled experiment, `SNAPBACK_PROFILE=prod` is the only value
that fails closed, and functionality may consequently refuse; selecting a
profile does not by itself approve public exposure. See
[`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`](../issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md).

## Hostname and certificate findings

A stable browser origin is necessary for stable browser storage. It does not
select one certificate strategy.

| Candidate | What it establishes | Cost or uncertainty |
| --- | --- | --- |
| Stable local name plus an operator-supplied private certificate | Stable name and TLS after the device trusts the issuer | Trust is per device. Apple documents that a manually installed certificate profile is not automatically trusted for SSL and requires a separate [Certificate Trust Settings step](https://support.apple.com/en-us/102390); Configurator/MDM deployment differs. Cross-carrier name resolution and trust must be tested rather than assumed. |
| Public DNS name plus a publicly trusted certificate obtained with ACME DNS-01 | DNS-01 proves control by a TXT record; see [RFC 8555 §8.4](https://www.rfc-editor.org/rfc/rfc8555.html#section-8.4). A public CA can validate a domain whose web server is not exposed to the public internet; see the [Let's Encrypt DNS-01 documentation](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge). The application name may therefore resolve to a private address without making the dev server public. | Requires an owned domain, CA and DNS reachability during issuance/renewal, and either manual DNS work or narrowly scoped DNS-provider automation. Publishing an A/AAAA record to a private address discloses that address in public DNS; split-horizon DNS avoids that disclosure at added operational cost. |
| Tunnel-provided name and certificate | Stable HTTPS for the tunnel's lifetime or configured name | It solves both axes only when the tunnel fronts a route-composing relay. It does not solve the undeclared-front auth problem. |
| mDNS `.local` or device hosts entry | Potential stable local naming | Portability across the target carrier matrix is unverified. A hosts entry is not an acceptable assumption for managed phones. |

The public-DNS/DNS-01 option was missing from the earlier RFC. Adding it makes
the certificate inventory complete enough for a go/no-go discussion; it does
not make any candidate the paved path.

## Security findings

### Bind address is not exposure, and declared exposure is not proof

The three review rounds found the same inference failure at successive layers:

1. a LAN-bound edge can proxy to a loopback server, leaving the server in its
   zero-configuration `dev` profile;
2. a tunnel can front a loopback-bound edge, leaving the edge's bind check
   satisfied; and
3. a tunnel can front the loopback server directly, making its upstream
   connection indistinguishable from a local process.

The third case is not repairable with forwarded headers. A malicious or merely
misconfigured local front can omit them, and LLP 0060 already forbids treating
untrusted forwarding text as authority. “Effective exposure” is useful
configuration vocabulary, not an observable security fact.

Any successor must either change the acceptance rule for client-asserted dev
identity so it is never granted merely because the transport peer is loopback,
or establish an unforgeable front/server relationship with an explicit local-
process threat model. This Research does not choose between a same-process
edge, inherited pipe, protected local IPC, or a broader explicit dev-identity
opt-in. That choice changes the server's auth boundary and needs a focused RFC,
not another paragraph in an edge proposal.

### A front credential proves possession unless minting proves policy

A credential obtainable by any loopback caller proves only that its bearer
could reach loopback. It does not prove the bearer enforces a profile gate,
Host/Origin checks, an access capability, or the LLP 0030 relay policy. Rotation
does not improve that property; it only shortens credential lifetime and adds a
stale/reacquisition state.

A future credential design must specify who may mint, what policy facts are
bound into the grant, whether the grant is transferable to another origin, how
server restart invalidates it, and what traffic is refused while a front
reacquires it. No edge credential is approved here.

### A browser access capability is necessary but not yet designed

Host validation limits name confusion, and Origin validation limits browser
cross-site requests and WebSocket upgrades. Neither prevents another LAN peer
or non-browser client from using a reachable dev surface. A future public edge
therefore needs an unguessable access capability covering initial navigation,
assets, relay HTTP, HMR, and upgrades.

The best candidate from review is a capability-bearing first navigation that
sets a `Secure`, `HttpOnly`, `SameSite=Strict` cookie — host-scoped, not
origin-scoped: cookies ignore scheme/port separation that the IndexedDB
partition enforces, so the cookie and the store do not share a boundary — returns
`Referrer-Policy: no-referrer`, and redirects to a clean URL. Cookies naturally
ride bundler-generated asset requests and WebSocket handshakes. This remains a
candidate, not a decision: token redemption/log redaction, rotation, sharing,
logout, HMR, Metro manifests, and the first-navigation flow need a carrier test.

## Finding: shared route-admission policy has a hard constraint

This is a **finding about any topology that shares relay-admission policy**,
not a decision issued to another owner. LLP 0030 owns that policy and its
implementation; this Research has no authority to fix requirements on it, and
gate item B5 below is where these become binding — on the successor RFC, at
acceptance time.

Stated as a constraint a successor must satisfy, parallel route lists are
unsafe regardless of which topology wins:

1. LLP 0030 remains the sole owner of relay-admission policy and its update
   review. No successor document copies its route list.
2. One checked-in, versioned generated artifact; Rust and JavaScript consumers
   compile the same artifact bytes.
3. Canonicalization rules and adversarial path vectors travel with the
   artifact and every consumer runs them. Sharing JSON while interpreting
   encoded paths differently is still policy drift.
4. Consumers advertise artifact version and digest in readiness; a peer with a
   different digest, unsupported version, unreadable artifact, or failed
   vectors refuses before the first proxied request.
5. The readiness projection is a skew check, not a runtime source of policy.

None of this decides that an edge exists, and none of it is scheduled here. If
a successor RFC is opened, amending LLP 0030 so owner and generated output land
together is part of that RFC's acceptance, not an instruction issued by this
document.

## Round-3 MATERIAL dispositions

| # | Open concern | Disposition in this Research |
| --- | --- | --- |
| 1 | A direct tunnel to the loopback server bypasses the loopback-direct exemption. | **Re-routed to a present-tense owner — not deferred.** The round-1 review established that this is not a property of an unbuilt edge: `ngrok http 4420` against today's loopback-bound server yields a publicly reachable server still in the bind-derived `dev` profile. Filed as [`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`](../issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md) so the live exposure has an owner regardless of whether an edge is ever built. The edge-specific residue — that no signal distinguishes a tunnel client from a local process — remains an A2 precondition. |
| 2 | A loopback-minted edge credential proves provenance, not policy compliance. | **Deferred as an auth-boundary design.** Mint authority, bound policy facts, transfer resistance, restart/reacquisition, and the local-process threat model depend on the future process topology. The prior credential design is discarded, not carried forward. |
| 3 | The hostname inventory omitted public DNS plus DNS-01. | **Resolved as a research omission.** The option and its costs are now in the certificate inventory. Selection remains open because no carrier/certificate path has been tested end to end. |
| 4 | The residual scope subtracted “a tunnel” even though a tunnel alone fixes only TLS. | **Resolved.** The comparison distinguishes a bare-bundler tunnel from a tunnel fronting an existing route-composing relay. Only the latter composes both axes, and its auth exposure remains unapproved. |
| 5 | The off-loopback access capability had no decided form. | **Explicitly deferred before authorization.** A cookie bootstrap is the leading candidate, but no implementation or carrier proof establishes its leak, routing, HMR, and upgrade behavior. Because the edge is not authorized, selecting an unproved bearer flow now would create another paper security decision. |

## Go/no-go gate for a successor RFC

The round-1 review found the previous single list unopenable: it required an
access-capability proof, an implemented policy artifact, proxy compatibility
"through the exact integrated topology," and security tests against a running
edge — none of which can exist before someone builds one — while the next
sentence forbade building one. That is a permanent no wearing a checklist. The
gate is therefore split by *when* each condition must hold.

### A. Preconditions to OPEN an RFC

All must be present before the question is reopened. None requires an
implementation.

- **A1. Browser-carrier demand evidence.** Within the browser carrier studied
  by this Research, a real workflow requires remote browser HMR and is not
  acceptably served by the LLP 0030 Vite relay, Android forwarding, a static
  HTTPS export, or a bundler-embedded shared relay. Names the browser carrier
  and frequency, not a theoretical matrix cell. A native Metro/Expo
  physical-device carrier is a different carrier whose demand precondition is
  not stated here; whichever document eventually owns it must state its own A1
  against the native alternative set: simulator, Android USB, static export,
  and a hosted release target.
- **A2. Auth-boundary answer, on paper.** A reviewable design in which the
  server no longer infers safe client-asserted identity from a loopback peer
  that may be a front — or an argued trust channel that is unforgeable under an
  explicit local-process threat model. Prose is sufficient; it must be
  falsifiable.
- **A3. One named hostname/certificate strategy**, with its per-device trust
  cost stated for each claimed carrier.

### B. Conditions the RFC must satisfy BEFORE acceptance

These require running code and are the acceptance bar, not the entry bar.

- **B1. Access-capability proof.** Initial navigation, assets, relay HTTP, HMR,
  source maps, manifests, and WebSocket upgrades all reject a missing or wrong
  capability without leaking it through URLs, logs, or referrers.
- **B2. Stable-origin proof.** The named strategy works on every claimed
  carrier, and retained state survives edge and server restarts plus a
  host-address change without changing scheme, host, or port.
- **B3. Proxy compatibility proof.** Live subscriptions, streaming, HMR over
  WSS, redirects, absolute asset URLs, source maps, and Metro manifest URLs
  work through the exact integrated topology.
- **B4. Targeted security tests.** At minimum: a LAN edge to a loopback server;
  a tunnel to a loopback edge; a direct tunnel to the loopback server; a
  credentialed-but-noncompliant local front; stale credentials after restart;
  unknown `Host`; cross-`Origin` upgrades; and every access-capability
  rejection.
- **B5. One policy authority.** The constraints in "Finding: shared
  route-admission policy" are implemented and fail closed, with LLP 0030
  amended so owner and generated output land together.

### How B-evidence may be produced

B1–B5 need an artifact to test, so producing them is authorized as a
**time-boxed, explicitly fenced spike**. Distribution fence: not enabled by
default, not published as a supported path, not documented in the guide, and
not merged to the default branch (or merged only behind a flag defaulting off).
**Reachability fence** — required because B4's tests are precisely the act of
standing up reachable dev servers, each inheriting the bind-derived `dev`
profile: any spike run reachable off-loopback MUST set `SNAPBACK_PROFILE=prod` —
**not merely "non-`dev`"**, since `demo` and `test` also permit provisioning,
which is the exact confusion the mitigation paragraph above exists to prevent.
"Reachable off-loopback" means reachable by any peer other than the loopback
interface, explicitly including a tunnel fronting a loopback bind. Where a
positive proof (B1, B3) genuinely cannot be produced under `prod`, that is a
finding to record in the RFC, not a licence to relax the fence. The box needs
a named owner and a named duration recorded in the RFC; if the RFC is
undecided when the box expires, the default action is **delete**, not extend. A spike is the only sanctioned way to build edge code
before acceptance; absent an open RFC under section A, implementation work
stops at LLP 0169 and at documentation and proofs for the cheaper paths.

## Confidence and deliberately open questions

Confidence is **high** in the browser/store causal chain and in the conclusion
that the current server cannot detect an undeclared local front. Confidence is
**medium** in the browser-edge product recommendation because demand for this
browser carrier has not been measured. The native Metro/Expo packet establishes
demand for a different carrier and does not silently satisfy browser A1. The
browser causal chain itself is receipt-backed; what remains unmeasured is
browser-carrier demand and cross-browser breadth.

Deliberately open:

- within the browser carrier studied here, whether remote iOS/second-machine
  browser HMR is common enough to justify an edge; a native Metro/Expo carrier
  must state its own A1 elsewhere;
- whether the winning topology is a front edge or per-bundler shared relay;
- the client-asserted-identity rule and front/server trust channel;
- the browser access-capability lifecycle;
- the paved hostname/certificate strategy; and
- placement in the packaged loop, which remains LLP 0041's decision only after
  a topology is authorized.

## Author ruling — 2026-08-15

Charlie Cheever accepted the iOS physical-device packet's NOT-YET
recommendation: the route-composing successor-RFC gate stays closed on A3
grounds, and topology (c) — an already-hosted backend plus a separately
admitted development asset carrier — is adopted. Packet ruling 2 is recorded
here as a scope boundary: a client pointing at an already-admitted hosted target
creates no listener or route composition and is outside this gate. Packet
ruling 3 is the A1 scoping edit above. Packet ruling 1 is implemented by LLP
0181's `hosted-development` binding arm.

Packet rulings 4–6 remain open: this Research does not schedule the F-A2-4
blast-radius measurement, the Android USB live receipt, or a ruling on whether
a peer-authenticated private overlay is a carrier or an undeclared front.

## Provenance

This document was written from the 2026-08-04 Warble investigation, the
three-round mutually blind review artifacts
[`claude`](./reviews/0168-single-origin-dev-edge.claude.md) and
[`gpt-5`](./reviews/0168-single-origin-dev-edge.gpt-5.md), their
[`run journal and disposition ledger`](./reviews/0168-single-origin-dev-edge.run.md),
the source files cited above, and the governing LLPs. It supersedes the
unaccepted `0168-single-origin-dev-edge.rfc.md`; no edge decisions from that
draft survive except the LLP 0030 policy-sharing boundary stated here.
