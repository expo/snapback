# Lane FX — intermittent tests fixed at their cause

2026-09-27. Branch `sb4-intent/fx-flakes-2`, starting from
`54099bc882c529713f6e6204c5f51181f696a8ef` (the supplied `origin/main`).
Implementation commits: `192488266` (expiry retries), `90dc4bf23`
(pinned clocks), `61b75b538` (cross-tab journal invalidation).
No push, publication, version bump or budget change.

The brief lists five failing test names in three families. All three families
are addressed. The journal failure is a product race; the other two families
are test scheduling/clock-control errors. No authorization, disclosure,
interpreter, write durability, meter, Quarry syntax or client contract changed.

## Diagnosis and deterministic counterexamples

**Expired server replies.** A sync commit can invalidate a request while its
reply is in flight. The existing authority fence immediately reevaluates it;
that request is not an expiry retry. The old test counted every request arrival
as a paced retry. A forced sync before the first watch reply fails the old
assertion **5/5**; one first gap is 10.211 ms against its 23 ms lower bound.

The old wait also conflates scheduling a retry with timely delivery of the
host timer callback. Holding that scheduled callback hits the old
`timed out: paced expired-response retries` assertion **5/5**. This is a
controlled scheduling counterexample, not a claim to have reconstructed the
exact scheduler history from KG's historical timeout log.

The fixed test holds and explicitly releases the product's own `setTimeout`
callbacks within the watch's AsyncLocalStorage context. It asserts exactly
25/50/100/200/400/800/1000/1000 ms, one pending timer, one request at a time,
and no next request before release. It forces the authority invalidation,
keeps expired replies unpublished, verifies fresh/complete authoritative
recovery, and fires a pending callback after closure to prove it cannot issue
another request. The existing 1,100 ms teardown observation remains.
Omitted `keep` joins false/true; closing a watch remains the false variant,
since a kept watch deliberately lingers. Product retry code is unchanged.

**Journal admission across tabs.** Actual Chromium traces show the admission
broadcast at 1790499158690.0, a journal read returning the previous empty image
at 1790499158690.2, then the admission's localStorage event at
1790499158692.9. The hook did receive the broadcast and did render its read;
localStorage in that renderer had not caught up. Web Locks did not make the
renderer cache update synchronous. Closing the sender removes the later
status writes that could otherwise hide this race.

`journalChanges` now rereads on the matching storage event and on storage
clear, in addition to broadcasts. Both listeners belong to the shared journal
and are removed with its final owner. Event contents never supply intent;
the existing journal reader, lock, viewer checks and durable admission remain
in charge. Hosts without DOM event methods retain the previous path.

The real two-page browser test holds A's storage visibility and storage-event
delivery, lets B's broadcasts cause reads of the old image, closes B on its
committed admission, then releases the storage events. A's mounted hook and
its durable pending list must show the admitted queued ID without a manual
refresh, remount or extra write. Removing only the new product listener fails
**5/5**, each at the existing 30,000 ms wait. One negative run also reproduces
the sibling admission/settlement test's timeout, consistent with the same
missing storage invalidation. Final fixed runs pass both.

**MQ local branch and branch watch.** The fixture manually pins the client
clock, advances the real server by two hours while holding a device reply,
then moves its wall source to the permit deadline. A real probe or a late
stream-end stamp can still sample the advanced server clock. The correct
product clock correction makes the fixture's asserted device instant wrong
by about an hour. A watch catches that test assertion exception and never
publishes the awaited answer, producing the 60-second timeout.

The fixed fixture calibrates both its transport clock and the client fork,
then disables their sampling while it owns the manual boundary. A real probe
and stream-end sample are forced after the server advance and before reply
release. Without the fix, the one-shot clock assertion fails **5/5**, and the
watch hits its unchanged 60,000 ms timeout **5/5**. The exact device instants,
exactly two evaluations, withheld expired branch, server fallback,
fresh/complete answer, retained data and real continuation assertions remain.
No runtime clock method or publication path was changed.

## Changes, file by file

Paths here are relative to `snapback4/` unless stated otherwise.

