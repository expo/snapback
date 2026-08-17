# Diary 0086: Coterie Exact/Contract backendless baseline

**Date:** 2026-08-15

**Run:** First backendless Coterie client and provider seam

**Client:** Exact/Contract

**Provider:** deterministic process-memory `ContractDataProvider`

## Build entry

Coterie now carries the social-messenger presentation vocabulary into a
separate Exact/Contract client rather than changing Clique's accepted
React Native/Expo baseline. I ported the reference kit's palette, spacing,
component states, fixture media, and stable `sm-*` automation IDs into reusable
`.contract` components, while giving Coterie its own mark and product identity.
The initial shell exposes feed tabs, text/media posts, likes, polls, chat lists,
conversation details, typing/read/reaction treatments, search, profiles,
profile editing, follow state, insights, settings, auth, and a media viewer.

The backend boundary felt good. One provider declaration generated typed
Contract bindings, metadata, conformance fixtures, and documentation. Both
web and native entry points configure the same provider, and no presentation
component imports a backend client. Exact's paved row-level boundary made a
deterministic local provider with live invalidation small enough to understand;
the generated conformance suite and a mutation/invalidation test both passed.
That is a useful baseline for later Snapback and competing adapters because the
UI and semantic selectors can remain fixed while the provider changes.

Contract itself was pleasant for the mostly declarative component port. Plain
values and callback actions kept the UI pieces backend-neutral, and the same
source compiled web and native artifacts. Exact's native Acto surface was
particularly useful: the final iOS simulator run exposed a 165-node Coterie tree with
the expected `coterie-*` and `sm-*` identifiers, accepted text into the
composer, and returned a native-reachability receipt for the Post action. That
run caught two real portability problems that the web compiler did not: native
alignment enums require `flex-start`/`flex-end`, and the native media loader did
not load the SVG mark from its public path. A deterministic 512-pixel PNG of
the same mark fixed the latter.

The same tree also caught a more consequential authoring error. Contract
curries `press=likePost(post.id)` when that expression is on an actual event
attribute, but the identical-looking expression is eager when assigned to an
ordinary component prop. My first port passed curried actions through props,
so every rendered feed card toggled its like state during render. The
composition guide does explain the distinction, but it is easy to miss while
mechanically extracting a reusable component. I changed those components to
accept the row identity separately and pass the parent action bare; the leaf
button now performs the curried bind on its event attribute. The lesson is
useful for future agent-authored ports, and a compiler diagnostic for action
application in function-typed component props would prevent an especially
subtle class of side effects.

The native controlled-input path needed one workaround. After Post, Contract
state was empty and the button correctly became disabled, but UIKit retained
the submitted glyphs in the text field. Coterie now double-buffers the
composer's native input identity and flips to the inactive copy when it resets;
the final Acto run showed an empty input, a disabled Post button, and the new
unliked/count-zero feed row. This adds seven presentation nodes and produces
inspector warnings for the inert hidden copy, so it is tracked for removal
rather than treated as free abstraction. The same run still reports keyboard-
avoidance and safe-area warnings around offscreen scroll content despite the
renderer safe-area declarations; those warnings are not being converted into
a clean-layout claim.

The rough edges were mostly in the surrounding Exact development loop. The
scaffold command had to come from the sibling Exact checkout, and a direct
`exact contract check` from the new app expected repository verification
configuration that the scaffold does not create. `bun run typecheck` follows
the linked Exact source graph: an early run stopped on two errors inside that
dirty sibling checkout rather than Coterie-owned code, while the final rerun
passed after the sibling changed. That makes its outcome partly nonlocal.
Repeated native hot reloads could coalesce into a rejected `ViewNotFound`
protocol frame; a clean scoped simulator relaunch restored a valid tree. The
runtime also logged an Image-alt warning even though every rendered image in
Acto carried an accessibility label. Those are development-surface frictions,
not Snapback findings.

macOS proof is not yet earned. `exact run macos --url
http://127.0.0.1:8085` selected a verified prebuilt host but displayed its
embedded Caltrain bundle instead of the external Coterie URL; the direct Acto
tree confirmed `caltrain-shell-root`. The command and guide made the selected
artifact look usable, so this is recorded as a guide/tooling gap rather than a
Coterie platform claim. The physical iPhone path was also unavailable because
the paired iPhone was locked/not ready and Developer Mode readiness could not
be established. The iOS simulator run succeeded. Web production compilation
succeeded, but the in-app browser connector failed during its own setup before
it could attach, so this entry does not claim a live browser interaction run.

Compared with React plus Convex or Supabase, this baseline pays more up-front
schema/provider-generation ceremony and currently inherits React/React DOM as
Exact scaffold internals even though the application UI is not React-authored.
In return, the provider boundary is much harder to accidentally bypass than a
collection of direct client hooks, the host-neutral component source is
smaller than maintaining separate web and native views, and backend swaps have
an explicit conformance target. The important next comparison is not whether
the in-memory provider feels reactive—it does—but whether a real Snapback
adapter can supply persistence, authority, multi-client live delivery,
ephemeral typing, and offline recovery without leaking backend concepts back
into the Contract UI.

## Snapback observations

Snapback was not attached in this entry. There are therefore no Snapback
ergonomics, correctness, or performance claims yet. The checked-in provider
seam is the input to that future work.

## 2026-08-16 — round-1 review fixes

I corrected the first entry's landing rather than rewriting that historical
account. The review exposed that I had preserved the benchmark's visual tone
while replacing too much of its actual fixture authority. Coterie now starts
from Alice through Henry, the asymmetric starter follow graph, canonical post
and conversation IDs, exact starter-log text, and byte-identical fixture-pack
media. The feed and Insights screens became more convincing once the numbers
came from those rows instead of decorative constants.

Splitting the large state-switched route was less painful in Contract than I
expected. Dynamic `route.params`, target objects, and `back()` made person,
chat, settings, and media identity explicit, while the presentation components
kept their plain callback props. The repetitive part is session/header wiring:
without a layout component in this small shell, every route repeats the same
provider query and primary-navigation action. That is honest and readable at
this size, but it is the first place I would look for a paved Contract layout
example as the stage-2 screen count grows.

