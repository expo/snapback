# LLP 0317 — super-refine run journal

Orchestrator/reviser: Claude Opus 5 (1M context), session
`session_01UBB1zSNBoCT1wGfdyRcCYj`. Author: Charlie Cheever, who invoked
`/llp-super-refine` on LLP 0317 on 2026-08-27 with an explicit scope:
"make sure nothing was interpreted incorrectly or missed or misdiagnosed."
Document authority and repository-disclosure authority for the external sends
are recorded from that invocation; both reviewers run locally on the author's
machine, and the capsule contains no third-party material beyond the
repository and the author's own benchmark lane artifacts.

Target: LLP 0317 (Research, `Draft`). Single target, no cluster. Author bound:
**one round**, verification-lensed.

Reviewer roster (LLP 0010.001 current instantiation): codex `gpt-5.6-sol`
@ ultra (read-only sandbox, effort confirmed in the run header) and
`grok-4.6` @ xhigh (headless, full terminal ban, built-in file reads only).
Reviser: orchestrator. The reviser never reviews its own revisions.

## Round 1 — verification lens

- **Revision reviewed:** the `Draft` as authored 2026-08-27, sha256
  `5d7682d171827312d1e820f161a42b39a6a42a4c0dea2f765e2a9ffd90d9d732`.
  The document was untracked at loop start; it is committed with this journal.
- **Capsule:** worktree at `origin/main` commit `f977fa589`, plus the target,
  plus `clique-evidence/` — the four Snapback lanes' `diary.md`, `run-log.md`,
  `essay.md`, and `final-report.md` fetched from `expo-build-450b`
  (`/home/ccheever/clique-matrix-0129/lanes/`), with `sol-pocketbase` and
  `terra-convex` included as comparison context. `sol-snapback-explicit` has
  no `final-report.md`: **that lane has not sealed** — its codex process was
  still running and its `run-log.md` still growing during this round.
- **Blindness:** structural. No `llp/reviews/0317*` artifact existed anywhere
  in the capsule at build time, so neither family could reach the other's
  work; neither receives this journal or orchestrator notes. Both families
  read the same capsule read-only. The `llp/reviews/` read ban was
  additionally instruction-based and is self-attested.
- **Snapshot disclosure to both families:** the `sol-snapback-explicit`
  `run-log.md` is a *later* snapshot than the one the author read. Both briefs
  disclose this and require scale-tail-only findings to be reported under a
  separate `OUT-OF-DECLARED-SCOPE` heading, not scored against the verdict —
  §Exclusions and cutoff excludes that tail by design.
- **Instruction hashes (sha256/16):** shared brief `e7959acac7eff81c`;
  codex prompt `c14f2ec71754f484` (7,588 bytes); grok prompt
  `8d57708282cf46f9` (8,515 bytes; adds the terminal ban and the
  read-the-current-file-state substitute for git access).
- **Runtimes:** codex `codex exec --skip-git-repo-check -m gpt-5.6-sol
  -c model_reasoning_effort=ultra -s read-only --cd <capsule>`; grok
  `grok --prompt-file … -m grok-4.6 --effort xhigh --output-format plain
  --disable-web-search --permission-mode dontAsk --max-turns 200
  --cwd <capsule> --disallowed-tools run_terminal_command,search_replace,
  write,image_gen,image_edit,image_to_video,reference_to_video,workflow`.
- **Launched** 2026-08-28T00:22:05Z, kill-proof detached dispatch, logs in
  the session scratchpad under `r1/`. Verbatim preservation on receipt,
  sealed until both land.

### Orchestrator verification (independent, run concurrently)

Per the skill's recipe the orchestrator checks load-bearing claims against
the repository and the evidence before folding anything. Recorded here so the
reviser's own findings are distinguishable from the families':

- All six commits cited by F1–F3 exist and carry the described changes.
  F1's `21684e9cc` touches exactly the two CLI templates that have a
  `metro.config.js` (`expo-chat`, `media-feed`); the other three templates
  have no Metro config, so template coverage is complete.
- F2's `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE` is implemented in
  `packages/snapback-client/app-client.mjs:1179` with tests, not docs-only.
  Its guard requires `typeof globalThis.process?.versions?.node === 'string'`
  — **the warning cannot fire in a browser.**
