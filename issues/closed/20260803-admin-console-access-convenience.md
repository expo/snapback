# Admin console access convenience: stop making the operator paste the token

**Date:** 2026-08-03
**Status:** Closed
**Area:** Admin console / operator auth (LLP 0017)

## Problem

Reaching the admin console almost always means hunting for the admin token.
The local server mints an `sbat_` token, persists it at
`<db>.sqlite3.admin-token` (0600), and prints it only on the start that minted
it; later starts print just the file path. The browser console prompts for a
paste, exchanges it for a 10-minute in-memory console credential (`sbcc_`),
and a server restart invalidates every credential. In ordinary dev — frequent
restarts, token printed sessions ago — the operator is pushed into
hunt-and-paste over and over.

The CLI does not have this problem: it already auto-discovers the token
through the ready descriptor (`adminTokenFile` → owner-only sibling read,
`src/cli.rs` `discover_minted_token`). The friction is specifically the
terminal → browser gap; no command bridges it.

Non-goal: weakening the token model. "Trust loopback, skip the token" is
explicitly out — reflected localhost CORS is why auto-mint exists (ENG-23443,
LLP 0017 §Security Defaults). The token is what distinguishes the operator
from any other process or browser tab on the machine. Everything below keeps
that property and removes the human from the copy path.

## Work items

### 1. `snapback admin` — open the console pre-authenticated

New CLI subcommand: resolve the token via existing ready-file discovery, mint
a console credential through the existing
`POST /_snapback/api/console/credential`, and open the browser at the console
URL with the credential in the **fragment** (never the query string, so it
cannot reach logs or Referer). The console client stores it exactly where
pasted-token-derived credentials land today
(`snapback_console_credential_v1`). Pure plumbing over existing machinery; no
new trust decisions. Highest value, do first.

### 2. Console credential lifetime

Two independent fixes to why the paste recurs:

- **Sliding renewal.** Today only the master token can mint an `sbcc_`
  (`authorize_master`), so at minute 10 the operator is back to pasting. Let
  an active credential renew itself, bounded: loopback-only, dev profile
  only, capped total lifetime. First authentication is unchanged.
- **Survive restarts.** Credentials are in-memory SHA-256 digests
  (`ConsoleCredentialRegistry`), so every dev restart logs the console out.
  Persist the digests beside the DB — they are derived, TTL'd credentials,
  not the master — so a restart is invisible to an open console tab.

### 3. Device-flow approval for a remote browser

For the browser-not-on-the-same-box case (SSH port-forwards, remote dev):
console shows a short user code; the operator runs
`snapback admin approve <code>` in any terminal with ready-file access; the
console receives its credential. Reuses the RFC-8628 approval-link shape LLP
0150 already designs for agent tokens, run in reverse for the operator
surface. Lower priority than item 1, which covers the same-box case.

### 4. Hosted: Expo account as control-plane operator identity

Hosted admin today is a Worker secret compared per-request, and LLP 0017's
hosted defaults keep admin disabled until real hosted auth exists. The human
path should be the operator's Expo account (OIDC at the edge), with authority
scoped to `(expoAppId, environment)` per LLP 0017's hosted requirements; the
`sbat_` token demotes to a machine/break-glass credential. This is already
the shape of LLP 0105 §P0.5 ("Expo account auth covers only the control
plane; prove the app plane separately") — this item is a pointer, not a
second owner: execute under 0105, and graduate to Linear if it needs
cross-repo/PM coordination.

## Invariant to preserve (and write down when item 4 lands)

Operator identity is host-owned (Expo account or host-managed). No code path
an app author can modify ever participates in an admin authorization
decision. App session bearers stay a different credential on a different
header (guide already bans app credentials on the operator surface; LLP 0150
invariant 5 makes the host sovereign with Expo optional). A buggy app auth
change may break the app; it must be structurally unable to open the admin
panel.

## References

- LLP 0017 §Security Defaults — token mint/persist/prompt/credential model,
  ENG-23443 rationale, hosted-disabled default.
- LLP 0150 — approval-link (RFC 8628) flow to reuse for item 3.
- LLP 0105 §P0.5 — hosted control-plane auth owner for item 4.
- `src/admin.rs` — `resolve_serve_admin_token`, `ConsoleCredentialRegistry`,
  `mint_console_credential`, `authorize_master`.
- `src/cli.rs` — `discover_minted_token`, `TargetArgs` token precedence.
- `packages/snapback-admin-client/index.mjs` — credential storage,
  master-token-memory-only handling.
- `admin-ui/auth-prompt.mjs` — the paste prompt this ticket mostly retires.

## Resolution

Resolved on 2026-08-03.

- Item 1 landed in `aaedc6b0a`: `snapback admin` validates a live trusted
  ready descriptor, discovers its owner-only token, exchanges it for a derived
  credential, and opens a fragment-only console URL. `--no-open` prints that
  URL, and missing ready/token custody fails with stable `SNAPBACK_*` codes.
- Item 2 landed in `aaedc6b0a`: active dev/loopback credentials slide from a
  ten-minute base TTL up to an eight-hour absolute cap. File-backed targets
  atomically persist only strict-owner-only digest and expiry metadata beside
  the database, so active credentials reattach across restarts without
  persisting the master token.
- Item 3 landed in `aaedc6b0a`: the console requests and polls a ten-minute
  RFC-8628-shaped approval, displays its short code, and
  `snapback admin approve <code>` completes it from a token-holding terminal.
  Requests, attempts, polls, and pending state are bounded; approval and
  credential delivery are single-use.
- The required full-suite run exposed stale S3 capability projections left by
  the earlier S3 qualification change. The mechanical manifest/consumer sync
  is isolated in `621906e32`; generated-artifact and capability tests are
  clean afterward.
- Item 4 remains out of scope and owned by LLP 0105 §P0.5. No hosted Expo
  authentication was added here.
