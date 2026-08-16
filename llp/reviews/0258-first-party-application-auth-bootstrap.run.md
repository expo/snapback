# LLP 0258 super-refine run journal

Orchestrator notes — excluded from all review capsules.

**Target:** `llp/0258-first-party-application-auth-bootstrap.rfc.md`
**Loop:** `/llp-super-refine`, 2–3 rounds, three families: codex
(gpt-5.6-sol @ xhigh), grok (grok-4.6 @ xhigh), claude (fresh blind Fable
general-purpose agents). Per author instruction (Charlie Cheever,
2026-08-15, this session): drop claude as a reviewer once it returns READY
once. Orchestrating session revises between rounds.

**Authorization:** Author (Charlie Cheever) requested the loop directly in
this session and named the external reviewers (codex, grok), which
constitutes the repository-disclosure authorization for external sends.
Capsule outbound inventory: full `git archive` export of the repository at
the revision under review (no `.git`, no submodule contents, no
`.agent-local-secrets.md` — untracked files are not in archives), minus
`llp/reviews/0258-*` and this journal.

**Status transition applied at loop start:** Draft → Review (the one
authorized transition), landed on main as `4cc971ea4`.

---

## Round 1

- **Revision under review (r1):** sha256
  `fbea549187d56e9dcd82a42485d4a1be4202ed76f3832e6f753237576c3b7362`
  (= landed commit `4cc971ea4`).
- **Topology:** single target, three independent mutually-blind reviewers,
  one fresh capsule copy per reviewer (APFS clones of the `git archive
  4cc971ea4` export, verified to contain no 0258 review artifacts).
- **Capsules:** `scratchpad/0258/capsule-r1-{codex,grok,claude}`.
- **Instructions:** shared `scratchpad/0258/r1/instructions.md`, identical
  for all three families (sha256 recorded below at launch).
- **Runners:**
  - codex: `codex exec --skip-git-repo-check -m gpt-5.6-sol -c
    model_reasoning_effort=xhigh -s read-only`, cwd = its capsule.
  - grok: `grok -p <instructions> -m grok-4.6 --reasoning-effort xhigh
    --output-format plain --disable-web-search --permission-mode auto
    --max-turns 200`, cwd = its capsule.
  - claude: fresh Fable general-purpose agent, cwd = its capsule,
    instruction-identical prompt. Structural blindness holds (capsule
    excludes artifacts); the agent additionally instructed not to leave the
    capsule.
- **Launch (2026-08-15):** instructions sha256
  `b730742554df966819f527c877bb4b12be01c86218d3777d4f68abb848c373eb`;
  codex pid 43762, grok pid 43763 (detached, start_new_session), claude
  agent launched concurrently. All three received identical instructions.
- **Results:** claude NOT READY (3 MATERIAL, 6 minor); codex NOT READY
  (7 MATERIAL, 1 minor); grok NOT READY (5 MATERIAL, 7 minor). Strong
  cross-family agreement: owner-key vs LLP 0059 identity (all three),
  D4 recovery-credential result contract (claude+codex, grok adjacent),
  supervised-entry admission not expressible / first-run seam (claude+grok),
  native carrier must be chosen in text (codex+grok), 0181 amendment is a
  real protocol change (grok, claude adjacent), OQ3 must be normative
  (codex+grok). All reviews preserved verbatim in the family artifacts.
- **Diary-citation finding (claude m5 / grok m11):** Diaries 0079/0083 DO
  exist — in local-main commit `272bea745` (another session's work, not yet
  on origin/main), hence invisible in the capsule. Citations retained;
  dispositioned as pending-landing, not a defect.
- **Revision r2 (orchestrator):** sha256
  `840995cbb6e87582ca7c2fc035362da6ea11a466d85bef577af6f759900dae4a`,
  864 lines vs 693 entering = **+24.7% net growth — over the ~20%
  guideline; disclosed here**; rounds 2+ aim net-neutral. Every MATERIAL
  and minor from all three reviews addressed; see the target's Revision
  history r2 bullet for the delta summary.

## Round 2 (delta round, LLP 0010 §2 addendum)

