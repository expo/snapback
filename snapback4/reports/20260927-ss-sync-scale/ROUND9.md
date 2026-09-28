# SS round 9 — release failed closes and pin adoption's restore guard

2026-09-28, `sb4-intent/ss-sync-at-scale`, Linux `expo-build-1000`.
Both commissioned findings are addressed. The close path is fixed; the
existing adoption guard is unchanged and now has an isolated failing mutation
control. This is implementation evidence, not an independent review verdict.
Nothing pushed or published; no tool installed.

First command: `git fetch origin && git merge origin/main`, already up to
date, no conflicts. Starting lane commit: `6f7253beaa078501ee1cbda40779f78040bb9e32`;
fetched main: `a745b110f2187004abb1cec8380b33b6d1396108`.
Read the round 0–8 prompts, reports and SS journal entries, and Grok's complete
round-7 review, including its audit and surviving mutation.

## Changes and regression evidence

**Failed close.** The host attempts restoration under its existing claim.
Its `finally` always attempts Worker termination, awaits the lifetime lock
and IndexedDB barriers, then releases the page claim. A restoration error
still rejects the original close attempt. Once release succeeds, the host
records a resolved closed state: subsequent close calls do not retain that
error or start another Worker. Concurrent closes share the original attempt.
A failed termination barrier still retains the claim and rejects later close
attempts; the existing protocol regression for that case remains green.

Two new Chromium cases retain a pending restore proof across interruption,
then fail its persistence during close. One aborts an actual strict IndexedDB
transaction; the other substitutes a reply without `E_STORE_RESTORE` after
the real interpreter observes the regression. Each checks the failed close,
both locks absent after quiescence, a repeated close without a Worker restart,
and a new claimant receiving exactly `app`. Both tests failed before the fix:
the next claimant received `app:tab-*`. The fixed cases pass. The injected
IDB abort reports `Error: null` through the existing Worker error transport;
the witness independently records the strict transaction and injected abort.

**Generation-changing adoption.** Two tests use the real client, Worker, wasm
and IndexedDB with controlled transport. A cold server answer establishes
floor 100, and a delayed query holds head 90. The next sync page has generation
2 rather than 1, and its completed `observe_store` reply is held. In the first
case, head 90 latches before that observation is released; the next action
must still refuse. This is the schedule requested in the brief.

That schedule alone cannot reach the post-adoption guard: the earlier
observation guard returns first. The second case releases the observation,
executes real adoption successfully, and holds its reply before delivery to
`syncRound`. It then delivers head 90, verifies the refusal, releases adoption,
and checks the next action. A following state observation is held if reached,
so another sync round cannot mask a briefly cleared client refusal. The
ordinary guarded path never reaches that extra hold. Both cases require
`E_STORE_RESTORE` and zero action dispatches after completion.

The isolated mutation deletes **only**
`|| partitionDenied?.code === "E_STORE_RESTORE"` from the `adopted.denied`
condition in the built `local.js`. The earlier observation guards stay intact.
The observation case still passes, but the adoption case fails its next-action
assertion: the refusal is absent. There are zero page errors. The driver
copies the SDK under this worktree's ignored `target/lane-ss-round9/mutants`;
ordinary source and built files are never mutated. No `local.ts` product
change is needed.

## File map and forms

Paths relative to `snapback4/` unless prefixed `../`:

| File | Change |
| --- | --- |
| `packages/snapback4/src/web-worker-host.ts` | Guaranteed quiescent release after failed close; resolved terminal state after release. |
| `witness/worker-protocol.mjs` | Two close-failure cases, actual strict-abort/observation injection, and assertions for both generation schedules. |
| `witness/worker-restore-adoption.mjs` | Controlled transport and completed-reply scheduling for the real browser client. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | §20.4 records failed-close semantics and adoption coverage. |
| `JOURNAL.md`, this report and `round9-*` | Dated outcome, commands, qualification and mutation evidence. |

No new public form, diagnostic, Rust code, wasm input/ABI, meter, authorization
rule or durable format. Existing forms exercised by qualification:

```js
webDevice();
webDevice({ worker: true });
await client.act({ kind: 'action', name: 'test' }, {}); // refused after restore proof
await client.close();
```

The action route is a transport fixture, proving refusal before dispatch,
not real server execution of an action named `test`.

## Qualification and failures

Final results are retained in `round9-qualification.json`, the protocol/watch
JSON, and compressed logs alongside this report.

| Check | Result |
| --- | --- |
| Frozen install, package build/typecheck | Pass; no dependency changes |
| Web device, Worker controls and server clock | 198 passed, zero failed |
| Sync-scale, repair-B, generation and store-reset | 158 passed, zero failed, one existing skip |
| Chromium Worker protocol | 48/48, zero page errors |
| Busy-Worker watches | 5/5, zero page errors |
| Chromium navigation | 10/10 default and 10/10 Worker |
| Chromium IndexedDB | Both exit 1 on the two baseline assertions below |
| Whole guide | 92 passed, zero failed |
| Reference audit | 522 LLP docs, 9758 references, zero errors/unchecked |
| Whitespace/source length | Pass; largest changed source is 775 lines |

