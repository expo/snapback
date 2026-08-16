# Coterie

Coterie is the Exact/Contract sibling benchmark to Clique. It keeps the
social-messenger workload and stable `sm-*` automation vocabulary while using
one Contract source tree for web, macOS, and iOS.

The checked-in default remains backendless: the `memory` lane is a deterministic
process-memory implementation of Coterie's frozen M1 and M2
`ContractDataProvider` surface. The optional `snapback` lane supplies the
frozen M1 account, session, profile, avatar, and multi-client-live behavior
from the application-owned backend; it still refuses every M2/M3 operation.
The memory lane makes no durability, server-authority, offline, or multi-client
claim.

## Stage-1 surface

The checked-in routes cover sign-in; Following/Global feed and text compose;
likes and attributed repost toggles; parent-plus-direct-reply threads; people
profiles with reverse-chronological post lists and live follow counts;
fixture-derived Insights; people/chat search; chats; conversation text send;
chat accent/disappearing options; and image/video viewing.
Navigation carries canonical fixture identities such as `alice`,
`d-alice-bob`, `g-starter`, and `sp0002`; the viewer returns through the real
router back stack.

Surfaces staged by LLP 0266 D6 are deliberately absent rather than presented
as inert controls: sign-up UI and durable sessions; Trending; fixture-media
selection in the post composer (the provider operation itself supports image
and video posts, and seeded media renders); message attachments; reactions,
typing, and live receipts; chat-background upload; new chat/group; account
settings; profile avatar/handle/location/link editing UI; offline,
multi-client, and server-authoritative behavior. Search is the backendless
people/chat word-prefix slice, not the brief's complete message/offline search.
The form defaults to Alice, while the memory provider accepts all eight
committed starter personas and accounts created through its headless `signup`
operation.

## Frozen M2 provider surface

Declaration version 6 freezes M2 while retaining the already-frozen M1 set.
Query tokens remain in Exact's core `compatibilityToken` field. Exact's
mutation declaration still has no first-class compatibility-token field, so
mutation tokens live in the namespaced `coterie.m1CompatibilityTokens` and
`coterie.m2CompatibilityTokens` extensions. `listProfiles@2` is intentionally
reused: its already-frozen row contains `followers`, `following`,
`followedByMe`, and `isMe`, so M2 adds live semantics without changing its
shape or breaking the M1 token.

| Milestone | Operation | Kind | Token |
| --- | --- | --- | --- |
| M1 | `listSession` | query | `2` |
| M1/M2 | `listProfiles` | query | `2` |
| M1 | `signup` | mutation | `2` |
| M1 | `login` | mutation | `1` |
| M1 | `logout` | mutation | `1` |
| M1 | `editProfile` | mutation | `1` |
| M1 | `setAvatar` | mutation | `2` |
| M2 | `listFeed` | query | `3` |
| M2 | `listThread` | query | `1` |
| M2 | `listProfilePosts` | query | `1` |
| M2 | `createPost` | mutation | `1` |
| M2 | `setFollow` | mutation | `1` |
| M2 | `setLike` | mutation | `1` |
| M2 | `setRepost` | mutation | `2` |

`listFeed({ mode, cursor })` returns at most 20 feed-event rows. The cursor is
an opaque base64url keyset token over cursor-codec version 1, mode, event time,
and event identity; its codec version is independent of the provider
declaration version, and callers only retain and return it. Every row in a
non-terminal page carries the same `nextCursor`, while terminal rows carry
`null`. This row-level spelling avoids inventing a one-row page envelope above
Exact's paved list boundary. Repost events have their own stable `id` plus the
original `postId`, so an original and multiple attributed reposts never
collide. A cursor minted for one mode is rejected in the other mode, including
a Following cursor replayed against Global. The feed route keeps a live
`cursor: null` head, loads older cursor windows as snapshots, merges them by
feed-event ID, and requests the next cursor from the list's end-reached event.
It resets accumulated windows after tab, session, follow/unfollow navigation,
and successful post creation; likes and reposts project over already-loaded
rows while the live query delivery catches up.

