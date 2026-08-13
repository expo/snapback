---
title: The artifact-driven app CLI
id: clients.app-cli
order: 2
audience: agent-first
capabilities: [clients.app-cli]
authorities: [llp/0062-generated-app-cli-and-code-mode.rfc.md, llp/0146-agentic-authoring-affordances.rfc.md, llp/0150-agent-token-acquisition.rfc.md, llp/0204-app-external-surfaces.rfc.md, packages/snapback-app-cli/index.mjs, packages/snapback-app-cli/cli.mjs, packages/snapback-app-cli/oauth.mjs, packages/snapback-app-cli/digest.mjs, packages/snapback-app-cli/agent-digest.schema.json, packages/snapback-app-cli/auth.mjs, packages/snapback-app-cli/code-mode.mjs, packages/snapback-app-cli/code-mode-ibex.mjs, packages/snapback-app-cli/schema-interpreter.mjs, packages/snapback-app-cli/ibex-bundle.mjs, packages/snapback-app-cli/result-core.mjs, packages/snapback-client/app-data.mjs, scripts/build-app-bound-executable]
examples: [packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, packages/snapback-app-cli/code-mode.test.mjs, packages/snapback-app-cli/code-mode-ibex.test.mjs, packages/snapback-app-cli/schema-interpreter.test.mjs, packages/snapback-app-cli/ibex-bundle.test.mjs, packages/snapback-app-cli/cli.test.mjs, packages/snapback-app-cli/digest.test.mjs, demos/todo/snapback/generated]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:81f4c4ce553e40209fd74b935585cd0a515e72808971f218a178f62cc1f0aa34
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

The local phase-1 engine is shipped. Phase 2 has an app-bound Ibex builder,
embedded coordinator, and literal executable proof on qualified macOS arm64
and Linux x86_64 GLIBC 2.35 tuples. Its host-portable lifecycle and acceptance
matrix is complete on both, including signal-first grace, exact frame
admission, strict settlement, resource classification, deterministic cleanup,
value-free audits, static Linux Fetch/WebSocket networking, and a
producer-free clean-consumer proof. The capability remains partial because
hosted targets do not advertise it and public inspection still lacks the
dynamic observations described below.

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

## Pull a bounded agent digest

`introspect` emits `snapback.agent-digest.v1`: a stable, value-free document
with a static section keyed by `envelopeHash` and a dynamic section keyed by
the returned `digestCursor`. Pass that cursor back on the next call:

```sh
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated introspect --budget-bytes 32768 --budget-items 256
snapback-app --server http://127.0.0.1:3000 --artifacts ./snapback/generated introspect --changed-since 'sbad1.…'
```

The static section contains artifact identities, table summaries, operation
signatures and contracts, and capability gaps in key order. Its cursor carries
the prior item hashes, so one changed schema item can produce one changed
item without retained server state. A bare envelope hash remains accepted:
when it matches, the static delta is empty and the dynamic section is still
sent whole.

The dynamic v0 is deliberately coarse. It always re-emits its complete
available observation section and reports
`coarse-resolution-v0-no-observation-retention`; cursors minted by v0 do not
expire and Snapback retains no prior observation manifest. Unknown or
structurally expired cursors return a named full-digest degradation, never an
empty success. Budgets apply to canonical JSON bytes and item count. Every
omission carries an elision marker naming the section, omitted count, and the
flags to increase.

This projection never includes row values, call arguments, result payloads,
credential material, or raw diagnostic messages/details. The public app-data
inspection surface does not currently expose per-table row counts or D1
conformance observations, so those dynamic items carry explicit unavailable
reasons. Local artifacts use a deterministic
`local-generated-static-projection` identity when there is no served API
envelope; that is not represented as a served-envelope claim.

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

<!-- since: 0.1.16 -->

## Log in through the external OAuth facade

For first contact, pass only the app URL. With no verb, the CLI fetches the
served envelope and prints the app id, envelope digest, exposed function count,
available verbs, and the login command:

```sh
snapback-app https://example.snapback.app
```

