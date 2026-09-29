# Lane RL round 3 — generation boundaries and detecting coverage

Branch: `sb4-intent/rl-answers-stay`. Fetched and merged `origin/main` first;
merge `f5d74035a` preserves both appended journal entries. The merged main is
`b7d05baff`. [environment.json](environment.json) records parents and toolchain.
Local work only; no push or publication.

Read all earlier lane prompts and reports and Astra's complete round 2 review.
Grok initially had progress notes, then completed a READY review with two low
findings. Used `llp-orient`; [CONTEXT.md](CONTEXT.md) records the constraints.

## Changes and review disposition

| Finding | Resolution | Detecting coverage |
| --- | --- | --- |
| Astra High: generation-only notification retains the retired program's answer | A generation mismatch enters the existing `observeIncarnation` reset before table filtering. It clears displayed/remembered answers, fences pending work and sets `partitionCurrent` false until adoption. | Real dev adoption adds `require false else APP_DENIED` to `item`, with unchanged sequence and `tables: []`. Process/wasm, readable/throwing/held replicas, all three keep policies, failed sync, then successful adoption. Separate held-server and remembered-answer cases. |
| Astra surviving quiet-presence mutation | Preserve the existing `answers.current` guard; add the missing pending-cut scenario. | Presence samples below the notification cut cannot clear its episode or restore a withdrawn row while sync is held. Removing only that guard fails both hosts. |
| Grok Low: notification fixtures overstate touched tables | Round 2 cases, quiet presence and every seeded notification now name only `members`. | Replacing local notification `some` with `every` fails the selected process/wasm cases. |
| Grok Low: omitted online table list does not bound known watches | Treat omitted `tables` as unknown dependencies and refresh every online watch with the existing bound. Preserve explicit-empty intersection behavior. | Two disjoint watches, default/true, held/failed replacement: four omitted-table cases fail before and pass after; four empty-list controls pin existing behavior. |

The production delta is the generation reset condition and one online selection
condition. No new public type, sequence domain, interpreter, cache, budget or
ordering system. `local.ts` stays at 1,500 lines by shortening an existing
comment without changing its meaning. Quiet-presence production code is
unchanged. The earlier conservative commit/receipt bound remains in place;
a slow unrelated profile replacement can still reach loading after a commit.

Grok reviewed the previous round statically, without rerunning its reported
checks. Its READY verdict did not find Astra's concrete generation regression;
this report uses the reproduction and detecting tests to resolve that gap and
does not claim a new reviewer approval of round 3. Its final sentence says
that timeout clears the pending cut; the implementation intentionally keeps
that cut until published sync, including after timeout or a qualifying server
replacement. The reports and manual state that behavior.

The current contract is recorded in LLP 3000.023 §10, the client guide, README
and operations manual. One dated journal entry accompanies the final commit.

## Tests and controls

- Initial new regressions: **22/22**. All **20 generation cases fail** against
  the copied merged round 2 SDK; the two quiet-presence controls pass there.
- Expanded affected checks: **739 passed, 0 failed, 1 declared skip** (740 tests).
  Includes React route/history traces on process, wasm and online, prior-round
  regressions, presence, ephemeral routing/adoption, generation/store resets,
  lifecycle, ordering and delivery publication/approval.
- Grok follow-up and affected checks: **120/120**, including the members-only
  round 2 regressions and the 30 round 3 cases before the test scheduling fix.
- Full-run test correction: final round 3 file **30/30**; quiet presence
  repeated 12 times per host **24/24**. Removing its guard still fails **2/2**.
- Whole guide after the final documentation additions: **98/98**.
- Build/typecheck and documentation budget pass. Reference validation passes with zero errors/unchecked references; whitespace
  checks pass. Logs are beside this report.

`regressions-before-final.log`, `regressions-after.log`, `affected.log`,
`grok-qualified.log`, `regressions-final.log`, `presence-repeat.log`,
`guide-final.log` and the individual build/check logs
retain the executed evidence. [FAILURES.md](FAILURES.md) records every red
control, the interrupted initial test setup, and lookup/path mistakes with
attribution. The skip needs the optional published 0.2.32 compatibility binary;
it is not counted as a pass.

