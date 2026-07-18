---
title: Admin console
id: operating.admin-console
order: 4
audience: agent-first
capabilities: [operating.admin-console]
authorities: [llp/0017-admin-console-inspection-surface.rfc.md, src/admin.rs, admin-ui/app.contract, admin-ui/build.mjs, admin-ui/dev.mjs, packages/snapback-contract/build-preset.mjs, admin-ui/tests/fatal-rendering.mjs]
examples: [admin-ui]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 9c9786772d9e590cbc37002609d0618338020569
---

# Admin console

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The admin console is Snapback's browser debugger over
`/_snapback/api/*`. Its Contract app exposes Overview, Schema, Data,
Functions, Secrets, Capabilities, Realtime, and Diagnostics views from the same
inspect/scan/runner/config boundaries used by tests and tools. Its Docs tab
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
cargo run -- --memory
# open the printed admin console URL
```

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

## Debug through declared views

- **Overview/Capabilities/Realtime/Diagnostics:** inspect target, artifacts,
  capability gaps, delivery state, receipts, and stable codes.
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
- **Do not bypass generated Contract bindings with a second admin UI.**
