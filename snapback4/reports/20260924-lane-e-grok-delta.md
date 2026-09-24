# Lane E Grok delta — shared logout epochs, conditional cleanup and hex proof

Follow-up: [the final delta](./20260924-lane-e-final-delta.md) fixes quota-time
logout and automatic-refresh restoration, and adds a mutation-tested cross-tab
Chromium witness. Results below remain the historical qualification.

Date: 2026-09-24. Review base: `4e21d8688`; branch: `sb4-intent/e-client`.
Implementation commit: `3e72df5ea`. No push or publication.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Store a logout epoch alongside the session. Capture it before sign-in and with restoration, check ownership when refresh starts, and compare it under the session lock before every scoped session save. Explicit logout increments it in the same critical section as deletion. An obsolete successor is revoked and its runtime retired without deleting a newer account. Restore cleanup compares the exact bytes read, does not revoke, and retries when a replacement won. |
| `packages/snapback4/src/auth.ts` | Limit the parsing catch to parsing/validation. A conditional-cleanup conflict or store failure now propagates to the app instead of triggering a second delete. |
| `packages/snapback4/test/app.test.mjs` | Nine new real-server cases for shared logout, delayed sign-in, damaged/expired cleanup, and refresh after failed remote revocation. Existing timing barriers now wait for refresh to finish epoch capture and reach the transport before holding the session lock. |
| `packages/snapback4/test/app-storage.test.mjs` | Add `ab`/`慢` to the generated Expo SecureStore custody cases and key-uniqueness assertions. The encoding implementation itself is unchanged. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document the shared epoch, obsolete-client retirement and conditional non-revoking restore cleanup in §4. |
| `JOURNAL.md` | Append this round's changes, measurements and limits. |
| `reports/20260924-lane-e-client.md`, `reports/20260924-lane-e-delta.md`, this report | Link the handoff to this qualification while retaining earlier results. |

## Findings and tests

1. **Delayed successor after another app's logout — fixed.** Four cases cover
   online/process-device A, with B either remaining signed-out or logging in as
   Bob. A's real `/auth/refresh` has committed and its response is held. B logs
   out, advances the stored epoch, and optionally logs in as Bob. After A's
   response is released, A becomes signed-out, its successor is refused by the
   real server, and storage remains empty or contains Bob's bearer. A restarted
   app restores that expected account, and Bob can still query.

   Another test holds an issued guest sign-in across B's logout and later login.
   The old sign-in returns a typed refusal, its issued token is revoked, and
   Bob's stored session remains valid. A further case starts refresh *after*
   shared logout while remote logout had failed: the server still accepts the
   old bearer, but the epoch check refuses refresh before network dispatch.

2. **Damaged-session cleanup revoking a concurrent replacement — fixed.** Two
   cases use `NOTJSON` and an expired stored session. B reads the damaged bytes;
   A's real refresh queues its replacement save ahead of B's cleanup. Cleanup
   compares the original bytes under the session lock and restarts restoration
   on mismatch. Storage and both clients end with A's valid successor. A
   separate expired-record test verifies that cleanup deletes matching bad
   bytes without issuing logout or revoking the bearer another runtime holds.

3. **Hex padding test gap — fixed.** The generated Expo adapter now signs in
   as `ab` and `慢`, queues/replays their account-owned writes, and verifies
   separation. The uniqueness assertion includes both segments: removing
   `.padStart(4, "0")` makes the test fail because both become `6162`.
   The temporary mutation was confined to the built file, then restored.

There are **ten new test cases**: nine real-server lifecycle cases and one
generated-adapter principal pair. Existing encoding assertions were also
strengthened. The original eight new race/cleanup cases all failed against
the pre-fix code (`/tmp/lane-e-grok-delta-before.log`), proving the reported
failures before implementation. The final refresh-start case was added during
verification.

The first focused attempt exposed an old fixture assumption: `refreshSession()`
now reads the epoch before entering fetch, so immediately logging out could
cancel it before the test's held response existed. The test
`online logout completes while rotation is stalled and revokes the late successor`
failed waiting for that never-issued successor. An older restoration barrier
also held the session lock before refresh could capture its epoch, causing a
fixture deadlock; that focused test tree was stopped. These were **ours,
corrected**: barriers now wait for transport entry after epoch capture, and
cleanup releases gates before closing clients. No outcome assertion was
removed. `/tmp/lane-e-grok-delta-focused.log` records that attempt; the next
focused run passed **45/45** (`/tmp/lane-e-grok-delta-focused2.log`).

## Forms and examples

No new Quarry forms or public client methods. Existing forms retain their types:

- `const app = createApp({ url, sessionStore }); await app.ready;` restores with
  a captured epoch and safely retries concurrent replacement during cleanup.
