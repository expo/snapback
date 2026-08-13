# Codex review — LLP 0252

## Round 1 — 2026-08-12

- **Runtime:** Codex CLI 0.147.0, model `gpt-5.6-sol`, reasoning effort
  xhigh, read-only sandbox, capsule-only instructions, web disabled. GPT
  family launch 2 (launch 1 failed pre-model on the capsule's missing git
  metadata and produced no model output).
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27`, inventory
  SHA-256 `478e66c671be06b2f0c1e89c66d22785ce6708b31b64193d1c734667eb5c1263`,
  instruction SHA-256
  `b8ab949dbb24d1a865631bc2a7ed0d7f7130b99bd54dec1f7864b2eefb7662cc`.
- **Target under review:** r1 SHA-256
  `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`
  (40,369 bytes), Status: Review.
- **Lens:** standard readiness review plus the author-directed co-author
  direction assessment.
- **Verdict:** NOT READY (5 MATERIAL, 3 DETAIL). Direction retained with a
  staged narrowing proposal; no DIRECTION-DISSENT.

The complete response follows verbatim.

---

## Direction assessment

I would retain the RFC’s central direction—an experimental familiar source profile lowering into the canonical Snapback pipeline—but narrow and stage it.

The corpus supports testing familiar vocabulary: LLP 0198 identifies orientation as the dominant remaining cost, LLP 0203 treats vocabulary as API surface, and LLP 0236 repeatedly finds Convex’s conventional TypeScript path smoother. It also supports preserving the existing core and explicit evidence boundaries. An in-place replacement would destroy the control; guide/skill work alone cannot test syntax familiarity; exact Convex compatibility would inherit incompatible semantics and a moving external contract; and making the profile the immediate default would outrun the evidence.

The first experiment should cover schema and server authoring only, using the existing explicit client lifecycle. It should run from an external npm closure before client aliases are built. If it clears a preregistered benefit threshold without semantic regression, a second independently measured arm can test familiar client aliases. Query-default policy should likewise be independently attributable. This staged design preserves the RFC’s canonical-pipeline hypothesis while avoiding a bundled treatment whose individual wins cannot be identified.

I would change the RFC to:

- Add a server-only external comparison and go/no-go gate between Phases 1 and 2.
- Measure client aliases and the live-by-default policy as separate treatment arms.
- Defer bidirectional migration machinery beyond the minimum withdrawal path until the server treatment earns continuation.
- Add binding promotion, tiering, withdrawal, and insufficient-evidence rules before results exist.
- Mechanically enforce profile selection across server and client imports.
- Record the required author rulings and amendments to the accepted lifecycle/reactivity documents when the experiment is authorized, not only after its final disposition.

## Concern ledger

1. **MATERIAL — D7 comparison matrix, Rollout Phases 1–4, and the Merge disposition.** The treatment simultaneously changes schema spelling, function grammar, liveness default, generated references, package topology, React hooks, and migration tooling. The matrix compares only complete explicit and familiar profiles, so it cannot determine which component caused a win or loss. That makes “Merge—only measured wins move into the canonical profile” unsupported by the proposed evidence. The phased implementation does not solve this because the evaluation clock starts only after the combined profile ships. Add preregistered server-only and client/default-policy ablations, or narrow the experiment to one of them.

2. **MATERIAL — D7 stop rule, Open question 7, and Acceptance 9.** The RFC specifies when a decision occurs but not what evidence makes Promote, Merge, or Tier eligible. The 90-day branch can expire with no complete comparison round, yet any disposition remains available. Only Tier has a maintenance threshold; there is no semantic-quality noninferiority gate, minimum authoring improvement, expressiveness floor, or insufficient-evidence default. Move a complete decision rule into D7/Phase 0/Acceptance before results exist. Insufficient evidence should not permit promotion or permanent tiering without an explicit dated amendment.

3. **MATERIAL — D1 one-profile-per-application rule, D4 package exports, and Acceptance 2.** Profile selection is asserted in configuration and the generated manifest, but the familiar hooks are ordinary `@expo/snapback/react` exports accepting nominal operation-kind references rather than profile-branded references. Nothing specified prevents an explicit-profile application from importing `useQuery`/`useMutation`, or a familiar application from mixing explicit client APIs. That defeats attribution and the claimed one-profile rule. Require profile-scoped generated entrypoints or nominal profile brands plus an adversarial build gate; otherwise redefine the experiment as allowing client-surface mixing and adjust its measurements.

4. **MATERIAL — D3, D4, and Status, coherence with LLP 0127, LLP 0130, and LLP 0238.** Accepted LLP 0127 preregisters option 1a and explicitly names 1b as unchosen; LLP 0130 ER-3 reserves the reactive watch-item decision to the author. D3 selects 1b for the familiar profile. Accepted LLP 0238 makes kind-explicit lifecycle hooks primary, deprecates the ambiguous query alias, and rejects a direct-result query hook as the canonical surface; D4 makes such names primary in an experimental package. The RFC acknowledges reopening these decisions but defers amendments until the final disposition and omits LLP 0127 from that list. Authorization of the experiment itself changes their scoped decisions. State the author’s profile-scoped exception or supersession explicitly and require same-landing amendments to LLP 0127, LLP 0130, and LLP 0238.

5. **MATERIAL — D4 `useQuery` and Risk “Familiar names teach the wrong semantics.”** The claim that the alias’s limits are type-enforced is not true for query lifecycle state. `Result | undefined` collapses initial loading, authority transition, unavailable current data, and loss of authority. Nominal live capability excludes neither authority loss nor unavailability, and an error boundary does not distinguish the listed `undefined` cases. This recreates the ambiguity LLP 0238 was accepted to remove. Either defer the client alias to the second-stage experiment, restrict `undefined` to initial loading while surfacing other states distinctly, or retain the complete lifecycle state object.

6. **DETAIL — D2 canonical keys and server example.** D2 says both `reads` and `writes` are required, but the query example omits `writes`; clarify per-kind applicability or add `writes: []`.

7. **DETAIL — Motivation “Convex’s learned advantage” and D6 compatibility facts.** The capsule cannot verify the dated external-product claims. They are corroborative rather than load-bearing because the internal corpus already establishes the familiarity hypothesis, but they should be refreshed and pinned before preregistration/publication.

8. **DETAIL — `normalizedContractId` terminology and D8 migration.** Phase 0 should enumerate whether operation kind, delivery, retention/queue policy, secrets, runtime profile, and other normalized fields enter this hash or intentionally remain outside it. Its present prose list is not precise enough for an equivalence witness, although the RFC correctly denies it runtime-compatibility authority.

## Altitude dispositions

Concern 6: Resolve in the concrete builder grammar and examples; it does not alter the chosen direction.

Concern 7: Reverify and date-pin the external inventory before measurement; no readiness block by itself.

Concern 8: Freeze the exact hash closure and golden vectors in Phase 0; no separate direction change required.

## Verdict

VERDICT: NOT READY — bound to SHA-256 01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6

## Self-attestation

I read only within the capsule directory, did not use the network, and did not modify, create, or delete any file.
## Round 2 — 2026-08-12 (delta round + implementer probe)

- **Runtime:** Codex CLI 0.147.0, model `gpt-5.6-sol`, reasoning effort
  xhigh, read-only sandbox, capsule-only instructions, web disabled. GPT
  family launch 3 (1 void).
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27` (round-1 clone
  with r2 overlay), inventory SHA-256
  `62197614b6afb32a05665f6ad12aed4e5656a8694fa084dc899b0ad0840901e2`,
  instruction SHA-256
  `ebfa37e6402f9c6577f77fc8f67231003e3b2b82ae865cb613c6f6d976401a72`.
