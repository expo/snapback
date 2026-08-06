# LLP 0176: Expo messaging golden-path program

**Type:** Plan
**Status:** Review
**Systems:** React/Expo, Client integration, Assets, Auth, Live queries,
Ephemeral state, Code generation, Developer experience, Packaging, Local
server lifecycle, Testing, Competitive evaluation
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-06 (r) — Closed (q)'s per-OS nonclaim: text-only and one
picked-image send now share the same typed `chat.commands.send` call under
one ordinary session on a real iOS simulator and Android emulator (system
photo pickers, delivery URLs rendered, the visible negative truthfully
`cancelled`, residue staying `inferred | unknown`); E2's picker adapter
registered through the provider. Supervised simulator/emulator evidence
only; Status remains Review and G4/G5, release, physical-device, offline,
background, restart, and attempt-grant claims remain open.
2026-08-06 (q) — Appended the G3 exit receipt: LLP 0179 S2 and
LLP 0180 C0/C1 landed at `17e7ca8ca`, text-only and one-image send share one
`chat.commands.send` call in the Expo fixture, and the acceptance evidence and
its explicit nonclaims (C2, per-OS command evidence, published packages) are
recorded there, together with the dual-implementation collision this gate
produced and the reduce-and-reland that resolved it. Status unchanged.
Earlier same day (p) — sitting #4 ruling on the dev-persona owner: when LLP 0181 E1 concretely needs the declared-dev-persona contract, LLP 0039 receives a narrow dated amendment authorizing that contract only — no general unfreeze, nothing now. 2026-08-06 (o) — G2 exit complete: the north-star conversation
surface passed the repaired headless checkpoint and real iOS-simulator and
Android-emulator runs, with one canonical query/presence owner and all owned
resources reclaimed. This corrects (m)'s premature exit wording; Status stays
Review and no physical-device, release, LAN-carrier, or LLP 0064 claim follows.
Earlier same day (n) — Corrected G2's repair-rerun exit claim: the checkpoint
and headless-React evidence are complete, but the iOS-simulator and
Android-emulator surface receipts remain pending, so G2 is checkpoint-complete
rather than exited. Earlier same day (m) — G2 repair rerun: descriptor preparation now
reuses LLP 0114's persisted binding-receipt/RQS owner, and the real-runtime
surface witness renders all three retained messages with retained/refreshing/
stale facts offline. Half 1 remains PASS, Half 2 is now PASS (18/18), G2 exits,
and G3 is unblocked; the original FAIL record remains below as checkpoint
history. Earlier same day (l) — G2 falsification checkpoint: the Relay Room
surface rebuild passed the frozen shrinkage bar but failed process-cold
retained rendering because AppDescriptor binding preparation cannot adopt the
legacy persisted receipt offline; G2 remains open, G3 is halted, and Status
remains Review. Earlier same day (k) — G1 exit complete: the author accepted LLPs
0179/0180, whose acceptance amends LLP 0114 with the `useSurface` and
`useSnapbackCommand` named projections (see LLP 0114 §Named projections
from accepted RFCs); combined with the two receipt halves below, every G1
exit condition is met and G2/G3 React semantics are settled.
2026-08-06 (j) — Appended the G1 Android-emulator half receipt.
The same no-URL Expo fixture reached ordinary Sessions authority, a seeded
live query, and an ordinary mutation observed through that live query via
three verified `adb reverse` rules over host IPv4-loopback listeners. Together
with the iOS receipt, G1's no-URL boot exit evidence is complete for
simulator/emulator; this is still no physical-device or LLP 0064 capability
claim, and document Status remains Review. Earlier same day (i) — Appended the G1 iOS-simulator half receipt:
the no-URL Expo provider reached ordinary Sessions authority, a seeded live
query, and an ordinary mutation observed through that live query over three
verified IPv4-loopback listeners. Android/emulator evidence remains pending
and document Status remains Review. Earlier 2026-08-05 (h) — G0 exit receipt appended under the existing G0
gate: the messaging fixture now proves session mint → external-session client
→ ordinary asset upload → typed attach → embeddable delivery, plus the
anonymous-public owner/caller 403 after fixing the asset client's dropped
auth/rr offer; document Status remains Review. Earlier same day (g) — A3/A4 friction tickets resolved: marker-walk
root resolution in `demos/_kit/repo-layout.mjs` and the paved out-of-checkout
EAS staging helper `demos/_kit/eas-stage-build.mjs`; ticket pointers updated
to `issues/closed/`. Earlier same day (f) — Super-refine round 1 revision (dual-family
review at `llp/reviews/0176-expo-messaging-golden-path.{claude,gpt-5}.md`;
journal at `.run.md`): reframed G0's dev-session primitive as a thin,
source-cited wrapper over the existing `auth.mintSession` host-op with an
explicit routed ask to the auth/host-ops owner for the persona-naming policy
layer, rather than an asserted, self-contained mechanism; attached source
citations to every "already exists" claim in the set (admin console,
relational-query profile, presence hook, optimistic mutation, asset-client
bearer forwarding); corrected the LLP 0168 citation to the current document
(`browser-carrier-dev-edge.research.md`, which superseded and states no
requirements survive from the earlier `single-origin-dev-edge` draft this
Plan had been citing) and its actual current stance (do not build a LAN/
tunnel dev edge on the present record); generalized the "no LAN-reachable
development edge" acceptance criterion to every owned listener, not only the
backend; deferred the `assets`-under-`surfaces` namespace decision to LLP
0179's own open question instead of asserting it here; typed command residue
as `authoritative | inferred | unknown` in G3's exit; made G4's per-OS
evidence exit conditional on an actual device-evidence path rather than
simulator/emulator receipts; gave the G2 falsification checkpoint an
explicit two-sided (shrinkage-and-fact-preservation) rule; and mapped LLP
0179's S2 slice into G3. Status moved Draft → Review with this revision, the
skill's one authorized transition at loop start. 2026-08-05 (e) — Gave G0's
dev-session repair its own named, standalone mechanism instead of silently
depending on LLP 0181's later supervised bootstrap; added an explicit
mid-program falsification checkpoint to G2 instead of deferring the first
bakeoff-comparison measurement to G4; recorded the deliberate reasoning for
keeping LLP 0179 and LLP 0180 as separate documents; and cross-referenced
the admin-console discoverability fix into LLP 0181's boot diagnostics.
2026-08-05 (d) — Recast as the umbrella experience plan for LLPs 0177–0181;
established `AppDescriptor` and `AppBinding` as the two shared concepts;
separated ordinary mutations, composite commands, and raw asset tasks;
removed attempt grants and LAN relay from the critical path; and replaced
RFC-by-RFC delivery with vertical golden-path gates. Earlier revisions
incorporated three independent messaging bakeoffs and graduated the
strongest follow-up ideas into LLPs 0177–0181.
**Related:** LLP 0000, LLP 0017, LLP 0041, LLP 0044, LLP 0055, LLP 0057, LLP
0058, LLP 0061, LLP 0064, LLP 0080, LLP 0103, LLP 0105, LLP 0114, LLP 0115,
LLP 0120, LLP 0130, LLP 0146, LLP 0152, LLP 0157, LLP 0168, LLP 0171, LLP
0172, LLP 0173, LLP 0174, LLP 0177, LLP 0178, LLP 0179, LLP 0180, LLP 0181;
Diaries 0058–0060

