# SS round 8 — retire obsolete restore proof and release failed claims

2026-09-28, `sb4-intent/ss-sync-at-scale`, Linux `expo-build-1000`.
All three requested findings have fixes or stronger tests, with isolated
negative controls. This is implementation evidence, not an independent READY
verdict. Nothing pushed or published; no tool installed.

First command: `git fetch origin && git merge origin/main`. The merge had no
conflicts; main was `a745b110f`. Both parents are retained in `1366c700c`, including the requested
co-author trailer. Read rounds 0–7's prompts, reports and SS journal entries,
Astra's full round-7 NOT READY review and Grok's full rounds-4–6 review. At
startup Grok's round-7 file contained progress text, with no verdict.

## Changes and evidence

**Obsolete store proof.** A reply captured against A while page identity is
unavailable now creates a provisional client refusal. The host returns its
identity-validation outcome through a retained completion callback after its
commit acknowledgement. Proof and callback both survive a failed attempt or
Worker restart. Recovering B retires A's provisional fence and schedules sync
so reads and pending-write status recover. Another unresolved proof or a
confirmed refusal cannot be cleared by that obsolete completion. Ordinary
restore observation and known same-store cold proof remain sticky.

The host tracks pending proofs and page fences by store, rather than allowing
one store's evidence to overwrite another's. Original head/floors remain the
proof; only the current same-store transaction guards are rebound. The
callback is separate from the attempt's rejecting promise: an interrupted
attempt can still report validation when a later host call drains it.

Two Chromium cases use the real client, host, wasm and IndexedDB, with a
controlled transport: cold A at floor 100; delayed A query; sync installs B;
Worker failure makes control unavailable; A returns 90; reads/actions refuse
while replacement open is held; the new Worker restores B and reports
`obsolete`; B serves a fresh query and accepts action dispatch; offline reopen
reads B without a restore refusal. The second interrupts validation before
commit, then retries through another Worker, proving callback custody too.
The action transport is a fixture; this proves dispatch is unblocked, not a
real server action's execution semantics. Unit interleavings also preserve
another unresolved proof and ordinary/cold/host-confirmed refusals.

**Failed initial claim.** `afterWorker` awaits release before rethrowing a
failed quiescence probe. No device opened under that claim, and every later
claimant still crosses the lifetime-lock and IndexedDB barrier. This does
not change the running owner's sticky failed-termination barrier. For both
`webDevice()` and `webDevice({ worker: true })`, Chromium injects one readonly
IDB failure after acquiring `app`: the first open rejects with no held primary
lock, retry holds exactly `app`, no `app:tab-*` is created, and close leaves
no held claim. Each run observes three readonly probes, including the retry.

**Derived footprint.** The persisted predictable admission must emit exactly
`messageCounts` and `messages` after acknowledgement. The existing `thread`
case remains; a new `countOnly` query reads `messageCounts` and its membership
authorization dependency, with no `messages` dependency. Both withhold the
server answer with zero server posts and no queued VM read. Thus omitting the
derived table fails even independently of the exact-footprint assertion.

## File map and forms

Paths relative to `snapback4/` unless prefixed `../`:

| File | Change |
| --- | --- |
| `packages/snapback4/src/device-restore.ts` | Internal validation outcome/callback and provisional client refusal custody. |
| `packages/snapback4/src/local-device.ts` | Internal host capability reports identity validation across retries. |
| `packages/snapback4/src/local.ts` | Use provisional handling when page identity is unavailable; resync after obsolete proof retires. |
| `packages/snapback4/src/device-control.ts` | Keep page restore fences by store and retire only the obsolete one. |
| `packages/snapback4/src/web-worker-host.ts` | Keep proofs/callbacks by store; validate and notify only after commit acknowledgement. |
| `packages/snapback4/src/web-worker-device.ts` | Forward the validation callback. |
| `packages/snapback4/src/web-ownership.ts` | Await release of the failed initial claim. |
| `packages/snapback4/test/web-worker-control.test.mjs` | Five additional overlapping-proof/confirmed-refusal/page-restart regressions. |
| `witness/worker-protocol.mjs` | Both initial-claim failures, both replacement/restart cases, full footprint and derived-only server-read check. |
| `witness/worker-restore-replacement.mjs` | Controlled server/Worker scheduling fixture used by the real Chromium client. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | §20.4 records provisional validation and initial-claim release. |
| `../issues/20260927-snapback4-dev-adoption-poll-timing.md` | Add full-suite timing failure, unchanged-path attribution and pre-round/current controls. |
| `JOURNAL.md`, this report and `round8-*` | Append-only outcome, commands, raw qualification and isolated mutation evidence. |

