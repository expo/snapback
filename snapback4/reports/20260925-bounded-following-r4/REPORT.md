# Lane U round 4: one query publication procedure

2026-09-25. Addresses both NOT READY delta reviews in
`~/sb4-intent/reviews/u-r3.astra.md` and `~/sb4-intent/reviews/u-r3.grok.md`.
Both were read in full and checked again before the final suite. Implements
the supervisor's round-4 five-rule procedure over accepted LLP 3000.016
revision 5. This report supersedes the routing claims in the round-3 report;
its historical measurements remain unchanged.

Implementation commits: `1925fad60`, `57b836317`, `14cf694cd`, `1550b7b7e`. No push or publication.

## Rules and evidence

| Rule | Implementation | Tests |
|---|---|---|
| 1. Session and incarnation | One checkpoint tests the live session, partition refusal, incarnation, and local-commit authority after every awaited routing step and before publication. Caller continuations in `local.ts` also check the session before returning or notifying. | Ten `query-publication-session` cases exercise the real client: sign-out and close during local evaluation, dispatch, transport, delivery-outbox wait, and final-publication-outbox wait. Four direct evaluator cases verify the router itself returns E_AUTH/E_CLOSED at both outbox waits, so caller checks cannot conceal a missing router guard. Existing composed sign-out/close, reset and revocation tests remain. |
| 2. Known complete local wins | Every executable program runs locally first, including `runs: server` and native programs. A known complete outcome returns immediately, before external routing. Quarry starts with static possible reads; a known outcome can narrow them. | Four `known complete branch wins` controls cross native/Quarry and held/ordinary. Real wasm and native `a known branch wins over static server routing` compile Grok's conditionalFeed with full switches and online-only reposts, then hold a predicted own post while the server has a different branch. Local complete `[]` wins with zero HTTP queries. Existing held false/null branches still pass. |
| 3. Engine withholding / inability to run | Engine `loading` means unavailable. Missing programs, uncurrent partitions, unavailable native guests, and device preflight acquisition/native refusals cannot certify execution. Offline, intersecting prediction, then held prevent fallback; otherwise send the original arguments. Failed fallback stays loading. | Five `engine-withheld` route cases; native reset/install failure (ordinary/held); acquisition/native preflight refusals; real original-card, repost-card, inbox-floor, held, transport-failure and original-cursor cases on both tiers. `known meter prefixes stay partial` and the real inbox meter test preserve data and continuation above the floor. |
| 4. Unknown available remains data | The client no longer infers withholding from Following dependencies. Available unknown results retain their local data and get `complete: false`; the fence suppresses replacement rather than that data. | Five `available unknown Following` cases (offline, prediction, held, server, transport failure). Real wasm/native `an available unknown profile preserves predicted feed rows` keeps the pending own card beside an unknown profile and lets a disjoint online-only profile query reach the server. The unknown direct/helper branch tests now expect the engine's partial empty/null data and zero external requests while fenced. |
| 5. Recheck external delivery | A single external-answer gate is used at dispatch, delivery, composed re-observation, and final publication. It recomputes predictable/unobserved table intersection. Failed or newly fenced replacement keeps the latest local outcome, or loading if unavailable. Local commits retire the entire evaluation. | Four prediction-arrival cases cross delivery/publication with available/withheld local results. Opaque-native, disjoint-write, observed/no-op, and slash-ID controls; four composed re-observation interleavings; real wasm/native response/admission races; unchanged composed retained-history and reset suites. |

The numbered procedure is at the top of `local-query.ts`, with rule numbers at
its branches, and three lines in `CLIENT-AND-OPERATIONS.md`.

## Publication paths

