# Lane E delta review — restoration, auth cleanup, exported routes and journal proof

Follow-up: the [Grok delta](./20260924-lane-e-grok-delta.md) adds shared logout
epochs, conditional garbage cleanup and a stronger hex-encoding test.
The results below remain this earlier round's historical record.

Date: 2026-09-24. Review base: `213a20cdd`; branch: `sb4-intent/e-client`.
Implementation commit: `134867486`. No push or publication.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Compare restoration saves with the token read, under the existing shared session lock; restart opening when another app changed storage. A stale opening closes without revoking the winning session family. Constructor refusal also restarts when its conditional deletion finds a successor. Auth rejection captures the current revision rather than the original opening revision. |
| `packages/snapback4/bin/web-shell.js` | Resolve cached directory indexes and extensionless HTML pages before the root entry, while retaining active-build navigation online and offline. |
| `packages/snapback4/test/app.test.mjs` | Four real-server restoration interleavings and two auth-rejection regressions, across online and process-device clients. |
| `packages/snapback4/test/app-storage.test.mjs` | Transplant a valid journal between backends for the same principal through the generated Expo SecureStore adapter. |
| `packages/snapback4/test/web-shell.test.mjs` | Two routing tests, at `/` and `/chat/`, exercising exported subpages online and offline. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document conditional restoration and exported-page navigation in the existing client/offline-shell sections. |
| `JOURNAL.md` | Append this round's changes, measurements and limits. |
| `reports/20260924-lane-e-client.md`, `reports/20260924-lane-e-review2.md`, this report | Point the handoff at the delta and retain the historical verification records. |

## Findings and regression evidence

1. **Stale restoration — fixed.** A captures the old bearer; B rotates it while
   A is paused, queues its successor save ahead of A's opening saves, then A
   resumes. Tests record every save and assert that no old token follows the
   successor. A finishes with that successor, storage retains it, and both apps
   can query. Separate tests pause online/local restoration before its first
   save, online restoration before its final save, and local restoration
   during backend acquisition. The last case proves that an old bearer's
   server refusal restarts opening without revoking B's session family.
2. **Auth rejection after failed login — fixed.** Both real-server tiers sign
   in, attempt a refused login without replacing the client, revoke the
   original session externally, and receive `E_AUTH` on refresh. They finish
   signed-out with null viewer and no restorable credentials. Cleanup uses
   the revision captured at rejection, so it still yields to a later auth
   operation.
3. **Exported subpage regression — fixed.** Tests install the generated worker
   over fixtures with `about/index.html` and `contact.html`. Both online and
   offline, `/about/` and `/about` resolve the directory index, `/contact`
   resolves the HTML file, and query strings do not change that selection.
   Direct `.html` navigation still works, unknown routes still use root HTML,
   and navigation issues no network fetch. The same assertions run at `/chat/`.
4. **Backend check test gap — fixed.** A queues a write, closes, and its exact
   valid journal bytes are placed at B's key for the same principal. B signs
   in through the generated Expo adapter, preserves the foreign bytes under
   a side key, publishes `auth.why`, and sends no inherited intent. Its own
   new write succeeds; A's original journal is unchanged. Removing only
   `value.backend !== backend` from the built validator makes this test fail;
   restoring the check makes it pass. No validator behavior changed here.

The initial regression run reproduced all three code bugs (seven failing
cases before the additional backend-acquisition case was added). These were
lane defects and are fixed; the journal test already passed with its guard.
The deliberately weakened backend-check run is an expected negative proof.
Logs: `/tmp/lane-e-delta-before.log` and
`/tmp/lane-e-delta-backend-mutation.log`.

## Forms and examples

No new authoring forms or refusal codes. Existing forms now handle these cases:

- `const app = createApp({ url, sessionStore }); await app.ready;` restarts a
  stale restore with the current saved bearer. Supplying `device: processDevice(...)`
  follows the same session rule for a local client.
- `await app.auth.login(email, wrongPassword); await app.client.refreshSession();`
  leaves the app signed-out if that retained session is subsequently refused.
- `snapback4 web-shell dist --base /chat/` serves `/chat/about/` from
  `dist/about/index.html`, and `/chat/contact` from `dist/contact.html`, online
  and offline under the active worker.
