# Lane S1 — LLP 0307.000 Acceptance 1 execution record, second attempt (2026-08-24/25)

Worktree: `/Users/ccheever/projects/snapback/.claude/worktrees/sbs0824-s1-replay`
HEAD: `b57a7ca47cf87418a984ef86d23a872d4568e2a8` (docs commit atop `80c8e3caf`,
the LLP 0307.000 landing), tree clean apart from untracked scratch/report files.
Nothing committed or pushed. Prior attempt's record (defects now fixed):
`laneS1-100k-proof.md` in this same scratchpad.

## Verdict

**PASS — both custody modes.** The full packed proof
(`scripts/prove-packed-headless-replay-100k.mjs`) ran end to end against
the packed consumer install: 100,000 actions × 8 personas × both custody
modes (`minted` then `none`), 200,000 protocol-v1 mutations total,
settle-before-next, and emitted its terminal
`snapback.packed-headless-replay-proof.v1` document with every embedded
assertion satisfied. Peak consumer RSS 302,497,792 bytes (288.5 MiB) —
56.3% of the fixed 512 MiB budget. Zero failures, zero refusals, zero
duplicate-possible, zero live-query registrations. Total proof wall
**3 h 41 m 36 s** (01:20:04Z → 05:01:40Z, 2026-08-25).

## Preparation (all verified before launch)

1. **Binary re-qualification.** The worktree binary predated the rebase
   (stamp `d467c46dc` dirty; receipt byte-stale; 19 Rust files of delta to
   HEAD including `crates/snapback-types/src/manifest/types.rs`, the
   server-side ack-auth fix). Ran `scripts/bootstrap-ibex-runtime`
   (SNAPBACK_IBEX_CHECKOUT=/Users/ccheever/projects/ibex): exact link +
   launch + restricted-no-eval handler-VM qualification passed,
   `SNAPBACK_IBEX_RUNTIME_LINK_OK`. Fresh receipt
   `target/debug/snapback.runtime-readiness.json` issued
   2026-08-25T01:17:16Z, binds sha256 of the 527,866,568-byte binary,
   stamp `gitCommit b57a7ca47…, gitDirty false, debug`. Verified sha match.
2. **Fix confirmations on this tree (the three prior blockers):**
   - Defect 1 (packed install): `scripts/prove-packed-headless-replay-100k.mjs`
     now stages each package and rewrites `workspace:|file:|link:` ranges to
     concrete internal versions before `npm pack` (script lines 61–104).
     Confirmed empirically: all six tarballs packed and the bare consumer
     `npm install` succeeded (see Execution).
   - Defect 2 (mint `--json`): `packages/snapback-acceptance/replay.mjs`
     `mintSession` (line 949–995) now spawns
     `snapback session mint --email … --ready-file …` with no `--json`,
     parses the native hostOpsResult envelope, and injects
     `SNAPBACK_ADMIN_TOKEN` read from `ready.adminTokenFile` itself.
   - Defect 3 (ack 400 in sessions mode): `MutationAcknowledgementRequest.auth`
     is no longer a required field server-side (part of the +6 delta in
     `crates/snapback-types/src/manifest/types.rs` landed in 80c8e3caf).
     Proven live by the run reaching far past the first ack window with
     `acknowledged` climbing (prior attempt died at 121/200 settled).
   - Defect 4 (duplicate terminal on ack failure): ack flushing is now
     outside the mutation/refusal catch (replay.mjs:1837–1843 comment and
     structure), with fingerprint-composed ack windows
     (`addOutstanding`/`maybeAcknowledge`, replay.mjs:1614–1646).
3. **Fixture backend** (unchanged from prior attempt, in-worktree at
   `packages/snapback-cli/.s1-replay-scratch/`): `rows` table
   (public-read, indexed, `.sync()`), sessions auth mode with the
   todo-contract password program; `apply` as JS-tier `defineJsMutation`
   (auth 'authenticated', inserts one row). Re-ran codegen with the rebased
   packages: ok, 1 known non-blocking `declare-explicit-write-authority`
   warning; confirmed `generated/api.mjs` has **0** occurrences of
   `mutationIr` (v1 replay refuses generated-IR mutations, replay.mjs:1734).
