---
title: Deploying the Cloudflare proof
id: deploying.cloudflare
order: 2
audience: agent-first
capabilities: [deploy.cloudflare]
authorities: [llp/0014-cloudflare-strategy.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0040-cloudflare-narrow-proof.rfc.md, llp/0049-all-aboard-cloudflare-live.plan.md, llp/0060-hosted-auth-security.rfc.md, llp/0094-wire-envelope-contract.spec.md, schemas/cloudflare.deploy-receipt-v1.schema.json, schemas/live.kit-socket-request.schema.json, schemas/live.kit-socket-reply.schema.json, cloudflare/README.md, cloudflare/deploy.sh, cloudflare/src/gateway.js, cloudflare/src/coordinator.js, src/server.rs, cloudflare/test/local-suite-manifest.mjs]
examples: [demos/all-aboard, cloudflare/app/all-aboard.app.js]
status: current
targets: [cloudflare]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:5a26b512f9bfd6946148fabe46fc8ac367af3dab85d2b64bd2d18bab58a8e97f
---

# Deploying the Cloudflare proof

Snapback's Cloudflare target is real but narrow. The All Aboard Contract app
has been deployed and remotely proven over Workers, a coordinator Durable
Object with SQLite, a separate V8 action isolate, same-origin static/native
assets, WebSocket Hibernation, deploy-time secrets, and demand-armed alarms.
It is a proof profile—not a general hosted Snapback product.

The target profile id is `cloudflare-do-sqlite-v8`. Read the deployed
`GET /capability` or `/inspect` result before relying on a feature; its explicit
`capabilityGaps` outrank assumptions from the local guide.

## Prove the profile locally first

Use the Node major pinned in `.node-version` (24.x) and the repository-locked
Wrangler:

```sh fragment reason="Canonical local Cloudflare regression commands, composed with the repository Node pin."
volta run --node 24.18.0 -- node cloudflare/test/local-suite.mjs
volta run --node 24.18.0 -- node cloudflare/test/measure.mjs
```

The suite inventories every non-remote gate; the canonical check count is
the `EXPECTED_LOCAL_SUITE_CHECKS` constant in
[`cloudflare/test/local-suite-manifest.mjs`](repo:cloudflare/test/local-suite-manifest.mjs)
(29 as of this review), and the runner asserts the executed count against it.
Miniflare validates protocol, storage, handlers, secrets, egress, cron, and
hibernation-event behavior, but it cannot prove platform eviction, placement,
or billing. Those require a real Cloudflare run.

## Understand the deployed shape

One gateway Worker routes HTTP, WebSockets, capability reads, and assets to one
named app coordinator Durable Object. That object's embedded SQLite owns:

- app and system tables;
- the per-app commit-version counter;
- change journal and storage-backed subscriptions;
- connection grants and cron/config state.

A mutation commits version, rows, and journal in one `transactionSync`. Live
fan-out happens directly from that commit—there is no polling tailer. App code
is compiled into the Worker at deploy time because deployed Workers forbid
dynamic evaluation; changing schema/handlers is a redeploy, not a bundle load.

Handlers run through the stripped, single-sourced V8 harness. Queries and
mutations receive only generated `ctx` powers. Actions run in a separate
handler Worker so a slow external fetch cannot queue the coordinator's
transactional work.

## Deploy All Aboard

Deployment mutates a real Cloudflare account. Use a Workers + Durable
Objects-scoped token and an independently generated admin token; never commit
either:

```sh fragment reason="All Aboard selection added to the canonical cloudflare/README.md deployment sequence."
bun install --frozen-lockfile
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export SNAPBACK_ADMIN_TOKEN=...
SNAPBACK_CF_APP=all-aboard ./cloudflare/deploy.sh
```

The script builds the same-origin Contract/native bundle, verifies the
repo-local Wrangler and locks, deploys handler dependencies before the gateway,
attests the exact active Worker version, and performs the final gateway deploy
after secret changes. On a partial failure it attempts to restore previously
active Worker versions; ambiguous account/API state fails closed.

On success, the script emits exactly one JSON line with
`schemaVersion: snapback.cloudflare-deploy-receipt.v1`. The receipt names each
Worker and its exact activated version, the probe URL, final health code, and
the actions this run took. Validate or retain it using
`schemas/cloudflare.deploy-receipt-v1.schema.json`; ordinary progress lines are
not deployment evidence.

An absent local `SNAPBACK_ADMIN_TOKEN` is not evidence that the remote secret
is absent. Deployment reports absent, present-and-preserved, or unknown; only
`SNAPBACK_ADMIN_TOKEN_REMOVE=1` requests attested removal.

## Configure declared secret pools

All Aboard declares `caltrainFeed` and `directions`. Send one JSON object of
non-empty string arrays over stdin, never in argv or shell history:

```sh source=cloudflare/README.md
SNAPBACK_ADMIN_TOKEN=... node cloudflare/config-set.mjs \
  --url https://snapback-all-aboard-proof.<subdomain>.workers.dev \
  --entries-stdin < /secure/path/to/secret-pools.json
```

`config-set.mjs` reads the current generation, writes changed bindings plus a
new `SNAPBACK_CONFIG_GENERATION` in one `wrangler secret bulk` activation, then
polls authenticated `/_snapback/api/config/status` (the hosted system surface
lives under `/_snapback/*`) until that generation and member counts are
attested as applied. It refuses value-bearing argv flags. Status returns
names, set/missing state, counts, and grant relationships—never values.

