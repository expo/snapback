# LLP 0258 Phase 1.4 browser auth-bootstrap evidence

Date: 2026-08-16 (refresh-race closure sitting)
Source: this landing's refresh-race server fix plus the harness commits, on
top of the previously landed Phase 1.4 delivery (cross-tab fix `146cd6ade`,
harness `b7528195c`, review closures through `1e08ed524`). Final recorded
run on the control-plane machine (macOS 26.6.1, arm64) against this
worktree's freshly built and runtime-qualified `target/debug/snapback`
carrying the refresh fence fix; the witness records the binary identity
verdict.
Witness: `fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`

## What was exercised

`browser-auth-bootstrap-v1.mjs` primes and boots its own password-enabled,
owner-scoped `tests/acceptance/fixtures/browser-auth-backend` backend
(self-contained; no demo schema dependency), serves a same-origin page/proxy
harness, and constructs `createSnapbackAppClient` with real IndexedDB and
Web Locks in three real engines in one invocation:

- **Chromium**: the repository's `launchChromeCdp` lifecycle and raw
  CDP/WebSocket calls; two real targets in one persistent profile.
  Recorded run: Google Chrome 151.0.7922.138 (headless).
- **WebKit**: real Safari through `safaridriver` (plain-fetch W3C WebDriver
  client, ephemeral local port, window-handle tab management). Recorded
  run: Safari 26.6 on macOS 26.6.1.
- **Firefox**: real Firefox through `geckodriver` with the same WebDriver
  client and a geckodriver-created throwaway profile (creation and removal
  are witness facts). Recorded run: Firefox 152.0.1, geckodriver 0.37.1
  (headless).

Startup-artifact note: current codegen can emit a `visibilityGovernance`
activation carrier that no repository tool can satisfy at server launch
(`issues/20260816-governance-carrier-blocks-fresh-prime-server-boot.md`).
The runner omits the carrier from its composed startup artifacts ONLY when
it is inert (`required: false`, empty closure), refuses non-inert carriers,
and records the omission as a witness fact (`governanceCarrierOmitted` —
`false` in the recorded run: the fixture backend emits no carrier).

HTTP evidence retains only method, pathname, and status; the witness
contains no credential or bearer bytes (generated-credential and
bearer/recovery-token scans pass).

## Run history (all recorded honestly)

1. The implementing lane's initial Chromium-only run executed on a fleet M4
   host because Chrome could not launch from its sandbox; superseded.
2. Orchestrator re-runs found and this program fixed, in order: the
   app-client cross-tab convergence defect (hard-nulled coordinator wakeup
   mechanisms; `issues/closed/20260816-app-client-cross-tab-convergence-disabled.md`),
   review-round harness tightenings (seeded predecessor state, winner
   tying, cross-account user switch), and a harness false positive in the
   partition-addressed custody inspector (product proven clean; pinned by
   the two-partition app-client regression test).
3. The tightened refresh predicate then isolated the zero-winner refresh
   race: both gated `/auth/refresh` callers failed (HTTP 401 + 409, no
   2xx) and fail-closed blanked both tabs. Root cause was server-side: the
   durable rotation had exactly one winner, but the generic session
   publication fence (`pending_tickets.is_empty()`) refused the winner's
   200 because the loser's still-pending refresh ticket blocked it, and
   the stranded publication surfaced as `SNAPBACK_AUTH_SESSION_EXPIRED` →
   client `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`. Fixed in this
   landing with an operation-specific committed-refresh fence
   (`src/auth/session_projection.rs`) that admits the winner past only its
   already-doomed sibling refresh tickets while binding admission to the
   finalized successor digest and captured authenticated-use deadline pair;
   later finalized same-generation rotation, deadline replacement,
   logout/revocation/expiry/generation/stream changes all refuse. LLP 0059's
   dated 2026-08-16 leaf-fence amendment now records that sole exception. A
   barrier-gated Rust HTTP race regression pins exactly one 200 winner, and a
   revocation-boundary test pins the security posture.