No new public form, language diagnostic, Rust, wasm ABI, meter, authorization
rule or on-disk format. Existing forms compile and run:

```js
webDevice();
webDevice({ worker: true });
client.observe({ kind: 'query', name: 'thread' }, { conversationId: 'c1' });
await client.sync();
```

## Qualification and every failure

| Check | Result |
| --- | --- |
| Frozen workspace install; package build/typecheck | Pass; no dependency changes |
| Web device, Worker controls and server clock | 198 passed, zero failed |
| Sync-scale, repair-B, generation and store-reset | 158 passed, zero failed, one existing skip |
| Focused Worker controls | 24 passed, zero failed |
| Chromium Worker protocol | 44/44, zero page errors |
| Busy-Worker watches, including both round-7 restore cases | 5/5, zero page errors |
| Chromium navigation | 10/10 default and 10/10 Worker |
| Chromium IndexedDB | Both exit 1 on the two baseline assertions below |
| Whole guide | 92 passed, zero failed |
| Reference audit | 522 LLP docs, 9758 references, zero errors/unchecked |
| Whitespace/source length | Pass; `local.ts` is 1,500 lines |
| `scripts/test.sh`, one invocation | Exit 1: `== 1 failure(s) in 1422 s`; client tests |

Five isolated mutations fail, with no page errors: keep the obsolete refusal
sticky (both replacement cases); omit failed-claim release (both devices);
omit `messageCounts` (complete-footprint assertion); the same omission with
the complete-footprint assertion removed (derived query reaches the server);
forget callback custody before a failed commit (validation retry). The driver
is `round8-mutations.py`; it copies the built SDK to this worktree's ignored
`target/lane-ss-round8/mutants`, never mutating live source/build files.

Every observed failure, classified:

- **Baseline, unresolved:** `durability.adoptionRejected` and
  `durability.adoptionUnlocked` are false in both IDB modes. Current orphan
  recovery waits for a call/authority attach; the fixture expects eager open.
  Round 4 reproduced these on main. All other recorded checks pass, with
  zero page errors. Reproduce with `node witness/idb.mjs` and
  `SS_WORKER=1 node witness/idb.mjs`. Existing ticket:
  `issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md`.
- **Baseline timing failure, unresolved:** full-suite
  `wasm: adoption replaces mounted ephemeral interests, including removal`,
  `packages/snapback4/test/ephemeral-adoption.test.mjs:92`. Its updated row
  reached the watch; the subsequent `performance.now() - began <= 500`
  assertion failed. Whole-test duration was 2,466.604486 ms, **not** the
  unlogged failed interval. The test/server/wasm and exercised adoption paths
  are unchanged from pre-round merge `1366c700c`. Its default memory device
  has no cold-restore capability and no IndexedDB claim barrier, so neither
  changed product path runs. Three isolated controls each pass: baseline
  24.48/35.53/33.83 ms, current 33.35/30.11/49.83 ms. Only elapsed logging was
  added immediately before the original bound, in isolated package copies.
  These passes do not erase the full-run failure or reproduce its delay.
  Environmental scheduling is plausible, but the latency source is unconfirmed.
  Existing ticket updated: `issues/20260927-snapback4-dev-adoption-poll-timing.md`.
- **Ours, corrected setup:** initial TypeScript build/typecheck found a
  duplicate local `denied` binding in the host; renamed before qualification.
  The first replacement fixture constructed its test Worker through `super`,
  bypassing Vite's Worker bundling; switched to a statically bundled
  `new Worker(new URL(...))`. A subsequent assertion expected explicit null
  where the engine omits `restore_refusal`; corrected to absence. Browser
  setup failure records are retained separately and never counted as passes.
  Exploratory absent-file reads and a process-name parse failed and were
  corrected. The initial isolated-baseline build command used the wrong cwd
  and could not find Bun; its stray diagnostic log was removed immediately,
  then the worktree-local build passed. An artifact comparison initially used
  gzip stdin (no filename header); corrected to the budget script's exact
  file-input form, confirming unchanged bytes and size.
