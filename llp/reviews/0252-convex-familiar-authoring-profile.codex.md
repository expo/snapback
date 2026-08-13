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