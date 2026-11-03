# Progressive history — fix round 6

Date: 2026-11-03. Worktree `snapback-ph-20261102`, branch
`sb4/progressive-history`. Changes remain uncommitted for the supervisor,
confined to `snapback4/` and `llp/`. No agents, clones, remote commands,
other checkouts, commits, stash, checkout/restore, rebase, push, wasm build,
dependency installation or budget changes.

## Result and limits

Five product defects are fixed: missing empty inherited Held groups; foreign-store
acquire requests retaining the old watermark; zero-head ordinary overflow missing
inline replacement; prototype-name corruption of progressive counts; and partial
sign-out leaving those counts visible. Each has an observed failing-before
regression and a passing final regression. Legacy wire/timing expectations are
adapted separately below. No test in this round withholds the advertisement.

The full device command exited 0: **1611 passed, 0 failed, 4 ignored**,
summed from all **107** actual harness summary lines reproduced below.

Whole files passed: schema-capabilities **10**, sync-overflow **23**,
store-reset-reconnect **13**, transport-http **21** (including all original
atomic-group cases plus the paged-table variants), acquisition **47**.
The final three-file progressive client run passed **48**, with **one declared
browser skip**. The new Node lifetime file passed **7**; the new inherited-family
device target passed **4** across memory and SQLite. Core progressive, HTTP,
simulator, guide, build, typecheck and reference checks also passed as recorded
verbatim below. These are development checks, not publication qualification.

The original read-through-upsert, read-through, social-starter and sync-scale
files cannot execute their product cases here: the Darwin test identity inspector
fails at import on sandbox `ps` EPERM. The entire files were attempted; no guard
was bypassed. The supervisor's supplied social-starter **17/17** result is external
evidence, not a run claimed here. Web-review was attempted once and Chromium
SIGABRTed before any browser subcase. Its final source was syntax-checked only.
Social-browser, react and witness/idb are **not run (sandbox)**. Their outstanding
execution belongs to the supervisor.

## Product changes and regressions (paths relative to snapback4/)

- `crates/snapback4-core/src/partition/acquire.rs:128`: completing a horizonless
  delivered-history table declares all authorized groups through existing `joined`,
  including empty inherited families. The device's existing fresh-join classifier
  publishes Held; actual Left/Rejoined states remain guarded. No inherited table
  gains a whole-table fact, and mutation prediction still waits for full acquisition.
  `crates/snapback4-device/tests/progressive_inherited.rs:23` walks at limit one and
  reopens after every page on both stores. At `:54`, both upsert arms predict,
  the second settlement restores the first overlay, and an authoritative refusal
  removes the first. At `:68`, retained old children survive parent reuse, a live
  child still causes E_PARENT_HAS_CHILDREN, and deleting that live child makes the
  reused parent delete predictable. All four tests failed on the old server walk
  and pass with the declaration.
- `crates/snapback4/src/serve_sync.rs:77` and `:87`: discard the foreign store's
  `from` with its acquire cursor/skip set. Previously an old head of 5 against a
  replacement head of 3 returned bare E_INPUT before identity observation.
  The new store now returns a cold identity/page; observation discards the old
  walk, adoption requires replacement, and the client stages its replacement.
  `crates/snapback4/tests/serve_sync/progressive.rs:72` reproduces a foreign head
  of 999 on memory/reader HTTP paths; both failed before the fix. The adapted
  whole reconnect file passes on process and existing wasm, retaining restore
  refusals and all no-stale-fresh assertions.
- `packages/snapback4/src/local-runtime.ts:427`: the ordinary drain after a pin
  at head zero qualifies for the existing limit-one snapshot instruction, and
  its cached `{stream:true}` request is cleared before replacement. No refusal
  is applied as an empty page and no refusal watermark becomes applied progress.
  The real 16 MiB oversized-first-commit witness failed on both tiers after its
  injection was adapted to the cold pin, then passes with this fix. The whole
  overflow file passes 23/23 without changing ceilings or payload assertions.
