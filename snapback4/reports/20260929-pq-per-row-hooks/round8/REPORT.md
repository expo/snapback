# PQ round 8 — retry progress and guide integration

Merged origin/main `398552255dab53ad9aa2e347f47bded11d65aad0` into
`sb4-intent/pq2-per-row-hooks`, starting at round 7
`62e5ec73ace7c9704313c1f13918823a81b21935`. AG and AQ are included. The
pre-qualification and final follow-up fetches found the same main. Nothing is pushed or
published. Read every prior round prompt/report and both full round-7 reviews;
review copies are `input-astra-round7.md` and `input-grok-round7.md`.
Those reviews assess round 7, not this revision.

## Changes

- **Merge conflicts:** only JOURNAL.md and the client card conflicted. Every
  complete journal entry from both parents is preserved unchanged (1,029 PQ
  chunks and 1,030 main chunks; `journal-preservation.json`). Keep PQ's whole
  Queries in rows section. Replace AQ's acquisition section with a pointer to
  the existing sync recipe, measurements, estimates, progress and Worker/default
  choices. The sync card already contains those facts; add the retained-fixture
  versus slower-Mac caveat explicitly there. Client card: **129/130 lines**.
- **Grok Medium:** a local result rejected by `answers.current` now marks its
  watch dirty and returns through paced retry. The backoff counter resets only
  after eligibility succeeds; rejected reads back off 25/50/100 ms up to the
  existing one-second cap, outside active slots. When sync clears a pending cut,
  even a watch disjoint from its real footprint can replace its answer. Pending
  cuts, publication fences and episode deadlines are unchanged. The bare return
  is also present on main at this merge parent.
- **Grok Low:** an already-due online result leaves `ReadObservation.fetch`'s
  acceptance loop before exhausting its sequence retries. Final eligibility
  sends it through `ReadWork.retry` at the existing 25 ms pace, independently
  of answer identity or whether the watch is loading. It installs no deadline
  from the rejected body and never publishes that body. Existing floor and
  reset/cancellation checks still apply.

Updated existing LLP 3000.023 §10. No public type, retention-policy, Rust runtime,
engine, meter, queue capacity, attempt lifetime or size-cap change. local.ts is
still **1,500 lines**. The online acceptance callback changes one existing
await fingerprint: **58 client.ts awaits, 158 classified delivery sites** remain.

## Detecting evidence

`per-row-progress.test.mjs` adds 12 cases. Six use real process/wasm devices and
all three keep policies: profile reads replicated profiles; item reads messages;
`{ seq: N }` omits tables; sync is held while old locally complete reads are
rejected, then publishes only messages. Profile must settle with Bob and remain
ready after its original episode would have expired. The test records actual
apply footprints and retry delays. The held change stream sends heartbeat bytes,
so an unrelated watchdog/reconnect cannot repair a stranded watch.

Six online cases start cold or warm, under every keep policy. Five replies carry
an already-past nextExpiry; a sixth is current, with no notification or refresh
interval to restart reads. Only the sixth publishes. Each expired reply schedules
one 25 ms retry. Warm cases explicitly start plain revalidation through the
captured production attempt, retaining the same answer identity.

Final new cases: **12/12** (`retry-heartbeat.log.gz`). Restoring only the two
round-7 runtime modules in an isolated worktree-local SDK copy fails **12/12**
at the intended recovery assertions (`retry-control-qualified.log.gz`). Qualified
source and built artifacts were not mutated. Earlier fixture corrections and
all intentional controls remain in `FAILURES.md`.

## Verification

Affected run: **881/882** (`affected.log.gz`), with one stale await hash, ours.
After its reviewed update, the full delivery matrix passes **317/317**
(`delivery-final.log.gz`). All other then-present affected tests pass, including the per-row
and answers-stay files, raw deadlines, expiry retries, clocks and retention units.
Final diff review caught a filename collision: the new cases had replaced the
existing 15-case per-row-retry.test.mjs. Restored that file byte-for-byte from
round 7 and moved the new cases to per-row-progress.test.mjs. The broad and full
runs omitted those 15 original cases; their final qualification is the separate
restored-file follow-up described below. Historical logs retain the collided name.
The final fixture-only heartbeat refinement passes its whole 12-case file.
Runtime source was complete before the full suite began. The new fixture and
await-record corrections finished during its Rust phase. The old store-order
expectation described below was corrected after its client phase.

RL schedule model: **300 process seeds and 300 wasm seeds**, zero failed seeds
or cancellations, plus the independent negative-reference test. See
`schedule.log.gz` and `schedule-results.json`. Process: 229.791 s; wasm: 159.511 s,
within the unchanged 240-second per-host timeout.

Whole guide: **99/99**, including the 130-line client budget. `guide-consumers.txt`
records every `guide::card(` site under crates/. `guide-commands.json` identifies
all 28 owning integration targets across CLI, language, simulator and device;
the CLI targets also exercise the production card dispatchers. All **1,312 standard tests pass** across those targets. Six existing ignored
cases remain: three loop/cardinality-analysis cases, a retained-calibration
survey, a Following design comparison, and the ticketed presence-reservation
case. None is a skipped guide-card consumer. See `guide-results.json`. Docs budget: **README 300/300**, self-contained first-screen
check passes. SDK build/typecheck pass; reference audit: **523 LLP documents,
9,891 references, zero errors or unchecked**.

The one full client phase reports **4,958 tests: 4,947 passed, one failed,
ten existing conditional skips, zero cancelled**. Its sole failure is **ours**:
`observed stale reads back off and stop after four requests`. That fixture
combined a stale sequence with an already-expired body. The requested expiry
repair intentionally continues paced retries, so its obsolete four-request
expectation fails (13 instead of 4). The observed fixture now isolates sequence
exhaustion and retains all four-request/backoff assertions; direct expired reads
keep their existing test. The new cases separately qualify observed expiry.
The complete corrected store-order file plus the new file passes **25/25** in
`full-failure-followup.log.gz`. The final run including the restored original retry
file passes **40/40** in `restored-retry-followup.log.gz`. No runtime code changed. Baseline failures: **0**;
environmental failures: **0**. The full run remains red and was not repeated.

The full client phase also independently passes another **300 seeds per host**
(process 196.902 s, wasm 162.308 s), and all twelve new retry cases. All other
stages pass, including **79/79 final models**. `scripts/test.sh` ran exactly once,
exited **1**, and printed exactly:

```text
== 1 failure(s) in 1308 s
   client tests
```

`full-suite.log.gz` and `full-suite.exit` retain that red run; `full-results.json`
records the counts and attribution. Its runtime source stayed unchanged. The
subsequent test-only correction is qualified by the 25/25 follow-up, not by a
second full invocation. The inherited 60-second target remains exceeded.

The affected real-clock 1,000-hook React cases again record **zero loading
renders, 2,000 evaluations and 1,000 revalidating hooks** on wasm, Worker and
process. These are retained behavioral/count checks, not new timing claims.

## Wasm

Canonical full-suite build and independent `gzip -9 -c` measurement agree:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B headroom**, zero growth from round 7.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json`. No budget, timeout or seed count changed. Existing Node 24.13.1,
Bun 1.3.14 and local toolchain were used; no tools installed.

One appended journal entry and the local commit carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publication are forbidden
for this round and were not run.
