# SG — refusal acceptance and SQLite spill

Date: 2026-10-07. Base: `0945fec86037acc61faf44b55df9c83ee85bba4e`.
Branch: `sb4-intent/sg-refused-open-guarantee`.
All implementation and verification ran on eb1000 (`expose-builder-pixel`) in
`/home/ccheever/sb4-intent/lane-sg`. No other worktree or host was used;
no pushes or publication. The operator owns the Darwin fence run.

## Resolution

### SQLite admission after a writer wait

Server fast attachment now holds its opening transaction through stored-backend
decoding, selected-release validation, catalog comparison, upgrade-marker reads,
physical upgrades and final construction reads. There is no unlocked interval
between that decision and commit. Version and catalog are reread after acquiring
the writer lock, rather than trusting low-level `Store::open` preparation.

When the stored backend requires semantic repair, the first transaction rolls
back before the existing activation path. Activation rechecks version and its
identity under the new writer lock, then checks the exact captured generation,
schema and program bytes and selected release before upgrading. Its ordinary
catalog, key, timeline, cap and derived-state admission still executes under that
lock. Device installation and source/release activation share the version check.
The advisory reads before activation remain advisory.

### No construction reads after acceptance commits

`Engine::open`, `new` and `new_release` read `store_id` and `release` inside
their accepting transaction, after its upgrades and metadata writes, and return
those validated facts together with the generation. A missing identity is
created and read there. A BLOB identity or release refuses while rollback can
still remove `_effect_steps` and undo the release-pointer update. Read-only
inspection uses a read snapshot and installs no tables.

In-place `Engine::adopt` also uses the returned identity. It acquires the
fallible ephemeral-hub lock before durable activation, then performs an
infallible rebind after commit. A poisoned hub cannot report a refusal after
committing an adoption.

### Precise WAL contract

As explicitly permitted by the task, the documented guarantee is **all logical
schema/data and all main-file bytes**, not the entire physical WAL. Existing
checkpoint-on-close suppression remains: a refused connection does not checkpoint
committed frames into the main file. Small no-spill fences still compare the
whole retained WAL byte for byte.

A sufficiently large atomic migration can spill dirty pages into SQLite's live
WAL before a later constraint, SQL or native-recovery refusal. Rollback makes
the frames invisible, but can leave them on disk. Avoiding every spill would
retain memory proportional to migration size; staging a second database would
add copy/storage cost and a publication protocol around live SQLite owners.
The existing bounded-cache/spill policy is retained. LLP 3000.033 §1.3 and both
JavaScript fence comments now say exactly what their byte comparison establishes.

The new native regression reproduces the review's 1,500 legacy receipt rows with
8 KiB payloads. It refuses on send-revision overflow after attempting migration:
**13,357,056 main-file bytes unchanged; WAL 8,272 → 11,470,112 bytes**, with the
original committed WAL prefix intact and the full schema/table/row dump identical.
The DELETE-mode counterpart also retains logical state and every main-file byte.
After correcting the malformed revision, a successful native open drops the
legacy column, installs the missing table, retains all 1,500 rows and completes
capture recovery.

## Regression evidence

- Eight actual waiting openers per case, with SQLite busy-handler barriers rather
  than timing sleeps. WAL/DELETE; fast and repair attachment, source/release
  construction and device installation. Version changes refuse everywhere;
  attachment also rejects changed schema/programs/catalog. Malformed identity
  and release changes during the wait refuse before retaining upgrades.
- Paired eight-opener successful legacy fast and repair attachments.
- A separate SQLite authorizer barrier between validated attachment and repair
  changes version, valid schema/program bytes, or selected release. Repair must
  recheck and refuse without changing logical state, main file or the small WAL.
- Malformed identity/release across fast open, repair open, new and new_release,
  in both journal modes with either no prior release or release `0`. Every
  comparison includes the release pointer, `_effect_steps`, all schema and rows,
  main-file bytes and the small surviving WAL.
- Successful controls without a stored identity check the generated identity in
  storage, the constructed ephemeral hub and a subsequent reopened engine.
