---
title: "Recipe: fixed-origin development and attach"
id: recipes.fixed-origin-development
order: 10
audience: agent-first
capabilities: [operating.packaged-dev-loop]
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0223-zero-config-connect-and-knowledge-closure.plan.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-vite/index.mjs, packages/snapback-client/app-client.mjs, packages/snapback-react/index.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-environment.mjs]
examples: [packages/snapback-cli/dev-loop.test.mjs, packages/snapback-cli/sessions-dev-loop.test.mjs, packages/snapback-vite/package.test.mjs, demos/tandem-expo-bakeoff/snapback/src/backend.tsx]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:7a12975762d5636f37eee3eae6e097ab8ad32c2972654a8ec90c8f2541a55c20
---

# Recipe: fixed-origin development and attach

> **Local target only.** This page describes an explicitly owned development
> server. It is not a hosted deployment recipe.

Use this route when a test, browser shell, or native harness must keep one
backend origin stable while generated artifacts continue to change. Ordinary
`snapback dev` owns its server and chooses a free port; it has no `--port`
option today. A pinned-port setup therefore has two owners: `snapback start`
owns the process and `snapback dev --attach` owns generate-and-load.

This page answers the diaries' exact searches
“attach Expo web to an already-running --port server” and
“snapback dev will not pin 42080”. Fixed origin, pinned port, provider binding,
startup-carrier refresh, and client listener safety are separate ownership
facts rather than one magic flag. LLP 0295 D0.1/W1 owns the future
single-lifecycle fixed-port profile; do not spell that pending design as
`snapback dev --port` yet.

## Pin the port with `snapback start`

Use one absolute database path and one ready file throughout. For dev-auth
projects the minimal split is:

```sh
snapback start --port 42080 --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/fixed.ready.json"
```

`snapback start` owns this listener and writes the host ready descriptor. It
does not generate the app, watch source, or hot-load later artifacts. In a
second terminal, attach the generator and watcher:

```sh
snapback dev snapback --attach \
  --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/fixed.ready.json"
```

`--attach` requires the existing ready descriptor and verifies the live
server and database identity before loading. It never takes process ownership,
chooses another port, restarts the server, or stops the server when the attach
process exits. Add `--no-watch` for one generate/load pass and exit; omit it
for the hot-load loop.

Do not infer the origin from logs. Read the descriptor named by
`--ready-file`; it is the owner-authenticated carrier for the actual listener
and startup nonce.

## Preserve the sessions startup carrier

Sessions mode must establish the generated schema and functions before the
listener opens. First let the packaged dev loop produce the sibling
`.snapback/startup-artifacts.json`; then stop that managed run and start the
fixed server with the exact carrier:

```sh
snapback dev snapback --no-watch \
  --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/bootstrap.ready.json"

snapback start --port 42080 \
  --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/fixed.ready.json" \
  --startup-artifacts "$PWD/.snapback/startup-artifacts.json"
```

Now run the same attach command from the previous section. Attached
regeneration generates and loads the running server; it **does not rewrite**
the startup carrier. Only managed `snapback dev` start/restart/reset paths
refresh `startup-artifacts.json`.

Before a later sessions restart, refresh the carrier in this order:

1. Stop the fixed `snapback start` server.
2. Verify that its listener and ready descriptor are gone. Do not continue
   while any runtime still has the same SQLite database open. Do not launch a
   second runtime against the same SQLite database.
3. Run the current backend once through managed `snapback dev --no-watch`,
   using the same database and a ready-file path with no live descriptor. Let
   the command exit; if it attaches to a live descriptor instead, it did not
   refresh the carrier.
4. Restart the fixed server with the refreshed
   `.snapback/startup-artifacts.json`.
5. Reattach `snapback dev --attach` for subsequent generate-and-load work.

