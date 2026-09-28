# Lane SS, round 4 — Worker execution foundation; public path incomplete

Date: 2026-09-28. Branch: `sb4-intent/ss-sync-at-scale`.

**This is the coherent subset allowed by the brief, not the finished Worker
opener. `webDevice({ worker: true })` is not implemented.** The ordinary opener
remains the default. This round builds and tests the internal Worker execution,
strict persistence and recovery boundary, and separates journal execution from
page capture/authority/cleanup. The acquisition read-control snapshot and
prepared suspension dispatch are still missing. No performance target is claimed.
Nothing was pushed or published; no tool was installed on a shared path.

## Target results

| Requested Chromium target | Round-4 result |
| --- | --- |
| No acquisition main-thread task above 200 ms at 1,000 conversations | **Unestablished; not measured.** No integrated Worker client to run through the scale witness. |
| During-acquisition live p95 ≤1 s at 1,000 | **Unestablished; not measured.** Reads still use the existing device queue on the public path. |
| Acquisition total no worse than roughly 27 s at 1,000 | **Unestablished; not measured.** |
| 100-conversation acquisition no worse than today | **Unestablished; not measured.** |

`witness/sync-scale-browser.mjs` and both Node scale witnesses are unchanged.
No 100/1,000-conversation run was performed this round. Round 2's 4.186/27.327 s
and round 3's measurements remain historical evidence; they are not results
for this subset. The protocol fixture below has three confirmed rows and
admitted writes, not a scale workload or a live writer.

## Integration and context

First command was `git fetch origin && git merge origin/main`. Main was
`1972112a04fc03ece3423fbd4af67646f0cd5826`, 207 commits ahead of the lane's
round-3 parent. The only conflict was the journal; both appends were retained
in merge commit `17024e0d6`. Commit `f1e247c86` removes the unlanded round-3
index copy reductions, restoring main's product code while keeping its
regression fixtures. No engine, meter, row authorization, disclosure rule,
wire operation or wasm ABI is added by the Worker work.

Read all four prompts, reports and corresponding journal entries. Used the
`llp-orient` instructions in the populated sibling
`lane-gs/vendor/llp/skills/llp-orient/SKILL.md`, read-only; the local vendored
skill link remains uninitialized. The context pack is scoped to the web host:

- LLP 3000 §§1, 4: the Snapback 4 fence; the current guide remains authoritative
  for the existing authoring surface.
- LLP 2000.000 §§7–9: one interpreter and the durable replica.
- LLP 3000.007 §§18.2, 20.4: store identity, synchronous custody, strict transfer
  acknowledgement and exclusive orphan ownership. Updated §20.4 with the
  implemented internal foundation and explicit remaining surface.
- LLP 3000.016 §2.2 and LLP 3000.019 §3.3: prediction, credential, expiry and
  publication fences; these are why raw Worker RPC is not a finished opener.
- LLP 3000.008.004 §3: actual wasm/IndexedDB interruption evidence.
- LLP 3000.022 §4: conditional supplementary collection must still check
  current authority at its actual persistence commit.

Root/current index and governing references were consulted; no new LLP number
or working-set link. Main's newer delivery and watch implementations are kept.
The sync guide card was read and its complete guide tests run. Hand-off: none
for the implemented split; completion of the original round is still required.

## What is implemented, file by file

Paths below are relative to `snapback4/` unless stated otherwise.

