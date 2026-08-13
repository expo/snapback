---
title: Admin console
id: operating.admin-console
order: 4
audience: agent-first
capabilities: [operating.admin-console]
authorities: [llp/0017-admin-console-inspection-surface.rfc.md, src/admin.rs, src/admin_link.rs, src/cli.rs, packages/snapback-admin-client/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-cli/admin-snapshot.mjs, packages/snapback-cli/runtime-readiness.mjs, packages/snapback-cli/expo-dev.mjs, admin-ui/auth-prompt.mjs, admin-ui/app.contract, admin-ui/build.mjs, admin-ui/dev.mjs, packages/snapback-contract/build-preset.mjs, admin-ui/tests/fatal-rendering.mjs, tests/admin_claim_link_v0.rs, tests/admin_reachability_v0.rs, tests/admin_tailscale_v0.rs]
examples: [admin-ui]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:dafdda17e37afb44c53a58b7bd4cb9a1617fd14676e6f065815f05124c2f56a7
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

## Launch the console

With a server running against a readiness descriptor (the packaged
authoring loop's `snapback dev` writes `.snapback/dev.ready.json`),
discover the token, mint a browser credential, and open the console:

```sh
snapback admin --ready-file .snapback/dev.ready.json
```

This is the exact command the Expo supervisor prints as its
`adminConsoleCommand`. The command always prints the complete fragment-bearing
URL, even when it successfully opens the browser. On a machine without a
controlling `/dev/tty`, it automatically behaves as `--no-open`. You can force
that behavior explicitly:

```sh
snapback admin --ready-file .snapback/dev.ready.json --no-open
```

For automation, add `--json`; the `snapback.admin-console.v1` result retains
the URL, expiry, and whether a browser open was requested.

The URL carries only a derived `sbcc_` credential and its expiry in the
fragment. It never carries the `sbat_` master token in either the query or the
fragment. The page removes the fragment before boot and stores the derived
record through the same `snapback_console_credential_v1` path used by the paste
fallback.

<!-- since: 0.1.19 -->

The server serves the immutable console snapshot at `/_snapback/admin/`.
Published `@expo/snapback-cli` installs carry a build-matched snapshot inside
the selected platform runtime package, and the CLI configures it automatically.
No consumer environment variable or Snapback source checkout is required. In
a source checkout, an unset value discovers `admin-ui/dist` when it exists;
contributors can set `SNAPBACK_ADMIN_DIST` to pin a deliberately different
built snapshot. If a source-built runtime has no dist, the route returns a
structured missing-dist diagnostic instead of a second embedded
implementation.

**Contributor variant (source checkout).** Build the static browser and
native Exact artifacts, then run the same commands through cargo:

```sh
bun install --frozen-lockfile --cwd admin-ui
bun run --cwd admin-ui build
cargo run -- start --memory --ready-file .snapback/dev.ready.json
# in another terminal: discover the token, mint a browser credential, and open
cargo run -- admin --ready-file .snapback/dev.ready.json
```

Every `snapback …` command on this page is the packaged spelling of the
same native binary; a checkout can always substitute `cargo run -- …` for
`snapback …`.

For a native Exact shell, point `EXACT_APP_CUSTOM_URL` at the
Snapback-served static admin URL. A browser-only dist returns a specific
native-artifact capability diagnostic.

## Use the browser development loop

Run Snapback at a known port, then start the Exact/Contract Vite app:

```sh
cargo run -- start --memory --port 4287
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
snapback admin approve ABCD-1234 --ready-file .snapback/dev.ready.json
```

The browser polls for its derived credential. Codes expire after ten minutes,
are single-use, and the request, approval, poll, and pending-state lanes are
bounded. Non-loopback binds, hosted targets, and non-dev profiles cannot use
this flow.

### Hand a one-time link from an agent terminal to a remote browser

When the token-holding terminal is remote or agent-driven, keep Snapback bound
to loopback and forward the console origin through SSH or another tunnel. Mint
the browser handoff from the trusted ready file, substituting only the tunnel's
public origin in the printed link:

```sh
snapback admin link \
  --ready-file .snapback/dev.ready.json \
  --url-base https://snapback-console.example
```

The command prints
`https://snapback-console.example/_snapback/admin/#claim=sbcl_…` and stays
attached by default. Opening it removes the fragment before boot, sends the
claim only in a `POST` body, and stores the resulting `sbcc_` credential through
the ordinary console-credential path. Exactly one exchange wins. The link is a
bearer until its thirty-minute claim expiry, so keep it private while pending;
after redemption or expiry it is inert and may safely remain in agent
transcripts or scrollback. The master `sbat_` token must never enter those
channels.

The attached command reports redemption time and the direct transport peer.
Behind a tunnel that address is usually the tunnel endpoint, not the human's
browser. For detached automation, print and exit, then reattach or revoke with
the raw claim code:

```sh
snapback admin link --no-wait --ready-file .snapback/dev.ready.json
snapback admin link --status sbcl_… --ready-file .snapback/dev.ready.json
snapback admin link --revoke sbcl_… --ready-file .snapback/dev.ready.json
```

Attached automation can request JSON-line lifecycle records and an owner-only
readiness handoff. The readiness file exists only while the observer owns the
link and includes the exact fragment URL:

```sh
snapback admin link --json \
  --link-ready-file .snapback/admin-link.ready.json \
  --ready-file .snapback/dev.ready.json
```

`--link-ready-file` deliberately conflicts with `--no-wait`: an exited process
cannot truthfully own attached-observer readiness.

Claim-derived credentials have distinct provenance. Active use renews their
ten-minute sliding expiry, but the server fixes their absolute deadline at
ninety minutes from redemption rather than the ordinary eight-hour ceiling.
Status and revocation require the master bearer; neither the browser nor an
anonymous loopback caller can read the redemption record. Claim mint and
exchange refuse hosted or non-loopback targets even when another admin bearer
is present—remote access is always a tunnel terminating on loopback plus
`--url-base`.

### Open a phone console on the local network

Keep the Snapback server on loopback and let the attached command own a
short-lived relay on the one eligible physical LAN interface:

```sh
snapback admin link --lan --qr \
  --ready-file .snapback/dev.ready.json
```

If more than one interface is eligible, the command refuses and lists the
candidates. Select one explicitly with `--lan=en0` or
`--lan=192.168.1.20`; wildcard and loopback addresses are refused. The first
line and the terminal QR encode the same URL bytes. Scan it while the command
remains attached.

The relay is deliberately plain HTTP. Read the mint-time warning: another
party on that network can observe or hijack the session while it is live. The
compensating bounds are the single-use claim, ten-minute sliding credential
expiry, ninety-minute absolute cap, redemption record, and master revocation.
Use the tailnet recipe below on a network you do not trust.

Only the console shell/assets, the claim exchange, and requests already
carrying the derived console credential cross this relay. It refuses the
master exchange, the master-token header, non-console paths, ambiguous HTTP
framing, and hostile Host/Origin values. Closing the command, revoking the
claim, losing the observed server, or reaching claim/credential expiry closes
the listener. `--lan` therefore cannot be combined with `--no-wait`.

### Open the console across a tailnet

With tailscaled running and the target server on `127.0.0.1`, publish only the
Snapback namespace through tailnet-terminated HTTPS:

```sh
snapback admin link --tailscale --qr \
  --ready-file .snapback/dev.ready.json
```

The command creates or shares a Tailscale Serve mapping only for
`/_snapback`, records its exact mapping and live owners in owner-only receipt
files, and removes it when the last attached invocation exits. A later
invocation sweeps a receipt-owned mapping stranded by a crash. Existing or
externally changed operator mappings are refused and never removed. A missing
or stopped tailscaled is a stable refusal; there is no LAN or loopback
fallback. Like `--lan`, this mode cannot be detached with `--no-wait`.

Credentials redeemed through either managed origin are stored only in the
current tab's `sessionStorage`, keyed by reachability session and server
startup identity. Reload first verifies both identities without sending the
credential. Expiry, revocation, origin reuse by another backend, or early
front termination clears or invalidates the record; it never falls back to
`localStorage` on the relay or tailnet origin.

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
