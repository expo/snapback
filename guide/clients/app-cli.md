---
title: The artifact-driven app CLI
id: clients.app-cli
order: 2
audience: agent-first
capabilities: [clients.app-cli]
authorities: [llp/0062-generated-app-cli-and-code-mode.rfc.md, packages/snapback-app-cli/index.mjs, packages/snapback-app-cli/cli.mjs, packages/snapback-app-cli/package.test.mjs, packages/snapback-client/index.mjs]
examples: [packages/snapback-app-cli/package.test.mjs, demos/todo/snapback/generated]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-19
reviewed-commit: 7d686f7d4ce4f606e3f9a00aeb1ea50d211ac1a7
---

# The artifact-driven app CLI

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-app-cli` packages the first complete agent-facing application
journey on top of `@expo/snapback-client`. It reads generated JSON artifacts as data,
never imports generated `api.mjs` or handler source, and exposes the generic
`snapback-app` command.

This page is intentionally **partial**: the shipped checkpoint covers explicit
local artifacts, JSON introspection, library calls/subscriptions, and the
fenced agent journey. Served envelopes, generation-bound calls, interactive
human session custody, frozen result/exit envelopes, code mode, and per-app
shims remain in LLP 0062's deferred program. Do not infer those surfaces from
the package name.

## Discover the app surface

Generate the app first, then point the CLI at the generated directory:

```sh
snapback-app --artifacts demos/todo/snapback/generated introspect
```

The loader joins `artifacts.json` to `functions.manifest.json`, requires one
`appId`, and reports each stable id, name, kind, auth requirement, and argument
schema path. A mismatch refuses with
`SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH`; an unknown function reports the
available manifest names. Discovery does not execute application code.

## Run the packaged agent journey

`runPackagedAgentJourney(...)` is the phase checkpoint and acceptance seam:

1. discover the generated function manifest;
2. present a user-minted pairing code and exact requested scopes;
3. mint a scoped token after approval;
4. put that token in `AgentAuthorityFence` and verify the service-principal
   handshake;
5. invoke a mutation;
6. establish a connection grant and live subscription;
7. query to verify the committed state.

The returned result includes redacted grant/scope facts and operation results,
never credential or token plaintext. Use the lower-level `pairAgent`,
`mintAgentToken`, `invokeAppFunction`, and `subscribeAppFunction` exports when a
coordinator owns the approval pause or needs multiple calls. For agent auth
semantics and durable daemon custody, read
[Agent principals](../auth/agent-principals.md).

## Know the current command boundary

The executable currently exposes `introspect`; the package exports the call,
subscribe, pairing, and journey operations for programmatic agent runners. The
older 19-ticket program is explicitly rescoped around this useful checkpoint.
Those deferred tickets remain design work, not implied CLI commands.

## Anti-patterns

- Do not import generated `api.mjs` merely to discover functions.
- Do not guess a checkout or artifact directory.
- Do not pass admin credentials to the app CLI.
- Do not return a scoped bearer in JSON, logs, or diagnostic details.
- Do not claim served-envelope or code-mode guarantees from this local
  artifact checkpoint.
