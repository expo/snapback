# Exact TUI agent listener conflicts with an outbound-only app network fence

**Status:** Open
**Severity:** P2
**Systems:** Chat matrix, Exact TUI, Agent API, Capability security
**Date:** 2026-07-25
**Observed Exact revision:** `7dcae80ed195c8fb3be14d531717cad7e6dd53f7`

The chat-matrix Exact TUI now declares the loopback gateway through
`capabilities.networkHosts: ["127.0.0.1"]`. Exact correctly admits only
outbound `network:fetch` and `network:connect` for that host and denies inbound
listeners.

The default agent-enabled TUI launch does not compose with that fence. The
trusted Exact agent sidecar calls `__exactHttpServe`, receives:

```text
Permission denied: network:listen capability required
```

and the host then fails with:

```text
runtime-thread boot failed: Hermes evaluation failed:
TUI agent server did not bind within 10 seconds
```

This reproduces with both the deterministic copied-host output from
`exact build tui --release` and the normal agent-enabled development launch.
The same app launches and completes a real gateway send/streamed-reply loop
with `exact run tui --no-agent`, proving that the app's outbound fence and data
module work; the conflict is the control-plane listener.

## Consequence

The demo's development command must currently disable the agent server, so the
TUI cell loses Acto inspection. `exact build tui --release` has no `--no-agent`
option and always emits an agent-enabled manifest/sidecar, so its otherwise
deterministic copied-host closure cannot launch this outbound-only app.

## Fix wanted in Exact

Keep the app fence narrow; do not grant application code `network:listen`.
Either:

1. install the trusted agent listener in a control-plane capability domain
   outside the app's immutable network ceiling; or
2. make agent omission a governed release-build option and emit
   `target.agent: false` with no agent artifacts.

Add a registered TUI launch check combining a declared loopback fetch host
with the default agent sidecar, plus a release no-agent check if option 2 is
supported. The app must retain denial of arbitrary listeners in both cases.
