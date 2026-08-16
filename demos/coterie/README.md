# Coterie

Coterie is the Exact/Contract sibling benchmark to Clique. It keeps the
social-messenger workload and stable `sm-*` automation vocabulary while using
one Contract source tree for web, macOS, and iOS.

The checked-in default is intentionally backendless: the `memory` lane is a
deterministic process-memory implementation of Coterie's shared
`ContractDataProvider` surface. This stage-1 shell makes its implemented routes
and controls runnable without claiming persistence, server authority, offline
recovery, or multi-client synchronization.

## Stage-1 surface

The checked-in routes cover sign-in, Following/Global feed and text compose,
people profiles, fixture-derived Insights, people/chat search, chats,
conversation text send, chat accent/disappearing options, and an image viewer.
Navigation carries canonical fixture identities such as `alice`,
`d-alice-bob`, `g-starter`, and `sp0002`; the viewer returns through the real
router back stack.

Surfaces staged by LLP 0266 D6 are deliberately absent rather than presented
as inert controls: sign-up UI and durable sessions; Trending; repost/reply and
post threads; post or message attachments/video; reactions, typing, and live
receipts; chat-background upload; new chat/group; account settings; profile
avatar/handle/location/link editing UI; offline, multi-client, and server-
authoritative behavior. Search is the backendless people/chat word-prefix
slice, not the brief's complete message/offline search. The form defaults to
Alice, while the memory provider accepts all eight committed starter personas
and accounts created through its headless `signup` operation.

## Frozen M1 provider surface

Declaration version 4 freezes the M1 account/session/profile/avatar seam:

- `listSession@2` and `listProfiles@2`
- `signup@1`, `login@1`, `logout@1`, `editProfile@1`, and `setAvatar@1`

Exact's current declaration core carries compatibility tokens on queries but
not mutations. The complete set above is therefore recorded in the
`coterie.m1CompatibilityTokens` declaration extension; the two queries also
carry their tokens in the core query field.

`src/data/coterie.provider.json` is intentionally provider-neutral. It is the
one Coterie surface declaration, and generation produces the one
`generated/coterie.bindings.ts` module every provider configures. An adapter
must implement that declaration and expose the matching shared manifest (the
in-repo implementations reuse `coterieSurfaceManifest`); it must not mint a
second declaration with a provider name, different capability flags, or
provider-specific extensions, because those bytes change `inputsHash` and the
generated binding handshake correctly rejects them. The declared capabilities
are the common guarantees of this binding surface. A provider lane records
additional backend capabilities in its own qualification evidence.

The memory implementation validates M1 profile limits, declares stable error
classes for duplicate handle/email and invalid credentials, and lets
`setAvatar` attach only `media/avatar-alice.png` or
`media/avatar-bob.png` from the committed fixture pack. Signup credentials,
active sessions, and revoked tokens exist only for the life of the provider
process. Logout moves the current token into an in-process revocation ledger;
restart resets everything. This is deterministic client/provider evidence,
not durable or server-authoritative auth evidence.

The implementation sets both `Error.name` and the declaration's stable `code`
before throwing. Exact's current mutation `SerializedError` envelope preserves
only `name`, `message`, and `stack`, however, so the generated error union's
typed `code` field is not populated at runtime yet. Callers must match `name`
until the Exact envelope gap tracked in
[`issues/20260816-exact-declared-error-code-envelope.md`](../../issues/20260816-exact-declared-error-code-envelope.md)
is fixed.

## Run it

```bash
bun install
bun run dev
```

Web provider selection uses the exact boot variable from LLP 0266 D8:

```bash
COTERIE_PROVIDER=memory bun run dev       # default when omitted
COTERIE_PROVIDER=snapback bun run dev     # currently fails loudly at boot
```

Unknown values name the valid registry entries and fail before the router
mounts. Vite exposes the public `COTERIE_*` prefix to `import.meta.env`; no
provider value reaches a route, `.contract` component, or generated binding.

Native hosts use the same source:

```bash
exact run macos
exact run ios
exact run ios --device
```

The current native module pipeline has no documented app-environment
projection. `src/main.native.tsx` therefore uses the build-time
`NATIVE_COTERIE_PROVIDER` constant, currently `memory`. A native Snapback run
must change that build-time constant (or replace it with a future documented
runtime-config projection); the provider factory and generated bindings stay
unchanged.

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
bun run accept:coterie
```

That checks generated-provider freshness, TypeScript (including the native
entry), provider conformance and invalidation tests, platform splits, and the
production web bundle. Native runtime evidence is the separate recorded iOS
simulator run; this command does not perform a native production build.

`accept:coterie` is the socket-free M1 skeleton. It boots the selected provider
through the same generated bindings as the app, loads Alice from the shared
persona fixture, validates every step's `sm-*` selector against the shared
`benchmarks/tools/social-messenger/CONTRACT.md` authority, and accepts either a
boot session that it revokes or an already-empty session list as the same
signed-out precondition. The memory lane runs both paths. It then proves login
returns and delivers a new session token, runs profile edit → observable
generated-query invalidation, and proves logout revokes that exact new token.
Tokens stay local to the runner for comparison; the JSON artifact records only
boolean token receipts, and a partial failure triggers best-effort session
revocation before provider disposal. The runner reuses the shared choreography
aggregator and writes the artifact under the ignored `.data/acceptance/`
directory, printing the absolute path. This is headless provider/binding
acceptance; it does not claim a mounted Contract semantic tree, two browser
contexts, or native host evidence.

Select the provider the same way as web boot:

```bash
COTERIE_PROVIDER=memory bun run accept:coterie
```

`bun run typecheck` also checks the linked Exact source graph. If it reports an
error exclusively under `../../../exact/`, verify the sibling Exact checkout
before treating it as Coterie-owned; Coterie does not patch that checkout.

## Replace the backend

The data path is:

```text
.contract routes
  -> src/data/generated/coterie.bindings.ts
  -> src/data/provider-factory.ts
  -> selected ContractDataProvider
```

To add Snapback or another backend:

1. Implement `ContractDataProvider` against `src/data/coterie.provider.json`,
   preferably with Exact's paved row-level boundary, and expose the generated
   shared manifest rather than producing a provider-specific declaration.
2. Pass Exact's conformance suite and the Coterie operation tests for the
   milestone token set the adapter claims.
3. Add its named constructor to the boot-time provider registry.
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