The provider seam made the set-state corrections straightforward. `setLike`
and `setFollow` now accept desired state plus mutation IDs, and retry tests make
the non-flipping behavior concrete. The awkward Exact-specific edge was the
mock boundary's table-granular subscription handle: a Following query can
declare reads of both posts and follows, but its live handle is anchored to one
table. I kept a small maintained post-side follow projection so the honest
`setFollow` write set invalidates the feed, while the filter itself reads the
actual follow-edge table. Contract's mutation-observability checker then warns
on profile-route mutations whose additional denormalized writes are observed
on other routes. Those warnings are accurate about locality, but broad writes
used to maintain cross-screen projections make them noisy.

I removed surfaces whose frozen IDs would otherwise lie: always-on typing,
route-wide reactions, topic-shaped Trending, dead attachments, static chat
background, and inert repost/reply controls. The remaining settings options
now use all eight pinned accents and the exact `off`/`24h`/`7d` values. This
round still did not attach Snapback, so the earlier Snapback non-finding stands.

## 2026-08-16 — M1 provider freeze and acceptance skeleton

The provider seam remained the cleanest part of this slice. A single registry
now selects `memory` or `snapback` before either web or native mounts, and both
entries terminate at the same generated-binding configure call. The Contract
routes did not need to learn a provider name. Web selection was a small Vite
`envPrefix` change; native was less complete because the shared-host module
pipeline has no documented app-environment projection, so the native entry now
has an explicit build-time `memory` constant instead of pretending an ambient
environment variable will exist on device.

Growing the provider declaration made the M1 boundary much more concrete.
Signup, deterministic validation errors, full profile fields, fixture-avatar
attachment, session rotation, and logout revocation all fit behind the existing
row-level provider without UI imports. The process-memory limitation is now
visible in the data model: active tokens move to an in-process revocation
ledger, but restart discards both accounts and revocations. That felt honest in
a way that a mock "upload" or durable-session claim would not. The committed
fixture avatar references were also a useful narrow substitute for upload
bytes: the operation proves attachment semantics without claiming storage.

Exact generation caught one surprising sharp edge. Provider-native queries
have core `compatibilityToken` fields, while mutations currently have no such
schema key; adding one is rejected by the closed declaration schema. I kept the
two changed query tokens in their core fields and froze the complete M1
operation-token set in the namespaced `coterie.m1CompatibilityTokens`
extension. Another small generator edge appeared when a mutation named
`logout` used a result shape named `LogoutResult`: generation produced a
self-referential `type LogoutResult = LogoutResult`. Naming the row
`LogoutMutationResult` avoided the collision. Neither workaround changes the
Contract call sites, but both are details an agent has to discover rather than
obvious paved-road behavior.

The no-socket acceptance loop was pleasantly compact. Generated query bindings
are real headless handles, so the runner could subscribe to `listProfiles`,
invoke the generated login/edit/logout mutations, and prove that the edit
arrived through provider invalidation. It parses the shared `CONTRACT.md` for
the frozen `sm-*` authority and imports the shared choreography aggregator,
which avoids a Coterie-private selector registry. I did not find a public
in-process API that mounts this routed `.contract` module graph into an Acto
semantic tree without the Vite/host surface, so this remains provider/binding
acceptance rather than UI-tree interaction evidence. The later real-host lane
still owes the two-context and native proofs from LLP 0266 D10.

Compared with React plus Convex or Supabase, the declaration and regeneration
step is more ceremony, and the mutation-token schema mismatch adds friction.
In return, the backend swap is unusually inspectable: the same generated
surface drives the application, tests, and acceptance script, while invalid
provider names and the not-yet-wired Snapback entry fail before UI code runs.
Snapback itself was still not attached in this slice, so there are no new
Snapback ergonomics or backend-correctness claims.

Review exposed a deeper issue in that first provider-selector draft: although
both registry entries called the same generated configure function, the
declaration and digest still identified `coterie-memory`. A declaration emitted
from Snapback-native facts could never pass that handshake. The corrected seam
has one provider-neutral `coterie` declaration and manifest; each adapter
implements and reuses that exact surface, while provider-specific capability
evidence stays with the lane. A second adapter-shaped wrapper now configures and
queries through the generated binding in tests, making the future Snapback
integration pattern executable instead of prose-only.

The same review found that Exact generates typed declared-error `code` fields
but its runtime serializer drops every field except name, message, and stack.
The memory provider now throws errors with both name and code, but Coterie tests
and docs honestly use the delivered name until Exact grows the envelope; a
filesystem ticket records that external fix. Tightening the headless acceptance
flow also made session evidence meaningfully stronger: it signs out first,
requires login to mint and deliver a new token, then requires logout to revoke
that exact token rather than accepting optional or fallback values.

## 2026-08-16 — Snapback M1 backend lane (recorded separately from the Exact/Contract observations above)

A parallel lane built the first real backend at `demos/coterie/snapback/`
(M1 only: accounts, sessions, profiles, avatars — LLP 0266 D9). Snapback
observations, distinct from the Contract client work:

- **Sessions-mode auth was the big win.** `defineAuth` with email
  identifiers supplied signup, sign-in, recovery codes, durable bearer
  custody, and revoking logout — substantially smaller than an
  application-owned account/session implementation would have been. The
  server-side ownership boundary was direct to express: every mutable
  profile operation is `auth: 'authenticated'`, takes no owner principal,
  and compares stored ownership with `ctx.auth.userId`; unique owner and
  normalized-handle indexes make the invariants structural.
- **The asset path was cohesive.** One `defineAssetUpload`, one typed
  `v.assetRef`, one `ctx.assets.attach` — admission (PNG/JPEG/WebP ≤10 MB
  per the brief), trusted type detection, GPS stripping, renditions,
  reference tracking, and public-immutable delivery in one declaration set.
- **Codegen feedback was useful and specific**: the first run warned that
  table visibility was implicit and named the exact guide anchor; declaring
  intentional `public-read` visibility left zero warnings. Two consecutive
  runs produced byte-identical output for all 39 generated files.
- **Guide gap (ticketed):** there is no paved composition for installing
  password-backed fixture accounts + profile rows + typed avatar media
  idempotently in a sessions-mode app. The versioned-seed page correctly
  says principal IDs cannot be seeded; the assets page does not teach a
  seed-fixture path; Party Wall's closest analogue uses a dev-mode sibling
  unavailable in sessions mode. Coterie built an ordinary-session installer
  (signup on first install; on `SNAPBACK_AUTH_PASSWORD_EXISTS`, password
  sign-in plus owner-scoped profile and fixture-source-digest verification;
  matched repeats perform no upload or app write). See
  `issues/20260816-guide-gap-sessions-mode-fixture-install-recipe.md`.