Following is evaluated from the current graph on every load: the viewer and
currently followed actors contribute both originals and repost events. The
implicit self relationship is feed membership only—it is never stored and
never affects counts. Unfollowing removes that actor's old originals and
reposts from the next Following delivery. Global includes every top-level
original and repost event. Both are reverse-chronological by feed-event time.
Replies are posts with `parentId`; they never enter either feed. `listThread`
returns the named parent first and only its direct replies afterward in
chronological order. `listProfilePosts` returns only that profile's top-level
original posts, newest first; reposts remain feed events rather than authored
profile posts. `setRepost@2` rejects replies with the declared
`ReplyRepostForbiddenError`; only top-level posts can become feed repost
events.

`createPost` accepts a body of at most 500 Unicode code points, zero or 1–4
committed fixture image refs, zero or exactly one committed fixture video ref,
and an optional existing `parentId`. A text-only post must have non-empty text;
media posts may have an empty body. The declaration freezes named rejections
for body length/emptiness, image count, video count, mixed media, unavailable
fixture refs, and missing parents. Follow, like, and repost mutations are
set-state intents with mutation IDs; missing targets, self-follow, and missing
sessions are also declared errors.

The memory seed is the committed `starter-m2.log` corpus: 24 top-level posts,
four direct replies, eight likes, four attributed reposts, and the asymmetric
12-edge follow graph. All image/video refs name assets in
`benchmarks/fixtures/social-messenger/media/`, copied into Coterie's served
`public/assets/fixtures/` tree; provider rows use root-relative
`/assets/fixtures/...` URLs rather than source-tree file URLs. Process restart
resets this state and every local mutation. `listInsights` declares and
subscribes to all four tables it derives from: posts, follows, likes, and
reposts.

## Frozen M1 provider surface

The M1 account/session/profile/avatar seam remains frozen inside declaration
version 6:

- `listSession@2` and `listProfiles@2`
- `signup@2`, `login@1`, `logout@1`, `editProfile@1`, and `setAvatar@2`

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
`setAvatar` attach the eight persona refs from `media/avatar-alice.png` through
`media/avatar-henry.png`. Both memory and Snapback resolve that same closed
vocabulary to Coterie's served `/assets/fixtures/avatar-<persona>.png` assets.
The memory projection also updates live profile, feed, search, and direct-chat
avatar deliveries. Signup credentials,
active sessions, and revoked tokens exist only for the life of the provider
process. Logout moves the current token into an in-process revocation ledger;
restart resets everything. This is deterministic client/provider evidence,
not durable or server-authoritative auth evidence.

The pre-M2 declaration v5 digest was `df0562a779095d79`; the first M2 v6
generation was `0614938f8ff02c4e`. The corrected v6 surface in this tree is
`2b035e0c69068f02`, shared verbatim by both adapters. The Snapback adapter
implements the same M1 token set. Password signup/sign-in/logout use
Snapback's built-in password provider and `AuthCoordinator`; the session query
projects coordinator principal changes, while profiles use the generated
`getMyProfile`, `ensureMyProfile`, `editProfile`, and streaming `listProfiles`
references. Avatar changes upload through `createAssetClient` and attach with
the generated `attachMyAvatar` mutation. Every profile stream explicitly uses
Snapback's stream transport with polling fallback disabled. Connection-only
cells publish socket loss and recovery without counting as profile-data
revisions.

This adapter claims **M1 only**. Calls to M2/M3 queries or mutations return a
`SnapbackMilestoneUnsupportedError` whose message names the operation and LLP
0266 D7; they never synthesize rows or acknowledge a fake mutation. Snapback's
error translation is an exact allow-list; prefix families are deliberately not
used:

| Operation | Exact Snapback diagnostic | Coterie error |
| --- | --- | --- |
| `signup` | `SNAPBACK_AUTH_PASSWORD_EXISTS` | `DuplicateEmailError` |
| `signup` | `SNAPBACK_AUTH_PASSWORD_POLICY` | `PasswordTooShortError` |
| `signup` | application `DUPLICATE_HANDLE` before password issuance | `DuplicateHandleError` |
| `signup` | application `DUPLICATE_HANDLE` after password issuance | `PartialRegistrationError` |
| `login` | `SNAPBACK_AUTH_CREDENTIAL_INVALID` (or locally malformed login input) | `InvalidCredentialsError` |
| `editProfile`, `setAvatar` | `SNAPBACK_AUTH_SESSION_EXPIRED`, `SNAPBACK_AUTH_SESSION_REVOKED` | `SessionRequiredError` |
| `setAvatar` | `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED`, `SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED` | `AvatarReferenceInvalidError` |

Local avatar URL/fetch/body-read/signature failures also use
`AvatarReferenceInvalidError`. `PROFILE_NOT_OWNED` and every unlisted backend
diagnostic surface as `SnapbackProviderError`; provider faults never
masquerade as bad credentials, a missing session, or a bad avatar reference.

Snapback cannot atomically combine password issuance with the application
profile write. If a handle race lands between those writes, the adapter clears
the adopted local bearer and returns `PartialRegistrationError`, explicitly
stating that the email is registered but the profile is incomplete. Recovery
is: log in with that email, then call `signup` again with the same email and a
new handle; under that authenticated incomplete-profile state, `signup`
performs only the owner-scoped profile completion and returns the existing
user/session identity.

Avatar bytes are read inside the guarded fetch phase and signature-sniffed as
PNG, JPEG, or WebP before upload. The adapter retains a bounded, owner-plus-
digest map of finalized assets so an attach-refusal retry reuses the same asset
instead of uploading it again. Finalization and profile attachment are not one
transaction: a failed attachment, or later replacement, can leave a ready
asset unreferenced. Coterie does not opt this backend into reference GC or
claim cleanup of that residue; the runtime error names the retained retry fact,
and backend GC policy remains out of scope for this lane.

The memory implementation sets both `Error.name` and the declaration's stable
`code` before throwing. Exact's current mutation `SerializedError` envelope
preserves
only `name`, `message`, and `stack`, however, so the generated error union's
typed `code` field is not populated at runtime yet. Callers must match `name`
until the Exact envelope gap tracked in
[`issues/20260816-exact-declared-error-code-envelope.md`](../../issues/20260816-exact-declared-error-code-envelope.md)
is fixed.

## Run it

```bash
bun install --frozen-lockfile
bun run dev
```

Web provider selection uses the exact boot variable from LLP 0266 D8:

```bash
COTERIE_PROVIDER=memory bun run dev       # default when omitted
COTERIE_PROVIDER=snapback bun run dev     # requires COTERIE_SNAPBACK_URL
```

Unknown values name the valid registry entries and fail before the router
mounts. Vite exposes the public `COTERIE_*` prefix to `import.meta.env`; no
provider value reaches a route, `.contract` component, or generated binding.
`COTERIE_SNAPBACK_CUSTODY` accepts `auto` (the default), `indexeddb`, or
`memory`. `auto` uses IndexedDB in a browser and process memory in a headless
run. `COTERIE_SNAPBACK_CUSTODY_PARTITION` optionally chooses the browser
custody partition. Missing or malformed Snapback server configuration fails at
provider construction; it never falls back to memory.

To run the Snapback lane end to end, start from the repository root. The dev
command generates the backend, starts a sessions-mode server on an assigned
port, and prints its `serverUrl`; stop it with `q` or Ctrl-C:

```bash
SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback \
  node packages/snapback-cli/cli.mjs dev demos/coterie/snapback \
  --ready-file demos/coterie/.data/snapback/dev.ready.json \
  --application-ready-file demos/coterie/.data/snapback/application-ready.json \
  --db demos/coterie/.data/snapback/dev.sqlite3 --json
```

