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