- In-place adoption with malformed metadata or a poisoned hub retains the store.
- The spill-sized native refusal and successful recovery described above.

The first three regression tests were also run against the original production
files from the base commit, temporarily restored only inside this worktree.
The successful control passed; version-race and malformed-construction tests
failed as expected. The fixed files were restored in a `finally` block before
verification continued. `baseline-regressions.log.gz` retains that negative
control; the final five-test file passes.

## Verification

All Cargo/build/suite commands use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
eight Cargo jobs, incremental off and dev/test debug info off. Node 24.13.1;
Rust 1.97.0; Bun dependencies installed with `--frozen-lockfile`. One Cargo target
under this worktree; test scratch outside Git in a private `/tmp/sb4-sg-*`
directory. No PostgreSQL code changed, so no separate PostgreSQL cluster was run.

| Check | Result | Evidence |
|---|---|---|
| Core lib (including store), identity, read sessions, bound sessions, refusals, capabilities, revocation and work records | 286 passed; 2 existing labelled ignores; nested subprocess also passes | `core-focused.log.gz` |
| Device lib, adoption and both capability files | 81 passed | `device-focused.log.gz` |
| Final new core refusal matrix and successful controls | 5 passed | `refused-open-final.log.gz` |
| Native refusal/spill file | 9 passed | `native-refusals.log.gz` |
| Original capability fence, Linux shared fixtures and read-only round4 | 20 passed; 7 Darwin-only skips | `client-fences.log.gz` |
| All ten read-only client files, including published downgrade/re-upgrade | 119 passed; no skips | `read-only-clients.log.gz` |
| Original-code negative control | Expected failure: both defect regressions fail; success control passes | `baseline-regressions.log.gz` |
| Complete suite | **0 failures**, 2,188 seconds; Rust 312 binaries / 1,025 executions plus doctests; client pool 6,674 passed / 55 labelled skips; serial models 79 passed | `full-suite.log.gz` |
| LLP references | 0 errors, 0 unchecked | `ref-check.log.gz` |
| Whitespace, source limits, JOURNAL prefix and source/dist wasm comparison | Passed | `source-audit.log.gz` |

The optional previous-binary control was separately exercised with npm's
`snapback4-linux-x64@0.4.13`, downloaded into this worktree's ignored target.
Registry integrity matched RS's retained value; the tarball's SHA-512 was
verified before extracting the binary, whose version and SHA-256 are recorded
in `previous-version.log.gz` and `previous-published.json`. All 119 read-only
client tests pass with that binary and no skips. The full suite
retained its ordinary environment and labelled this optional control skipped;
the separate run supplies its passing result.

The full suite uses eight Rust test processes and its normal CPU-aware client
pool (24 client files), with all work counts and watchdogs intact. The command
was `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`
(equivalently run as `bash scripts/test.sh` from `snapback4/` with the recorded
environment). It passed in one complete run: all 340 client files, all build,
typecheck and fixture steps, Rust and doctests, then both serial model files at
the default 5,000 session histories per tier and 3,000 online-client sequences.
No test, timeout, assertion, work count or budget was weakened. The seven actual
Darwin-only capability cases were not executed here; the operator owns that run.

Baseline and rebuilt wasm are byte-identical:
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
2,135,164 raw / 645,264 gzip bytes; unchanged budget 645,564 bytes.

## Governing context and audit

The scoped `llp-orient` pass read the Snapback 4 command sheet/fence, LLP 3000
(root, in `llp/current`), LLP 2000.000 (design brief, in `llp/current`),
LLP 3000.033 §1.3 and §3 (implemented, archived), the current read-only guide,
and the activation references to LLP 3000.000's implementation follow-up,
LLP 3000.002's activation workspace and LLP 3000.019 §3.6. It also read both
RS reports and Astra's round-1 reproduction/evidence record supplied by the user.
The active constraints are atomic activation, retained authority semantics,
explicit spill/memory costs and unchanged web-device bytes. No new LLP, policy,
gate, budget or client surface is introduced. The existing LLP is updated in
place; JOURNAL is append-only. Read-session creation, authority, revocation,
logout and SDK no-refresh behavior are unchanged. No design hand-off is needed.