4. **Action log integrity re-verified:** `actions-100k.jsonl` = exactly
   100,000 actions, contiguous seq 0–99999, 8 personas (persona-0..7), all
   `fn:"apply"`, `intent:"intent-<seq>"`.
5. **Server:** fresh database directory `.s1-replay-scratch/proof-db/`
   (fresh DB avoids retained-mutation and lock-state carryover from the
   prior attempt's pilot). Booted detached:
   `SNAPBACK_RUNTIME_BINARY=$WT/target/debug/snapback node
   packages/snapback-cli/cli.mjs dev $S/app/snapback --db
   $S/proof-db/proof.sqlite3 --ready-file $S/proof-db/proof.ready.json
   --port 49417 --json` (port verified free first). Supervisor pid 6021,
   server pid 6671, `SNAPBACK_RUNTIME_LAUNCH_OK` on the receipt-bound
   worktree binary, serverUrl `http://127.0.0.1:49417`.
6. **Pre-flight mint:** real `snapback session mint` against the proof
   server returned `ok true`, bearer `sbs_…`, userId minted. (One throwaway
   `preflight@replay.invalid` session exists in the proof DB.)

### Environmental note: stale reservation lock (not a product defect for this run)

First boot attempt with the DB directly in `.s1-replay-scratch/` failed:
`SNAPBACK_DEV_SERVER_START_FAILED` wrapping
`Error: database target could not be reserved and pinned before startup:
target-instance reservation must be one owner-only regular-file link`
(`crates/snapback-kernel/src/instance_lock.rs:938`,
`validate_target_reservation_file`). Cause: the prior session's binary left
`packages/snapback-cli/.s1-replay-scratch.snapback.restore.lock` with mode
0644; the landed kernel requires an existing reservation entry to be mode
0600/nlink 1/owner-euid and opens it without mutation
(instance_lock.rs:440–477). Worked around environmentally by hosting the
proof DB in a fresh subdirectory (its reservation lock is created fresh at
0600). Observation worth a ticket (not filed from this lane): a
pre-rework lock file at 0644 makes the landed binary refuse the instance
with a bare stderr line rather than a coded recovery hint.

## Execution

- Proof command (launched 2026-08-25T01:20:04Z, detached, pid 11220):

  ```
  SNAPBACK_RUNTIME_BINARY=$WT/target/debug/snapback SNAPBACK_KEEP_PACKED_REPLAY_SCRATCH=1 \
  node scripts/prove-packed-headless-replay-100k.mjs \
    --ready-file $S/proof-db/proof.ready.json \
    --api $S/app/snapback/generated/api.mjs \
    --actions $S/actions-100k.jsonl \
    --backend-dir $S/app/snapback
  ```

  (`$WT` = worktree, `$S` = `$WT/packages/snapback-cli/.s1-replay-scratch`;
  RSS budget left at the script's fixed default 512 MiB.)
- Script scratch (preserved): `/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-packed-replay-100k-SWz1b2`
- Packed install: all six workspace tarballs
  (`expo-snapback-{contract,client,codegen,react,acceptance,cli}-0.1.0.tgz`)
  packed and installed into the bare consumer — the step that had never
  succeeded before this tree.
- The consumer runner drives both custody modes itself, in order
  `minted` → `none` (script-embedded run-proof.mjs), settle-before-next,
  pool configured 8, ack windows count=256 / bytes=2MiB
  (fingerprint-composed), checkpoint cadence 1000ms.
- Custody `minted` replay started ~01:20:2xZ; 334/100,000 settled by
  01:20:29Z.

## Result

### Custody `minted` leg — COMPLETE, clean

- Final status (`consumer/minted-status.json`):
  `state "complete", settled 100000, failed 0, total 100000, lastSeq 99999,
  diagnostic null` (updatedAt 1787627462185 = 03:11:02Z).
- Wall: replay loop start ≈01:20:22Z → complete 03:11:02Z ≈ **110.7 min**
  (~66.4 ms/action sustained; window rates 12.6–18.6 actions/s on this
  debug binary, settle-before-next).
- WAL audit (`minted-receipts.jsonl`, 52.8 MB, mode 0600): exactly
  100,000 `snapback.replay-dispatch.v1` + 100,000
  `snapback.replay-terminal.v1` all `outcome:"settled"` (0 refused, 0
  duplicates) + 6,256 `snapback.replay-ack.v1` records whose `through`
  arrays cover exactly **100,000 acked transport ids** — every retained
  mutation drained; flush cardinality ≈100000/16 matches the 2 MiB
  fingerprint byte-window with ~131 KiB retained charge per settle.
- Runner RSS trajectory (sampled ~every 15 min): 165 MiB @1.8k → 287 MiB
  @16.7k → 253 @31.6k → 245 @44.9k → 228 @56.3k → 235 @68.1k → 232 @80.8k
  → 236 @95.8k — oscillating in a ~225–295 MiB band, no monotonic growth;
  never approached the 512 MiB budget during this leg.
- Session custody sidecar (`minted-receipts.jsonl.sessions.json`, 0600):
  8 personas minted once each via real `snapback session mint`.

### Custody `none` leg — COMPLETE, clean

- Final status (`consumer/none-status.json`):
  `state "complete", settled 100000, failed 0, total 100000, lastSeq 99999,
  diagnostic null` (updatedAt 1787634088816 = 05:01:28.8Z).
- Wall: leg start ≈03:11:05Z → complete 05:01:28.8Z ≈ **110.4 min**
  (~66.2 ms/action sustained — statistically identical to the minted leg;
  the ack overhead is amortized into noise at this insert size).
- WAL audit (`none-receipts.jsonl`, 43.8 MB, mode 0600): exactly 100,000
  `snapback.replay-dispatch.v1` records, **all** `custody:"none"` with
  `transportId:null`, + 100,000 `snapback.replay-terminal.v1` all
  `outcome:"settled"` (0 refused, 0 duplicates), **0** ack records — the
  exact raw at-most-once shape (no clientMutationId, no retention, no
  drain).
- Runner RSS during the leg: 241–256 MiB band, steady.
- Sessions sidecar (`none-receipts.jsonl.sessions.json`, 0600): 8 personas
  minted once (personas authenticate via bearers regardless of transport
  custody; only the mutation transport identity differs).

### Terminal proof document (verbatim, from the proof process stdout)

```
{"schemaVersion":"snapback.packed-headless-replay-proof.v1","actions":100000,"personas":8,"custodyPolicies":["minted","none"],"peakRss":302497792,"rssBudgetBytes":536870912,"receiptDigest":"bed288a1d7f79c6389030f0d8bf071461e91ab0d9984a76a241bc5b469f70929","liveQueryRegistrations":0,"liveQueryRegistrationObservation":"runtime-fetch-boundary","receipts":[{"status":"passed","custody":{"default":"minted","duplicatePossible":0},"pool":{"configured":8,"maximumObserved":8},"acknowledgement":{"countWindow":256,"byteWindow":2097152,"acknowledged":100000,"retainedRowOverheadBytes":131072}},{"status":"passed","custody":{"default":"none","duplicatePossible":0},"pool":{"configured":8,"maximumObserved":8},"acknowledgement":{"countWindow":256,"byteWindow":2097152,"acknowledged":0,"retainedRowOverheadBytes":131072}}]}
```

Followed by `packed replay scratch preserved at
/private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-packed-replay-100k-SWz1b2`.

### Terminal assertions (what the consumer runner enforced, all satisfied)

The proof document is only written after every assertion in the
script-embedded `run-proof.mjs` passes; any failure raises before the
final write and `execFileSync` in the parent would have propagated a
stack into `s1-proof.log` (none present — the log holds exactly the
document plus the preserved-scratch line, and the process is gone; exit 0
by construction of the success path). Assertions, with observed values:

1. Action count ≥ 100,000 → 100,000; personas ≥ 8 → 8.
2. Packed `@expo/snapback-acceptance/replay.mjs` source contains no
   `.subscribeLive(` / `.liveQuery(` path → confirmed on the installed
   tarball copy.
3. Per custody leg: `runCli` exit code 0; exactly one JSON receipt
   document on stdout; `receipt.actions.settled === 100000`;
   `pool.maximumObserved (8) <= pool.configured (8)`; diagnostic is not
   `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` (diagnostic was null —
   status "passed" both legs).
4. `peakRss 302,497,792 <= 536,870,912` (25 ms sampling cadence across
   BOTH legs).
5. `liveQueryRegistrations === 0` observed at the runtime fetch boundary
   (every fetch URL tested against `/live/*/subscribe`).
6. `receiptDigest` = sha256 over both full receipts =
   `bed288a1d7f79c6389030f0d8bf071461e91ab0d9984a76a241bc5b469f70929`.

(Note: the script has no per-table digest check; the per-leg WAL audits
above are this record's independent corroboration, performed by the lane
over the preserved scratch.)

### Wall-time summary

| Leg | Start (UTC) | End (UTC) | Wall | ms/action |
|---|---|---|---|---|
| pack + packed `npm install` | 01:20:04 | ≈01:20:20 | ≈16 s | — |
| custody `minted` (100k) | ≈01:20:22 | 03:11:02 | 110.7 min | ≈66.4 |
| custody `none` (100k) | ≈03:11:05 | 05:01:29 | 110.4 min | ≈66.2 |
| proof process total | 01:20:04 | 05:01:40 | **3 h 41 m 36 s** | — |

Both-leg sustained throughput ≈15.1 settled mutations/s on the worktree
debug binary over loopback, settle-before-next, JS-handler mutation with
engine WAL fsync per action.

## SNAPBACK_* diagnostics observed

None in either leg (`diagnostic: null` in both final statuses and both
receipts; zero refused terminals in 200,000). The only coded event of the
session was the pre-run environmental
`SNAPBACK_DEV_SERVER_START_FAILED` (stale 0644 reservation lock, see
Preparation note), resolved by fresh `proof-db/` placement, plus the
expected `SNAPBACK_RUNTIME_LAUNCH_OK` / `SNAPBACK_IBEX_RUNTIME_LINK_OK`
on boot/bootstrap.

## Teardown

- Proof process 11220: exited on its own at 05:01:40Z.
- Dev supervisor 6021 and server 6671 (identities verified against the
  exact command lines this session launched): TERM'd, confirmed down;
  port 49417 confirmed listener-free afterward.
- No other processes were signaled at any point. Other worktrees' snapback
  processes (impl-0301-a etc.) observed at session start were left
  untouched.
- Preserved evidence: proof scratch
  `/private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-packed-replay-100k-SWz1b2`
  (consumer node_modules from the six packed tarballs, both WALs, both
  final statuses, run-proof.mjs); proof stdout `s1-proof.log`, server log
  `s1-dev-server.log`, bootstrap log `s1-bootstrap.log` in this
  scratchpad; fixture + logs + proof DB in the worktree scratch
  `packages/snapback-cli/.s1-replay-scratch/` (proof DB retains the
  200,000 inserted rows + 17 minted sessions: 8 minted-leg + 8 none-leg +
  1 pre-flight).

## Acceptance 1 claim support

This run supports LLP 0307.000 Acceptance 1 as specified: the packed
consumer (tarball-installed `@expo/snapback-cli` + closure, no workspace
resolution) replayed ≥100,000 actions across ≥8 personas under BOTH
transport custody modes with settle-before-next, zero failures, bounded
memory (peak 288.5 MiB vs 512 MiB fixed budget), zero live-query
registrations, and a receipt digest binding both receipts —
`snapback.packed-headless-replay-proof.v1` document above. Evidence is
scoped to worktree HEAD `b57a7ca47` (clean) with the digest-bound
runtime-readiness receipt of 2026-08-25T01:17:16Z; any capability claim
still carries the LLP 0189 D-6 battery reference per repo policy.