- All five `Related:` tickets exist on `origin/main` (they were absent only
  from the author's stale local checkout).
- `issues/20260827-defineauth-successor-silent-refusal.md`, the source for
  O29, records `Source: … glm-snapback-explicit lane` — a lane outside the
  document's declared four-lane evidence base.
- The matrix record `benchmarks/runs/2026-08-27-clique-published-0129-matrix/`
  is **already imported into the repository** and contains **eight** Snapback
  lane directories (sol/grok/terra/glm × explicit/familiar), not four.
- `benchmarks/.../record.md` §4 classifies all terra lanes
  `premature-stop, non-signal` and reports terra-explicit's wall as
  ~4–6 minutes; its `final-report.md` epochs give 220 seconds.

Receipts and verdicts are appended below on completion.

### Round 1 receipts

- **codex `gpt-5.6-sol` @ ultra** — returned 00:37:43Z, exit 0, 316,930
  tokens, complete review. **NOT READY**: 6 MATERIAL, 3 non-blocking, 10
  scale-tail items.
- **grok-4.6 @ xhigh** — returned ~00:30Z, exit 0, complete review.
  **NOT READY**: 2 MATERIAL, 4 non-blocking, 10 scale-tail items.
- No voids. Each family launched once; the launch cap was not approached.
  Both reviews were written to their family artifacts before either was read
  for revision.

### Cross-family convergence

Two MATERIAL findings were reached independently by both families:

1. **F2 over-claims.** The shared Node `storagePartition` mechanism cannot
   explain the evidence F2 attributes to it (codex M1, grok M2). Both cite
   `sol-snapback-familiar` `1787857038` (a settled mutation absent from the
   **same** client's live hook, recorded by `manual-playwright`) and
   `1787857472` (cross-client staleness *while the same-client projection
   updated*). Grok additionally identified the Node gate in
   `warnImplicitDefaultPartitionReuse`; codex additionally established that
   the warning and recipe originated in `94e1c1fff`/`144e4c9cf` (2026-08-21),
   so F2's cited commits only retarget existing work.
2. **O29 is outside the declared evidence base** (codex M2, grok M1). Its
   ticket names `glm-snapback-explicit`, a lane the r1 scope excluded.

Both families also flagged O6 as the only O-row in no priority bundle.

### Orchestrator verification of load-bearing reviewer claims

Every claim folded was checked before folding. All held:

- codex M3 (**O10**): `packages/snapback-codegen/ctx.d.mts` declares
  `take(limit: number)`, and `guide/recipes/time-windowed-live-reads.md:136`
  — added by `8f6c21494`, one of **F3's own** cited commits — uses
  `.take(args.limit)`. The orchestrator additionally pulled the
  `@expo/snapback-codegen@0.1.29` tarball from the registry: the published
  version the lanes ran declares `take(limit: number)` at line 123. O10's
  proposed "refuse dynamic `take`" would have removed a supported, documented
  shape and contradicted F3.
- codex M4 (**O12**): the same published 0.1.29 tarball declares
  `refuse(code: string, details?: unknown): never` at lines 313 and 371. The
  repair O12 proposed already shipped in the version under test.
- codex m3: `77b621623` (61 files) and `44fcd1263` (8 files) imported the
  matrix corpus — exit criterion 1 was already satisfied.
- grok m2: `CODEGEN_POLICY_INVALID` has zero occurrences anywhere in `guide/`.
  `SNAPBACK_AUTH_THROTTLED` likewise carries no guide route in
  `guide/reference/diagnostics.md`.
- F1: `21684e9cc` covers both CLI templates that have a Metro config; the
  other three templates have none.

### Orchestrator findings not reached by either family

The reviewers were given the four lanes the document declared. The
orchestrator checked the document's *scope statement* against the repository
and found it understated:

- **The matrix ran eight Snapback lanes, not four.**
  `benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/` holds
  sol/grok/terra/glm × explicit/familiar, all imported before this round. The
  four r1 omitted include **`grok-snapback-explicit`, the deepest scored
  Snapback lane in the matrix** (4/8 greens, builder score 63 — the matrix
  record calls it "the furthest anyone reached on Snapback"), plus
  `grok-snapback-familiar` (2/8) and both glm lanes. Reading them produced
  rows O31–O46 and N18–N20 and corroborated seven existing rows across
  additional independent models.
- **N16's stated cause was wrong.** `terra-snapback-explicit`'s own
  `final-report.md` gives start 1787852931 and end 1787853151 — 220 seconds;
  the familiar lane ran 348 seconds. The matrix record classifies every terra
  cell `premature-stop, non-signal` and excludes them from capability reads.
  "Before its time budget expired" was not what happened.
- **The F2 framing is inherited, not original.** `diaries/0114` §"Where
  Snapback added friction" and `record.md` §6 both assert the
  harness-artifact explanation as settled fact. Correcting LLP 0317 alone
  would leave the error load-bearing in two sibling artifacts and one ticket.

### Revision r2 (reviser: orchestrator, 2026-08-28)

Both round-1 review sets folded, plus the orchestrator findings above.
Revised document sha256
`43c33a211963640317dbdc7c9fd798cc8d8a9b3211036838024bd71dc5e04c49`; the
per-change ledger is in the document's own §Revision history.

**Growth-budget exception, declared.** The document grew from 285 to 451 lines
(~58%), well past the loop's ~20% guidance. The round's central finding was
that half the evidence base was missing and the author's brief was
completeness; folding four lanes of evidence cannot be done within a
correction-sized budget. Recorded here rather than silently absorbed.

### Round 1 terminal state

- **Verdicts bind to r1** (`5d7682d1…d9d732`). Both families: **NOT READY**.
- **r2 (`43c33a21…5e04c49`) is unreviewed.** The author authorized one round
  for this document and directed the effort onward to the follow-up RFC.
  Every r2 change is either a fold of a cited reviewer finding or an
  orchestrator finding verified against the repository and recorded above;
  none is an unreviewed design decision.
- Status stays **`Review`**. Do not read r2 as dual-READY. The natural next
  step, if the author wants closure on this document rather than on the work
  it schedules, is one delta round over the r1→r2 diff.
