# LLP 0223: Zero-config connect DX and knowledge-gap closure

**Type:** Plan
**Status:** Implemented
**Systems:** Developer experience, Expo client, Auth, Diagnostics, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (Accepted → Implemented — all four tickets executed;
see the dated implementation-record amendment, including the resolved
conflict with the parallel-lane `.env.local` auto-write of `4a19761fe`)
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin implementation (author direction in-session, 2026-08-10); Claude READY on (c), GPT verdicts bind (c), the (d) tail is unreviewed and disclosed)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop)
**Revised:** 2026-08-10 (c — round-1 revision: ticket 1 acceptance now
requires a live backend round trip (LLP 0181 `ready` does not assert live
transport); durable-copy ban scoped to exported/ambient connection
configuration, provider-owned admitted cache and receipt exempt; grading
unit stated as (code, operation)-context with emission-time details doing
the routing; ticket 3 proof adds a retained cold-agent eval transcript;
ControlCatalog `inputSchema` claim pinned to the generator and the
`config.set` entry; chronology and trigger-section repairs. Addresses
`llp/reviews/0223-zero-config-connect-and-knowledge-closure.plan.{claude,gpt-5}.md`
round 1.)
**Revised:** 2026-08-10 (d — post-round-2 final revision, UNREVIEWED: pins
the Sessions-mode precondition for provider `ready` to the expo-chat
template's shipped `auth: { mode: 'sessions' }` schema declaration (the
"dev auth profile" description in LLP 0186's scaffold entry is the stale
v1 text); ticket 4's grading entry routed to the canonical checked-in
ledger under `tests/acceptance/diagnostics/`; scaffold suite path pinned;
catalog `guide` pointer, "exactly one", case-25 wording, and
supplemental-check phrasing repairs. Addresses round-2 reviews in
`llp/reviews/`; this revision post-dates them and carries no review
verdict.)
**Related:** LLP 0193 (errors-as-docs — this Plan tightens its grading unit
for shared codes), LLP 0186 (agent authoring efficiency — B9/DX is its
scoreboard), LLP 0181 (zero-configuration Expo — the connect contract this
Plan proves rather than replaces), LLP 0061 (guide/retrieval loop — owner of
no-refusal behavioral gaps), LLP 0201 + `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(the evidence source), `issues/20260809-scaffold-env-autowrite-and-mint-docs.md`
(the evidence ticket this Plan executes)

## Summary

The Clique P2 pilot scored Snapback's B9 DX at 68 against Convex's 82 and
Supabase's 80, and the evidence ticket decomposes the loss into two small,
specific costs. First, Convex's CLI writes `EXPO_PUBLIC_CONVEX_URL` into
`.env.local` unprompted, so a fresh app connects with zero manual config;
the ticket asks for "the equivalent." Second, two facts were learned by
observation instead of retrieval, each costing a loop: the
`snapback session mint` HTTP request shape (every documented guess refused
with `SNAPBACK_AUTH_REQUEST_INVALID`) and the offline cold-start
`binding.source: 'persisted-receipt'` branch. Since the pilot, the tree has
closed part of the second gap — `guide/clients/react-expo.md` (~587)
documents the persisted-receipt fallback and the bare-Metro cold-boot
procedure (~615), pinned by `guide/retrieval-eval.md` case 25 (~270) — so
the remaining concrete documentation gap is the mint HTTP request shape.

The finding conflates the normal Expo path with the pilot lane's specialized
password-auth gateway. For the normal path, Snapback already has the
equivalent — and architecturally better — mechanism: the dev supervisor
injects a credential-free rendezvous origin
(`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`) into Metro's process environment
before it bundles the app (`packages/snapback-cli/expo-dev.mjs`, `startMetro`,
~line 1050) and publishes a transient owner-only descriptor
(`.snapback/expo-supervisor.json`, ~line 1503) for inspection. LLP 0181
governs this as the supervised no-URL contract; `clients.react-expo` in
`guide/capabilities.md` records it as shipped. The gap is not machinery — it
is that the zero-config property is unproven as an acceptance-level contract
and undersold as the answer to "where do I put the URL?", and that the mint
gap still has neither documentation nor a retrieval key in the guide (the
persisted-receipt gap now has both content and a regression case). This
Plan is deliberately thin: four tickets under the existing issue, no new
subsystem, no new documentation transport.

## Options considered

**1. Copy Convex: write `.env.local`, put absolute docs URLs in errors.**
Familiar and clickable, but wrong for Snapback's model: the connection
coordinate is an expiring AppBinding delivered through a supervisor-owned
rendezvous, not a durable backend URL. A raw persisted URL drops binding
identity, capabilities, route mode, generation, and expiry; goes stale
across runs; and is not necessarily the device-visible origin. It directly
contradicts LLP 0181's common-path contract (no committed env variable, no
`.env` mutation). Absolute docs URLs are unavailable or misleading for
pre-server bootstrap, codegen, offline, and package-install errors.
Rejected.

**2. Supervisor-native auto-injection, proven and documented as the
zero-config contract, plus a thin knowledge-closure pass.** Keep the
process-scoped injection and transient descriptor exactly as shipped; add
the missing proof (scaffold-level acceptance of zero-manual-config connect)
and the missing docs (mint HTTP shape with a per-context anchor). Reuses
`snapback guide SNAPBACK_*` and the build-bound served guide rather than
inventing a second transport. **Chosen.**

**3. An explicit run-scoped connect export** (`snapback connect expo
--format=json|env`, or an opt-in `.snapback/connect.env` carrying origin +
generation + expiry) for separately launched Metro processes and unusual
gateways. It adds a second lifecycle surface with its own stale-artifact
problem, and the supervisor descriptor plus the documented bare-Metro
procedure already cover the known detached case. N=1 demand does not
justify it. Rejected for now, with a re-open trigger below.

## Decision

**Auto-inject, do not auto-write.** The supervisor-owned env injection is
the zero-config connect contract. The work is proving it (acceptance: a
fresh scaffold reaches provider `ready` with no user-authored URL and no
`.env*` file created or modified, then completes a live app-level backend
round trip — LLP 0181 is explicit that `ready` alone does not assert live
transport) and documenting it as the direct answer to the Convex
comparison. A persistent *exported* connection artifact is explicitly
rejected: a durable copy of a rendezvous origin or binding held as ambient
configuration (env file, committed setting, standalone export) is a
stale-lifecycle bug waiting for the next supervisor generation, and the
transient descriptor already serves inspection without surviving as
configuration. This ban is about configuration surfaces, not caches: the
provider-owned admitted binding cache and persisted receipt
(`guide/clients/react-expo.md` ~590, LLP 0114 admission) are
expiry-checked, provider-lifecycle-managed, and deliberately retained —
they stay. If injection ever becomes unreliable (Expo SDK change), the
fallback is a generation/expiry-bound file under `.snapback/` — never an
ambient `.env.local`.

**Knowledge closure grades per emitting context, not per code.** LLP 0193's
unit of repair tightens: `SNAPBACK_AUTH_REQUEST_INVALID` has five emitting
sites (`guide/reference/diagnostics-registry.json` ~20467, `guideAnchor`
currently null), and two of those sites are the shared
`auth_host_operation_input` parser serving four host-ops operation
families — so one generic URL would misroute every non-mint context, and a
per-site anchor alone cannot separate mint from rescue/retire/suspend at
the shared site. The grading unit is therefore the emitting context —
(code, operation) where an operation is in scope, per-site where sites do
not fan out — and the routing is carried by emission-time details: the
mint refusal must name `auth.mintSession`, its expected argument contract,
and the precise guide target. Branches that emit no error stay with
LLP 0061's diary/retrieval loop — the loop that produced the
persisted-receipt page content and its regression case 25 — and this Plan
does not pre-decide LLP 0146 OQ6's structured-remediation carrier;
diagnostic `details`, message text, and build-bound relative anchors are
sufficient for this tranche.

## Design detail

- **Connect invariant.** Surfaces: `packages/snapback-cli/expo-dev.mjs`
  (injection in `startMetro`; descriptor write after readiness emit), its
  loop tests, and the `expo-chat` scaffold acceptance (the template's
  acceptance trio under `packages/snapback-cli/templates/expo-chat/` —
  `acceptance.mjs`, `acceptance.live.mjs`, `acceptance.static.mjs` — as
  exercised by the snapback-cli package/verify tests). Semantics to pin:
  clean generated app → provider `ready` with zero manual config **plus one
  successful app-level backend round trip** (LLP 0181: `ready` asserts
  admission and construction, not live transport, so the round trip is what
  proves the injected origin actually connects); no `.env*` created or
  mutated; descriptor stays transient, mode 0o600. Provider `ready`
  inherits `auth.mintSession`'s settled-Sessions precondition (LLP 0181;
  without it the provider reports `authority-required`); the shipped
  template already satisfies it — its schema declares
  `auth: { mode: 'sessions' }`
  (`packages/snapback-cli/templates/expo-chat/snapback/schema.mjs` ~59;
  LLP 0186's "keeps the dev auth profile" scaffold description is the
  stale v1 text) — and the acceptance asserts the precondition rather than
  assuming it. If
  current readiness events do not make the carrier inspectable, add a
  structured fact such as `connectCarrier: "supervisor-rendezvous"`.
  Generic existing-Expo-project onboarding is the already-recorded
  `clients.compose-existing-app` GAP (an idempotent `snapback init --expo`
  installing plugin/provider, not a URL) and stays on its own ticket.
- **Mint self-description.** `MintSessionRequest` (`crates/snapback/src/auth/wire.rs` ~344)
  stays the type authority. Populate the ControlCatalog `inputSchema` for
  `auth.mintSession`: the per-entry field is authored through the catalog
  generator's overrides (`scripts/generate-control-catalog.mjs` ~269);
  `config.set` carries one
  (`control-catalog/generated/control-catalog.v1.json` ~3499) while the
  `auth.mintSession` entry has none. Point the entry's `guide` anchor at
  the new mint section through the same overrides file. (This is the
  catalog entry field, not
  the route-level `inputSchema` in `crates/snapback/src/schema_export.rs`'s
  `http_routes_artifact`, where the shared host-ops route is honestly
  null.) In `auth_host_operation_input`
  (`crates/snapback/src/server.rs` ~19709), make the mint-path failure include safe
  contextual details — `operation`, `expectedArgumentContract`, a resolving
  anchor — preserving the stable code. The documented body is the shipped
  CLI projection, `{"operation":"auth.mintSession","args":{"email":"…"}}`
  (`mint_session_request`, `crates/snapback/src/cli.rs` ~3861); document the exact
  headers/body and the HTTP-200 `hostOpsResult` envelope in
  `guide/operating/host-ops.md`, linked from `guide/auth/native-apps.md`,
  keeping admin/impersonation authority server-side and the operation
  scoped to local dev/test/demo.
- **Compatibility.** Additive throughout: no app migration, no `.env.local`
  cleanup, no error-code changes. ControlCatalog and guide digests rotate
  normally; messages/details may improve under existing compat rules.

## Tickets

1. **Prove the zero-config connect contract.** Scaffold acceptance: fresh
   generated app reaches provider `ready` **and completes a live backend
   round trip** with zero manual config, zero `.env*` writes; add the
   `connectCarrier` readiness fact if needed; assert descriptor
   transience/permissions. Proof: the new acceptance run green in the
   `expo-chat` scaffold suite plus expo-dev loop tests.
2. **Make `auth.mintSession` self-describing.** Catalog `inputSchema`,
   contextual mint refusal details, host-ops guide section with exact HTTP
   request/response, linked from auth/native-apps. Proof: valid + invalid
   HTTP cases pinned in `crates/snapback/tests/host_ops_v0.rs`, including secret-negative
   assertions; the invalid-mint case asserts the refusal's `details` carry
   `operation: "auth.mintSession"`, the expected argument contract, and a
   relative anchor that resolves in the served guide. Supplemental
   discoverability check: `snapback guide SNAPBACK_AUTH_REQUEST_INVALID`
   output includes the host-ops mint-section anchor among its anchors
   (the registry's existing flat `guideAnchors` array suffices; context
   labeling is carried by the refusal `details`, not a registry-shape
   change). Update the catalog entry's `guide` pointer per the design
   detail above.
3. **Close the retrieval regression.** New `guide/retrieval-eval.md` case:
   implement a trusted server-side identity broker using `auth.mintSession`
   over HTTP; fail on guessed bodies, per-login shell-outs, a missing
   authority carrier, or operator credentials in an app bundle. Expected
   pages: `operating/host-ops.md`, `auth/native-apps.md`; route terms
   include "auth.mintSession", "session mint HTTP",
   "SNAPBACK_AUTH_REQUEST_INVALID", "identity broker". Existing cases —
   including case 25 — are retained, not replaced. Proof: the eval case lands and passes
   under the guide check (lexical routing), **plus** one retained
   cold-agent eval transcript under `guide/eval-runs/` passing the page's
   existing budget and rubric — the static check alone proves only that
   the lexical path exists, not that an agent takes it.
4. **Tighten LLP 0193 minimally.** Dated clarification: shared codes are
   graded and repaired per emitting context — (code, operation) where an
   operation is in scope, per-site otherwise; wrong-shape refusals get an
   inline expected contract or exact reference; no-refusal behavioral
   surprises route to LLP 0061. No new wire member. Proof: the dated
   amendment text in LLP 0193 itself, plus the corresponding per-context
   entry for `SNAPBACK_AUTH_REQUEST_INVALID` in the canonical checked-in
   graded ledger under `tests/acceptance/diagnostics/` (LLP 0193 Phase 1's
   artifact; if that ledger has not landed yet, the amendment records the
   grading and the ledger entry follows with Phase 1), recording that the
   code is graded per emitting context with the shared host-ops parser
   disambiguated by ticket 2's emission-time details (the generated
   registry is not hand-annotated; any registry change rides ticket 2's
   generated fields).

## Re-open and escalation triggers

These are conditional triggers with pre-agreed outcomes, not undecided
questions.

- **T1 — Re-open trigger for option 3.** If two more independent builds
  need detached Metro or a custom client process and cannot consume the
  supervisor descriptor, a run-scoped `snapback connect` export becomes
  justified. Until then it stays rejected, and the injection-fallback
  constraint from the Decision (generation/expiry-bound file under
  `.snapback/`, never an ambient `.env.local`) binds any reconsideration.
- **T2 — Post-fix residual.** If measurements after ticket 2 still show
  search after an A-grade refusal, that is evidence to accelerate LLP 0146's
  structured remediation carrier — not evidence for universal absolute URLs.

Evidence caveat: the B9 figure is one pilot lane, builder-self-scored
(nulls-block-totals; graders unrun). This Plan treats it as a defect report
with two named reproductions, not as a calibrated competitive claim.

## Dated amendment — 2026-08-10: implementation record (tickets 1–4)

**Pre-existing state found at execution start** (the tree moved between
drafting and execution; deltas were verified before implementing):
`guide/auth/sessions-and-principals.md` had already gained an exact-shape
mint-over-HTTP section and `guide/auth/native-apps.md` already frames the
trusted identity-broker seam (both from a parallel lane resolving the
evidence ticket's mint-docs half); retrieval-eval case 25 and the
persisted-receipt page content were on the tree as this Plan's Summary
records. The ControlCatalog `auth.mintSession` entry still had no
`inputSchema`, the registry's `SNAPBACK_AUTH_REQUEST_INVALID` entry had no
guide anchors, and no acceptance proved the zero-config connect contract.

**Conflict found and resolved.** Commit `4a19761fe` (landed ~2.5 h before
this Plan's acceptance commit, same day) implemented the evidence ticket's
env-write half literally: `runExpoDev` wrote the credential-free
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` into the app's `.env.local`
(`expo-client-environment.mjs`). That is the configuration surface this
Plan's accepted Decision explicitly rejects ("Auto-inject, do not
auto-write"; "never an ambient `.env.local`"), and both super-refine review
families affirmed the decision as binding. Execution followed the accepted
Decision: the ambient write was reverted (module removed, injection and
descriptor kept exactly as shipped), ticket 1's acceptance pins the
no-`.env*` invariant, and the evidence ticket carries a dated supersession
note. If the author instead wants the auto-write, it is one revert away —
but it must then re-open this Plan's Decision, not land silently beside it.

