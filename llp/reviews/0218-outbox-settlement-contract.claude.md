# Review artifact — LLP 0218, Claude family, round 1

- **Target:** `llp/0218-outbox-settlement-contract.rfc.md`
- **Round:** 1 (llp-super-refine, sub-orchestrated loop)
- **Date:** 2026-08-10
- **Target blob (git hash-object, revision b):** 51d213675d800af4e3878afbe8e66ac1b0b2ab0b
- **Capsule sha256-16 (tar):** 5e16f930d00085d5
- **Reviewer runtime/mechanism:** Claude family via Agent tool
  (subagent_type general-purpose), capsule-confined read-only instructions;
  mutually blind to the GPT-family reviewer.
- **Verdict:** NOT READY

The review below is sealed verbatim as received.

---

# Design review — LLP 0218 (Outbox settlement contract and queued-write visibility), round 1

Reviewed against: LLP 0043, 0107, 0208, 0219 (full), 0063 §Workstream 5 and 0129 §Governing constraints (excerpts), the P2 pilot record, both issues tickets, `guide/capabilities.md`, and the client/react code excerpts and `.d.mts` declarations in the capsule.

Overall: the diagnosis is accurate against the evidence and the code, the chosen union direction is coherent with LLP 0043's durable-record ownership and LLP 0063's three-fact families, and the design as sketched would fix both pilot failures **if** three points of ambiguity are pinned. As written, each of those three admits a conforming implementation that fails to deliver what the RFC claims, so they are material.

## MATERIAL concerns

**M1 — The React arm's settled-branch payload is unspecified, and two implementers would build different contracts.**
`llp/0218-outbox-settlement-contract.rfc.md` §4.1 defines `MutationDispatchOutcome<Result>` with `output: MutationOutput<Result>` and labels it "(headless contract)". §4.5 then says "`useSnapbackMutation` and headless `mutate()` change their resolved type to the union", while Phases P3 says only "Queued dispatch resolves the union." This leaves two readings for React: (a) the full §4.1 union, whose settled branch hands React callers the raw `MutationOutput` (version, receipt, `ctx_ledger`, unvalidated `result`) — a deliberate widening past LLP 0107's carefully result-only contract (`llp/0107...spec.md` §Optimistic mutation projection: "The promise resolves only to the LLP 0101-validated result"); or (b) a React union whose settled branch carries the validated `FunctionResult`, which §4.1 never defines; or worst, per P3's literal wording, `FunctionResult<Ref> | {status:'queued',…}` — not a discriminated union at all, and colliding with any app result that has a `status` field. Smallest fix: one sentence in §4.1 or §4.5 defining the React-arm union explicitly (e.g. `{status:'settled'; result: ValidatedResult} | {status:'queued'; …}`), stating that result-contract validation still gates the settled branch, and striking the P3 phrasing that reads as settled-stays-bare.

**M2 — The migration story understates the settled-branch blast radius and is internally inconsistent about when the compat decision is made.**
§4.5 presents the primary migration as softened by "`queued:true` stays on the queued branch as a deprecated alias for one release." But the alias only de-risks the *queued* branch — the rare path. Nesting the settled payload under `output` breaks **every existing settled-path caller** (`output.result`, `output.version`, `output.receipt` — the shapes shipped at `code/snapback-client-index.d.mts:276–290, 1318–1349`) in the same minor release, with no deprecation window at all. The RFC should either state plainly that the settled-shape break is intended and covered by the audit, or adopt a compat-preserving settled branch (see AD1). Two adjacent inconsistencies compound this: (i) §4.5 says the fallback plan triggers "if the release audit finds callers that cannot absorb the return-type change," but Phases P6 places that audit as *its* proof — after the break has shipped in P1/P3; the audit that gates primary-vs-fallback must be sequenced before the return-type change lands, and P6's audit is then the closure check, not the trigger. (ii) P6 says it removes "the default-path queued rejection after one release window," but §4.5 already demoted `SnapbackQueuedMutationError` to an explicit opt-in compatibility mode in the same release the union lands — if that is true, there is no default-path rejection left for P6 to remove. State which release actually flips the default.