| File | Final change |
| --- | --- |
| `packages/snapback4/src/journal-changes.ts` | Adds keyed storage-event invalidation and last-owner cleanup, preserving broadcasts and custody; references LLP 3000.019 §3.3. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Documents broadcast-before-storage visibility and authoritative journal rereads. |
| `packages/snapback4/test/expired-server-watch.test.mjs` | Forces sync-before-reply and captures/drives scheduled retry delays; retains recovery/teardown assertions and adds omitted keep cases. |
| `packages/snapback4/test/retained-history.test.mjs` | Owns sampling on both manually pinned fixture clocks; delivers real probe and stream stamps during the held reply. |
| `packages/snapback4/test/react.test.mjs` | Keeps the Vite/Chromium runner and both cross-tab tests; forces delayed storage visibility in the closing-owner case. |
| `packages/snapback4/test/helpers/react-harness.mjs` | Moves the shared React harness and all other cases verbatim from the oversized original file. |
| `packages/snapback4/test/helpers/react-pending-peer.mjs` | Holds the shared journal fixture and same-tab case; adds storage-visibility/event controls for the forced browser race. |
| `../issues/closed/20260927-snapback4-expired-watch-retry-timing-flaky.md` | Cause, resolution, negative controls and loaded proof for both expired-reply signatures. |
| `../issues/closed/20260927-snapback4-retained-branch-clock-flaky.md` | Cause, resolution and loaded proof for the clock assertion and watch timeout. |
| `../issues/closed/20260927-snapback4-react-journal-admission-invalidation-timeout.md` | Copies QE's ticket, preserves its original report and appends the product-race resolution and proof. |
| `../issues/20260927-snapback4-react-usenow-deadline-flaky.md` | Records an additional unrelated intermittent finding, left open without a fix. |
| `reports/20260927-fx-flakes/repeat.py` | Reproducible five-process/CPU-contention evidence driver; not a new gate. |
| `reports/20260927-fx-flakes/controls.py` | Generates negative test copies under target, without editing runtime sources. |
| `reports/20260927-fx-flakes/qualification.json` | Per-run results and log hashes, tool qualification and wasm measurement. |
| `reports/20260927-fx-flakes/REPORT.md` | This report, including limits and the full-suite result. |
| `JOURNAL.md` | One dated append with changes, measurements and exclusions. |

The original React test was 1,594 lines. Its runner is now 170; the shared
harness 1,368; the pending-peer helper 92. No changed source exceeds 1,500 lines.
No diagnostic code or guide example was added.

## Existing forms exercised

No new syntax or API is introduced. These existing forms still compile and run:

```js
client.observe(api.typingIn, { room: 'r' });
client.observe(api.typingIn, { room: 'r' }, { keep: false });
client.observe(api.typingIn, { room: 'r' }, { keep: true });
```

Each keeps an expired response withheld, backs off, recovers to an authoritative
empty answer, and stops on client closure. The false watch also stops on close.

```js
const writes = usePendingWrites();
await client.pendingWrites();
```

The hook and direct durable list agree across B's admission and immediate
closure after A first processes the broadcast against its old storage image.

```js
await client.query({ kind: 'query', name: 'expiryBranch' }, {});
client.observe({ kind: 'query', name: 'expiryBranch' }, {});
```

Both retry an expired local false branch once and route its unknown audit read
to the server. The existing `expiryPage` query retains real continuations.

## Tests and load proof

Node **24.13.1**, Bun **1.3.14**, Rust **1.97.0** on Linux expo-build-1000.
Frozen Bun install passes, with no dependency changes. Package build and
online/pending compatibility pass. The whole guide passes **86/86**, in 3.10 s
of test execution. `online-pending.log` records **55/55** passing tests.
`ref-check --verbose` passes: 517 LLP documents, 9,609 references, zero errors
and zero unchecked. `git diff --check` passes. A byte comparison confirms
the shared React harness and same-tab journal case moved without changes.

All repeated groups run five Node processes at a time. Each process and its
children share cores 0–7 with eight CPU workers. Host load recorded at the
end of the final fixed groups was 34.45, 47.92 and 36.43 respectively.
These are busy-host tests, not timing/performance benchmarks.

| Final affected group | Repetitions | Cases per run | What it proves |
| --- | --- | --- | --- |
| Expired replies (`expired-final`) | **20/20 pass** | 7 | Actual exponential schedule through the cap, no bypass/overlap, no expired publication, recovery and teardown for omitted/false/true keep. |
| Pinned expiry (`retained-pinned`) | **20/20 pass** | 10 | Branch, watch, permit, permit watch and page behavior on wasm and process devices, despite late network clock input. |
| Complete React file (`react-final`) | **20/20 pass** | 46 including parent | Forced cross-tab visibility race plus all existing hook/reference-app lifecycle assertions. |

Every forced negative family fails 5/5: request gaps, starved callback,
branch clock, branch-watch timeout and missing storage listener. Negative
controls are deliberately red, not failures of the final implementation.
The repeat driver records process statuses in JSON; assess those statuses,
not its own exit status, when running negative controls.

