# LLP 0259 super-refine run journal

Orchestrator notes — excluded from all review capsules.

**Target:** `llp/0259-agent-first-read-budget.rfc.md`
**Loop:** `/llp-super-refine`, originally one round; author extended
(2026-08-16) to a **second, delta** round on r2. Families: claude
(fable @ max effort) and codex (gpt-5.6-sol @ xhigh). Orchestrating
session revises after both reviews land. Author additionally
authorized: (1) reviewers may co-author / incorporate new ideas;
(2) the file may grow past the ~20% guideline.

**Authorization:** Author (Charlie Cheever) requested the loop directly
in this session and named the external reviewers (claude, codex), which
constitutes the repository-disclosure authorization for external sends.
Capsule outbound inventory: `git archive` of repository HEAD plus an
overlay of the untracked target and cited untracked diaries/issues (no
`.git`, no submodule contents, no `.agent-local-secrets.md`), minus
`llp/reviews/0259-*` and this journal.

**Status transition applied at loop start:** Draft → Review (the one
authorized transition). Target is not yet landed; capsules overlay the
working-tree file.

---

## Round 1

- **Revision under review (r1):** sha256
  `f7be03ecc2886baeff51b020f4c8f2f2fceb58e2c9d63ac1fe330c06583231f4`
  (438 lines, working-tree file after Draft → Review).
- **Topology:** single target, two independent mutually-blind reviewers,
  one fresh capsule copy per reviewer (APFS clones of the `git archive
  HEAD` export plus overlay, verified to contain no 0259 review
  artifacts).
- **Capsules:** `scratchpad/0259/capsule-r1-{claude,codex}`.
- **Overlay (disclosed):** untracked target; Diaries 0078 and 0079;
  issues `20260815-take-limit-shared-rule-and-generation-refusal`,
  `20260808-guide-gap-compose-snapback-into-existing-app`,
  `20260808-guide-gap-principal-to-app-identity-binding`,
  `20260808-guide-gap-declared-refusals-discoverability`,
  `20260808-guide-freshness-warning-saturation`. Cited ticket
  `issues/20260813-guide-gap-familiar-source-consumer-closure.md` is
  missing from the working tree and was **not** overlaid; reviewers were
  told this.
- **Capsule inventory hash:** sha256
  `534b536efeed110bf49cfd5ee151bc9b926e8d071f16563bfe3d2c96c145931f`
  (`scratchpad/0259/r1/capsule-inventory.txt`).
- **Instructions:** shared `scratchpad/0259/r1/instructions.md`, identical
  for both families. Includes the author-authorized co-author / new-ideas
  license.
- **Instructions sha256:**
  `b022d0368e14d89af1413a2086ff2cf7da2465b16d5e8940b55733467c8f68b4`.
- **Runners:**
  - claude: `claude -p --model fable --effort max
    --dangerously-skip-permissions --no-session-persistence`, cwd = its
    capsule.
  - codex: `codex exec --skip-git-repo-check -m gpt-5.6-sol -c
    model_reasoning_effort=xhigh -s read-only`, cwd = its capsule.
- **Launch (2026-08-15):** instructions sha256
  `b022d0368e14d89af1413a2086ff2cf7da2465b16d5e8940b55733467c8f68b4`;
  both reviewers launched concurrently with identical instructions.
- **Claude launch 1:** failed. Wrapper timeout at 600s; log contained only
  `Execution error` (15 bytes). Recorded as failed/partial; not counted.
  Retry under the 2× launch cap with a short prompt that points at the
  in-capsule `REVIEW-INSTRUCTIONS.md`.
- **Codex launch 1:** completed. Verdict NOT READY (5 MATERIAL, 2 minor).
  Body sealed immediately in `0259-agent-first-read-budget.codex.md`.
- **Claude launch 2:** completed after ~718s. Verdict NOT READY
  (3 MATERIAL, 6 minor). Body sealed immediately in
  `0259-agent-first-read-budget.claude.md`.