- **Ours, expected:** the five semantic mutation controls above. No unresolved
  lane-owned product/test failure in affected qualification.
- **Environmental:** no confirmed environmental failure; the full-suite
  timing cause remains unlocalized as above. No tools installed
  on a shared path or in this worktree this round.

Full suite, exactly once, exit 1:

```text
== 1 failure(s) in 1422 s
   client tests
```

Rust: **4,162 passed / 0 failed / 30 ignored**. Client tests across all shards:
**3,925 passed / 1 failed / 10 skipped**. Client models: **79/79**; fixture
wrappers **9/9**. Cargo/wasm builds, docs budget, release guard, package
build/typecheck, chat check, chat/Expo typechecks all pass. Client tests took
464 s; models took 275 s. Initial client host load was 10.80 across 96 CPUs;
that observation does not establish load at the failed interval. The complete
log is `round8-full-suite.log.gz`; summary is `round8-qualification.json`.
No full-suite rerun, assertion relaxation or product change to hide this red.

## Reproduction and limits

From `snapback4/`, existing Node 24.13.1 / Bun 1.3.14 / Rust 1.97.0:

```sh
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test packages/snapback4/test/web-*.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node --test packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/repair-b*.test.mjs packages/snapback4/test/sync-generation.test.mjs packages/snapback4/test/store-reset*.test.mjs
node witness/worker-protocol.mjs target/lane-ss-round8/worker-protocol.json
node witness/worker-watch.mjs target/lane-ss-round8/worker-watch.json
node witness/navigation-immediate.mjs
SS_WORKER=1 node witness/navigation-immediate.mjs
node witness/idb.mjs
SS_WORKER=1 node witness/idb.mjs
cargo test -p snapback4-lang --test guide
python3 reports/20260927-ss-sync-scale/round8-mutations.py
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

Focused timing reproduction (currently passes in isolation):

```sh
node --test --test-name-pattern='^wasm: adoption replaces mounted ephemeral interests, including removal$' packages/snapback4/test/ephemeral-adoption.test.mjs
python3 reports/20260927-ss-sync-scale/round8-adoption-controls.py
```

The control driver reconstructs the merged pre-round SDK by restoring its
seven changed product files and rebuilding an isolated copy, uses the same
unchanged test/server/wasm inputs, and interleaves three baseline/current runs.
It does not invoke `scripts/test.sh`. The full-run context is the script's
ordinary concurrent client file set; no failing isolated reproduction is
claimed. Retained timing results are in `round8-adoption-controls.json`.

The existing worktree-local Node/Bun links select the supported build path
without the host's incompatible optional wasm-opt. Retained evidence and
mutation copies stay in this worktree. No original GS/RG store is used.

Wasm before and after the suite: **2,019,815 B raw / 585,384 B canonical GNU gzip-9**,
delta **0/0**, unchanged cap **586,193 B**, headroom **809 B**. SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
The suite's final build has the same digest, raw size and file-input gzip size.

Scoped `llp-orient` context: Snapback 4's fence and LLP 3000; LLP 2000.000
§§7–9; LLP 3000.001 Repair B; LLP 3000.007 §§18.2/20.4; LLP 3000.016 §2.2;
LLP 3000.019 §3.3; LLP 3000.022 §4; the current sync guide. Root/.007/.019/.022
remain current; no new working-set document. The local skill mirror is absent,
so the populated sibling `lane-gs/vendor/llp/skills/llp-orient/SKILL.md` was
read without modifying it. Risks: clearing confirmed evidence, confusing
initial-claim failure with running-owner custody, omitting derived predictions.
Existing .007 updated; hand-off none.

No deviation from round 8's requested scope. No new scale measurement or
stronger performance claim. Broader open limits and their reproduction remain
in ROUND6: historical Node 8/12-second and synthetic live-writer targets;
the original Darwin timeout; bucket amplification; within-budget bulk indexes;
Worker total memory and broader platform qualification. For the performance
cases, use ROUND6's private-fixture scale/real-app commands. Page destruction
before restore proof's durable commit remains outside the reopen guarantee;
no synchronous restore journal or physical-power-loss claim is added.
