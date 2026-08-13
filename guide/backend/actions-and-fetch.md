---
title: Actions and outbound fetch
id: backend.actions-and-fetch
order: 3
audience: agent-first
capabilities: [backend.actions]
authorities: [llp/0004-application-data-api.rfc.md, llp/0009-code-execution-security.rfc.md, llp/0036-app-secrets-and-config.rfc.md, llp/0043-offline-replay-retention.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0076-bounded-streamed-actions.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-harness/ctx-bootstrap.js, src/server.rs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/snapback/handlers.mjs, demos/all-aboard/tests/egress-probe/functions.mjs, demos/all-aboard/tests/egress-probe/handlers.mjs, demos/all-aboard/tests/acceptance/egress.mjs, demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs]
examples: [demos/all-aboard, demos/competitive-checkpoint]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:63ee41d271a9a40072ccb8ce36307972fe1ea2a65d54c2464fe4f847a55a7faf
---

# Actions and outbound fetch

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

An action is the non-transactional function class for external I/O and
longer-running orchestration. It may fetch only when the deployment enables
outbound actions, receives only the config entries named by `uses`, and
commits durable state by calling a mutation.

## Declare the powers the action needs

All Aboard's feed action declares typed arguments, its JS handler, the one
config pool it may read, and the tables mutations it invokes can write:

```js source=demos/all-aboard/snapback/functions.mjs
export const refreshFeed = defineAction({
  args: {
    trigger: v.optional(v.string()),
    source: v.optional(v.string()),
    feedUrl: v.optional(v.string()),
    // Testing knob (short-cadence acceptance rigs): lowers the upstream-poll
    // budget window; clamped so it can never RAISE the 180s production budget.
    pollBudgetMs: v.optional(v.integer()),
  },
  js: { source: 'handlers.mjs', exportName: 'refreshFeed' },
  // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the grant that
  // hands the live fetch its rotating key via ctx.secrets.
  uses: ['caltrainFeed'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
});
```

`uses` is an allowlist, not documentation. Codegen rejects unknown entries,
and `ctx.secrets` refuses an entry the action was not granted. Declare values
and configure deployments as described in
[secrets and config](../operating/secrets-and-config.md).

## The handler file is a closed script

The file named by `js.source` is **not an ES module**: it is a closed
single-file script, and `exportName` resolves against a registration object
the file assigns to `globalThis.__snapbackHandlers`. An ES `export`
statement refuses at generation (`BUNDLE_UNSUPPORTED_EXPORT`), and a file
that never registers the name fails at load with
`SNAPBACK_HANDLER_EXPORT_MISSING`. The CI-executed egress conformance
fixture is the canonical shape — declaration:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyDelivery = defineAction({
  args: { url: v.string() },
  js: { source: 'handlers.mjs', exportName: 'notifyDelivery' },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: ['deliveries'],
});
```

and the handler file's registration, performing a real outbound fetch and
committing the response through a named mutation:

```js source=demos/all-aboard/tests/egress-probe/handlers.mjs
globalThis.__snapbackHandlers = {
  // Canonical module-form fetching action: outbound fetch against a local
  // provider, response committed durably through a named mutation.
  async notifyDelivery(ctx, args) {
    const response = await fetch(args.url);
    const body = await response.text();
    if (response.status !== 200) {
      throw new Error('delivery provider refused: ' + response.status);
    }
    await ctx.runMutation('recordDelivery', { url: args.url, body });
    return { delivered: true };
  },
```

Several handlers can share one file: register each `exportName` as another
key on the same object.

### The inline form

An action may instead carry its handler inline as a self-contained
`handler:` function expression (LLP 0108). Under the same
`SNAPBACK_OUTBOUND_ACTIONS` opt-in, an inline action handler may reference
the global `fetch`:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyInline = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await fetch(args.url);
    const body = await response.text();
    return { delivered: response.status === 200 && body.length > 0 };
  },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: [],
});
```

### Host-mediated `ctx.fetch`

Alongside the global `fetch`, an action may use the host-mediated
`ctx.fetch` (LLP 0049 §Action Egress). It is target-portable: on the local
target it is served by the same detached execution lane as
`ctx.fetchStream`, under the same `SNAPBACK_OUTBOUND_ACTIONS` gate, and on
both targets it resolves to the same buffered value —
`{status, ok, url, bodyText}` with the authored URL echoed:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyHostFetch = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await ctx.fetch({ url: args.url });
    return {
      delivered: response.ok === true && response.status === 200,
      body: response.bodyText,
    };
  },
  result: results.value(v.object({ delivered: v.boolean(), body: v.string() })),
  writes: [],
});
```

Responses are bounded (1,000,000 bytes, UTF-8 text; the refusals are
`SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE` and
`SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8` on every target). Secret
DESCRIPTOR placement slots resolve only at the hosted fetch boundary; the
local profile stages secret values through `ctx.secrets` handles into
headers and refuses descriptor slots with
`SNAPBACK_HOST_FETCH_SLOT_INVALID`. `ctx.fetchStream` works the same way
on both targets ([streamed actions](./streamed-actions.md)).

For the partial local agent-auth slice, codegen also derives
`authorityCreating: true` when an action or mutation declares a write to a
`permissionBacking` table; an opaque path may conservatively set the boolean
explicitly. This is an admission signal, not the security boundary: the host
rechecks the resolved grant's exact consent at the permission-backing write.

## Keep network I/O outside the transaction

Actions do not get `ctx.db`. Fetch or compute first, then call a named
mutation through `ctx.runMutation`; that mutation owns the atomic durable
commit and live fan-out:

```js source=demos/all-aboard/snapback/handlers.mjs
      const snapshot = await fetchCaltrainSnapshot(ctx, args || {});
      return await ctx.runMutation('applyLiveFeedSnapshot', {
        trigger,
        source: '511-siri-stop-monitoring',
        delays: snapshot.delays,
        departures: snapshot.departures,
```

This split prevents a slow or failed network request from holding the write
lane. Nested mutations inherit the action's server-resolved authority; they do
not accept a replacement identity.

<!-- since: 0.1.15 -->

Actions themselves cannot call `ctx.mutation.settlement()`; the host refuses
it with `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`. For replay-stable external
delivery, have the nested mutation [derive and store an effect key](./mutations.md#derive-a-replay-stable-effect-key),
then let the action or worker perform the I/O from that durable intent.

Two adjacent action surfaces have their own pages: a mutation schedules an
action to run later, transactionally with its writes, via `ctx.jobs.enqueue`
([one-off durable jobs](./jobs.md)); and an action sends Expo push
notifications through the declared seam's `ctx.push` surface
([Expo push](./expo-push.md)).

## Enable egress deliberately

Outbound egress is off by default, and the same opt-in is evaluated at two
separate boundaries:

1. **Generation time.** The process running `snapback generate` (or the
   repository codegen entry point) needs `SNAPBACK_OUTBOUND_ACTIONS=1` while it
   validates a bundle containing `fetch` or timers. Without it, generation
   fails early with `BUNDLE_UNSUPPORTED_FETCH` or
   `BUNDLE_UNSUPPORTED_TIMER`.
2. **Process runtime.** The Snapback server process also needs
   `SNAPBACK_OUTBOUND_ACTIONS=1`. Generation does not grant the running
   process network authority, and the runtime remains the security boundary.

The codegen acceptance witness sets the generation-process environment before
validating the action:

```js source=packages/snapback-codegen/authoring-validation.test.mjs
const previousOutboundActions = process.env.SNAPBACK_OUTBOUND_ACTIONS;
process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
```

Prefix whichever authoring command you use. The managed `dev` command runs
generation before starting or attaching to the server, so one prefixed command
carries the opt-in through that managed loop:

```sh
# Generate artifacts without starting the managed server.
SNAPBACK_OUTBOUND_ACTIONS=1 snapback generate snapback

# Or run managed generation + server development under the same opt-in.
SNAPBACK_OUTBOUND_ACTIONS=1 snapback dev snapback
```

A harness that starts the server directly passes the runtime environment
explicitly:

```js source=demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs
const source = await startStreamSource();
const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
  provenance: {
    appId: 'competitive-checkpoint',
    artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
  },
});
```

Queries and mutations remain denied fetch even in an enabled runtime:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
  await suite.check('a query in the same runtime is still denied fetch and has no ctx.secrets', async () => {
    const { rows } = await dbOn.query('queryProbe', {});
    assert(/AMBIENT_CAPABILITY_DENIED/.test(rows[0].fetchState), `query fetch should be denied, got: ${rows[0].fetchState}`);
    assertEqual(rows[0].secretsState, 'undefined', 'queries get no config surface');
```