**M3 — The drain's resync-barrier rule, as written, permits exactly today's wedge on the screens that motivated it.**
§4.3 requires "an explicit full-resync barrier before replay" and says "If the provider cannot produce a real app-wide resync barrier, auto-drain waits." Today's only barrier is a successful fresh-subscribe snapshot (`code/snapback-client-index.mjs.EXCERPT.mjs` Region C, `#scheduleOutboxReplay` fired from `sub.snapshot`), and the pilot wedge (pilot record F5; `issues/20260809-outbox-silent-queue-dx.md`) happened precisely on a screen whose lifecycle never produced one. The RFC never says what mechanism the drain controller uses to *establish* the barrier when no query is freshly subscribing — so a conforming implementation may "wait" indefinitely on a lifeless or already-live-and-never-resubscribing screen, which is the status quo the RFC exists to end, and P2's "no-mounted-query drain" proof row is unimplementable as specified. Smallest fix: one sentence pinning that the controller may itself perform the resync cut (e.g. issue a fresh snapshot/resync operation, or accept a defined proof of replica currency) rather than passively depending on mounted-query lifecycles, and defining what "cannot produce a barrier" concretely means (so it is a bounded refusal state, not an open-ended wait).

## MINOR concerns

**m1 — LLP 0129 miscitation, used normatively twice.** The header ("LLP 0129 … governing constraint 4, resync-before-replay") and §4.3 cite "LLP 0129 governing constraint 4" for resync-before-replay. The capsule's complete §Governing constraints excerpt (`llp/0129...EXCERPT-governing-constraints.md`) shows constraint 4 is "The ephemeral lane does not sync"; no numbered constraint states resync-before-replay (that rule lives in LLP 0008 §Mutation Replay / LLP 0043 M2, which §4.3 also cites correctly). Fix the number or drop the 0129 attribution.

**m2 — Misquoted headless declaration.** Summary: "The headless declaration promises only `Promise<FunctionResult<Ref>>` (`index.d.mts:1318`)." The declaration is `Promise<MutationOutput<FunctionResult<Ref>>>` (`code/snapback-client-index.d.mts:1318–1333`). Also, the `offlineQueue` option's JSDoc (same file, ~line 812–822) already documents the `{queued:true, clientMutationId, sequence}` resolution — the untruthfulness is in the type system, not total silence. The argument survives; the quote should be corrected.

**m3 — Observation-surface state list is incomplete.** §4.1's `mutationStatus`/`subscribeMutation` lifecycle is "pending → settled/failed/stranded," but the shipped durable store also carries `quarantined` and `resultGone` dispositions (`code/snapback-client-index.d.mts` `OutboxStatus`:939–951, `QuarantinedMutationTombstone`:883–901), and says nothing about an id absent after ACK GC (LLP 0043 state 4, acknowledged/removed). Enumerate all five dispositions and pin the absent-id answer (e.g. a terminal `unknown` that implies no settlement inference).

**m4 — Cross-doc naming skew.** §4.1 adds `oldestPendingAt` to `outboxStatus()`; LLP 0219 (§Consumers and compatibility) names the same field `oldestPendingAtMs`. Pick one.

**m5 — Diagnostic trigger cardinality conflicts with LLP 0219.** §4.4 owns "the trigger and payload" and specifies *first* silent queue per session; LLP 0219 §Producers specifies emitting `SNAPBACK_REACT_MUTATION_QUEUED` "synchronously when enqueue commits" — every enqueue. Since 0218 claims trigger ownership, reconcile (e.g. every-enqueue channel event, first-occurrence loud console promotion). Also define "silently queued" post-union — the client cannot observe whether the caller branched on `status`, so presumably it means every queued-at-dispatch first occurrence.

