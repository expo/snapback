# LLP 0258 Phase 1.4 browser auth-bootstrap evidence

Date: 2026-08-16
Source: app-client cross-tab fix `146cd6ade` plus browser harness/evidence
commit `b7528195c` in this landing; final recorded run on the control-plane machine
(macOS 26.6.1, arm64) against this worktree's freshly bootstrapped
`target/debug/snapback`.
Witness: `fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`

## What was exercised

`browser-auth-bootstrap-v1.mjs` bundles the page probe with esbuild, starts a
real Snapback server from the worktree's freshly built debug binary; the
witness records its identity verdict. It also serves a same-origin page/proxy
harness. The page constructs `createSnapbackAppClient`
with real IndexedDB and Web Locks. The runner drives two engines in one
invocation:

- **Chromium**: the repository's `launchChromeCdp` lifecycle and raw
  CDP/WebSocket calls; the two-tab arm uses two real targets in one
  persistent profile. Recorded run: Google Chrome 151.0.7922.138 (headless).
- **WebKit**: real Safari through `safaridriver` (plain-fetch W3C WebDriver
  client, ephemeral local port, window-handle tab management). Recorded run:
  Safari 26.6 on macOS 26.6.1.

The run reused the password-enabled `demos/rbac/snapback` backend with
codegen primed before launch. HTTP evidence retains only method, pathname,
and status; the witness contains no credential or bearer bytes (generated-
credential and bearer/recovery-token scans pass).

## Run history (all recorded honestly)

1. The implementing lane's initial Chromium-only run executed on a fleet M4
   host because Chrome could not launch from its sandbox; that witness was
   superseded.
2. An independent orchestrator re-run on the control plane against this
   worktree's fresh binary reproduced it exactly: 5/6 proofs PASS, two-tab
   FAIL — every raced transition left the losing tab's public principal
   stale until explicit `synchronize()`. That defect was root-caused to
   `createSnapbackAppClient` constructing `AuthCoordinator` with
   `broadcastChannelFactory: null, hintStorage: null`
   (`issues/20260816-app-client-cross-tab-convergence-disabled.md`) and
   fixed in this landing: browser/expo-web owners now preserve the
   coordinator's BroadcastChannel/localStorage wakeup defaults, injectable
   through `platform` options.
3. The dual-review round tightened the two-tab arms (seeded predecessor
   state, winner-tying, an LLP 0059-exact refresh predicate, a genuinely
   cross-account user switch). The cross-account requirement then exposed a
   HARNESS false positive: the page's direct-IndexedDB custody inspector
   always read the legacy default-partition row, so a partition-isolated
   seeding page reported the default partition's principal. Raw server
   probes and a proxy-logged run proved the product stack partition-clean
   (distinct emails mint distinct users; the seed page's own signup minted
   its own user); the page inspector now derives the same partition-aware
   storage key and lock name as the product adapter, and a two-partition
   regression test pins the product behavior in
   `packages/snapback-client/app-client.test.mjs`.
4. The final recorded two-engine run below includes all of the above.

## Proof outcomes (final recorded run, per engine)

| # | Proof | Chromium | WebKit |
| --- | --- | --- | --- |
| 1 | Reload restoration | PASS | PASS |
| 2 | Two-tab ownership | **FAIL** (concurrent-refresh check only) | **FAIL** (same single check) |
| 3 | Strict Mode / remount | PASS | PASS |
| 4 | Logout / user-switch hygiene | PASS | PASS |
| 5 | Corruption | PASS | PASS |
| 6 | Blocked recovery | PASS | PASS |

Proof 2 detail after the cross-tab fix, identical on both engines:

- The cross-tab fix now converges all four race arms automatically. Concurrent
  logout, sign-in, and user switch each produce exactly one caller winner and
  both tabs converge on that winner's settled state; the refresh arm converges
  both tabs on the same fail-closed blank. No race requires manual
  `synchronize()` to converge, and the one-logical-record check passes.
- The **concurrent-refresh** check still fails honestly. Both
  `/auth/refresh` requests respond non-successfully (HTTP 401 and 409), so
  there are **zero** successful callers: one returns
  `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` and the other returns
  `SNAPBACK_AUTH_REFRESH_SUPERSEDED`.
- Both automatic snapshots already agree on settled anonymous custody at the
  same epoch/revision, with no bearer. The epoch advance is the witnessed
  session-to-anonymous transition; it is explicitly **not** a bearer rotation,
  because LLP 0059 requires refresh to preserve the authority epoch. The
  optional manual-recovery snapshots remain on that same anonymous custody.
  The later authenticated state in `logoutPreparation.entry` comes from a
  fresh password sign-in used to prepare the logout race, not from refresh
  recovery. Filed as `issues/20260816-refresh-race-zero-winner.md`.

## Skips and nonclaims

- The StrictMode proof is real development StrictMode plus repeated DOM
  mount/unmount. No Metro/Vite Fast Refresh session was driven, so this is
  not Fast Refresh evidence.
- Firefox is out of scope. This evidence makes no native-custody,
  hosted-auth, XSS-resistance, or sender-constrained credential claim.

Cleanup facts (browser processes, safaridriver, profiles, test databases,
HTTP harness, server process, scratch directories) are recorded per engine
in the witness.

## Verification

- Final recorded run: both engines completed all six arms against the real
  server; non-green receipt is expected and consists solely of the ticketed
  concurrent-refresh product defect.
- `node --check` for the runner and page: PASS.
- WebKit adapter mock-lifecycle test mode (session, two windows, concurrent
  handle routing, reload, window close, session close, initialization-failure
  session cleanup): PASS.
- app-client regression suite (including omitted/default, explicit-null,
  and absent browser wakeup mechanisms, plus the two-partition custody
  isolation test): 23/23 tests PASS under volta node 24.18.0.
- generated symbol-registry check: 50 modules, 1202 symbols, runtime parity
  exact.
- `./ref-check --verbose`: PASS.
- `node scripts/check-inventories.mjs`: inherited guide-manifest failures
  for paths not touched by this lane (missing generated files under
  `demos/competitive-checkpoint` and `demos/todo-v2`, stale
  diagnostics-registry projections); none overlap this landing.
