# LLP 3000.013 lane E — paved client

Latest follow-up: [review round 2](./20260924-lane-e-review2.md) fixes the
storage ownership, cleanup, shared-session and damaged-journal findings.
Earlier results below remain the historical handoff record.

Date: 2026-09-24. Branch: `sb4-intent/e-client`; base: `6d9f3e001`.
This is implementation and local qualification, not integration or publication.

Review round 1 is recorded in [the follow-up report](./20260924-lane-e-review1.md).
It fixes five findings and qualifies the previously open starter-update witness;
the initial results below are retained as the original lane handoff record.

## Files

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | App-owned auth state, current client, restore/session rotation, account switching, local/online selection, teardown, typed auth refusals and retryable credential deletion. |
| `packages/snapback4/src/app-online.ts` | Per-backend/per-account durable online intents, immutable arguments, same-ID ordered recovery and sanitized terminal receipts; browser Web Locks serialize tabs. |
| `packages/snapback4/src/client.ts` | Online sign-out can clear identity during stalled session rotation and revokes a late successor. |
| `packages/snapback4/src/react.tsx` | `AppProvider` and `useAuth`; existing hooks use the current client and account changes reset the account subtree. |
| `packages/snapback4/package.json` | Public `snapback4/app` entry. |
| `packages/snapback4/bin/snapback4.js` | Dispatch `web-shell` without resolving a platform binary; actionable coded CLI errors. |
| `packages/snapback4/bin/web-shell.js` | Static export enumeration, content-hashed shell cache, idempotent registration, offline navigation fallback and origin/asset restrictions. |
| `packages/snapback4/README.md` | Keep the schema; replace the account controller/manual client wiring with `createApp`, `AppProvider` and `useAuth`. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | App lifecycle, persistence/online custody, Expo and shell build instructions. |
| `crates/snapback4/src/verbs/init.rs` | Expo starter embeds app-owned entrypoints and generates a shell-producing web build. |
| `crates/snapback4/src/verbs/init/expo-client.ts` | Web/native/online device selection, explicit web session persistence and native SecureStore adapter. |
| `crates/snapback4/src/verbs/init/expo-app.tsx` | Guest entry screen with `useAuth`, `AppProvider`, and existing chat screens. |
| `crates/snapback4/src/verbs/init/web.rs` | Vite starter embeds app-owned entrypoints and uses the shared shell CLI. |
| `crates/snapback4/src/verbs/init/web-client.ts` | Web device plus explicit localStorage session persistence. |
| `crates/snapback4/src/verbs/init/web-app.tsx` | AppProvider/useAuth chat entry; preserves route/read/receipt UX; displays credential-storage failures. |
| `crates/snapback4/src/verbs/init/web-readme.md` | Generated starter setup, explicit guest sign-in, builds and offline behavior. |
| `crates/snapback4/tests/init.rs` | Generated files, safe overwrite refusal, app imports and build scripts. |
| `crates/snapback4-lang/tests/guide.rs` | First-screen self-containment checks now require the app API instead of the removed account controller; Quarry compilation remains. |
| `packages/snapback4/test/app.test.mjs` | Ten lifecycle/custody/storage tests described below. |
| `packages/snapback4/test/react.test.mjs` | Real app client replacement, hook routing and account-local React state reset. |
| `packages/snapback4/test/first-account.test.mjs` | Typecheck the two current README modules and exercise account/profile/avatar instructions against a real server. |
| `packages/snapback4/test/periphery.test.mjs` | Generated device/persistence/build assertions; both generated Expo and web entrypoints typecheck. |
| `packages/snapback4/test/web-shell.test.mjs` | Expo/Vite fixtures, registration syntax/idempotence/hash, worker request routing/update behavior, CLI and unsafe inputs. |
| `witness/web-shell.mjs` | Tiny Vite export in Chromium: restore account/replica in a fresh offline page and reload after both servers stop. |
| `witness/starter.mjs` | Port the existing starter journey to real guest sessions and the shared worker; its final failed-update step remains unqualified (below). |
| `JOURNAL.md` | One append-only dated entry recording implementation, measurements and exclusions. |
| `reports/20260924-lane-e-client.md` | This report and reproduction instructions. |

## Forms and examples

The README and generated starters typecheck; the README schema still compiles
without diagnostics or notes. These are client and CLI forms, not new Quarry
syntax, so the language card and parser need no new form.