Action wall-clock limits and the detached watchdog still apply. A timed-out
action cannot commit late, and a later invocation gets an isolated worker.

## Treat fetched text as data

Egress does not make an action a general-purpose code loader. Direct or
indirect `eval`, every Function-family string constructor (including
constructor walks and reflective calls), and WebAssembly are unavailable at
the runtime boundary. The same rule applies on the local Ibex engine and the
Workerd target. Codegen reports the obvious source forms early, but the engine
policy is what prevents aliases from bypassing the rule.

Do not fetch JavaScript, templates intended for evaluation, or remote policy
code. Parse a response as validated data and pass only typed values to a named
mutation. This keeps the manifest's bundle hash truthful: an action may use its
declared secret and egress authority, but fetched bytes never inherit its
`ctx.runMutation` authority as executable code.

## Handle failure as data only when the product means it

An action may return a structured fallback result when fallback is an explicit
product behavior, as All Aboard does for recorded data. Otherwise throw: the
action error remains a structured diagnostic envelope. Never convert
configuration, permission, or timeout failures into a false success merely to
keep a UI quiet.

Await or return every asynchronous branch whose outcome matters. The runtime
treats an unhandled detached rejection as a handler failure; it cannot be
reclassified as successful settlement by replacing reachable Promise hooks.

## Stream a response

Consuming an upstream response incrementally — an AI token stream, a large
export — is its own bounded surface with its own limits, attempt control
plane, and diagnostic codes. See
[streamed actions](./streamed-actions.md) for the whole pattern:
`ctx.fetchStream`, the one-pull-per-cursor reader, the
`ctx.streamAttempt` lease/settlement surface, the v1 limits (1 MiB total,
16 KiB reads, 64 KiB buffering, 30 s wall, 5 s idle, 4 cursors, ten
progress commits per second), and every `SNAPBACK_ACTION_STREAM_*` refusal.
Stream diagnostics name this section as their repair anchor; the page above
is the repair.

## Anti-patterns

- **Do not fetch inside a query or mutation.** The ambient-capability gate
  refuses it, and transactions must not wait on the network.
- **Do not pass API keys in action arguments.** Declare config and grant it
  with `uses`.
- **Do not write durable state directly from an action.** Call a mutation so
  validation, receipts, and live delivery share one commit.
- **Do not enable egress globally as a convenience.** Turn it on only for the
  deployment that needs actions with network access.
- **Do not evaluate fetched text.** Parse and validate it as data; dynamic
  source compilation is denied even for egress-enabled actions.
- **Do not launch unobserved Promise chains.** Await or return them so their
  failure remains part of the handler's explicit result.
- **Do not split a buffered body after receipt and call it streaming.** The
  witness must observe multiple durable commits before upstream completion.
