# `_kit` test suites — runner requirements

These suites drive the shared demo kit (`demos/_kit/`) against a real local
Snapback server. Two runners are in play, and **picking the wrong one for a
bun-only suite crashes** — this file is the map.

## Which runtime?

| Runtime | Suites | Why |
| --- | --- | --- |
| **`node`** (>= 22, built-in `fetch`/`WebSocket`) | `auth-handshake`, `client-errors`, `exact-resolver-packages`, `provider-live-conformance`, `regression-reconnect-nuke`, `regression-fake-live`, `regression-handshake-loss`, `regression-gc-starvation`, `regression-overlay-crossroom`, `regression-mixed-transport`, `regression-midflight-resync`, `live-delta-e2e`, `provenance-unit`, `server-process-lifecycle`, `live-wire-schema` | Pure Snapback-kit JS; no live Exact import (`exact-resolver-packages` uses a synthetic package tree). |
| **`bun`** (required — do **not** use node) | `regression-ephemeral-wiring`, `regression-optimistic-clobber`, `regression-multilive-scoped` | Import the Exact **Contract runtime**, whose `.js`-suffixed TypeScript imports (e.g. `./signals.js` → `signals.ts`) resolve **only** under bun. |

`scripts/verify-local-proof` runs every suite under its correct runtime — the
node suites directly, and all three Exact-importing suites under `bun`. The bun
block is gated: it runs only when an Exact checkout resolves or a Contract
surface package set is installed (see `exact-resolver.mjs`), and is
skipped when Exact is unavailable or when `SNAPBACK_VERIFY_EXACT=0`. Run it
with the committed package locks installed, an Exact checkout present, or
`SNAPBACK_VERIFY_EXACT=1` to exercise the bun suites.

Each bun suite declares the Contract install belonging to its fixture (todo,
todo-v2, or graffiti). Resolver success is intentionally target-local: a
different demo's or admin-ui's installed Exact packages cannot satisfy it.

## Why the bun-only suites crash under node

Exact ships TypeScript sources that import sibling modules with an explicit
`.js` suffix that actually resolves to a `.ts` file. bun's resolver maps
`./signals.js` → `signals.ts`; node's does not, so a bun-only suite run under
node dies deep inside a dynamic import with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../runtime/signals.js'
  imported from '.../runtime/index.ts'
```

To keep that from being a mystery, each Exact-importing suite calls
`requireBunRuntime(label)` from `../harness.mjs` as its first statement. Run one
of them under node and you get an explicit message plus a distinct exit code
(`3`) instead of the resolver stack trace:

```
SNAPBACK_KIT_REQUIRES_BUN: _kit regression / optimistic-clobber imports the
Exact Contract runtime, whose .js-suffixed TypeScript imports resolve only
under bun. ... Re-run it with bun:

    bun demos/_kit/tests/regression-optimistic-clobber.mjs
```

## Exact absence is a clean skip

When bun **is** present but no explicit Exact checkout or the target fixture's installed package set resolves
(see `exact-resolver.mjs`), the bun-only suites skip with a structured
`SNAPBACK_CAPABILITY_EXACT_MISSING` diagnostic and exit 0 — they never fail just
because Exact is not installed.
