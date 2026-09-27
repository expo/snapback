# Lane DC, round 8 — observe every bound response

2026-09-27, branch `sb4-intent/dc-delivery-client`. Read rounds 0–7 prompts,
reports and DC journal entries and the complete Astra round-7 review. Grok's
round-7 review existed but was empty when this round started. It arrived during
qualification and was then read in full; its disposition is recorded below.

First fetched and merged `origin/main` in `17021fb9d`. The only conflicts were
two append-only journal blocks; both sides were retained and a line-multiset
comparison found zero missing lines from either parent. Production changes,
tests and their governing documentation are committed as `03b510f4c`, answering
Astra's round-7 findings 1–3. No push or publication.

## Files and behavior

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `packages/snapback4/src/delivery.ts` | Observe `E_BOUND` on the transport promise before head, attempt, incarnation or flight validation. Record only the queue's fingerprint/group pending-id marker; a response arriving after timeout or reset is also observed. Existing validated CAS paths still own retirement, marker resolution, replacement reservation and callbacks. A stopped queue's late response cannot affect a new queue. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Seven new cases: interval/group eviction while the response is outstanding; interval/group eviction after a headless envelope; late responses after deadline/reset; and the requested recorded-conflict replay reset. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Documents abandoned persistence reservations consuming allowance, and clarifies that restart preserves only retained attempts; an evicted id may lead to redundant coverage after restart. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Adds `E_BOUND` to the no-callback list (late Grok finding 5); no Quarry or TypeScript snippet changes. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Revised metadata and a clarification that every bound outcome records the session marker, with debt retirement and replacement minting still validated. Also states that abandoned reservations consume allowance. The round-7 two-sentence outcome row is unchanged. |
| `../issues/20260927-snapback4-lost-reply-post-count-race.md` | Tracks the baseline native lost-reply fixture race found in the full suite, with baseline comparison and a controlled reproduction. |
| `JOURNAL.md` | Both parent histories retained at merge; one dated append-only round-8 entry. |
| `reports/20260927-dc-delivery-client/ROUND8.md` | This report, with evidence, exact failures and reproduction commands. |

No new syntax, public API, request field, persisted state, dependency, meter,
compiler profile or budget. The allowance remains eight replacements per
fingerprint/group/queue session, replay first, then park until the next session.
No bound refusal or callback is introduced.

## Forms and examples

Existing successful-answer manifests still consume this form:

```json
{"delivery":[{"fingerprint":"fixture:messages","table":"messages","mutation":"delivered","args":["conversation","from","through"],"rows":[["c",41]]}]}
```

The direct report remains:

