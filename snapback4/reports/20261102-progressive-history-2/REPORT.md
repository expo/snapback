# 2026-11-02 — Progressive history, chunk 2

Implemented the TypeScript client seam on `sb4/progressive-history`, left uncommitted for the supervisor. No agents, clones, remote commands, other checkouts, commits, stashes, restores, rebases or pushes. No Rust, contract, budget, README or JOURNAL edits.

**The strict “inbox first, foreground group next” ordering remains unqualified on a server with historical membership joins.** Ordinary replay expands those joins into current group images and floors, as the inherited server already does. The client preserves that authority/stream behavior. The natural-log witness records it; the isolated partial-publication witnesses use an explicitly synthetic quiescent baseline. This limitation needs the server-seam owner’s decision, not a hidden client-side filtering rule.

The supervisor amendment withdrew the wasm rebuild. This resumed attempt used the existing artifact and did not run `scripts/build-wasm.sh`. Its inherited measurement remains **746,060 B gzip**, **7,056 B over** the 739,004 B budget; those figures are the first attempt’s result, not a new measurement or publication claim. That attempt is preserved in [REPORT-WASM-FIRST-ATTEMPT.md](REPORT-WASM-FIRST-ATTEMPT.md), [COMMANDS.json](COMMANDS.json), and [wasm-build-summary.log](wasm-build-summary.log).

## Changed files

Paths below are relative to `snapback4/`.

| File:line | Change |
| --- | --- |
| `packages/snapback4/src/local-acquisition.ts:24` | Detect the additive device protocol fields. Both device support and the server advertisement are required. |
| `packages/snapback4/src/local-acquisition.ts:34` | Derive conservative foreground hints from the compiled returned Scan, horizon index, audience columns and scalar argument/literal pins, including argument aliases. Counts, branches, unsupported shapes and native programs produce no hint. |
| `packages/snapback4/src/local-acquisition.ts:80` | Schedule one acquisition unit and ordinary catch-up through the existing loop; resume the durable cursor, drain pending publication, keep a bounded 32-group volatile skip list, and take staged replacement when required or when a partial store reopens against an older server. |
| `packages/snapback4/src/local.ts:209` | Keep the server’s compatibility advertisement; refresh it after an offline reopen before selecting a request kind. |
| `packages/snapback4/src/local.ts:310` | Connect the scheduler and published progress; reset scheduling on incarnation changes. |
| `packages/snapback4/src/local.ts:770` | Add negotiated acquisition requests alongside the unchanged legacy request fields, overflow handling and staged snapshot/catch-up paths. |
| `packages/snapback4/src/local.ts:913` | Admit partial local reads after durable publication and update usable progress at every publication, even if the next network request fails. |
| `packages/snapback4/src/local.ts:931` | Release the existing network queue between acquisition turns. Pending background work keeps the existing follow loop running while ordinary caught-up/freshness semantics remain separate. |
| `packages/snapback4/src/local.ts:1517` | Let headless one-shot reads supply a one-turn hint. Mounted observation hints are selected from the existing watch registry, coalesced, and omit lingering/unmounted observations. |
| `packages/snapback4/src/acquisition.ts:10` | Add immutable `usable: { tables, groups }` and populate it from published sync state, including reopen and revocation. Received acquisition images remain row counts, not coverage. Deferred acquisition images do not advance UI counts until publication. |
| `packages/snapback4/src/device-version.ts:5` | Add optional `DeviceCompatibility.advertised` typing. |
| `packages/snapback4/src/react.tsx:505` | The existing `useSyncExternalStore` subscription returns the additive acquisition type; no new hook/priority API. |
| `packages/snapback4/test/progressive-acquisition.test.mjs:1` and `packages/snapback4/test/helpers/progressive-acquisition.mjs:1` | Real HTTP server plus process and wasm/memory device witnesses, scheduler/progress checks and explicit browser skip. |
| `packages/snapback4/test/acquisition.test.mjs:109` | Keep this existing atomic-snapshot suite on its legacy protocol fixture by withholding the new optional advertisement. Its snapshot/interruption assertions remain intact. The new suite covers the negotiated path. |
| `crates/snapback4-lang/src/guide/api_react_full.md:53` | The single forced generated guide update: include the new `Acquisition.usable` type. `guide-api.mjs --check` first failed with `Error: guide api react --full drift`; regeneration and the check then passed. No narrative guide edits. |

`local.ts` grew **26 lines**, from **2,045 to 2,071**, under the explicit inherited-file exception. The new scheduler is 130 lines; every other new/changed source is below 1,500 lines. Evidence logs over the limit were split losslessly; the plan JSON was compacted. `contract.ts` and `metrics/wasm-budget.json` have no diff.

## Integration choices and constraints

Applied the read-only `llp-orient` workflow to the client seam. Governing context: [RFC revision 1, §§4–9](../../../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md), [parent Repairs A/B](../../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), the [handshake RFC](../../../llp/3000.001.000-device-engine-handshake.rfc.md), Snapback 4’s root/instructions/exclusions and the current sync guide. No new LLP, acceptance status, coverage certificate or design protocol was introduced. References use the repository checker’s actual subsection slugs, such as `#61-the-acquisition-page`.

