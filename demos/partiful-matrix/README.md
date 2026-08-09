# Partitime: web 3×4 plus Apple-native 2×2×4

For the complete methodology, quantitative results, per-cell analysis, and
recommendations, see the **[full comparative build report](./REPORT.md)**.

This is one Partiful-style product experiment rendered as twelve web cells:

| authoring \ backend | Snapback | Supabase | Convex | SQLite |
|---|---|---|---|---|
| React | generated refs + push | server gateway + poll | deployed functions + poll | Bun SQLite + poll |
| Contract | generated surface links + push | Exact provider seam + poll | Exact provider seam + poll | Exact provider seam + poll |
| Vanilla JS | headless client + push | browser provider + gateway + poll | browser provider + gateway + poll | browser provider + gateway + poll |

The rows share a visual/product specification; the columns share one deterministic fixture and the operations `listEvents`, `eventDetails`, `guestList`, `eventWall`, `createEvent`, `rsvp`, and `postMessage`. Sharing is deliberate: it prevents copy/paste drift from masquerading as a framework or backend difference.

The native extension adds sixteen Apple cells without copying the product per
provider:

| authoring \ platform | macOS | iOS | provider modes |
|---|---|---|---|
| SwiftUI | shared Swift source | shared Swift source | Snapback, Supabase, Convex, SQLite |
| Exact + Contract | shared Contract/TypeScript source | shared Contract/TypeScript source | Snapback, Supabase, Convex, SQLite |

Both native rows use the same language-neutral JSON gateway. That keeps the
native authoring comparison controlled, but it also means every native cell is
an honest one-second polling adapter. In particular, native Snapback does not
claim the browser row's direct push transport.

The provider conformance suite's final row-shape check intentionally compares
SQLite, Supabase, and Convex only. Those gateway adapters expose the portable
language-neutral projection. Snapback is exercised separately through its
generated query and mutation references, and its raw rows additionally carry
system metadata; comparing those raw keys with gateway rows would test storage
metadata equality rather than the shared product contract.

## What it builds

- `surfaces/react/dist/{snapback,supabase,convex,sqlite}`
- `surfaces/contract/dist/{snapback,supabase,convex,sqlite}`
- `surfaces/vanilla/dist/{snapback,supabase,convex,sqlite}`
- one shared SwiftUI application under `native/swiftui/`, with macOS and iOS targets
- one shared Exact + Contract application under `native/exact-contract/`, rendered by the Exact macOS and iOS hosts
- a real generated Snapback app under `snapback/generated/`
- isolated Supabase tables named `partiful_matrix_*`
- a deployed Convex schema/functions module under `backends/convex/convex/`
- an ignored local SQLite database under `backends/gateway/`

All three rows share test IDs and product behavior. React owns hook lifecycle,
Contract delegates its Snapback data plane to generated surface links, and
Vanilla JS uses imperative DOM rendering plus an explicit generation-scoped
subscription owner. Vanilla shares React's stylesheet so the authoring comparison
does not accidentally become a design comparison; it imports no UI framework.

## Run it

Credentials are loaded from the ignored root `.agent-local-secrets.md`; values are never emitted into client bundles or committed artifacts.

```sh
# terminal 1 — local provider gateway; creates/ensures Supabase + SQLite data
cd demos/partiful-matrix/backends/gateway && bun run dev

# terminal 2 — Snapback, for the Snapback column
target/debug/snapback start --port 4433 --memory

# terminal 3 — choose an arm and backend mode
cd demos/partiful-matrix/surfaces/react && bun run dev -- --mode supabase
cd demos/partiful-matrix/surfaces/contract && bun run dev -- --mode convex
cd demos/partiful-matrix/surfaces/vanilla && bun run dev -- --mode sqlite
```

Use `?user=ada`, `?user=grace`, or `?user=eve`. Production builds and provider conformance:

```sh
cd demos/partiful-matrix/surfaces/react && bun run build
cd demos/partiful-matrix/surfaces/contract && bun run build
cd demos/partiful-matrix/surfaces/vanilla && bun run build
bun demos/partiful-matrix/tests/acceptance/providers.mjs
node demos/partiful-matrix/tests/acceptance/vanilla-lifecycle.mjs
node demos/partiful-matrix/tests/acceptance/browser-matrix.mjs
```

For the Apple rows, start the same gateway and Snapback processes, then choose
the provider at launch/build time:

