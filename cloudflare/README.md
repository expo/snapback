# Snapback on Cloudflare — the LLP 0040 narrow proof

One generated Snapback app (a notes board) running on a Worker + a single app
coordinator Durable Object with embedded SQLite, a V8 handler runtime, and
WebSocket Hibernation. This is a **proof, not a product** — see
[`llp/0040-cloudflare-narrow-proof.rfc.md`](../llp/0040-cloudflare-narrow-proof.rfc.md).
The author-facing deployment and capability guide is
[`guide/deploying/cloudflare.md`](../guide/deploying/cloudflare.md).

## Layout

| Path | What it is |
| --- | --- |
| `app/notes.app.js` | The deploy-time-compiled app bundle: one syncable table, one JS mutation, one live query, plus an ambient-denial probe. |
| `src/gateway.js` | The gateway Worker: routes HTTP/WS to the coordinator, routes handler host calls back, serves the capability manifest. |
| `src/coordinator.js` | The coordinator Durable Object: SQLite version authority + journal, storage-backed subscriptions, WebSocket Hibernation, the commit pipeline. |
| `src/host-ops.js` | The JS `ctx` host-op table (the analogue of the Rust `handle_host_call`). |
| `src/handler-worker.js` | The stripped V8 handler isolate — the single-sourced LLP 0048 harness with the app bundle compiled in. |
| `generated/capability.manifest.cloudflare-do-sqlite-v8.json` | The target capability manifest (emitted by `cargo run -p snapback-conformance --bin snapback-cf-manifest`). |
| `generated/deployment-identity.*.json` | Source-derived state identity: esbuild transitive inputs plus normalized Wrangler/compat config. Regenerate with `node cloudflare/scripts/generate-deployment-identity.mjs`. |
| `wrangler.jsonc` / `wrangler.handler.jsonc` | Deploy configs (compat pins single-sourced from `packages/snapback-harness/compat.json`). |

## Run the local acceptance suite (no Cloudflare account)

```
node cloudflare/test/local-suite.mjs    # all 20 explicitly inventoried non-remote gates
node cloudflare/test/measure.mjs        # latency measurements with fixtures
```

Run these on the Node major pinned in [`.node-version`](../.node-version)
(currently 24.x). The proof preflight fails closed with
`SNAPBACK_CLOUDFLARE_PROOF_NODE_UNSUPPORTED` on any other major: the Miniflare
loopback proof is validated only on the pinned Node, and unsupported majors
(observed on Node 25.9.0, ENG-24454) intermittently reset the first
real-loopback action request (`read ECONNRESET`). The preflight constrains the
supported runtime; it deliberately does not fix that transport race (which is
upstream-shaped) and adds no action retry that would mask a real transport
failure.

The handler harness is single-sourced with the LLP 0048 conformance twin; the
twin's gate runs with
`cargo run -p snapback-conformance --bin snapback-conformance-twin`.

## Deploy to real Cloudflare (needs a token)

The **decisive** evidence — idle-window billing, real object eviction, cold
start, placement — is deploy-only; Miniflare cannot produce it. With a
Workers + Durable Objects-scoped API token:

```
bun install --frozen-lockfile           # installs the exact committed Wrangler
export CLOUDFLARE_API_TOKEN=...        # do NOT commit this
export CLOUDFLARE_ACCOUNT_ID=...
export SNAPBACK_ADMIN_TOKEN=...        # gates /_snapback/api/app/reset + /_snapback/api/object/evict on the deploy
./cloudflare/deploy.sh
SNAPBACK_PROOF_URL=https://snapback-notes-proof.<subdomain>.workers.dev \
  node cloudflare/test/acceptance.remote.mjs
```

Both deploy and config-set fail before remote mutation or secret stdin unless
the repository-local Wrangler matches `cloudflare/wrangler.lock.json` and the
root `bun.lock`; they never auto-install through `npx`.

`deploy.sh` never interprets an absent `SNAPBACK_ADMIN_TOKEN` as proof that the
remote secret is absent: it attests and reports `ABSENT`, `PRESENT and
preserved`, or `UNKNOWN`. Set `SNAPBACK_ADMIN_TOKEN_REMOVE=1` for explicit,
attested removal. Mixed-state bootstrap deploys stripped configs only for
Workers confirmed missing; authentication/network ambiguity fails closed.

When a deploy changes the schema/inputs hash over non-empty persisted state,
the new version's `/health` refuses with `SNAPBACK_STALE_CLOUDFLARE_*` and the
deploy fails closed (rolling back) by default. For proof/demo targets whose
persisted state is disposable, set `SNAPBACK_DEPLOY_RESET_ON_STALE=1` (with
`SNAPBACK_ADMIN_TOKEN` exported): on a stale refusal, `deploy.sh` invokes the
authenticated `/_snapback/api/app/reset` against the just-activated version —
which rebuilds and stamps the new hashes — then re-probes health and continues
the normal path. Any reset or re-probe failure falls through to the ordinary
failure/rollback path.

For All Aboard config, send the secret pool object over stdin (never argv) and
authenticate the admin-read attestation:

```
SNAPBACK_ADMIN_TOKEN=... node cloudflare/config-set.mjs \
  --url https://snapback-all-aboard-proof.<subdomain>.workers.dev \
  --entries-stdin < /secure/path/to/secret-pools.json
```

The remote runner holds a connected-hibernating idle window
(`SNAPBACK_IDLE_WINDOW_MS`, default 60s), drives the `/_snapback/api/object/evict` rehydration leg,
watches `/health`'s `objectBoot` marker for a genuine platform eviction, and
reads the billing counters for the window through
`cloudflare/test/billing-windows.mjs` (which also works standalone for any
window — see its header). Analytics attribution lags by minutes; re-read the
reported window afterwards for settled numbers.

> First real run: 2026-07-08 (ENG-23640), against
> `https://snapback-notes-proof.ccheever-0f6.workers.dev` — results in
> LLP 0040 §As-built and diary 0012. (The 2026-07-07 expired-token blocker is
> gone; the refreshed token lives in the repo owner's key store, see
> `.agent-local-secrets.md`.)
