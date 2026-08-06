# LLP 0185 — super-refine run journal

**Target:** `llp/0185-instance-forking-productization.plan.md`
**Invoked:** 2026-08-05 by the author (Charlie Cheever), via
`/llp-super-refine llp/0185-instance-forking-productization.plan.md` with an
explicit round budget of 1-2 rounds
**Orchestrator/reviser:** Claude Sonnet 5 (this session)
**Round budget:** 2 (author-specified, narrower than the skill's default 3) ·
**Launch cap:** 4 per family per target
**Topology:** single document, single loop. 0185's `Related` list (LLP 0000,
0010, 0024, 0061, 0081, 0088, 0097, 0113, 0158, 0162, 0164, 0165, 0184) names
authority owners it defers to, not tightly coupled siblings under
simultaneous refine — no lockstep cluster.

## Authorization and disclosure

- Document authority: the author invoked the loop directly on this named
  target. `Author:` line reads "Charlie Cheever / Codex" — matches the
  invoking user.
- Status transition applied **before** launch: `Draft → Review`.
- Entering-review-loop revision identifier: this document is untracked in git
  (new file, `??` in `git status` at loop start), so revisions are identified
  by content sha256, not a commit hash.
- Pre-transition hash: sha256 `9b6251d2c397289bf930e42cf1b957bf38910d776aa3d41676c1ef555b37c38f`.
- Post-transition (Draft→Review) hash, the actual round-1 entering revision:
  sha256 `30ed2391d02c46e608ec9f5590eae810c03b8aafecbfadefbb3a248cb9236154`.
- Outbound disclosure: each review capsule instructs the reviewer to read the
  target Plan in full, plus — at the reviewer's discretion, to check its
  factual and authority-boundary claims — the LLPs it cites (0000, 0010, 0024,
  0061, 0081, 0088, 0097, 0113, 0158, 0162, 0164, 0165, 0184) and the two named
  filesystem tickets. No credentials or secrets are in scope. Destinations:
  Anthropic (claude family, via a fresh subagent in this same local checkout)
  and OpenAI (gpt-5 family, via local `codex exec` in this same local
  checkout).

## ⚠ Blindness is instruction-based, not structural

Both reviewers run inside this same repository checkout with full filesystem
read access — there is no git-archive export or sandboxed capsule excluding
`llp/reviews/0185*`. Each reviewer is explicitly instructed not to read
`llp/reviews/0185-*` or this run journal. This is self-attested
instruction-based blindness (LLP 0010 §2), disclosed per the invariant.
Neither reviewing session authored this Plan (the claude subagent is fresh;
the gpt-5 `codex exec` invocation is a fresh process with no memory of any
prior Codex session that may have contributed to drafting), so there is no
self-review bias in either direction.

## Round 1

- **Entering revision:** content sha256
  `30ed2391d02c46e608ec9f5590eae810c03b8aafecbfadefbb3a248cb9236154`
- **Entering status:** Review (transition applied pre-launch)
- **Reviewers:** claude family = fresh Opus 5 subagent (general-purpose, no
  prior context); gpt-5 family = local `codex exec -m gpt-5.6-sol -c
  model_reasoning_effort=xhigh`, sandboxed read-only.
- **Lens:** none declared (standard review).

Round record persisted; launched.

### Round 1 verdicts — both NOT READY

| family | verdict | MATERIAL | DETAIL |
| --- | --- | --- | --- |
| claude (Opus 5, blind) | NOT READY | 6 | 8 |
| gpt-5 (codex exec, gpt-5.6-sol@xhigh, blind) | NOT READY | 7 | 6 |

Full text: `llp/reviews/0185-instance-forking-productization.claude.md`,
`llp/reviews/0185-instance-forking-productization.gpt-5.md`.

### Cross-family agreement — concerns both families independently raised

- **Baseline overstates crash recovery as available**: `instance_fork::recover`
  is unit-tested but has no product caller — claude MATERIAL 5, gpt-5
  MATERIAL 1, independently convergent, same code citation pattern.