## Schedule model

Every seed retains the membership, ordering, offline freshness, sign-out,
notification-before-failed-sync and plain offline ephemeral histories. It now
also replays real program-only adoption captured once per host: the backend,
notification, generation-discovery response, snapshot and denial all come from
the dev server. Sequence and touched tables do not change at that boundary.
The independent `GenerationModel` learns authority only from the injected
notification, rejects data immediately, and has no SDK admission or episode
logic. A negative-reference check verifies that even revalidating data is
rejected after this boundary.

The schedules vary completion before/after generation discovery, readable or
throwing old replicas, event-loop turns, failed sync, offline direct reads and
successful later adoption. Every watch notification is checked. The existing
incarnation reset must block new old-replica evaluations as well as late
completions. Cleanup remains bounded and awaited in batches, with no timeout
or seed reduction.

Initial generation-extended run: **300 seeds per host, zero failed seeds**;
process 167.7 s, wasm 122.1 s. Removing the generation fix (copied round 2 SDK)
fails **3/3 seeds per host**, independently of the quiet-presence mutation.
Final members-only run: **300 seeds per host, zero failed seeds**, plus the
negative-reference test; process 180.4 s, wasm 120.6 s. Records are
`oracle-final.log` and `oracle-final-{process,wasm}.json`.

Model limits remain finite scheduling, process/wasm only, no new native-plugin
or cutless variants. It permits early loading after ordinary change evidence;
the focused tests separately require immediate valid replacements and the
retained episode. The generation case requires an immediate hard withdrawal.

## Full script

Ran `scripts/test.sh` **exactly once**, exit **1**. Exact summary:

```text
== 1 failure(s) in 1388 s
   client tests
```

Client counts: **4,754 tests; 4,743 passed; 1 failed; 10 skipped;
0 cancelled**. The sole failed test reported is
`packages/snapback4/test/answers-stay-round3.test.mjs:1:1` (`test failed`).
It is **ours**: the quiet-presence test schedule stalled after all 20 generation
cases passed. A deadline could overtake a background sample and end its timer;
the test incorrectly waited indefinitely for the next sample. I terminated only
the recorded test child and its two fixtures, letting the full script continue.
[FAILURES.md](FAILURES.md) records the diagnosis, initial mistaken suspicion,
exact intervention and correction. **0 baseline, 0 environmental failures**.

The corrected test controls that ordering and passes **30/30**, with **24/24**
repeated quiet cases and the guard mutation still detected on both hosts. No
production change was required for the stall. Every other full-script stage
passed, including Rust, fixture wrappers, builds/typechecks, guide/docs budget,
wasm/release guard, and **79/79** final client models. The client stage also
independently completed the final 300-seed schedules per host with zero failures.

Grok's one-line online fix and additional tests arrived during the Rust stage.
The package was rebuilt and typechecked before the full client stage; guide and
docs budget were checked afterward. The full-script initial build/typecheck
predates that fix and has its separate final passing record. The corrected quiet
test was run after the client stage failed. The full script was not rerun:
this remains a red run, with final scoped passing evidence rather than a
final-tree all-green full-suite claim. The inherited 60-second target remains
missed; no budget or timeout was raised.

## Wasm

Canonical full-script build: **2,040,529 B raw; 592,975 B gzip**.
Cap **593,719 B gzip**, margin **744 B**. No Rust or budget changes.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
[wasm.json](wasm.json) uses the build script's exact `gzip -9 -c <artifact>`
measurement.

## Reproduction

From `snapback4/`:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/answers-stay-round3.test.mjs
RL_ORACLE_OUT=reports/20260929-rl-answers-stay/round3/oracle-final node --test packages/snapback4/test/mixed-evidence-oracle.test.mjs
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```

`RL_TEST_SDK` / `RL_ORACLE_SDK` select copied distributions for controls.
Mutation copies are under ignored `target/rl-round3-*`; source changes and test
output record exactly what was removed. No destructive cleanup or external
publication is part of this work. Final commit uses the requested trailer:
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