- **Round-1 result:** both families NOT READY. Strong agreement on the
  central decision (keep and revise) and on three overlapping defects:
  served/carrier bytes vs heading folds, phantom Familiar-consumer
  ticket, stale Clique traps / refusal-card transcription. Distinct
  additions: claude — served `/llms.txt` Read-first and instance home;
  codex — LLP 0252 Promote authority, profile-vs-consumer split,
  `FirstReadProfileV1`.
- **Revision r2 (orchestrator, UNREVIEWED):** sha256
  `06f539333bc06b9fec3c2f34c54973b9ab8224e96741c3c27d6ee41776067a08`,
  583 lines vs r1 438 = **+33.1% net growth**. Over the ~20% guideline;
  disclosed here; author authorized growth this round. Every MATERIAL
  from both families addressed; selected co-author ideas folded in
  (start packets, progressive renewal, thin skill, Backend-map reorder,
  honesty-loop escape hatch, Diary 0083). See the target's Revision
  history.

## Round 2 (delta round)

- **Revision under review (r2):** sha256
  `06f539333bc06b9fec3c2f34c54973b9ab8224e96741c3c27d6ee41776067a08`
  (583 lines).
- **Topology:** same two families, fresh mutually-blind reviewers, delta
  instructions enumerating the r1→r2 delta with mandatory IN-DELTA vs
  PRE-EXISTING classification. Convergence if no family reports a
  MATERIAL concern in pre-existing text.
- **Capsules:** cloned from the round-1 pristine lineage (NOT
  re-exported from the working tree, which now carries round-1
  artifacts) with r2 overlaid — `scratchpad/0259/capsule-r2-{claude,codex}`.
- **Instructions:** shared `scratchpad/0259/r2/instructions.md`,
  identical for both families. sha256
  `88b75b800db500beb540416cbe01e724f95dbb12d812d9588bc7c48e348eaafc`.
- **Runners:** same as round 1. Claude launched with a short prompt
  pointing at in-capsule `REVIEW-INSTRUCTIONS.md` (round-1 launch-1
  failed when the full prompt was inlined).
- **Launch (2026-08-16):** instructions sha256
  `88b75b800db500beb540416cbe01e724f95dbb12d812d9588bc7c48e348eaafc`;
  both reviewers launched concurrently with identical instructions.
- **Codex launch:** completed (~546s). Verdict NOT READY — 4 MATERIAL,
  all IN-DELTA; PRE-EXISTING MATERIAL: no. Body sealed immediately.
- **Claude launch:** completed (~617s). Verdict NOT READY — 1 MATERIAL
  IN-DELTA (escalation carrier), 3 minors; PRE-EXISTING MATERIAL: no.
  Body sealed immediately.
- **Round-2 result:** both families NOT READY on in-delta text only.
  **Delta-convergence precondition holds** (no MATERIAL in pre-existing
  text). In-delta fixes applied as r3 and labeled UNREVIEWED (LLP 0010
  §2: further delta round or unreviewed final revision).
- **Revision r3 (orchestrator, UNREVIEWED):** sha256
  `5dfb1bb77f492fd9d5fe87a709c6bab5500ee9b74fae4ea33d5884683c171552`,
  671 lines vs r1 438 = **+53% cumulative**; vs r2 583 = +88 lines.
  Growth budget still exceeded; disclosed; author authorized growth.

## Close-out (two authorized rounds)

- **Verdicts bind to r2** sha256
  `06f539333bc06b9fec3c2f34c54973b9ab8224e96741c3c27d6ee41776067a08`:
  claude NOT READY, codex NOT READY, both PRE-EXISTING MATERIAL: no.
- **r3 exists and is UNREVIEWED.** The loop may be treated as
  delta-converged on the stable r2-minus-in-delta text, with r3 the
  unlabeled-by-reviewers repair — or the author may authorize a third
  delta round on r3.
- **Proposed status:** stay `Review`.
- **Altitude dispositions:** packet-from-manifest, `--start auto`,
  monotonic budget (codex suggestions) — not MATERIAL; digest-in-AGENTS
  comment folded into r3; served llms.txt static-const note folded into
  Design 1.