## Summary

Three independent 2026-08-05 bakeoffs built the same WhatsApp-shaped Expo
application on Snapback and Convex. They converged on the same result:
Snapback's underlying facts and safety properties are strong, especially for
ephemeral presence and typed assets, but a common screen must assemble too
many infrastructure-shaped pieces. Image send is particularly revealing: one
product action currently exposes an upload protocol, a separate mutation, and
an authority mismatch that every bakeoff had to work around.

This Plan defines the product experience and delivery order for fixing that
class of problem. It is deliberately the only umbrella document in the set.
The sibling LLPs own bounded mechanisms; they do not each invent their own
application model:

```text
0176 experience plan
        |
        v
AppDescriptor (0179, stable and environment-independent)
  |- api          existing generated queries and mutations
  |- commands     bounded client compositions from 0180
  `- surfaces     application-shaped bindings from 0179
        |
        v
AppBinding (0181, environment-specific)
        |
        v
@expo/snapback-expo provider + plugin (0181)
```

LLP 0178 validates authoring before it becomes this descriptor. LLP 0177 is
research evidence for the existing relational/aggregate decision process and
is not on the golden-path critical path.

The north-star application code is:

```json
{
  "expo": {
    "plugins": ["@expo/snapback-expo"]
  }
}
```

```tsx
import { SnapbackExpoProvider } from "@expo/snapback-expo"
import { app } from "./snapback/generated/app"

export default function Root() {
  return (
    <SnapbackExpoProvider app={app}>
      <Routes />
    </SnapbackExpoProvider>
  )
}
```

```tsx
const chat = useSurface(app.surfaces.conversation, { conversationId }, {
  presence: { typing: isTyping ? {} : skip },
})

chat.data.messages
await chat.mutations.react({ messageId, emoji })