| Path | Final behavior / proving test |
|---|---|
| Known local answer | Immediate local candidate, checked for session/incarnation before return and again by `query()`/watch delivery. Rule-2 branch tests and rule-1 local wait tests. |
| Available local unknown, known meter prefix, retained history, or local refusal | Local result remains available when external routing is blocked or transport fails. Unknown data is partial. Rule-4 matrix; meter prefix; existing retained/composed history and offline required-read tests. |
| Server data, loading, or explained refusal | One server function, one external-answer gate, and one final publication point. Delivery/publication prediction and session matrices; original-cursor and native tests. |
| Composed remote answer or merged object | Same external final gate; second local observation replaces the fallback candidate. If that observation becomes complete and known it wins; if unavailable it cannot be substituted after a failed server request. Four `Following becomes withheld on composed re-observation` cases and existing MQ tests. |
| Remembered whole-server answer | Removed. Neither offline recovery nor transport failure can recover such a page. Poisoned-memory controls cover available/withheld results, online/offline, fenced/unfenced. Real residency, page-authority, and reset cases verify local data or loading instead of an old server page. |
| E_OFFLINE shortcut | Removed from query routing. A query the device cannot run stays loading offline; an available local result remains itself. A server's explicit explained refusal is still an external result and passes the same gate. Native reset/install, preflight, cold-read, and page-authority refusal tests. |
| Observation retained during HTTP | Existing transient observation retention remains; internal fetch publication is disabled. Local commits, resets and session end invalidate it. Final candidate uses the common gate. `a server-class observation uses ordinary device-fallback retention during HTTP`, local-read invalidation, revocation, and session tests. |

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Replace shortcut routing with the numbered procedure, local/external candidates, a shared session/incarnation checkpoint and external gate, local-first execution, actual engine availability, partial-data preservation, and composed re-observation. Remove remembered recovery and compile-time server bypass. |
| `packages/snapback4/src/local.ts` | Remove the whole-server memory map and add session checks across evaluator/caller awaits and immediately before observer publication. Preserve the global local-commit invalidation fence. |
| `packages/snapback4/src/local-reads.ts` | Remove the obsolete Following inference and separate withheld helper. Keep prediction-footprint parsing, watch invalidation and compile-time classification for invalidation scheduling. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | State the procedure in three lines; replace stale E_OFFLINE/remembered/pending-fallback claims. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Rules 1–5 matrix, static/opaque/known dependencies, delivery/publication prediction races, poisoned memory, preflight refusals, and native reset/install controls. |
| `packages/snapback4/test/query-publication-session.test.mjs` | Ten real-client sign-out/close interleavings, including both review-named outbox waits. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add known conditionalFeed and unknown-profile/pending-feed cases on real wasm/native; retain direct/helper static-fence tests with rule-4 partial-data expectations. Update ordinary online-only scan recovery to local partial data. |
| `packages/snapback4/test/following-routing.test.mjs` | Give the auxiliary transport probe an actual unavailable device reply now that all queries run locally first. |
| `packages/snapback4/test/local-reads.test.mjs` | Keep local-commit/in-flight invalidation coverage while removing the deleted server-memory argument. |
| `packages/snapback4/test/helpers/app-model-device.mjs` | Give the real wasm model an actual online-only point read instead of an empty `runs: server` body; preserve every model seed, invariant and HTTP-coverage assertion. |
| `packages/snapback4/test/helpers/app-server.mjs` | Let auth tests request actual online-only source residency. |
| `packages/snapback4/test/app-local-outcomes.test.mjs` | Hold actual unknown query fallback across close instead of forcing HTTP by rewriting `runs` metadata on a locally complete query. |
| `packages/snapback4/test/app-local-session.test.mjs` | Use an online-only source for the consumed-predecessor HTTP retry, preserving its auth assertions. |
| `packages/snapback4/test/client-lifecycle.test.mjs` | Supply an unavailable local reply in the remote auth-refusal mock; preserve the engine's available required-read refusal offline. |
| `packages/snapback4/test/session-security.test.mjs` | Replace boolean mock query replies with actual unavailable envelopes, preserving rotation, sign-out and durable stale-write assertions. |
| `packages/snapback4/test/page-authority.test.mjs` | Assert local partial recovery after failed HTTP and ordinary device-fallback transient retention; retain all revocation/expiry/commit checks. |
| `packages/snapback4/test/page-ready.test.mjs` | Expect available local partial lists after transport loss instead of remembered pages/E_OFFLINE. |
| `packages/snapback4/test/residency.test.mjs` | Require local evaluation of server-class programs and partial local data offline, including presence, without changing residency certificates. |
| `packages/snapback4/test/store-reset-review.test.mjs` | Require loading instead of remembered server recovery when the device cannot run after reset/offline. |
| `packages/snapback4/test/store-reset.test.mjs` | Require loading for an unacquired offline partition. |
| `packages/snapback4/test/sync-generation.test.mjs` | Four headless-generation cases preserve executed partial local nulls instead of treating them as unexecuted queries. All durable-state assertions remain. |
| `packages/snapback4/test/acquisition.test.mjs` | Expect exact loading, without fabricated data or refusal, before acquisition on both tiers. |
| `packages/snapback4/test/repair-b-round7.test.mjs` | Advertise the counter program actually executed by the mocked device, preserving private-publication invalidation tests. |
| `packages/snapback4/test/repair-b-round8.test.mjs` | Advertise that same mocked held counter; retain post-publication failed-read and durable-watermark assertions. |
| `reports/20260925-bounded-following-r4/mutations.py` | Reproducible four-mutation check of built routing code; restores the original bytes in `finally`. |
| `reports/20260925-bounded-following-r4/*.log.gz` | Qualification, focused tests, development failures, and intentional mutation evidence. |
| `reports/20260925-bounded-following-r4/REPORT.md` | This report. |
| `JOURNAL.md` | One dated append-only entry after qualification. |

## Forms and decisions

No new syntax, diagnostic or storage form. Existing compiled forms exercise the
new routing, for example:

```quarry
query conditionalFeed(c: cursor ?):
  if exists switches['gate']:
    return feed last 20 by .at after c { *, card: reposts[.actor, .post] }
  return []
```

With fully synced switches this returns the known local `[]`, even when the
server already knows a different branch. With online-only switches it is an
available unknown `[]`, stays partial while fenced, and cannot authorize a
server page that drops the pending post. The existing helper form expands its
static reads and behaves identically.

```quarry
query withProfile():
  rows = feed last 2 by .at { *, post: posts[.post] }
  return { rows, profile: profiles['old'] }
```

With the source cards held and `profiles['old']` past its horizon, the result
keeps the pending own row and has `complete: false`. A separate
`query remoteProfile(): return remoteProfiles['old']` still falls back while
that unrelated post is pending. The full declarations are compiled and run
by `bounded-following.test.mjs` on both tiers.

No deviation from the round-4 procedure. Engineering decisions made explicit:

- Whole-server remembered recovery is removed: rule 3 requires loading on
  failed unavailable fallback, and rule 4 keeps the available local result.
  Existing transient watch retention during HTTP is separate and remains.
- Non-native programs start with static possible tables as specifically
  requested. Native/missing programs and queries unable to execute use every
  table. Unknown branches retain static reads; only known execution narrows.
- E_PREDICT acquisition refusal and E_NATIVE missing-guest refusal are device
  preflight failures, hence inability to run, rather than local data or an
  inferred card miss. The gate stays conservative with all possible tables.
- An available local required-read refusal is preserved if fallback is blocked;
  the client no longer substitutes its own E_OFFLINE refusal.
- The old standalone `env.sessionDead` guard no longer exists. Its equivalent
  mutation now disables session checks in the central checkpoint, and all four
  direct delivery/publication tests fail. Narrowing a known outcome is allowed
  by the design; restoring external routing after that narrowing fails the
  known-branch test. It is the external replacement that was incorrect.

No Rust, engine, wasm, authorization, durability, meter ceiling, package
version, or storage format changes. The scope intentionally changes query
routing and the old remembered-answer/E_OFFLINE behaviors described above. All changed source files remain below
1,500 lines (`local.ts`: 1,403; `local-query.ts`: 183).

## Validation

Focused routing/session/composition: **50 passed, 0 failed**. Affected reset,
session, generation, residency, routing and lifecycle checks: **130 passed,
0 failed, 1 existing skip**. Known-branch real-device checks: **2 passed**.
The final full suite reruns all cases, including the complete wasm/native
Following file and previous repost-meter/native-unavailable controls.

Four intentional mutants are rejected, and none remains:

| Mutant | Result |
|---|---|
| Restore a server answer after narrowing a complete known branch | 1 failure in 4 branch cases. |
| Disable the central session refusal checkpoint | All 4 direct session interleavings fail. |
| Narrow unknown outcomes to executed tables | Static unknown-condition/slash-ID test fails. |
| Convert available unknown outcomes to loading | 4 of 5 rule-4 routing cases fail. |

Reproduce from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/query-publication-session.test.mjs packages/snapback4/test/following-routing.test.mjs packages/snapback4/test/bounded-following.test.mjs
python3 reports/20260925-bounded-following-r4/mutations.py
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

Final full-suite command, from `snapback4/`:
`taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh`.
It exits 0 with the exact summary **`== 0 failure(s) in 591 s`**.
Every section passes: Rust, builds, documentation/release guards, package/app
checks, fixture wrappers, **1,552 main client passes with 10 existing skips**,
all **34 acquisition/server shard passes**, and all **78 model passes** at the
original counts and timeouts. The local session model completes all 5,000
sequences in 121.464 seconds in this full run. Evidence: `test-final.log.gz`.
No final failures, waivers, raised ceilings or disabled tests.

The three earlier timeout cases also pass unchanged in this full run: the two
replacement-journal cases in 0.097 / 1.101 seconds and native maximum pending
IDs in 3.386 seconds. The reduced process parallelism is an execution setting,
not a changed test requirement.

Reference audit: **`ref-check: ok — 509 LLP docs, 9293 refs in 26151 files,
0 errors, 0 unchecked`**. Wasm is unchanged at **1,776,325 B raw / 495,299 B
gzip**, below the unchanged 496,000 B budget. The baseline log was checked;
its recorded cargo failure was not used as a waiver and did not recur here.

## Full-suite development failures

The first full run returned **`== 2 failure(s) in 610 s`**: `client tests`
and `client models`. Rust and all build/documentation/package stages passed.
The model phase passed 77 of 78 tests. Its local 5,000-sequence model failed
only the `held./q/viewer` coverage assertion: the real device correctly
answered its empty query body locally, despite `runs: server`, so no HTTP
response was held. This is ours. The fixture now executes a real online-only
point read; no seed, invariant or coverage assertion was removed. The corrected local model
then passed all 5,000 sequences in 115.544 seconds, including held-query HTTP
coverage (`model-focused.log.gz`). Evidence:
`test-first.log.gz`.