```tsx
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
import { AppProvider, useAuth, useQuery } from "snapback4/react";
import { api } from "./snapback/generated/api";

const app = createApp({
  url: "http://localhost:4400",
  device: webDevice(),
  sessionStore: localStorageSessionStore(),
});
function Screen() {
  const auth = useAuth();
  const profile = useQuery(api.myProfile, {});
  return <button onClick={() => void auth.guest()}>{auth.state}</button>;
}
const screen = <AppProvider app={app}><Screen /></AppProvider>;
```

Each auth action is available as `await app.auth.signup(email, password)`,
`await app.auth.login(email, password)`, `await app.auth.guest()`,
`await app.auth.logout()`, or `await app.auth.logoutEverywhere()`; refused
actions return `{ ok: false, why }`. Observe via
`const stop = app.auth.onChange(() => console.log(app.auth.state, app.auth.viewer))`.

`createApp({ url, sessionStore })` selects the online tier; for example
`await app.mutate(api.saveProfile, { handle: "ada" })` persists the
ID and arguments before dispatch. Recreate the app with the same store to
restore the account and replay its pending writes. Local apps use the device's
existing durable outbox. `app.ready` awaits initial restore and `app.close()`
stops a runtime while keeping its session and pending writes for reopening.

```sh
npx snapback4 init chat --web
# generated build: vite build && snapback4 web-shell dist
npx snapback4 init mobile --expo
# generated build:web: expo export -p web && snapback4 web-shell dist
npx snapback4 web-shell dist --base /chat/
```

## Tests and measured results

New `app.test.mjs` cases:

1. Online lifecycle against a real server: sign-up, bad-password refusal,
   rotation, restart, A/B pending-write isolation, A replay, logout and server
   refusal of the old token.
2. The same lifecycle on the real process device and its persisted outbox.
3. Two online intents after a lost committed reply: same IDs, original argument
   snapshots, admission order, no duplicate rows and receipts after another restart.
4. Logout-everywhere revokes a second session; logout racing initial restore
   cannot resurrect the old account.
5. Stalled rotation does not block local logout and its late token is revoked.
6. Failed intent persistence dispatches nothing; failed terminal persistence
   keeps a committed write pending until the receipt can be stored.
7. Failed session persistence exposes no partially opened authenticated client
   and later sign-in can recover.
8. Journal failures do not prevent logout credential deletion; failed deletion is retryable.
9. The same deletion failure during logout-everywhere returns a refusal and reaches
   signed-out instead of leaving auth restoring indefinitely.
10. Auth does not announce completed sign-out before durable deletion finishes.

The added React test switches real app clients, keeps existing query/mutation
hooks working, and discards old account-local component state. Existing hook
and reference-screen tests remain. Shell tests cover both Vite and Expo export
shapes, all HTML registrations, valid injected JavaScript, idempotence, content
hash changes, static allowlisting, cross-origin/API passthrough, offline
fallback, failed installs, activation cleanup and invalid base/symlink refusals.
Existing tests pinning the authored account controller, persona entrypoint or
bespoke shell plugin were updated because those are intentionally replaced.

Focused app/React/shell run: **29 passed, 0 failed**
(`/tmp/lane-e-final-focused.log`). Other targeted runs: language guide **55
passed**; Rust initializer **18 passed**; starter/periphery **19 passed**.
The final credential-cleanup follow-up (including the added logout-everywhere
case) passed **10 app tests, 0 failed** (`/tmp/lane-e-final-app.log`) after the
full-suite snapshot below. No broader rerun was needed for that scoped fix.

The cold-offline Chromium witness passed at **1,483 ms**, with a new offline
page, offline reload, restored account and replica, backend stopped and shell
HTTP server stopped (`/tmp/lane-e-shell-complete.log`). This is a witness
measurement, not a performance guarantee. The broader starter witness proved
fresh-realm outbox persistence, account isolation, same-ID ordered replay
(sequences 2, 3, 4; two rows, zero duplicates), terminal refusal persistence,
unknown receipt handling and guest credential clearing before reaching its
open shell-update problem.

Final `scripts/test.sh` (exit 1):

```text
== 1 failure(s) in 100 s
   cargo test
```