**m6 — `presentation` stamping ownership is unstated.** The union is resolved by the headless client, but only the React arm knows its layer-install outcome; a headless-resolved `presentation` would be wrong under a React provider unless the arm re-stamps it. One sentence on which layer owns the field's value per arm. Relatedly, the shipped second queued site already returns an extra fact (`operationCoverageDisposition: 'uncovered-range-exhausted'`, `code/snapback-client-index.mjs.EXCERPT.mjs` Region B); say whether the queued branch is open to such additive facts.

**m7 — No phase lands the LLP 0107 amendment.** LLP 0107 is an Implemented Spec whose 2026-08-09 revision pins the exact queued-rejection contract this RFC reverses ("the generated resolved type stays result-only"; `SnapbackQueuedMutationError` as the queued path). The Related header schedules a dated cross-reference for LLP 0043 but not 0107, and P3–P5 cover code and guide only. Add the LLP 0107 dated amendment (and the 0043 cross-ref) to a phase, per the land-docs-with-code convention.

**m8 — "Whichever the dispatch reaches" is ambiguous for explicit-id online delivery.** Under LLP 0043's lifecycle (state 1) and the Region B code path, a durable record can be committed *before* online transport that then settles in the same call — the dispatch "reaches" both. Clarify that `queued` is the terminal dispatch outcome only when delivery does not settle, not a resolution at the enqueue cut.

## AUTHOR-DECISION

**AD1 — Settled-branch packaging within the union (feeds M1/M2; does not challenge any binding decision — the union itself stands).**
Question: should the headless settled branch be (a) nested — `{status:'settled'; output: MutationOutput<Result>}` as drafted — or (b) flattened — `MutationOutput<Result> & {status:'settled'}` (the discriminant stamped onto the existing shape)?
Options: (a) is the cleaner long-term contract and keeps the branch payloads symmetric, at the cost that every settled-path caller breaks in the migration release with no alias. (b) preserves every existing settled-path caller byte-for-byte (`output.result` etc. remain top-level), making §4.5's "in place, one minor release, deprecated alias" story true for *both* branches, at the cost of a fatter branch type and a reserved `status` key on `MutationOutput` forever.
Recommendation: (b) for the headless arm given that in-place migration is the recorded primary and `MutationOutput` has no existing `status` member; keep the React hook's settled branch a wrapped validated result either way (M1). If (a) is retained, M2's honesty fix — stating the settled break explicitly and moving the absorption audit before the flip — becomes mandatory.

VERDICT: NOT READY

---

# Review artifact — LLP 0218, Claude family, round 2

- **Target:** `llp/0218-outbox-settlement-contract.rfc.md`
- **Round:** 2 (llp-super-refine, sub-orchestrated loop)
- **Date:** 2026-08-10
- **Target blob (git hash-object, revision c):** 77b410f758e035be55d97a6b2a6d7c0fea5f7b29
- **Capsule sha256-16 (tar):** 1db7d9bb608e81b4
- **Reviewer runtime/mechanism:** Claude family via Agent tool
  (subagent_type general-purpose), capsule-confined read-only
  instructions; mutually blind to the GPT-family reviewer; delta from
  revision (b) enumerated in the round instructions. (HTML entity
  escapes in the transport were normalized to literal angle brackets;
  no other alteration.)
- **Verdict:** NOT READY

The review below is sealed verbatim as received.

---

# Round 2 review — LLP 0218 revision (c): Outbox settlement contract and queued-write visibility

Reviewed: `llp/0218-outbox-settlement-contract.rfc.md` (revision c) in full, against LLP 0043, LLP 0107, LLP 0208, LLP 0219, the LLP 0063 §Workstream 5 and LLP 0129 excerpts, the pilot record (`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`, F5), both tickets, `guide/capabilities.md`, and the four code files. Citation spot-checks pass: `index.d.mts:1318` is the `mutate` declaration with no queued branch; the queued marker return sits at `snapback-client-index.mjs.EXCERPT.mjs` region A (~file line 6725) and `#scheduleOutboxReplay` at ~6743, scheduled only from a landed fresh snapshot (region C, ~11073); the React queued throw maps to file line ~1205 and the layer-removing catch to ~1254–1259 (`snapback-react-index.mjs.EXCERPT.mjs` region B); `MutationOutput` has no `status` member today (`snapback-client-index.d.mts:276–290`), so the flattening's reserved-key claim holds; `guide/capabilities.md:96` is `clients.mutation-outcomes`. The revision's core repairs are sound: the flattened settled branch, the relinquishment cut, non-consuming observation, the controller-established barrier with cold-start scan and no-silent-stop, the §4.2 disposition map, and the LLP 0219 cadence reconciliation all resolve real round-1-class defects, and none of my concerns relitigates a recorded binding decision.