- The review loop moved the backend from convention to contract: the
  benchmark brief's exact field limits (password ≥8, handle 3–20, bio ≤200,
  location ≤50, WebP avatars) and typed `DUPLICATE_HANDLE` /
  `PROFILE_NOT_OWNED` refusals all came out of dual review against
  `benchmarks/briefs/social-messenger.md` rather than the first build pass —
  the brief is the contract, and validation written from taste drifts.

## 2026-08-16 — Snapback `ContractDataProvider` adapter (M1)

Connecting the landed M1 backend to the landed Exact seam preserved the most
important architectural promise: none of Coterie's `.contract` routes changed.
The adapter exposes the existing provider-neutral manifest byte for byte, and
the same generated `configureFromProvider` digest handshake that configures the
memory implementation configures Snapback. A deliberately wrong manifest still
fails closed. Backend selection therefore remained one factory concern rather
than leaking into a route or generated link.

The Snapback client pieces composed cleanly once their ownership was clear.
`AuthCoordinator` supplied durable browser custody and an observable current
principal; that became the `listSession` projection without inventing an app
session table. The generated `listProfiles` reference supplied an initial
snapshot and stream updates with polling fallback explicitly disabled.
`createAssetClient().upload` plus `attachMyAvatar` kept byte transfer, admission,
and profile attachment inside Snapback. The existing `seed-m1.mjs` installer
could be called unchanged before acceptance, so the adapter did not grow a
second interpretation of Alice-through-Henry fixtures.

The two-client proof was the satisfying part. Two independent adapters logged
in against one ephemeral server; B established `listProfiles`, A edited Alice,
and B received the new display name without a refresh, mutation, or timer on B.
That is Coterie's first real multi-client evidence. It is headless evidence,
not the two-browser-context bar in LLP 0266 D10: there is no paved Coterie
browser-context harness in this lane, and I did not manufacture one around the
provider test.

Milestone honesty needed an explicit layer because Exact's one shared
declaration already includes M2/M3 operations. The adapter carries an M1
qualification constant and operation set; every later operation returns a
named `SnapbackMilestoneUnsupportedError` that cites LLP 0266 D7. This is more
verbose than returning empty feed/chat arrays, but it prevents a successful M1
binding handshake from becoming an accidental full-surface claim. Exact's
generic conformance suite validated the complete shared manifest and all
declared capability facts, then exercised `listProfiles@2` and
`editProfile@1`: 128 checks passed and 37 optional-capability checks skipped.
The remaining M1 auth/avatar/error behaviors have adapter-specific tests; the
operation scope is reported rather than described as whole-declaration
behavioral conformance.

Error translation was an Exact/Snapback boundary tax. Snapback correctly keeps
stable `SNAPBACK_AUTH_*` diagnostics and application refusals such as
`DUPLICATE_HANDLE` and `PROFILE_NOT_OWNED`, but the foreign declaration names
`InvalidCredentialsError`, `DuplicateHandleError`, and
`SessionRequiredError`. The first adapter pass mapped those before returning a
mutation result; the dual-review entry below records why broad family and
`PROFILE_NOT_OWNED` mapping was too optimistic and how the allow-list changed.
Exact still serializes only name/message/stack, so tests and callers must branch
by name; the existing Exact envelope ticket remains the right follow-up rather
than a private Coterie code field.

The principal rough edge was documentation assembly. The Guide has good
separate pages for generated headless references, live queries, auth custody,
assets, and Snapback-generated Contract adapters. It does not teach the inverse
case where a provider-neutral Exact declaration is already frozen and Snapback
must implement it by hand, preserve its foreign digest, state a milestone
subset, and translate errors. That gap is now explicit in
`issues/20260816-guide-gap-provider-neutral-contract-adapter.md`. A smaller
TypeScript friction also appeared: the generated `api.mjs` and adjacent
`api.d.ts` are correctly paired for consumers, but this app's bundler resolver
did not infer the declaration for the relative `.mjs` import, so the adapter
needed a narrow typed bridge to `GeneratedApi`.

Compared with direct React plus Convex or Supabase hooks, the adapter is more
ceremonial: there is a foreign declaration, a Snapback generated API, a mapping
layer, and a scoped conformance report. In return, the ceremony made the seam
auditable. Session custody, stream selection, server authorization, asset
admission, and error translation are centralized, while the UI stays portable
and the unsupported future surface cannot look successful. The Snapback path
also avoided the application-owned auth/session schema and storage plumbing I
would expect in a generic Supabase adapter. The cost is worthwhile here because
provider interchangeability is the benchmark subject, not incidental
abstraction.

## 2026-08-16 — Lane C dual-review fault cuts

The adversarial auth cuts changed my view of the adapter from “translation
layer” to “custody owner.” Snapback's client correctly keeps logout's remote
response and captured local authority separate, but the adapter had observed
only the happy return. Making local sign-out a `finally`-style terminal path,
while still returning an error when the remote revocation outcome is unknown,
produced the honest composition. The same capture-scoped clear was necessary
after login/signup adopted a bearer but the adapter's later projection failed.
This is more state-machine work than a direct React hook normally exposes, but
it keeps Exact subscribers from retaining a session that the mutation reported
as failed.

The forced handle race exposed a real cross-system transaction boundary:
Snapback password issuance and the application profile mutation cannot be one
atomic write. Treating the late duplicate as an ordinary
`DuplicateHandleError` bricked the email. Coterie now declares a distinct
`PartialRegistrationError`, clears local custody, and lets a successful login
enter a narrowly recognized incomplete-profile state whose next signup call
completes only the profile with a new handle. That compensation is more
ceremony than a single-database auth/profile transaction, but it is explicit,
tested with two adapters paused after issuance, and does not pretend rollback
of the durable password identity.

