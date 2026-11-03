# Progressive history — fix round 5

Date: 2026-11-03. Worktree `snapback-ph-20261102`, branch `sb4/progressive-history`.
All changes are uncommitted for the supervisor and confined to `snapback4/` and
`llp/`. No agents, clones, remote commands, other checkouts, commits, stash,
checkout/restore, rebase, push, wasm build, or budget changes were used.

## Result and limits

Both product defects are fixed. The new regressions reproduced unknown owner-key
absence on memory and SQLite, and eight schema attempts instead of four on saved
partial and complete web replicas, before their respective fixes. They pass with
the fixes. The original client `own-keys.test.mjs` and `overload.test.mjs` are
unchanged; both commands fail during harness import on sandbox `ps` EPERM, before
any product case executes. **Their green status still needs supervisor execution.**

The full device command exited 0: **1607 passed, 0 failed,
4 ignored**, summed from every actual harness summary reproduced below.
The progressive client command has 47 passing cases, one declared browser skip,
and one harness import failure (`progressive-ephemeral.test.mjs`, `ps` EPERM).
Those 47 include the complete progressive acquisition/recovery/budget files and
both new process/wasm offline owner-key cases. It is not a green four-file command.
The strengthened recovery file subsequently passes all 10 cases, including
sign-out before offline reopening and a different caller on each core.
Legacy acquisition passes 47, progressive startup passes 48, and the focused
owner-key device target passes 8. Typecheck and client build pass. No timing or
publication qualification is claimed. See every command's exact status below for
the remaining Rust, guide, reference and whitespace checks.

## Changes (paths relative to snapback4/)

- `crates/snapback4-core/src/partition/acquire.rs:128`: when the tier-1 walk
  exhausts an owner-key projection, enumerate its server-authorized principal
  group and carry it in the existing `joined` field, including zero keys. Packed
  pages already merge these declarations. No declaration is inferred from row
  count or emitted for an unfinished table, and `whole_eligible` is unchanged.
- The existing `crates/snapback4-device/src/device/acquisition.rs:116` already
  turns fresh progressive `joined` declarations into Held membership through the
  ordinary transactional/deferral applicator. No device code or new wire field
  was necessary. Maintained projections still have no early whole-table fact;
  their query gate remains full acquisition. Caller-specific history lookup
  continues to reject another principal's proof on the same store.
- `packages/snapback4/src/local.ts:1209`: if initial schema discovery ended in
  a coded refusal, awaited opening returns the saved usable backend without
  repeating acquisition discovery before returning. The existing background
  owner continues retries; successful online startup still completes its walk.
- `packages/snapback4/src/local-runtime.ts:293`: a fully acquired saved replica
  needs no acquisition-capability lookup for ordinary streaming. At `:328`, a
  typed metadata overload preserves its refusal and connected link instead of
  being translated to a transport outage. An unfinished walk still negotiates
  before sending `acquire`; no old-server capability is assumed.
- `crates/snapback4-device/tests/own_keys.rs:115`: new progressive tests on
  memory and SQLite cover populated/empty key partitions, limit-one pagination,
  reopening after each page, no early maintained-table admission, complete true
  and false proofs, and an aliased-store different-caller miss staying unknown.
- `packages/snapback4/test/progressive-recovery.test.mjs:11`: partial and complete
  saved web replicas open after exactly four refused schema attempts, retain
  readable inbox data, keep background overload connected and resume acquisition
  when it clears. At `:57`, process and existing wasm adapters prove own-key
  presence/absence offline after progressive sync, sign-out and reopen, and
  reject another caller's miss on the same core. The helper's
  `interceptSchema` hook is at `packages/snapback4/test/helpers/progressive-acquisition.mjs:112`.
- `../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md:781` records
  both corrections and updates Revised metadata; `JOURNAL.md:111201` appends a
  dated record. No LLP number or acceptance status changed.

## Governing context and code corrections