From `snapback4/`, after the normal native/wasm/package builds:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
python3 reports/20260927-fx-flakes/controls.py
python3 reports/20260927-fx-flakes/repeat.py expired-final packages/snapback4/test/expired-server-watch.test.mjs 'expired server replies' 20
python3 reports/20260927-fx-flakes/repeat.py retained-pinned packages/snapback4/test/retained-history.test.mjs '^MQ local (branch|permit|page)' 20
python3 reports/20260927-fx-flakes/repeat.py react-final packages/snapback4/test/react.test.mjs 'React hooks' 20
```

Each closed ticket gives its negative-control commands. Raw logs, controls
and per-run JSON remain in `target/lane-fx-evidence/`; the committed
qualification file records final run statuses and log digests.

## Decisions, deviations and remaining work

- The request-gap suspicion was refined: an actual authority invalidation
  produces an unpaced request. It is not evidence that the product chose a
  shorter expiry backoff. The tests now distinguish them by scheduled timers.
- The historical paced-timeout host schedule was not recoverable. A deliberately
  held timer supplies a deterministic counterexample; no claim is made that
  KG's exact host schedule has been recovered.
- The first clock-fixture fix stripped response headers. It failed 1/20 stress
  runs because already delivered stream bodies sample later. The final fix
  controls both clocks' sampling boundary and passes 20/20. The failed
  intermediate run is preserved as `retained-fixed-12.log`.
- A minimal window object used by non-DOM tests prompted feature detection
  for event methods. The 55 online/pending tests and final 20 React runs
  qualify the final source.
- The supplied `llp-orient` skill is absent from this checkout's skills,
  vendor and installed skill paths. Orientation was manual: Snapback 4's
  AGENTS/NOT-DOING fence, LLP 3000/2000.000, Accepted 3000.021, 3000.019 §3.3,
  current client operations text, the FK fix, and the three lane reports.
  No new design was substituted for the accepted one.
- The complete first package build was attempted before the fresh wasm
  artifacts existed, and failed with missing wasm module declarations; an
  initial React attempt likewise could not load that module. Those were
  lane setup-order errors, fixed by native/wasm build followed by package build.
  They are not baseline or final-suite failures.
- Additional finding: the unchanged `useNow hides a server-answered row at
  its deadline and after a clock advance` case intermittently reports
  `clock advance repaints without another row answer: "bob"`. It was seen in
  baseline journal-tracing/control runs, then passed in all 20 final React
  runs. Its separate open ticket gives the stress reproduction attempt.
  The cause is unconfirmed; it is not labelled an environmental failure.
  It is outside this lane's assignment and remains unfixed.

No assigned open problem remains. The additional useNow issue remains open.
No timeouts, leases, backoff caps, wasm budget or engine resource ceilings were
raised. No assertion was removed to hide a failure. The only product change
is journal invalidation; browser storage and broadcasts remain notifications,
not sources of trusted intent. No analysis tool was installed in a shared path.

## Full-suite and artifact qualification

The wasm built before changes and again by the full suite is **1,981,512 B
raw / 572,053 B gzip**, under the unchanged **572,841 B** ceiling (788 B
headroom). Runtime Rust is unchanged: device-code delta **0 B**. The
qualification file records the built artifact's SHA-256. No historical
cross-host byte comparison is used.

Exact `scripts/test.sh` summary: **`== 0 failure(s) in 1436 s`**, exit **0**.
It ran once, with `CARGO_BUILD_JOBS=8`, dev/test debug information disabled,
`CARGO_INCREMENTAL=0`, the pinned tools on PATH and file limit 65,536.

- Rust: **3,818 passed / 24 existing ignored**, 942 s.
- Main client file set: **2,635 passed / 10 existing skipped**; additional
  acquisition/server shards: **56/56 passed**. Client phase: 198 s.
- Seeded client models: **78/78 passed**, 260 s.
- Fixture wrappers: **9/9 passed**. Native/wasm builds, docs budget, release
  guard, package typecheck/build and both application typechecks passed.
- Every assigned regression passed in this full run. The additional useNow
  case passed too. **No lane-owned, baseline or environmental full-suite
  failure**, and no additional intermittency observed in this invocation.

The inherited 60-second suite budget is exceeded; no limit or deadline was
raised. The final suite log and exit record remain in
`target/lane-fx-evidence/full-suite.log` and `full-suite.exit`; their digests
and the exact result are recorded in `qualification.json`.