- **Revision under review (r2):** sha256 `840995cb…dae4a` (above).
- **Topology:** same three families, fresh mutually-blind reviewers, delta
  instructions enumerating the r1→r2 delta with mandatory IN-DELTA vs
  PRE-EXISTING classification. Convergence if no family reports a MATERIAL
  concern in pre-existing text.
- **Capsules:** cloned from the round-1 pristine capsule (NOT re-exported
  from main, which now carries round-1 artifacts) with r2 overlaid —
  `capsule-r2-{codex,grok,claude}`.
- **Claude drop rule:** author instruction — claude is dropped from later
  rounds after its first READY.
- **Round-1 landing:** r2 + round-1 artifacts + journal landed on main as
  `73df29299`.
- **Launch (2026-08-15):** delta instructions sha256
  `53306c45d9ad62ac153fec0c84b81d1e88b6ab0e2432b8e9f382e8f2ca224778`;
  codex pid 46210, grok pid 46211 (detached), fresh claude agent launched
  concurrently. Identical instructions for all three.
- **Results:** claude **READY** (6 minors, 5 in-delta / 1 pre-existing, all
  altitude-dispositionable) → **claude dropped from later rounds per the
  author's standing instruction**. codex NOT READY — 5 MATERIAL, all
  IN-DELTA, "no separate MATERIAL concern confined to pre-existing text."
  grok NOT READY — 4 MATERIAL, all IN-DELTA; 1 pre-existing minor
  (changePassword union arm). Delta-convergence precondition (no MATERIAL in
  pre-existing text, any family) holds; in-delta fixes get one more delta
  round per LLP 0010 §2.
- **Revision r3 (orchestrator):** sha256
  `2fb1bd9f96d695e6231836a61ceba07d6a35905d0ba7dfbf9d8ccf460829895b`,
  988 lines. **Cumulative growth +42.6% over the entering revision — the
  ~20% budget is exhausted; disclosed here and escalated in the final
  report.** All nine in-delta MATERIALs and the actionable minors addressed;
  see the target's r3 Revision-history bullet. Claude's r2 minors folded in
  (owner-key rename, custody derivation, remint-vs-conflict, recovery
  citation, 0238 namespace pin); its pre-existing Node/headless-row minor is
  altitude-dispositioned (no defective decision; matrix stays explicit that
  headless is admitted-only).

## Round 3 (delta round — final budgeted round)

- **Revision under review (r3):** sha256 `2fb1bd9f…895b` (above).
- **Reviewers:** codex + grok only (claude dropped after READY).
- **Topology:** delta round on the enumerated r2→r3 delta; same
  IN-DELTA/PRE-EXISTING classification duty; capsules cloned from round-2
  lineage with r3 overlaid.
- **Round-2 landing:** r3 + round-2 artifacts + journal landed on main as
  `86b6b6f70`.
- **Launch (2026-08-15):** delta instructions sha256
  `2f2a7c33898003286e01a19c09ffae13e17a347723f81c34c8d5e8e4f6de2e32`;
  codex pid 23581, grok pid 23582 (detached). Identical instructions.
- **Results:** codex NOT READY — 3 MATERIAL, all IN-DELTA, reviewer states
  "no PRE-EXISTING material concern." grok NOT READY — 1 MATERIAL,
  IN-DELTA; its only PRE-EXISTING item is a minor (adapter keying), plus an
  implementation-note ledger. Both artifacts carry the verbatim bodies.

## Convergence and close-out

- **The loop CONVERGED at round 3 under the LLP 0010 §2 delta rule:** a
  delta round in which no family reported a MATERIAL concern in
  pre-existing text. Final verdicts bind to **r3**, sha256
  `2fb1bd9f96d695e6231836a61ceba07d6a35905d0ba7dfbf9d8ccf460829895b`
  (capsule lineage: r1 export of `4cc971ea4` → r2 → r3 overlays).