- **Phase 2/Phase 3 ordering is inverted**: Phase 2's exit asserts properties
  (no data/credential/cleanup trampling under parallelism) that are actually
  proved by Phase 3, which runs after it on the critical path — claude
  MATERIAL 2, gpt-5 MATERIAL 2, independently convergent.
- **Phase 5's permitted design choice contradicts its own exit, and reopens an
  LLP 0158 OQ5 decision that already settled the local posture** — claude
  MATERIAL 4, gpt-5 MATERIAL 6, independently convergent (gpt-5 additionally
  cited LLP 0158 OQ5's text directly).
- **Phase 4's "exact diff" exit is unreachable without adopting LLP
  0164/0165's substrate and completeness choices** — claude MATERIAL 3b
  (ownership mis-scoped), gpt-5 MATERIAL 3 (three concrete missing
  prerequisites: immutable base/preimage policy, writer-authority choke
  point, finite retention rule). Same root defect, gpt-5's framing more
  mechanically specific.
- **Publication (Phase 6) is not actually gated on the acceptance state of
  its own dependencies** — claude MATERIAL 6 (LLP 0162 row 13 absent from
  Phase 6's gate list), gpt-5 MATERIAL 4 (LLP 0158/0164/0165 Draft status,
  row 13, and the acceptance-tail ticket's "including row 13" language all
  unaddressed). Converge on the same publication-gate insufficiency from
  different angles.

### Where the two families found different defects

- **claude** found the missing LLP 0024 ownership bullet (MATERIAL 3a) and
  the TTL/reaper enforcement gap (MATERIAL 1, arguably the most severe
  finding of the round — the cross-cutting "every fork has a finite TTL"
  invariant has no enforcement mechanism, only an externally-invoked sweep)
  — gpt-5 did not raise either.
- **gpt-5** found that LLP 0113 is not obviously the right publication
  authority for this capability class (MATERIAL 5, citing LLP 0134's
  carrier-selection rule) and that LLP 0099 does not own general fork/volume
  semantics for Phase 8's containment research (MATERIAL 7) — claude did not
  raise either.

All 9 distinct MATERIAL concerns (6 claude + 7 gpt-5, with 5 cross-family
overlaps collapsing to the 5 items above) are addressed in the round-1 →
round-2 revision below.

## Round 1 → round 2 revision

Applied directly to `llp/0185-instance-forking-productization.plan.md`. This
is the **last revision in the author-specified 2-round budget** — round 2's
review (below) is the final scheduled round unless the author extends it.

- **Added automatic TTL-enforcement as Phase 1 item 1** (create-time reap of
  expired siblings plus a boot-time/periodic sweep, no external `--now-ms`
  invocation required) and restated the cross-phase TTL invariant to say
  expiry is enforced by a mechanism this Plan builds, not metadata alone —
  claude MATERIAL 1.
- **Added `recover()` wiring as Phase 1 item 2** and corrected the "Current
  baseline" bullet to distinguish crash-safe *publication* (real) from
  local-evidence *recovery* (tested primitive, no product caller) — claude
  MATERIAL 5, gpt-5 MATERIAL 1.
- **Split Phase 2 into Phase 2a (single-consumer harness/worktree, ungated)
  and Phase 2b (parallel suites/fork-per-agent, gated on Phase 3)**, moved
  the critical path to `... Phase 2a → Phase 3 → Phase 2b and Phase 4 → ...`,
  and reworded Phase 2b's exit to attribute its isolation guarantee to Phase
  3's evidence rather than asserting it directly — claude MATERIAL 2, gpt-5
  MATERIAL 2.
- **Added LLP 0024 as a named owner** (host-op/ready-descriptor envelope,
  JSON result envelope) with Phase 0/1/7 scoped to consume rather than
  redefine it; **corrected the LLP 0164 bullet** to state its diff-surface
  ownership for both fork classes, and bound Phase 4 to adopt LLP 0164's
  chosen diff substrate and LLP 0165's completeness choke point (new Phase 4
  item 0) instead of inventing a competing definition — claude MATERIAL 3a,
  3b + gpt-5 MATERIAL 3.
