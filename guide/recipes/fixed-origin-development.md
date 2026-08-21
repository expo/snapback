---
title: "Recipe: fixed-origin development and attach"
id: recipes.fixed-origin-development
order: 10
audience: agent-first
capabilities: [operating.packaged-dev-loop]
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, packages/snapback-cli/index.mjs, packages/snapback-vite/index.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-environment.mjs]
examples: [packages/snapback-cli/dev-loop.test.mjs, packages/snapback-cli/sessions-dev-loop.test.mjs, packages/snapback-vite/package.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:d107fc61d303c72dad7aea17644f1bd1295c021f2aec7ac50c9009aac7e8410f
---

# Recipe: fixed-origin development and attach

> **Local target only.** This page describes an explicitly owned development
> server. It is not a hosted deployment recipe.

Use this route when a test, browser shell, or native harness must keep one
backend origin stable while generated artifacts continue to change. Ordinary
`snapback dev` owns its server and may choose a free port. A pinned-port setup
has two owners instead: `snapback start` owns the process and
`snapback dev --attach` owns generate-and-load.

This is the diary's exact “attach Expo web to already-running --port server”
route: fixed origin, pinned port, and startup-carrier refresh are separate
ownership facts rather than one magic flag.

## Start the fixed server, then attach the loader

Use one absolute database path and one ready file throughout. For dev-auth
projects the minimal split is:

```sh
snapback start --port 42080 --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/fixed.ready.json"
```

In a second terminal, attach the generator and watcher:

```sh
snapback dev snapback --attach \
  --db "$PWD/.snapback/fixed.sqlite3" \
  --ready-file "$PWD/.snapback/fixed.ready.json"
```

`--attach` requires the existing ready descriptor and verifies the live
server and database identity before loading. It never takes process ownership,
chooses another port, or restarts the server. `--no-watch` performs one
generate/load pass and exits; omit it for the hot-load loop.

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
the startup carrier. Only managed start/restart/reset paths refresh
`startup-artifacts.json`. Before a later sessions restart, run the current
backend once through managed `snapback dev --no-watch` (or another managed
refresh path), then restart the fixed server with that refreshed carrier. The
managed start must use a ready-file path with no live ready descriptor; if the
command finds a live ready file, it attaches and does not refresh the carrier.
Otherwise the fixed server can reject the stale deployment at bind. Keep the
database, ready descriptor, and startup carrier together. An
`AUTH_MODE_PENDING` refusal means the auth-mode transition is still pending or
quarantined; inspect the operator diagnostics before changing state. A
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` refusal means the fixed server's
database, ready descriptor, and startup carrier are incomplete or mixed. Do
not delete the database or hand-edit a digest.

## Bind a separately owned client honestly

For web, the first-class fixed-origin path is `@expo/snapback-vite` in attach
mode. Give the Vite plugin the same ready file and database; import the
generated app binding from `virtual:snapback/dev`. The browser then uses the
same-origin relay while the plugin privately reads the ready carrier. This
avoids both a hard-coded backend URL and privileged carrier bytes in page
code.

The default `SnapbackExpoProvider` is supervisor-owned. A raw `{ origin }` or
raw binding override is not a supported substitute for its admitted
environment and can refuse as binding unavailable or with
`SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED`. For a separately owned native
Expo process, the application shell must own a complete admitted
`SnapbackExpoEnvironmentV1` (binding plus authority/custody lifecycle), or use
the lower-level app client with that admitted binding. There is currently no
safe “just pass the fixed URL” shortcut.

Keep the Expo/Metro process separately owned when pinning both sides. Do not
wrap the pair in `snapback dev --expo`: its listener enumeration supervises
the client process it started, and an independently owned fixed listener can
correctly fail with `SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`.

## Anti-patterns

- Expecting `snapback dev` to preserve a requested backend port.
- Running `--attach` without the exact live ready descriptor and database.
- Starting sessions mode without the generated startup-artifact carrier.
- Parsing server logs for the origin instead of consuming the ready file.
- Passing a raw origin to `SnapbackExpoProvider` or weakening binding
  admission after an override refusal.
- Letting two supervisors both believe they own the fixed backend or Expo
  listener.