Scoped llp-orient context: LLP 3000 (root, one interpreter/partition), LLP
3000.001 Repairs A/B (server-named coverage, current-image publication and
own-write deferral), LLP 3000.001.001 §§6/8/9/10.1 (unit publication, readiness,
compatibility and witnesses), and LLP 3000.028 §3.4 (principal-scoped owner-key
proof). Snapback 4 AGENTS/NOT-DOING, adopted rules, the sync/client guide text and
journal tail were read. No new design or corpus hand-off is required.

The tree already implements increment 1, despite the RFC's retained proposal-era
description. More specifically, `StreamPage` has `joined`, while the legacy
`SnapshotPage` carries `held`; the existing progressive device classifier can
publish `joined` as Held without introducing a second declaration. The regression
was the missing server declaration, not an absent device classification mechanism.
Owner-key read preflight still uses the global full-acquisition gate for maintained
projections. This change preserves that narrower behavior rather than promising
early owner-key queries. One watermark, Repair B, staged replacement, mutation
and prediction gates, and `contract.ts` are unchanged.

The saved-backend regression was reproduced in a runnable harness: initial
`/schema` made four bounded overload attempts, then `startCore` awaited a sync
turn whose new compatibility discovery made four more. Its generic catch changed
the link to offline. The fixes remove the repeated awaited dependency and correct
background classification; they do not suppress explicit sync errors or invent
acquisition completion.

## Verification method

Every execution below ran through `python3 reports/20261102-progressive-history-reviews/fix-r5/run.py NAME COMMAND...`
from `snapback4/`, except `./ref-check --verbose` and `git diff --check`, whose
working directory was the repository root and whose runner path was prefixed
with `snapback4/`. The runner prepends Volta Node **24.18.0** to PATH and sets
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Existing locked dependencies were available; no install was needed. The client
build copies the existing supervisor-built wasm; it does not rebuild it. Raw
outputs and argv/status records are retained in `logs/` and `commands.jsonl`.

The first device regression attempt was a test-fixture error (missing required
`snapshot:false`) and is retained as a failure, not product evidence. After that
  fixture correction, both cases failed on the actual unknown/incomplete absence
before the server fix. Both saved-web regressions also failed before the client
fix. No failing harness import is counted as a product case or pass. The initial
HTTP command named a nonexistent integration target; no cases ran. Its error was:

```text
error: no test target named `serve_sync` in `snapback4` package
```

The corrected binary-test filter passed all three HTTP cases. No loopback-binding
failure required a retry.

All summary lines below are copied verbatim from captured output. A silent
successful command is explicitly labeled; no synthetic test summary replaces it.

### overload-before