App actions receive descriptor handles only. Values unwrap at the coordinator's
host-fetch boundary into declared query-parameter or header slots:

```js source=cloudflare/app/all-aboard.app.js
  const response = await ctx.fetch({
    url,
    headers: { Accept: 'application/json' },
    timeoutMs: 15_000,
    secretSlots: [{ placement: 'query-param', name: 'api_key', handle }],
  });
```

Ambient `fetch`, `.expose()`, and `.asBearer()` stay unavailable in the app
isolate. The host validates HTTP(S), descriptor ownership and placement,
enforces action/fetch deadlines and bounded response bodies, and redacts secret
values before any response or diagnostic re-enters app code. This is not a
general egress claim: the two All Aboard placement shapes are proven, but a
destination allowlist is still a declared gap.

## Run the remote proof

After secrets are applied, run the real-deployment acceptance:

```sh fragment reason="All Aboard remote acceptance invocation from the runner header."
SNAPBACK_PROOF_URL=https://snapback-all-aboard-proof.<subdomain>.workers.dev \
SNAPBACK_ADMIN_TOKEN=... \
  node cloudflare/test/acceptance.remote.all-aboard.mjs
```

It proves cold start, same-origin Contract/native assets, ensure/seed, config
attestation, finite queries and mutations, real hibernating WebSocket push,
live 511/directions actions, demand-armed warm polling, eviction recovery, and
secret redaction. Expect minutes rather than seconds because it waits for a
real scheduled cycle.

For the notes proof, `cloudflare/test/acceptance.remote.mjs` additionally
records connected-idle billing windows and platform-eviction evidence. Cloudflare
analytics may settle several minutes later; re-read the emitted window before
calling observed-zero usage final.

## Hibernation, reconnect, and idle-to-zero

Server-held sockets use the Durable Object WebSocket Hibernation API. Durable
subscription rows, not isolate memory or socket attachments, are the recovery
authority. After wake/eviction, the object rehydrates them; socket loss takes a
fresh snapshot-with-subscribe. Retained-version resume and HTTP outbox delta
polling are explicit gaps.

The hosted kit socket's in-band durable surface is independently governed:
`live.kit-socket-request.schema.json` covers `subscribe`, `unsubscribe`, and
`ping`; `live.kit-socket-reply.schema.json` covers the actually served
`pong`, `snapshot`, `current_as_of`, and `error` frames. Unsubscribe is
deliberately silent. The Cloudflare wire-schema gate validates real reply bytes
against that Rust-derived contract; the older proof socket's `type`-tagged
frames are a separate pinned protocol.

The coordinator uses no always-awake interval. All Aboard's `warmPoll` is a
single Durable Object alarm dispatcher job:

- first live demand arms the alarm;
- the last unsubscribe cancels it;
- `(jobName, scheduledAt)` durable claims make alarm retry idempotent;
- an app with no subscribers schedules zero warm-poll wakeups.

Real settled evidence includes a two-hour no-demand interval with observed-zero
request/execution estimates and hibernating connected-idle measurements. This
supports the narrow proof's idle-to-zero claim; it is not a scale or price
guarantee for arbitrary apps.

## Exact supported subset and non-claims

The manifest currently claims V8, Durable Object SQLite, serialized mutation
commits, syncable/online single-table queries, replace-only live subscriptions,
the witnessed outbound-action shapes, and demand-armed cron. Enforced limits
include row/storage size, wall-clock/CPU, and subscription counts.

It explicitly does **not** claim:

- hosted authentication (only `authMode: dev` is supported);
- offline retention/replay or optimistic replay: the manifest reports
  `offline_mutation_replay` as a gap because the coordinator has no
  client-mutation settlement ledger. Accordingly, `SnapbackClient` treats
  default `queue: 'auto'` as fail-loud/no-enqueue after an ambiguous transport
  failure, and explicit queueing or draining an existing outbox refuses with
  `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`;
- ephemeral realtime rooms;
- generalized outbound actions or an egress destination allowlist;
- calendar/Cron Trigger schedules;
- R2 asset upload, notifications, Postgres, code hot-load, untrusted hosted
  tenant code, multiple apps per deployment, or a hosted marketplace;
- the local served-discovery surface: `/llms.txt`, `/_snapback/guide*`,
  `/_snapback/api/control-catalog`, and host-operation discovery are not
  hosted claims when `operatorSurface` is disabled; use the pinned checkout
  or published guide instead;
- local pages whose `targets:` omit `cloudflare`.

An unimplemented path inside a reserved app-data namespace must not be
mistaken for a web page. When Workers Assets answers such a miss with its SPA
`200 text/html` fallback, the gateway converts it to HTTP 501 with the
versioned `SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET` JSON diagnostic. This is an
honest target refusal, not evidence that the route is available under another
hosted path.

See [auth target honesty](../auth/targets.md) before exposing this deployment
to users. The local bearer/dev identity posture is not production hosted auth.

## Anti-patterns

- **Do not call the proof a general Cloudflare target.** Inspect its manifest
  and keep every gap visible.
- **Do not deploy with an unlocked/ad-hoc Wrangler or `npx`.**
- **Do not pass secrets in argv, config files, logs, or app-visible errors.**
- **Do not add interval polling to keep the object warm.** Use hibernation and
  the one demand-armed alarm dispatcher.
- **Do not infer a successful local suite proves billing or eviction.** Run the
  remote evidence lane.