- `packages/snapback4/src/acquisition.ts:41`: progressive publication preserves
  the null-prototype table-count map. `constructor` previously read the inherited
  constructor function instead of zero; `__proto__` also was not a safe data key.
  `packages/snapback4/test/progressive-acquisition.test.mjs:45` fails before and passes after the fix
  for both names and `$ownKeys:likes`, including deferred publication and reset.
- `packages/snapback4/src/local.ts:408`: sign-out/close clears partial progress
  even when `acquired` was already false. Ordinary between-page false updates
  still retain progress, and the unchanged Boolean emits no notification.
  `packages/snapback4/test/progressive-lifetimes.test.mjs:18` reproduces the leaked two-row count
  before the fix and passes after it, including an in-flight second request and
  a raw signed-out client. At `:39`, all 12,007 special-table rows are received,
  counted, and reopened with complete stale offline answers. This uses Node wasm
  persistence; it is not evidence for IndexedDB transaction or worker behavior.
- `packages/snapback4/test/progressive-lifetimes.test.mjs:73` tests live fallback while the first
  acquisition is blocked: sends, deletion, 503, prediction and expiry refreshes,
  unwatch, and stopping acquisition polling after local completion. All five
  polling cases pass without a polling product change. The helper at
  `packages/snapback4/test/helpers/progressive-acquisition.mjs:92` supports prepared opening and
  at `:119` supports query-response injection; assertions use the real server,
  wasm interpreter and production SDK.
- `../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md:794`
  records the corrections, with Revised metadata at line 8. `JOURNAL.md:111225`
  appends the dated record. Status remains Draft; no LLP number was added.

## Every reported regression

| Item | Disposition | Evidence and preserved behavior |
| --- | --- | --- |
| 1, read-through upsert | Product: declare empty inherited Held groups. Original file unchanged. | Four new both-store inherited cases fail before/pass after; original file import blocked by sandbox. Insert/update prediction, server refusal and rollback retained. |
| 2, reused parent delete | Same product root cause: the never-populated second group's child proof was missing. Original file unchanged. | New test keeps the old retained child, distinguishes the later live child, and predicts parent deletion only after the live child is removed. Original file import blocked. |
| 3, published 0.2.33 control | `packages/snapback4/test/schema-capabilities.test.mjs:426` validates exactly the new advertised capability beside the unchanged required capabilities. | Before: 9 pass/1 fail solely at record equality. After: 10/10. Published native/wasm install/adopt/query/reopen and release version refusal already passed before that equality; canonical backend/schema bytes still compare exactly. No sync_state allowance or old-engine progressive request was needed. |
| 4, social starter | Verify only; unchanged. | Local whole-file attempt import-blocked; supervisor supplied 17/17 on fix-r5. Final progressive recovery includes owner-key offline proofs on process and existing wasm. |
| 5, zero-head overflow | `packages/snapback4/test/sync-overflow.test.mjs:247` injects on `page.acquire.pinned` as well as the legacy first snapshot. Product inline recovery fixed above. | Same real oversized data and ceiling; requires an actual limit-one from-zero stream refusal, then the same correct full image and head. Whole file 23/23. |
| 6, replacement race | `packages/snapback4/test/store-reset-reconnect.test.mjs:78` blocks an acquire continuation; `:149` and `:154` assert its real cursor/store mismatch. Product foreign-cut reset fixed above. | Same lower-head replacement, three B rows, no A rows, correct final watermark. Whole file 13/13. No fabricated legacy page or downgrade. |
| 7, web review | Product count/reset fixes plus additive assertion updates at `packages/snapback4/test/web-review.test.mjs:158` and `:506`. Reset mutant at `:30` tracks current source. | Reset still requires zero counts and false acquired; now also zero usable facts. Two acquire pages each have an ordinary drain, so exact requests change from 3 to 4; all row/uniqueness/value/reopen/persistence bounds remain. Node analogue passes. Browser subcases not executed. |
| 8, sync scale | `packages/snapback4/test/sync-scale.test.mjs:49` blocks first acquire publication instead of the following ordinary drain. | Under progressive semantics a small walk can already publish at the pin. Existing zero-publications/acquired-false, polling, deletion, no-extra-sync and unwatch assertions remain. Original file import-blocked; all five real Node analogue cases pass. |
| 9, social browser | Inspected; no source change. | The typing subcase at `:265` uses ephemeral signals and checks expiry, disconnect, fresh keystroke, leave/rejoin and empty outboxes. b03f265d58 already excludes ephemeral tables from the cold partition scan. The main recipe at `:20` exercises owner keys and media; fix-r5 supplies the owner-key Held proof, while these changes leave media custody untouched. Expected to pass after those prerequisite fixes, but this is an expectation, not a browser result. Supervisor must run it. |
| 10, pending ids | `packages/snapback4/test/transport-http.test.mjs:134`: keep original horizoned group and add identical horizonless rows for actual multi-page cursor coverage. `:172` counts acquire cursors and asserts at most 256 pending ids per request. | Atomic group arrives in one whole unit; paged table has five continuations/six units. `:183` subscribes via prepared opening before starting, because intermediate pages can settle before awaited opening returns. Every id (including the 17-id tail), empty outbox, exactly one terminal event, explicit sync and final 37 unique rows remain asserted. Whole file 21/21; no product batching change warranted. |

