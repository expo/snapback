# 0058 — Snapback Messenger (demos/messaging-snapback)

**Date:** 2026-08-05
**Systems:** Backend (schema/functions), live queries, ephemeral state, assets, React/Expo client
**Related:** `demos/messaging-snapback`, `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`, `issues/closed/20260805-guide-gap-ephemeral-presence-hook-naming.md`

## What this is

A messaging app ("Snapback Messenger") built end to end on Snapback: 1-1 DMs,
group chats, text and image messages, emoji reactions, WhatsApp-style
lightweight reply previews (a quoted pointer, never a nested thread), and
live typing indicators. Expo Router client, dev-mode client-asserted auth
with a persona switcher (same trade-off `demos/warble` documents). Backend is
`demos/messaging-snapback/snapback/{schema,functions}.mjs` plus a seed
backlog covering every feature (including two messages with real uploaded
images, seeded through the actual upload pipeline, not a raw row insert).

## What felt good

- **The declarative-vs-JS-handler split was exactly the right shape for a
  chat app.** `myConversations` and `conversationMessages` both need a join
  (`conversationMembers` → `conversations`) or a fan-out aggregate (reactions
  per message, reply preview lookup) that the declarative plan vocabulary
  can't express — `defineJsLiveQuery` with same-file helper functions
  (`summarizeReactions`, `findReplyPreview`) spliced into the handler was
  clean and readable. I never wanted for a "just let me write a query"
  escape hatch; the guide's own advice ("use JS for bounded logic the plan
  can't express") was correct in practice.
- **`toggleReaction`'s unique index (`by_message_user_emoji`) did the dedup
  work for free.** No handler-side scan needed to prevent double-reacting;
  the unique index plus a `.first()` lookup is the whole mechanism. This is
  the same "structural constraint over runtime check" pattern Warble uses
  for likes, and it held up cleanly for reactions too.
- **Ephemeral typing state was genuinely fast to wire once I found a working
  pattern, but my first discovery conclusion was wrong.** I grepped for
  `useSnapbackEphemeral`, missed the differently named
  `useSnapbackPresence`, and hand-wired `client.subscribeEphemeral` following
  `demos/cursors-web`'s `useCursorRoom` shape. The resulting snapshot + delta
  overlay, TTL, and self-filtering by `grantedConnectionId` worked on the
  first try and was verifiably live: I proved it by publishing typing
  presence from a *second, independent* `SnapbackClient` in a Node script
  while a real browser tab had the conversation open, and the "Priya Rao is
  typing…" indicator appeared with no page reload
  (`demos/messaging-snapback/scripts/verify-typing.mjs`,
  `evidence/03-typing.png`). That's a real server-push proof, not a
  simulated one.
- **The headless acceptance harness caught every real bug before the UI ever
  ran.** All 10 backend checks (seed shape, reply pointer semantics, reaction
  idempotency, dm dedup, group membership, a *real* asset upload through
  the trusted pipeline, and the ephemeral typing overlay) were written and
  green before I opened a browser. When the UI later showed a broken image,
  I already knew from the harness that the bytes were correct server-side —
  it narrowed the bug to "browser cross-origin embed," not "did my mutation
  even work."

## What felt bad / surprising

- **`results.records(...)` is a closed shape, and "spread the stored row"
  silently violates it.** My first `myConversations`/`conversationMessages`
  handlers did `return [...conversation]` / `{...message, reactions: ...}`
  — returning the raw `ctx.db.get()`/query row, which carries `_version` and
  `_updatedAt` system fields I hadn't declared in my result `v.object(...)`.
  Every one of those queries failed with
  `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` and a `pathHash` that gives
  no field name — I had to work out from first principles that "extra
  fields" was the failure mode, not "wrong types." The fix (explicitly pick
  only the declared fields into a new object) is right, but the error
  message could name which field was unexpected, and the guide's line "does
  not invent system fields" reads like documentation of a feature, not a
  warning about a footgun in the return-the-raw-row idiom every JS-handler
  example otherwise encourages (`ctx.db.query(...).collect()` returning
  straight through is the paved happy path for `results.documents(table)`,
  but breaks the instant you add one computed field via `results.records`).