- **Rewrote Phase 5** to implement LLP 0158 OQ5's already-decided local
  posture (fork-private same-cut copy only) rather than offering a
  content-addressed-sharing option that contradicted its own exit; moved
  shared/content-addressed custody to Phase 8/hosted scope under an explicit
  LLP 0158/0044 amendment requirement — claude MATERIAL 4, gpt-5 MATERIAL 6.
- **Added Phase 6 item 0**: an explicit governing-document gate (LLP 0158
  acceptance, LLP 0164/0165 acceptance, all applicable LLP 0162 rows
  including row 13) that Phase 6's exit now binds to — claude MATERIAL 6,
  gpt-5 MATERIAL 4.
- **Added Phase 0 item 6**: decide the publication-authority mechanism (LLP
  0113 `TargetCapabilityId` vs. LLP 0061 Guide claim vs. new carrier) with
  the relevant owners before Phase 6 assumes LLP 0113 — gpt-5 MATERIAL 5.
- **Reworded Phase 8 item 2** to stop attributing general fork/volume
  semantics to LLP 0099 (a migration-executor profile); `ProcessContained`
  research now explicitly routes through LLP 0158 F2 and LLP 0072's adapter,
  reusing LLP 0099 evidence only as an accelerator — gpt-5 MATERIAL 7.
