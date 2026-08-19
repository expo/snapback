# LLP 0217: Hosted gates program — deployment security and the durable audit log

**Type:** Plan
**Status:** Draft
**Systems:** Auth, Security, API, Hosted platform, Storage, Agent tooling,
Admin, Docs
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-10
**Revised:** 2026-08-10 (initial draft)
**Related:** LLP 0019 (agentic readiness — F8 audit gap), LLP 0039 (auth
vertical slice — the gate label the corpus cites), LLP 0055 (agent principals
— the plane boundary this program un-refuses), LLP 0060 (hosted auth
deployment security — the Accepted contract), LLP 0071 (application abuse,
moderation, and audit — the audit-ledger design), LLP 0072 (trusted
single-tenant control plane), LLP 0077 (sender-constrained browser auth),
LLP 0098 (hosted-edge adapter — loopback-terminated profile), LLP 0099
(container-VM executor profile), LLP 0070 (durable background work — webhook
SSRF machinery), LLP 0150 (agent token acquisition), LLP 0189 (verification
cadence), LLP 0204 (app external surfaces — the refused program), LLP 0031
(route taxonomy), LLP 0024 / LLP 0042 (surfaces carrying both gates)

## Summary

LLP 0204's external-surfaces program is **Status: Implemented** — every
S0–S5 deliverable landed — *on local targets only*
(`llp/0204-app-external-surfaces.rfc.md:4`, `:9-16`). On hosted deployments
every credentialed external lane refuses by design, because LLP 0055's plane
boundary refuses hosted `servicePrincipal` invocation wholesale until "the
hosted deployment-security contract LLP 0039 names as unowned" lands, with
hosted *mutations* additionally gated on "the durable audit log (LLP 0019
F8)" (`llp/0055-agent-principals-and-scoped-grants.rfc.md:176-182`,
`:593-597`). LLP 0204 inherited that boundary verbatim and named the hosted
gates a sibling program (`llp/0204-app-external-surfaces.rfc.md:338-354`,
`:971-974`).

This document scopes that sibling program: what the two gates actually
require, which hosted lane each gate unblocks, a phased landing plan whose
key move is evaluating the **approval-gated-first audit log** (LLP 0204
D9.5's observation that "an audit log covering only approval-gated
operations is a smaller deliverable … which may pull the gated date
earlier", `llp/0204-app-external-surfaces.rfc.md:898-902`), and the
dependencies, risks, and author decisions the program needs.

The single most important grounding fact, established up front because it
reshapes the whole program: **the "LLP 0039 gate" is a label, not a missing
document.** LLP 0039 (Draft, deliberately FROZEN,
`llp/0039-auth-vertical-slice.rfc.md:4`, `:2055`) *named* the
deployment-security contract as unowned (`:236-244`, open question at
`:1930-1933`). The contract has since been **owned and Accepted as LLP
0060** ("This document does not thaw or reinterpret LLP 0039. It owns the
companion contract that LLP 0039 deliberately left open,"
`llp/0060-hosted-auth-security.rfc.md:152-153`; Status: Accepted at `:4`),
and a concrete admission profile is specified in LLP 0098 (Draft, with a
real served-origin acceptance ledger,
`llp/0098-hosted-edge-adapter.spec.md:4`, §8) and substantially implemented
in `crates/snapback/src/auth/hosted_edge.rs` and `crates/snapback/src/auth/deployment.rs`. The program is
therefore not "write the contract"; it is **finish the admission machinery
on one named hosted profile, build the scoped audit ledger, and land the
named dated LLP 0055 amendment that un-refuses lanes against that
evidence.**

## 1. What the two gates actually require

### 1.1 Gate A — the deployment-security contract

**Where the obligation is stated.** LLP 0039 names three unowned contracts
its slice depends on — "hosted deployment security (TLS termination,
trusted-proxy source addressing, distributed throttling and session
invalidation)", the client-page XSS posture, and the reverse-proxy fence
limit (`llp/0039-auth-vertical-slice.rfc.md:236-244`) — and its deferred
protocol obligation 8 assigns the hosted mixed-version/pre-mutation-refusal
proof to "the hosted deployment-security contract" (`:1631-1644`). Its
2026-07-16 amendment pins the two gates this program discharges: "Hosted
service-principal admission remains gated by LLP 0060, and hosted mutations
also require LLP 0019 F8's durable audit log" (`:2009-2011`). LLP 0024 and
LLP 0042 carry the same two gates in their amendment text
(`llp/0024-agent-operating-surface.spec.md:590`,
`llp/0042-agent-mcp-surface.rfc.md:164`), as does grant issuance
(`llp/0089-agent-provisioning-surface.rfc.md:207`).

