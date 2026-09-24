# Lane E final delta — quota cleanup, restoration retry and cross-tab proof

Date: 2026-09-24. Review base: `7d4b3ac7f`; branch: `sb4-intent/e-client`.
Implementation commit: `0e64a2b21`. No push or publication.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | An epoch-write failure no longer skips bearer deletion. Retry the same epoch after deletion, within the same lock, and propagate a remaining failure. Pass the restoration comparison flag through cleanup when the constructor has already lost its session. |
| `packages/snapback4/test/app.test.mjs` | Three real-server regressions: full storage, persistent marker-write failure, and automatic near-expiry refresh rejection while opening the journal. |
| `witness/app-sessions.mjs` | Two independent Chromium pages race a paused session write against logout and Bob's login through shared localStorage. A third page verifies account restoration; the real server verifies successor revocation. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document deletion despite marker failure, retry after freeing space, and remaining errors in the result and `auth.why`. |
| `JOURNAL.md` | Append this round's fixes, measurements and limits. |
| `reports/20260924-lane-e-client.md`, `reports/20260924-lane-e-grok-delta.md`, this report | Point the handoff to the final delta qualification while retaining historical results. |

## Findings and tests

1. **Quota during logout — fixed.** The test store permits reads, deletes and
   unchanged-value writes. After sign-in it has no room for a new epoch key,
   and network access is disabled. Logout must attempt credential deletion,
   retry the marker exactly once, persist epoch `1`, and reopen signed-out.
   A second case keeps refusing marker writes even after deletion: credentials
   are still absent, reopening stays signed-out, and logout returns `E_CLIENT`
   with the same refusal in `auth.why`.

2. **Rejected constructor refresh — fixed.** B rotates the bearer on the real
   server but holds its response. A restores a near-expiry snapshot and opens
   its journal behind a barrier; its automatic refresh receives `E_AUTH`.
   B then saves the successor before A's journal opens. A retries restoration
   and becomes signed-in with that successor; storage and both clients remain
   valid. Cleanup no longer returns `E_CLOSED` for this interleaving.

   All three cases failed against the reviewed implementation, before the fixes:
   the quota cases recorded zero deletion attempts and the constructor case
   failed to restore. `/tmp/lane-e-final-before.log`. The complete app file then
   passed **34/34**: `/tmp/lane-e-final-app.log`.

3. **Cross-tab locking proof — added and mutation-tested.** Page A pauses its
   rotated session write after reading the epoch, inside the session critical
   section. Page B starts logout followed by Bob's login. The witness waits for
   either B's queued Web Lock or completion of its login, then releases A. With
   the lock, B runs after A's write; storage and a newly opened page restore Bob,
   and Alice's successor is revoked. Separate pages have separate module-level
   promise queues, so those queues cannot serialize this test.

   Removing only the `navigator.locks.request` branch from built
   `dist/app-storage.js` makes the witness fail at **"Alice's delayed save must
   not replace Bob across tabs"**. The unmodified artifact was restored in a
   `finally` block. `/tmp/lane-e-final-tabs-no-web-locks.log`. The positive run
   then passed in Chromium: `/tmp/lane-e-final-tabs.log` (773 ms, not a
   performance claim).

   The first witness attempt was too weak: this installed Playwright's
   `waitForFunction` accepted the async predicate's promise before the false
   result. The negative run incorrectly passed. This was **ours, corrected**:
   the witness now explicitly awaits each `page.evaluate` result in a bounded
   Node polling loop. The mutation then failed on the account assertion and
   the unmodified implementation passed. No production locking change was
   needed for this finding.

## Forms and examples

No new Quarry form or public method was added. These existing forms are now
qualified for the reported interleavings:

- `await app.auth.logout()` deletes a persisted bearer even when the first
  epoch write exceeds quota; a remaining storage failure is a typed result.
- `const app = createApp({ url, sessionStore }); await app.ready;` retries a
  concurrent successor even when automatic refresh rejected the restored
  snapshot before journal opening completed.