Assets had the analogous split boundary. Trusted finalization precedes the app
mutation that attaches the asset, so an attach refusal can leave a ready asset.
The adapter now sniffs PNG/JPEG/WebP bytes before upload and retains a bounded
owner/digest mapping so immediate retries reuse the finalized asset. It does
not claim cleanup: Coterie has not opted into backend reference GC, and the
README and provider error both say that unreferenced residue can remain. The
Snapback asset guide's explicit “post-finalize mutation failure can retain
residue” wording was the useful fact; without it, an adapter could easily imply
transactionality the backend does not offer.

Finally, connection state had to become a first-class Exact cell. Updating an
internal field left the last subscriber cell claiming `live` through socket
loss. Publishing the same projected rows with `stale`/`disconnected` and later
`live`, without advancing the profile revision used by mutation delivery,
keeps transport truth observable without turning reconnection into a fake data
change. The restart test uses the same port and durable database with polling
disabled, so recovery is stream evidence rather than an eventual refetch.

## 2026-08-16 — M2 surface freeze and backendless social graph

M2 made the provider declaration feel less like setup ceremony and more like
an actual portability contract. Freezing feed events separately from posts was
the decisive shape: originals keep their `postId`, reposts gain a distinct
feed-event `id` and actor attribution, and both paginate through the same
reverse-chronological keyset. That made the tricky cases executable instead of
prose—Alice's own repost of an unfollowed Grace post appears in Following while
Grace's original does not, and unfollowing an actor removes that actor's older
originals and repost events on the next delivery. Replies remain ordinary post
rows with `parentId`, but the feed projection excludes them and the thread
projection returns only direct children chronologically.

The committed fixture log paid off here. Replaying all 24 top-level posts,
four replies, eight likes, four reposts, 12 follow edges, two-image rows, and
both videos caught several omissions in the stage-1 shell: it had dropped the
video posts, collapsed image arrays to one URL, and could not represent repost
attribution at all. Pagination tests follow all remaining starter personas so
both Following and Global contain the same 28 feed events; two 20-row keyset
queries then prove the boundary with no duplicates or gaps without inventing
non-authoritative filler data. The Contract feed keeps prior pages in local
view state and advances the query cursor from the virtual list's end-reached
event, so the same boundary drives actual infinite-scroll accumulation.

Compared with the M1 round, Exact's generated seam still made broad changes
pleasantly mechanical. Declaration version 6 regenerated bindings, types,
fixtures, docs, and the digest together; the Contract routes only imported the
new neutral bindings. The existing `listProfiles@2` row already carried counts
and viewer follow state, so M2 could reuse that frozen token rather than break
the M1 adapter just to rename an aggregate. The Snapback adapter now sees the
new digest and explicitly classifies the new operations as M2 refusals, while
its M1 implementation and the `.contract` provider boundary stay unchanged.

The rougher Exact details were concrete. Provider list queries have a row-list
result rather than a typed page envelope, so `listFeed` repeats one opaque
`nextCursor` on every row in a non-terminal page. That is workable and easy to
test, but an explicit paginated-result shape would avoid duplicated metadata.
Mutation compatibility tokens still need milestone-namespaced declaration
extensions. Naming the `createPost` result row `CreatePostResult` also produced
the same self-referential generated alias seen around logout in M1; `CreatedPost`
is the harmless workaround, but the generator should diagnose collisions.
Finally, the mock query boundary invalidates one anchor table, so changes to
likes, reposts, follows, or profile projections require an honest no-op write
to `posts` after updating their real tables. The query reads the real graph and
event tables—the no-op is only an invalidation bridge—but this is noisier than
a multi-table dependency-aware mock boundary.

Contract itself handled the M2 presentation additions well. Attributed repost,
like/repost/reply actions, profile post lists, image grids, and video tags
remained plain values and callbacks. The existing dynamic `media/[id]` post-
detail route could grow into the thread screen, preserving its media viewer and
native route registration instead of adding a parallel destination. The
compiler's mutation-observability warnings remain broad for intentional cross-
route writes, but they did not block the build.

The acceptance runner grew without forking its selector authority. In each of
the two existing boot-state scenarios it now creates a text post and observes
Global, follows Dave and observes his old originals enter Following, then
likes and unlikes the created post with both states delivered. The artifact is
still headless generated-binding evidence; it does not become browser-tree,
native-host, durability, or multi-client evidence merely because the memory
provider pushes synchronously in process.

Snapback M2 was not implemented in this entry. This is therefore an
Exact/Contract plus backendless-provider observation, not a new Snapback
correctness or ergonomics claim. LLP 0266 D7 and D8 still match reality: one
provider-neutral declaration is frozen before the adapter slice, the memory
lane implements it, and the M1-only adapter fails loudly until it qualifies
the new token set.

## 2026-08-16 — M2 adversarial fix round

The pagination review found an important distinction that the first M2 pass
blurred: changing the only live query's cursor is not infinite scrolling, it is
replacing the live window. Coterie now keeps the newest page live and treats
older cursor pages as snapshots, merging event IDs in the Contract route. A
small intent overlay keeps likes and reposts correct on rows beyond the first
20 until a reset/refetch. Tab, post-create, and session actions reset the
accumulator; returning from the profile follow flow remounts the feed route.
This is more client state than a Convex-style live paginated query would need,
but it makes Exact's present row-list boundary honest and testable, including
duplicate cursors and empty older windows.

The mock provider's single-table subscription primitive was the other source
of accidental complexity. The previous no-op `posts` writes worked, but they
made declarations and mutation traces misleading. A memory-adapter wrapper
now subscribes derived queries to each declared table, so feed, thread,
profile-post, and Insights deliveries react to their real dependencies.
`listInsights` consequently declares posts, follows, likes, and reposts, and
the no-op invalidation writes disappeared. This feels closer to normal query
dependency tracking in Snapback, Convex, or a database-backed Supabase
adapter, while staying scoped to Exact's deliberately coarse mock.

Several smaller cuts were worthwhile because they made frozen semantics
literal. Reposts now reject reply rows with a declared error. Media rows carry
served `/assets/fixtures/...` URLs rather than source-tree file URLs. Both
adapters accept the same eight persona avatar refs, and the memory projection
updates direct-chat avatar delivery as declared. HTTP(S) post-body segments
use Contract's paved `link` primitive, with no preview-card claim; a mounted
interaction test presses the `sm-post-link-0` node and observes the external
href handoff.

