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
- **Launch/results:** recorded below.