```sh
# SwiftUI: open the generated project and run either shared-source scheme.
open demos/partiful-matrix/native/swiftui/PartitimeSwiftUI.xcodeproj
# Launch arguments: --backend snapback --gateway http://127.0.0.1:4460

# Exact + Contract: serve one provider-selected native bundle, then attach an
# aligned Exact shared native host for macOS or iOS.
cd demos/partiful-matrix/native/exact-contract
PARTITIME_BACKEND=snapback \
PARTITIME_GATEWAY_ORIGIN=http://127.0.0.1:4460 \
PARTITIME_EXACT_PORT=8087 \
EXACT_AGENT_BOOT=1 bun run dev
```

Replace `snapback` with `supabase`, `convex`, or `sqlite`. The Exact carrier
must come from a revision-compatible Exact checkout; the build diary records
the compatibility and iOS carrier issues found during this run.

Convex setup is idempotent:

```sh
cd demos/partiful-matrix/backends/convex && bun run setup
```

## Honest boundaries

The frozen Step 0 Supabase cells route through the local Bun gateway using the direct Postgres URL server-side; they test real Supabase Postgres semantics but not `supabase-js`, RLS, or Supabase Realtime. That routing decision was made because the publishable key appeared to return HTTP 401 — a probe artifact, corrected on 2026-07-20: the probe hit `GET /rest/v1/` (the OpenAPI introspection root, which is deliberately secret-only for new-format `sb_publishable_*` keys), while table reads and Auth endpoints accept the publishable key normally. The corrected probe lives in `tests/acceptance/supabase-probe.mjs`.

The idiomatic browser-direct cell now exists as a follow-up leg outside the frozen Step 0 matrix: React mode `supabase-realtime` uses `supabase-js` with the publishable key and Realtime `postgres_changes` (no gateway, poll fallback disabled during acceptance). Before it shipped, `backends/gateway/harden-supabase.ts` enabled RLS on the `partiful_matrix_*` tables, revoked anon `DELETE`/`TRUNCATE`, moved the host-displacement invariant into an RLS `UPDATE` policy, and added the tables to the `supabase_realtime` publication. Its receipt is retained at `acceptance/results/supabase-realtime-web.json` (`node tests/acceptance/supabase-realtime-web.mjs --receipt …`); the claims manifest gains its row when the Step 3 gates close.

Acceptance runs can isolate Supabase state in a disposable per-run schema: `bun tests/acceptance/providers.mjs --ephemeral-supabase` seeds `partiful_matrix_test_*` and drops it afterwards, leaving the shared fixture untouched (the default still exercises the shared fixture as a real-remote smoke test). For full-fidelity local isolation including Realtime and RLS, the Supabase CLI local stack (`supabase start`, requires Docker) remains the documented option.

Convex was deployed using the deployment-scoped deploy key. The supplied `CONVEX_URL` was an HTTP-actions origin for another deployment; runtime requests derive the matching `.convex.cloud` query origin from the deploy key instead. The frozen `convex` cells poll it through the same portable gateway so that their transport differences remain visible and honest.

The idiomatic follow-up is React mode `convex-realtime`: it imports the generated Convex API and uses `ConvexClient` from `convex/browser` directly against the hosted deployment, with no gateway or polling path. Its retained six-check receipt is `acceptance/results/convex-realtime-web.json` (`node tests/acceptance/convex-realtime-web.mjs --receipt …`); the witness ties six out-of-band HTTP mutations to new `guestList` updates measured while the WebSocket is connected and to rendered transitions, then proves normal React-root teardown closes query scopes and the client. Each run creates and attested-cleanups a uniquely named acceptance event instead of mutating the shared fixture. As with the Supabase follow-up, the claim row waits for the Step 3 cross-repository closure amendment. Contract-generated Convex bindings remain open.

The Vanilla JS row is framework-free, not build-tool-free. Vite still resolves
the workspace ESM graph, substitutes the selected backend, creates four
production bundles, and makes their sizes comparable. Direct unbundled browser
ESM delivery was not exercised and is not claimed.

The Apple matrix is a comparison of UI authoring and carrier/runtime behavior,
not provider-native mobile SDKs. SwiftUI uses `URLSession`; Exact + Contract
uses `fetch`; both call the gateway. SwiftUI was verified with internal
acceptance on both platforms and XCUITest on iOS. Exact + Contract was verified
through Acto on both platforms. macOS XCUITest was blocked before app launch by
the remote host's UI-automation permission, so it is not reported as a UI-test
pass; the target build and independent in-app acceptance did pass.