- **r4 exists and is UNREVIEWED** (the LLP 0010 "remaining in-delta fixes …
  or the final revision is labeled unreviewed" arm; 0252 precedent): sha256
  `dc6cb82925da354ca07c996080594b43c77c648c3f3b68553158d58b73841709`,
  1061 lines. It closes the four round-3 in-delta MATERIALs (initiating-
  context exposure scoping; anonymous authority-source representability;
  recoveryPolicy-derived completeness rows; policy-rotation rebind refusal)
  and the actionable minors; see the target's r4 Revision-history bullet.
- **Verdict ledger:** r1 — claude/codex/grok all NOT READY (15 MATERIALs).
  r2 — claude READY (dropped per author rule), codex/grok NOT READY (9
  MATERIALs, all in-delta). r3 — codex/grok NOT READY (4 MATERIALs, all
  in-delta; zero pre-existing MATERIAL across families) → converged.
- **Altitude/disposition notes:** every round-3 minor was either fixed in
  r4 or is implementation-phase material recorded verbatim in the family
  artifacts (notably: 0238 state projection during displacement, adapter
  keying implementation, 0181 `AuthorityAdoptionResult` type change, rule-3
  timing inside D2 steps 6–8, D9 deferred-mechanism gating — all captured in
  grok/codex round-3 bodies). None identifies a defective decision.
- **Escalations to the author (Charlie):**
  1. **Growth budget exceeded:** entering revision 693 lines → r4 1061
     lines (+53%, of which ~55 lines are the Revision-history ledger). The
     ~20% guideline was exhausted at r3; the alternative was leaving
     reviewer-confirmed MATERIALs open. Proposed disposition: stay
     `Review`; trim or fold the Revision history into an appendix at
     acceptance if desired.
  2. r4 is unreviewed; an optional one-shot delta review of r3→r4 by any
     family would close that gap cheaply.
  3. Acceptance remains the author's call (this loop never applies it).
     The RFC self-gates nothing further: the native-carrier design is
     decided fail-closed, and per-platform capability flips are
     evidence-gated by Phase 0 probes.
- **Status:** document remains **Review**. Loop complete, 2026-08-15.

## Post-convergence r4 delta review (2026-08-15, author-directed)

- Author asked for the optional r4 delta review after implementation landed.
- **Target:** r4 + post-loop editorial (Accepted flip, Implementation
  record), sha256 `bd7c5f0f…43d8`, capsule from origin/main `699b7f907`
  (implementation included; all 0258 review artifacts excluded, including
  other sessions' `0258-phase1-core.*`/`0258-reconciliation.*` files).
- **Verdicts:** codex NOT READY (1 MATERIAL in-delta + 1 minor); grok NOT
  READY (2 MATERIAL in-delta + 2 minor). No new pre-existing MATERIAL from
  either family — the converged-loop conclusion stands.
- **Cross-family contradiction adjudicated by the orchestrator against the
  capsule code:** codex was right — `enterWith` clears `entryInFlight`
  inside its own serialized turn, so the adoption path's serialized check
  was dead code and mid-entry supervisor adoption was deferred-then-adopted;
  grok's "verified drop" claim was wrong (its cited test covers binding
  rebind, not concurrent adoption).
- **Fixes landed with this record:** code — arrival-time drop in
  `__adoptSupervisedBootstrapAuthority`, no mid-entry `ready` publication,
  two new app-client race tests (16/16); react fixture de-rotted (static
  binding expiry vs the boot-clock admission landed in `8c79faccd`).
  Doc r5 — Acceptance aligned to the drop-only rule and initiating-context
  exposure scope; authority-source union gains `external-transition`;
  rotation predicate = any policy-semantic-identity change; Implementation
  record list completed with the 0241 successor-proof ticket; Phase 3
  ticket gains the missing-`recoveryPolicy` source-field gap.
- **r5 remains unreviewed** (narrow, enumerated in its Revision-history
  bullet); the unreviewed-r4 escalation is superseded by this reviewed
  round plus the r5 delta.

## Author ratification (2026-08-16)

Author ruling (Charlie Cheever, in-session, 2026-08-16): the Accepted flip
is **ratified**, and the growth escalation is **dispositioned** — the grown
normative text stands as part of the accepted document, and the target's
Revision-history section is compacted to a hash-pinned ledger pointing at
these artifacts for full verbatim detail. With this ruling, every open
author gate from the loop close-out is resolved: the r4-unreviewed gap was
closed by the 2026-08-16 delta review + r5, and the ratification/growth
gates close here. No loop escalations remain open.