- `await a.client.refreshSession();` racing another tab's
  `await b.auth.logout(); await b.auth.login(email, password);` preserves B's
  final account through the shared Web Lock.
- `npx snapback4 web-shell dist --base /chat/` remains qualified by both existing
  Chromium shell witnesses; it was unchanged this round.

## Verification

- Package build and typecheck passed. `/tmp/lane-e-final-build.log`,
  `/tmp/lane-e-final-typecheck.log`.
- App/custody/storage, React, README, starter, first-account, identity,
  local-signout and online/session-security tests: **139 passed, zero failed**.
  `/tmp/lane-e-final-affected.log`.
- Two-page session witness: **passed**; removal of Web Locks: **detected**.
  `node witness/app-sessions.mjs`.
- Existing production starter witness: **passed**, including the previously
  timed-out failed-update phase, active-build navigation, later activation and
  unused lazy chunks offline. `/tmp/lane-e-final-starter.log`.
  `node witness/starter.mjs`.
- Cold-offline shell witness: **passed**, fresh-page account/replica restoration
  and reload after both servers stop (1,526 ms, not a performance claim).
  `/tmp/lane-e-final-cold-offline.log`. `node witness/web-shell.mjs`.
- Initial complete run: **`== 1 failure(s) in 233 s`**, the cargo aggregate.
  `/home/ccheever/sb4-intent/lane-e-final-delta-test.log`. This was
  **environmental**: the shared disk had only 535 MB free, and both linking
  `snapback4-core`'s `lane_source` test and archiving `snapback4-device` failed
  with `No space left on device`. Rust test artifacts therefore did not run;
  workspace doctests passed. Client tests passed **1,087**, with **10 skipped**
  and no failures. Clearing only this worktree's disposable incremental cache
  freed about 15 GB before requalification; no other lane's files were removed.

## Decisions, deviations and remaining limits

All three findings are addressed, with no deviation from this round's brief.
The retry retains the computed epoch, including if a store writes and then
throws, so a retry never increments twice. Deletion and both marker attempts
stay under the existing lock. No authorization, disclosure, durability, engine
meter, Client contract or ceiling changed.

Chromium was available and the witness ran on this Linux host. It remains an
explicit browser witness, like the existing ones, rather than adding a browser
dependency to the blocking unit suite. No native Expo simulator or integrated
target-Clique qualification was run. Custom stores shared by independent
non-browser processes still require external serialization, as documented.
No open defect from this review remains. Unrelated complete-suite failures and
their reproductions are recorded below.

## Complete-suite failures and reproductions

The final `scripts/test.sh` run exited 1 with this exact result:

```text
== 1 failure(s) in 185 s
   cargo test
```

Log: `/home/ccheever/sb4-intent/lane-e-final-delta-retest.log`. Across all eight
client test processes: **1,087 passed, 10 skipped, zero failed**. Build, wasm,
documentation budget, release guard, package/reference-app typechecks and the
nine fixture-wrapper tests passed. Every added regression passed. The earlier
acquisition/release-recovery timing failures did not recur in either full run.

The first run's two artifact-build failures are environmental and described
above. The second run successfully rebuilt and exercised those Rust targets.
Its four test failures also occur in the untouched baseline at
`/home/ccheever/sb4-intent/baseline-test.log`:

| Classification | Failed test | Reproduction from `snapback4/` |
|---|---|---|
| Baseline | `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

Earlier unrelated timing defects remain outside this round: the acquisition
fixture can settle a write before asserting it is pending, and the
release-recovery fixture can finish its scheduled job before inserting the row
that would park it. Their controlled-delay reproductions and source attribution
remain in [the earlier delta report](./20260924-lane-e-delta.md) and
[the Grok delta report](./20260924-lane-e-grok-delta.md), respectively.

No lane-introduced test failure remains. The four baseline Rust failures and
the earlier unrelated timing defects remain open outside these review fixes.
