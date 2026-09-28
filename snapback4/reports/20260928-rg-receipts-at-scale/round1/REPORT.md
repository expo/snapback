# RG round 1 — charge the abandoned probe and finish receipt migration

2026-09-28. Branch `sb4-intent/rg-receipts-at-scale`. First action fetched and
merged `origin/main` (`0a5596c2c`) into round 0 (`65e843be9`), producing merge
`284cc8135` without conflicts. Nothing was pushed or published; no tool was
installed. The supervisor owns the next landing suite; `scripts/test.sh` was
not run in this round.

## Findings and fixes

- **Astra's blocker:** keep the 65 examined charges from a declined predicate
  probe and deduct actual probe work from the caller's fallback recount limit.
  This preserves its publication headroom. The reproduction at allowances
  210, 240, 256, 300 and 500 now commits and privately finishes at 999 unread
  messages. Seven and eight member updates also commit under the default
  8,192 allowance; the eight-member case leaves a pending recount. Finishing
  those recounts advances no public sequence. The probe remains charged.
- **Cutoff:** independent fixtures at 63, 64 and 65 candidates check exact
  counts, examined bounds and decoded-source bounds. Each size also has an
  expired/tombstoned/self-sent prefix followed by one live unread row. At 65,
  the probe charges 65, decodes zero, and the fallback finds the live row.
  The `n.min(LIMIT - 1)` control fails with 63 instead of 64.
- **Legacy hook:** the receipts card explicitly says the history-walking hook
  does not scale to a large group and shows SDK reporting plus member-only
  reads and visible-screen `seen`. Full-scale operation of the old hook is
  not established. It is not described as slower but working.
- **Late Grok findings:** Grok had no verdict at turn start; its completed
  review arrived while validation was running. Its meter-refund suggestion
  conflicts with the user's instruction and was not used. Its refused-tail
  case reproduces: a successful first write followed by a non-retryable
  refusal left the first commit absent locally until `/changes`. Once the
  refused tail is retired, the client now syncs unobserved earlier successes
  before resolving that tail. The existing successful-pair test still proves
  there is no sync between their two POSTs. The cost answer and maintains
  card now describe both the bounded predicate-index candidates (including
  expired candidates) and the shared live-expiry fallback, with the same
  fixed public reservation.

Grok correctly observed that the linked pre-migration log and JSON showed
only a timeout. The original screenshot, inspected and now retained as
[pre-migration-failure.png](../pre-migration-failure.png), shows
“examined rows reached the ceiling 8192.” The main report now distinguishes
those two sources. Both full reviews and the [context pack](CONTEXT.md) are
retained here.

## Builder probe

The completed migration meets the one-second target in this run:
[measurements](fixed-guide-measurements.json), [builder output](builder-result.json),
[probe log](fixed-guide-probe.log), [network profile](fixed-guide-network.json.gz),
[CPU profile](fixed-guide.cpuprofile.gz) and [host load](host-load.jsonl).

| Measure | Completed migration |
|---|---:|
| Cold web ready | 7.698 s |
| Warmup 1 send/settlement / receipt convergence | 1.553 s / 4.561 s |
| Warmup 2 send/settlement | 504 ms |
| Warmup 3 send/settlement | 395 ms |
| Measured send/settlement p95 | **704.190 ms** |
| Measured visible-render p95 | **73.113 ms** |
| Measured all-peer receipt convergence p95 | **3,413.875 ms** |
| Measured maximum send/settlement | 924.533 ms |
| Measured sends below one second | 20 / 20 |

All three warmups are excluded, including the first 1.553-second send. Host load
ranged from 41.85 to 53.11. The app change and host load both differ from the
first repeat; their individual latency contributions are not isolated. This
is measured qualification on this host, not a guarantee under arbitrary load.

Post-navigation device work: **77,916 IndexedDB transactions**, **604 saves**,
**1,889 queued calls**, **229 history evaluations**, **229 receipt evaluations**,
**4,573 reaction evaluations**, and **3,736 DOM mutation records** (not React
render counts). There are **zero `progress` evaluations** and 228 member-only
reads. Fifty wasm applies consume 300.9 ms total, maximum 16.1 ms; receipt
certification consumes 6.165 s over 229 evaluations, maximum 61.6 ms. The
asynchronous durations overlap persistence and queueing and are not additive
wall time. Measured sends reach POST within 227.1 ms of SDK admission; the
largest device admission queue wait across the full run is 353.8 ms.

| Route | Response p95 | Server engine p95 |
|---|---:|---:|
| `/sync` | 314.896 ms | 273.409 ms |
| `/changes` | 21.910 ms | 3.868 ms |
| `/m/send` | 30.441 ms | 13.812 ms |

`/changes` includes held polling. Sync carries **523 message images** across
the run, including the 500-message initial horizon and 23 sends, rather than
re-delivering the 10,000-message history. Feed maintenance remains present,
so aggregate wire bytes are not a pure receipt comparison. The profiles retain
per-response rows/bytes, timing and device counters.

Cold readiness is 123 ms first document, 111 ms credential entry, 5,769 ms
login/feed, 1,691 ms navigation/screen, and 3 ms remaining acquisition. It is
not represented as a cold-start improvement over round 0.

The first repeat used the exact retained round-0 app migration and completed
all 20 measured sends. It missed the one-second target: **1,146.446 ms**
send/settlement p95, **128.510 ms** visible-render p95, **5,056.413 ms** all-peer
receipt convergence p95, **8,668.173 ms** cold ready. Eighteen sends were below
one second; maximum 1,347.637 ms. The one-minute host load ranged from 63.45 to
79.95 on this 96-logical-CPU host. This is an observed miss of this build/form;
load is a confound, not proof that the implementation could not be responsible.
[Measurements, profiles, log and load trace](retained-migration/fixed-guide-measurements.json)
remain under `retained-migration/`.

