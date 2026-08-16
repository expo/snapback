# LLP 0258 Phase 1.4 browser auth-bootstrap evidence

Date: 2026-08-16
Source commit: `b7f01a693` (worktree base) plus this landing's uncommitted
app-client cross-tab fix; final recorded run on the control-plane machine
(macOS 26.6.1, arm64) against this worktree's freshly bootstrapped
`target/debug/snapback`.
Witness: `fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`

## What was exercised

`browser-auth-bootstrap-v1.mjs` bundles the page probe with esbuild, starts a
real Snapback server from the pinned prebuilt binary, and serves a
same-origin page/proxy harness. The page constructs `createSnapbackAppClient`
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
3. The final recorded two-engine run below includes that fix.

## Proof outcomes (final recorded run, per engine)

| # | Proof | Chromium | WebKit |
| --- | --- | --- | --- |
| 1 | Reload restoration | PASS | PASS |
| 2 | Two-tab ownership | **FAIL** (concurrent-refresh check only; 5/6 checks pass) | **FAIL** (same single check) |
| 3 | Strict Mode / remount | PASS | PASS |
| 4 | Logout / user-switch hygiene | PASS | PASS |
| 5 | Corruption | PASS | PASS |
| 6 | Blocked recovery | PASS | PASS |

Proof 2 detail after the cross-tab fix, identical on both engines:

- concurrent logout, concurrent sign-in, and concurrent user switch now
  each produce exactly one caller winner and BOTH tabs converge on the
  winner's settled state automatically (no manual `synchronize()`), and the
  one-logical-record check passes — the original convergence defect is
  cured and held by app-client regression tests.
- the **concurrent-refresh** check still fails, with a different and now
  isolated signature: the gated two-tab refresh race yields **zero** caller
  successes — the loser refuses correctly with
  `SNAPBACK_AUTH_REFRESH_SUPERSEDED`, but the would-be winner's own call
  fails `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`; the durable record
  nevertheless ends on the rotated successor (next epoch), and both tabs
  adopt it only after explicit synchronization. Filed as
  `issues/20260816-refresh-race-zero-winner.md`. The blank-don't-retain
  behavior of the failing callers is itself conformant; the defect is that
  no caller wins.

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
  handle routing, reload, window close, session close): PASS.
- app-client regression suite (two-context convergence, Node construction,
  dispose/channel-close): 494/494 package tests PASS under volta node
  24.18.0.
- `./ref-check --verbose`: PASS.
- `node scripts/check-inventories.mjs`: inherited guide-manifest failures
  for paths not touched by this lane (missing generated files under
  `demos/competitive-checkpoint` and `demos/todo-v2`, stale
  diagnostics-registry projections); none overlap this landing.