Otherwise the fixed server can reject the stale deployment at bind. Keep the
database, ready descriptor, and startup carrier together. The diary's
`AUTH_MODE_PENDING` refusal is emitted as
`SNAPBACK_AUTH_MODE_PENDING`; it means the auth-mode transition is still
pending or quarantined, so inspect the operator diagnostics before changing
state. Its `STARTUP_ARTIFACT_MISMATCH` shorthand is
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`; it means the fixed server's
database, ready descriptor, and startup carrier are incomplete or mixed. Do
not delete the database or hand-edit a digest.

## Bind a client to the running fixed origin

For web, the first-class fixed-origin path is `@expo/snapback-vite` in attach
mode. Give the Vite plugin the same ready file and database; import the
generated app binding from `virtual:snapback/dev`. The browser then uses the
same-origin relay while the plugin privately reads the ready carrier. This
avoids both a hard-coded backend URL and privileged carrier bytes in page
code.

`SnapbackExpoProvider` is supervisor-owned: it expects the binding exchange
installed by `snapback dev --expo`. An already-running backend is not that
exchange. Passing a raw `{ origin }`, URL, or binding override can refuse with
`SNAPBACK_APP_BINDING_UNAVAILABLE` or
`SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED` (the diary's
`OVERRIDE_UNCONFIRMED`). There is no safe “just pass the fixed URL” shortcut.

For a separately owned Expo/Metro process, use the lower-level
[`SnapbackProvider` composition](../clients/react-expo.md#use-the-low-level-provider-when-you-own-environment-wiring).
The shell owns origin propagation from the same ready descriptor, prepares a
binding against that reachable target, and owns the authority/custody
lifecycle. A native shell may instead supply a complete
`SnapbackExpoEnvironmentV1`, whose binding still passes normal admission. Keep
binding lifetime and refresh under that environment or client owner; do not
mint a guessed expiry or describe an unlanded TTL policy.

A split Expo/Metro workflow is supported only when Metro is launched in an
explicit loopback posture and its live listener is then verified as
loopback-only. A loopback-only Metro listener is mandatory. For the Expo web
shape exercised here, use:

```sh
unset CI
bunx expo start --localhost --web --port 48001
lsof -nP -iTCP:48001 -sTCP:LISTEN
```

Continue only if every Metro listener reported for that port names a loopback
address such as `127.0.0.1` or `::1`. Stop it if the inventory reports
`*:48001`, `0.0.0.0:48001`, `[::]:48001`, or any other non-loopback address.
If the selected Expo/Metro command cannot reliably produce and prove that
posture, the split workflow is **UNSUPPORTED pending LLP 0295 D0.1/W1**.

Do not wrap an already-running pair in `snapback dev --expo`: today's listener
enumeration supervises the client process it started. Diary 0104's supervisor
rejection was correct. The expected Metro listener was port 56515, while the
custom command's listener was port 48001; listener inventory also showed the
latter as `*:48001`, not loopback-only. The resulting
`SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE` refusal and teardown enforced
both port ownership and listener safety. Starting Metro separately avoided
that teardown only by bypassing the supervisor's check; split ownership alone
is not a complete or safe workaround.

Diary 0105 kept managed Sessions startup while pinning the backend with a
managed-runtime port wrapper: the wrapper appended `--port` only when
`snapback dev` invoked the qualified runtime's `start` subcommand. That is a
harness workaround, not a Snapback CLI flag or a portable application recipe;
runtime verification may see the wrapper rather than the qualified binary.
Prefer the explicit `start` + `dev --attach` split on this page when that
identity tradeoff is unacceptable. LLP 0295 D0.1/W1 owns removing both
workarounds with a real fixed-port/external-client lifecycle.

## Anti-patterns

- Expecting `snapback dev` to preserve a requested backend port, or inventing
  a `snapback dev --port` flag.
- Running `--attach` without the exact live ready descriptor and database.
- Starting sessions mode without the generated startup-artifact carrier.
- Running the managed carrier refresh while the fixed runtime still owns the
  same SQLite database.
- Parsing server logs for the origin instead of consuming the ready file.
- Passing a raw origin to `SnapbackExpoProvider` or weakening binding
  admission after `SNAPBACK_APP_BINDING_UNAVAILABLE` / `OVERRIDE_UNCONFIRMED`.
- Treating a separately launched Metro process as safe without an explicit
  loopback posture and post-start listener inventory.
- Letting two supervisors both believe they own the fixed backend or Expo
  listener.