- **One applied watermark.** Requests use the existing captured ordinary/transfer position; acquisition does not introduce another applied cut. The cursor, exhaustion, whole-table facts and floors remain device-owned.
- **Both peers opt in.** No `acquire` field is sent unless the server advertises `progressive-acquisition-v1` and the device exposes the cursor/exhaustion/table/group/replacement fields. Old servers and old devices use staged snapshots. A partial upgraded store reopening against an old server also takes a staged replacement.
- **Pending publication before further acquisition.** The existing `adoption_capture["device:deferred:cursor"]` already exposes slot presence, including a deferred acquisition at exactly the published watermark. This avoids guessing from `transfer_watermark > watermark`. Consequently no new Rust wire field or process build was necessary for the client feature. The affected runner did rebuild the CLI as its existing prerequisite.
- **One network owner.** Each progressive turn serves at most one acquisition unit, then drains ordinary pages. Queued POSTs run before the next unit; receipt observation can itself request another normal turn. The existing follow loop continues background work. No additional dispatcher, parallel acquisition pipeline or timer tree.
- **Hints are scheduling only.** `dependencies()` provides table/field footprints, not argument extraction. The existing compiled program body provides enough information for the supported direct page shape, so no language/emitter change was needed. Hints are re-evaluated at page boundaries. A 32-entry volatile skip set avoids repeat downloads within the current window; reopening or eviction may re-serve a group idempotently.
- **Readiness meanings stay separate.** Only device exhaustion plus ordinary catch-up can make `acquired` true. Prediction still uses the existing global gate. `useLocalStatus` remains syncing before full acquisition; `usable` is coverage counts, while `rows/tables` remain received acquisition-image counts. Ordinary read freshness is not held false merely because background acquisition is unfinished.
- **Existing fences remain.** Store/identity/send-revision checks, Repair B application, query publication fences, overflow reduction, staged replacement and restore refusal keep their existing paths. No server-named floor is inferred from counts.

## Witnesses and the code/RFC disagreement

The helper’s default partial-state fixture seeds a real persistent server, then removes its **initial seed log only**, before attaching any device, while retaining the actual server head and row image. New mutations use the real ordinary log. This synthetic baseline isolates the RFC’s partially downloaded states. It is **not** evidence that a natural account’s historical membership log respects the proposed priority order.

A separate witness on each adapter leaves the seed log **unmodified**. It observes five message-group floors before the tier-1 walk ends, then checks completion/convergence. This is inherited `expand_joins` behavior. Filtering it in the client would change authority/publication behavior outside this chunk; it was deliberately not done.

| Contract / RFC case | Witness |
| --- | --- |
| §3.1, online answer during acquisition | Hold the first ordinary drain in flight while the device is incomplete; an ordinary history query renders its real server answer. Its local result remains unknown. |
| §3.2 / §10.1 case 1 | Tier-1 inbox is complete locally after offline process/memory reopen, while all history is unknown and acquired is false. |
| §3.3–4 / case 2 | Hint group C ahead of A/B, publish its suffix, disconnect and reopen. C is complete and stale; B is unknown/incomplete; cursor and usable counts survive; acquired remains false. |
| §3.5 | Page through timestamp ties to and past the floor; offline result is incomplete. Online older-page fallback returns the server’s older rows without persisting them into the replica. |
| §3.6 | Unacquired domains remain unknown; missing existence and whole-history scalar count never become fabricated answers. A valid found point row remains readable. |
| Case 5 excerpt | Until-revoked removes rows/floor and decreases usable groups. Delivered-history preserves the stale published suffix/floor, so its device-reported usable count remains one. Reopen preserves each policy. |
| Case 8 excerpt | While an acquisition request is held in flight, a send is durably queued without prediction. Its POST precedes the next acquisition unit and it settles before exhaustion. Direct prediction is refused with `E_PREDICT`. |
| Case 9 | Foreground hints change repeatedly while real mutations arrive after acquisition publications. Duplicates coalesce; closed observations stop supplying hints; hinted groups are served once or skipped; the walk exhausts. One sync request in flight. |
| Negotiation / case 11 excerpt | Fetch spies on both adapters verify zero `acquire` requests to an old server or from an old-device-shaped state; legacy snapshots finish. Partial-store downgrade also finishes through staged replacement. |
| Deferred publication / progress | Scheduler checks the same-watermark deferred slot and resumes its published cursor only after ordinary drain. Progress checks exclude unpublished row images and use only published usable facts. This is a scheduling/progress unit witness, not a new Repair B persistence-failure campaign. |

The pre-existing device’s legacy terminal ordinary-page acquisition behavior also differs from RFC §2’s snapshot-only description, as chunk 1b already reported. Selection happens before that cold ordinary path. The RFC’s “scope withdraws the floor” summary is retention-dependent in code: delivered-history preserves its published floor; the UI follows the device’s count.