**Ticket outcomes.**
1. Zero-config connect proven: `connectCarrier: "supervisor-rendezvous"`
   readiness fact added; supervised loop test and a new
   `zero-config-supervised-connect` check in the `expo-chat` acceptance
   assert `ready` under settled Sessions, a live app-level round trip
   through the supervised carrier with zero manual config, no `.env*`
   created or modified, and descriptor transience (0o600, removed on
   close).
2. `auth.mintSession` self-describing: catalog `inputSchema` + `guide`
   anchor authored through `control-catalog/operability-overrides.json`;
   the canonical exact-HTTP mint section moved to
   `guide/operating/host-ops.md` (sessions-and-principals now points at it;
   native-apps links it); the mint-path `SNAPBACK_AUTH_REQUEST_INVALID`
   refusal carries `operation`, the expected argument contract, and a
   resolving anchor; HTTP cases pinned in `crates/snapback/tests/host_ops_v0.rs`;
   `snapback guide SNAPBACK_AUTH_REQUEST_INVALID` now lists every
   registry anchor (reference-lookup prints the flat `guideAnchors`
   array, not just the first).
3. Retrieval regression closed: retrieval-eval case 41 (session-mint
   identity broker; case 25 and all existing cases retained) green under
   the static routing check, plus a retained cold-agent eval transcript
   under `guide/eval-runs/2026-08-10/`.
4. LLP 0193 carries the dated grading-unit amendment; the
   `SNAPBACK_AUTH_REQUEST_INVALID` per-context grading is recorded there
   ahead of the Phase 1 ledger (`tests/acceptance/diagnostics/` has not
   landed), exactly as this Plan's ticket 4 provides.
