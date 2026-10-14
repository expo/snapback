# Integration 10: PAGE3 after 0.4.27

Local no-ff merge **9131f31d18** has parents `ce229488de` and
`c0e67969a1` (PAGE3). Version stays **0.4.27**; PAGE3 ships in 0.4.28
with wave-11. Nothing was pushed. Mac qualification is deferred to that
publication because the Mac is offline.

Integration 9's intrinsic-id Lean residual sampling, contextual `not`
columns, non-timed reader lanes, expiry-only search authorization, valid
membership seeds and grant-counter normalization remain. Both smoke suites
survive the merge. PAGE3's new family test uses the existing model helper:
native coverage is unconditional and required Lean qualification cannot skip.
Journal and historical wasm records preserve both branches.

Qualification repairs are `b4da2e6fc2`, `4ebe56f4f1` and `498f8110f9`:

- The first native 20k campaign found nine `rewrite-let--next--array`
  disagreements. PAGE3 direct and let-hoisted forms selected different proved
  plans with different opaque cursor bytes. The oracle now follows each plan's
  own cursor and compares every page, cursor presence and other semantic fields.
  Its bound counts post-prelude physical rows and handles terminal pages
  immediately. Three real regressions cover the original seed, prelude-created
  rows, missing cursors, changed data/completeness/refusals and invalid resumption.
  Initial findings and the reduced case are retained here.
- Fresh Codex round 1 found the seeded-row bound. Both families reviewed the
  corrected implementation in round 2 and explicitly approved the checkout's
  corrected six-execution assertion. Frozen briefs and verbatim stdout are under
  `llp/reviews/3000.035-integration10-cursors.*`; stderr is compressed here.
  Muse's plan quota recovered via its wrapper's authorized API fallback.
- PAGE3's two prefix-decided owner ranges each reserve two static probes, so
  the old scan's eight-probe assertion becomes four. Preserve all paired-world
  outcomes, hidden-lifetime equality, next-expiry checks and eight-probe writes.
  The repaired existing sequence-disclosure regression passes.
- The full simulator exposed a product regression: PAGE3 merged the pure-member
  empty-search browse arm, preventing paired-scan recognition and losing the
  optimized nonempty audience. A separate compiler site set preserves pure-member
  search variants while keeping plain PAGE3 lists and owner/compound families
  eligible. It does not change equality/order-pin behavior. The unchanged
  99,090-row regression, four read-cut controls, ten word-expansion device tests
  and new paired compiler regression pass. Both fresh review families are READY
  at the final frozen patch; records are `3000.036-integration10-search.*`.
- `word-expansion.json` was regenerated twice through its native generator.
  The search fix restores the original main bytes, superseding the temporary
  backend update in 4ebe56f4f1. All 13 populations retain the original authorized
  pages, rows and final backends; no fixture was hand-merged.
- The wave-1 missing-pin diagnostic retains its negative case through fallible
  arithmetic and asserts the original pure-membership page is now note-free.
- The authority-cache test explicitly selects an ordinary scan for its
  speculative-prefix control. Its explicit primary-index spelling keeps
  PAGE3's fenced membership discovery out of that one control; every cache,
  authorization and direct-device assertion remains. Other authority cases
  continue testing PAGE3's normal plans.

The requested full Rust command completed with 5,979 passes, four initial
failures and 41 intentional ignores. All four failed cases have passing
repairs, and the full affected language package was rerun: 1,895 passes,
zero failures, 14 ignores. The added compiler regression contributes one new
case. The four initial failures and their scoped corrections are retained
honestly in `qualification.json` and the logs, rather than rewriting the
original full-run exit 101 as a green command.

All 381 ordinary client files ran in one complete 24-slot pool, including
its individually drained timer group: 7,394 passes, one initial authority
control failure, 56 skips, zero cancellations/TODOs. The repaired full authority
file passes 13/13; qualified ordinary count is 7,395. Both full-count models
pass 81/81 and fixtures 9/9. There are zero unresolved introduced failures.

No full `scripts/test.sh` was run. Every orchestrated Cargo invocation carries
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
One independent Codex review's additional tests used default Cargo profiles;
I omitted those constraints from its brief. Those actual commands are retained
in the review log. The official qualification uses the requested environment;
future delegation briefs must include the complete constraints.

| Completed check | Result |
|---|---|
| Lean `check.sh` | 59 standard-axiom audits; 74 examples; seven fixtures |
| Native difftest, seed 0, 20k, eight workers | 20k compiled; 1,135,558 executions; zero errors/disagreements |
| Device difftest, seeds 0–999, eight workers | 1k compiled; 30,154 executions; zero errors/disagreements |
| Lean difftest, seed 0, 20k, eight workers | 20k compiled; 53,008 executions; zero generator errors; no new signatures |
| Difftest tests | 70 pass, including 23 smoke and 35 Lean tests |
| Full affected language package | 1,895 pass; zero failures; 14 intentional ignores |
| Full client pool, after scoped repair | 7,395 ordinary passes; 56 skips; 81 model and nine fixture passes |
| Client package | Build and typecheck pass |
| README budget | 320/320 lines; named first-account test passes |
| Root inventories | 365 package tests, 35 scripts tests, 31 demos/catalog entries, 487 publication leaves, 162 guide pages/1,937 snippets |
| Root guide | 22 checks pass; zero failures/skips/preconditions; inherited warnings retained |
| Reference check | 545 LLP docs; 11,784 refs; zero errors/unchecked |
| Farm, original copied sources | All 50 compile; two notes in one schema |
| Farm, exact checked repair on further copies | All 50 compile; zero notes |

Lean's exit 1 is retained honestly: 168 disagreements in the four Integration 9
baseline signatures (`E_RULE~NOT_FOUND` 3, continuation-next 46, next 91,
prelude-code 28). There are zero new signatures. Unsupported cases remain
separate from passes; see `lean.json` and `lean-signature-comparison.json`.

Censuses were regenerated: 213 delivery sites, 1,149 whole-source await sites,
722 native census entries, 412 mutation occurrences and 90 distinct private
write sites. Their committed projections are unchanged. Diagnostics, symbol
registry and root guide inventories/projections were regenerated. The fresh
root workspace needed `scripts/ensure-workspace-hoist.mjs` after frozen Bun
installation; root inventories and all guide checks then passed. The root dependency directory
was later absent during closeout; frozen installation and hoisting restored it,
and final inventories and all 22 guide checks pass.

Farm hashes, per-schema notes and actual binary hash are in `farm-survey.json`.
The 50 source copies are retained as `farm-sources.tar.gz`; rerun with
`python3 snapback4/reports/20261014-integration10/farm-survey.py`. It checks
input hashes against PAGE3's original manifest, works only on fresh copies in
this worktree's ignored target directory and asserts the exact 2/1 and 0/0
counts. Original farm/workstream worktrees were not modified.

Locked clean Linux metrology at merge 9131f31d18:

| Artifact | Bytes |
|---|---:|
| Device raw | 2,313,446 |
| Device gzip | 705,305 |
| Device brotli | 532,895 |
| Budget | **705,805 = gzip + 500** |

Whole-artifact delta versus Integration 9 final Linux: +5,258 raw / +1,127
gzip bytes; versus isolated PAGE3: +3,053 / +643. Family and forbidden-code
absence audits pass. The final wasm build passes the new budget. No per-feature
attribution or runtime ceiling increase. Later repairs change compiler planning, tests, difftest oracles, fixtures and
documentation; none is linked into the web device.