Every failure observed this round:

- **Ours, reproduced and fixed:** the two new close cases fail before the
  fix at the exact-primary-claim assertion (`app:tab-*` instead of `app`).
  Both pass in final qualification.
- **Ours, expected negative control:** removing only the adoption guard
  fails the new adoption case, with zero page errors. The unmutated case
  passes. This is not an unresolved product failure.
- **Baseline, unresolved:** `durability.adoptionRejected` and
  `durability.adoptionUnlocked` are false in both IDB modes. The fixture
  expects eager orphan recovery at open; current recovery waits for a call
  or authority attachment. All other asserted conditions pass, with zero
  page errors. Round 4 reproduced these on main. Commands: `node witness/idb.mjs`
  and `SS_WORKER=1 node witness/idb.mjs`. Existing ticket:
  `issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md`.
- **Ours, exploratory reads:** one search named an absent
  `local-transport.ts`; one status read preceded creation of the client
  summary file. Both were corrected; neither changed files or counts as
  a test result. No build, typecheck or fixture setup failure.
- **Environmental:** none observed. No unresolved lane-owned qualification
  failure. Existing worktree-local tool links were reused; no installation
  on a shared path or elsewhere this round.

**Did not run `scripts/test.sh`, as instructed.** Round 8's exact historical
result remains:

```text
== 1 failure(s) in 1422 s
   client tests
```

Its baseline failure was the <=500 ms wasm mounted ephemeral-interest
adoption assertion in `ephemeral-adoption.test.mjs:92`. The unchanged test
passes in round 8's isolated controls, but its full-run delay is unlocalized.
It is not rerun or claimed fixed here. Reproduction and controls remain in
`ROUND8.md` and `round8-adoption-controls.py`; ticket:
`issues/20260927-snapback4-dev-adoption-poll-timing.md`.

No wasm rebuild is necessary for this TypeScript-only product fix. Remeasured
artifact: **2,019,815 B raw / 585,384 B GNU file-input gzip-9**, delta **0/0**,
unchanged cap **586,193 B**, headroom **809 B**. SHA-256:
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.

## Reproduction and limits

From `snapback4/`, using existing Node 24.13.1 / Bun 1.3.14 / Rust 1.97.0:

```sh
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
mkdir -p target/lane-ss-round9
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test packages/snapback4/test/web-*.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node --test packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/repair-b*.test.mjs packages/snapback4/test/sync-generation.test.mjs packages/snapback4/test/store-reset*.test.mjs
node witness/worker-protocol.mjs target/lane-ss-round9/worker-protocol.json
node witness/worker-watch.mjs target/lane-ss-round9/worker-watch.json
node witness/navigation-immediate.mjs
SS_WORKER=1 node witness/navigation-immediate.mjs
node witness/idb.mjs
SS_WORKER=1 node witness/idb.mjs
cargo test -p snapback4-lang --test guide
python3 reports/20260927-ss-sync-scale/round9-mutations.py
```

Focused regressions: prefix the protocol command with
`SS_WORKER_CASE='failed close|generation-changing'`.
The pre-fix red record uses the starting SDK with the new witness; the
adoption mutation is independently reproducible with the driver above.
Run `./ref-check --verbose` from the repository root for the reference audit.

Scoped `llp-orient` pack: `web-worker-host.ts`, `syncRound`, and their browser
witnesses; LLP 3000's fence and LLP 2000.000 §§7–9; LLP 3000.007 §20.4
(current working set) governs ownership and sticky proof; its §18.2 governs
store identity. LLP 3000.016 §2.2, LLP 3000.019 §3.3 and LLP 3000.022 §4
preserve read/prediction, publication and conditional delivery fences. The
current sync card was read and the whole guide tested. Risks: releasing a
still-writing Worker or testing only the earlier observation return. Both
have explicit witnesses. Existing .007 updated; no new LLP; hand-off none.
As in prior rounds, the local skill mirror is absent, so the populated
`lane-gs/vendor/llp/skills/llp-orient/SKILL.md` was read without modifying it.

No deviation from the requested scope. The second adoption schedule is
necessary to kill the exact surviving mutation. Failed close does not promise
its unsaved restore evidence survives reopening; it reports failure, stops
the old writer, and permits a later claimant to perform its own quiescence
barrier. Existing page-destruction-before-commit limits remain.

Historical acquisition/live targets, the original Darwin timeout, bucket
amplification, within-budget bulk indexes, total Worker memory and broader
platform qualification remain as recorded in `ROUND6.md`. Its private-fixture
Node and real-app/browser commands reproduce those workloads; no scale run
or stronger performance claim is made here. No original GS/RG store was used.