const send = chat.commands.send({ body, image: picked })
const { kind } = await send.done
if (kind !== "committed") showSendProblem(kind) // "failed" and "ambiguous" are not the same UI
```

No URL prop, upload coordinator, hand-written provider boot state, Metro alias,
or repeated `conversationId` is required on the common path. The richer query,
mutation, presence, asset, and task APIs remain available and authoritative.
The typing publish payload deliberately carries no `userId` — a reviewer
correctly found an earlier draft let application code assert another
participant's identity into presence data with nothing establishing that
the field was validated; self identity in every presence lane derives from
the adopted session, never from application-supplied publish data (see LLP
0179 §React projection).

## Authority and document boundaries

This Plan owns the workload, experience contract, sequencing, and integrated
acceptance proof. It does not amend subsystem semantics by implication.

| LLP | Owns | Explicitly does not own |
| --- | --- | --- |
| 0176 | Golden-path outcome, evidence, priorities, vertical gates | Descriptor grammar, command semantics, Expo binding protocol |
| 0177 | Demand evidence for aggregate and first-related-row queries | Query grammar or a shipping decision |
| 0178 | Generate-time validation/advisory mechanism | The semantics each check enforces |
| 0179 | Stable `AppDescriptor`, surface declarations and projections | Environment discovery, transport, cache, auth, asset lifecycle |
| 0180 | Bounded asset-bearing client command composition | Attempt grants, generic workflows, server transactions |
| 0181 | `AppBinding` and the Expo package/provider/plugin projection | Stable app vocabulary or a public development edge |

Existing authorities remain binding:

- LLP 0114 owns canonical stores, rooms, mutation attempts, hook lifecycle,
  and cleanup. Surfaces and Expo hooks are projections over those owners.
- LLP 0044 owns asset policy, attempts, attachment, delivery, processing, and
  authorization. A command composes those facts; it does not replace them.
- LLP 0157 requires author-facing sugar to compile to an admitted algebra or
  refuse. Neither a surface nor a diagnostic may smuggle in a new query node.
- LLP 0146 owns typed remediation vocabulary. LLP 0178 and LLP 0181 reuse it.
- LLP 0168 (`browser-carrier-dev-edge.research.md`, `Status: Research/Draft`)
  governs any non-loopback development edge. A Metro listener on a LAN is a
  network front, even if the backend behind it remains loopback-only. An
  earlier revision of this Plan cited a stale filename
  (`single-origin-dev-edge.rfc.md`); that RFC never landed — it went through
  three super-refine rounds without converging and was explicitly superseded,
  with "no edge decisions from that draft surviv[ing]" into the current
  document. The current LLP 0168's own recommendation, as of this citation,
  is **do not build a LAN/tunnel dev edge on the present record**; reopening
  the question requires named demand evidence and an on-paper auth-boundary
  answer (its §Go/no-go gate, preconditions A1-A3) before an implementation
  is even authorized, and running-code proof (B1-B5) before acceptance. G5
  below is written to match that posture, not to assume 0168 already
  contains a ready-to-implement requirements list.
- LLP 0064 retains per-OS React Native/Expo capability qualification.
- LLP 0041/0171 own packaged supervision; LLP 0103/0105 own hosted and EAS
  target facts; LLP 0172/0173 own function-auth defaults.

Acceptance of this Plan approves the direction and ordering. It does not make
the Draft mechanisms in sibling LLPs implemented.

**Why LLP 0179 and LLP 0180 stay separate documents.** A command is a node
inside `AppDescriptor`, and the two RFCs necessarily ship in lockstep, so
merging them was considered. They stay split because their failure-mode
vocabularies do not overlap: LLP 0179's are declaration-time (unknown
parameter, ambiguous binding, budget refusal); LLP 0180's are execution-time
across two independent trust boundaries (asset transfer, mutation commit —
retry, ambiguity, finalized-but-unattached residue, authority replacement
mid-task). This repository's own precedent (LLP 0080 kept distinct from LLP
0110 and LLP 0120 despite all three sharing one query-planning frame) favors
narrow documents over consolidated ones for exactly this reason: combining
unrelated complexity classes makes each easier to skim and harder to review
completely. The cost is real — two authority tables and two delivery programs
to keep synchronized — and future editors should re-open this question if
that sync cost proves worse than the review-clarity benefit in practice.

## Evidence boundary

The evidence is three independent same-brief experiments:

1. Tandem (`demos/tandem-expo-bakeoff`, Diary 0059) used one Expo UI over
   independently authored Snapback and Convex backends. Both passed 8/8
   behavior checks and an EAS development-client build. Snapback required a
   hand-built session/backend launcher and more application glue.
2. Relay Room (`demos/relay-room-bakeoff`, Diary 0058) independently found the
   same provider, package, EAS, and image-upload friction while confirming
   that Snapback presence eliminated a durable table and cleanup protocol.
3. Snapback Messenger versus Convex Messenger (Diary 0060) commissioned two
   separate implementations, then compared them. It independently reproduced
   the asset-authority defect and the need to hand-author aggregate/reply
   query logic.

The experiments establish a strong repeated demand signal for a real-time,
media-bearing, presence-aware Expo application. They do not establish broad
framework superiority, production scale, offline durability, Android/iOS
parity, or safe public development exposure. Those require their own receipts.

## Consolidated issue catalog

The plan retains the original findings so architectural work does not eclipse
the cheaper mechanical fixes.

### Development and packaging

- **A1 — managed load framing (resolved 2026-08-05).** `snapback dev` now
  accepts the sequential `schema.load` and `functions.load` JSON documents
  emitted by a valid native load while refusing a failed envelope or malformed
  stream. Resolution:
  `issues/closed/20260805-managed-dev-multi-json-load.md`.
- **A2 — local package closure.** A file-installed client still resolves its
  exact Contract dependency from the registry. Tickets:
  `issues/20260805-local-source-package-closure-needs-contract-override.md`
  and `issues/20260803-first-npm-latest-promotion.md`.
- **A3 — nested EAS roots.** EAS resolves the repository Git root instead of
  the nested app, leading two bakeoffs to invent staging copies. Resolved
  2026-08-05: the staging workaround is the paved path
  (`demos/_kit/eas-stage-build.mjs`, documented in
  `guide/clients/react-expo.md`). Ticket:
  `issues/closed/20260805-eas-nested-app-git-root-monorepo-archive.md`.
- **A4 — nested headless fixtures.** `openHeadlessApp` assumes a one-level demo
  layout. Resolved 2026-08-05: marker-walk root/app resolution in
  `demos/_kit/repo-layout.mjs`. Ticket:
  `issues/closed/20260805-headless-app-nested-demo-root.md`.
- **A5 — edit recovery.** A comment-only source change can alter complete
  artifact identity, correctly refuse the old store, and leave no supported
  successor path. Ticket:
  `issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md`.

### Authoring and diagnostics

- **B1 — optional argument contradiction.** Generated caller types permit an
  omitted `v.optional` argument while `arg(...)` in a declarative plan refuses
  it. Ticket: `issues/20260805-declarative-optional-arg-plan-missing.md`.
- **B2 — stored structured fields.** `v.array(...)` is not a table-field
  validator. The immediate refusal/guide can improve, but native structured
  storage remains LLP 0115 CV-4b. Ticket:
  `issues/20260805-guide-gap-table-array-field-validator.md`.
- **B3 — document spread.** Spreading a stored row into a narrower closed
  result leaks system fields and fails only at execution. Ticket:
  `issues/20260805-result-contract-violation-hashes-field-path.md`.
- **B4 — auth omission.** The omission default is an Impact-5 adjacent issue
  owned by LLP 0172/0173, not evidence from these bakeoffs. Ticket:
  `issues/20260805-function-auth-omission-default.md`.

### Assets, presence, and client composition

- **C1 — ordinary client upload authority, corroborated 3x.** In the tested
  dev path the Expo caller reaches upload as anonymous while the declared
  owner requires a principal. The existing asset client already forwards an
  ordinary session bearer when one exists — `packages/snapback-client/assets.mjs`
  reads the bearer off the parent client's authority fence (or an accepted
  external-session bearer) and attaches it to every asset request the same
  way the client's own request lane does. A round-3 review correctly found
  the *server-side* refusal-of-a-bare-bearer half of this claim exceeds what
  the cited client-side excerpt establishes — the client-side forwarding
  behavior is confirmed; this document does not independently verify the
  server's own enforcement and states only the client half as cited fact.
  So the golden-path fix is to provide a paired guest/dev session
  (§Product decisions "Ordinary authority first"; G0's `session mint`
  primitive above), not to invent a second credential or plumbing the asset
  client does not already have. Tickets:
  `issues/20260805-expo-asset-upload-guide-gap.md` and
  `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`.
- **C2 — public delivery headers.** `public-immutable` responses are not
  cross-origin embeddable as documented. Tracked with C1's guide-gap ticket.
- **C3 — weak React task types.** React re-spells existing asset task types as
  `unknown`. Ticket: `issues/20260805-react-asset-upload-task-types.md`.
- **C4 — Expo picker bridge.** The working picker/content-URI conversion is
  undocumented and repeated by apps. Tracked with the Expo asset guide gap.
- **D1 — presence vocabulary.** Scoped `useSnapbackPresence` already ships,
  but builders searching for “ephemeral” did not find it. Ticket:
  `issues/closed/20260805-guide-gap-ephemeral-presence-hook-naming.md`.
- **E1 — provider and application composition.** Two or more experiments
  independently hand-built provider boot and repeated resource scope across
  reads, mutations, presence, and assets. This is the design gap owned by LLP
  0179/0181.

## Product decisions

### One stable app description

LLP 0179 emits exactly one environment-independent `AppDescriptor`. It is the
language-neutral application vocabulary for existing API references,
asset-bearing commands, and application surfaces. Standalone generated
exports may alias nodes from this tree; they are not separate authorities.

### One environment binding

LLP 0181 resolves exactly one `AppBinding` for a running client. Development
and release are variants of the same closed schema, distinguished by
`source: "supervised-dev" | "release"`. A binding carries public endpoint,
identity, capability, and provenance facts. It does not carry or mint session
authority.

### Three deliberately separate action namespaces

A bound surface exposes:

- `mutations`: an ordinary generated mutation call returning its existing
  promise/result;
- `commands`: a bounded client composition returning a task with `.done` and
  observable child facts; and
- `assets`: the advanced raw asset-task API, when a surface declares it.

They are not merged behind one misleading return type. A caller can tell from
the namespace whether it is starting one server mutation, a multi-phase
client command, or a raw asset attempt.

The `assets` namespace is a descriptor-grammar question this Plan does not
own (§Authority and document boundaries: "Descriptor grammar" belongs to
LLP 0179) — it is decided in LLP 0179 itself (closed grammar bullet list and
§React projection), which this Plan cites rather than restates. A round-1
review found the earlier text pre-deciding this in 0179's territory while
0179 still listed it open; round 2's fix instead deferred the decision here
entirely and pointed at 0179's then-open question 3. A round-3 review
correctly found that pointer now dangling — 0179 closed OQ3 with an
explicit "yes" and renumbered its remaining questions, so an unqualified
reference to "0179's open question 3" no longer resolves to this topic.
This section is restated to reflect the settled outcome directly instead of
carrying a citation that requires the reader to know 0179's revision
history to resolve.

### Ordinary authority first

The image-send v1 uses the same ordinary paired guest/dev or signed-in session
as every application route. The upload client already knows how to forward
that bearer. Attempt grants may later continue a previously admitted attempt
through native background transitions, but they are neither a solution for an
absent principal nor a prerequisite for the golden path.

### One owner, many projections

Every convenience API delegates to existing canonical stores, mutation
attempts, presence rooms, and asset tasks. No surface, command, or Expo package
creates an alternate cache, synchronization protocol, auth model, or backend
endpoint merely to feel simpler.

### Security claims follow reachability

Simulator loopback and `adb reverse` can provide zero-URL development without
making the backend public. A physical-device Metro LAN relay is different: it
makes a front reachable by peers and may carry session secrets over plaintext
— and, per LLP 0168's own established finding, a loopback-bound server behind
an undeclared front still infers the loopback-derived `dev` profile, so the
danger is not limited to Metro specifically: **every** owned listener a
supervised session forwards through (Metro included) needs the same scrutiny,
not only a hypothetical future LAN relay. It cannot enter an accepted gate
until LLP 0168's eventual successor RFC — reopened only after its own
preconditions are met — states and proves route-policy, access, transport,
origin, redaction, and adversarial requirements, per its current §Go/no-go
gate.

## Vertical delivery program

Delivery proceeds as usable vertical slices. Completing one sibling RFC in
isolation is not progress if the fixture still needs the same workaround.

### G0 — baseline truth and mechanical repair

- Repair A1–A4, C3, the public-delivery mismatch, and the most precise existing
  diagnostics.
- Pave, as one small standalone CLI primitive, what all three bakeoffs already
  hand-built. The underlying mechanism is verified, cited source, not an
  inference, and a round-2 delta review's precision correction is folded in
  here — the two gates below are separately established facts, not one
  conflated claim: `auth.mintSession` is a real host-op (`src/host_ops.rs`'s
  `HOST_OPS` table; dispatched at `src/server.rs:17691-17740`). First,
  `src/admin.rs`'s `operation_profile` maps `"auth.mintSession"` to
  `OperationProfileRequirement::NonProd`, refusing it outside dev/demo/test —
  the same `NonProd` requirement class `"asset.put"` and its sibling
  operator/asset operations map to in the same match, though this document
  does not independently verify those two operations share every additional
  check `auth.mintSession` carries beyond that class. Second, `src/cli.rs`
  tests separately assert that a `auth.mintSession` host-op call carries the
  impersonation-capability header; this document does not have a citation
  establishing that the *same* header-level requirement applies to
  `assets put`, so the "exact same gate" comparison from an earlier revision
  is narrowed here to "the same `NonProd` profile class," which is what's
  actually shown. Its handler takes a `MintSessionRequest { email, .. }`,
  calls the real auth provider's ordinary `admit_email` admission path, and
  mints a session through the same `coordinated_mint_session` machinery a
  genuine user's sign-in would use (`src/server.rs:17716-17740`) — not a
  distinct or weaker authority class, and only reachable when the app is
  already running in settled, available Sessions auth mode
  (`src/server.rs:17691-17701`).
  A thin CLI wrapper over exactly this host-op — invocable only by a local
  process that already holds the impersonation capability, returning *only*
  the minted ordinary session to its caller, never that capability itself —
  is therefore a faithful paving of an existing mechanism, not a new
  authority class. G0 ships that wrapper against the host-op's real argument
  shape: `snapback session mint --email <address>`. It decides no open
  auth-default policy.
  What G0 does **not** invent is the nicer `--dev-persona <name>` UX every
  bakeoff broker approximated (a human-readable name resolving to a declared
  identity, with its own admission list, TTL, revocation, and audit trail).
  That is real, undesigned policy — this Plan does not own auth semantics
  (§Authority and document boundaries) and should not assert one inside a
  CLI flag.
  A round-3 review, checking this ask against the actual content of the
  documents it names, found the routing itself wrong: LLP 0055's own scope
  states plainly that the operator plane "already has carriers (the admin
  token, `AdminWrite`, `AdminSecretRead` leases, `ImpersonationCapability`),
  and this RFC does not extend it" — `auth.mintSession`'s gate is exactly
  that plane, so 0055 disclaims this ask by name. LLP 0057 owns the
  operator impersonation carrier and the local auth-provider protocol, but
  states just as plainly that it does not amend or reinterpret LLP 0039
  where 0039 has pinned an outcome ("Where 0039 pins an outcome, 0039
  wins"), and 0057 is Draft/FROZEN. A new persona-admission policy is
  exactly the kind of pinned outcome that framing protects, not a wire/
  storage/constant detail 0057 was left free to fill in.
  **The likely real owner is LLP 0039 itself** — frozen, which is a bigger
  and more consequential ask than "accept a narrow contract": it may
  require an explicit unfreezing/amendment decision at 0039 before any
  persona layer can be accepted at all, not merely a routine review. This
  Plan does not have the authority to make that call and does not attempt
  to; it records the ask precisely instead of leaving it addressed to
  documents that have already disclaimed it. LLP 0058's relevance is
  unconfirmed — this capsule/pass did not establish it either way.
  G0's raw-email primitive works today and needs no such contract; the
  friendlier persona layer is gated on that unfreezing/acceptance decision,
  not on this Plan's schedule. LLP 0181 E1's automatic supervised bootstrap
  builds on
  whichever of the two (raw email, or the accepted persona contract) is
  available when it lands — it does not assert its own, separately-derived
  security properties for the exchange (see LLP 0181 §Provider).
- Close package/archive inputs and surface already-shipped presence,
  relational-query, optimistic-mutation, and admin-console capabilities in
  the guide — each cited, not merely asserted: `useSnapbackPresence` in
  `packages/snapback-react/index.d.mts`; `defineRelationalQuery`/
  `defineMaintainedProjection` in `guide/backend/relational-queries.md` (the
  page's own frontmatter reads `maturity: partial` — a round-3 review
  correctly distinguished this from the capability claim below rather than
  letting the two be read as agreeing or disagreeing: `maturity: partial`
  describes this guide *page's* content completeness, e.g. it does not yet
  cover every profile or example; it is a different field from LLP 0080's
  own header `Status: Implemented` and the `relational_query_v1` capability
  registry entry, which is what actually governs whether the capability
  ships. Both facts are cited so a reader checks the one that answers their
  actual question instead of conflating the two); optimistic mutations in
  `packages/snapback-client/optimistic-rebase.d.mts` and
  `guide/recipes/optimistic-toggle.md`; the admin console in
  `guide/operating/admin-console.md` (`status: current`, `maturity: shipped`)
  under LLP 0017, `Status: Accepted`. These four are independently checkable
  by opening the named file and reading its stated status — a round-2 review
  correctly noted that a review capsule built only from LLP-document
  excerpts cannot itself carry every guide/package file's content to prove
  this inline, which is a limitation of how that capsule was built, not a
  claim this Plan is unable to support with a real citation.
- Land LLP 0178's first unsuppressible contradiction checks independently of
  the descriptor work.

**Exit:** the existing low-level APIs can run the fixture — including a real
image upload authorized by a `snapback session mint --email`-issued session —
without shelling out to `snapback assets put`'s admin-impersonated path
directly from application code, a private package alias, or a known
late-discovered contradiction. The mint command itself still requires local
operator credentials to invoke, requiring the same `NonProd` profile class
`assets put` requires (both round-2 and round-3 review confirmed this exact
narrower framing is what the cited source supports — see the two-gates note
above; this is not restated here as "the exact same gate" a third time).
G0's win is a documented, correctly-shaped one-liner in place of an
app-specific broker, not the removal of the operator step. This is a
deliberately lower
bar than "zero commands typed": G1 is where session issuance becomes
automatic, and the friendlier persona layer ships only once the auth owner
accepts the routed ask above.

**G0 exit receipt — 2026-08-05.** The repository acceptance path at
[`demos/messaging-snapback/tests/acceptance/headless.mjs`](../demos/messaging-snapback/tests/acceptance/headless.mjs)
now passes 11/11 and proves the exact low-level chain: operator-custodied
`snapback session mint --email` returns an ordinary bearer,
`createExternalSessionClient` adopts it, the ordinary asset client completes
reservation/TUS/finalize, `sendMessage` performs typed attachment, and the
public rendition is cross-origin embeddable. Its anonymous-public companion
offers auth/rr without a bearer and is refused HTTP 403 at the attempt's
owner/caller boundary. The build experience and remaining friction are in
[Diary 0058](../diaries/0058-messaging-snapback.diary.md#2026-08-05--g0-exit-evidence);
the late-discovered protocol projection defect and resolution are recorded in
[`issues/closed/20260805-anonymous-public-asset-client-drops-auth-protocol-offer.md`](../issues/closed/20260805-anonymous-public-asset-client-drops-auth-protocol-offer.md).
This closes G0 evidence only; it does not advance this Plan's Status or claim
G1's automatic session issuance.

### G1 — descriptor and binding spine

- Emit the stable `AppDescriptor` with existing `api` nodes and capability
  facts.
- Resolve one development `AppBinding` and admit it against the descriptor.
- Publish the `@expo/snapback-expo` provider/config-plugin skeleton.
- Obtain LLP 0114's acceptance of the amendment LLP 0179 (`useSurface`) and
  LLP 0180 (`useSnapbackCommand`) each state they need — a round-3 review
  correctly found this program treats both hooks as delivered at G2/G3 while
  no gate ever schedules the step of actually getting LLP 0114's real owner
  to accept them, leaving both RFCs' own "proposed, not settled" caveat
  permanently true in practice. This gate is where that acceptance is
  obtained, before either hook's semantics are exercised at G2.
- Prove no-URL boot on iOS simulator and Android emulator using loopback or
  port forwarding, with no LAN backend exposure.

**Exit:** `<SnapbackExpoProvider app={app}>` reaches a live query and ordinary
mutation from a clean fixture, **and** LLP 0114 has accepted both the
`useSurface` and `useSnapbackCommand` amendments — so G2 and G3 can
truthfully call their React semantics settled rather than proposed.

**2026-08-06 iOS-half receipt.** The clean Expo SDK 57 fixture at
[`demos/expo-golden-path-fixture`](../demos/expo-golden-path-fixture/) ran in
Expo Go on a dedicated iOS 26.4 simulator on the fleet MacBook Air. It used
`snapback dev --expo`, supplied only `app={app}` to the provider, enumerated
bootstrap/backend/Metro on `127.0.0.1`, adopted ordinary Sessions authority,
observed the seeded row through the live query, dispatched the ordinary
mutation, and observed its row through that same live query. The raw
supervisor stream, binary provenance, cleanup evidence, and screenshot are in
[`20260806-g1-ios-simulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md).
This is the iOS-simulator half of the no-URL boot evidence.