- `await b.auth.logout(); await b.auth.login("bob@example.com", "password-b");`
  prevents A's previously started refresh/sign-in from replacing Bob's session.
- `await a.client.refreshSession();` refuses before dispatch when A's ownership
  epoch is already obsolete. A successor arriving from an earlier in-flight
  refresh cannot be persisted and is revoked.
- `await app.mutate(api.write, { body: "own intent" });` keeps distinct journals
  for `ab` and `慢` through the generated SecureStore adapter.

## Verification

- Final affected app/custody/storage, React, README, starter, identity,
  local-signout and online/session-security run: **136 passed, zero failed**.
  `/tmp/lane-e-grok-delta-final-affected.log`. The preceding run passed 135
  before the final refresh-start case was added.
- Hex-padding mutation: **detected**. The intentionally weakened run fails the
  uniqueness assertion; the original built file was restored before subsequent
  tests. `/tmp/lane-e-grok-delta-hex-mutation.log`.
- Chromium starter witness: **passed**, including the previously timed-out
  failed worker-update phase, account isolation, durable replay, active-build
  navigation and unused lazy chunks offline. `/tmp/lane-e-grok-delta-starter.log`.
- Chromium cold-offline witness: **passed**, 1,575 ms on this run, with account
  and replica restored on a fresh page/reload after both servers stopped.
  `/tmp/lane-e-grok-delta-cold-offline.log`. This is not a performance claim.
- An earlier complete run finished `== 1 failure(s) in 109 s`, cargo aggregate
  only, with the four Rust baseline failures below. It preceded the final
  refresh-start test and use of the standard `Response` constructor instead of
  requiring the static `Response.json` helper. The final run qualifies those
  last changes too. `/home/ccheever/sb4-intent/lane-e-grok-delta-test.log`.

## Decisions, deviations and remaining limits

All three findings are addressed; there are no deviations from this brief.
The epoch is a separate decimal counter at the safe session key plus `.epoch`;
an absent marker means zero. It survives bearer deletion, and increment and
delete use the same existing session lock. The owner remains bound to its
captured epoch instead of acquiring new ownership after someone else logs out.
Cleanup comparison uses exact serialized bytes, so malformed JSON needs no
token extraction and never enters the revoking logout path.

No Client contract, engine authorization, disclosure, meter or ceiling changed.
No native Expo simulator or integrated target-Clique run was added. The existing
pre-release storage-migration limit remains. Separate non-browser processes
sharing a custom store still need external serialization; browser apps use
the existing Web Lock, and apps within a runtime share its lock queue.
No open defect from this review remains. Baseline failures are reported with
reproductions in the complete-suite result below.

## Exact final complete-suite result and every failure

`scripts/test.sh` exited 1:

```text
== 2 failure(s) in 159 s
   cargo test
   client tests
```

Log: `/home/ccheever/sb4-intent/lane-e-grok-delta-final-test.log`. Across all
eight client test processes: **1,083 passed, 10 skipped, one failed**.
The build, wasm, documentation budget, release guard, package/reference-app
typechecks and fixture-wrapper checks passed. Every new app/storage test passed.

The four Rust failures also occur in the untouched host baseline,
`/home/ccheever/sb4-intent/baseline-test.log`:

| Classification | Failed test | Reproduction from `snapback4/` |
|---|---|---|
| Baseline | `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The additional client failure is **environmental/timing-sensitive**, not a
failure present in that baseline:
`stopped full-release restore preserves its recovery point and stays separate from the original`,
`packages/snapback4/test/release-activation.test.mjs:335`, expected `parked`
but observed `done`.

The unchanged fixture makes the schedule immediately due before starting its
server. It then signs up, uploads an asset, and inserts the first row. If the
scheduler runs before that insert, its job sees an empty table and completes;
the `require false` inside the row loop is never reached. These steps use raw
HTTP and the unchanged Rust scheduler, before the test opens any client. The
test file has no changes from lane base `6d9f3e001`.

The original test passed in the untouched baseline, the first full run in this
round, and the isolated rerun (**1/1**):

```sh
node --test --test-name-pattern='stopped full-release restore' packages/snapback4/test/release-activation.test.mjs
```

`/tmp/lane-e-grok-delta-release-rerun.log`. A temporary copy with
`await delay(1500);` at the beginning of this test's first `serve` callback,
before signup/insert, deterministically reproduced the same `done` versus
`parked` assertion. `/tmp/lane-e-grok-delta-release-timing.log`. The temporary
copy was removed; the unrelated fixture remains unchanged. These five
full-suite failures remain open outside the review fixes. No lane-introduced
failure remains in the final affected or full-suite results.