**What is already decided (Accepted, LLP 0060).**

- *Decisions* (`llp/0060-hosted-auth-security.rfc.md:121-141`): (1) a
  session-enabled server refuses plaintext non-loopback binds
  (`SNAPBACK_AUTH_TRANSPORT_INSECURE`), no override; (2) a target must not
  advertise hosted **deployment capability** without four edge mechanisms —
  end-to-end external TLS, trustworthy effective-source derivation, shared
  authentication throttling, globally fenced session invalidation — and
  **hosted-auth capability** additionally requires sender-constrained
  client posture; actual **hosted admission** further requires the
  deployment-bound attestation, live health, disabled operator surface,
  browser direct-bearer-seam exclusion, and the D6 mixed-version boundary;
  (3) browser bearer v1 is honestly not XSS-resistant; sender-constrained
  (LLP 0077) is the v2 direction.
- *The admission model* (D5, `:465-588`): three layers — the committed
  five-axis `hostedAuth` target descriptor
  (`externalTls`/`effectiveSource`/`authenticationThrottle`/
  `sessionInvalidation`/`clientCredentialPosture`, `:511-528`), a
  control-plane–signed `HostedAdmission` snapshot bound to deployment
  identity and configuration digest with monotone epochs and a five-minute
  lifetime (`:561-588`), and live health whose loss withdraws serving
  (`:506-509`). "Public bearer v1 is local-only in this version. There is
  no … hidden flag, or operator waiver; adding one requires a separately
  reviewed amendment" (`:479-482`).
- *The mixed-version boundary* (D6, `:590-594`): the coordinator→handler
  must-understand invocation marker LLP 0039 obligation 8 requires.

**What is already built.**

- The local enforcement and claim-honesty boundary: pre-bind plaintext
  refusal, the target-owned capability descriptor, must-understand refusal
  of unsupported hosted composition, CSP headers, credential sentinels
  (ENG-24607, `llp/0060-hosted-auth-security.rfc.md:143-150`).
- The Rust-side admission machinery: `crates/snapback/src/auth/deployment.rs`
  (target-owned facts; candidate artifacts and operator flags "cannot
  assert any fact in this module", `crates/snapback/src/auth/deployment.rs:1-5`;
  `HostedAdmission`/envelope/key structures at `:251-341`) and the LLP 0098
  hosted-edge adapter for the `loopback-terminated-single-instance.v1`
  profile — Ed25519-signed admission envelopes against a release-bound
  key, re-derivation over belief, durable epoch watermarks, a capped 24 h
  pre-signed window (`crates/snapback/src/auth/hosted_edge.rs:1-47`).