```json
{"id":"bound-1","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

The actual oversized-response envelope is now remembered even without a head:

```json
{"denied":{"code":"E_BOUND"}}
```

It cannot retire coverage or authorize a replacement. If collection pressure
has already evicted `bound-1`, the group waits until restart. If that id remains,
ordinary same-id retry continues. A validated replayed `state: "sent"` still
retires the interval; only a validated replayed failed bound receipt can spend
the existing replacement allowance. There is no new Quarry form in this round;
the whole existing guide is compiled by its test target.

## Discriminating evidence

- All four new eviction witnesses fail on the merged pre-fix implementation:
  25 IDs instead of one. Each simulates a committed execution whose success
  receipt remains available for replay. The fixed implementation uses one ID
  and one execution over 25 pressure/recollection cycles, emits no callback or
  refused interval, and recovers recollected position 41 after a new session.
- Outstanding-response cases snapshot newer debt before releasing the stale
  denial and prove unchanged state afterward. Deadline/reset cases prove
  the same isolation for late transport completions.
- The replay-reset sequence is `bound-1` bare bound, replayed recorded conflict,
  `bound-2` failed bound, then `bound-2` successful replay. Removing the first
  `attempt.boundReplay = false` fails at the assertion that only two IDs have
  been minted. Production already had this reset; this round adds its witness.
- In-memory module-load mutations, without changing source or built files:
  disabling observation fails six new cases; requiring accepted/numeric-head
  responses fails both headless cases; requiring a current flight fails the
  reset case; the exact replay-reset mutation fails its transition case.
  Every mutant fails an assertion, not a loader error or timeout.

## Late Grok review disposition

Grok's review was empty at startup and arrived while the full suite was in
progress. Its runtime proposals were evaluated against the explicit round-8
instruction that the round-7 queue-session ruling stands.

| Finding | Disposition |
|---|---|
| 1, in-flight eviction | Fixed by `03b510f4c`. Observing transport also covers whole-group eviction, missing heads and late completions; checking only the current incarnation, as suggested by Grok, would miss those required cases. |
| 2, a hidden commit can be executed again after its id is evicted and the queue restarts | Confirmed, intentionally preserved under the standing session/eviction policy. The evicted id is no longer recoverable from retained debt. Persisting it again would change eviction custody and the approved lost-replay delay. A new session may re-report recollected coverage with a new id; the manual now says so explicitly. Replay-first still protects every retained attempt. |
| 3, `reset(true)` retains the maps and can delay a fresh store's group | Confirmed, intentionally preserved: a storage clear on the same queue is not a new queue session. Clearing the maps would replenish the allowance within that session, contrary to the explicit reset-only-on-new-queue ruling. App restart/sign-in grants the next allowance. |
| 4, abandoned reservations | Documented in operations by `03b510f4c`; the final documentation follow-up also states it in LLP §4. |
| 5, receipts card omits the bound non-callback | Corrected in the final documentation follow-up, with a whole-guide recheck after the sole full run. |

Concrete policy witnesses on the current built queue are recorded in
`target/lane-dc-round8/grok-policy-witness.log`. For finding 2: let ID 1 commit
but answer bare `E_BOUND`, evict its group, recollect position 41, observe no
second send in that session, then construct a new queue and start it: ID 2
executes, for two executions across two sessions. For finding 3: collect 41,
receive bare `E_BOUND`, call `reset(true)`, then collect 99 on the same queue:
99 is parked as `start`, with one total sent ID and no refused coverage.
These are explicit policy limits, not claims of logical exactly-once reporting
or uninterrupted delivery after a storage clear. Changing them requires a
change to the supervisor's standing ruling, which this small repair preserves.

## Qualification

Existing worktree-local Node/Bun links and Cargo tools only. Node 24.13.1,
Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt; eight Cargo jobs,
debug information and incremental compilation disabled, fd limit 65,536.
Frozen Bun install made no dependency changes. No tool was installed.

Wasm is unchanged from round 7: **2,022,205 B raw / 585,167 B gzip**,
**195 B below** the accepted **585,362 B** remainder. SHA-256:
`8c86042158304b7b2c48acad400762ad5964c62e2311009cb3e6b9bf064176fb`.
The checked-in 572,841 B gate is unchanged and still reports 12,326 B over.

- Queue tests: **84 passed**, zero failed.
- Affected delivery/source-census/Chromium tests: **161 passed**, zero failed.
- Artifact serializer-family and server-only/Unicode absence checks: pass.
- Package build/typecheck, reference audit and whitespace checks: pass.
  Reference audit: 519 LLP documents, 9,664 refs, zero errors or unchecked refs.
- Complete device: **1,363 passed**, zero failed, three existing ignores;
  delivery target **30/30**.
- Whole guide: **86 passed**, zero failed.

Ran `scripts/test.sh` **exactly once**, exit **1**. Exact summary:

```text
== 2 failure(s) in 1491 s
   wasm build
   client tests
