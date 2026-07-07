# Snapback on Cloudflare — the LLP 0040 narrow proof

One generated Snapback app (a notes board) running on a Worker + a single app
coordinator Durable Object with embedded SQLite, a V8 handler runtime, and
WebSocket Hibernation. This is a **proof, not a product** — see
[`llp/0040-cloudflare-narrow-proof.rfc.md`](../llp/0040-cloudflare-narrow-proof.rfc.md).

## Layout

| Path | What it is |
| --- | --- |
| `app/notes.app.js` | The deploy-time-compiled app bundle: one syncable table, one JS mutation, one live query, plus an ambient-denial probe. |
| `src/gateway.js` | The gateway Worker: routes HTTP/WS to the coordinator, routes handler host calls back, serves the capability manifest. |
| `src/coordinator.js` | The coordinator Durable Object: SQLite version authority + journal, storage-backed subscriptions, WebSocket Hibernation, the commit pipeline. |
| `src/host-ops.js` | The JS `ctx` host-op table (the analogue of the Rust `handle_host_call`). |
| `src/handler-worker.js` | The stripped V8 handler isolate — the single-sourced LLP 0048 harness with the app bundle compiled in. |
| `generated/capability.manifest.cloudflare-do-sqlite-v8.json` | The target capability manifest (emitted by `cargo run --bin snapback-cf-manifest`). |
| `wrangler.jsonc` / `wrangler.handler.jsonc` | Deploy configs (compat pins single-sourced from `packages/snapback-harness/compat.json`). |

## Run the local acceptance suite (no Cloudflare account)

```
node cloudflare/test/acceptance.mjs     # 16/16 behavioral checks under Miniflare
node cloudflare/test/measure.mjs        # latency measurements with fixtures
```

The handler harness is single-sourced with the LLP 0048 conformance twin; the
twin's gate runs with `cargo run --bin snapback-conformance-twin`.

## Deploy to real Cloudflare (needs a token)

The **decisive** evidence — idle-window billing, real object eviction, cold
start, placement — is deploy-only; Miniflare cannot produce it. With a
Workers + Durable Objects-scoped API token:

```
export CLOUDFLARE_API_TOKEN=...        # do NOT commit this
export CLOUDFLARE_ACCOUNT_ID=...
./cloudflare/deploy.sh
SNAPBACK_PROOF_URL=https://snapback-notes-proof.<subdomain>.workers.dev \
  node cloudflare/test/acceptance.remote.mjs
```

> As of 2026-07-07 the repo owner's token is expired, so this leg has not yet
> run. Everything behavioral is proven under Miniflare; the real-Cloudflare
> runner is staged.
