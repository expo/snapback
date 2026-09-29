# Round 5 failure ledger

## Fixture development (ours)

`regressions.log`: 68 tests, 58 pass, 10 fail.

- `wasm: resubscribing a raw local handle starts a bounded episode`
- `wasm: resubscribing a raw local handle rearms its original episode`
- `process: resubscribing a raw local handle starts a bounded episode`
- `process: resubscribing a raw local handle rearms its original episode`

The fixture used an owner-preserving update rule, which correctly refused its
transfer to Bob. Changed the fixture to `update <- allow`; production rules are
unchanged. These four tests pass in `regressions-final.log` and
`regressions-qualified.log`.

The other six failures, also present in `regressions-final.log` (62/68 pass):

- `wasm keep=undefined: cancellation after checkRead leaves publication and watch state untouched`
- `wasm keep=false: cancellation after checkRead leaves publication and watch state untouched`
- `wasm keep=true: cancellation after checkRead leaves publication and watch state untouched`
- `process keep=undefined: cancellation after checkRead leaves publication and watch state untouched`
- `process keep=false: cancellation after checkRead leaves publication and watch state untouched`
- `process keep=true: cancellation after checkRead leaves publication and watch state untouched`

The cancelled attempt correctly did not publish. Its legitimate retry entered
`fetch`, which notified the unchanged snapshot before assertions ran. Gated the
replacement attempt at the scheduler boundary, isolating the cancelled attempt.
The notification and every watch-field identity assertion remain unchanged.
`regressions-qualified.log`: all 68 pass. No production cancellation fix was
needed; its existing final guard now has isolated detecting coverage.

## Deliberate removal controls (expected failures)

`subscription-acquires.log`: the two `starts a bounded episode` cases above
fail at the required revalidating mark when only the production subscription
is restored to `acquireRead`.

`no-final-abort.log`: the six cancellation cases above fail at the no-publication
assertion when only `signal.aborted ||` is removed from the final callback.
The early signal check, reset, registration, authority and floor guards remain.
The controls run in temporary SDK copies inside this worktree. Source and the
full-suite artifacts are never mutated. `controls-final.log` confirms two and
six expected failures, respectively.

## Setup corrections (ours)

An initial multi-file patch did not apply because the Revised header is one
long line; the successful patch and targeted header edit followed. The first
control-script preparation used a repository-root path from inside `snapback4`
and found no input file. After correcting the path, the mutation anchor matched
two locations and the script refused before running tests (`controls.log`).
Qualifying it with the preceding deadline-restoration call makes it unique.
Neither setup error changed product behavior or qualifies as a test failure.

## Grok follow-up development

`inflight-before.log`: all eight new cases failed at server startup (**ours**, fixture).
The blocker query declared its key as text instead of the table ID type. The
corrected fixture uses `id: blockers`. A diagnostic extraction initially wrote
`main.q`; the check requires `schema.q`. No production parser change.

`inflight-before-fixed.log`: six `changes retire an in-flight local server body
before replacement` cases (wasm/process × omitted/false/true) and two
`invalidating an acquisition leaves replacement queue wait outside the episode`
cases (wasm/process) fail on the unchanged implementation. These are deliberate
pre-fix reproductions of Grok A/B, not fixture errors.

`grok-followup.log`: the six change cases pass; the two queue-wait cases still
fail (**ours**, fixture). Their seven held blockers had never received answers,
so their dependencies were unknown and the notes commit correctly selected them.
Warm each blocker before its held acquisition; now its disjoint dependency is
known. `grok-qualified.log`: 27/27; `inflight-qualified.log`: 9/9, adding online.

Seven isolated removal variants in `controls-grok.log` produce **22 detecting
failures**: subscription 2, invalidation cancellation 6, local schedule episode 2,
local commit episode 2, online schedule episode 1, selective-memory barrier 3,
final cancellation callback 6. They are expected red controls. Each local-only
variant leaves the online case green and the online variant leaves local green.

`expiry-followup.log` fails four cases: the two outdated wakeup assertions below,
plus `expiry retry server pagination watch wasm` and `... process` (**ours**).
`expiry-qualified.log` passes wakeups and still fails those two pagination cases.
The fixture intended to park change delivery after acquisition, but a startup
poll had already returned into asynchronous client processing. The new active
cancellation correctly retired its concurrent query, adding another first-page
request. `expiry-cancel-trace.log` confirms the cancellation originates in
`waitForChange`; its single wasm case is an intentional diagnostic repeat.
Park `/changes` at fixture startup so this expiry/cursor test owns its intended
schedule. Cursor contents and exact request-count assertions are unchanged.

