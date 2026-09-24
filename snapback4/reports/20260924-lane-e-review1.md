# Lane E review round 1 — five Astra findings

Date: 2026-09-24. Base for this review round: `54eb98707` on
`sb4-intent/e-client`. Implementation commit: `cfadff4d9`. No push or publication.

## Changes and regression evidence

1. **Logout and held network work.** `packages/snapback4/src/app.ts` now gives
   each opening/retiring client a guarded session store. Logout invalidates
   those guards synchronously, fences the current client, cancels backend
   acquisition, and deletes credentials outside the auth/network queue.
   Remote revocation and transport teardown run in the background. Stale
   restoration cannot save a bearer or publish a new identity. The new online
   and local cases in `test/app.test.mjs` hold `/auth/logout` and, for local,
   `/schema`; logout completes and a second runtime sees signed-out before
   either request is released. Releasing them does not restore the bearer.
2. **Ordinary close during rotation.** `src/client.ts` retains session
   listeners until existing refresh work drains and allows that refresh to
   deliver its replacement after close starts. `src/app.ts` retains the
   session's persistence ownership until cleanup drains. Sign-out still ends
   credentials and cancels adoption. Two real-server tests (online and process
   device) commit a rotation, hold its response, close the app, release the
   response, and verify that the new token is kept, the old token is refused,
   and a fresh app restores and reads successfully.
   `test/online-session.test.mjs` deliberately replaces the old expectation
   that ordinary close discards rotation; it now requires the replacement
   callback while proving new reads and refreshes still refuse `E_CLOSED`.
3. **Shared settlement notifications.** `src/app-online.ts` deduplicates
   emissions per client using the existing bounded WriteHistory facility.
   Notification is independent of which owner removed the shared pending
   entry. The new Chromium React case has two online apps, the same store/ID,
   and two `usePendingWrite` hooks. A settles first, then B receives its replay;
   both hooks become sent without polling `write(id)`, with one notification
   per owner. Removing notifications makes this test fail.
4. **One deployment per active shell.** `bin/web-shell.js` serves navigation
   HTML from the active cache online as well as offline. The new worker unit
   case and extended `witness/starter.mjs` deploy B while A controls a page,
   navigate online, then import A's previously unused lazy chunk offline.
   They verify A's HTML/chunk remain together until activation switches both
   to B. API and cross-origin passthrough remain unchanged.
5. **Bounded settled argument state.** `src/app-online.ts` calls the wrapper's
   `MutationIds.finish()` only after durable terminal settlement, also when
   another owner already retired the entry or its receipt is collected.
   New `test/app-online.test.mjs` admits and asynchronously settles 300 IDs
   through each of two owners. Both owners retain at most 256 argument
   identities, zero pending reservations, and each emits 300 terminal events.

`CLIENT-AND-OPERATIONS.md` documents local logout completion, rotation-preserving
ordinary close and active-build navigation. No API vocabulary, engine rule,
Client contract, meter or ceiling changed.

## Verification

- Package build/typecheck succeeded. All 11 online-session tests passed
  (`/tmp/lane-e-r1-online-session.log`).
- `node --test packages/snapback4/test/app.test.mjs packages/snapback4/test/app-online.test.mjs packages/snapback4/test/react.test.mjs packages/snapback4/test/web-shell.test.mjs`:
  **37 passed, 0 failed**, `/tmp/lane-e-r1-focused2.log`.
- `node witness/starter.mjs`: **passed**, including the previously timed-out
  failed worker-only update, old-tab assets, B activation, online navigation
  staying on A and its unused lazy chunk loading offline.
  `/tmp/lane-e-r1-starter2.log`.
- `node witness/web-shell.mjs`: **passed**, 1,431 ms; fresh offline page and
  reload restore account and replica with both servers stopped.
  `/tmp/lane-e-r1-cold-offline.log`.
- Full `scripts/test.sh`: exit 1, exactly:

  ```text
  == 2 failure(s) in 123 s
     cargo test
     client tests
  ```

  `/home/ccheever/sb4-intent/lane-e-review1-test-final.log`. The failed cargo
  aggregate contains the same four failures in the unmodified host baseline:

  - **Baseline:** `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`.
    Reproduce: `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`.
  - **Baseline:** `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`.
    Reproduce: `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`.
  - **Baseline:** `census::authoring_census`.
    Reproduce: `cargo test -p snapback4-device --test readauth census::authoring_census`.
  - **Baseline:** `w9b_why_operation_keeps_residency_and_cost_output`.
    Reproduce: `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output`.

  Client totals: **1,016 passed, 10 skipped, 1 failed**. The one failure was
  `MQ interrupted snapshot process: retained history and independent held coverage`,
  `test/retained-history.test.mjs:299`: raw HTTP `post("/m/join", ...)` returned
  `ECONNRESET` after the fixture server was killed and restarted. That request
  uses the test's global fetch, not the changed app/client paths. The isolated
  rerun passed (1/1):
  `node --test --test-name-pattern='MQ interrupted snapshot process' packages/snapback4/test/retained-history.test.mjs`.
  `/tmp/lane-e-r1-retained-recheck.log`. Classified **environmental/intermittent**,
  not a proven baseline failure; the transport's root cause remains unconfirmed.

  An earlier full run was `== 2 failure(s) in 149 s`, containing the same
  four baseline Rust failures and the old ordinary-close assertion in
  `online-session.test.mjs:181`. That assertion failure was **ours, fixed**:
  it pinned the behavior finding 2 explicitly changes. The revised test
  checks preserved rotation and continued refusal of operations after close,
  passed all 11 targeted session tests, and passed in the final full run.

## Earlier starter witness timeout

The original lane report's unqualified update phase is now qualified. The
existing timeout assertion was kept, with request diagnostics on failure;
no browser update check was removed or skipped. The witness first passed with
this round's fixes, then passed with the stronger A/B navigation/lazy-import
checks. The earlier timeout's precise cause has not been isolated, so this
report does not call it a pre-existing witness defect or attribute its
resolution to a particular patch. Its prior logs remain recorded in the
original lane report.

## Scope and remaining work

All five review findings are addressed. The second review family is still
pending. Baseline Rust failures and the intermittent restarted-server HTTP
reset remain outside this lane; reproductions and attribution are above. No native Expo
simulator or integrated target-Clique run was added in this review round.
