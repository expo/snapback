# LLP 0314 cluster — super-refine run journal

Orchestrator/reviser: Claude Fable 5 (session
`session_01THxnvaTcdSyLqyBWAFMWzp`). Author: Charlie Cheever, who
invoked `/llp-super-refine` on 2026-08-25 (document authority and
repository-disclosure authority for the external sends recorded from
that invocation; both reviewers run locally on the author's machine).

Targets: LLP 0314 (Research) + LLP 0314.000 (Plan), one tightly-coupled
lockstep cluster. Both entered as `Draft`; set to `Review` at loop
start (commit `235fabf28`) — the one authorized transition. Author
bounds: 0314 gets one sanity-check round (plus delta-scoped closure in
later cluster rounds); 0314.000 runs the default 3-round budget with a
plan-completeness focus.

Reviewer roster (LLP 0010.001 current instantiation): codex
`gpt-5.6-sol` @ ultra (read-only sandbox; effort confirmed in run-log
header) and `grok-4.6` @ xhigh (headless, full terminal ban, built-in
file reads only). Reviser: orchestrator. The reviser never reviews its
own revisions; verdicts come only from the two families.

## Round 1 — full cluster review

- Revision: commit `235fabf283afb7fba4a228585279c2c0ab06577f`
  (0314 sha256 `c55d05f0…cba028`, 0314.000 sha256 `8b67e369…d93204`;
  full hashes in the family artifacts).
- Capsule: live checkout at that commit, read in place. No 0314 review
  artifacts existed in the tree during the round (structural blindness
  for round 1); the `llp/reviews/` read ban was additionally
  instruction-based and is self-attested. Instruction brief sha256
  `80e51ab29a547ff7cdce80232b94a565b0e578d510c97de3677470b296dd4cc4`.
- Runtime: both reviews returned at the ~16-minute poll tick;
  kill-proof detached dispatch, verbatim preservation on receipt,
  sealed until both landed.
- Verdicts: codex — 0314 NOT READY (1 MATERIAL: F4 framed LLP 0061
  §4a's deliberate embedding as drift), 0314.000 NOT READY
  (8 MATERIAL), SET NOT READY. grok — 0314 READY, 0314.000 NOT READY
  (2 MATERIAL), SET NOT READY.
- Cross-family convergence on the plan's defects: Phase 1 misses the
  real manufacture graph (EAS/GitHub workflows, assemble scripts,
  receipt bindings) and source-checkout custody; production profile is
  not attestable (`buildProfile` stays `release`); Phase 2's Guide
  sidecar was not wired through seals/transport and reversed governed
  decisions (LLP 0061/0041/0284) without amending them; the outcome
  table double-counted the sidecar as a package-size saving. Codex
  additionally: KDF/assets feature cuts conflict with LLP 0227 and the
  one-binary distribution; `panic = "abort"` breaks `catch_unwind`
  reliance; baseline custody per LLP 0189 D-4; Linux exit evidence.
- Orchestrator verification: every load-bearing reviewer claim was
  checked against the repository before folding (identity.rs,
  runtime-package-authority.mjs, both workflows, ci pins,
  path-migration rows, commit_capsule catch_unwind, LLP 0061/0227/0284
  text, snapback-types jsonschema, absent staged binary). All held.

### Revision r2 (reviser: orchestrator, 2026-08-25)

Both round-1 review sets folded. Research: F4 reframed on LLP 0061 §4a
(codex MATERIAL), units unified to decimal MB (headline 178→187,
237→248), F3 widened to the manufacture graph, F7 comparables dated and
kind-labeled, test-symbol attribution removed, `__gcc_except_tab`
relabeled mixed, staged-binary reproducibility caveat added. Plan:
Phase 1 rewritten as closed switch/keep inventories + profile
attestation + pre-receipt strip point; Phase 2 rewritten as a governed
amendment (pinned sidecar format, seal/transport wiring inventory,
contributor-source carriage resolved, LLP 0061/0041/0284 amendments on
the landing); outcome table corrected (Phase 2 is a binary win, not a
package win); Phase 3 KDF/assets/panic demoted to
separate-design-required; baseline custody (LLP 0189 D-4, shared
validator across ceremonies) and Linux exit evidence added.

Growth vs entering revision: research +23% bytes; **plan +65% bytes —
over the ~20% advisory budget**, spent on the closed inventories the
MATERIAL findings demanded. Disclosed for the author's judgment; not an
escalation unless MATERIAL concerns remain open at loop end.

## Round 2 — delta round (planned)

Post-revision delta round per LLP 0010.001 §Delta rounds: enumerated
diff `235fabf28..r2`, every concern classified IN-DELTA vs
PRE-EXISTING; converges if no family reports a MATERIAL concern in
pre-existing text. 0314 participates delta-scoped (closure on the
round-1 fold). Capsule: `git archive` of the r2 commit with the 0314
review artifacts and this journal removed (structural exclusion);
runner-level confinement to the capsule directory remains
self-attested.
