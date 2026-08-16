# Coterie

Coterie is the Exact/Contract sibling benchmark to Clique. It keeps the
social-messenger workload and stable `sm-*` automation vocabulary while using
one Contract source tree for web, macOS, and iOS.

The checked-in default is intentionally backendless: `coterie-memory` is a
deterministic process-memory `ContractDataProvider`. This stage-1 shell makes
its implemented routes and controls runnable without claiming persistence,
server authority, offline recovery, or multi-client synchronization.

## Stage-1 surface

The checked-in routes cover sign-in, Following/Global feed and text compose,
people profiles, fixture-derived Insights, people/chat search, chats,
conversation text send, chat accent/disappearing options, and an image viewer.
Navigation carries canonical fixture identities such as `alice`,
`d-alice-bob`, `g-starter`, and `sp0002`; the viewer returns through the real
router back stack.

Surfaces staged by LLP 0266 D6 are deliberately absent rather than presented
as inert controls: sign-up and durable sessions; Trending; repost/reply and
post threads; post or message attachments/video; reactions, typing, and live
receipts; chat-background upload; new chat/group; account settings; profile
avatar/handle/location/link editing; offline, multi-client, and server-
authoritative behavior. Search is the backendless people/chat word-prefix
slice, not the brief's complete message/offline search. The only accepted
backendless login is the committed Alice fixture credential shown in the form.

## Run it

```bash
bun install
bun run dev
```

Native hosts use the same source:

```bash
exact run macos
exact run ios
exact run ios --device
```

The iOS simulator path is proven for this baseline. The currently discovered
prebuilt macOS host displayed its embedded Caltrain bundle instead of the
requested external URL, so Coterie does not yet claim a live macOS run; see the
repository guide-gap ticket linked from Diary 0086. A compatible shared host
is still expected to use the same generated native bundle.

Use the Exact checkout linked in `exact.links.json`. On this repository layout
the CLI binary is typically `../../../exact/target/debug/exact` if `exact` is
not on `PATH`.

## Verify it

```bash
bun run verify:coterie
```

That checks generated-provider freshness, TypeScript (including the native
entry), provider conformance and invalidation tests, platform splits, and the
production web bundle. Native runtime evidence is the separate recorded iOS
simulator run; this command does not perform a native production build.

`bun run typecheck` also checks the linked Exact source graph. If it reports an
error exclusively under `../../../exact/`, verify the sibling Exact checkout
before treating it as Coterie-owned; Coterie does not patch that checkout.

## Replace the backend

The data path is:

```text
.contract routes
  -> src/data/generated/coterie-memory.bindings.ts
  -> ContractDataProvider configured in src/main.tsx and src/main.native.tsx
```

To add Snapback or another backend:

1. Produce a provider declaration compatible with Coterie's query/mutation
   surface and generate its artifacts with `exact provider generate`.
2. Implement `ContractDataProvider`, preferably with Exact's paved row-level
   boundary, and pass Exact's conformance suite.
3. Change the boot-time provider factory (or add a benchmark-selected factory).
4. Leave the Contract UI and `sm-*` IDs unchanged.

Do not hand-write binding links or import a backend client from a `.contract`
component. See [LLP 0266](../../llp/0266-coterie-exact-contract-benchmark.plan.md)
for the governing boundary and evidence rules.

## Naming and comparison

- Product/client: **Coterie**
- Benchmark family: `social-messenger`
- Client profile: `exact-contract`
- Workload: `clique-feature-parity`
- Comparator: **Clique**, the canonical React Native/Expo lane

Exact's current web scaffold keeps React and React DOM as internal shared-
toolchain dependencies. Coterie's application UI itself contains no React,
React Native, or Expo source.