- Also applied: claude DETAIL 1 (qualified the vendored LLP 0005/0010
  citations), DETAIL 2 (Related-header additions: LLP 0024, 0044, 0072,
  0099, 0134, 0163), DETAIL 3 (Acceptance §3 phase-list correction), DETAIL 4
  (Phase 4 exit bound to LLP 0162 row 9 explicitly), DETAIL 5 (disambiguated
  Phase 2a's templates from the Deferred-ideas template/checkpoint items),
  DETAIL 7 (OQ1 reframed against the actual phase placement), DETAIL 8 (noted
  LLP 0158 OQ8's freeze-relevance in Phase 0, via the item-5 reconciliation
  pointer — not separately called out as its own item). claude DETAIL 6
  (dogfood-only baseline distinction) was folded into the recovery-bullet
  rewrite rather than added as a separate note. gpt-5 DETAIL 1-6 were applied
  via the same edits above (0005/0010 qualification, backup-API clarification
  in the baseline, Phase 1 diagnostics reordering note, OQ1/OQ3 reframing,
  Phase 7 item 5's `cliOnly`/`mcpOnly`/`apiOnly` wording, Related additions).

**New revision:** content sha256
`d247470d3069f507a420356be4e2c11eea1671c918cd57872663b5961df65c61` (582
lines, +33.2% over the 437-line entering revision — over the ~20% growth
guideline. Disclosed rather than trimmed: two independent families raised 9
distinct MATERIAL concerns in one round, several structural (TTL enforcement,
the Phase 2/3 ordering inversion, the publication-gate insufficiency), and
the fixes are new gating/ownership text rather than padding.

`ref-check --verbose` passes post-revision (186 LLP docs, 6007 refs, 0
errors, 0 unchecked).

## Round 2

- **Entering revision:** content sha256
  `d247470d3069f507a420356be4e2c11eea1671c918cd57872663b5961df65c61`
- **Entering status:** Review (unchanged)
- **Round budget note:** this is round 2 of the author-specified 2-round
  budget — the last scheduled round. If NOT READY on both families again,
  the loop terminates per the bounds rule (budget exhaustion) with a
  terminal escalation to the author rather than a further round, absent an
  explicit author extension.
- **Reviewers:** claude family = fresh Opus 5 subagent (general-purpose, no
  prior context, blind to round 1); gpt-5 family = local `codex exec -m
  gpt-5.6-sol -c model_reasoning_effort=xhigh`, sandboxed read-only, fresh
  process (blind to round 1).
- **Lens:** each reviewer is given its own family's round-1 review and asked
  to (a) check whether each round-1 MATERIAL concern was actually resolved by
  the revision and (b) do a full fresh adversarial pass for anything new,
  including the newly restructured Phase 2a/2b split and the new Phase 0/4/6
  items. Blind to the other family's round-1 review and to this run journal.

Round record persisted; launched.

### ⚠ VOIDED ATTEMPT — gpt-5 round 2, blindness break, self-reported

The gpt-5 reviewer ran a broad `rg` search while checking a cited source and
its own tool output incidentally surfaced one paragraph from the forbidden
`llp/reviews/0185-instance-forking-productization.claude.md` (the claude
family's round-1 review — specifically the MATERIAL 3a discussion of LLP
0024's missing ownership bullet, a finding gpt-5's own round-1 review did not
independently raise). The reviewer caught this itself, stopped, and returned
an explicit non-review: "This is a procedural failure, not a substantive
readiness verdict... this response is invalid as an independent
`llp-super-refine` review and must not be counted toward convergence." No
file was written by the reviewer and the leaked fragment was not used as
evidence in its (abandoned) analysis.

Per the honesty rules (never fabricate or count a compromised review as
real), this attempt is **voided** and does not count as a round-2 verdict for
gpt-5. It is recorded here rather than silently discarded. The claude
family's round-2 review (above) is unaffected — it was a separate process
with no shared context, completed and verdict-bound before this attempt ran.

Root cause: the round-2 prompt told the reviewer not to *read* the specific
`llp/reviews/0185-*` files, but did not tell it to exclude `llp/reviews/`
entirely from broader searches (e.g. `rg` across the repo for a cited
string), which is how a match landed in tool output incidentally. Fix
applied to the re-run prompt below: explicit instruction to exclude
`llp/reviews/` from any grep/search tool invocation, not just direct reads.

### gpt-5 round 2, re-run (attempt 2)

- **Entering revision:** unchanged, sha256
  `d247470d3069f507a420356be4e2c11eea1671c918cd57872663b5961df65c61`
- **Reviewer:** gpt-5 family, fresh `codex exec -m gpt-5.6-sol -c
  model_reasoning_effort=xhigh`, sandboxed read-only, new process (no context
  carried over from the voided attempt).
- Same round-2 task (check its own 7 round-1 MATERIAL + 6 DETAIL findings for
  resolution, plus a full fresh adversarial pass), with the search-scope
  fix above.

Launched.

### Round 2 verdicts (both attempts) — both NOT READY, budget exhausted (2/2)

| family | verdict | round-1 concerns resolved | new MATERIAL | new DETAIL |
| --- | --- | --- | --- | --- |
| claude (Opus 5, blind) | NOT READY | 5 resolved / 1 partial (of 6) | 3 | 8 |
| gpt-5 (codex exec, attempt 2, blind) | NOT READY | 4 resolved / 3 partial (of 7) | 2 | 2 |

Full text: `llp/reviews/0185-instance-forking-productization.claude-round2.md`,
`llp/reviews/0185-instance-forking-productization.gpt-5-round2.md`. (The
voided gpt-5 attempt 1 is not a review artifact and is not saved as one —
recorded only in this journal, above.)

### Cross-family agreement — round 2

- **Sequencing/Summary give two contradictory dependency graphs for Phase
  2b vs. Phase 4.** claude found this as DETAIL 5 ("Sequencing's third bullet
  contradicts Phase 2b's own gate"); gpt-5 found the same defect but treated
  it as blocking severity within its PARTIALLY RESOLVED assessment of
  round-1 MATERIAL 2 ("Implementers cannot derive one dependency graph from
  the document as written"). Same defect, different severity framing —
  treated as MATERIAL in the round-2 revision given gpt-5's framing and the
  fact two independent families both flagged it.
- Both families independently confirm the five/four cleanly RESOLVED
  round-1 items are actually fixed on the merits (matching code/LLP
  citations, not just nearby text changes).

### Where the two families found different new defects

- **claude** found that Phase 2a's own item 2 (fork-per-worktree helper,
  "collision-free ports") contradicts 2a's "no concurrent contention"
  framing (new MATERIAL 1), that Phase 2b's exit promises "ports" evidence
  no phase produces (new MATERIAL 2), and that Phase 6 item 0's governance
  gate omits LLP 0024's Draft status and LLP 0134's ownership of the
  registration act Phase 6 item 6 performs (new MATERIAL 3) — gpt-5 did not
  raise any of these.
- **gpt-5** found that the new LLP 0024 ownership bullet is factually wrong
  — LLP 0024 itself defers the ready-file schema to LLP 0030, and
  projection parity is LLP 0184's obligation, not 0024's (new MATERIAL 1,
  **verified independently by the orchestrator against `llp/0024`'s own
  text**: "readiness is the `--ready-file` descriptor —
  `schemas/host-ready.schema.json` — per LLP 0030's out-of-band
  [handshake]") — and that Phase 7 item 1 dropped the newly-required
  `recover` operation from its projected catalog list (new MATERIAL 2) —
  claude did not raise either (claude's DETAIL 3 touched the same LLP 0158
  OQ6 territory but did not catch the recover-omission specifically).
  gpt-5 also elevated round-1 MATERIAL 4 to PARTIALLY RESOLVED rather than
  RESOLVED, on a real gap claude did not independently re-check: LLP 0163
  is Draft and is not in Phase 6 item 0's governing-document list, even
  though the named acceptance-tail ticket requires it; and round-1
  MATERIAL 5 stays PARTIALLY RESOLVED because Phase 0 item 6 doesn't name
  an owner/acceptance path for the "new carrier" option and Phase 6 item 1
  assumes every mechanism produces a "manifest."

7 distinct new/residual MATERIAL concerns across the two round-2 reviews
(3 claude + 2 gpt-5 new, + the shared Sequencing contradiction, + gpt-5's
LLP 0163 gate gap) are addressed in the round-2 → round-3 revision below.

### Terminal disposition — author-specified budget exhausted (2/2)

Per the bounds rule (LLP 0010 §2): the author's explicit 2-round budget for
this loop is now exhausted, with both families still NOT READY. This is
ordinary budget exhaustion, not a cross-family contradiction or sustained
asymmetry — both families agree on direction, on all five/four cleanly
resolved round-1 items, and independently found (from different angles) the
Sequencing/Summary dependency-graph contradiction. The remaining ledger is
narrower and more mechanical than round 1's (9 → 7, with real convergence on
the closed items), and every remaining item is a targeted text fix (an
ownership-bullet split verified independently, a missing catalog entry, a
missing gate-list entry, two placement fixes, a wording fix) rather than a
design-level objection — no reviewer raised a fundamental-redesign concern
at any point in either round.

**Escalating to the author per the bounds rule**, with the disposition
options: (a) stay at `Review` and apply the round-2 findings as an
unreviewed manual closing pass, the way LLP 0184's loop closed after its
own author-extended budget exhausted with a small mechanical remainder; (b)
authorize one more (round-3) reviewed round; (c) stay at `Review` and leave
the remainder as filed defects without applying a revision now; or (d)
revert to `Draft`. The orchestrator's read, given the pattern in both
verdicts' Discussion sections (claude: "none of it requires another full
round"; gpt-5 raises no objection to the overall direction, only to specific
facts and gate completeness): option (a) or (b) both fit; this is the
author's call, not the loop's to make unilaterally at budget exhaustion.

**Author's ruling (via AskUserQuestion):** option (a) — apply a manual
closing pass now, document stays at `Review`.

## Post-round-2 author-directed closing pass

Applied directly to `llp/0185-instance-forking-productization.plan.md` per
the author's explicit authorization above — a manual pass, not a further
super-refine round, disclosed as such per the same pattern LLP 0184's loop
used for its own post-budget closing pass.

Before applying, the orchestrator independently verified gpt-5's new
MATERIAL 1 (LLP 0024 ownership bullet) against `llp/0024`'s own text: it
confirms "readiness is the `--ready-file` descriptor —
`schemas/host-ready.schema.json` — per LLP 0030's out-of-band [handshake]",
and confirmed LLP 0030 and LLP 0163 are both `Status: Draft`.

- **Split the LLP 0024/0030/0184 ownership bullet correctly**: LLP 0024 owns
  host-op identities/DTOs/result envelope; LLP 0030 owns the ready-file
  handshake and schema (LLP 0024 itself defers to it); LLP 0184 owns
  control-catalog completeness and cross-surface projection parity (Phase
  7's parity claim moved from "LLP 0024's obligation" to LLP 0184's, its
  correct owner) — gpt-5 new MATERIAL 1, orchestrator-verified.
- **Added an LLP 0134 ownership bullet** for the `TargetCapabilityId`
  registration/promotion act itself, conditional on the LLP 0113 route —
  claude round-2 MATERIAL 3b.
- **Moved the fork-per-worktree helper from Phase 2a to Phase 3-gated Phase
  2b**, since "collision-free ports" is inherently a concurrent-fork
  requirement that contradicted Phase 2a's "no concurrent contention"
  framing, and the Plan's own baseline records a dated two-worktree
  teardown-race hit by exactly this workflow — claude round-2 MATERIAL 1.
- **Added port allocation/collision to Phase 3 item 5's race corpus**, so
  Phase 2b's exit claim that "Phase 3 already proved" port-safety has actual
  backing — claude round-2 MATERIAL 2.
- **Added LLP 0163, LLP 0024, and LLP 0030 to Phase 6 item 0's
  governing-document gate**, plus an explicit LLP 0134 same-commit
  obligation note — claude round-2 MATERIAL 3a, gpt-5 round-2 PARTIALLY
  RESOLVED note on MATERIAL 4.
- **Reworded Phase 6 item 1** to stop assuming every publication mechanism
  produces a "manifest" and to require a named owner/acceptance path for the
  new-carrier option — gpt-5 round-2 PARTIALLY RESOLVED note on MATERIAL 5;
  also named a counterparty for that option in Phase 0 item 6 — claude
  round-2 DETAIL 6.
- **Added `recover` to Phase 7 item 1's projected catalog operations** —
  gpt-5 round-2 new MATERIAL 2.
- **Fixed the Sequencing/Summary Phase-2b-vs-Phase-4 dependency-graph
  contradiction** both families independently flagged (claude round-2
  DETAIL 5, gpt-5 round-2 elevated within its PARTIALLY RESOLVED read of
  MATERIAL 2): Phase 4 no longer appears to gate Phase 2b; Summary's ordered
  list now shows the 2a-before-3 split explicitly.
- **Renumbered Phase 2a/2b items and all cross-references** (Deferred ideas,
  Open questions 1/3) consistently after moving the worktree helper.
- Also applied, mechanical: Phase 2b's interruption-test item now names
  three explicit crash dispositions instead of conflating reap and recovery
  — gpt-5 round-2 DETAIL 1; Phase 4 item 0 already named "first-write
  preimage" explicitly (gpt-5 round-2 DETAIL 2 was effectively already
  satisfied by the round-1 wording, re-verified, no further change needed).

**Final revision:** content sha256
`24bb5398c4ab845c956bf5187196814a8fcc93d32a1636926b9088db340ca625` (635
lines). `ref-check --verbose` passes post-revision (186 LLP docs, 6007 refs,
0 errors, 0 unchecked). This revision has **not** been run through a further
super-refine round — the author explicitly authorized this closing pass in
place of a round 3. `Status` remains `Review` (this skill never sets
`Accepted`; a human maintainer read is the natural next step before any
`Accepted` decision).

**Growth note:** 437 → 582 → 635 lines across the full loop (+45.3% net).
Disclosed at each step: two independent full review rounds surfaced 16
distinct MATERIAL concerns total (9 round 1 + 7 round 2) across two model
families, plus one self-caught blindness break; the growth is new
gating/ownership/sequencing text fixing real, verified defects (several
independently confirmed by both families, one independently verified by the
orchestrator against primary-source LLP text), not padding.