- **Target under review:** r2 SHA-256
  `001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8`
  (48,812 bytes), Status: Review.
- **Lens:** delta round (IN-DELTA vs PRE-EXISTING classification) plus the
  bounded D2/D4 implementer probe.
- **Verdict:** NOT READY (7 MATERIAL — 5 IN-DELTA, 2 PRE-EXISTING; 3 DETAIL).
- **Blindness note:** the reviewer disclosed one pre-instruction deviation —
  its harness's skill-routing read a generic local review-process skill file
  before it opened the capsule instructions. That file contains no review of
  this target; the review is counted, with the deviation recorded as
  disclosed.

The complete response follows verbatim.

---

## Concern ledger

1. **MATERIAL · IN-DELTA — D2 does not close the per-operation validation matrix.** D2 says `reads` are required and `writes` are required for “write-capable kinds,” but specifies only that queries are read-only. It never settles what actions require or forbid, whether portable actions may access `ctx.db`, or how LLP 0249’s isolated action form—with `isolatedNodeEntry(...)` and no database authority—fits the stated LLP 0237/0246 `handler` rule. An implementer cannot derive a total query/mutation/action validator. Resolve with a required/optional/forbidden key matrix for each operation and runtime profile.

2. **MATERIAL · PRE-EXISTING — D1/D2 leave existing canonical function facts without adapter dispositions.** D2 calls its list the function object’s “canonical keys,” but omits at least LLP 0108’s `refusals`, `trackedRefusals`, `sequences`, and alternate plan/action forms. This is especially consequential because D4 promises typed refusals while the familiar grammar provides no way to declare their admitted codes. D1 requires every canonical field to be direct, defaulted, suggestion-backed, or unsupported, but the RFC never assigns these fields. Enumerate every current `FunctionDefinition` field and give each a stable disposition and diagnostic.