In another terminal, use the printed URL. The seed command is idempotent and
installs the eight shared personas plus their avatar assets. The acceptance
runner invokes that same installer itself, so the explicit seed is needed for
interactive development but does not have to precede acceptance:

```bash
export COTERIE_SNAPBACK_URL=http://127.0.0.1:<printed-port>
node demos/coterie/snapback/seed-m1.mjs --url "$COTERIE_SNAPBACK_URL"

cd demos/coterie
COTERIE_PROVIDER=snapback bun run dev
```

The shared acceptance runner is now M2. Until the Snapback adapter implements
the newly frozen M2 token set, `COTERIE_PROVIDER=snapback bun run
accept:coterie` is expected to fail with its explicit
`SnapbackMilestoneUnsupportedError`; the runner itself needs no provider-
specific branch when that adapter slice lands.

Native hosts use the same source:

```bash
exact run macos
exact run ios
exact run ios --device
```

The current native module pipeline has no documented app-environment
projection. `src/main.native.tsx` therefore uses the build-time
`NATIVE_COTERIE_PROVIDER` constant, currently `memory`. A native Snapback run
also needs a paved host projection for the server URL and custody config; this
lane proves web and headless Snapback, not native Snapback. The provider factory
and generated bindings do not need to change when that host projection lands.

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
SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback \
  bun run test:snapback-provider
```

That checks generated-provider freshness, TypeScript (including the native
entry), provider conformance and invalidation tests, platform splits, and the
production web bundle. Native runtime evidence is the separate recorded iOS
simulator run; this command does not perform a native production build.

`accept:coterie` is the parameterized M2 runner. It boots the selected provider
through the same generated bindings as the app, loads Alice from the shared
persona fixture, validates every step's `sm-*` selector against the shared
`benchmarks/tools/social-messenger/CONTRACT.md` authority, and accepts either a
boot session that it revokes or an already-empty session list as the same
signed-out precondition. It then proves login
returns and delivers a new session token, runs profile edit → observable
generated-query invalidation, creates a text post and observes it in Global,
follows Dave and observes his existing originals enter Following, toggles a
like on then off with both states observable, and proves logout revokes that
exact new token.
Tokens stay local to the runner for comparison; the JSON artifact records only
boolean token receipts, and a partial failure triggers best-effort session
revocation before provider disposal. Both providers run the `provider-boot`
and `injected-signed-out` scenarios. A future Snapback M2 lane requires its
configured server and streaming socket; the current M1 adapter installs
fixtures through `seed-m1.mjs` and then refuses the first M2 operation
honestly. The runner reuses the shared choreography aggregator and writes
the artifact under the ignored `.data/acceptance/` directory, printing the
absolute path. This is headless provider/binding acceptance; it does not claim
a mounted Contract semantic tree, two browser contexts, or native host
evidence.

`test:snapback-provider` starts and tears down an isolated Snapback server and
runs Exact provider conformance scoped to M1 `listProfiles@2` plus
`editProfile@1`. Its adapter-specific probes cover: two-client pushed profile
edits; fixture and non-fixture identity joins; malformed-login and exact
password-byte round trips; exact and unknown diagnostic mapping; post-adoption
login/signup rollback; logout transport failure and post-revocation response
loss; a forced duplicate-handle interleaving plus incomplete-profile recovery;
avatar byte sniffing, truncated bodies, attach refusal, and digest reuse; slow
profile-stream failure; M2/M3 refusals; and stream disconnect/recovery cells
with polling disabled. A paved two-browser-context Coterie harness does not
exist yet, so that stronger LLP 0266 D10 evidence remains outside this lane.

Run the completed memory lane with:

```bash
COTERIE_PROVIDER=memory bun run accept:coterie
```

After another provider implements the frozen M2 table above, select it with
the same boot variable and run this command unchanged.

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

To add another backend:

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