The corrected v6 declaration digest changed because these fixes altered the
declared read/write/error and compatibility-token surface. Snapback remains an
M1-only adapter and still refuses M2/M3 rather than inheriting an unqualified
claim. The acceptance addition is similarly narrow: it proves at boot that an
unfollowed author's original is present in Global and absent from Following.

## 2026-08-16 — Snapback M2 backend lane (recorded separately from the client observations above)

The M2 backend (posts, follow graph, feeds, threads — LLP 0266 D7/D9)
went through two dual-review rounds. What the build taught, distinct from
the client work:

- **The brief is the contract, again:** the review round caught a video
  ceiling pinned to the fixture file's byte size (49,779) where the brief
  says ≤50 MB — the same taste-vs-contract drift M1 hit on field limits.
  Upload intents can bound media type and bytes but cannot express
  H.264/AAC codec facts or the 60-second duration ceiling; M2 video
  admission is honest about that gap.
- **The `in()` 500-operand bound is real design pressure:** the guide's
  builder bound would have thrown for the benchmark's 500-follow probe
  user. `followingFeed` now chunks actor IDs at ≤499 (cursor takes the
  500th binding), runs an indexed top-20 per chunk, and merges by the
  immutable `pageKey` — exact, and provable via an acceptance-only
  `actorChunkSize` argument forcing a multi-chunk path. But the
  composition is an opaque plan, not a first-class semi-join whose
  cost/cursor facts codegen can prove; the guide should teach the pattern
  or ship a closed helper. Relatedly, the paged-list recipe covers one
  ordered table — the `feedEvents` normalization and cursor ownership had
  to be designed from first principles.
- **Census blind spot (ticketed):** codegen's authorization-review
  `writePolicyChecks` see only writes lexically inside handlers; the
  helper-mediated writes in `createPost`, `setFollow`, `setLike`,
  `setRepost`, and the fixture mutations project zero checks. See
  `issues/20260816-codegen-authorization-census-helper-writes.md`.
- Threads refuse at the reply bound with an overflow witness rather than
  silently truncating; fixture ensure-ops stay owner-checked but cannot
  be hidden from first-party generated bindings — the adapter lane must
  not map them (recorded so D7 freezing never absorbs seed ops).

## 2026-08-16 — Quoted replies, message reactions, and avatar picker

This slice made the partial-provider seam visible in a useful way. Quoted
reply and reaction buttons cannot honestly exist in the Snapback M1 lane, even
though they are present in the one shared Coterie declaration. A new
`listProviderClaims` query reports operation names and compatibility tokens;
the Contract routes derive affordance visibility from those rows. Memory
claims the complete surface it implements, while the Snapback adapter returns
its existing M1 allow-list and still refuses every unclaimed call loudly. The
UI never reads provider identity. That felt better than either scattering
`COTERIE_PROVIDER` checks through presentation code or leaving dead controls:
an unavailable reply, reaction, or avatar action is simply absent.

The memory provider work was pleasantly direct. `sendMessage` stores an
optional same-chat quote identity, while `listMessages` resolves the sender
and a short preview at projection time so a deleted source becomes a safe
tombstone instead of leaking its old text. Reaction state is stored as one
actor event and projected as sorted per-emoji counts plus `reactedByMe`.
`setMessageReaction` is set-state rather than toggle-state, so a repeated
delivery does not reverse intent or double-count. The starter quote edges copy
the six quote actions from `starter-m3.log` exactly; that log has no reaction
actions, so this slice did not invent fixture reactions.

Contract's plain props and leaf-event currying again made the portable UI
small: the same message component now carries quote previews, reaction chips,
the choice tray, and compose-with-quote cancellation with the frozen `sm-*`
selectors. The sharper limitation was avatar input. Contract still has no
file-input primitive, so Coterie cannot expose the Snapback adapter's real
upload path from a portable `.contract` form. The honest interim UI is a
picker over the eight committed persona references. A file-input primitive
would remove that benchmark-specific vocabulary and let the same screen
exercise real media selection on web and native.

The post composer reached the same conclusion for media: reusing the M2
fixture-ref-to-served-URL maps made a small, honest picker much easier than
pretending Contract had a portable upload control. Reducer-owned selection
keeps the four-image/one-video rule visible before mutation, while the provider
still enforces the declared boundary. `listProviderClaims` also made this
additive control clean—the Snapback M1 lane simply has no attach button, with
no provider-name branch in the Contract tree.

That picker immediately revisited an earlier lane seam discovery: the v5
memory provider accepted only Alice and Bob refs while the concurrent v6 lane
expands `setAvatar@2` to all eight and also invalidates chats. The mismatch is
recorded in `issues/20260816-coterie-setavatar-seam-mismatch.md`. Structuring
the vocabulary as one `COTERIE_AVATAR_REFS` constant made the rebase repair a
one-line string-set change, and the pre-v6 test classifies whichever refs the
installed provider accepts instead of pretending all eight already work. The
post-rebase proof must require all eight. This was useful seam friction: the
provider-neutral declaration and tests exposed divergent `avatarRef` meaning
before the UI could accidentally encode one lane's private vocabulary.

Compared with React plus Convex or Supabase, the claims query adds explicit
schema and generated-binding ceremony that a direct hook would often replace
with a feature flag or backend check. In return, capability visibility is data
on the same typed seam as the feature itself, adapter refusals can be checked
against advertised claims, and the presentation layer stays portable. The
trade remains favorable for this benchmark, where honest interchangeability
is the point rather than an incidental abstraction.

The v7 dual review caught two concrete client/provider bugs before landing.
Message actions had been rendered beside their bubble, so the frozen
choreography's bubble-scoped quote/reaction locators could not reach them; the
actions, picker anchors, and chips now live inside the bubble, and quoted
excerpts jump to their source. It also caught a direct-message avatar update
keyed by membership rather than displayed counterpart: Alice changing her own
avatar could overwrite the row that displays Bob. The projection now updates
only rows that display the changed persona and leaves group rows unchanged.

## 2026-08-16 — Snapback `ContractDataProvider` adapter growth (M2)

Growing the adapter from M1 to the frozen M1+M2 claim kept the public seam
clean: Coterie's Contract routes did not change, the v7 declaration stayed
byte-for-byte frozen, and the adapter mapped the generated `globalFeed`,
`followingFeed`, `thread`, `profilePosts`, `createPost`, `setFollow`, `setLike`,
and `setRepost` references directly. Client B observed client A's post and
subsequent like-count change over stream transport with polling disabled, so
the live-query ownership rule remained legible in the proof.