## MATERIAL concerns

**M1 — IN-DELTA. The compatibility surfaces' queued contract is internally contradictory: §4.1 says queued is impossible there; §4.5 says the queued rejection lives there until P6.**
`llp/0218-outbox-settlement-contract.rfc.md` §4.1 facade-contracts paragraph (lines 158–161): "The settled-only convenience hook and the `{queue:false}` compat mode keep today's result-only shape by explicit choice (**queued impossible there; fail-loud-online**)." Versus §4.5 (lines 270–276): "`SnapbackQueuedMutationError` is demoted in the same release the union lands: from then on **it exists only inside the explicit result-only compatibility mode** … P6 later **removes the alias and the compatibility rejection** after the deprecation window," echoed by Phase P6 (lines 317–319), which removes "the compatibility-mode `SnapbackQueuedMutationError`." If queued dispatch is impossible on both compat surfaces (they fail loud online with the original connectivity error), then no throw site for `SnapbackQueuedMutationError` exists after the union release, and "the compatibility rejection" that P6 removes is dead code; if instead the settled-only convenience hook keeps "today's shape" in the full sense — queueing permitted, queued outcomes rejected through the class (the shipped behavior at `snapback-react-index.d.mts:473–475`) — then §4.1's "queued impossible there" is false. These are two different caller-visible contracts, and the difference matters in exactly this RFC's own terms: reading (b) preserves an error-shaped pending branch (the M7 rollback hazard, opt-in) for a deprecation window; reading (a) makes the class an exported-but-unthrowable deprecation shell. An implementer of P3 cannot determine which to build. Smallest fix: one clause in §4.1 or §4.5 stating explicitly either (a) "compat surfaces dispatch `queue:false`; from the union release the class is retained as a deprecated export only and is never thrown; P6 deletes the export," or (b) "the settled-only hook retains queueing with the queued rejection as the class's sole throw site until P6." I recommend (a): it is consistent with the facade table's pin, and it fully retires the rollback-on-error hazard in the same release rather than parking it in an opt-in corner.

**M2 — IN-DELTA. The headless migration claim overstates: "preserved unchanged" is runtime-true but false for typed callers, and the RFC's own Option 1 tradeoff admits the cost §4.5 then denies.**
§4.5 (lines 253–255): "Headless settled-path callers are **preserved unchanged** by the flattened settled branch (§4.1)." The flattening preserves the settled *branch's* shape, but the declared return type changes from `Promise<MutationOutput<R>>` (`snapback-client-index.d.mts:1333`) to the §4.1 union — and the queued branch carries no `result`/`version`/`receipt`, so every typed caller that reads `output.result` without narrowing on `status` breaks at compile time, including callers that never queue (the type is static; `offlineQueue` defaults `'auto'`, `index.d.mts:813–822`). The document knows this — Options ¶1 (lines 73–76): "default-queue callers must branch on `status`; **real cost**" — but the migration section, whose round-1 repair was precisely honesty about blast radius, states the headless side as a no-break. That compile break is arguably the design's *feature* (it is what makes the hidden union visible), but a contract-ruling RFC whose thesis is truthful contracts cannot describe it as "unchanged." Smallest fix: amend §4.5 to say headless callers are runtime-unchanged on the settled path, while typed callers must narrow on `status` (the Option 1 cost), and state whether that typed churn is inside the P1 absorption audit's "callers that cannot absorb the change" trigger or explicitly excluded from it (it should be counted as absorbable churn, not a fallback trigger — but the audit contract must say which).