Log: `/home/ccheever/sb4-intent/lane-e-test-complete.log`. All client tests
passed (**1,009 passed, 10 skipped, 0 failed**). The failed cargo aggregate contains exactly four baseline failures,
also present in `/home/ccheever/sb4-intent/baseline-test.log`:

| Test | Classification | Targeted reproduction from `snapback4/` |
|---|---|---|
| `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | Baseline | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | Baseline | `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| `census::authoring_census` | Baseline | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| `w9b_why_operation_keeps_residency_and_cost_output` | Baseline | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

Earlier full runs: `== 2 failure(s) in 156 s` (same cargo aggregate plus the
intermittent client socket failure below), then `== 1 failure(s) in 103 s`
(cargo aggregate only), then the 100-second snapshot above. No lane-introduced failure remains in `scripts/test.sh`.

## Engineering choices and deviations

- The JS shim owns `web-shell`: it operates on exported static bytes, needs no
  Rust/server binary, and works on Linux even when the packaged native CLI is
  unavailable. Both export shapes use the same public verb.
- Web persistence remains opt-in; omission uses an app-local memory store and
  a browser console explanation. There is no automatic guest sign-in.
- `ready`, `close`, `auth.why`, and a stable auth snapshot support startup,
  shutdown, failures and React subscriptions without changing `Client`.
  `restoring` covers opening and clearing persisted identity.
- Online custody wraps `app.client`, so existing `useMutation` and direct
  `client.mutate` calls get the same journal as `app.mutate`. Terminal receipts
  retain only safe receipt metadata and are bounded by the existing 256-entry
  history; pending intents stay until terminal settlement.
- Account changes remount the provider's account subtree to prevent old
  component state and callbacks appearing under the next account.
- Starter entrypoints are separate embedded files; the reference applications
  retain their existing calibration/native-witness modes. Generated apps use
  explicit real guest accounts. Expo's web dependencies match its bundled pins.
- The extra existing starter browser journey's update phase is unqualified.
  After three failing rounds at that phase, work stopped under
  `rules/RULES.md`: “Fix loops get 3 rounds. Then stop: escalate to a human or
  descope.” The required small cold-offline witness and unit tests pass.
- No native Expo runtime/simulator witness was run on Linux. Both generated
  starter entrypoints typecheck; the process-device and Chromium paths run.
- The complete target Clique backend needs other lanes' syntax changes. This
  lane exercises its identity/profile/account surfaces via the README and
  real-server tests; it does not claim integrated Clique qualification.
- No engine/rule/disclosure/meter/Client-contract changes, new refusal codes,
  ceiling increases, dependency-version bumps, push or publication.
- A generic SessionStore has no compare-and-swap operation. Browser Web Locks
  cover tabs, and runtime locks cover one process; simultaneous custom-store
  writers across separate non-browser processes are unsupported and documented.

## Open problems and reproductions

1. **Lane witness qualification gap:** from `snapback4/`, after the normal
   builds, run `node witness/starter.mjs`. The account/outbox/guest stages pass;
   the failed worker-only update phase times out after 15 seconds with
   `failed update did not become redundant: installing=undefined,
   waiting=undefined, active=activated`. The fixture's asset-download failure
   is never observed. Cause is unestablished; neither the failed-update nor
   later old-tab/new-build lifecycle claims are qualified in Chromium by this
   run. Worker VM tests cover those behaviors. Last record:
   `/tmp/lane-e-starter-witness5.log`. This is additional to the passing
   required `node witness/web-shell.mjs` witness.
2. **Baseline Rust failures:** the four exact tests listed with the suite
   result also fail on the untouched baseline. Run the listed targeted cargo
   commands to reproduce. They were not altered or repaired in this lane.
3. **Earlier intermittent server-test socket failure:** the first full run had
   `UND_ERR_SOCKET: other side closed` in
   `raw HTTP settlement validates declared results terminally and never reclaims them`
   (`test/server-e2e.test.mjs:360`, explicit-null action-step completion).
   It passed an immediate targeted rerun and later full runs. Classified as an
   intermittent/environmental failure, with root cause unestablished, not a
   proven baseline failure. Reproduction command:
   `node --test --test-name-pattern='raw HTTP settlement' packages/snapback4/test/server-e2e.test.mjs`.
   Logs: `/home/ccheever/sb4-intent/lane-e-test.log` and
   `/tmp/lane-e-server-recheck.log`.