The awkward part was projection composition. `listProfiles@2` is one list but
Snapback's `profileStats` is keyed to one profile, so the adapter retains a
stats stream per visible profile, joins the snapshots, and fans authoritative
updates back to every Exact observer. Publishing while those streams were
still opening briefly exposed zero counts; rebuilding all streams after an
unrelated profile edit then hit auth establishment throttling. The stable form
gates the first ready cell on the complete stats snapshot and reconciles
streams only when profile IDs enter or leave. A backend list-shaped stats
projection, or a first-class generated multi-query composition, would make
this much less machinery for a `ContractDataProvider`.

The two cursor vocabularies fit after making the translation explicit.
Coterie's cursor carries `{v, mode, sortAt, eventId}` while the backend accepts
`<16-digit-ms>:<event-id>` as `pageKey`; the adapter checks the timestamp both
directions and rejects malformed or cross-mode tokens before opening a stream.
The backend returns only 20 rows rather than a 21st overflow witness, so a full
page conservatively carries a next cursor and a short page terminates. This is
workable keyset behavior, but the page-boundary fact is less direct than the
memory provider's 21-row lookahead.

Committed composer refs also mapped predictably: resolve the shared fixture
URL, sniff bytes, hash them, reuse an owner/kind/digest asset mapping, upload
through `postImageUpload` or `postVideoUpload`, then call `createPost`. That is
more ceremony than a direct Convex storage URL or Supabase bucket write, but
the upload intent makes custody and attachment admission explicit while the
fixture vocabulary remains provider-neutral.

The reply-repost rule belongs at the backend mutation boundary. `setRepostCore`
now refuses any post with a parent through the declared
`REPLY_REPOST_FORBIDDEN` application code, and both the user mutation and
fixture ensure path declare that code. The adapter maps it directly to
`ReplyRepostForbiddenError` and no longer opens the bounded `thread` query as a
preflight. Besides removing a redundant round trip, this matters for an
original with more than 1,023 direct replies: the thread projection correctly
refuses its overflow witness, while reposting the original remains a bounded
single-post mutation. No `ensureFixture*` or `getMyFixture*` operation was
mapped—the seed installer remains a separate program surface.

Review also found two projection boundaries worth making explicit. Asset URLs
must use renditions guaranteed by their upload declarations (`feed` for post
images, `primary` for post video, `thumb` for avatars); a generic thumbnail
helper produced non-existent video/image URLs. And a feed subscribed before a
new profile signed up could observe the new post before the adapter's cached
profile index learned that identity. M2 delivery now serializes snapshots,
hydrates only unknown author/reposter IDs before publication, and fails closed
instead of falling back to a backend `_id`. The integration proof subscribes a
feed without a profile stream before signup, then checks both create and repost
delivery against the new external owner identity.

Finally, the shared Exact headless handle emits an empty placeholder before an
asynchronous Snapback live snapshot. The acceptance runner had treated that
placeholder as the seeded feed; waiting for the first non-empty M2 snapshot
fixed the evidence without provider branching. The durable Snapback lane also
made scenario cleanup matter: the follow step now restores Dave's unfollowed
precondition so the second boot-state scenario measures the same choreography
instead of inheriting the first scenario's edge.

## 2026-08-16 — M3 messaging core (memory provider and Contract client)

M3 was the first Coterie slice where the projection shape mattered more than
the basic mutation plumbing. A DM is keyed by the sorted pair and reopens the
same entity; a group is a separately identified entity even when its member
set matches another group. Storing membership as active/inactive rows with an
admin flag made authorization and history behavior fit together cleanly. A
join or rejoin has no lower history bound and therefore sees the full log. A
leave/removal records the last visible message as a cutoff, so the former
member keeps local history but cannot receive future rows.

Receipts needed one additional immutable fact on every message: its
send-time recipient IDs. The projected sender status is the slowest receipt
across that set, not whoever happens to be in the group when the query runs.
Leave/removal adds that actor to a dropped-requirement set, which prevents a
departed recipient from wedging the aggregate while preserving the original
send record. Keeping the state machine monotonic (`sent`, `delivered`, `read`)
made retry and out-of-order delivery uneventful. This is more explicit state
than a client-only React mock would normally carry, but it exposes exactly the
group semantic a Convex or Supabase implementation would still need to encode
somewhere authoritative.

Typing exposed the clearest Exact seam limitation. Contract's runtime manifest
can represent ephemeral operations, but the closed provider-native declaration
generator used by Coterie cannot currently generate those descriptors. The v8
surface therefore uses a documented bridge rather than claiming fake
durability: a live/coalesced `observeTyping` query, a `setTyping` mutation, and
a namespaced extension that states ephemeral durability, no offline retention,
no history, a two-second visibility target, and a five-second lease. The
memory clock schedules real expiry for the app and exposes logical advancement
for tests, so unit and acceptance proofs do not sleep. A first-class generated
ephemeral declaration would remove this parallel extension vocabulary.

The Contract client stayed compact despite the larger feature set. The same
chat bindings now drive DM/group creation, membership/admin settings, sender
avatars, list-level typing hints, conversation typing, and single/double/blue
double receipt checks under the frozen `sm-*` targets. The valuable discipline
was copying the feed's reducer boundary: every route-owned chat or group-draft
write carries a generation, and every post-`await` settlement enters through
that reducer. Stale mutation completions therefore cannot publish predecessor
compose or picker state into a successor interaction.

The memory-provider pass of the headless proof exercises the whole ordered M3
chain in both boot states: DM dedup, text, quoted reply, delivered/read receipts
plus non-regression, typing visibility and logical expiry, group creation,
non-admin refusal, and creator removal. This remains generated-binding evidence
rather than mounted UI-tree evidence; its frozen target IDs identify the
intended vocabulary while provider subscriptions prove the headless semantics.

Snapback observations are deliberately separate: this lane did not modify
`demos/coterie/snapback/` or claim a Snapback M3 backend. The existing adapter
continues to advertise only its qualified M1+M2 surface and refuses M3
operations. It projects the new nullable `listProfiles@3.avatarRef` as `null`
until the parallel provenance/selected-state work is qualified. The M3
ergonomics recorded above are therefore Contract and deterministic-memory
observations, not server-authority, durability, offline, or multi-client
Snapback evidence.

