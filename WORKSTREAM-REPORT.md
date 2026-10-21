# Integration 20 — 0.4.36 (in progress)

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
No push or publication. Publication worktrees and `target/publication/` are untouched.
Every launched shell command has an outer timeout. Cargo runs carry the three
requested profile/incremental environment settings; the prohibited full
`scripts/test.sh` is never used.

## Commits and integration

- Fast-forwarded origin/main f0eed70bb3 → 86303f71df, preserving the test-only
  asset module census correction. A later fetch found no additional main commits.
- DX5 merge: 825ec1d055. SEC5 merge: d0551b2f37. Kept the integration report on
  its conflict, retained both append-only journal entries, and combined one
  0.4.36 changelog section with existing-app upgrade effects.
- Dedicated bump: d8deda73dd (`snapback4 0.4.36: specification intent, staging
  diagnostics and lighter starters`), exactly the 0.4.35 bump's ten-file set.
- LLP 3000.037 §20 waves 20/21: 6220e43d95. Wave21 aggregator rerun completed;
  records distinguish app-proof success, the one harness stage failure and
  calibrated versus aggregator security counts.
- Integrated repairs: ReadState indexes, packaged README native-smoke import,
  shim fixture dependency, exact expected cleanup advice, explicit React peer
  in packed proof, and review-tier lookup/unique advice. The source authority
  notes must not say no action is needed until slow.

## Completed verification

- Root frozen install, workspace hoist and check-generated-artifacts PASS.
  Regenerated diagnostics registry and guide manifest. Root inventories PASS:
  365 package tests, 35 script tests, 31 demos, 487 publication leaves,
  162 pages/1,937 snippets. Root guide PASS: 22 checks, zero skips/preconditions.
  Root ref-check PASS: 564 LLPs, 12,229 refs, zero errors/unchecked.
- Codec census PASS: 27 tests. Recomputed RULES4 authoring census from its
  executable output (unchanged membership) and delivery-await census (one
  proof.ts clock timestamp projection; no new delivery fault site).
- Complete Linux wasm: 2,404,922 B raw / 733,902 B gzip / 553,033 B Brotli.
  Budget 734,402 B = measured gzip + 500 B, with whole-artifact reason.
  Strict serde-family and server-only absence audits PASS.
- Matched baseline f0eed70bb3 and merged CLI surveys: 350 schemas (wave15 100;
  waves16/18/19/20/21 50 each), zero refusals on both, original bytes unchanged.
  New security notes remain advisory: caller time 0→74, self-claim 0→2,
  role-wide read 11→133, broad read 363→365, restatement 761→810. Other
  security-note counts unchanged. Source diagnostics: lookup 26→1,533;
  hidden unique 0→91. No claim of zero specification noise.
- Fresh Exact2 origin/main clone under ~/sb4-loop/prewave20/exact2. The SDK's
  Snapback Cargo dependencies point to this merged 0.4.36 source for the test;
  server/client come from this tree. Exact setup PASS after explicitly naming
  installed Chromium. Fresh synced app: `bun exact.mjs snapback` PASS,
  `bun exact.mjs test web` 2 passed/0 failed. Fresh online app: both commands
  PASS, web 1 passed/0 failed. Full commands/logs retained under
  ~/sb4-loop/integration20/logs; Exact clone and apps remain recoverable.

## Running / not yet qualified

- Required full five-crate Rust command: first pre-bump compile interrupted
  deliberately; second full run on 0.4.36 in progress. A final full run after
  the last repair is still required. No full Rust green claim yet.
- Full client pool and then full-count models: in progress. Pool exposed the
  integrated doc/shim/recipe gaps above, all focused repair tests PASS.
  Maintained-columns transient failed in pool but PASS 4/4 alone; requires
  the final complete pool to pass. No green full-pool claim yet.
- Release difftest run 20k and devices 0–999 completed; compact report audit
  and Lean/base signature comparison pending. Baseline built directly from
  f0eed70bb3 in owned scratch, never from another worktree.
- Fresh `publish.mjs --prepare-client --prepare-directory <owned scratch>`
  pack built; packed Linux consumer qualification exposed an absent React
  peer in the harness and is being repeated after repair. --consumer-only
  avoids prohibited test.sh; full Rust/client verification is separate.
  No publication receipt is claimed.
- Mac Studio reachable; reports Xcode 27.1 (27B/27A toolchain details in logs),
  rather than requested 27.0. Only ~/sb4-ws-integ20 is used for source/build
  work. Affected Rust targets, 38 platform-sensitive/changed client files and
  a fresh packaged Expo native witness are running. Missing scratch README
  and three compile-time fixture files were supplied, not product failures.
- Store/Expo upgrades from public 0.4.33 and 0.4.35, including old CLI path,
  and final source-bound packs/checks remain outstanding.

## Evidence and resource handling

Logs, matched schema manifest/hashes, exact clone, base source/binaries and
packs are in ~/sb4-loop/integration20 and ~/sb4-loop/prewave20. Disk is shared;
removed only this worktree's old pre-integration Cargo test executables and
an owned superseded transfer archive, retaining the removal manifest. No
other worktree, primary checkout or publication staging path was touched.