- Hosted serving posture enforcement in the server: when
  `hosted_serving` is active, the operator surface is a uniform 404 on the
  public origin (LLP 0060 C2) and the entire OAuth facade family is refused
  without enumeration — `crates/snapback/src/server.rs:12528-12545`, carrying
  `@ref LLP 0204#d8` ("the first OAuth facade is local-only and hosted
  serving refuses the whole family"). The facade routes also 404 unless
  `oauth_is_local` — not hosted, `AuthDeploymentTarget::Local`, loopback
  (`crates/snapback/src/server/oauth.rs:58-65`).
- A served-origin acceptance ledger for the profile: LLP 0098 §8 records
  first-party served-origin runs (2026-07-25/27) including the sessions
  staged matrix and the plaintext-refusal close
  (`llp/0098-hosted-edge-adapter.spec.md:627-796`), on the Fly.io-shaped
  single-tenant topology LLP 0072 owns.

**What is open / unbuilt (the actual Gate-A work).**

- No current target supplies admission authority: "the local validator
  refuses every `hosted` request" (`llp/0060-hosted-auth-security.rfc.md:546-547`).
  ENG-24607 explicitly did **not** implement edge TLS attestation,
  trusted proxy-source derivation, shared throttling, multi-replica
  invalidation, a hosted control plane, or sender-constrained credentials
  (`:146-150`).
- LLP 0098 claims nothing yet: "**Draft.** No capability is claimed by
  this document. The §8 ledger is the gate"
  (`llp/0098-hosted-edge-adapter.spec.md:956-960`). The control-plane
  signer/minting path in first-party deploy tooling, live-health
  withdrawal in production, and the renewal cadence are not landed as an
  operated capability.
- The Cloudflare Workers target is far behind: its committed capability
  manifest declares `supportedAuthModes: ["dev"]` and the honest all-
  `unavailable` `hostedAuth` tuple
  (`targets/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8-16`,
  `:121-127`), and its gateway serves no `/api/v1`, `/mcp`, or facade
  routes at all (route inventory:
  `targets/cloudflare/hosted-adapter-manifest.json`, `targets/cloudflare/src/gateway.js`).
  Sessions mode does not exist on that topology; D6's marker and the
  shared throttle/invalidation fences are unbuilt there.
- Origin allowlisting: LLP 0039's deferred origin-allowlisting contract is
  scoped to cookie transport; bearer-token CORS for `/api/v1/*` needs its
  own statement inside the `api.origins` amendment
  (`llp/0204-app-external-surfaces.rfc.md:365-370`).
- The trusted-local prerequisite is the same machinery from the other
  side: LLP 0055 already binds trusted-local `servicePrincipal` admission
  to "LLP 0060's target-authored deployment capability"
  (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1432-1438`).

### 1.2 Gate B — the durable audit log (LLP 0019 F8)

**Where the obligation is stated.** LLP 0019 F8: "There is no general
mutation audit model yet … the gap is not merely that an audit log cannot
distinguish agent from human or capture intent / dry-run-vs-execute — it is
that the audit substrate itself is unspecified. Tie to F2"
(`llp/0019-agentic-readiness.research.md:292-297`). F2 pins the tuple the
log must record: **actor principal, effective principal, the scoped grant
that authorized the operation, and dry-run vs committed** (`:155-161`),
accepted uniformly across CLI/HTTP/MCP. LLP 0055 sharpens the gate: "A
durable, queryable audit **log** is LLP 0019 F8's follow-on — and a
**precondition for hosted mutation authority**"
(`llp/0055-agent-principals-and-scoped-grants.rfc.md:1341-1343`). The lane
matrix binds it to *granted external mutations and externally effectful
actions* on hosted targets (`llp/0204-app-external-surfaces.rfc.md:344-351`,
`:971-974`).

**What is already designed (Draft, LLP 0071 §Audit ledger).** The corpus
already carries a full audit-substrate design: generated event types with
schemas/redaction/severity/retention; each event binding deployment and
stream/restore identity, actor authority, canonical redacted payload,
partition/segment/sequence, **previous event digest and its own digest**
over a closed canonical-JSON profile
(`SHA256("snapback-audit-event-v1" || 0x00 || canonicalJson)`); append-only
bounded segments with sealed roots and continuity records; mandatory
audit-in-the-same-transaction for privileged mutations; external effects
committing intent + audit + LLP 0070 job enqueue together
(`llp/0071-application-abuse-moderation-and-audit.rfc.md:270-317`). It also
states the honesty limit this program must repeat: the chain is "canonical
operation history and restore authority, but **not independent tamper-proof
evidence** because the same operator may control both credentials"; the
separately administered checkpoint is an opt-up (`:296-301`; same posture in
`llp/0072-trusted-single-tenant-control-plane.rfc.md:105`, `:579`).

**What already exists in code as partial substrate, not the log.** LLP 0055
v1 records the attribution block on every response and receipt; the S2-D
usage/telemetry lane, capability-link use counters, `_snapback_watch_firings`,
and the `_snapback_pending_effects` journal all exist — and each was
explicitly scoped *away* from being the audit log: "durable full audit rows
remain deferred to the audit-log program"
(`llp/0204-app-external-surfaces.rfc.md:869-879`;
`llp/0031-server-route-taxonomy.spec.md:1447`).

**What is open (the actual Gate-B work).** Ratify a scoped v1 of LLP 0071's
ledger (0071 is Draft with its own "Decisions still requiring ratification",
`:598`); decide v1 mandatory coverage (see Phase 2); decide whether the
external copy to the LLP 0072 control authority is required for the F8 claim
or an opt-up; implement the substrate (canonical bytes, digest chain,
partitioning, same-transaction commit) plus a query/inspection surface; and
attach drift gates to the generated event schemas.

## 2. The un-refusal map

Hosted lanes and the exact gate(s) that unblock each. "Gate A" = LLP 0060
admission live on a named hosted profile + the named dated LLP 0055
amendment (`llp/0204-app-external-surfaces.rfc.md:345-347` requires the
amendment, "never an implication"). "Gate B" = the F8 audit ledger covering
that lane. "Serve" = hosted envelope/app-api serving — the ungated
plumbing 0204 lists beside the gates (`:971-974`), absent today on hosted
(the Workers gateway has no `/api/v1` family; the Rust origin has the
routes but hosted granted lanes refuse).

| # | Lane (LLP 0204) | Hosted today | Unblocked by |
|---|---|---|---|
| 1 | `/api/v1` anonymous + declared-tier calls to the external anonymous set (D2/D7) | Refused only by missing plumbing — the lanes are gate-free by design (`0204:338-341`) | **Serve** only. No Gate A/B. |
| 2 | `/api/v1` granted **reads** (delegated grants) | Refused wholesale (`0055:593-597`) | Serve + **Gate A** |
| 3 | `/api/v1` granted **mutations** / externally effectful actions | Refused | Serve + **Gate A + Gate B** (`0204:344-351`) |
| 4 | OAuth facade (discovery, DCR, authorize, token) + agent-management routes | Whole family refused on hosted (`crates/snapback/src/server.rs:12537-12545`; `crates/snapback/src/server/oauth.rs:58-65`; agent-management: `0055:143`) | **Gate A** (the facade mints/holds credentials — it *is* the credential-custody surface) |
| 5 | Remote MCP tool calls | Anonymous set only, "same as every other projection" (`0204:398-404`) | Granted tools: Serve + **Gate A**; mutating tools: + **Gate B** |
| 6 | CLI `login` against a hosted app | Refused (rides the facade, D4) | **Gate A** (via lane 4) |
| 7 | `ask` (D5) | Effectively unavailable — requires a granted read principal or caller-key billing; anonymous/declared refused (`0204:1071-1075`) | Serve + **Gate A** (read-only v1 needs no Gate B); **mutating `ask`** additionally Gate B (`0204:946-948`) |
| 8 | Capability links, v1 anonymous-set (D9.4) | Not served | **Serve** only (no new execution authority, `0204:849-853`); granted-operation links stay behind their own commissioned 0055/0058/0031 amendments (`0204:853-858`) — out of this program |
| 9 | Durable watches (D9.3) | Not available (owner authority is session- or grant-shaped) | User-owned: hosted **sessions** admission (Gate A, full five-axis posture — browser consent surfaces); integration-owned `capturedGrant`: Gate A + the OQ11 watch-anchor 0055 amendment; reaction mutations under Gate B scope ruling (OQ-5 below); webhook reactions additionally LLP 0070's unshipped SSRF/idempotency/retry machinery (`0204:805-807`) |
| 10 | Approval-gated effects (D9.5) | Not available (approval is a session-inbox ceremony) | **Gate A** (a hosted approver session) + the Phase-2 approval-scoped ledger — this lane is the *first* Gate-B customer, not the last |
| 11 | Integration lifecycle (D7 records, admission keys, metering; declared-tier ledger) | Declared-tier/anonymous admission is pre-auth and can ride Serve; credentialed installation/consent | Serve for pre-auth tiers; **Gate A** for installations and grants (`0089:207`) |

Reading the map: **Gate A is the choke point** — nothing credentialed opens
without it, and it also carries the facade every other credentialed lane
uses to exist. Gate B additionally holds only the *write* half of the
granted plane. And a **Serve-only phase already unlocks real third-party
usage** (lanes 1, 8, 11-pre-auth) with zero gate work.

## 3. Phased landing plan

Phasing follows LLP 0189: each phase lands promptly with scoped evidence
against the landed commit; no phase gates on a complete proof at an exact
HEAD; capability claims bind their scoped qualification digest.

### Phase 0 — Program anchoring (docs + rulings; small)

- Dated amendments recording the gate's concrete referent: in LLP 0055 (and
  echoed in 0039's amendment chain without thawing it, per
  `llp/0060-hosted-auth-security.rfc.md:152-153`), "the hosted
  deployment-security contract" = **LLP 0060 admission, live on a named
  profile, first profile `loopback-terminated-single-instance.v1` (LLP
  0098)**; "the durable audit log" = **a scoped v1 of LLP 0071 §Audit
  ledger** with a named coverage set. This converts both gates from
  folklore labels into checkable referents.
- Author rulings needed here: the sender-constrained question (OQ-1 below),
  the approval-first audit scope (OQ-2), the v1 tamper-evidence claim
  (OQ-3). Ratify the LLP 0071 ledger sections the program consumes.

### Phase 1 — Hosted ungated plane ("Serve"; no gate dependency)

Serve the exposure envelope, OpenAPI/`API.md` projections, `/api/v1`
anonymous + declared lanes, MCP anonymous set, v1 anonymous-set capability
links, and the declared-tier/pre-auth admission ledger on the first hosted
profile (the Rust origin — the routes and admission ladder already exist in
the binary; what's needed is serving posture and network-evidence floors on
hosted, not new authority). This is the "hosted envelope/app-api serving"
work item 0204 names beside the gates (`0204:971-974`).

*Unlocks:* real strangers using public app surfaces in production (lanes 1,
8, 11-pre-auth); the LLP 0201 M6 grader run against a hosted URL for the
anonymous variation. *Risk:* low — no credentials at stake; the anonymous
floor and declared budgets (LLP 0071 amendment, LLP 0090) already define
the abuse posture.

### Phase 2 — Audit ledger v1, approval-scoped coverage (Gate B, staged)

**Evaluation of the approval-gated-first idea (the commissioned question).**
The D9.5 text is careful: approval "does not move the LLP 0019 F8 audit-log
gate: approval is consent, not audit. What it can honestly narrow is the
*first landing's scope*" (`0204:898-902`). Assessment against the code that
has since landed: S5 Landing C already produces exact
`_snapback_pending_effects` intents whose every state change "appends a
bounded journal fact" with approver recorded separately (`0204:904-923`).
So for approval-gated operations, the *event stream already exists*; what's
missing is the F8-grade substrate underneath it (canonical bytes, digest
chain, partition/sequence, same-transaction mandatory commit, query
surface). Two consequences:

1. **The saving is real but it is coverage, not substrate.** The substrate
   (0071's canonical profile + chain + segments) costs the same whether it
   ingests one event family or ten. What approval-first genuinely removes
   from the critical path is instrumenting *every* mutation ingress
   (bare, `/api/v1`, MCP, link, watch-reaction, job-replay) with
   mandatory-in-transaction audit and proving the fail-closed intake
   behavior on each — the wide, riskiest half.
2. **It changes the hosted product honestly.** With coverage =
   approval-gated executions + authority transitions + grant lifecycle,
   the D2 matrix can un-refuse hosted granted mutations *whose functions
   declare `approval: "required"|"external"`* the moment Gate A lands —
   every externally-caused hosted write is then human-approved **and**
   audited. Direct (unapproved) granted mutations stay refused until
   Phase 4 widens coverage. That is a coherent security story, not a
   loophole: strictly stronger consent compensating narrower audit
   breadth during the interim.

**Recommendation: adopt approval-first, framed as coverage staging.**
Deliverables: ratified event schemas for the v1 set (approval intent /
decision / execution / expiry; grant + credential + token lifecycle;
session/authority transitions — the 0071 "authority transitions" core,
`0071:276-283`); the digest-chained store + partition machinery; mandatory
same-transaction commit for the covered set; the operator query surface
with type/app scoping and redaction (`0071:319-322`); drift-gated generated
schemas. Local targets adopt the ledger first (it is target-independent),
so Gate B evidence exists before Gate A flips anything.

### Phase 3 — Gate A on hosted profile 1, then the un-refusal amendment

Finish admission for `loopback-terminated-single-instance.v1` (LLP 0098 on
the LLP 0072 single-tenant topology, LLP 0099's executor family): the
control-plane signer and minting path in first-party deploy tooling
(`llp/0098-hosted-edge-adapter.spec.md` §2), live-health withdrawal in the
serving loop (§5), effective-source under loopback termination (§6),
throttle-config binding, replay-floor advancement at boot, and the
operator-surface 404 + browser-seam exclusion already enforced at
`crates/snapback/src/server.rs:12528-12536`. The single-binary origin makes D3/D4 the
degenerate single-instance cases and D6 trivially satisfied — which is
exactly why this profile is first. Then land the **named dated LLP 0055
amendment** (`0204:345-347`) un-refusing on that profile: the OAuth facade
and agent-management routes, granted reads (lanes 2, 4, 5-read, 6, 7-read),
and granted mutations *within Phase 2's approval-gated coverage* (lane 10,
and lane 3 for approval-declared functions). Run the LLP 0201 M6 grader
end-to-end against the hosted URL as the phase's product receipt.

### Phase 4 — Full write plane + standing authority on hosted

Widen Gate B coverage to *all* granted external mutations and externally
effectful actions across every ingress (the full D2 matrix), then un-gate
direct granted mutations and mutating `ask`. Land hosted sessions consent
surfaces as admission allows; integration-owned watches behind the OQ11
watch-anchor amendment; webhook reactions strictly behind LLP 0070's
commissioned SSRF/idempotency/retry machinery (`0204:805-807`). Metering
graduates from loss-tolerant telemetry toward the billing-grade ledger
(`guide/backend/external-api.md:21-23`) as demand warrants.

### Phase 5 — Second hosted profile: the Workers topology (demand-gated)

Sessions-mode support on the Cloudflare gateway/handler/DO topology:
`snapback.v1` artifact + sessions admission, the D6 must-understand marker
(LLP 0039 obligation 8, `0039:1631-1644`), shared throttling and globally
fenced invalidation across isolates, credential custody in
Workers/DO storage, and porting the external route families into the
gateway (none exist today). This is the longest pole and serves no user
until one exists there; keep it explicitly demand-gated rather than letting
it serialize the program.

## 4. Dependencies and risks

**Infrastructure each phase needs.** P1: hosted serving of the envelope +
`/api/v1` on the Rust origin; deploy tooling only. P2: none hosted —
storage + schema work in the binary. P3: the LLP 0072 control plane
operating the 0098 signer (key halves split off-deployment,
`llp/0098-hosted-edge-adapter.spec.md` §2.1), platform TLS + loopback
termination (Fly-shaped machine), deployment-identity digests (the
existing machinery, cf. `targets/cloudflare/scripts/generate-deployment-identity.mjs`
for the Workers analogue). P5: workerd feature work across the board.

**Biggest risks.**

- **Credential custody on a shared/hosted origin.** After Gate A the
  deployment durably holds agent credentials, grant tokens, and pending
  consent state; the browser bearer remains honestly XSS-exposed (LLP 0060
  decision 3). The facade must never land on a target whose admission is
  not live — the current fail-closed shape (whole-family refusal,
  `crates/snapback/src/server.rs:12537-12545`) must be preserved as the default in every
  new serving path. Sender-constrained v2 (LLP 0077, Draft) is the
  trajectory, and OQ-1 decides how much of it Gate A waits for.
- **Overclaiming tamper evidence.** 0071 is explicit that the digest chain
  under a single operator is history, not independent proof
  (`0071:296-301`). The F8 claim must be worded to match, with the
  external checkpoint (LLP 0072 copy) as the opt-up; a "tamper-proof"
  claim would be false on day one.
- **Audit availability coupling.** Mandatory audit blocks intake on
  failure (`0071:303-310`) — correct, but on hosted it couples external
  write availability to ledger health. The bounded operator-recovery
  partition and the refusal shape need first-class design, not incident
  improvisation.
- **SSRF and hosted egress.** Watch webhooks are already typed-refused
  until LLP 0070's SSRF machinery ships (`0204:805-807`); `ask` provider
  calls ride LLP 0009's guarded outbound gate (`0204:1078-1080`). Hosted
  multiplies the blast radius (platform-internal metadata endpoints);
  egress policy is a Gate-A-adjacent deliverable for any hosted lane that
  fetches.
- **Scope creep via the sender-constrained axis.** If un-refusing
  non-browser granted lanes is ruled to require `senderConstrainedV2`
  (all-five `hostedAuthCapable`), Phase 3 inherits the whole LLP 0077
  program and the gated date moves out substantially. This is the single
  biggest schedule lever — hence OQ-1.
- **Fleet drift.** Event schemas, the admission envelope schema, and the
  un-refusal matrix are frozen-record candidates; give them drift gates
  per the existing registry rather than claim-digest coupling (LLP 0189).

## 5. Recommendation and confidence

**Sequence P0 → P1 → (P2 ∥ P3) → P4, with P5 demand-gated.** P1 first
because it needs no gate and produces real hosted usage immediately. P2 and
P3 are independent workstreams (storage/schema vs. control-plane/admission)
and should run in parallel lanes. The first hosted profile should be the
LLP 0098 loopback-terminated Rust origin, not Workers — the admission
machinery, served-origin evidence, and every external route already exist
there. **High confidence** on profile choice and on P1-first; **medium-high
confidence** on approval-first audit staging (the substrate-vs-coverage
analysis above; the honest interim story is strictly-stronger consent);
**medium confidence** on the P2∥P3 parallelism surviving contact with the
OQ-1 ruling, which can reshape Phase 3's exit bar.

## 6. Open questions for the author

1. **OQ-1 — Does the un-refusal of non-browser granted lanes require
   `senderConstrainedV2`?** LLP 0060 D5 requires all five axes plus
   admission for `--auth-deployment hosted` and forbids hidden waivers
   (`0060:477-482`). The external lanes are non-browser credentialed
   callers; a narrower reviewed 0060 amendment could admit the granted
   API/MCP/CLI plane under four-axis `deploymentCapable` + admission while
   browser session surfaces stay refused. Recommended: yes, as a named
   reviewed amendment — but this is exactly the "separately reviewed
   amendment" 0060 reserves to you.
2. **OQ-2 — Approval-first audit coverage** (Phase 2). Accept coverage
   staging (approval-gated + authority-transition events first, full
   external-mutation coverage in Phase 4), meaning hosted direct granted
   mutations stay refused for an interim in which only approval-declared
   functions write? Recommended: yes.
3. **OQ-3 — The v1 tamper-evidence bar.** Is the local digest chain +
   sealed segment roots sufficient for the F8 *claim*, with the LLP 0072
   external copy an opt-up — or is the external copy mandatory before any
   hosted mutation un-gates? Recommended: chain + roots for v1, external
   copy mandatory at Phase 4.
4. **OQ-4 — Where the program's documents land.** This Plan as a new LLP
   plus dated amendments to 0055/0060/0071 (recommended), or absorb the
   scoping into 0060/0071 directly? 0039 stays FROZEN either way.
5. **OQ-5 — Watch reactions and Gate B scope.** A watch reaction calling
   an exposed mutation is externally *configured* but internally fired. Is
   it inside the F8 "externally-caused write" perimeter from Phase 2
   (recommended — it is standing external authority), or Phase 4?
6. **OQ-6 — First operated deployment.** Is the LLP 0072 Fly-shaped
   single-tenant topology the blessed Phase 3 operating target (the 0098
   §8 evidence is from it), or does the author want a different first
   platform before the control-plane signer is built for it?