## Governing context and code corrections

Scoped llp-orient context: LLP 3000's one interpreter/partition design,
LLP 3000.001 Repair A and Repair B, and LLP 3000.001.001 §§5–10. The full child
RFC, Snapback 4 AGENTS/NOT-DOING, adopted rules, parent repairs, sync guide and
journal tail were read before implementation. The relevant constraints are
`LLP 3000.001.001#5.3-one-watermark`, `#6.1-the-acquisition-page`,
`#6.2-the-walk-its-cursor-and-completion`, `#6.4-re-acquisition-stays-staged-in-the-first-increment`,
`#7-authority-retention-writes-and-observation-continuity`, and
`#9-scope-compatibility-and-costs`. Hand-off: none; the existing RFC/journal suffice.

Code wins over proposal-era descriptions: the tree already has progressive
acquisition. Its legacy snapshot supplies Held groups independently of row
presence; the progressive tier-1 path had only reconstructed populated retained
groups plus fix-r5 owner keys. That difference caused items 1–2. A cold pin is
already a publication, not a private snapshot, which changes where acquisition
barriers and terminal-write observers must be installed. Horizon groups are
atomic even when their rows exceed a requested row limit; a horizonless fixture
is needed to witness cursor batching. Explicit successful sync still exhausts
the walk. No contract.ts changes, new coverage facts, second cuts, per-query
receipts, exact horizons, server row history or per-read prediction admission.

## Verification method and honest failed attempts

Every command in the next section ran through
`python3 reports/20261102-progressive-history-reviews/fix-r6/run.py NAME COMMAND...`
from `snapback4/`, except corrected ref-check which used the repository root and
the prefixed runner path. Node is Volta **24.18.0**. Cargo used
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Client builds copy the existing supervisor wasm and never rebuild it. Raw logs
and argv/status/summary records are retained under this report.

The first inherited Rust attempt referenced a nonexistent helper and did not
compile; it is not failing-before evidence. The corrected four cases then failed
on actual prediction/child-coverage behavior. The first new lifetime fixture
opened offline before blocking acquisition, preventing the desired online
fallback; prepared opening corrected the fixture. Initial paged pending tests
subscribed after awaited opening and missed five already-emitted completions
(diagnostic: 227 notifications, empty queue, all 232 acknowledged). Subscribing
before startup fixes that test setup while retaining exactly-once assertions.
The temporary diagnostic file was removed after its failed run; its log remains.

