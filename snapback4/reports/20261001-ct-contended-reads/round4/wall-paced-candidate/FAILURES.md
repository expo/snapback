> Archived rejected wall-time pacing candidate. Its “final” labels below refer
> to that candidate, not the final round-4 source. The complete suite ran once
> on this candidate; the revised CPU-time candidate has a separate qualification.

# Round-4 failure ledger

The sole `scripts/test.sh` invocation on final source reports exactly
**`== 2 failure(s) in 1561 s`** (exit 1), listing `wasm build` and `client tests`.
All Rust targets, fixture tests, guide/docs/typechecks and all 79 client models
pass. The raw log and exit are retained in `qualification/test-sh.*`. No failure
is omitted because a later scoped rerun succeeds. The complete suite is not
repeated, and this shared-host duration does not qualify the 60-second budget.

## Development and affected qualification

- **Ours, corrected:** the new `row_keyed_views` test used unconstrained
  `.collect()` when passing an `IntoIterator` to `Engine::memory`, producing
  E0283. `maintenance-core.log`, exit 101. Removed the unnecessary collection;
  `maintenance-core-final.log` passes all 32 row-view, 6 schedule and 17
  Following tests. This was a test compile error, not an observed product fault.
- **Ours, corrected:** the guide's reviewed `E_NATIVE_TRAP` definition pin still
  said resource row ceilings always bind first after the card was clarified to
  say usually. `guide.log`: 109 passed, one failed,
  `definitions::w11_every_registered_code_quotes_its_definition`. Updated that
  fact pin to the reviewed wording; `guide-final.log`: all 110 passed. The
  atomic native-call exception and numeric fuel/meter ceilings remain explicit.

## Full-suite artifact custody

- **Environmental, inherited local artifact contamination:** the wasm build
  selected the archived main control's cached output, exactly 2,032,879 B raw /
  610,174 B gzip, exceeding this branch's unchanged 605,225 B ratchet by 4,949 B.
  `stale-wasm-custody.json` proves identical SHA-256 to the isolated-main output
  from round 3 (`bb75d9b42a29bd6aa3f824d1c1c0faa92e6687710f028db100b04613b3440043`).
  The cached `.d` names `target/ct-round3/current-main/...` source paths; that
  archived checkout's target is a symlink to this lane's target. Cargo treated
  the old web build as fresh. This is not attributed to a product-size change.
  The sole suite continues without modifying its active client artifacts;
  correction and exact-source verification are recorded after it finishes.

## Client failures with the contaminated wasm

**Environmental artifact mismatch:** 23 `event-slots.test.mjs:44` cases and
one `codec.test.mjs:15` case compare device replies. The stale main wasm adds
`preserved: []` to the apply reply; the native lane artifact and lane fixtures
expect the branch's reply without that main-only field. These are not attributed
to a new event-slot semantic defect. The corrected-artifact client result is
retained separately. Every affected test name follows:

- `the shipped page codec validates unknown JSON values and accepts valid extensions`
- `event slots wasm: birth order, whole floor, removal normalized across commits`
- `event slots wasm: snapshot catches delete before serving insert`
- `event slots wasm: snapshot catch-up replaces a reused source id`
- `event slots wasm: ordinary event reads with sync public last 1 by .at`
- `event slots wasm: ordinary event reads with online only`
- `event slots wasm: aggregate fence online=false`
- `event slots wasm: aggregate fence online=true`
- `event slots wasm: held floored unrepost aggregate online=false`
- `event slots wasm: held floored unrepost aggregate online=true`
- `event slots wasm: conditional original removal aggregate online=false`
- `event slots wasm: conditional original removal aggregate online=true`
- `event slots wasm: two declarations share sources and retire independently`
- `event slots wasm: slot activation with literal default, interrupted before source pages`
- `event slots wasm: normalized source slots survive deferred fold and reopen`
- `event slots wasm: unheld original/repost removal and repost insertion queue`
- `event slots wasm: event id reuse full-originals=false split=false`
- `event slots wasm: event id reuse full-originals=false split=true`
- `event slots wasm: event id reuse full-originals=true split=false`
- `event slots wasm: event id reuse full-originals=true split=true`
- `event slots wasm: held live/reply/removed and server unrepost: sync public, sync public`
- `event slots wasm: held live/reply/removed and server unrepost: sync public, sync public last 10 by .at`
- `event slots wasm: held live/reply/removed and server unrepost: sync public last 10 by .at, sync public`
- `event slots wasm: held live/reply/removed and server unrepost: sync public last 10 by .at, sync public last 10 by .at`

**Baseline test-harness flake, exact scheduling cause unresolved:**
`48 transient: local.ts:855 follow` fails the same assertion as the operator's
already-ticketed main flake: “the classified await must actually experience an
injected fault.” This mocked-transport test never starts CT's server scheduler.
The client fault code/test is unchanged. The initial run also used the stale
wasm, so its artifact context is retained rather than claiming an independent
product baseline reproduction. The existing tracking record is
[the follow fault-injection issue](../../../../../issues/20261002-snapback4-follow-fault-injection-reachability.md).
No duplicate issue or unrelated fault-injection source change is introduced.

Initial client totals: **5,717 passed, 25 failed, 10 skipped (5,752 tests)**.
The 25 failures are exactly 24 reply-shape mismatches plus the fault reachability
assertion above. All raw failure stacks remain in `qualification/test-sh.log`.

Scoped cache repair removed 24 wasm-profile package files (139.6 MiB), then
`wasm-final.log` rebuilt **2,015,329 B raw / 605,002 B gzip**, within the
unchanged **605,225 B** budget by **223 B**. The new dependency record contains
only this lane's source paths, and the artifact digest is retained in
`wasm.json`. All recorded source digests are unchanged. The following client
rebuild passes; the client/model verification uses this corrected artifact.

Fresh-artifact client verification: **5,741 passed, one failed, 10 skipped**
(5,752 tests; `client-final.log`, exit 1). All 24 contaminated-artifact failures
pass. The sole remaining failure is **baseline harness**:
`48 persistent: local.ts:855 follow`, the same missed-injection assertion in
`delivery-fault-matrix.test.mjs:264`. This recurrence uses the correct lane wasm;
it is not an excuse to classify the earlier reply-shape mismatches as baseline.
The fault matrix is also run once outside the concurrent file pool after models.

All **79 fresh-artifact models pass**. The one isolated fault-matrix invocation
finishes **320 passed, one failed** (`fault-matrix-final.log`, exit 1):
`48 transient: local.ts:855 follow`, again the missed-injection assertion. Site
48 persistent passes in this run. This known baseline harness red remains
unresolved; no green-matrix claim is made and no further retry is used to select
a passing result. The complete suite still has exactly one invocation.