## 2026-08-16 — M3 review corrections

The dual review found that generation discipline has to cover the side effect,
not merely the reducer settlement. DM/group navigation and the post-send typing
clear now compare the captured generation immediately before publishing; edits
advance the generation, so a successor draft makes an older completion inert.
Failed send and group creation restore the exact pre-begin draft when no
successor exists. This is slightly more explicit than a React closure plus an
abort flag, but the single reducer made the race tests deterministic and kept
the route contract readable.

The review also sharpened the evidence boundary. `accept:coterie` is a
headless generated-binding provider proof over the frozen `sm-*` vocabulary,
not mounted or two-browser choreography. Selecting steps from
`listProviderClaims` let the existing Snapback M1+M2 path remain green while
reporting M3 as skipped-by-claim; memory still exercises the full M1–M3 chain.
The optional logical-clock hook only accelerates memory—the public typing
projection is the provider-neutral expiry observation.

One Exact paper cut remains visible in the generated helper sidecar: the
contract-meta command completed successfully but widened five `string | null`
state fields to `string`, so the checked sidecar needed the nullable types
corrected after regeneration. The provider generator itself handled the
reaction refusal/token bump and write-set changes cleanly.

## 2026-08-17 — Snapback M3 backend lane (recorded separately from the client observations above)

The messaging core (LLP 0266 D9, M3) shipped as an honest partial claim:
**messaging core minus typing**. The review loop ruled that the only
expressible ephemeral posture — `allow.all()` — made typing presence
observable and spoofable by former members (LLP 0013's protected-room
rule controlling), so the surface was removed rather than shipped
public; the platform gap is ticketed as
`issues/20260817-ephemeral-membership-permission-backing.md` with the
six capabilities membership-backed ephemeral lowering needs. The memory
provider carries the full typing semantics alone until then.

Other things the build taught:

- **Membership incarnations** (leave/rejoin as distinct rows) model the
  brief's send-time recipient sets cleanly — old obligations stay on the
  removed incarnation, rejoin creates fresh ones — but bounded reads
  over unbounded incarnation history was the review round's best catch:
  churn could silently drop an active member from access checks. The fix
  is an indexed current-membership projection queried separately from
  history; a 640-cycle churn test locks it.
- **Removal cutoffs belong in the query layer**: removed members keep
  pre-removal history (brief) and that filter lives server-side on every
  read path — including the fixture helpers, where the review caught a
  cutoff bypass.
- The census helper-write blind spot (LLP 0274, ticketed at M2)
  applies to most new M3 writes; operations are marked opaque
  accordingly.

## 2026-08-16 — user-reported browser media and appearance corrections

Two defects reported from the memory-provider web demo exposed presentation
seams rather than another provider row-aliasing bug. A generated-binding live
feed regression proves that a text-only post keeps `mediaKind: null` and an
empty URL array before and after the following media-post delivery. The visual
bleed came from putting variable-height feed cards inside Exact's fixed
`estimateSize=220` virtual rows: a media card overflowed its row into the next
card. Coterie now uses the documented non-virtual host-fed list for this
heterogeneous feed. The recent mutable-row alias pattern did not strike again.

The appearance model was split. Facet controls resolve the shared theme store's
system preference, while Coterie's hand-authored shells, raw controls, borders,
and text were literal light colors. Reading the Exact theming guide made the
repair straightforward: Coterie now follows the resolved light/dark scheme with
semantic Facet v2 tokens throughout, retaining only the frozen eight chat
accents and their contrast foregrounds as literals. No linked Exact source was
changed. Compared with a React app using a token-aware component library, the
failure mode is familiar: raw DOM/native controls still need the same semantic
palette discipline as library components.

The red attachment was also useful evidence rather than a missing-file symptom:
the selected shared `IMG 01` benchmark fixture is intentionally a red synthetic
card, its public asset hash and served URL are correct, and the route projection
binds that URL to the owning post. Feed image and video presentation now uses
`contain` on themed media surfaces so the fixture's identifying content is not
cropped away.

## 2026-08-17 — appearance and regression-review completion

The review's contrast calculations caught the remaining split between accent
data and accent presentation. Keeping the eight chat values literal is useful
for the frozen M5 choreography, but using those same bytes as foreground colors
was not safe across Facet schemes. A single pure palette helper now derives
light/dark foreground variants against the actual Coterie message and selection
surfaces, chooses swatch ink from accent luminance, and owns separate person/chat
fallback-avatar pairs. This followed Exact's documented `theme.scheme` palette
idiom cleanly; the raw Contract views now read roles instead of scattering
scheme branches. The one ergonomic cost is a Contract metadata sidecar for the
otherwise ordinary pure TypeScript helper.

The strengthened layout regression also exposed the useful boundary between
source composition and a minimal harness. The harness still supplies a query
and no-op actions, but it mounts the real `CoterieFeedList`, `CoterieFeedCard`,
avatar, and feed-body components. That made media ownership, image/video
`objectFit`, non-absolute rows, and the lowered `endreached` callback observable
without browser automation.

The same exercise confirmed a separate Exact/Coterie pagination seam outside
the current fixture envelope: non-virtual list reach geometry mixes item count
with pixel offsets, leaving the end edge sticky. It is recorded in
`issues/20260817-coterie-feed-pagination-third-page-stall.md`; this review did
not disguise that latent third-page failure as part of the two-page media fix.
## 2026-08-16 — Snapback `ContractDataProvider` adapter growth (M3-minus-typing)

The adapter now projects the landed messaging core through the same frozen v8
provider seam as memory: membership-scoped chat/message streams, DM reuse,
group membership/admin changes, quoted sends, and receipt aggregation. The
strongest useful proof was also the simplest to read: Bob armed one
`listMessages` stream, Alice sent, and Bob observed both the new row and the
subsequent read transition without polling or refetching. This preserved the
same server-authoritative live-query shape that made the M2 adapter feel better
than stitching invalidation channels around Supabase reads; compared with a
Convex query, most of the extra work was projection and identity vocabulary,
not live delivery itself.