`login` discovers the app's authorization server, dynamically registers one
public client, and runs authorization code with PKCE S256. It always prints the
authorize URL; open that URL in a browser where the app user is already signed
in. The consent page is the approval surface.

```sh
snapback-app --server http://127.0.0.1:3000 login
```

The first login selects an ephemeral `127.0.0.1` callback port and caches that
exact redirect with the DCR `client_id`. Later logins reuse the registration and
try to bind the same port. `--no-browser`, or a port that cannot be rebound,
uses the same printed authorize URL and asks you to paste the returned callback
URL or short-lived code:

```sh
snapback-app --server http://127.0.0.1:3000 login --no-browser
```

The scope default is deterministic. The CLI chooses the first advertised
bundle named `read` or ending in a read segment (for example `items.read`),
then the first bundle whose declared functions are all queries/live queries,
then the first advertised bundle. Override it with comma-separated bundle
names:

```sh
snapback-app --server http://127.0.0.1:3000 login --scopes items.read,calendar.read
```

The target-keyed directory under `~/.snapback/app-cli/oauth/` is mode 0700.
`oauth-public-client.json` caches the non-secret public registration and
`oauth-bearer-token.json` honestly stores the bearer; both are mode 0600. The
CLI prints the bearer file path and absolute expiry, never the token. Facade
tokens expire after 15 minutes and have no refresh token, so repeat `login`
after expiry. If discovery is absent, enable `api.oauth.enabled` with the
explicit `api.oauth.bearer: true` weakening, or use the native `pair` path.

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

The Node child-process split is a credential non-transmission contract, not a
hostile-code sandbox. A Node `vm` escape has the invoking OS user's authority;
run only scripts trusted at that level. The app-bound Ibex checkpoint keeps the
same broker shape while running the admitted script in a separate restricted
Hermes runtime with no ambient filesystem, network, environment, subprocess,
clock/randomness, import, or dynamic-code authority.

## Build the experimental app-bound executable

Release producers can build from an app-bound Ibex release kit and pin the
app's normalized HTTPS origin, app id, engine compatibility identity,
publisher key identity, and reproducible recipe digest:

```sh
scripts/build-app-bound-executable --ibex /opt/ibex-app-release/ibex --origin https://example.snapback.app --app-id example --engine-compatibility sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA --publisher-key-id release-key-1 --recipe-digest sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA --output ./example
```

The builder inspects the result and refuses unless its Stub V4 contract reports
the requested binding. Qualified outputs are literal single files with no Node,
npm tree, Hermes framework, shared library, catalog, or policy sidecar beside
them. Their command shape is:

```sh
./example introspect
./example call createTodo --args-json '{"text":"Buy milk"}'
./example run analysis.ts
```

`--server`, `--app`, and `--artifacts` are unavailable in this mode: the
executable admits only its embedded app identity. The current API envelope is
dynamic data fetched from that origin, so ordinary function and schema deploys
do not alter the fixed binding. Rebuilds are intended only for that binding,
the trusted engine/runtime, policy/protocol, platform, or release provenance;
the comprehensive §7 disclosure, ceiling, lifecycle, race, dependency, and
relocation matrix is green on qualified macOS arm64 and Linux x86_64 GLIBC
2.35. Unsupported producer tuples refuse instead of emitting a wrapper or
sidecar approximation. Qualification establishes the producer and executable
contract; it does not by itself create or promise a public download channel.

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
coordinator owns the approval pause or needs multiple calls. Two further
library exports round out that seam: `loadAppArtifacts(directory)` loads and
identity-validates a generated artifact directory into the inert surface the
other calls consume, and `startAppFunctionLive(client, artifacts, name,
options)` opens a **managed** live-query handle over a declared live query
through `client.startLiveQuery` (where `subscribeAppFunction` performs the
one-shot low-level subscribe). For agent auth
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
- Do not infer a public release channel from producer qualification; publish
  an app-bound executable only through a release process that preserves its
  binding and provenance.
- Do not describe the Node package as the app-bound one-file executable; they
  remain distinct products with different trust and distribution postures.