## Validation

All Cargo/Bun commands ran from `snapback4/`; Node used Volta **v24.18.0**. See [COMMANDS-RESUMED.json](COMMANDS-RESUMED.json) for every resumed-session shell invocation, cwd, observed exit, verbatim summary lines and log mapping. Inspection commands without an independent summary are explicitly identified. [LOGS.json](LOGS.json) maps split logs and hashes their original bytes. The first-attempt ledger is separate.

**Final product checks**

- New progressive suite: **22 passed, 0 failed, 1 skipped (browser), exit 0**; [progressive-complete.log](progressive-complete.log).
- Existing atomic acquisition suite: **47 passed, 0 failed**, exit 0; [acquisition-2.log](acquisition-2.log).
- `progressive-start.test.mjs` plus `retained-history-order.test.mjs`: **89 passed, 0 failed**, exit 0; [start-order-final.log](start-order-final.log).
- `bun run --cwd packages/snapback4 typecheck`: exit 0; exact output `$ tsc -p tsconfig.json --noEmit`.
- Client TypeScript/package build: exit 0; copied the existing wasm artifact, did not rebuild it.
- Generated guide API check: exit 0 after the forced type update.
- `ref-check --verbose`: `ref-check: ok — 583 LLP docs, 12972 refs in 51337 files, 0 errors, 0 unchecked`.
- `git diff --check`: exit 0, no diagnostics.

**Requested history commands that could not execute their tests**

The combined required invocation of `ordinary-history.test.mjs`, `retained-history*.test.mjs` and `progressive-start.test.mjs` exited 1: **89 passed; 3 failed file entries**. The three failing files are `ordinary-history.test.mjs`, `retained-history-cut.test.mjs`, and `retained-history.test.mjs`. Each failed during harness import, before its product tests ran:

```text
Error: TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM
```

See [history-start-2.log](history-start-2.log). This is a sandbox process-inspection failure, not a loopback-bind failure. No loopback failure occurred in the completed suites, so no loopback retry was needed.

**Required affected command**

Invoked with Volta on PATH and `NODE_OPTIONS=--require=.../affected-stop-before-wasm.cjs`:

```sh
node scripts/affected.mjs --base origin/main --worktree --run
```

The [guard](affected-stop-before-wasm.cjs) exits the runner immediately before its mandatory wasm step, honoring the supervisor’s explicit prohibition. It does not fake a successful step or launch the later browser suites. **Exit 125; incomplete; no affected-gate pass.**

Verbatim summary:

```text
# 32 commands, 7 whole Rust packages, 490 client files; broad=true
Checked 649 installs across 627 packages (no changes) [114.00ms]
    Finished `dev` profile [unoptimized] target(s) in 17.96s
STOP: build-wasm not run (supervisor amendment); affected run incomplete.
```

Logs: [part 1](affected.part-01.log), [part 2](affected.part-02.log). The runner’s repo-root receipt is `target/affected/403cf74696c2-1793624818781.json`: `complete:false`, successful install-client and build-cli only. No source outside the requested fence was edited. This run predates the final added online-fallback test; it is not qualification of the final tree.

**Earlier reds retained**

Initial tests exposed delayed usable notifications and historical join expansion; the former was fixed, the latter is documented above. Test corrections included the persistent-server fixture path, allowing an honestly incomplete unknown page, delivered-history’s preserved floor, and distinguishing durable receipt availability, POST dispatch and the later `onWrite` notification. The old snapshot suite now explicitly negotiates its intended legacy path. Interrupted exploratory runs and all emitted failure summaries remain in the ledger/logs; none is counted as a pass. One command named nonexistent `retained-history-races.test.mjs`; Node ran the matching startup file only. The actual order suite was subsequently run and passed.

## Not run and open work

- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**. The new suite explicitly skips the browser witness. Memory persistence reopening and native process reopening passed; real IndexedDB/browser restart and React rendering need supervisor validation.
- Another wasm build/measurement: **not run (supervisor amendment)**. The artifact’s inherited budget overrun remains the supervisor’s decision. No budget or artifact reduction work was attempted.
- The three harness-blocked history suites and the affected runner’s remainder need the supervisor’s environment. No complete battery, heavy-account timing/heap/byte qualification, remote host or packed publication run.
- The strict natural-log priority limitation needs a server-seam decision before claiming the RFC’s performance/order promise. This chunk proves the client’s ordering of acquisition requests and truthful partial publication, not suppression of historical ordinary join expansions.
- Skip metadata is volatile and bounded at 32. A restart or larger rotating foreground set can cause idempotent duplicate transfer, as permitted by §6.2; no timing/duplicate-byte benchmark is claimed.
- No new Rust correctness defect remains identified by this client chunk. No changed `SyncState` field or wasm/process mismatch was introduced.

Chunk 2 STOP. The supervisor owns the commit, excluded verification, budget decision, and any subsequent server or qualification work.