| File | Change |
| --- | --- |
| `packages/snapback4/src/web-journal-execution.ts` | Synchronous and asynchronous interpreters for one journal request plan. |
| `packages/snapback4/src/web-journal.ts` | Admission, exit recovery and transfer binding share those plans; `recoverWith`, `admitWith`, `fenceWith` and `recoverExitsWith` allow page-owned execution across a Worker boundary. Capture, original records, authority locks, cancellation and localStorage cleanup remain on the page. |
| `packages/snapback4/src/web-wasm.ts` | Extract the unchanged digest-validated wasm cache/initialization code and memory-size accessor for either realm. |
| `packages/snapback4/src/web.ts` | Use that extracted loader; public options and ordinary host behavior remain unchanged. |
| `packages/snapback4/src/web-worker-runtime.ts` | Internal VM, strict IndexedDB, bucket encoding and residency accounting in one Worker; full saved images and drained change arrays stay there. |
| `packages/snapback4/src/web-worker-host.ts` | Internal page dispatcher under a supplied exclusive claim, serialized private transactions, explicit commit requirement, termination barrier and lazy durable restore. It is deliberately not a `DeviceCore`. |
| `packages/snapback4/src/web-worker-entry.js`, `tsconfig.build.json` | Static entry included in the existing TypeScript package build. A Vite production export proves the packaged Worker and wasm URLs. |
| `witness/worker-protocol.mjs` | Real Chromium faults, navigation, claims, transfer/cleanup, authority and offline-shell tests. Fault injection exists only in the witness's generated Worker, not in product switches. |
| `crates/snapback4-core/src/key.rs`, `rows.rs`; `crates/snapback4-device/src/memory.rs` | Undo round 3's unlanded copy reductions; retain the key-byte fixture after production code. Round 3's nested-media and rollback fixtures remain. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Document the internal execution/ownership boundary and its incomplete integration. |
| `JOURNAL.md`, this report, evidence, acquisition ticket and new IDB-witness ticket | Record actual results and remaining work. |

Every modified/new source file is below 1,500 lines. No new authoring syntax,
refusal code, package version, dependency or wasm budget.

## Ownership and durability protocol actually tested

The page obtains the existing exclusive store claim. Before any persistence,
the Worker acquires a separate lifetime Web Lock named for that same store and
acknowledges it; only then can the page issue open/invoke/commit. The lifetime
name is stable across Worker pages: a random per-Worker name would let a new document
miss an old realm still shutting down after navigation released the page claim.

On failure or explicit termination the page terminates the old Worker, waits
for its lifetime lock to release, and queues IndexedDB reads behind outstanding
transactions for the device and wasm cache. It retains its exclusive claim
through that barrier and the next VM's durable restore. Close after a failed
or terminated Worker also restores under the claim before releasing it. If the persistence barrier itself fails, that failure remains sticky;
a later close cannot release the claim by forgetting the pending barrier. It never treats `terminate()` as a durable-store acknowledgement.
Worker errors between RPCs invalidate the whole private transaction too.

The host refuses to return a private transaction with an uncommitted invoke.
The Worker drains and writes changes together with the supplied `j` markers
in the existing strict transaction, then replies with journal metadata only.
Ordinary operation results can cross RPC; no persistence row/staging/change
vector crosses to the page. Page capture keeps original id, order, arguments,
minted ids and authority. As on the default host, admission allocates its
actual outbox sequence from the durable device counter; it does not reuse a
possibly colliding captured ordinal. Page authority stays locked across the
asynchronous admission/commit.

A crash before reply may have committed or aborted; the call rejects either
way. The next transaction restores and journal recovery sees the durable
marker, so a lost reply or failed localStorage removal cannot re-admit a
retired id. This is browser realm/navigation interruption evidence, not a
power-loss or physical-storage guarantee.

## Chromium qualification

Chromium 151.0.7922.34 / Playwright-core 1.55.1, Vite production bundle,
real IndexedDB with strict transactions. The witness uses the local package
`dist` build; no published/installed tarball is claimed. Final protocol witness: **26/26 pass**, zero page
errors. [Structured results](./round4-worker-protocol.json) preserve every
case, failed-call outcome, strict transaction mode, private/published row
counts, outbox order, marker and issued-send-revision observations.