`node --test '--test-name-pattern=public saved web backend' packages/snapback4/test/overload.test.mjs` — exit 1. [Raw output](logs/overload-before.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 137.5905
```

### own-keys-device-before

`cargo test -p snapback4-device --test own_keys progressive_` — exit 101. [Raw output](logs/own-keys-device-before.log).

```text
    Finished `test` profile [optimized] target(s) in 25.83s
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.02s
```

### overload-progressive-red

`node --test '--test-name-pattern=saved web' packages/snapback4/test/progressive-recovery.test.mjs` — exit 1. [Raw output](logs/overload-progressive-red.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10032.241
```

### own-keys-device-red

`cargo test -p snapback4-device --test own_keys progressive_` — exit 101. [Raw output](logs/own-keys-device-red.log).

```text
    Finished `test` profile [optimized] target(s) in 22.79s
test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.03s
```

### client-build

`bun run --cwd packages/snapback4 build` — exit 0. [Raw output](logs/client-build.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### overload-progressive

`node --test '--test-name-pattern=saved web' packages/snapback4/test/progressive-recovery.test.mjs` — exit 0. [Raw output](logs/overload-progressive.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11064.643625
```

### overload-client

`node --test packages/snapback4/test/overload.test.mjs` — exit 1. [Raw output](logs/overload-client.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 207.973833
```

### own-keys-client

`node --test packages/snapback4/test/own-keys.test.mjs` — exit 1. [Raw output](logs/own-keys-client.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 209.630667
```

### typecheck

`bun run --cwd packages/snapback4 typecheck` — exit 0. [Raw output](logs/typecheck.log).

```text
$ tsc -p tsconfig.json --noEmit
```

### own-keys-device

`cargo test -p snapback4-device --test own_keys` — exit 0. [Raw output](logs/own-keys-device.log).

```text
    Finished `test` profile [optimized] target(s) in 58.58s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

### cargo-build

`cargo build -p snapback4` — exit 0. [Raw output](logs/cargo-build.log).

```text
    Finished `dev` profile [unoptimized] target(s) in 37.04s
```

### history-review

`node --test --test-concurrency=1 packages/snapback4/test/answers-stay-review.test.mjs packages/snapback4/test/ordinary-history.test.mjs packages/snapback4/test/retained-history.test.mjs` — exit 1. [Raw output](logs/history-review.log).

```text
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 592.023958
```

### startup

`node --test packages/snapback4/test/progressive-start.test.mjs` — exit 0. [Raw output](logs/startup.log).

```text
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2398.255625
```

### ref-check

`./ref-check --verbose` — exit 0. [Raw output](logs/ref-check.log).

```text
ref-check: ok — 583 LLP docs, 13018 refs in 51436 files, 0 errors, 0 unchecked
```

### delivery-census

`node --input-type=module -e 'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; import {census,awaitBoundary} from "./packages/snapback4/test/delivery-fault-instrument.mjs"; const base="./packages/snapback4/test/"; assert.deepEqual(awaitBoundary(),JSON.parse(readFileSync(base+"delivery-await-boundary.json","utf8"))); assert.deepEqual(census().map(site=>site.id),JSON.parse(readFileSync(base+"delivery-fault-sites.json","utf8")).map(site=>site.id)); console.log("delivery await census unchanged: "+census().length+" sites");'` — exit 0. [Raw output](logs/delivery-census.log).

```text
delivery await census unchanged: 216 sites
```

### progressive-clients

`node --test --test-concurrency=1 packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-recovery.test.mjs packages/snapback4/test/progressive-budget.test.mjs packages/snapback4/test/progressive-ephemeral.test.mjs` — exit 1. [Raw output](logs/progressive-clients.log).

```text
ℹ tests 49
ℹ suites 0
ℹ pass 47
ℹ fail 1
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 86274.768333
```

### acquisition

`node --test packages/snapback4/test/acquisition.test.mjs` — exit 0. [Raw output](logs/acquisition.log).

```text
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 152724.130583
```

### core-progressive

`cargo test -p snapback4-core --test progressive_acquisition` — exit 0. [Raw output](logs/core-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 6m 36s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.69s
```

### http-progressive

`cargo test -p snapback4 --test serve_sync progressive` — exit 101. [Raw output](logs/http-progressive.log).

```text
    timeline
    timeline_adoption
    timeline_delivery
    timeline_delivery_counterexample
    timeline_design
    tok1
    tok2_output
    tok3
    token_live
    wave13_rules
    wave26_security
    witness
    witness_web
    work_records
    written_by
```

### sim-progressive

`cargo test -p snapback4-sim --test progressive_history` — exit 0. [Raw output](logs/sim-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 4.41s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
```

### guide

`cargo test -p snapback4-lang --test guide` — exit 0. [Raw output](logs/guide.log).

```text
    Finished `test` profile [optimized] target(s) in 5.57s
test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.40s
```

### http-progressive-final

`cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive` — exit 0. [Raw output](logs/http-progressive-final.log).

```text
    Finished `test` profile [optimized] target(s) in 1m 22s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 782 filtered out; finished in 0.02s
```

### diff-check

`git diff --check` — exit 0. [Raw output](logs/diff-check.log).

No output (silent successful check).

### ref-check-final

`./ref-check --verbose` — exit 0. [Raw output](logs/ref-check-final.log).

```text
ref-check: ok — 583 LLP docs, 13018 refs in 51438 files, 0 errors, 0 unchecked
```

### recovery-final

`node --test packages/snapback4/test/progressive-recovery.test.mjs` — exit 0. [Raw output](logs/recovery-final.log).

```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16289.905333
```

### full-device

`cargo test -p snapback4-device` — exit 0. [Raw output](logs/full-device.log).

```text
    Finished `test` profile [optimized] target(s) in 6m 48s
test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.09s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.98s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.58s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 83.97s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 142.88s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.44s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.51s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.33s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.71s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.29s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.53s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.13s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.89s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.04s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.35s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.33s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 221.38s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.89s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.61s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 43.73s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.21s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.76s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.11s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### diff-check-final

`git diff --check` — exit 0. [Raw output](logs/diff-check-final.log).

No output (silent successful check).

## Not run, blocked checks and open questions

- `react.test.mjs`, `witness/idb.mjs`: **not run (sandbox)**, as instructed;
  these SIGABRT here. The declared browser placeholder remains a skip.
- Original own-keys and overload files, answers-stay-review, ordinary-history,
  retained-history and progressive-ephemeral: attempted, but no product cases
  ran because the Darwin process-identity inspector fails at import with
  `TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM`.
  No harness guards were bypassed, and the original two test files were not edited.
- No wasm build, full browser battery, release/publication qualification or
  broad affected/battery command: outside this narrow fix round; the requested
  scoped commands were used. No new dependency or install command.
- Remaining supervisor action: run the blocked unchanged client files and
  browser witnesses outside this sandbox. The existing wasm passed the runnable
  owner-key client witness; no device Rust change requires a new wasm for this fix.
- No unresolved product/design question was identified. An already completed
  store created by the buggy walk has no retroactive repair in this narrow fix;
  its existing unknown owner-key proof remains unknown until normal replacement
  acquisition. This work repairs new progressive walks, without inventing a
  persisted-data migration or clearing stores.

## Inspection, editing and reporting commands

[inspection-commands.json](inspection-commands.json) retains the initial read-only
command inventory: RFC/AGENTS/NOT-DOING/skill and parent/owner-key context reads,
`rg`/`sed`/`cat` source searches, toolchain path listing, prior reports and Git
status/diff. These print source text, not test summaries; a few missing guessed
filenames printed their normal not-found diagnostics and were then located with
`rg`. Subsequent inspection used `tail -n`/`rg -n` on retained logs, `git diff`
(`--stat`, `--numstat` and scoped paths), `git status --short`, and `wc -l` on all
changed source files. They did not execute additional tests. Source lengths are
250 / 281 / 1487 / 863 / 127 / 162 lines (server acquisition, device own-keys,
local, local-runtime, recovery tests, helper); all remain below 1,500.

Edits used apply_patch. Two inline `python3 -` file edits appended the dated
journal entry and updated RFC Revised metadata; their verbatim output was:

```text
JOURNAL.md: appended dated fix round 5 entry
LLP 3000.001.001: Revised metadata records fix round 5
```

`python3 reports/20261102-progressive-history-reviews/fix-r5/write-report.py`
generates this report from the completed command manifest and retained logs.
Its summary is `report written; all recorded summary lines included`.
Tool waits only collected the named running commands; they are not reruns.
The delivery-await check observed all 216 unchanged site IDs and await hashes;
no seal or classification artifact was regenerated. Stop after this report.

Final report inspection ran `sed -n '1,42p' reports/20261102-progressive-history-reviews/fix-r5/REPORT.md`
and an inline `python3 -` check from `snapback4/`: it read every command record,
asserted every captured summary line appears in the report, asserted the full
device total, checked the report was below 1,500 lines and had no trailing
whitespace. Its verbatim summary (before this inspection note was appended) was:

```text
report verified: all 27 command records and 106 full-device harness summaries retained; 583 lines
```