The initial full invocation's client phase failed in nine cases. Six belong to
this change; three were shared-host timeouts. None was waived or had its timeout
raised:

| Cases | Count | Attribution / resolution |
|---|---:|---|
| Schema alone is not acquisition, wasm/process | 2 | Ours: replace E_OFFLINE expectation with exact loading. |
| Snapshot and catch-up publish readiness, wasm/process | 2 | Ours: same acquisition expectation, preserving readiness/durability assertions. |
| Private commits rerun published image | 1 | Ours: mock executes a held counter but advertised no program; supply its declaration. |
| Publication notifies watches after failed state read | 1 | Ours: same mock program declaration. |
| W6R1 caller ID fenced across replacement, ordinary/offline reopen | 2 | Environmental startup timeouts at 5 seconds; unchanged cases pass in the focused rerun. |
| Native maximum pending IDs / cursor batches / terminal acknowledgments | 1 | Environmental timeout at 40 seconds; unchanged case passes in 4.620 seconds in the focused rerun. |

The corrected acquisition/publication run passed **29/29**. The unchanged timeout
case run passed **8/8**, including both device tiers' maximum-pending cases.
Evidence: `acquisition-final.log.gz`, `timeout-rerun.log.gz`. The final full
invocation uses Linux CPU affinity for 16 CPUs, which reduces Node's default
parallel file count on this shared 96-CPU host; every suite, seed, case, engine
ceiling and test timeout remains unchanged.

## Other development failures and inherited limits

The first broad client run reported 24 failing cases (1,537 passes, 10 skips).
All are ours: old routing expectations or transport fixtures that did not supply
valid local outcomes once local execution became mandatory. None was attributed
to the baseline or environment. The entire log is preserved in
`client-development.log.gz`. Failures, grouped without omissions:

| Cases | Count | Resolution |
|---|---:|---|
| Query held across app.close, wasm/native | 2 | Use actual online-only residency to exercise transport. |
| Consumed-predecessor local query | 1 | Same real online-only fixture correction. |
| Viewer notification before failed session deletion | 1 | Give the local mock an unavailable reply. |
| Background horizon unwrap, wasm/native | 2 | Preserve available local refusal offline. |
| Loading server reply / subsequent failed fallback | 1 | Preserve available local prefix, no remembered recovery. |
| Server-class watch during HTTP | 1 | Use ordinary device-fallback transient retention. |
| Unavailable server list responses | 1 | Partial local result replaces remembered-answer expectation. |
| Online-only watch offline / cold point offline / presence offline / presence clock | 4 | Require local-first execution and available partial results. |
| Near-expiry session / stale-token watch / concurrent sign-out vs stale write | 3 | Replace invalid boolean query replies in mocks with engine-shaped envelopes. The stalled security test process was terminated during diagnosis; its failures are not waived. |
| Committed reset before failed state read | 1 | Missing local program is an inability to run; offline remains loading. |
| Delayed server/watch incarnation cases | 2 | Same missing-program routing plus removal of remembered recovery. |
| Reopen after interrupted replacement | 1 | Unacquired device preflight means loading offline. |
| Missing early watermark, two tiers × two transfer modes | 4 | Executed available local null remains partial. |

An intermediate 106-case affected run had 2 failures (104 passes): one remaining
boolean query mock and an over-specific `false` expectation for local presence.
Both were corrected; local presence data is preserved with `complete: false`.
Early new-test errors were also ours: awaiting all sign-out cleanup while its
query was paused; expecting only E_AUTH after sign-out had already closed;
reading compiler metadata from the stripped device backend; and fetching
schema without the fixture persona. The final regressions keep the intended
interleavings and real compiled server classification.

No new open routing problem is known. The pre-existing scale target remains
unmet; this routing-only round does not claim a new acquisition measurement.
The **prior round-1** full-event inventory is retained for continuity:

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| owned events | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| tombstones | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| inbox | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| work | 63 | 63 | 22,132 | 22,132 |
| Whole partition, including other tables | 171,330 | 98,543 | 35,901,571 | 15,092,169 |

Cold Chromium acquisition was **281,263.9 → 117,812.5 ms (2.387×)**. Fully
synced owned events dominate afterward; the accepted sync policy is unchanged.
The 5× target and packed-format measurement remain unclaimed. Reproduce using
`node reports/20260925-bounded-following-r1/measure.mjs` after its production
build; the [round-1 report](../20260925-bounded-following-r1/REPORT.md) contains
the exact fixture, inventory, browser method and lane-V availability at that
measurement time. No new statement about main's current packed-format status
is made here.