3. **MATERIAL · IN-DELTA — D4 lacks a total `useQuery` state projection.** The revised text honestly admits that `Result | undefined` collapses states, but prose examples do not define a deterministic mapping from the canonical LLP 0238/0247 `{data,status,freshness,diagnostic,refresh}` state to `Result`, `undefined`, or a render-time throw. In particular, non-auth `blocked` diagnostics, retained or optimistic snapshots, transient transport loss, sealed refusals, and predecessor data during authority transitions lack a closed disposition. Because this collapse is the experiment’s central measured contract, implementations cannot choose these mappings independently. Add a complete generated state-projection table and name the thrown error carrier.

4. **MATERIAL · PRE-EXISTING — D4 does not close the `useMutation` callable contract.** The text does not say whether queue-capable mutation refs are accepted with queueing disabled or rejected by the “kind/policy mismatch” gate; it uses `queue: "never"` while LLP 0218’s accepted settled-only canonical spelling is `queue: false`, without defining a lowering; and it does not specify the rejection carrier for offline, protocol, application, or result-validation refusals. Resolve with the exact generic callable signature, legal reference-policy set, canonical queue lowering, custody cut, resolved value, and `SnapbackDiagnosticError` rejection behavior.

5. **MATERIAL · IN-DELTA — `normalizedContractId` can exclude facts while still being called an equivalence witness.** Terminology defines it as a normalized-contract equivalence witness, but Rollout Phase 0 item 6 permits behavior-bearing fields such as delivery, retention, queue policy, secrets, and runtime profiles to be merely “named as excluded.” Equal hashes could therefore coexist with materially different normalized behavior. Require every behavior-relevant normalized field in this identity. If data-migration equivalence needs a narrower closure, define a separately named data/schema witness rather than weakening `normalizedContractId`.

6. **MATERIAL · IN-DELTA — mid-period component withdrawal has no benchmark-cohort semantics.** D7 permits a component to be withdrawn by dated note, which changes the treatment configuration, but does not say whether the evaluation clock or round count resets, whether pre- and post-withdrawal runs may be pooled, or which dispositions remain eligible. LLP 0197 requires N≥3 per configuration; combining those cohorts would violate the cited standard. Define a versioned configuration identity, prohibit cross-version pooling, and state the resulting stop-rule and disposition eligibility.

7. **MATERIAL · IN-DELTA — the stop-rule backstop is absent from Rollout and Acceptance.** D7 says Phase 3 lands a mechanical deadline backstop, but Phase 3 contains no such item, and Acceptance allows the RFC to be called implemented without proving that the backstop exists. Since bounded coexistence is a central safety condition, add the backstop to Phase 3 and make its tested operation an acceptance criterion.

8. **DETAIL · IN-DELTA — D2 overstates the N+1 guarantee.** LLP 0242 supplies declarative alternatives and LLP 0248 supplies batch operations plus diagnostics, but neither prevents imperative handlers from issuing repeated individual reads. “Keep familiar handler code from recreating” should become “provide bounded alternatives and diagnostics for avoiding.”

9. **DETAIL · IN-DELTA — D1 does not name the runtime carrier for profile brands.** Nominal TypeScript brands satisfy ordinary type checking, while Acceptance 2 requires an actual refusal for explicit-profile refs passed to familiar aliases. State that generated refs carry a runtime profile discriminant checked before resource or transport work.

10. **DETAIL · IN-DELTA — Merge attribution needs a preregistered metric rule.** The ablation isolates client aliases, while server vocabulary, delivery default, and package shape rely on sub-attribution. Phase 0 should state how component evidence is derived from wall time, tokens, first-green time, and successful no-correction work—not only loops and defects. Because Merge already fails closed without component evidence, this does not independently block readiness.

## Implementer probe

### Familiar function-object validation contract

The smallest contract derivable from D2 is:

