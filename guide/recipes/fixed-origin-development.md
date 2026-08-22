---
title: "Recipe: fixed-origin development and attach"
id: recipes.fixed-origin-development
order: 10
audience: agent-first
capabilities: [operating.packaged-dev-loop]
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0223-zero-config-connect-and-knowledge-closure.plan.md, llp/0224-prepared-standalone-operation.rfc.md, crates/snapback-activation/src/operational_readiness.rs, crates/snapback-server/src/server.rs, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-vite/index.mjs, packages/snapback-vite/lifecycle.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-environment.mjs]
examples: [packages/snapback-cli/dev-loop.test.mjs, packages/snapback-cli/sessions-dev-loop.test.mjs, packages/snapback-vite/package.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:292afba7d581f22c9589ba1001a721982aac4a31981bb4e036132804ee06b148
---

# Recipe: fixed-origin development and attach

> **Local target only.** This page describes an explicitly owned development
> server. It is not a hosted deployment recipe.

Use this route when a test, browser shell, or native harness must keep one
backend origin stable while generated artifacts continue to change. Ordinary
`snapback dev` selects a free port. Its fixed profile keeps the same lifecycle
owner while pinning the backend port and declaring the separately owned client
origin.

## Run one fixed-profile development loop

For a Vite client on port 5173 and a backend pinned to 42080:

```sh
snapback dev snapback \
  --port 42080 \
  --external-client-origin http://127.0.0.1:5173
```

Snapback owns the backend child and generate/load watcher. It adds the declared
client origin to the exact development **request-body origin admission** used by
auth and other authority-bearing dev requests; `SNAPBACK_DEV_AUTH_ORIGINS` does
not define `/health` CORS, which is loopback-open and therefore is not evidence
that a client origin reached the admission set. Snapback does not launch or stop
the Vite process. Start that client with its own normal command in another
terminal.

The declared origin must equal the browser's actual Vite origin. A Vite server
bound as `127.0.0.1` is not the `localhost` origin even when both reach the same
machine. The authoritative receipt records the server's full normalized
admission set: the declared origins, valid ambient
`SNAPBACK_DEV_AUTH_ORIGINS`, and any provider-owned aliases.

Re-running the same command with `--attach` is idempotent only for the exact
intended lifecycle:

```sh
snapback dev snapback --attach \
  --port 42080 \
  --external-client-origin http://127.0.0.1:5173
```

Attach validates the host descriptor and live startup nonce, then compares the
owner-only receipt's application deployment, authority settlement, artifacts,
target profile, capability digest, actual client origins, app binding,
qualified native binary, and CLI wrapper with fresh live operational readiness
before it changes the listener. A stale listener or wrong binding refuses
without adopting, killing, or replacing the process. An expired binding on an
otherwise matching cut is reissued rather than treated as a foreign child.
Closing an attached handle never shuts down the original owner's child.
`SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` names an occupied port without the
intended receipt-bound lifecycle; `SNAPBACK_DEV_FIXED_BINDING_MISMATCH` names
a live lifecycle whose admitted binding facts differ from the request; and
`SNAPBACK_DEV_APPLICATION_READY_STALE` names a same-host receipt that differs
from live application or authority facts.

Do not infer readiness or origin from logs. The host descriptor names the
listener; its deterministic `<ready-file>.application-ready` sibling is the
authoritative `snapback.application-ready.v1` settlement and admission
receipt.

## Preserve the sessions startup carrier

The lifecycle owner writes the complete sessions startup carrier before first
bind and rewrites it on every successful regenerate before hot-load. An
additive successor preserves the database, accounts, custody, sessions, and
client stores while advancing the complete active deployment identity. The
event stream reports the old and new identities; continuity does not mean
identity equality. `dev-fresh` is the explicit destructive verb and is never
implied by regenerate or attach.

`snapback start --startup-artifacts ...` remains available for lower-level
diagnosis and lifecycle acceptance harnesses. It is not the application
authoring path and shifts carrier correctness and process ownership to the
caller.

## Bind a separately owned client honestly

For web, `@expo/snapback-vite` managed/auto mode invokes this same fixed
profile. Configure `setup.backendDirectory` and the plugin's backend `port`;
Vite pins its own loopback port with `strictPort`, declares that client origin,
and consumes the application receipt. `virtual:snapback/dev` projects the
receipt-issued binding through the same-origin relay. It does not manufacture
binding provenance or expose the private backend origin, receipt path, or
qualified-binary facts to browser code.

The default `SnapbackExpoProvider` is supervisor-owned. A raw `{ origin }` or
raw binding override is not a supported substitute for its admitted
environment and can refuse as binding unavailable or with
`SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED`. For a separately owned native
Expo process, the application shell must own a complete admitted
`SnapbackExpoEnvironmentV1` (binding plus authority/custody lifecycle), or use
the lower-level app client with that admitted binding. There is currently no
safe “just pass the fixed URL” shortcut.

The supervised Expo profile declares Metro's `127.0.0.1`, `[::1]`, and
`localhost` loopback aliases into `runDev` before backend start. The Rust
server's consumed dev-body origin set is therefore the set written to the
receipt. Expo keeps
its device-route binding in owner-only transient `expo-supervisor.json` and the
rendezvous response; it never writes that projection back into the
application-ready file. Those are inspection/admission projections; attach
still trusts the application receipt.

## Anti-patterns

- Starting a second public lifecycle with `snapback start` for ordinary app
  authoring.
- Running `--attach` without the exact live ready descriptor and database.
- Treating port occupancy as server identity or deleting a stale listener on
  attach refusal.
- Parsing server logs instead of consuming the host and application receipts.
- Passing a raw origin to `SnapbackExpoProvider` or weakening binding
  admission after an override refusal.
- Hand-editing `startup-artifacts.json`, binding environments, or `.env*`
  origins instead of declaring the fixed profile.
