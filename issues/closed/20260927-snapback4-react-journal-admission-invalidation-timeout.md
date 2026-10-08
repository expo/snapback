# Snapback 4: cross-tab journal admission invalidation intermittently times out

Status: Closed
Date: 2026-09-27
Scope: `snapback4/packages/snapback4/test/react.test.mjs`, browser online custody
Observed by: lane QE round 2, implementation head `55e8c29af`
Classification: baseline failure outside the Quarry changes; underlying cause unconfirmed

In the single full `scripts/test.sh` run, the nested test
`closing the last journal owner during admission still invalidates another tab`
timed out at `react.test.mjs:146` after 30,000 ms. The write admission itself
returned pending, but the first tab's hook never reported the admitted ID before
the deadline. Its enclosing `React hooks and reference-app lifetimes` test also
failed as a consequence. This is one underlying failure, two Node test failures.

The browser fixture uses real online custody and a controlled transport sharing
`localStorage`; it launches neither a backend nor the Quarry compiler. The
React test, every client/app source, the imported receipts guide snippet and
Bun lockfile are unchanged between merged pre-fix `ccb09c02a` and `55e8c29af`.
This supports the baseline classification; it does not establish a scheduling,
product or browser cause. No environmental failure is confirmed.

Reproduction from `snapback4/`, using Node 24.13.1, Bun 1.3.14, Rust 1.97.0:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
ulimit -n 65536
scripts/test.sh
```

Observed on Linux expo-build-1000. The script selected concurrent client files
at host load 21.48 across 96 CPUs. Exact full result:
`== 1 failure(s) in 1393 s`, group `client tests`, exit 1. Rust, all 78 models,
both app typechecks and all other stages pass.

A single isolated follow-up after the suite:

```sh
node --test packages/snapback4/test/react.test.mjs
```

passes **46/46** in **3,496.960007 ms**, including the failed nested case in
**250.18955 ms**. This is intermittent evidence, not a deterministic reproducer
or a repair. The full suite was not repeated. No test, timeout or runtime source
was changed. Investigate the cross-tab invalidation after the last owner closes
during admission, retaining the admission and hook assertions.

Evidence in the lane checkout: `snapback4/target/lane-qe-r2/full-suite.log`,
`full-suite.exit`, `react-isolated.log`, `react-isolated.exit`. Durable summary:
[`ROUND2.md`](../../snapback4/reports/20260927-qe-quarry-ergonomics/ROUND2.md).

## Resolution — 2026-09-27, lane FX

This is a product race. Chromium's BroadcastChannel delivery can beat the
receiving renderer's localStorage update, even with Web Locks serializing
the SDK's accesses. The hook receives the broadcast, reads the old empty
journal, renders it, then receives no SDK invalidation when storage catches up.
Closing the sender leaves no later dispatch-status update to mask the race.

The instrumented real-browser failure records this exact sequence:
`received` at 1790499158690.0; `get` returns the empty journal at
1790499158690.2; the admission's `storage` event arrives at 1790499158692.9.
The row is durable in both tabs, but the hook remains empty.
Evidence: `react-storage-closing-02.log`, under `target/lane-fx-evidence/`.

`journal-changes.ts` now invalidates on the journal's storage event (and
clear) as well as BroadcastChannel. It rereads the owned journal under the
existing lock; the event payload never becomes intent. The last owner removes
both listeners. Hosts without DOM event methods keep the existing path.
The client operations reference documents this ordering.

The browser test now holds A's storage visibility and storage-event delivery
until B's broadcasts have caused reads of the old image. B closes on its own
committed admission as before. Releasing the real storage events must update
A's mounted hook and durable pending list to the same queued ID. No manual
hook refresh, extra write or remount can rescue it. Existing pause/teardown,
settlement and admission assertions remain. The previously 1,594-line test
was split into its runner, shared harness and pending-peer helper; other
React cases were moved without changes.

Proof: removing only the product's new storage listener fails **5/5** with
the forced order and the unchanged 30,000 ms browser wait. The fixed complete
React file passes **20/20** loaded runs (46 tests each), five processes at a
time with eight CPU workers on cores 0–7. Online custody and pending-list
compatibility pass **55/55**. The guide passes **86/86**.

From `snapback4/`, pinned tools on PATH, after building:

```sh
python3 reports/20260927-fx-flakes/controls.py
python3 reports/20260927-fx-flakes/repeat.py react-old-final target/lane-fx-evidence/react-no-storage-final.control.mjs 'React hooks' 5
python3 reports/20260927-fx-flakes/repeat.py react-final packages/snapback4/test/react.test.mjs 'React hooks' 20
```

Control failures are deliberate. Final logs: `react-old-final-*.log`,
`react-final-*.log`, their JSON summaries, and `online-pending.log` in
`snapback4/target/lane-fx-evidence/`. Full-suite result and qualifications:
[FX report](../../snapback4/reports/20260927-fx-flakes/REPORT.md).


## FT verification — 2026-10-08

The open working-set copy duplicated this resolved ticket. FX's product fix
`61b75b5387` and its forced broadcast-before-storage-visibility browser
regression remain present. FT removes the duplicate open copy, retains this
resolution, repeats the full current React file under confined CPU load and
runs the storage-listener-removal negative control again. Exact counts,
failures and logs: [FT report](../../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