Receipt adaptation was more mechanical than expected. Snapback already emits
the immutable recipient count, the remaining required count, delivered/read
counts, the aggregate state, and the viewer's own row status. Coterie's frozen
projection wants the current required count, so the adapter can map the
backend aggregate directly while retaining bounded pagination for unread and
`markReceipt` scans. Quoted replies similarly retain backend message IDs while
profile identity hydration happens before publishing fixture-vocabulary
sender IDs. `listChats` keeps `typingHint: null`; the missing typing claim is
visible in `listProviderClaims`, and direct typing calls name
`issues/20260817-ephemeral-membership-permission-backing.md` instead of
misclassifying the platform gap as a later milestone.

Selected avatars exposed a fixture-specific ambiguity worth documenting. The
backend persists `avatarSourceDigest`, while several fixture aliases share the
same committed bytes. A profile's identity is not its selected avatar, so
using Carol to recover `avatar-carol.png` would invent provenance (the seeded
Carol profile actually selects `avatar-alice.png`). The adapter therefore maps
each digest to its canonical committed source ref and returns `null` for an
absent or unknown digest. This preserves the selected source when it is
knowable and does not pretend the digest can distinguish same-byte aliases.

Acceptance found one real auth impedance mismatch. Snapback password issuance
will not silently adopt Bob over Alice's live bearer; the frozen provider API
allows `login` to replace the current persona. The adapter now expresses that
as two explicit authority transitions—settle the predecessor logout, then
issue the successor—rather than treating a stale-authority response as an
application credential error. Both acceptance boot states exercise repeated
Alice/Bob switches in the quoted-message, receipt, and admin-refusal chain.

The brief expected `setMessageReaction@2` to map to a backend reaction
operation from the v7 slice, but this checkout has no reaction operation,
reaction table, or reaction field in its generated M3 rows; the landed backend
diary explicitly places reactions in M4. Adding one would have changed the
forbidden `demos/coterie/snapback/**` behavior and made the requested
M3-minus-typing claim dishonest. The adapter therefore keeps reactions empty
in projected messages and leaves `setMessageReaction` unclaimed with the
existing M4 milestone refusal. This is backend-surface absence rather than a
guide gap, so no new `guide-gap` ticket was filed.

The resulting evidence boundary is intentionally narrow. Exact conformance is
formally probed at M1 `listProfiles@3`+`editProfile@1`, M2
`listFeed@3`+`createPost@1`, and M3 `listMessages@4`+`sendMessage@4`; it is not
presented as a per-operation formal suite. Adapter integration covers the
remaining membership mutation map plus the two-client message/receipt stream,
and the shared acceptance artifact reports 28 passed claimed steps and two
typing skips across `provider-boot` and `injected-signed-out`. Memory remains
the full v8 client-evidence lane.

## 2026-08-16 — Adapter M3 review corrections

The final review exposed an important difference between “the first live
backend page is correct” and “the frozen provider result is correct.” Coterie
declares whole chat/message lists, while the app-owned backend deliberately
returns 200-chat and 50-message keyset windows. The adapter now retains that
live head and merges every older keyset page beneath it, with explicit
1,000-chat and 10,000-message envelopes tied to the benchmark's 100-chat probe
and 10,000-message busy conversation. Crossing either envelope is a loud
provider error instead of a plausible-looking truncated list.

Unread and receipt work became substantially cleaner after moving the truth to
the membership incarnation. `sendMessage` maintains unread/required counts;
the one chat-level receipt mutation checks the exact 10,000-message boundary
before writing and advances delivered/read watermarks atomically. Message
projection combines those watermarks with per-message receipt rows, so sender
aggregates remain exact without thousands of adapter-driven mutations. A
removed incarnation is no longer a latent receipt target after the same person
rejoins. This resembles the server-maintained conversation projections one
would build in Convex, and avoids the client scan/update loop that would be
especially awkward over Supabase RPC calls.

The semantic parity fixes were small but revealing: the adapter must reject a
group member list that omits or duplicates the creator before mutation;
`addMember` must distinguish an existing active seat; the backend must permit
the sole admin to leave; and missing chats must not masquerade as missing
membership. Returning `created | reused` from the atomic DM mutation also
removed a race that no preflight query could solve. None of these fixes needed
a v8 declaration change—the review caught implementation claims that had not
yet earned the already-frozen shapes.

## 2026-08-17 — Adapter M3 envelope ruling and fully live tails

The prior review-correction entry's 10,000-message, paged-tail architecture is
superseded. Snapback's authored live-query/result contract caps one window at
1,024 rows, so the ruled Coterie product envelope is 1,024 messages per
conversation; chats remain 1,000. The cleaner implementation made the product
claim stronger inside that bound: backend queries now return the entire
envelope in one live window, and the Exact adapter simply projects that window.
Deleting the one-shot cursor walk and retained archive removed a split-brain
state where head rows were live but old receipt and membership projections
could go stale.

The integration proof now makes the distinction observable. Alice holds one
`listMessages` stream over a 900+-message conversation, Bob advances his
receipt watermark, and Alice receives the changed receipt projection on an old
message without polling, refetching, or performing another action. A parallel
201-chat proof removes Bob from the oldest new group and observes the old chat
row change on Bob's already-armed stream. This felt closer to an ordinary
Convex live query than the discarded adapter pagination: the backend owns the
complete live set, and the client has no second consistency mechanism.

Closing the read bounds under mutation was essential. `sendMessage` refuses
before message 1,025; creating groups or new DMs and adding a new group member
refuse before chat 1,001 for any participant. Exact-boundary tests prove the
Nth write, the N+1 refusal, no
row change, and a healthy full query afterward. The codes surface as
`SnapbackProviderError` because envelope limits are adapter/backend capability,
not new vocabulary in byte-frozen declaration v8. The future M6 choice—larger
engine windows or a token-bumped `listMessages` cursor modeled on
`listFeed@3`—is recorded in
`issues/20260817-coterie-message-envelope-growth.md`.

The stored projection fields also forced an explicit transition statement.
Coterie has no populated production database, so this lane uses the Guide's
disposable-store posture: **DESTRUCTIVE-WITH-RESEED**, then `seed-m3.mjs` →
`seed-m2.mjs` → `seed-m1.mjs`. README and `LANE-NOTES-M3.md` make clear that a
store worth preserving must instead enter the reviewed migration/backfill
loop.