## MINOR concerns

**m1 — IN-DELTA. "Resolves `settled` whenever its foreground delivery attempt settles" is imprecise for refusals.** §4.1 relinquishment paragraph (lines 132–134). Under LLP 0043 a typed terminal refusal *is* a settlement (`failed` disposition), yet the union's settled branch is a success shape (`MutationOutput`), so a refused foreground attempt must still reject. Add "settles successfully (a typed refusal still rejects the call)".

**m2 — IN-DELTA. The "full disposition union" omits LLP 0043's outcome-unknown-with-record class.** §4.1 (lines 141–147) enumerates `pending | settled | failed | stranded | quarantined | resultGone | unknown`, with `unknown` pinned to "no durable record." LLP 0043's LLP 0162 amendment (`llp/0043-offline-replay-retention.rfc.md`, Amendment 2026-08-03, lines 885–891) defines `identity-horizon-passed` as "an explicit outcome-unknown disposition that clients must never record as a terminal `failed`" — a durable record exists, so neither `unknown` nor `failed` fits, and an implementer mapping it to `failed` would violate the LLP 0043 client obligation. Smallest fix: name where it lands (e.g., a blocked/outcome-unknown sub-state of `pending`, or declare the disposition union additive-open the way the queued branch already is).

**m3 — IN-DELTA. "The store's subscribed set" is underdefined at the barrier.** §4.3 second bullet (lines 208–212). At cold start with retained query registrations but nothing mounted, "subscribed set" could mean live subscriptions (empty → handshake-only cut, retained rows resynced later) or the durable store's retained/registered query set (controller must resync them first). The pilot-wedge fix depends on which. One clarifying parenthetical resolves it.

**m4 — IN-DELTA. `withheld` has two definitions.** §4.1 (lines 163–164): stamped by the headless client "when no optimistic machinery participated"; §4.2 (line 176): "covers callers that declined optimistic install." Declined-by-caller and machinery-absent are different facts; pick one gloss ("no optimistic install was attempted, whether declined or absent") and use it in both places.

**m5 — PRE-EXISTING. The Decision misnames LLP 0063's third fact family.** Decision (lines 107–109): "effect attempt, optimistic presentation, authoritative settlement." Source (`llp/0063-…EXCERPT-workstream5.md`, lines 25–28): "effect attempt, optimistic presentation, and **evidence-join status**." The Snapback-side settlement facts feed the evidence join, but the quote as written misattributes the family name; same class of citation slip round 1 fixed in the Summary.

**m6 — IN-DELTA. "Every mutation surface has a pinned resolved type" — but the facade table omits the command task.** §4.1 facade paragraph (lines 152–166). `useSnapbackCommand` composes one ordinary mutation into a `CommandTask` (`snapback-react-index.d.mts:496–498`; `guide/capabilities.md` `clients.surfaces` row), and `clients.optimistic-mutation-view` boots over durable outbox intent. State whether command-embedded mutations can queue and, if so, which branch the task surfaces — or explicitly scope commands out (their settlement table is LLP 0210's).

**m7 — IN-DELTA. The demotion of the public headless replay primitive is not covered by the migration section.** §4.3 (lines 236–237) demotes "the raw headless replay primitive" to internal/expert, but `replayQueuedMutations()` is a shipped public method (`snapback-client-index.d.mts:1352–1353`), distinct from the hook's `replay()` alias P3 retains. §4.5 should say what happens to it: kept but redirected through the controller (recommended — it makes "can never bypass its safety invariants" true for existing callers), deprecated, or type-hidden, and in which release.

## AUTHOR-DECISION

None warranted. No rethink-scale question was found; the four recorded binding decisions are coherent as ruled, and both MATERIAL concerns are resolvable by small in-direction edits (M1 needs a one-clause pick between two stated options; M2 needs an honesty sentence plus an audit-scope clause).

VERDICT: NOT READY