```

Every full-suite failure:

| Failure | Attribution | Evidence and disposition |
|---|---|---|
| `wasm build` | **Baseline** | 585,167 B gzip exceeds the unchanged 572,841 B gate by 12,326 B, but is 195 B below the accepted remainder. Reproduce with `bash scripts/build-wasm.sh`. No budget increase. |
| `client tests`: `W6d native: two client POSTs with the caller id apply once after a lost reply` | **Baseline fixture race** | `client-seams.test.mjs:293`: one POST, expected two. Sync can recover the committed receipt before retry. A controlled 100 ms delay before throwing the lost-acknowledgement error reproduces the identical assertion on current code and merged baseline `17021fb9d`, with one POST, one inserted row and a sent replayed receipt. The fixture declares no delivery binding; its outbox/client/server paths are unchanged by round 8. Tracked in `issues/20260927-snapback4-lost-reply-post-count-race.md`. |

No lane-owned or environmental full-suite failures. Rust: **3,981 passed**, zero
failed, **28 existing ignores**, including all **1,363** device passes and
**86** guide passes. Consumer TypeScript routes: **9/9**. Main clients:
**2,773 passed**, **one failure**, **ten skipped**; seven extra shards **56/56**;
fixture wrappers **9/9**; seeded models **78/78**. All other suite phases pass.
The inherited 60-second total target remains exceeded and unchanged.

Twenty isolated runs of the original failing native test pass on current
source, and twenty pass with the baseline delivery module loaded in memory.
Those passes do not erase the full-run failure. The controlled delay then
reproduces it on both versions; additional diagnostics confirm the successful
one-row/one-POST recovery. The issue records the exact edit and command.
No production or tracked test was changed to conceal that baseline failure.

The runtime, queue test and wasm hashes match the recorded full-run inputs.
Only the late Grok documentation follow-up occurs after that run, including
one receipts-card prose change, qualified by a final whole-guide rerun.
No second full suite. The deliberate pre-fix eviction failures were ours,
fixed before qualification; mutation failures are expected negative controls.


## Reproduction, scope and limits

From `snapback4/`:

```sh
export PATH="$PWD/target/lane-dc-round5/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs
cargo test -p snapback4-device
cargo test -p snapback4-lang --test guide
node scripts/attribute-wasm.mjs --families --check-families --check-absent
bash scripts/build-wasm.sh
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The standalone complete-device run reuses the prior worktree-local copy of the
canonical Rust driver with its workspace selectors narrowed to the device
package; inventory, sharding, assertions and doctests remain intact. The full
suite uses the original driver. Raw logs, exit codes and mutation loader are
under `target/lane-dc-round8/`.

No design deviation. Observing the transport promise also covers a response
arriving after the deadline or a queue reset: those outcomes still belong to
this queue session, even though their debt effects are fenced. It changes no
debt and grants no allowance. Lost replay and abandoned reservation delays
remain the approved conservative under-reporting policy.

Scoped `llp-orient` audit used the initialized lane-a5 skill because this
worktree's vendor skill is absent. Scope: the delivery queue and its tests/docs.
Governing documents (all in `llp/current/`): LLP 3000 §§3–4 (fence/budgets),
LLP 3000.019 §4 and LLP 3000.021 §3.2 as amended (SDK ownership), LLP 3000.022
§4 (replay, session bounds, stale callbacks and acceptance). Rationale:
LLP 3000.022 §4's oversized-response success receipt and lost-replay marker.
The targeted documentation updates are in the implementation commit; no
new design decision or broken reference requires a hand-off. Hand-off: none.

Open baseline: `bash scripts/build-wasm.sh` reproduces the unchanged 572,841 B
gate failure; the supervisor owns the accepted integration ratchet change.
Existing conditional-host limitation remains: accept a fallback manifest on
a custom/process/Expo handle without `deliveryCommit`, then read delivery
state; the answer resolves but supplementary debt is omitted. Ordinary
publication collection remains transactional. No new DS/ER server,
comparative, complete wasm parity, native process-kill or browser-crash
qualification is claimed. Astra's requested repairs are complete; the two
additional Grok policy observations above remain as stated.