4. With the fix live, the race resolves per the documented client
   contract: the wire shows exactly one 200 and one typed 409; the winning
   caller returns the rotated credential; the superseded caller observes
   the winner's successor revision through the cross-tab wakeups and
   resolves `{ superseded: true }`. The harness predicate accepts only that
   resolved `superseded-converged` outcome for the loser; a typed
   `SNAPBACK_AUTH_REFRESH_SUPERSEDED` client rejection fails even when the
   wire remains correct. It also requires one rotated resolution, the exact
   200/409 wire pair, same-authority revision-only rotation with unchanged
   epoch, and automatic two-tab convergence.
5. Fresh-prime drift on current main forced the harness onto its own
   fixture backend: freshly primed `demos/rbac/snapback` cannot boot a
   server (governance carrier, then
   `SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN`;
   `issues/20260816-demo-schemas-fail-fresh-prime-visibility-validation.md`).
   The fixture move also required offering `auth.application-bootstrap.v1`
   on the harness page's supervised binding (the Phase 3 admission
   requirement).
6. The Firefox arm's first real runs surfaced two driver-level truths now
   encoded in the WebDriver client: Firefox/Marionette executes scripts in
   a per-call sandbox where `globalThis` writes do not persist between
   calls while `window` expandos do (verified with a live geckodriver
   probe; the cross-call operation registry now lives on `window`, which
   is identical in Safari), and geckodriver refuses body-less POST
   commands (all POSTs now send at least `{}`).
7. The final recorded three-engine run below includes all of the above.

## Proof outcomes (final recorded run, per engine)

| # | Proof | Chromium | WebKit | Firefox |
| --- | --- | --- | --- | --- |
| 1 | Reload restoration | PASS | PASS | PASS |
| 2 | Two-tab ownership | PASS | PASS | PASS |
| 3 | Strict Mode / remount | PASS | PASS | PASS |
| 4 | Logout / user-switch hygiene | PASS | PASS | PASS |
| 5 | Corruption | PASS | PASS | PASS |
| 6 | Blocked recovery | PASS | PASS | PASS |

The witness receipt is green (`ok: true`) on all three engines with no
infrastructure errors. Proof 2's arms each prove: seeded predecessor
protected/optimistic state blanked per the barrier order; exactly one
caller winner tied to the exact target authority (the user switch targets a
genuinely distinct second account); automatic convergence of the losing
tab without manual `synchronize()`; one logical durable custody record;
and, for refresh, the documented rotation/supersession contract with the
exact one-200-one-409 wire pair.

## Skips and nonclaims

- The StrictMode proof is real development StrictMode plus repeated DOM
  mount/unmount. No Metro/Vite Fast Refresh session was driven, so this is
  not Fast Refresh evidence.
- This evidence makes no native-custody, hosted-auth, XSS-resistance, or
  sender-constrained credential claim.

Cleanup facts (browser processes, safaridriver/geckodriver, Chromium and
geckodriver-created profiles, test databases, HTTP harness, server process,
scratch directories) are recorded per engine in the witness.

## Verification

- Final recorded run: all three engines completed all six arms against the
  real server with the refresh fix; receipt green.
- Rust: `concurrent_auth_refresh_has_exactly_one_http_winner`,
  `refresh_credential_response_is_fenced_by_prepublication_revocation`, and
  `committed_rotation_response_ignores_only_doomed_sibling_refresh_tickets`
  PASS (see the landing's commit message for verbatim counts); the fix
  binary is the one the recorded run launched.
- `node --check` for the runner and page: PASS.
- WebDriver adapter mock-lifecycle test mode, including the window-pinned
  cross-call operation registry (shared W3C session, two
  windows, concurrent handle routing, reload, window close, session close,
  initialization-failure cleanup, Firefox capabilities/port-retry/profile
  lifecycle): PASS.
- app-client regression suite: 34/34 PASS under volta node 24.18.0 (the
  suite grew with main's hosted-development and dev-identity tests).
- `./ref-check --verbose`: PASS.
- `node scripts/check-inventories.mjs`: inherited guide-manifest failures
  for paths not touched by this lane; none overlap this landing.
