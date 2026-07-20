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
target/debug/snapback --port 4433 --memory

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

The Supabase publishable key supplied during this build returned HTTP 401. Rather than ship a privileged database or secret key to the browser, the Supabase cells route through the local Bun gateway using the direct Postgres URL server-side. This tests real Supabase Postgres semantics but does not test `supabase-js`, RLS, or Supabase Realtime.

Convex was deployed using the deployment-scoped deploy key. The supplied `CONVEX_URL` was an HTTP-actions origin for another deployment; runtime requests derive the matching `.convex.cloud` query origin from the deploy key instead. The UI currently polls it through the same portable gateway so that transport differences remain visible and honest.

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
