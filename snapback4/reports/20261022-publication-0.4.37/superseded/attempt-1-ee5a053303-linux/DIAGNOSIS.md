# 0.4.37 Linux attempt 1 at ee5a053303 — STOPPED: deterministic dirty-tree red (no receipt possible); plus one flaky test

Commit: ee5a0533034e55db9adfd3a5eba4d783d5a511fb. Prepared bytes (Mac, after native-1): client sha512-zeuJEfMF... 1,322,468 B, expo sha512-4apX4+7M... 7,327,801 B.
Private NPM_CONFIG_CACHE (npm-cache-1). 59 GB free at start, load ~16.

Suite (linux-qualification-0.4.37/suite.log): cargo build/wasm/docs budget/release guard/typecheck/build/chat check ok; **cargo test ok (1,022 s)**;
`-- FAIL: client tests (1638 s)`: 425/425 files, failed 1; tests 7,828 / pass 7,771 / fail 1 / skip 56. Stopped by script (kill-linux.sh, session 2395873) during client models.

## 1. Flaky: wave12-clauses.test.mjs test 1 (flake rule step 1 passed)
"guide and probe agree on widen, tighten, require, SIGTERM, rollback and forward clauses": TypeError "Cannot read properties of null (reading '0')"
at wave12-clauses.test.mjs:37 — `serve()` waits for SNAPBACK4_READY on **stderr**, then reads the URL from **stdout** with `.match(...)[0]`;
under load the stdout chunk had not arrived yet (pipe-ordering race in the test harness). Test code unchanged since ad0309c8cd (10-20) and green in
every 0.4.35 full suite. Alone: 6/6 (9/9 each) -> isolated/wave12-clauses-*.log.

## 2. DETERMINISTIC: wave14-rule-recipes.test.mjs leaves untracked `snapback4/packages/snapback4/logs/` -> cleanSource refuses -> no receipt
- 75982178c7 ("Keep client fixture servers responsive during CLI inspection", 10-21, after 0.4.35's f0eed70bb3) switched the test's `invoke`
  from spawnSync to `command` from ../dist/proof.js. proof.ts `command` -> proof-process.ts `logged()` writes `<uuid>.{stdout,stderr}.log` under
  `logsDir(options)` = `resolve(cwd, "logs")`. The test's `pack()` runs `npm pack ... --json` with cwd = packages/snapback4, so every run creates
  `packages/snapback4/logs/` (not gitignored: `git check-ignore` exit 1).
- Reproduced alone 2/2 (tests 25/25 pass, `git status` = `?? snapback4/packages/snapback4/logs/` after each) -> isolated/wave14-*; the
  suite's copy is stray-packages-snapback4-logs/ (npm pack JSON of the working tree, 06:40 local).
- Effect: scripts/publication-artifacts.mjs `cleanSource()` runs `git status --porcelain --untracked-files=normal` and throws
  "publication source is dirty". qualify-linux.mjs calls it after the suite + proofs, before writing the receipt; publish.mjs --dry-run calls it
  after the suite ("release source changed during staging"). So **no green Linux receipt and no green Mac dry run is possible at ee5a053303**,
  on any host, even with every test passing. Not a flake, not environment.
- origin/main has no fix (only 280fbc9774 and 4a85340d11 after ee5a053303 at 04:55Z).
- Fix options (product owner's call): pass `logsDir` under the test's temp `dir` in wave14-rule-recipes `invoke` (and check maintained-columns,
  changed in the same commit, which also imports `command`); or make proof-process's default logs dir not land in the source tree; or gitignore
  `packages/snapback4/logs/`. Then requalify at the fix commit: native (kit binds native to HEAD), prepare, Linux, Mac dry run.

Mac state at ee5a053303: native-1, prepare-1, lean-1, warm-1 all done (bound to this commit). Gate not started (needs a Linux receipt).
