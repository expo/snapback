# Failure and experiment accounting

## Required qualification

Ran `scripts/test.sh` exactly once, exit 0:
`== 0 failure(s) in 1375 s`. Every stage passes. Required full-suite failures:
ours **0**, baseline **0**, environmental **0**. Separate affected device tests,
map regressions and whole-guide tests also pass with zero failures. The 33 Rust
ignores and ten client skips are existing declared exclusions. The complete
client models retain their full counts and pass 79/79.

“WD” below means ours; these are separate from required-test failures.

## Rejected or corrected exploratory work

- **WD experiment:** changing the whole wasm profile from `z` to `s` increased
  gzip to 687,227 B. No profile change retained. The first trial invocation used
  CARGO_TARGET_DIR with the existing script, whose wasm-bindgen input is a
  hard-coded `target/` path; that invocation's printed baseline size is excluded.
  The trial was measured correctly by running wasm-bindgen on its actual target.
- **WD experiment:** LLVM ordinary/inline-hint thresholds of zero increased the
  first source rung to 598,817 B. No flags retained.
- **WD experiments:** baseline `-Os` 677,480 B, merge-similar-functions 597,507 B,
  multivalue outlining 616,284 B. All are rejected. Narrow folding is the only
  Binaryen candidate retained; it is selected by the existing gzip comparison.
- **WD experiment/tool restriction:** initial outlining without multivalue exited
  1 with validator errors (tuple/multivalue instructions not enabled). The retry
  with multivalue passed validation but grew gzip and was rejected. No new wasm
  feature requirement was added to the production script.
- **WD intermediate compile error:** the first small-map build had E0282/E0283
  because `try_collect` did not constrain two closures' error types. Both
  history/snapshot closures now explicitly return `Result<_, RuntimeError>`;
  the same build then passed. No error behavior changed.
- **WD diagnostic tooling:** Binaryen 132 aborted (exit 134) when asked to preserve
  Rust 1.97 DWARF while deduplicating the symbolized module: “compile unit size
  was incorrect”. Production contains no DWARF and is unaffected. Regenerating
  the named counterpart without `wasm-bindgen --keep-debug` preserves names
  without DWARF; folding and complete twiggy attribution then pass. One early
  report read before that file existed was discarded.
- **WD setup typo:** the private copied fixture's first server command named
  `../../server` instead of `../server` and exited 127. The corrected command
  started the retained production server on loopback 49771. No samples came from
  the failed attempt.
- **WD reference-check invocation:** the final audit was first launched from
  `snapback4/`, so it found no root LLP corpus and reported 1,221 broken refs.
  Running the same checker from the repository root passed: 524 LLP documents,
  9,934 refs, zero errors and unchecked references. Both logs are retained.
- **Environment/orientation:** this fresh worktree's llp-orient symlink points to
  an uninitialized vendor checkout. The installed skill was found and read from
  `/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md` instead.
  Read-only exploratory lookups of nonexistent candidate source paths were
  corrected; they did not run qualification. No skill/vendor files were changed.

The exact replay also emitted Node's benign MODULE_TYPELESS_PACKAGE_JSON warning
for SDK copies under ignored `target/`; every comparison passed. Compiler warnings
and declared ignored/skipped tests are retained in the logs and are not counted
as failed tests. None of the experiments changes the fixed budget or weakens a
check. No required qualification failure is hidden by a retry.
