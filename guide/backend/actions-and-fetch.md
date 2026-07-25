---
title: Actions and outbound fetch
id: backend.actions-and-fetch
order: 3
audience: agent-first
capabilities: [backend.actions]
authorities: [llp/0004-application-data-api.rfc.md, llp/0009-code-execution-security.rfc.md, llp/0036-app-secrets-and-config.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, packages/snapback-codegen/define.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/snapback/handlers.mjs, demos/all-aboard/tests/acceptance/egress.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-24
reviewed-commit: a5ed6ebd05766b10607937a1c010352d79eea4b0
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

## Enable egress deliberately

The local runtime denies `fetch` by default. Enable it explicitly with
`SNAPBACK_OUTBOUND_ACTIONS=1` for the deployment/process that should have
egress. Queries and mutations remain denied even in that runtime:

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
