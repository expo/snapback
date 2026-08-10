# LLP 0223: Zero-config connect DX and knowledge-gap closure

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Expo client, Auth, Diagnostics, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
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
and undersold as the answer to "where do I put the URL?", and that the two
knowledge gaps have no retrieval key in the guide. This Plan is deliberately
thin: four tickets under the existing issue, no new subsystem, no new
documentation transport.

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
`.env*` file created or modified) and documenting it as the direct answer
to the Convex comparison. A persistent exported connection artifact is
explicitly rejected: every durable copy of a rendezvous origin or binding
is a stale-lifecycle bug waiting for the next supervisor generation, and
the transient descriptor already serves inspection without surviving as
configuration. If injection ever becomes unreliable (Expo SDK change), the
fallback is a generation/expiry-bound file under `.snapback/` — never an
ambient `.env.local`.

**Knowledge closure grades per emitting context, not per code.** LLP 0193's
unit of repair tightens: `SNAPBACK_AUTH_REQUEST_INVALID` has five emitting
sites (`guide/reference/diagnostics-registry.json` ~20467, `guideAnchor`
currently null); one generic URL would misroute four of them. The mint
emission must name `auth.mintSession`, its expected argument contract, and
the precise guide target. Branches that emit no error stay with LLP 0061's
diary/retrieval loop — that mechanism demonstrably worked for the
persisted-receipt gap — and this Plan does not pre-decide LLP 0146 OQ6's
structured-remediation carrier; diagnostic `details`, message text, and
build-bound relative anchors are sufficient for this tranche.

## Design detail

- **Connect invariant.** Surfaces: `packages/snapback-cli/expo-dev.mjs`
  (injection in `startMetro`; descriptor write after readiness emit), its
  loop tests, and the `expo-chat` scaffold acceptance. Semantics to pin:
  clean generated app → provider `ready` with zero manual config; no
  `.env*` created or mutated; descriptor stays transient, mode 0o600. If
  current readiness events do not make the carrier inspectable, add a
  structured fact such as `connectCarrier: "supervisor-rendezvous"`.
  Generic existing-Expo-project onboarding is the already-recorded
  `clients.compose-existing-app` GAP (an idempotent `snapback init --expo`
  installing plugin/provider, not a URL) and stays on its own ticket.
- **Mint self-description.** `MintSessionRequest` (`src/auth/wire.rs` ~344)
  stays the type authority. Populate the ControlCatalog `inputSchema` for
  `auth.mintSession` — the field exists in the catalog schema (other
  entries carry it) but this entry has none. In `auth_host_operation_input`
  (`src/server.rs` ~19709), make the mint-path failure include safe
  contextual details — `operation`, `expectedArgumentContract`, a resolving
  anchor — preserving the stable code. The documented body is the shipped
  CLI projection, `{"operation":"auth.mintSession","args":{"email":"…"}}`
  (`mint_session_request`, `src/cli.rs` ~3861); document the exact
  headers/body and the HTTP-200 `hostOpsResult` envelope in
  `guide/operating/host-ops.md`, linked from `guide/auth/native-apps.md`,
  keeping admin/impersonation authority server-side and the operation
  scoped to local dev/test/demo.
- **Compatibility.** Additive throughout: no app migration, no `.env.local`
  cleanup, no error-code changes. ControlCatalog and guide digests rotate
  normally; messages/details may improve under existing compat rules.

## Tickets

1. **Prove the zero-config connect contract.** Scaffold acceptance: fresh
   generated app connects with zero manual config, zero `.env*` writes;
   add the `connectCarrier` readiness fact if needed; assert descriptor
   transience/permissions. Proof: the new acceptance run green in the
   `expo-chat` scaffold suite plus expo-dev loop tests.
2. **Make `auth.mintSession` self-describing.** Catalog `inputSchema`,
   contextual mint refusal details, host-ops guide section with exact HTTP
   request/response, linked from auth/native-apps. Proof: valid + invalid
   HTTP cases pinned in `tests/host_ops_v0.rs`, including secret-negative
   assertions; `snapback guide SNAPBACK_AUTH_REQUEST_INVALID` routes the
   mint context correctly.
3. **Close the retrieval regression.** New `guide/retrieval-eval.md` case:
   implement a trusted server-side identity broker using `auth.mintSession`
   over HTTP; fail on guessed bodies, per-login shell-outs, a missing
   authority carrier, or operator credentials in an app bundle. Existing
   cases (25 incl.) are retained, not replaced. Proof: the eval case lands
   and passes under the guide check.
4. **Tighten LLP 0193 minimally.** Dated clarification: shared codes are
   graded and repaired per emitting context; wrong-shape refusals get an
   inline expected contract or exact reference; no-refusal behavioral
   surprises route to LLP 0061. No new wire member. Proof: the amendment
   plus a registry note that `SNAPBACK_AUTH_REQUEST_INVALID`'s anchors are
   per-site.

## Open questions

- **OQ1 — Re-open trigger for option 3.** If two more independent builds
  need detached Metro or a custom client process and cannot consume the
  supervisor descriptor, a run-scoped `snapback connect` export becomes
  justified. Until then it stays rejected.
- **OQ2 — Post-fix residual.** If measurements after ticket 2 still show
  search after an A-grade refusal, that is evidence to accelerate LLP 0146's
  structured remediation carrier — not evidence for universal absolute URLs.

Evidence caveat: the B9 figure is one pilot lane, builder-self-scored
(nulls-block-totals; graders unrun). This Plan treats it as a defect report
with two named reproductions, not as a calibrated competitive claim.
