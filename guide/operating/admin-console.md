---
title: Admin console
id: operating.admin-console
order: 4
audience: agent-first
capabilities: [operating.admin-console]
authorities: [llp/0017-admin-console-inspection-surface.rfc.md, src/admin.rs, src/cli.rs, packages/snapback-admin-client/index.mjs, admin-ui/auth-prompt.mjs, admin-ui/app.contract, admin-ui/build.mjs, admin-ui/dev.mjs, packages/snapback-contract/build-preset.mjs, admin-ui/tests/fatal-rendering.mjs]
examples: [admin-ui]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 3109a3b4f5068595a71448b10788b56b4fa358f5
---

# Admin console

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The admin console is Snapback's browser debugger over
`/_snapback/api/*`. Its Contract app exposes Overview, Health, Errors, Logs,
Schema, Data, Functions, Secrets, Capabilities, Realtime, and Diagnostics views
from the same inspect/scan/runner/config boundaries used by tests and tools. Its Docs tab
renders the build-matched served guide from the generated manifest; the
console's text renderer never injects guide HTML.

## Launch the built console

Build the static browser and native Exact artifacts, then start Snapback:

```sh
cd admin-ui
./build.sh
cargo run --manifest-path ../Cargo.toml -- --memory
```

The server serves the immutable `dist/` snapshot at
`/_snapback/admin/`. Set `SNAPBACK_ADMIN_DIST` to pin another snapshot; in
a checkout, an unset value discovers `admin-ui/dist` when it exists. If no
dist is available, the route returns a structured missing-dist diagnostic
instead of a second embedded implementation.

Browser baseline:

```sh
cargo run -- --memory --ready-file .snapback/dev.ready.json
# in another terminal: discover the token, mint a browser credential, and open
cargo run -- admin --ready-file .snapback/dev.ready.json
```

For a headless machine, print the URL instead:

```sh
cargo run -- admin --ready-file .snapback/dev.ready.json --no-open
```

The URL carries only a derived `sbcc_` credential and its expiry in the
fragment. It never carries the `sbat_` master token in either the query or the
fragment. The page removes the fragment before boot and stores the derived
record through the same `snapback_console_credential_v1` path used by the paste
fallback.

For a native Exact shell, point `EXACT_APP_CUSTOM_URL` at the
Snapback-served static admin URL. A browser-only dist returns a specific
native-artifact capability diagnostic.

## Use the browser development loop

Run Snapback at a known port, then start the Exact/Contract Vite app:

```sh
cargo run -- --memory --port 4287
SNAPBACK_ADMIN_DEV_API=http://127.0.0.1:4287 bun run --cwd admin-ui dev
```

The dev server regenerates Contract bindings, watches their inputs, and proxies
`/_snapback/api/*` to the configured backend. It binds loopback by default.
Non-loopback proxy exposure requires both
`SNAPBACK_ADMIN_DEV_HOST` and
`SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK=1`; treat that as exposing a
privileged operator surface.

If the backend is down, the proxy returns
`SNAPBACK_ADMIN_DEV_API_UNREACHABLE` rather than HTML or a blank app.
Static native artifacts remain build-only; request them from the served
`./build.sh` output, not the dev server.

## Authenticate the operator surface

Loopback reads are open until an admin token exists; writes and non-loopback
access follow the server's admin policy. Use the printed/token-file credential,
never app session credentials. Sessions-mode sensitive reads use a separate
short-lived admin-secret-read lease; neither credential substitutes for the
other.

The UI clears submitted credentials and renders hostile diagnostics as text:

```js source=admin-ui/tests/fatal-rendering.mjs
assert.equal(root.children[0].tagName, 'pre');
assert.equal(
  root.children[0].textContent,
  `Admin console failed to start:\n${hostile}`,
);
assert.equal('innerHTML' in root.children[0], false);
```

The production browser proof also enforces CSP hashes, Trusted Types, zero
runtime exceptions, zero console errors, and zero policy violations.

Active dev/loopback console credentials renew on a ten-minute sliding window,
up to eight hours from first mint. File-backed servers atomically persist only
the expiring SHA-256 digest metadata beside the database, so a restart does not
log out a live console. The master token remains in its separate owner-only
capability file and never enters browser storage or the digest store.

For a remote browser reached through SSH or another loopback-preserving tunnel,
the token prompt also displays a short-lived user code. Approve it from a
terminal with ready-file access:

```sh
cargo run -- admin approve ABCD-1234 --ready-file .snapback/dev.ready.json
```

The browser polls for its derived credential. Codes expire after ten minutes,
are single-use, and the request, approval, poll, and pending-state lanes are
bounded. Non-loopback binds, hosted targets, and non-dev profiles cannot use
this flow.

## Debug through declared views

- **Overview/Capabilities/Realtime/Diagnostics:** inspect target, artifacts,
  capability gaps, delivery state, receipts, and stable codes.
- **Health:** telemetry stat tiles, requests over time, per-route/function
  latency, top volume/error-rate entries, lifecycle markers, and coverage,
  with a link into Errors when issues need attention.
- **Errors:** triage open/regressed issues and resolve or ignore them;
  structural metadata is ordinary admin authority, while raw detail spends a
  scoped `errors.issue` secret-read lease.
- **Logs:** filter the same bounded `telemetry.events` operation agents use;
  raw rows require a `telemetry.events` secret-read lease.
- **Schema/Data:** inspect declared tables and page through rows; private reads
  remain subject to secret-read scope/budgets.
- **Functions:** run queries, mutations, and actions through the classified
  direct-runner boundary and inspect captured reads/writes.
- **Secrets:** see declaration/set/verification state and run declared probes;
  values never render.
- **Docs:** navigate the same manifest/corpus served at `/_snapback/guide`,
  with response hash/build identity checked before a page renders.

Use the [host operations](./host-ops.md) page for automation and
[diagnostics](./diagnostics.md) for code-driven troubleshooting.

## Verify the Contract/Exact seam

The build preset owns plugin ordering, route/entry preflight, static/native
targets, and the admin base-path rewrite. Snapback's Exact discovery/conformance
helpers remain optional for ordinary core work:

```sh
node packages/snapback-contract/exact-conformance.mjs
node packages/snapback-contract/exact-conformance.mjs --require
node packages/snapback-contract/exact-conformance.mjs --run
```

`--require` makes a lane fail unless Exact registers the provider suite;
`--run` invokes Exact's registered check. Generated descriptor/project
semantics are covered by the Contract adapter acceptance, not by a hand-written
admin binding layer.

## Anti-patterns

- **Do not run the privileged dev proxy on a LAN accidentally.**
- **Do not point a native shell at a browser Vite surface.** Use the built
  Snapback-served admin URL.
- **Do not persist admin or secret-read credentials in UI state/storage.**
- **Do not put the `sbat_` master token in any URL.** The CLI fragment handoff
  is for derived `sbcc_` credentials only.
- **Do not bypass generated Contract bindings with a second admin UI.**