- **Table fields have no array validator — `v.array()` is result-contract-only,
  and the schema-authoring error message doesn't say what to do.** I wanted
  `conversations.memberHandles: v.array(v.string())` as a stored field;
  codegen's refusal (`unsupported validator primitive/field type
  "array"/"Json"`) named the problem but not the fix. `guide/getting-started/
  your-first-backend.md`'s validator inventory lists `v.json()` but doesn't
  connect the dots ("store an array in a table field via `v.json()`, and
  re-validate its shape with `v.array()` only in a result contract"). I only
  found the fix by grepping the codegen source's assert message text.
- **The real headline finding: dev-mode asset uploads cannot complete over
  the plain client HTTP surface, for *any* auth mode, and this generalizes
  well past the one browser caveat the guide states.** Filed as
  `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`
  with the exact mechanism (caller resolves anonymous; owner_principal is a
  required non-optional string; the equality check can therefore never
  pass). This blocked the in-app "add photo" feature from ever completing
  against this demo's dev-mode-no-sessions server — I worked around it for
  *seeding* by shelling out to `snapback assets put --user <handle>` (the
  CLI's admin-impersonated path), and I left the in-app photo picker wired
  correctly (it demonstrates the real `useSnapbackAssetUpload` integration)
  but it now surfaces an honest in-UI error explaining why it 403s here,
  rather than hanging or crashing.
- **`public-immutable` delivery is documented as cross-origin "pasteable"
  but isn't, in practice** — every asset response carries
  `Cross-Origin-Resource-Policy: same-origin`, which a browser enforces
  against `<img>` embedding from a different origin. My Expo web dev preview
  (`:8099`) and the Snapback backend (`:4421`) are different origins, so the
  two seeded photo messages show as a broken/placeholder box in the web
  screenshot even though `curl`-fetching the same URL directly returns
  correct bytes. Also filed in the ticket above. I did not have time to
  verify whether this specific CORP restriction reproduces on a native
  (non-browser) `expo-image` load — noted as an open question, not a claim
  either way.

## Comparison to React + Convex/Supabase

- The declarative-plan-vs-JS-handler choice has no real analog in Convex
  (everything is a TypeScript function) or Supabase (everything is SQL/RLS);
  Snapback's split felt closer to "write SQL when a view expresses it,
  write a stored procedure when it doesn't" than to either alternative, and
  for a chat app's two genuinely joined/aggregated queries, that mixed
  posture was the right level of ceremony — no more boilerplate than a
  Convex query function, but with a machine-checked closed result shape
  neither Convex nor Supabase gives you for free.
- The ephemeral-state primitive (typed rooms, TTL, connection-owned cleanup)
  is a closer match to what you'd hand-roll with Convex presence patterns or
  a Supabase Realtime channel than to anything built in — but Snapback's
  version is schema-declared and budget-enforced (`publishRate`,
  `maxValueBytes`) up front, which is more ceremony than a bare Supabase
  channel but caught a would-be-runtime mistake (an over-budget declared
  rate) at generation time instead of during a live demo.
- The asset upload/finalize/attach lifecycle is considerably more thorough
  than Supabase Storage's client-side-upload-then-insert-a-row pattern (GPS
  stripping, variant generation, dedup, callback events, a full receipt
  ledger) — but that thoroughness is exactly what surfaced the dev-mode
  caller-identity gap above: Supabase's simpler "presigned URL, anyone with
  the URL can PUT" model has no equivalent multi-step caller-consistency
  check to trip over in a sessionless dev setup.

## Verification performed

- `node demos/messaging-snapback/tests/acceptance/headless.mjs` — 10/10
  passing (seed shape, reply-as-pointer semantics, reaction idempotency, dm
  dedup, group membership, a real asset upload through the trusted
  pipeline, empty-message refusal, live ephemeral typing).
- `expo start --web` against a real local `snapback` server; screenshots
  under `demos/messaging-snapback/evidence/`: conversation list (live
  connection dot), an open group chat showing a reply-as-quoted-pointer, two
  reactions, and a seeded photo message; a DM with a real sent text message,
  a real toggled reaction, and a real sent reply, all driven by actual
  clicks/typing in headless Chrome (`scripts/verify-golden-path.mjs`); and a
  live cross-client typing indicator (`scripts/verify-typing.mjs`).
- Not verified: native iOS/Android build (time budget; Expo web was the
  faster path to a real, screenshot-able golden-path proof, and the guide's
  React/Expo client page documents the native carrier as the same generated
  surface plus platform-specific store/crypto concerns already exercised
  elsewhere in the repo, e.g. `demos/rn-durable-store-witness`).

## 2026-08-05 — G0 exit evidence

The fixture now proves the ordinary application path in settled Sessions
mode. The command/API chain that suffices is:

1. A trusted local process runs
   `snapback session mint --email lin@messaging.test` with operator-only
   impersonation-capability custody and receives only the ordinary session
   envelope.
2. Application-facing code adopts that bearer with
   `createExternalSessionClient`; it receives no admin token, ready file, or
   impersonation capability.
3. `createAssetClient(client).start(...)` performs ordinary reservation, TUS
   transfer, and trusted finalization to a `ready` task receipt.
4. `sendMessage` performs the typed `ctx.assets.attach(...)` inside the
   ordinary authenticated mutation.
5. The resulting public-immutable rendition returns `200 image/png` with
   `Cross-Origin-Resource-Policy: cross-origin`, so it is embeddable rather
   than merely directly fetchable.

This replaces what the bakeoff had to hand-build: an app-specific session
broker/backend launcher plus application-side shelling out to the
admin-impersonated `snapback assets put --user ...` lane. G0 does not remove
the trusted operator step; it makes it one paved session-mint command and
then uses the same public client and asset APIs the application uses.

The receipt work itself exposed one final client contradiction:
`packages/snapback-client/assets.mjs` emitted
`x-snapback-auth-client-protocol: 1` only beside a bearer. A documented
`custody: 'anonymous-public'` parent therefore sent neither credential nor
offer and was rejected by the Sessions profile gate before asset ownership
ran. The resolved ticket is
`issues/closed/20260805-anonymous-public-asset-client-drops-auth-protocol-offer.md`.
The fix projects the parent client's declared auth/rr offer into every direct
asset request without adding a bearer; bare no-custody dev clients remain
offerless. Package coverage pins external-session and anonymous-public
reservation, TUS, finalize, metadata/delivery-adjacent, and resume headers.
The real-server negative reserves an attempt under the minted session, then
has an anonymous-public asset client resume that exact attempt: it passes the
protocol gate and receives HTTP 403 from the owner/caller comparison.

Remaining friction is now narrower and explicit. The harness still has to
stage a Sessions-mode copy of this deliberately dev-mode interactive demo,
hold operator authority long enough to invoke the mint command, and choose a
raw email rather than a declared persona. Automatic supervised session
issuance belongs to G1, and friendlier persona policy remains with the auth
owner. The current negative also needs a two-client pause/resume probe because
this upload intent derives its required owner from `ctx.auth.userId`; a direct
anonymous reservation correctly cannot produce that owner. Native iOS and
Android device receipts remain outside this G0 proof.

Verification:

- `bun run test` from `packages/snapback-client` — pass.
- `node demos/messaging-snapback/tests/acceptance/headless.mjs` — 11/11,
  including minted-session upload → typed attach → embeddable delivery and
  the anonymous-public HTTP 403 ownership negative.

## 2026-08-06 — Ephemeral/presence naming correction

The earlier claim that Snapback had no React hook for ephemeral typing was a
search-vocabulary failure, not a capability gap. Reading the implementation
showed that `ConnectionEphemeralCollectionReference` fixes entry ownership to
the provider connection while the generated `scope` remains the app-defined
room boundary. `{ conversationId }` therefore creates exactly one typing room
per conversation.

`src/lib/useTyping.ts` now uses `useSnapbackPresence` in observer mode. Its
`publish`/`delete` actions preserve the existing immediate keystroke/clear
behavior while the provider owns snapshot subscription, self identity,
heartbeat, resync, and cleanup. The raw-client singleton formerly kept only
for the hand-wired overlay is gone. Provider preparation now uses the generated
`snapback.app.v1` descriptor because the legacy three-manifest path did not
admit the byte-complete ephemeral reference carried by `api.mjs`. The guide now
transcludes this actual demo hook and explicitly bridges the schema term
“ephemeral” to the React term “presence.” Live browser verification also found
that the hook's pre-subscribe snapshot was not referentially stable for
React's external-store contract; the package now caches that state, and the
typing proof fails unless the indicator itself becomes visible.

## 2026-08-10 — View-once on first-class recipient grants (LLP 0220 D3)

This pass added the app-shaped witness the grant primitive was missing:
`viewOnceMessages` keeps the typed asset reference and an owner-visible map of
still-live recipient grant ids; `viewOnceConsumptions` is the unique product
record for `(message, principal)`; four authenticated mutations implement
send/open/close/delete-for-everyone; and the Sessions-mode headless fixture
drives hostile delivery and concurrency probes with four minted principals.
The interactive Expo surface remains deliberately unchanged because its
dev-mode persona switcher has no real sessions from which these handlers could
derive an authoritative principal.

The DX improvement over the Clique P2 pilot is substantial. That lane had to
hand-compose roughly 80 lines of authority policy in ordinary grant rows,
including transfer-at-open by patching `viewerPrincipal`, row-backed sharing,
revocation, GC retention, and the surrounding security reasoning. Here the
security-sensitive transitions are three direct calls — `grant`, `activate`,
and `revoke` — and Snapback owns active-edge read authority, invalidation, GC
protection, atomic transition receipts, and the global quota. The application
code is left with the things that really are product semantics: what counts as
"opened," the caption/message relationship, and which still-live grant ids an
owner must revoke for delete-for-everyone. Compared with React plus Convex or
Supabase, this feels much closer to using a purpose-built storage authority
primitive than reconstructing revocable media access from database rows,
storage URLs, and policy glue.

Two ordering/bookkeeping details were more load-bearing than their line counts
suggest. `openViewOnce` must query and insert the unique consumption record
*before* staging `ctx.assets.activate`: otherwise a fresh second logical open
reports the platform's grant-state refusal, while an exact client-key replay
would merely return the first result. Neither proves view-once product state.
And revoke removes a grant record rather than leaving a terminal tombstone, so
recipient close must delete that id from the message's grants map in the same
mutation. If it does not, a later owner delete-for-everyone stages a revoke of
an unknown id and aborts the entire mutation, leaving siblings authorized.
The map is therefore liveness bookkeeping, not a convenient cache. LLP 0220's
future owner-side revoke-all question would remove this sharp edge, but the
current primitive is internally consistent.

The main authoring friction was visible and actionable. Inline handlers reject
dynamic computed property access, so building and narrowing the required JSON
map needed `Object.fromEntries`/`Object.entries` rather than ordinary
`grants[principal]` spelling. Codegen also honestly degrades the `v.json()` map
to `unknown` in provider bindings. The grant-enabled JPEG/PNG intent required
an explicit `image.location` decision (`strip`), which is a good privacy gate.
Finally, raw strict-delivery probes in Sessions mode must send
`x-snapback-auth-client-protocol: 1`; omitting it yields a malformed-profile
400, not the 403 authorization evidence the hostile sequence needs.

Verification: checkout-local codegen passed for seven tables and thirteen
operations (with the expected `v.json()` result-type warning), and the
18-check Sessions-mode suite ran green against the bootstrapped debug binary
(the implementation agent's sandbox could not bind `127.0.0.1:0`, so the
runtime run happened in the orchestrating session). The first real run
surfaced one client-surface fact the suite initially guessed wrong: a
declared refusal reaches the external JS client with `diagnostic.code =
'SNAPBACK_APP_REFUSAL'` and the app code in `diagnostic.details.appCode` —
there is no top-level `error.code` property on the thrown error. Guide pages
describe the envelope correctly, but an example of the *client-side* match
(as opposed to the handler-side `ctx.refuse`) would have saved a round trip.

## 2026-08-15 — Activity-scoped typing presence (LLP 0257)

The typing integration now expresses product intent instead of transport
choreography. `useTyping` supplies the conversation scope, a value thunk, and
a three-second idle deadline to `useSnapbackActivityPresence`; the conversation
screen calls `touch()` for non-empty edits and `withdraw()` on clear/send. The
screen-owned timer ref, cancellation, and repeated clear paths disappeared.
The domain-level same-user/device filter remains explicit because the helper
can identify only its own connection key. The migration also stopped forcing
the collection's 15-second maximum TTL and now takes its six-second default,
which tightens the ghost window if a final withdrawal is lost.

What felt especially good was that the convenience stayed visibly layered on
the existing presence owner. It did not require a second room or renewal path,
and unchanged values still collapse locally while the value thunk is sampled
on every input tick. Compared with a typical React plus Supabase Realtime or
hand-rolled Convex presence hook, the application no longer owns timeout
generation fencing, connection-self filtering, heartbeat, reconnect, or room
cleanup. The Expo facade also makes background withdrawal part of the import
choice instead of another AppState effect every screen must remember.

The hard part moved into the library, where it belongs: delayed AppState
resolution must gate first publication without re-evaluating the thunk;
canceled-but-queued timers need both generation and absolute-deadline checks;
and admission, transport, withdrawal, and lifecycle failures do not all arrive
through the same base channel. Testing those distinctions required a focused
fake-client room plus a stub lifecycle source. One spec wrinkle was visible:
the accepted RFC defines peers unconditionally as entries minus `selfKey`,
while the implementation charter adds an `excludeSelf?` option. The hook keeps
the RFC behavior by default and treats `excludeSelf: false` as the charter's
explicit opt-out.

The guide now puts the convenience first, retains observer-mode
`useSnapbackPresence` as a “how it works underneath” appendix, and calls out
the volatile-thunk rate-budget trap. That closes the discovery and timer-
choreography friction recorded by this diary's earlier presence correction;
no additional guide-gap ticket was needed.

## 2026-08-17 — Typing authority follows conversation membership

The typing collection now binds both publish and subscribe to one canonical
`conversationMemberships` declaration. Its principal/resource/role axes are
`userHandle`/`conversationId`/`role`; creators bootstrap as owners, owners may
seat members, and members may leave. The ephemeral scope uses the same nominal
`v.id('conversations')` resource field. This was a pleasantly small policy
expression: no separate subscribe rule, pending-role state, or ephemeral ACL
table was needed. The Sessions witness makes the lifecycle concrete — a member
can see a peer type, leaving produces a terminal denial for the leaver and an
`AuthRevoked` removal for the survivor, and reseating admits a fresh
subscription.

The existing public-read `conversationMembers` table remains byte-identical in
schema shape and keeps its original read/write projection paths. Canonical
authority instead lives in the new restricted `conversationMemberships` table:
resource creation bootstraps that roster while preserving the old projection
inserts, and leave/rejoin use its generated `removeSelf`/`insert` helpers. This
separation keeps the public product projection distinct from the restricted
authority rows. Leave and add now update the canonical roster,
`conversationMembers`, and `conversations.memberHandles` atomically so the
inbox and member-count projections cannot retain a departed member or omit a
new one. One
DSL edge was worth learning: the generated bootstrap owns the creator seat, so
an incidental creator-only `joinedAt` value must be optional even though every
explicitly seeded or inserted member still receives it.

That new-table shape also fits the governance ratchet's paved admission path.
The comparator classifies the owner-visible, owner/member-written table as
`new-restricted`, whose ledger admission requires no authority artifacts — but
LLP 0234's committed-first posture means the root transition node and the
updated exact-set baseline must be authored into the committed ledger before
generation, and no dev-mint tool exists yet for that step (a known Class R
open tail). This landing authored the node with the package's own exported
digest functions and let the unpatched generator validate and rewrite it. The
sessions acceptance harness also needed one seam: its scratch fixture carries
a per-run appId the governed-launch registry cannot resolve, so `startServer`
now names `governanceBackendRoot` explicitly. With both in place the official
25-check headless acceptance runs the generated scratch Sessions fixture on
the official server with no approval substitute.

The interactive dev surface uses the complementary direct-client lane: DM and
group bootstrap calls assert the selected persona as `userId`, while typing
asserts both that identity and the generated
`m_conversationMemberships` room permission. Sessions mode ignores those
client assertions and derives the principal and room authority server-side,
so the convenience remains explicitly dev-only rather than weakening the
production witness.

The interactive rerun also caught launcher drift: the current CLI requires
the explicit `snapback start` subcommand, while this demo still passed server
flags at the command root. Adding `start` restored the official dev backend;
Metro then produced the web bundle and a direct two-client smoke proved dev
DM/group bootstrap plus permissioned typing. The two screenshot scripts were
invoked too, but this agent environment aborted system Chrome at process launch
(`SIGABRT`), before either script could reach the app, so this round makes no
new screenshot claim.

The removal scenario also exposed a client-overlay gap. The server emits the
denied subscriber's `PermissionDenied` terminal frame and stops later delivery,
but `EphemeralOverlay.apply` recognizes the envelope as ephemeral and then
falls through to `not_ephemeral` because it has no `Error` arm. Consequently
the React presence and LLP 0257 activity-presence surfaces retain their prior
ready/empty state instead of surfacing terminal `status`/`diagnostic` or
`onError`. This slice records that finding without changing the client.

## 2026-08-21 — Private chat authority with a product roster projection

The messaging demo now carries the complete interim roster composition that
the Guide needs to teach today. `conversationMemberships` remains the private,
non-enumerable source of current authorization, while `conversationMembers`
now projects the display role and current join time. Bootstrap, owner add,
owner promotion, owner removal, and member/moderator self-leave update those
stores through one governed application path. Bootstrap, add, and self-leave
are atomic mutation-plus-projection writes; promotion and other-member removal
use the profile's generated principal-addressed operation followed by a
reconciliation mutation that verifies the new authority roster before writing
the projection. Their existing, missing, and already-current branches return
explicit `changed`, `unchanged`, or `absent` outcomes. This corrects the
previous entry's statement that `conversationMembers` stayed byte-identical:
the projection now deliberately includes `role` so the settings roster is
useful without reading authority backing.

The principal-addressed `changeRole` and `remove` operations require an
`authorityProfile` and can be invoked only through codegen-synthesized profile
operations; attempting to marshal them from an authored handler fails with
`SNAPBACK_MEMBERSHIP_OPERATION_INVALID`. That refusal materially changed the
recipe. The demo now protects the real owner with `lastHolder`, routes those
two generated operations through one application coordinator, and makes the
companion mutations re-read `ctx.authority.conversationMemberships.list`
before applying a product change. The two calls are not atomic, which is the
known cost of the sanctioned interim rather than a property the Guide hides.
Bootstrap/add/self-leave still use the better one-command-plus-ordinary-writes
transactional form.

The dedicated dev-mode acceptance compares the profile's admitted bounded
authority roster with the ordinary projection after bootstrap and every
transition. This avoids an operator-only private scan and never exposes a
membership row id. It also makes a missed reconciliation a failing invariant
instead of a silent authorization fork. The existing Sessions/media acceptance
keeps its fixture declaration profile-free because reset removes the sessions
catalog and captured fixture principals cannot establish a protected owner;
that independent 25-check lane remains green.

Message recipients are frozen from the synchronized product roster in the send
transaction. Their roles at send time and later delivered/read facts are
product history, not current authority. The acceptance adds a principal after
send and proves it cannot acknowledge that older message, then removes or lets
the original recipients leave and proves their snapshot entries and recorded
read receipt remain. The creator authority row still cannot accept incidental
bootstrap fields, so its authoritative `joinedAt` stays optional while the
ordinary projection owns the required current-incarnation timestamp.

Compared with querying a join table in Convex or a Supabase policy-backed SQL
view, Snapback's non-enumerable authority gives a stronger boundary and
generated transition enforcement, but today's application must pay for the
visible projection and its drift witness. LLP 0295 D0.4 expressly permits
teaching this sanctioned composition now; the recipe labels it interim and
does not claim a future generated projection API or commit to an implementation
option ahead of that surface landing. This entry closes the recorded Guide gap,
so it does not open another guide-gap ticket.