**2026-08-06 Android-half receipt.** The same fixture ran in Expo Go 57.0.3
on the fleet Mac mini's Android 16 / API 36 AVD. `snapback dev --expo` selected
`adb-reverse`, supplied a `port-forward` binding whose app-side origins all
remained `127.0.0.1`, and owned exactly three verified reverse rules for
backend, Metro, and bootstrap. All host listeners independently enumerated as
`127.0.0.1`; the `10.0.2.2` fallback was not selected and no LAN listener
existed. The provider adopted ordinary Sessions authority, observed the seed,
dispatched the ordinary mutation, and observed `G1_ANDROID_PASS` through the
same live query. The raw supervisor stream, binary provenance, reverse-rule
and cleanup evidence, defects/fixes, and screenshot are in
[`20260806-g1-android-emulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md).

The iOS and Android halves are now both proven: **G1's no-URL boot exit
evidence is complete for simulator/emulator.** This completion makes no
physical-device, release, or LLP 0064 capability claim and does not change
this Plan's Status. Other G1 exit conditions remain governed by the gate text
above.

**2026-08-06 amendment acceptance — G1 exit complete.** The author accepted
LLPs 0179 and 0180, which per those RFCs' own §React projection text amends
LLP 0114 to add `useSurface` and `useSnapbackCommand` as named projections
over its canonical stores (recorded in LLP 0114 §Named projections from
accepted RFCs). With both receipt halves above, every G1 exit condition is
now met: G2 and G3 may truthfully call their React semantics settled.

### G2 — conversation surface

- Generate one `conversation` surface binding messages, details, reaction
  mutation, and scoped typing presence.
- Bind `conversationId` once and reuse LLP 0114's canonical stores/rooms.
- Preserve rich retained/error/capability facts alongside compact `data`.
- **Falsification checkpoint, before proceeding to G3.** Rebuild one bakeoff's
  conversation-list-plus-message-thread screen (Tandem's or Relay Room's)
  against the new surface API. The checkpoint has two required halves, not
  one — a reviewer correctly found that a shrinkage-only rule could pass by
  quietly dropping the facts this same document elsewhere calls mandatory
  ("Source brevity is a gate, not the only score," §Integrated acceptance):
  1. **Shrinkage.** Before implementation, freeze against the bakeoff
     original: the counted file boundary (which files count, whether
     generated/declarative code counts), hand-authored line count, number of
     distinct hooks/state objects touched, and count of manual
     cleanup/subscription-lifecycle lines. The rebuild must show a
     stated-in-advance minimum reduction on at least the line-count measure.
  2. **Fact preservation.** The rebuild must still reach and render every
     retained-data, partial/error, and capability fact the bakeoff original
     handled — same failure modes reproducible, not merely a happy path that
     got shorter because the unhappy paths were dropped.
  Passing only the shrinkage half does not pass the checkpoint. If either
  half fails, halt and revise the surface design before committing G3's
  asset-command work to it — a compelling API on paper that does not
  measurably help, or that hides degraded state to look simpler, is a design
  defect to catch here, not a G4 finding after two more gates are built on
  top of it.

**Exit:** the north-star read/mutate/presence snippet works in headless React,
iOS simulator, and Android emulator without duplicate subscriptions or cleanup
leaks, and the falsification checkpoint passes both halves against at least
one real bakeoff fixture.

**2026-08-06 falsification checkpoint — FAIL; Status unchanged.** Relay Room
was frozen as the cleaner comparison because its two Snapback-specific screens
place every low-level state beside the UI it drives and already contain zero
manual subscription cleanup. The `useSurface` rebuild passed Half 1 at 339
versus 510 physical screen lines (171 lines/33.5% smaller, beyond the frozen
26-line/5.0% bar). Half 2 failed frozen fact 6: after an online run persisted
both current message rows and the exact binding receipt, a fresh offline client
using the generated AppDescriptor refused during binding preparation before a
provider/surface could expose retained state. The descriptor intentionally
omits server-owned function interiors and the legacy receipt cannot reconstruct
the admitted deployment view, so `react-binding.mjs` rethrows connectivity in
descriptor mode instead of adopting the receipt. This is the checkpoint's
required design-defect outcome, not a partial pass: G2 has not exited and G3
setup is halted. Baseline, fact-by-fact result, reproduction, and verdict are in
[`20260806-g2-falsification-baseline.md`](../demos/expo-golden-path-fixture/receipts/20260806-g2-falsification-baseline.md);
the repair is tracked by
[`20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md`](../issues/20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md).

**2026-08-06 falsification checkpoint repair rerun — PASS.** The repair did
not add a surface-specific cache or receipt: descriptor-mode preparation now
persists and adopts the compact admitted deployment projection through LLP
0114's existing binding receipt and RQS store. The frozen Half-1 boundary was
unchanged and re-measured at 339 versus 510 physical lines (171 lines/33.5%
smaller), so Half 1 remains PASS. The real-runtime 5/5 acceptance now creates
a fresh offline client/provider/surface and renders all three retained message
rows through both `data.messages` and `state.messages`, with
`freshness: retained`, `status: refreshing`, and `connection: stale`; the
unchanged capability refusal remains typed. Together with the original 17
preserved facts, frozen fact 6 is now preserved and Half 2 passes 18/18. G2
has exited and G3 is unblocked. The append-only command/result record is in
[`20260806-g2-falsification-baseline.md`](../demos/expo-golden-path-fixture/receipts/20260806-g2-falsification-baseline.md),
and the resolved defect is in
[`issues/closed/20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md`](../issues/closed/20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md).

**2026-08-06 G2 exit-claim precision correction.** The preceding paragraph's
closing claim outruns its evidence: the falsification checkpoint is proven in
both halves—Half 1 at 339 versus 510 physical lines and Half 2 at 18/18 after
the repair—by the real-runtime
[`g2-falsification.mjs`](../demos/expo-golden-path-fixture/tests/g2-falsification.mjs),
and the Exit line's headless-React half is proven by
[`surface.test.mjs`](../packages/snapback-react/surface.test.mjs). The other
two halves are not yet proven: the north-star snippet has no iOS-simulator or
Android-emulator G2 receipt in
[`receipts/`](../demos/expo-golden-path-fixture/receipts/), and the 2026-08-06
per-OS receipts there are G1 boot receipts that do not exercise the surface
snippet. That per-OS work is in flight: both the iOS-simulator and
Android-emulator runs were executed in a concurrent fleet session whose
receipts had not landed on `main` when this note was written, and the exit
claim remains contingent on those receipts landing and being cited here.
Until then, **G2 is "checkpoint-complete, per-OS evidence pending"** rather
than exited; G3's unblocking remains subject to that contingency.

**2026-08-06 north-star device exit — PASS; G2 complete.** The fixture now
cold-opens one deterministic conversation and mounts the requested
`useSurface(app.surfaces.conversation, { conversationId }, { presence: {
typing: ... } })` shape. On both platforms it joined ordinary Sessions-provider
readiness, current `data.messages`, a `mutations.sendText` live echo, a
`mutations.react` live echo, and the connection-owned self-typing fact before
rendering its pass marker. The instrumented screen re-measures at 465 versus
the frozen 510 lines (45 lines/8.8% smaller and still beyond the advance bar).

The exact-current-runtime 5/5 acceptance pins five query stores/five upstream
subscriptions beside an equivalent low-level consumer, one presence
store/room subscription, and an all-zero resource vector after disposal; the
Strict Mode React test independently pins canonical query and presence owners.
The iOS supervisor reclaimed backend, Metro, and bootstrap, and the Android
supervisor reclaimed those processes plus all three `adb reverse` rules. The
dated, screenshot-backed receipts are
[`20260806-g2-ios-simulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g2-ios-simulator.md) and
[`20260806-g2-android-emulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g2-android-emulator.md).
All G2 exit arms now pass and G3 is unblocked. This is simulator/emulator and
supervised-development evidence only; it does not change this Plan's Status or
make a physical-device, release, LAN-carrier, or LLP 0064 claim.

### G3 — one online image-send command

- Generate one command with one optional image source and one ordinary
  mutation.
- Use the existing paired application session for reservation, transfer, and
  mutation; do not depend on attempt grants.
- Expose one command task derived from the existing asset and mutation child
  states, including residue.
- Admit LLP 0179 S2's command-reference slice as part of this gate — S2 is
  where the descriptor's `commands` namespace itself becomes admitted and
  budget-enforced, and it was previously unmapped to any gate. G3 cannot
  truthfully exit with a working command if the descriptor node it lives on
  was never generation-admitted.

**Exit:** text-only and one-image send share one typed call and pass negative
authority, retry, cancel, and no-false-atomicity tests. Residue is reported
as `authoritative | inferred | unknown`, matching whatever LLP 0044 can
actually prove at the time — G3 does not require LLP 0044 to expose a new
authoritative unattached-status fact it does not yet have; it requires the
client to never present an inferred value as certain. If LLP 0044 later
exposes the authoritative fact, this residue field upgrades in place.

**2026-08-06 G3 exit receipt.** Both halves are on `main`. LLP 0179 S2 — the
descriptor's `commands` namespace admitted beside `mutations` rather than
folded into it, with canonical-byte measurement and the existing ceilings
enforced — and LLP 0180 C0/C1 — the closed `asset-bearing-command.v1`
descriptor node and the command task over the existing asset-task and
mutation-attempt owners — landed together in
`17e7ca8ca feat(client,react,codegen,runtime): image-send command core + S2
commands admission`. The engine is
[`packages/snapback-client/commands.mjs`](../packages/snapback-client/commands.mjs)
with the `@expo/snapback-client/commands` subpath, `useSnapbackCommand` and
`surface.commands.<name>` ride LLP 0114 §Named projections, and the runtime
admits `AssetRef` argument contracts at mutation ingress (`src/manifest.rs`,
`src/args_contract.rs`) so the ordinary declarative mutation remains the sole
commit-bound attachment check. The Expo golden-path fixture gained
`sendMessage` + the upload intent + the `send` command with real-runtime
acceptance in
[`tests/g3-command.mjs`](../demos/expo-golden-path-fixture/tests/g3-command.mjs).

*The Exit's own bar.* Text-only and one-image send share one typed call;
negative authority, retry, cancel, and no-false-atomicity are covered. Measured
2026-08-06 against a locally built, handler-VM-qualified binary in a fresh
worktree at `96fd0ad1c`: `test:g3` **4/4** and `test:g2` **5/5**, with the
reduce-and-reland's added evidence in the same run — exact phase traces
(`preparing → committing → succeeded` for text-only, with every recorded
snapshot's `asset` null; `preparing → transferring → committing → succeeded`
for the image send; `… → failed` for the refusal), one attempt id / one asset
id / one mutation id across the whole image-send trace, a retry that re-adopts
the same asset and mutation identity rather than starting a shadow upload, and
a live `asset.inspect` witness that the finalized residue is still
`availability: 'ready'` and not deleted after the refusal. Residue
is reported as `authoritative | inferred | unknown` with the `authoritative`
branch reachable only when the asset child supplies a global authoritative
unattached fact — which today's runtime does not emit, so that branch is
covered synthetically and no live path overstates. See LLP 0180 §Delivery's
dated C0/C1 note for the residue routing to LLP 0044, and LLP 0179 §Delivery's
dated S2 note for the descriptor half.

*Dual-implementation collision — recorded so the record is honest.* Two
sessions built this gate concurrently without knowing it. The lane-claim
ticket `issues/20260806-g3-command-lane-plan.md` was filed at 08:23
(`da52b6eef`) precisely to prevent that; the other session landed
`17e7ca8ca` at 08:56 without reading or editing it, so the claim protocol
failed in exactly the way it was written to catch. The unlanded variant —
a different engine placement (inline in `packages/snapback-react/index.mjs`),
a richer descriptor node, a different diagnostic-code and remediation
vocabulary, live auth-barrier and disposal fencing of in-flight tasks, and
`inspectSnapbackCommands` accounting — is preserved on branches `g3/*`
(`g3/integration`, tip `d49ddeeb4`). **It is deliberately not re-landed**:
`main`'s engine is the one implementation, and the reduce-and-reland that
follows this receipt ported only the unique value that composes with it —
the non-React `app-inspection.mjs` consumer, the coverage `main` lacked, and
the guide corrections — verified against `main`'s real API rather than the
variant's. Anyone reading those branches should treat them as a salvage
source, not a candidate for merge.

*Scope of this receipt.* G3 only. No C2 claim: there is no LLP 0181
picker/content-URI adapter consumption, no per-OS device or simulator evidence
for the command, and no published-package or external-repository run, so
nothing here supports an `Online` or distribution claim. G2's own
simulator/emulator receipts are landed and cited above and are not restated
as command evidence. The residue `authoritative` value, multiple assets,
offline/restart custody, attempt grants, and distributed atomicity all remain
unbuilt and unclaimed.

**2026-08-06 per-OS command receipts — the (q) nonclaim closed; G3 complete.** The generated
`conversation.commands.send` now accepts both `{ body }` and `{ body, image:
picked }`. `@expo/snapback-expo` registers the picker URI conversion and
WinterCG asset transport once on the provider-owned client; ordinary Sessions
authority, the LLP 0044 asset task, checksum/finalization, and the ordinary
mutation remain their existing owners. Recorded headless fixtures cover
`content://`, `ph://`, and `file://`, including non-HTTP status 0 and the Expo
57 Android picker-cache 404 fallback. The exact-runtime command acceptance is
4/4 for text, one image, negative authority/retry/cancel behavior, and
no-false-atomicity/residue.

On iOS, a task-added library image was installed with `simctl addmedia` and
selected through the system Photos picker; on Android, 30,670 bytes were
installed with `adb push` plus MediaStore scan and selected through Android's
Photo Picker. In each fresh supervised run one ordinary provider/session
cohort committed the text command, committed the picked-image command, saw the
row through the live surface, rendered the public delivery URL in native
`Image`, and showed a pre-mutation command cancellation as `cancelled` with
null residue. The receipts are
[`20260806-g3-ios-simulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g3-ios-simulator.md)
and
[`20260806-g3-android-emulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g3-android-emulator.md).

Successful/cancelled device arms have no residue. The headless finalized-byte
failure arms preserve the only truth LLP 0044 currently supplies:
same-authority proved refusal is `inferred`, while unsettled or replaced
authority is `unknown`; neither is presented as certain or safe to delete.
Both supervisors recorded full reclamation. No background, restart, offline,
attempt-grant, release, physical-device, LAN-carrier, or LLP 0064 claim follows.

### G4 — external distribution proof

- Install only published public packages in a clean external Expo repository.
- Verify Metro and EAS package closure and descriptor/binding receipts.
- Produce separate iOS and Android evidence and measure setup, first-query,
  first-image-send, and diagnosis time against the bakeoffs.

**Exit:** the golden path works outside the Snapback monorepo with no source
override, staging copy, hidden server dependency, or development target in the
release artifact. The iOS/Android evidence satisfies LLP 0064's `Online`
capability only if it comes from an actual device evidence path — hosted
HTTPS or a USB/port-forward carrier (0176 OQ4) — because LLP 0064's own bar
directly requires "device evidence" per OS for an `Online` claim (LLP 0064
§Summary), not a simulator or emulator smoke test. A round-3 review
correctly found the earlier citation here pointed at the wrong sentence in
0181 §Non-goals — "Claiming React Native parity from one simulator or Expo
Go smoke test" disclaims `Parity` (an Exact Native-only claim per LLP 0064,
which a carrier without local handler execution cannot make at all), not
the `Online` device-evidence bar this Exit actually invokes; the requirement
itself is correct and rests on LLP 0064's own text, just not on that
particular 0181 sentence. If neither device path
is ready when G4 is reached, G4's exit is simulator/emulator evidence
explicitly labeled as *not* an 0064 claim, and the 0064 receipt itself moves
to G5 alongside the device carrier that produces it — G4 must not report a
per-OS capability claim its own evidence cannot support.

### G5 — secure physical-device carrier

- Specify and review the physical-device discovery, secure transport, route
  admission, pairing, and secret-handling boundary under LLP 0168's own
  §Go/no-go gate: preconditions A1-A3 to open an RFC (no implementation);
  running-code proof B1-B5, produced through LLP 0168's own time-boxed,
  named-owner, delete-on-expiry spike (run under `SNAPBACK_PROFILE=prod`
  whenever reachable off-loopback, and subject to LLP 0168's distribution
  fence — not enabled by default, not published as a supported path, not
  documented in the guide, not merged to the default branch or merged only
  behind a flag defaulting off) **on that successor RFC's own timeline,
  before its acceptance** — a round-3 review correctly found the earlier
  text here read as though the spike were G5's own post-acceptance
  implementation step rather than the predecessor RFC's pre-acceptance
  evidence-gathering step, and separately named the reachability fence
  without the distribution fence that runs alongside it.
- Only once that successor RFC is `Accepted` does G5 implement the carrier
  — ordinary mainline work at that point, not a further spike — and prove
  it against hostile LAN peers, replay, wrong app/generation, route
  smuggling, redirect, and log leakage.

**Exit:** a real device works without treating Metro reachability, loopback
backend binding, or an ordinary session alone as proof that the carrier is
safe.

G5 is valuable but not a blocker for G0–G4. A USB/port-forward or hosted HTTPS
path may qualify real devices earlier without asserting a LAN-relay design.

## Integrated acceptance

The program is successful when a clean external Expo app can implement DMs,
groups, text/image send, emoji reactions, reply previews, scoped typing, and
seeded data with the north-star surface while retaining access to every rich
fact needed to diagnose failure.

The proof must establish:

- one stable descriptor and one admitted binding, with no divergent copies;
- one canonical query store, presence room, and asset-task registry for
  equivalent low-level and surface calls — meaning every projection resolves
  through the same store/room/registry and identity allocator, **not** that
  two independently invoked mutations or commands with equal arguments
  collapse into one. A deliberate second send is a second product action and
  must get a second mutation attempt unless the caller supplies the same
  idempotency identity; canonical ownership is about which registry a call
  goes through, not about deduplicating distinct invocations;
- ordinary application authority at every v1 image-send step;
- truthful command phases and residue reported with explicit provenance
  (`authoritative | inferred | unknown`, per G3);
- every owned listener a supervised session forwards through — the backend
  and Metro alike — verified loopback-bound in the G1–G4 default, with no
  public or LAN-reachable development edge;
- independent iOS and Android receipts, from an actual device evidence path
  where an 0064 capability is claimed (per G4's exit); and
- published-package, clean-repository closure.

Source brevity is a gate, not the only score. A shorter path that loses
authorization, retained-state, ambiguity, repair, or capability facts fails.

## Beyond the golden path

The following ideas have legs but are deliberately outside G0–G5. Their
placement here prevents them from bloating or blocking the core spine.

### Query and authoring expressiveness

- **Maintained bounded aggregates.** LLP 0177 supplies a third workload's
  evidence to LLP 0120/0130 SD-2, whose branch is decided by whether
  snapshot-batch composition already expresses grouped reaction counts
  within its ceilings — not by a count of demonstrated workloads. A
  maintained-exact profile is authorized only on measured contention
  evidence, which this program has not gathered; see 0177's own corrected
  recommendation. This is not required to ship the surface; the surface may
  bind today's JS live query unchanged.
- **Self-related first row.** Current `defineRelationalQuery` explicitly
  refuses the same table as root and joined. Reply preview is concrete demand
  for a narrowly bounded self-relation under LLP 0080, not an unknown existing
  capability.
- **Typed relationship/index handles.** Generated handles could remove
  repeated table/index/prefix/field strings while remaining LLP 0157 sugar
  over admitted nodes.
- **A real missing-value algebra.** `optionalArg`, declared defaults,
  `omitWhenMissing`, and eventually closed matching could make optional plan
  inputs truthful instead of conflating missing and JSON `null`.
- **Document-shaped computed results.** An explicit document extension
  contract could admit “stored message plus reactions” without silent field
  stripping.
- **Native structured stored fields.** Member arrays and discriminated message
  content strengthen LLP 0115 CV-4b; a guide workaround is not write-time
  validation, indexing, portability, or sync semantics.
- **Derived proofs with provenance.** Snapback could derive index matches,
  dependency sets, and result schemas where mechanically complete, marking
  each fact `declared | derived | observed` and refusing to guess otherwise.

### Client and asset depth

- **Multi-asset commands.** Extend the one-asset command only after the child
  fact model proves sufficient; keep a small declared bound.
- **Restart and offline command custody.** Persist source bytes, command
  identity, authority cohort, and mutation settlement before claiming resume
  or offline send. The current Expo retained-query adapter is not evidence for
  those separate cuts.
- **Attempt grants.** A narrow credential may continue an already-authorized
  upload attempt when an ordinary application session cannot safely accompany
  raw background TUS requests. LLP 0044 must own its schema, operations, TTL,
  revocation, redaction, and negative matrix. It never creates a principal,
  authorizes reads/mutations, or turns the attempt URL into a bearer.
- **Anonymous claim-on-attach.** Truly anonymous uploads need explicit quota,
  abuse, ownership-transfer, attachment, and GC semantics. Do not hide this
  policy inside an attempt grant. Prefer ordinary guest principals first.
- **Responsive image projection.** An Expo component can select a bounded
  rendition from layout width and device pixel ratio over LLP 0044's declared
  ladder, while preserving an explicit variant override.

### Experience and operations

- **Secure LAN or tunnel development.** Physical-device convenience is worth
  pursuing only as an accepted LLP 0168 boundary, not as an incidental Metro
  proxy.
- **First-class dev personas.** Pair declaratively named LLP 0152 personas to
  ordinary expiring sessions without ever sending a trusted `userId` from the
  app.
- **Successor-first edit recovery.** Load an incompatible candidate into an
  LLP 0158 fork, show the schema/function/permission diff, then switch,
  migrate, or discard instead of moving the database away.
- **Executable recipes.** `snapback add chat` may print/eject ordinary schema,
  functions, surfaces, seed data, and acceptance tests. A permanent
  chat-specific runtime framework should not lead.
- **Agent-oriented repair.** High-frequency deterministic refusals should
  include LLP 0146 typed remediations and bounded corrected shapes, beginning
  with optional args, row spreads, package skew, and binding mismatch.
- **Two compatibility axes.** Separating review/source identity from runtime
  compatibility is attractive but risky; LLP 0058/0174 should investigate it
  only with metamorphic evidence. Successor-first recovery is safer first.

### Already shipped but undiscovered

The generated admin console, relational query profile for distinct tables,
scoped presence hook, and optimistic mutation projection already exist —
see the citations attached to G0's bullet above, added in this revision
after a reviewer round correctly found the earlier text asserted "already
exists" without anything a reader could check. Their absence from every
relevant bakeoff is a workload-indexing failure in the guide, not a reason
to create replacement primitives. Tickets include
`issues/closed/20260805-admin-console-undiscovered-by-expo-bakeoffs.md` and
`issues/closed/20260805-relational-query-undiscovered-by-messaging-bakeoffs.md`.

### Attractive ideas that should not lead

- Silent stripping of undeclared result fields hides a contract failure.
- A generic client workflow engine is disproportionate to image send.
- A “simple” cache or Expo-specific protocol creates a second Snapback.
- Alias-only shortening is useful polish but does not bind application scope
  or remove orchestration.
- Treating Metro as trusted because it runs in development confuses host
  process ownership with network reachability.

## Open questions

1. Which compact surface read projection best preserves loading, retained
   data, partial/error, and capability facts without making common rendering
   verbose?
2. Should `AppDescriptor` reserve language-neutral slots for future Exact and
   Contract projections in v1, or is proving that its wire form is consumer-
   neutral sufficient until those consumers are built?
3. G0's raw-email `snapback session mint --email` primitive is now specified
   and cited against `auth.mintSession`'s real argument shape, so this
   question narrows to the friendlier layer only: does closing the
   "declared dev persona" contract actually require unfreezing LLP 0039 (a
   round-3 review's best current answer to who the real owner is, since LLP
   0055 explicitly disclaims the operator plane and LLP 0057 explicitly
   defers to 0039 where 0039 has pinned an outcome), or does LLP 0058
   supply a path this Plan has not yet checked? If 0039 must be unfrozen,
   does that decision belong to this program at all, or is it a
   prerequisite this Plan can only name and wait on?
4. Can a USB/port-forward physical-device path cover both OSes before G5, or
   should real-device qualification wait for hosted HTTPS or the reviewed LAN
   carrier?
5. Which setup/ceremony metric is stable enough to compare against the
   bakeoffs without rewarding omitted guarantees?

## Status

Review. This revision resolves the overlap among LLPs 0176–0181 at the document
level: 0176 is the program, 0179 owns the stable app vocabulary, 0180 adds one
bounded command kind to it, and 0181 binds it to Expo environments. The first
implementation work should be G0, followed by the G1 descriptor/binding spine;
attempt grants, offline recovery, aggregates, and a LAN relay are explicitly
off the critical path.