Inspection of that profile found the retained migration still observed
`progress` 244 times. Its `ahead` messages can drive catch-up through SDK
manifest collection even after the manual writers are removed. The copied
app now uses the guide's member-only read, and unused manual debt and
background delivery helpers are removed. The [complete migration patch](complete-builder-migration.patch)
is relative to the original builder app, including the earlier SDK clause and
coverage-preserving run merger. Both Quarry source copies use it. The final
run starts from another fresh original store copy; no added probe messages
are reused. The only added query is the member lookup; authorization, allocation and
receipt-reading rules stay the same.

Both repetitions use the original actor, 100 conversations, 50 members,
10,000 initial messages, 49 authenticated peers and the builder's three
warmups plus twenty samples. P95 uses its sorted sample index 18. Its original
`pass` means the 30-second assertion; `oneSecondTargetPass` separately records
the requested one-second target. Visible DOM rendering and settlement are
reported separately. No build or test from this lane overlaps either probe.
The original database and WAL hashes still match; the source evidence is
read-only. Cold-readiness follow-up remains
[the existing ticket](../../../../issues/20260928-rg-cold-web-acquisition.md).

## Validation and failures

All final checks pass. [Commands](commands.txt), [exit codes](check-exits.txt)
and [counts](test-summary.json) accompany their full logs.

| Check | Result |
|---|---:|
| Rust row-view unit tests | 23 passed |
| Core row-view, authorization/disclosure, sync-count and receipt integration | 31 passed |
| Device row-view, range and delivery tests | 53 passed |
| Whole guide | 93 passed |
| Rust delivery, replay conversion and receipt-gap tests | 42 passed, 1 opt-in measurement ignored |
| Cost certificates | 12 passed |
| React, clock, pending writes and settlement/replacement, after the late fix | 171 passed |
| Receipt and delivery client tests | 212 passed |
| Extra clock checks, including Chromium | 57 passed |
| Settlement, transport outcomes and store replacement integration | 38 passed |
| Client build and typecheck, production/debug builds, app check/export, reference audit | passed |

The standalone refused-tail rerun also passed 30/30; it overlaps the 171-test
row and is not additional coverage. The first client run passed 170/170 before
the late finding. The final count is **254 Rust and 478 client tests**, plus
that overlapping 30-test rerun; the ignored Rust case is explicitly a metrology
opt-in, not a missing correctness check.

Every failed check/control in this round is classified here:

| Classification | Failure | Resolution / evidence |
|---|---|---|
| Ours, expected control | Four moderate allowances and eight default-budget members return non-retryable `E_BOUND` before the deduction | `regressions-before.log`; final row-view tests pass |
| Ours, expected mutant | Candidate loop clipped to 63 loses the 64th candidate | `cutoff-mutant.log`; restored loop passes |
| Ours, expected control | Old receipts card omits the explicit large-group migration warning | `guide-before.log`; whole guide passes |
| Ours, expected control | First success is not visible locally after the second write is refused | `refused-tail-before.log` and final-fixture `refused-tail-control.log`; `refused-tail-after.log` passes |
| Ours, expected control | Old built CLI cost output omits bounded predicate-index certification | `cost-before.log`; final cost suite passes |
| Ours, test setup | Incorrect `ViewChunk` import and nonexistent `Value::Text` variant | `test-compile-first.log`, `test-compile-second.log`; corrected to the engine enum and `Value::String` |
| Ours, test setup | Reused raw-row helper supplies an unknown `at` field; initial parent-row repair did not fix it | `test-fixture-first.log`, `test-fixture-second.log`; remove the unauthored field |
| Ours, test setup | `budget.q` namespaces operation names, so bare `mark`/`markAll` are unknown | `test-fixture-third.log`; compile the fixture as `schema.q` |
| Ours, test setup | Refused-tail fixture reads the fake network fallback as an array | `refused-tail-fixture-first.log`; inspect the actual local device query; the corrected test also fails without the fix |
| Ours, stale assertion | Another cost assertion still demands “the walk is not metered” | `cost-stale-expectation.log`; assert the internal-ledger statement, then 12/12 pass |
| Ours, invocation | Reference audit launched from the Snapback 4 subdirectory, so it found no root LLP corpus | `ref-check-wrong-cwd.log`; root invocation passes, 521 LLP documents |
| Ours, invocation | First copied-app check launched from the workspace instead of the copied app | `member-check-wrong-cwd.log`; correct app check/export pass |
| Ours, evidence formatting | Staged whitespace check found terminal blank lines in six logs and trailing spaces in the copied Astra review | `staged-whitespace-before.log`; normalize whitespace (including a second check of the echoed offending lines), preserving all diagnostic/review text |
| Ours/current form, performance | Exact retained round-0 migration repeat misses <1 s at 1.146 s p95 | Retained in full; complete the remaining member-only migration, then measure from a fresh copy |

No baseline test failures or environmental check failures were observed. Host
load is recorded as an environmental measurement condition; the retained
latency miss is not excused or relabeled as a passing qualification.

Wasm: **2,019,815 B raw / 585,381 B gzip**, against the unchanged **586,193 B**
budget, leaving **812 B**. Raw size is unchanged and gzip is **3 B smaller**
than round 0. Only the data section differs from the saved baseline; the
code section is byte-identical ([section hashes](wasm-sections.json)).
No wasm capability or budget was added. [Artifact hashes](artifact-digests.json)
and [source hashes](source-digests.json) identify the measured inputs. The
final guide adds an explicit instruction to replace the mounted `progress`
query; its test is included in the final whole-guide rerun (93/93). This
documentation-only addition follows the runtime measurements;
[final source hashes](final-source-digests.json) record the committed source.