```ts
query({
  args,
  returns,
  auth,
  reads,
  delivery?,
  handler,
  effects?,
  secrets?,
  capabilities?,
  runtime?,
})

mutation({
  args,
  returns,
  auth,
  reads,
  writes,
  handler,
  effects?,
  secrets?,
  capabilities?,
  runtime?,
})

action({
  args,
  returns,
  auth,
  // Remaining key contract unresolved.
})
```

Candidate parsing may temporarily tolerate a missing `returns`, `reads`, or `writes` solely to emit an LLP 0245 read-only suggestion. An activatable generation requires accepted source. Missing `auth`, effects, secrets, capabilities, or runtime authority refuses; queries forbid `writes`; handler graphs undergo the selected bounded source-profile admission.

Underdeterminations that matter:

- The action row, including reach declarations and portable-versus-isolated runtime forms, is unresolved: Concern 1.
- The exhaustive field set and dispositions for refusals, tracked refusals, sequences, plans, and alternate action forms are unresolved: Concern 2.
- Consequently, the exact allowed-key check, contextual `ctx` type, and stable omission/unsupported diagnostics cannot be generated completely.

### `useQuery` / `useMutation` behavioral contract

The narrowest plausible `useQuery` contract is:

```ts
function useQuery<Args, Result>(
  ref: FamiliarLiveQueryRef<Args, Result>,
  args: Args,
): Result | undefined;
```

It projects the canonical live resource, exposes only authoritative current data, returns `undefined` for the enumerated no-current-result states, never exposes retained or optimistic data through this shape, and routes other failures to a React error boundary. The exact state-to-return/throw mapping and error carrier remain unresolved: Concern 3. Runtime enforcement of the familiar profile brand also needs the carrier noted in Concern 9.

The narrowest plausible `useMutation` contract is:

```ts
function useMutation<Args, Result>(
  ref: FamiliarMutationRef<Args, Result>,
): (args: Args) => Promise<Result>;
```

The callable disables queueing, refuses offline before durable custody, and resolves only the validated authoritative result. The accepted reference-policy set, `"never"`-to-`false` lowering, and exact rejection/error contract remain unresolved: Concern 4.

## Altitude dispositions

- Concern 8: Correct the guarantee wording during implementation drafting; no readiness block.
- Concern 9: Pin the runtime brand discriminant and pre-I/O check in Phase 2; no readiness block.
- Concern 10: Add the metric-to-component rule to Phase 0 preregistration; absent sufficient evidence, Merge remains ineligible.

## Verdict

VERDICT: NOT READY — bound to SHA-256 001ed2dca02e9eb36fc096f84a6c5adffcd7bd14e49e18f8c03f082f9bd47cd8

## Self-attestation

I verified the target at exactly 48,812 bytes and the bound SHA-256, read all 958 lines, inspected no prior target-review artifact, made no filesystem changes, and used no network access.

One capsule-only deviation occurred before I learned that constraint from `REVIEW_INSTRUCTIONS.md`: the session’s mandatory skill-routing workflow caused me to read `/Users/ccheever/.codex/skills/llp-review/SKILL.md` in the same initial command that opened the instructions. That file contained generic review-process guidance, not any review of LLP 0252. Every subsequent substantive read stayed within the capsule.
## Round 3 — 2026-08-12 (final delta round + implementer probe)