- `await app.mutate(api.write, { body: "own intent" });` still persists and
  recovers only this backend/account's journal.

## Verification

- Package build passed. Final affected app, custody, storage, React, README,
  starter and shell run: **87 passed, zero failed**.
  `/tmp/lane-e-delta-affected.log`.
- Backend guard mutation: **detected**; original built file restored afterward.
- `node witness/starter.mjs`: **passed**, including failed same-assets worker
  update preservation, old-tab assets, new-build activation, active-build HTML,
  unused lazy chunks offline, account isolation and durable replay.
  `/tmp/lane-e-delta-starter.log`.
- `node witness/web-shell.mjs`: **passed**, including fresh offline navigation,
  reload, account restore and replica data with both servers stopped; 3,481 ms
  on this run, not a performance claim. `/tmp/lane-e-delta-cold-offline.log`.
- Complete `scripts/test.sh`: exit 1, exactly:

  ```text
  == 2 failure(s) in 146 s
     cargo test
     client tests
  ```

  Log: `/home/ccheever/sb4-intent/lane-e-delta-test.log`. Package typecheck,
  build, docs budget, release guard, both reference-app typechecks and fixture
  tests passed. Across all eight client test processes: **1,073 passed,
  10 skipped, one failed**. Every failure is accounted for below.

## Full-suite failures and open problems

These four Rust failures also appear in the untouched host baseline,
`/home/ccheever/sb4-intent/baseline-test.log` (`== 1 failure(s) in 276 s`):

| Classification | Failed test | Reproduction from `snapback4/` |
|---|---|---|
| Baseline | `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| Baseline | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| Baseline | `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| Baseline | `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The additional client failure is **environmental/timing-sensitive**, not a
failure present in that baseline:
`W5c process: pending writes recover by id through sent and failed, including settlement before reopen returns`,
`packages/snapback4/test/acquisition.test.mjs:375`. After offline reopen it
expected `pending` but found `sent`. The unchanged fixture blocks `/sync` but
permits `/probe` and `/m/*`; the background probe/flush can settle a write
before close. Both this test and `src/local.ts` have no changes from lane base
`6d9f3e001`; this path uses `createLocalClient` with a development persona and
does not call `createApp` or use session persistence.

The unmodified isolated rerun **passed (1/1)**:

```sh
node --test --test-name-pattern='W5c process: pending writes recover' packages/snapback4/test/acquisition.test.mjs
```

Log: `/tmp/lane-e-delta-acquisition-rerun.log`. To reproduce the scheduling
race deterministically, insert `await sleep(1500);` immediately before this
test's first `await client.close()`: a temporary test copy then observed `sent`
after offline reopen, matching the full-suite failure. That probe is recorded
in `/tmp/lane-e-delta-acquisition-timing-close.log`; the temporary file was
removed. A delayed initial pending check also exposes background settlement
(`/tmp/lane-e-delta-acquisition-timing.log`). The fixture remains unchanged;
none of the review fixes changes its dispatch or receipt behavior.

No lane-introduced full-suite failure remains in this run. The four baseline
Rust defects and the timing-sensitive acquisition assertion remain open
outside this review's scope.

The previously timed-out starter update phase passes again. Its earlier exact
cause was never isolated, so this does not classify that timeout as a proven
pre-existing witness defect. The assertion remains in place; see the
[round 1 qualification](./20260924-lane-e-review1.md#earlier-starter-witness-timeout).

## Scope and decisions

All four delta findings are addressed. There are no deviations from this
review brief. Where routing precedence was unspecified, exact exported paths
win, followed by `.html`, then `/index.html`, then the root SPA entry; trailing
directory slashes resolve directly to `index.html`. Restoration retries from
storage after a conflicting session change and retains the existing logout
cancellation and ordinary-close rotation behavior.

No engine authorization, disclosure, meters, Client vocabulary or ceilings
changed. No native Expo simulator or integrated target-Clique run was added.
The previous round's documented pre-release storage migration limitation and
single-writer requirement for custom stores shared across non-browser processes
remain unchanged. No open delta-review defect remains.
