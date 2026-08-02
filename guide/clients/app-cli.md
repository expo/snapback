---
title: The artifact-driven app CLI
id: clients.app-cli
order: 2
audience: agent-first
capabilities: [clients.app-cli]
authorities: [llp/0062-generated-app-cli-and-code-mode.rfc.md, packages/snapback-app-cli/index.mjs, packages/snapback-app-cli/cli.mjs, packages/snapback-app-cli/auth.mjs, packages/snapback-app-cli/code-mode.mjs, packages/snapback-app-cli/result-core.mjs, packages/snapback-client/app-data.mjs]
examples: [packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, packages/snapback-app-cli/code-mode.test.mjs, packages/snapback-app-cli/cli.test.mjs, demos/todo/snapback/generated]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-01
reviewed-commit: HEAD
---

# The artifact-driven app CLI

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`@expo/snapback-app-cli` gives a Snapback application an agent-facing terminal
surface without executing application source. It reads generated artifacts or
the server-composed API envelope as inert data, validates the current target
descriptor, and exposes the generic `snapback-app` command. Calls carry the
five-part generated identity so a deploy between discovery and dispatch
refuses rather than running against different code.

The local phase-1 engine is shipped. The capability remains marked partial
because hosted targets do not advertise it and the app-bound, single-file Ibex
executable is phase 2, blocked on the Ibex embedding contract. The current
download is the Node package, not the promised one-file executable.

## Discover the app surface

Use generated artifacts against a development target:

```sh
snapback-app --artifacts demos/todo/snapback/generated introspect
```

Or omit `--artifacts` against a sessions target that serves
`/app-api/current` and content-addressed `/app-api/envelope/{sha256}`. The
engine re-verifies JCS bytes, member digests, content address, app identity,
and projection correspondence itself before the surface can shape a call. The
bounded cache serves offline `introspect` and `types`; it never authorizes an
offline call.

The local loader joins `artifacts.json`, `functions.manifest.json`, and present
operation argument schemas, requires one `appId`, and reports every stable id,
name, kind, auth requirement, and schema. A mismatch refuses with
`SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH`; an unknown function reports the
available manifest names. Discovery never imports `api.mjs`, a handler bundle,
or server-provided JavaScript.

## Choose authority explicitly

Anonymous is always the default, even if session or agent material exists in
the environment. Select a lane deliberately:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --principal dev --dev-user user_123 call listNotes
snapback-app --server http://127.0.0.1:3000 --principal session --session-bearer-file /absolute/private/session call listNotes
snapback-app --server http://127.0.0.1:3000 --principal agent --agent-profile /absolute/private/agent-profile.json call listNotes
```

`--principal auto` is opt-in inventory, not precedence: no source means
anonymous, exactly one source is selected, and multiple sources refuse. A live
malformed or stale source is terminal and never falls back. `whoami` and
`introspect` report the source, never secret material.

The dev lane adds the caller-selected user id to the legacy dev request body;
a sessions-mode server refuses it. Human sessions adopt a bearer supplied by a
trusted external broker through the non-custodial LLP 0096 client seam: the CLI
does not persist or refresh it. Session files and agent profiles are bounded,
owner-owned, single-link mode-0600 files below non-writable real ancestors.
Credentialed commands require POSIX ownership/mode semantics.

The only client-side authorization predictions are target capability and
anonymous-to-`authenticated`. Every role, grant scope, optional-user rule, and
application refusal remains server-authoritative.

## Pair and invoke an agent safely

Provision the durable `sbac_` credential outside the repository, then supply a
pairing challenge on stdin or in a private file. It is never an argv or
environment value:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated pair --request request_123 --pairing-code-file /absolute/private/code --credential-file /absolute/private/agent-credential --profile-out /absolute/private/agent-profile.json --scopes-json '[{"tier":"query"}]'
```