## Required full suite

Main client phase: **4,723 tests, 4,709 passed, four failed, ten skipped**.

| Exact failing case | Attribution | Disposition |
|---|---|---|
| `expiry retry remembered branch timer watch wasm` | Ours: an assertion left over from before round 4's acquisition-only sweep | Require the same snapshot and no invalidation notification until replacement; expiry/freshness/value checks remain. |
| `expiry retry remembered branch timer watch process` | Ours: same obsolete expectation | Same correction. |
| `useQuery and usePage keep canonical arguments across renders, preserving loaded pages` | Environmental: Vite startup failed with `Port 39387 is already in use` before browser assertions | Re-run the unchanged complete React file. |
| `wasm: resubscription delivers saved row expiry without an accessor, keep=false` | Ours: old saved-data expectation contradicts round 5's requested policy transition | Assert immediate loading for false, retained/revalidating for default, and exact row timer withdrawal for both. |

No failure is classified baseline. All **79/79** final model tests pass, as do
all other suite phases. The single invocation exits 1 with exactly:

```text
== 1 failure(s) in 1249 s
   client tests
```

All four full-client failures pass in the **205/205** follow-up covering the
complete expiry-retry, retention-lifecycle and React files
(`full-failures-followup.log`). The full run began before Grok completed; it is not a final-source
full qualification. Follow-up affected checks qualify the later changes.



## Rejected cancellation implementation (ours)

`affected-final.log`: **735/748 passed, 13 failed**. These failures all belong
to the intermediate attempt to cancel every scheduled invalidation, including
cadence-only work. No baseline or environmental exemption is claimed for them:

- `initial backend installation rejects a query already in flight`
- `online: kept typing survives member commits and expires during a held re-read`
- `wasm: kept typing survives member commits and expires during a held re-read`
- `process: kept typing survives member commits and expires during a held re-read`
- `online keep: 1.15 s replies publish on the incomplete 1 s cadence (active)`
- `online keep: 1.15 s replies publish on the incomplete 1 s cadence (lingering)`
- `wasm keep=undefined: a full queue cannot postpone the change transition`
- `wasm keep=false: a full queue cannot postpone the change transition`
- `wasm keep=true: a full queue cannot postpone the change transition`
- `process keep=undefined: a full queue cannot postpone the change transition`
- `process keep=false: a full queue cannot postpone the change transition`
- `process keep=true: a full queue cannot postpone the change transition`
- `worker: 1,000 per-row hooks retain through a relevant write with the real clock`

The initial-backend failure also reproduces alone in `backend-followup.log`.
An online capability refresh cancelled a held query before schema installation,
allowing another request to complete early. Online now keeps its existing
sequence-based retries and starts the deferred episode at the actual retry.
The unchanged backend test and in-flight cases pass **17/17** in
`inflight-backend-final.log`.

Local cancellation on every scheduled refresh could retire slow requests on
each cadence tick and released slots the existing full-queue fixture deliberately
held. Replaced it with a watch change version advanced only by relevant newer
change evidence. Evaluation and final publication check it; ordinary commits
retain their existing authority fence. Observed authority retries rejoin the
queue. Cadence-only refreshes keep the running attempt. The unchanged typing,
boundary and in-flight files pass **30/30** in `change-fence.log`; the final broad
run is recorded separately. No failing timeout or queue-count assertion changed.

A source-line-budget cleanup initially searched for a blank separator absent
from the already compact file; the script refused without editing. Combined
one object-header line instead; `local.ts` remains 1,500 lines.

Final independent controls are in `controls-complete.log` (eight variants,
23 detecting failures) and `final-change-control.log` (only the new final
change-version comparison removed, six detecting failures). The latter crosses
the earlier evaluation/version checks before changing the version. Earlier
control logs remain historical evidence, not the final implementation description.


## Final qualification

`affected-qualified.log`: **954/954**, zero failures/skips/cancellations. It
includes every unchanged case that rejected the intermediate cancellation
implementation, all new regressions, all final full-run failing files, and the
317-case delivery matrix. No known affected product failure remains. The full
suite remains red as recorded above and was not repeated. All deliberate red
controls in this ledger are ours and expected, not baseline or environmental
exemptions.