| Cases | What they prove |
| --- | --- |
| Packaged production entry + existing `web-shell` exporter | Acquire, close, disable network, reload HTML/JS, start a new Worker, restore wasm without a network fetch and reopen the acquired store. This is an internal host offline proof, not an app using `worker: true`. |
| 10 admission crash/termination cases | Before invoke, after invoke, before commit, inside a live strict transaction, and after commit/before reply. Every interrupted call rejects; recovery admits original and later captured ids once, in order, with original minted ids and transfer markers. Before recovery, outbox and marker either both exist or both do not; admission clocks honor the durable issued-time floor. |
| 4 staging/publication terminations | During strict save and after commit/before reply. Durable live rows are either zero or all three; reacquisition completes and removes staging. |
| Navigation during staged save | A same-origin replacement document recovers a captured, not-yet-transferred write and the private staged store, then completes acquisition. |
| Two tabs | A live owner forces the peer into `:tab-*`; termination and recovery never release the primary claim; close does. This does not implement Worker orphan adoption. |
| Cleanup failure | Keep the executable localStorage record, retire its outbox id, terminate/reopen, and recover no duplicate because the durable marker remains. |
| Admission during reacquisition | Capture is synchronous while terminal publication is held; zero uncommitted live rows escape and the captured intent is admitted after restore. |
| First cold acquisition | An unpublished store identity still gives synchronous `E_ADMISSION` and captures no intent. This is existing behavior, preserved explicitly. |
| Authority change | Captured original authority survives; logout before recovery prevents admission. |
| Exit record replay | A synchronously captured exit advances the send revision once on recovery. This is not `onSuspend` transport integration. |
| Close following termination | A new Worker restores the staged durable image before close releases the page claim. |
| Failed termination barrier | A page-side IDB failure keeps both termination and later close rejected, with the exclusive page claim still held. |
| Missing commit / idle Worker crash | Private metadata cannot return as success or hitchhike on a later commit, including a crash between RPCs. |

The first witness attempt had a generated-JS brace error and a TypeScript
LockManager return-type error; both were lane-owned authoring mistakes and
fixed before execution. Two early cases incorrectly tried to admit on a
first cold store before identity publication (one failed case in the first
run, two in the next; raw logs and JSON are retained as `round4-early-*`). The corrected cases exercise
reacquisition and separately assert the cold refusal. These corrected harness
failures do not count as passes in those earlier runs. Final source review
also found and fixed a lane-owned barrier-error path that could forget a
failed termination barrier before close; its dedicated Chromium case now
requires the claim to remain held. The staged whitespace check found one
extra EOF blank line in the extracted wasm loader; removed before the final
commit. This was a lane-owned formatting error.

## Other qualification and every failure

- Existing `web-*.test.mjs`: **163/163 pass**, unchanged test files.
- Sync-scale and server-clock wire tests: **15/15 pass**.
- Whole guide: **92/92 pass**.
- Existing Chromium `navigation-immediate.mjs`: **10 passed; 0 failed**.
- Package build/typecheck and reference audit pass. Reference audit:
  `ref-check: ok — 521 LLP docs, 9748 refs in 27765 files, 0 errors, 0 unchecked`.
- Existing Chromium `idb.mjs`: **exit 1, baseline**. Exactly
  `durability.adoptionRejected` and `durability.adoptionUnlocked` are false;
  all other recorded checks pass. Main defers orphan recovery to the first
  call/authority attachment, while the witness expects opening itself to
  fail and unlock. The unclosed successful open also keeps its claim.
  Substituting main's original web host/journal reproduces both failures
  with the same server/wasm. [Baseline control](./round4-idb-baseline.mjs),
  [current output](./round4-browser-idb.log.gz),
  [main output](./round4-browser-idb-baseline.log.gz). Follow-up:
  [ticket](../../../issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md).

Ran `scripts/test.sh` **once**: **`== 0 failure(s) in 1770 s`**, exit 0.
All blocking steps passed: Rust 4,162 passed / 30 ignored; client files across
all shards 3,901 passed / 10 skipped; serial models 79/79; fixture wrappers
9/9; both app typechecks, docs budget, release guard and package checks. No
full-suite failures to classify. Ignored/skipped cases are not counted as
passes. The run **exceeds the repository's 60 s total-suite budget**; it is not
a qualification of that time target. No environmental qualification failure
remains. The separate browser witness baseline failures are recorded above.

The full suite uses the same environment as affected checks, eight Cargo jobs,
eight Rust test processes, stripped dev/test debug info and fd limit 65,536.
The final internal Worker-host error handling was also rebuilt and exercised
by the 26-case Chromium run after the suite's initial build phase; the public
default path was unchanged in that interval. No second full-suite invocation. [Complete log](./round4-full-suite.log.gz).