Agent credentials are restricted to literal loopback origins and a loopback
socket peer; redirects are terminal. The profile persists only the durable
authority tuple and a credential reference. Each invocation acquires a
cross-process slot from the target-advertised token cap, mints a short-TTL
token, re-attests the complete actor/effective/credential-generation/grant
tuple, and releases the exact token on settlement. A long-running subscription
renews from the server-relative lifetime, cuts and resubscribes through the
client authority fence, then releases the predecessor. Release retries once;
TTL is the crash-safe backstop. Pairing releases its first poll token
immediately.

## Call a function

`call` accepts a stable id or exported name and validates JSON arguments before
dispatch:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --args-json '{"page":2}' call listNotes
```

Non-TTY single results are JSON. The semantic core is the Rust-owned shared
app-data result envelope; server diagnostic codes and attribution survive
without free-text details. The frozen exits are 0 success, 2 usage, 3 auth, 4
not found, 5 function error, 6 transport, 7 artifact identity, 8 version
admission, 9 timeout, 10 script error, and 11 resource ceiling.

`call` on a live query returns its authoritative current snapshot. Use
`subscribe` when later changes matter. The default prints the current snapshot,
waits for the first JCS-distinct change, prints it, and exits; `--watch` emits
deduplicated JSONL until a signal or timeout:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --args-json '{"team":"red"}' subscribe activeGames
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated --watch subscribe activeGames
```

## Run a local TypeScript analysis

`run` evaluates one local `.ts`/`.js` file, or `-` for stdin. The
credential-owning parent performs every app call; the child receives a frozen
`api`, `snapback.function(stableId)`, `args`, `signal`, console/timers, and no
bearer, target URL, inherited environment, filesystem helper, or fetch global:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated run analysis.ts -- customer_123
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated types --out .snapback-types
```

The output directory receives `api.d.ts` for the descriptor surface and a
merged `code-mode.d.ts` for the injected code-mode globals and callable app
bindings.

The language profile is a single erasable-TypeScript module with top-level
await. Runtime imports, dynamic imports, `import.meta`, enums, namespaces, and
parameter properties refuse. The awaited default export is the only stdout
value and must satisfy the strict JSON profile. Calls cross a versioned,
bounded broker with per-call and whole-run timeouts; stderr audit records carry
function ids, safe codes, attribution, and counters but no intermediate
values. Valid hazardous names such as `then` lose their property alias and
remain callable only through `snapback.function(id)`.

The child-process split is a credential non-transmission contract, not a
hostile-code sandbox. A Node `vm` escape has the invoking OS user's authority;
run only scripts trusted at that level. The future Ibex host strengthens
enforcement while keeping the same broker ABI.

## Run the packaged agent journey

`runPackagedAgentJourney(...)` remains the library acceptance seam:

1. discover the generated function manifest;
2. present a user-minted pairing code and exact requested scopes;
3. mint a scoped token after approval;
4. put that token in `AgentAuthorityFence` and verify the service-principal
   handshake;
5. invoke a mutation;
6. establish a connection grant and live subscription;
7. query to verify the committed state;
8. release the exact scoped carrier.

The returned result includes redacted grant/scope facts and operation results,
never credential or token plaintext. Use the lower-level `pairAgent`,
`mintAgentToken`, `invokeAppFunction`, and `subscribeAppFunction` exports when a
coordinator owns the approval pause or needs multiple calls. For agent auth
semantics and durable daemon custody, read
[Agent principals](../auth/agent-principals.md).

## Anti-patterns

- Do not import generated `api.mjs` merely to discover functions.
- Do not guess a checkout or artifact directory.
- Do not pass admin credentials to the app CLI.
- Do not return a scoped bearer in JSON, logs, or diagnostic details.
- Do not pass a pairing code on argv or persist a scoped token in an agent
  profile.
- Do not infer agent safety from a hostname; the phase-1 lane requires a
  literal loopback origin and peer.
- Do not describe the Node package as the app-bound one-file executable; that
  phase is blocked on the Ibex contract.