Two superseded runs (`lifetimes`, `transport-http`) were interrupted through their
original exec sessions with Control-C, exit 130; any partial harness summaries
are reproduced without claiming whole-file completion. An attempted SIGTERM
from a separate shell was refused by sandbox EPERM before signalling anything.
Read-only lsof ownership/parent checks identified only our diagnostic children;
after session interruption the final audit printed
`superseded diagnostic process audit: {}`. No unrelated process was signalled.

The initial ref-check used `snapback4/` as cwd, saw zero LLP documents and failed
4273 references. The corrected repository-root command passes. No loopback bind
failure occurred; no binding retry was needed. No pre-existing srv1-lifetime,
ver1-loop or dx12-serve failure was modified. Delivery await seals remain the
same 216 sites; no seal or classification artifact was regenerated.

## Commands and verbatim summaries

Silent successful commands are identified explicitly. Exit status is the process
result; summaries are copied verbatim, including every full-device harness line.

### before-read-through-upsert

`node --test packages/snapback4/test/read-through-upsert.test.mjs` — exit 1. [Raw output](logs/before-read-through-upsert.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 346.548917
```

### before-read-through

`node --test packages/snapback4/test/read-through.test.mjs` — exit 1. [Raw output](logs/before-read-through.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 121.86875
```

### before-social-starter

`node --test packages/snapback4/test/social-starter.test.mjs` — exit 1. [Raw output](logs/before-social-starter.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 236.339583
```

### before-web-review

`node --test packages/snapback4/test/web-review.test.mjs` — exit 1. [Raw output](logs/before-web-review.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 596.075167
```

### before-sync-scale

`node --test packages/snapback4/test/sync-scale.test.mjs` — exit 1. [Raw output](logs/before-sync-scale.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 143.887
```

### before-schema-capabilities

`node --test packages/snapback4/test/schema-capabilities.test.mjs` — exit 1. [Raw output](logs/before-schema-capabilities.log).

```text
ℹ tests 10
ℹ suites 0
ℹ pass 9
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5861.874208
```

### before-sync-overflow

`node --test packages/snapback4/test/sync-overflow.test.mjs` — exit 1. [Raw output](logs/before-sync-overflow.log).

```text
ℹ tests 23
ℹ suites 0
ℹ pass 21
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21265.346791
```

### before-transport-http

`node --test packages/snapback4/test/transport-http.test.mjs` — exit 1. [Raw output](logs/before-transport-http.log).

```text
ℹ tests 13
ℹ suites 0
ℹ pass 5
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46493.747667
```

### before-counts

`node --test '--test-name-pattern=special table' packages/snapback4/test/progressive-acquisition.test.mjs` — exit 1. [Raw output](logs/before-counts.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 66.345333
```

### before-inherited

`cargo test -p snapback4-device --test progressive_inherited` — exit 101. [Raw output](logs/before-inherited.log).

```text
    |                                                                                    ^^^^^^^^^^^^^^
    |
   ::: crates/snapback4-core/src/wire.rs:144:1
    |
144 | pub fn row_from_json(table: &crate::schema::Table, json: &Json) -> Result<Value, String> {
    | ---------------------------------------------------------------------------------------- similarly named function `row_from_json` defined here
    |
help: a function with a similar name exists
    |
 19 -     e.mutate(op, None, snapback4_core::Context::new("alice", snapback4_core::wire::args_from_json(&args).unwrap()).at(100)).unwrap().state
 19 +     e.mutate(op, None, snapback4_core::Context::new("alice", snapback4_core::wire::row_from_json(&args).unwrap()).at(100)).unwrap().state
    |

For more information about this error, try `rustc --explain E0425`.
error: could not compile `snapback4-device` (test "progressive_inherited") due to 1 previous error
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

### acquire-replacement

`node --test '--test-name-pattern=after request' packages/snapback4/test/store-reset-reconnect.test.mjs` — exit 1. [Raw output](logs/acquire-replacement.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3005.432209
```

### before-inherited-valid

`cargo test -p snapback4-device --test progressive_inherited` — exit 101. [Raw output](logs/before-inherited-valid.log).

```text
    Finished `test` profile [optimized] target(s) in 22.19s
test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
```

### client-build-recovery

`bun run --cwd packages/snapback4 build` — exit 0. [Raw output](logs/client-build-recovery.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### before-http-replacement

`cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive` — exit 101. [Raw output](logs/before-http-replacement.log).

```text
    Finished `test` profile [optimized] target(s) in 40.47s
test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 782 filtered out; finished in 0.03s
```

### schema-capabilities

`node --test packages/snapback4/test/schema-capabilities.test.mjs` — exit 0. [Raw output](logs/schema-capabilities.log).

```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6580.870542
```

### sync-overflow

`node --test packages/snapback4/test/sync-overflow.test.mjs` — exit 0. [Raw output](logs/sync-overflow.log).

```text
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34188.45225
```

### before-store-reset-reconnect

`node --test packages/snapback4/test/store-reset-reconnect.test.mjs` — exit 1. [Raw output](logs/before-store-reset-reconnect.log).

```text
ℹ tests 13
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 2
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 295933.448833
```

### inherited

`cargo test -p snapback4-device --test progressive_inherited` — exit 0. [Raw output](logs/inherited.log).

```text
    Finished `test` profile [optimized] target(s) in 1m 25s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

### cargo-build

`cargo build -p snapback4` — exit 0. [Raw output](logs/cargo-build.log).

```text
    Finished `dev` profile [unoptimized] target(s) in 45.53s
```

### http-progressive

`cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive` — exit 0. [Raw output](logs/http-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 1m 52s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 782 filtered out; finished in 0.02s
```

### pin-overflow

`node --test --test-name-pattern=zero-head packages/snapback4/test/sync-overflow.test.mjs` — exit 1. [Raw output](logs/pin-overflow.log).

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 248240.516
```

### store-reset-reconnect

`node --test packages/snapback4/test/store-reset-reconnect.test.mjs` — exit 0. [Raw output](logs/store-reset-reconnect.log).

```text
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21990.091292
```

### typecheck

`bun run --cwd packages/snapback4 typecheck` — exit 0. [Raw output](logs/typecheck.log).

```text
$ tsc -p tsconfig.json --noEmit
```

### transport-debug

`node --test '--test-name-pattern=wasm.*232.*paged' packages/snapback4/test/.fix-r6-transport-debug.test.mjs` — exit 1. [Raw output](logs/transport-debug.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 125500.88525
```

### signout

`node --test '--test-name-pattern=clears partial' packages/snapback4/test/progressive-lifetimes.test.mjs` — exit 1. [Raw output](logs/signout.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1496.88375
```

### lifetimes-prepared

`node --test packages/snapback4/test/progressive-lifetimes.test.mjs` — exit 1. [Raw output](logs/lifetimes-prepared.log).

```text
ℹ tests 7
ℹ suites 0
ℹ pass 6
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14496.868791
```

### transport-http-final

`node --test packages/snapback4/test/transport-http.test.mjs` — exit 0. [Raw output](logs/transport-http-final.log).

```text
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 90990.185
```

### client-build-final

`bun run --cwd packages/snapback4 build` — exit 0. [Raw output](logs/client-build-final.log).

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

### progressive-clients

`node --test --test-concurrency=1 packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-recovery.test.mjs packages/snapback4/test/progressive-budget.test.mjs` — exit 0. [Raw output](logs/progressive-clients.log).

```text
ℹ tests 49
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 87196.857583
```

### read-through-upsert

`node --test packages/snapback4/test/read-through-upsert.test.mjs` — exit 1. [Raw output](logs/read-through-upsert.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 237.591667
```

### sync-scale

`node --test packages/snapback4/test/sync-scale.test.mjs` — exit 1. [Raw output](logs/sync-scale.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 237.825375
```

### read-through

`node --test packages/snapback4/test/read-through.test.mjs` — exit 1. [Raw output](logs/read-through.log).

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 235.289334
```

### lifetimes-final

`node --test packages/snapback4/test/progressive-lifetimes.test.mjs` — exit 0. [Raw output](logs/lifetimes-final.log).

```text
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13376.231708
```

### social-browser-syntax

`node --check packages/snapback4/test/social-browser.test.mjs` — exit 0. [Raw output](logs/social-browser-syntax.log).

No output (silent successful check).

### browser-syntax

`node --check packages/snapback4/test/web-review.test.mjs` — exit 0. [Raw output](logs/browser-syntax.log).

No output (silent successful check).

### delivery-census

`node --input-type=module -e 'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; import {census,awaitBoundary} from "./packages/snapback4/test/delivery-fault-instrument.mjs"; const base="./packages/snapback4/test/"; assert.deepEqual(awaitBoundary(),JSON.parse(readFileSync(base+"delivery-await-boundary.json","utf8"))); assert.deepEqual(census().map(site=>site.id),JSON.parse(readFileSync(base+"delivery-fault-sites.json","utf8")).map(site=>site.id)); console.log("delivery await census unchanged: "+census().length+" sites");'` — exit 0. [Raw output](logs/delivery-census.log).

```text
delivery await census unchanged: 216 sites
```

### typecheck-final

`bun run --cwd packages/snapback4 typecheck` — exit 0. [Raw output](logs/typecheck-final.log).

```text
$ tsc -p tsconfig.json --noEmit
```

### diff-check

`git diff --check` — exit 0. [Raw output](logs/diff-check.log).

No output (silent successful check).

### ref-check

`../ref-check --verbose` — exit 1. [Raw output](logs/ref-check.log).

```text
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-owned-command.mjs:3: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-platform-audit.mjs:2: broken ref: LLP 3000.011.003.000.000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-postgres-serve.py:3: broken ref: LLP 3000.009.001.000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-postgres.sh:51: broken ref: LLP 3000.009.001.000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-processes.mjs:12: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-processes.mjs:107: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-processes.mjs:178: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-processes.mjs:204: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-processes.mjs:221: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-progress-reporter.mjs:1: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-signals.mjs:6: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test-work-bounds.mjs:1: broken ref: LLP 3000 not found under llp/
ERROR reports/20261101-publication-0.4.52/release-evidence/archive-corrected-full-rerun-red/publication-source-audit-inputs/scripts/test.sh:156: broken ref: LLP 3000 not found under llp/
ERROR reports/20260922-sync-generation/measure.mjs:1: broken ref: LLP 3000.007.001 not found under llp/
ref-check: FAIL — 0 LLP docs, 4273 refs in 25444 files, 4273 errors, 0 unchecked
```

### progressive-final

`node --test --test-concurrency=1 packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-recovery.test.mjs packages/snapback4/test/progressive-budget.test.mjs` — exit 0. [Raw output](logs/progressive-final.log).

```text
ℹ tests 49
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 89409.993
```

### transport-http

`node --test packages/snapback4/test/transport-http.test.mjs` — exit 130. [Raw output](logs/transport-http.log).

Control-C via original exec session after diagnosis; no completed harness verdict.

```text
ℹ tests 18
ℹ suites 0
ℹ pass 13
ℹ fail 4
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 538620.773875
```

### lifetimes

`node --test packages/snapback4/test/progressive-lifetimes.test.mjs` — exit 130. [Raw output](logs/lifetimes.log).

Control-C via original exec session after diagnosis; no completed harness verdict.

```text
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 338235.095584
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
ℹ duration_ms 153398.296
```

### ref-check-root

`./ref-check --verbose` — exit 0. [Raw output](logs/ref-check-root.log).

```text
ref-check: ok — 583 LLP docs, 13639 refs in 54699 files, 0 errors, 0 unchecked
```

### core-progressive

`cargo test -p snapback4-core --test progressive_acquisition` — exit 0. [Raw output](logs/core-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 9m 27s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.62s
```

### sim-progressive

`cargo test -p snapback4-sim --test progressive_history` — exit 0. [Raw output](logs/sim-progressive.log).

```text
    Finished `test` profile [optimized] target(s) in 9m 31s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
```

### guide

`cargo test -p snapback4-lang --test guide` — exit 0. [Raw output](logs/guide.log).

```text
    Finished `test` profile [optimized] target(s) in 9m 36s
test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.58s
```

### diff-check-final

`git diff --check` — exit 0. [Raw output](logs/diff-check-final.log).

No output (silent successful check).

### full-device

`cargo test -p snapback4-device` — exit 0. [Raw output](logs/full-device.log).

```text
    Finished `test` profile [optimized] target(s) in 8m 16s
test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.62s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.54s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.45s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 81.50s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 132.96s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.51s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.56s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.29s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.26s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.70s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.45s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.53s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.21s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.39s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.16s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.20s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.42s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.50s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.46s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 218.42s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.52s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.40s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 39.92s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.58s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.94s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.61s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## Inspection, editing and reporting commands

Non-test inspection used `cat`, `sed -n`, `rg -n`, `head -n`, `tail -n` and
`wc -l` on the RFC, parent repairs, local instructions/skill, reports r4/r5,
the changed source/test files and their imported helpers, the snapshot/history
applicators, progressive scheduler, guide sync card, social-browser recipe and
retained logs. Git reads were `git status --short`, `git branch --show-current`,
`git diff --stat` and scoped `git diff -- PATHS`; no Git mutation occurred.
Missing guessed `device/retention.rs`, guide `read_through.rs`, and fixture
`read-through.q` printed not-found diagnostics; rg found their actual files.
`mkdir -p reports/20261102-progressive-history-reviews/fix-r6/logs` and copying
the r5 `run.py` prepared local evidence capture. Source edits used apply_patch.

Inline `python3 -` commands created the temporary transport diagnostic (same
assertions), appended the journal and updated the RFC, listed command statuses,
and recorded the two interrupted command results. Their non-source summaries:

```text
created temporary transport diagnostic (same assertions)
LLP 3000.001.001: recorded fix round 6; Draft status unchanged
JOURNAL.md: appended dated fix round 6 entry
recorded 2 interrupted diagnostic commands with exit 130; no pass claimed
superseded diagnostic process audit: {}
```

`rm packages/snapback4/test/.fix-r6-transport-debug.test.mjs` removed only this
round's temporary diagnostic file. lsof commands inspected our two owned log
files and process parents; the refused separate-shell cleanup printed
`PermissionError: [Errno 1] Operation not permitted`. Original-session Control-C
returned exit 130 and `KeyboardInterrupt`. Tool waits collected existing runs;
they were not reruns. All changed source files are below 1,500 lines; local.ts
is 1,488 and local-runtime.ts 864. The journal remains append-only.

`python3 reports/20261102-progressive-history-reviews/fix-r6/write-report.py`
creates this report from the completed records, checks required successful exits,
sums actual device summaries, verifies every captured summary is included, and
checks the report length before writing. Its success message is
`report written and verified; all command summaries retained`.

## Remaining verification and open questions

- Supervisor: run the four harness-import-blocked whole files and the browser
  witnesses outside this sandbox. Web-review's IndexedDB bounds, both worker
  modes, real browser reopen and sign-out still need that execution. Node
  persistence and syntax checks do not qualify those behaviors.
- Social-browser is unchanged. Its expected recovery follows the inspected cold
  ephemeral pin and owner-key fixes; typing/media browser interaction has not
  been observed passing here. react.test.mjs and witness/idb.mjs were not run.
- No full landing battery, wasm build, publication qualification, remote work or
  performance claim. This round leaves the supervisor-built wasm intact; the
  Rust product changes are server acquisition paths, not device implementation.
- A store that already completed the buggy walk does not retroactively acquire
  a missing empty inherited Held declaration. Normal staged reacquisition repairs
  it. No data-clearing upgrade, new persisted migration or automatic repair of
  existing completed stores was introduced; the same limitation was recorded
  for missing owner-key declarations in fix-r5.
- No other unresolved product/design question was found. Stop after this report;
  the supervisor owns commit and landing.