## Wasm

After dropping round 3's product changes, the round's initial and final builds
are identical: **2,019,815 B raw / 585,384 B gzip**, delta **0/0 B**. Both have
SHA-256 `083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
Current main's inherited budget is **586,193 B**, unchanged by this round;
headroom **809 B**. The historical 572,841 B budget in round 3 predates main's
delivery integration; this lane did not raise either budget. The JS Worker
introduces no wasm export, ABI operation or Rust product change.

## Forms and reproductions

The public form that still compiles and runs is unchanged:

```js
const client = await createLocalClient({ url, session, device: webDevice() });
```

There is **no new public form**. The internal witness imports the unexported
host module, obtains `indexedDbPersistence().claim(name, true)`, constructs
`new WebWorkerHost(claim)` and runs private `transaction(async tx => { ...;
await tx.commit(markers); return result; })` operations. Applications must not
use that primitive as a completed opener.

From `snapback4/` (Node 24.13.1, Bun 1.3.14, Rust 1.97.0):

```sh
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
cargo build --workspace
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node witness/worker-protocol.mjs target/lane-ss-round4/worker-protocol.json
node --test packages/snapback4/test/web-*.test.mjs
node --test packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node witness/idb.mjs
node witness/navigation-immediate.mjs
cargo test -p snapback4-lang --test guide
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The local `bin` directory contains only symlinks to the already installed
Node/Bun. It avoids the host's incompatible optional wasm-opt via the existing
supported no-optimizer path. There was no tool installation. No GS fixture,
original store or WAL was served or modified this round.

## Remaining work and default criteria

This round is incomplete. Finish all of the following before exposing the opt-in:

1. A `DeviceCore` adapter, including recovery/adoption of orphan stores, shared
   receipts, media and durable committed-result notification before fallible
   cleanup. Also coordinate the lifetime lease with the default opener when
   switching from a Worker page after navigation: only Worker-to-Worker
   replacement uses that lease in this subset. Mixed-opener termination
   ordering is unqualified and must not be assumed from the two-Worker test.
   The internal transaction primitive is not that adapter.
2. The conservative control snapshot after durable calls, fenced by credential,
   store/generation, acquisition incarnation, prediction footprint (unknown
   blocks), queued-write revision and issued-time floor. Synchronous capture
   must fence before transfer and older completions cannot clear that fence.
   No server-read bypass or page control snapshot is implemented here.
3. Permit that bypass only for already server-answered watches during cold
   acquisition, disabling composition/held reads and retiring it at publication.
   Repeat busy-Worker 503, prediction and expiry tests. Today `evaluateLocal`
   still awaits queued/query calls behind apply; raw RPC alone cannot meet p95.
4. Prepared exit binding and begin-send custody, current at synchronous
   `onSuspend`. Posting an asynchronous `begin_send` at pagehide could let an
   old sync revision publish after a keepalive send. Exit journal replay tested
   here does not solve this dispatch ordering, and was not substituted for it.
5. Preserve conditional delivery collection's commit-point `current()` fence.
   The page closure cannot be cloned to a Worker or checked once before an
   asynchronous commit and called equivalent. The primitive has no such
   capability; its final adapter must explicitly address it.
6. Expose `webDevice({ worker: true })`, preserve injected providers without
   cloning functions, run the existing client/navigation/session/receipt tests
   through it, and measure the four targets using the existing scale witness
   with its live writer. Add the requested sync-card guidance and actual numbers
   only when that surface exists. No guide recommendation for a nonexistent
   option was added in this subset.

Making it the default additionally requires complete protocol parity (including
all ownership, identity, auth, expiry and delivery fences), supported-bundler
and offline-shell coverage, acceptable startup/JS bytes and Worker-memory cost,
and repeated 100/1,000-conversation measurements meeting the stated targets.
The unchanged wasm budget and default-path tests remain required. Current
costs include another realm, RPC and duplicated control metadata; no measured
startup, total-memory or acquisition-cost claim is made for this foundation.