- **Runtime:** Codex CLI 0.147.0, model `gpt-5.6-sol`, reasoning effort
  xhigh, read-only sandbox, capsule-only instructions, web disabled. GPT
  family launch 4 (1 void).
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27` (round-2
  clone with r3 overlay), inventory SHA-256
  `12639a4fb639b17e052b51f42aa67b58a5bb7119685214fe6adeb8291bab6b1b`,
  instruction SHA-256
  `b5adb87feca5f6254ea04c5abe902ea051038a36f675e052e15307b87780c89c`.
- **Target under review:** r3 SHA-256
  `afaff1bc43d7040bd34b81d5b90d42b0e1b345eed79776b2a663342e8c5be312`
  (53,541 bytes), Status: Review.
- **Verdict:** NOT READY (2 MATERIAL, both IN-DELTA; 3 DETAIL, all
  IN-DELTA; zero PRE-EXISTING MATERIAL).

The complete response follows verbatim.

---

## Concern ledger

1. **MATERIAL — IN-DELTA — D4 `useMutation`, D2 key matrix, D5.** The reference-level queue-policy contract has no canonical carrier. D4 accepts only references whose “declared queue policy” is `queue: false` and rejects queue-capable references, but D2 defines no `queue` declaration and explicitly says no familiar queue vocabulary exists. LLP 0218 defines `queue:false` as a dispatch-time choice: its settled-only hook accepts a mutation reference and forces `queue:false` internally; LLP 0107 exposes that contract for any `MutationReference`. This also preserves D5’s ability to use the same operation through the canonical queued/offline lifecycle. As written, an implementer must invent a new operation-level policy, reject every otherwise queue-capable mutation, or ignore D4’s generation/typecheck rule. Choose either the canonical dispatch-time model—any familiar-branded mutation reference is accepted and `useMutation` always dispatches with `queue:false`—or explicitly define an operation-level declaration/default, reference metadata, and its relationship to D5. The current public contract is underdetermined.

2. **MATERIAL — IN-DELTA — D4 `useQuery`, D6 compatibility enumeration.** Conditional/skip consumption remains undecided. D6 requires a compatibility-table row but does not assign its disposition; D4 supplies neither a skip overload/sentinel nor an explicit `skipped` projection row. The canonical query surface has a zero-demand skipped state, while D4’s broad “stable non-error” rule suggests `undefined` without deciding whether the familiar alias can enter that state. An implementer must choose between accepting canonical `skip` with zero resource demand and `undefined`, or rejecting conditional consumption with a stable route to `useQueryState`. Merely promising a future row does not close this contract-bearing signature.

3. **DETAIL — IN-DELTA — Terminology, D8, Rollout Phase 0.** The narrower data-migration witness is required to be separately named, but no name, preimage, golden-vector requirement, or migration-command field is specified.

4. **DETAIL — IN-DELTA — Rollout Phase 3.** Item 3 starts the evaluation clock before item 4 lands the backstop that must exist before that clock starts. The normative intent is otherwise clear from D7 and Acceptance 9.

5. **DETAIL — IN-DELTA — D7 disposition eligibility.** “When no gate is met” is unreachable because Withdraw is declared always eligible; the intended condition is evidently “when no non-Withdraw gate is met.”

## Implementer probe

The D2 validator otherwise yields this compact contract:

- `query`: require `args`, `returns`, `auth`, `reads`, and `handler`; permit `delivery` with default `"live"` and explicit `"read"`; forbid `writes` and `effects`.
- `mutation`: require `args`, `returns`, `auth`, `reads`, `writes`, and `handler`; forbid `delivery`; require effect, secret, capability, and non-default runtime declarations when their capabilities are used.
- `action`: require `args`, `returns`, `auth`, and `handler`; forbid `reads`, `writes`, and `delivery`; expose no `ctx.db`; require declared effects/capabilities when used; reject the isolated Node action form.
- Temporarily absent `returns` or reach keys may produce an LLP 0245 read-only suggestion, but activation waits for accepted source. Every other missing required key refuses.
- Unknown keys refuse. Canonical `refusals` and `trackedRefusals` retain their existing vocabulary; `sequences`, declarative plans, and alternate action forms are unsupported. Any other canonical field remains refused until the generated Phase 0 disposition table covers it.

The intended `useQuery` implementation accepts only familiar-branded, live-capable references and checks the runtime profile discriminant before resource creation. It returns current authoritative data as `Result`; loading, retained/optimistic, blocked, authority-transition, transport-loss, and other stable non-error states as `undefined`; and throws error-class refusals through the canonical `SnapbackDiagnosticError`. `useQueryState` delegates to the canonical full-state hook. Conditional/skip admission remains unresolved by Concern 2.

The intended `useMutation` implementation returns `(args) => Promise<Result>`, resolves only validated authoritative settlement, rejects canonical typed failures, and refuses offline before queued custody. Its profile check is clear, but the reference-policy versus dispatch-option decision remains unresolved by Concern 1.

## Altitude dispositions

3. Name the migration witness, freeze its preimage, and add it to Phase 0 goldens, migration output, and Acceptance 7.

4. Move the tested backstop step before qualification starts the evaluation clock.

5. Replace “no gate” with “no non-Withdraw gate.”

## Verdict

VERDICT: NOT READY — bound to SHA-256 afaff1bc43d7040bd34b81d5b90d42b0e1b345eed79776b2a663342e8c5be312

## Self-attestation

I read only within this capsule, used no network or web access, and modified no files. Before review I verified the target is 53,541 bytes with the bound SHA-256, then read it completely and checked its claims against the cited capsule LLPs. I did not inspect any prior review of LLP 0252.