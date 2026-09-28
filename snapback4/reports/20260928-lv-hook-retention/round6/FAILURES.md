# Round 6 failures

All captured failures below are **ours** unless explicitly identified as expected
counterfactual evidence. No baseline or environmental product-test exemption is
claimed. Full-suite results are recorded in REPORT.md and the full log.

- `overload-fences.log.gz`: 137/138; only `authoritative E_ASSET_VIEWED and HTTP
  transport failure preserve the already granted first view` failed. Its old
  LV assertion expected `E_OFFLINE` for an HTTP 503 malformed body. FU's correct
  result is `E_HTTP_RESPONSE` with status. Updated the assertion; it still
  requires preservation of the already-granted first view. The affected run
  includes the corrected case.
- `combined-before.log.gz`: 3/6; query overload on online, process and wasm
  withdrew a retained peer (`undefined` instead of `secret`). This was a real
  merge interaction: coded admission refusal incorrectly entered authoritative
  reconciliation. Added an explicit non-authoritative admission result, preserving
  the direct refusal without retiring memory or raising floors. All six combined
  cases now pass, including asset overload followed by authoritative missing and
  query overload followed by real membership loss.
- `matrix-added.log.gz`: 14/15; `every delivery await is explicitly classified`
  failed because the first extension predicate included every online function
  rather than only the changed `refresh` owner. Strict generation also refused
  unmapped index 166. Corrected the predicate; no new default classification.
  `matrix-added-fixed.log.gz` passes 15/15; complete `matrix-final.log.gz` 333/333.
- Expected counterfactual: `mutant-certificates.log.gz`, 0/4. Replacing the
  missing-read-certificate fallback with `[]` fails both withdrawal and delayed
  direct-reply assertions on process and wasm. The unmodified implementation
  passes all four; this kills Astra's surviving Low-priority mutation.
- Operational setup: one edit command used a doubled `snapback4/` prefix from
  inside that directory, raising FileNotFoundError before modifying anything.
  Its following name-filtered test selected no cases; that output was replaced
  by the actual six-case before run and is not evidence. Corrected the path.
  Preliminary discovery reads guessed a nonexistent LLP filename and helper
  filename; their failed reads made no changes. The expected merge-conflict
  exit was resolved preserving both lanes. These are ours, not environmental.


## Single full-suite run

The client stage failed two cases; both reproduce with the pre-round-6 LV
`25ed46bfe` SDK, and both pass with an isolated SDK transpiled from main
`dc21eb085`. Both controls use this round's server/wasm to isolate SDK behavior;
no other checkout was edited. They are **ours, inherited from LV**, not baseline
exemptions. Original focused rerun: 0/2 (`full-failures-rerun.log.gz`). Controls:
`baseline-main.log.gz` 2/2, `baseline-lv-r5.log.gz` 0/2.

1. `app replacement never persists a late successor before probing the kept session`
   (`online-terminal-entrypoints.test.mjs`): expected transient `restoring`, got
   `signed-in`. The unblocked replacement probe can complete before the query's
   additional publication continuations return. The fixture now holds that probe,
   checks restoring and absence of successor persistence while it is held, then
   releases it and preserves the old bearer/probe and late-successor logout checks.
   No app/session implementation or FU refresh custody rule changed.
2. `server-class watches run locally first and recover remembered server data offline`
   (`residency.test.mjs`): read of `data[0]` on the newly mounted watch failed.
   A retained live snapshot is not evidence that the separate server-answer memory
   survived a later applied publication. The fixture now completes sync and obtains
   a checked current server answer before going offline and remounting. It retains
   the assertions for stale data, local-first execution and online recovery. The
   held/unapplied authority cases remain in the fence suites. No cache/fence rule
   was weakened to retain pre-evidence data.

The first fixture correction (`full-failures-fixed.log.gz`) passed the session
case but still failed residency: apply alone does not certify remembered data.
The explicit post-apply answer establishes that precondition. The final focused
run passes 2/2 (`full-failures-qualified.log.gz`); both complete files then pass
28/28 (`full-failure-files.log.gz`). These two corrections change test fixtures
only. A subsequent model timeout led to the separate terminal-denial production
correction below. No second `scripts/test.sh` is run and its red result is not
relabelled green.


3. `online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`
   exceeded its unchanged 240-second timeout in the full run (**ours**). A logged
   diagnostic kept advancing seeds, rather than hanging; it was intentionally
   stopped by its recorded PID once the unnecessary waits were reproduced.
   It is incomplete diagnostic evidence, not a 5,000-sequence pass.
   Round 5's universal request capture attached an already-retired signal even to
   a terminal denial. `currentRead` rejected that safe absence and incurred all
   three 25/50/100 ms retry waits. Three new close/sign-out/replacement regressions
   fail with those waits (`terminal-before.log.gz`) and pass with none after the
   fix (`terminal-qualified.log.gz`). Only denied results in an already-terminal
   scope bypass the data fence; the public return still selects its current
   terminal refusal. No timeout, sequence count, meter, retry budget or data
   acceptance check is relaxed. Final official models pass 79/79 at their original
   counts/timeouts (online 5,000 sequences in 87.1 seconds), and the final affected
   selection passes 558/558 including all 333 matrix cases. Final browser 3/3,
   whole guide 98/98 and typechecks pass. The original full run remains red and
   is not a final-tree qualification.
