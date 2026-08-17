# Coterie

Coterie is the Exact/Contract sibling benchmark to Clique. It keeps the
social-messenger workload and stable `sm-*` automation vocabulary while using
one Contract source tree for web, macOS, and iOS.

The checked-in default remains backendless: the `memory` lane is a deterministic
process-memory implementation of Coterie's frozen M1, M2, and v8 messaging
`ContractDataProvider` surface. The optional `snapback` lane supplies the
frozen M1 account/session/profile/avatar set plus the frozen M2 post, feed,
follow, like, repost, reply, pagination, media, and multi-client-live behavior
from the application-owned backend. It also supplies the M3 durable messaging
core: chat membership/admin operations, quoted text messages, live receipt
aggregates, and the selected fixture-avatar reference projection. It advertises
**M1+M2+M3-minus-typing**. Typing is deliberately unclaimed until Snapback can
lower membership-backed ephemeral permissions; reactions remain unclaimed
because the landed Coterie backend has no reaction operation or storage slice.
The memory lane implements the wider declaration for client evidence.
The memory lane makes no durability, server-authority, offline, or multi-client
claim.

## Stage-1 surface

The checked-in routes cover sign-in; Following/Global feed and text/image/video compose;
likes and attributed repost toggles; parent-plus-direct-reply threads; people
profiles with reverse-chronological post lists and live follow counts;
fixture-derived Insights; people/chat search; deduplicated direct messages;
named groups with member/admin controls; conversation text send with quoted
replies, typing leases, monotonic receipt checks, sender avatars, and emoji reactions; own-profile avatar selection; chat
accent/disappearing options; and image/video viewing.
Navigation carries canonical fixture identities such as `alice`,
`d-alice-bob`, `g-starter`, and `sp0002`; the viewer returns through the real
router back stack.

Surfaces staged by LLP 0266 D6 are deliberately absent rather than presented
as inert controls: sign-up UI and durable sessions; Trending; message
attachments; reactions and live receipts on posts; chat-background upload;
invitations; account settings; profile
handle/location/link editing UI; offline,
multi-client, and server-authoritative behavior. Search is the backendless
people/chat word-prefix slice, not the brief's complete message/offline search.
The form defaults to Alice, while the memory provider accepts all eight
committed starter personas and accounts created through its headless `signup`
operation.

## Inherited frozen M2 provider surface

Declaration version 8 inherits the v6-frozen M2 set while retaining the
already-frozen M1 set and adding the later chat/reaction/messaging overlays.
Query tokens remain in Exact's core `compatibilityToken` field. Exact's
mutation declaration still has no first-class compatibility-token field, so
mutation tokens live in the namespaced `coterie.m1CompatibilityTokens` and
`coterie.m2CompatibilityTokens` extensions. `listProfiles@3` adds nullable
`avatarRef` for the selected fixture identity while retaining the M2 live
follower/following semantics.

| Milestone | Operation | Kind | Token |
| --- | --- | --- | --- |
| M1 | `listSession` | query | `2` |
| M1/M2/M3 | `listProfiles` | query | `3` |
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

The Snapback projection uses each upload intent's guaranteed rendition: post
images use `feed`, post videos use `primary`, and author/profile avatars use
`thumb`. These are public immutable delivery URLs, not upload-source URLs.

The memory seed is the committed `starter-m2.log` corpus: 24 top-level posts,
four direct replies, eight likes, four attributed reposts, and the asymmetric
12-edge follow graph. All image/video refs name assets in
`benchmarks/fixtures/social-messenger/media/`, copied into Coterie's served
`public/assets/fixtures/` tree; provider rows use root-relative
`/assets/fixtures/...` URLs rather than source-tree file URLs. Process restart
resets this state and every local mutation. `listInsights` declares and
subscribes to all four tables it derives from: posts, follows, likes, and
reposts.

## Frozen M3 messaging surface

Declaration v8 freezes the following M3 operation/token table. Revised
operations increment their v7 token; every new operation starts at `1`.
Query tokens are core declaration fields, while the complete record is also
kept in `coterie.m3CompatibilityTokens` because Exact's closed mutation shape
has no compatibility-token field.

| Operation | Kind | Token |
| --- | --- | --- |
| `listProfiles` | query | `3` |
| `listChats` | query | `3` |
| `listMessages` | query | `4` |
| `observeTyping` | query | `1` |
| `openDm` | mutation | `1` |
| `createGroup` | mutation | `1` |
| `addMember` | mutation | `1` |
| `removeMember` | mutation | `1` |
| `promoteAdmin` | mutation | `1` |
| `leaveChat` | mutation | `1` |
| `sendMessage` | mutation | `4` |
| `setTyping` | mutation | `1` |
| `markReceipt` | mutation | `1` |

`openDm` canonicalizes the unordered pair and reuses its sole channel.
Groups are independent entities, so two calls with identical membership still
create distinct groups. A group has a 1–50-code-point name, optional
description of at most 200 code points, and 2–50 unique initial members
including its creator. The creator is an admin; only admins add, remove, or
promote, while any current member can leave. A new or returning member sees
the full group history. Removal or leave records a history cutoff: the former
member keeps the messages already visible locally but cannot see later sends.
The last admin may leave; the group then remains admin-less, and later add,
remove, or promote attempts refuse with `ChatAdminRequiredError`.

`sendMessage@4` accepts 1–2,000 Unicode code points, requires current
membership, preserves the v7 quote pointer/excerpt/jump and reaction aggregate,
and snapshots the active recipients other than the sender. Receipt rows move
only `sent → delivered → read`; a lower subsequent intent is a no-op. The
sender's group status is the slowest state across that immutable send-time
recipient set. If a recipient later leaves or is removed, that recipient is
dropped from the requirement without rewriting the original recipient set; an
empty remaining required set projects `read`, never an undelivered single tick.

Typing is intentionally not represented as durable message data. The current
provider-native declaration generator cannot emit first-class ephemeral
descriptors, so v8 uses an explicit bridge: live/coalesced
`observeTyping@1` plus `setTyping@1`, with the namespaced
`coterie.ephemeralOperations` extension declaring `durability: ephemeral`, no
offline retention, no history, a 2,000 ms appearance target, and a 5,000 ms
lease. Reasserting typing refreshes the lease; clearing, sending, leaving, or
removal clears it. The memory provider exposes a logical-clock advance hook so
tests and acceptance prove expiry without sleeping.

## Quoted replies and message reactions

Each message exposes `sm-convo-quote` inside its `sm-convo-bubble` when
`sendMessage` is claimed. Selecting it adds a sender/body preview above the
composer with a cancel action; the sent row retains the quoted message
identity, and projection resolves a short tombstone-safe preview so deleted
source text cannot leak. Pressing that quoted excerpt jumps to its source
bubble. The six starter quotes mirror
`benchmarks/fixtures/social-messenger/starter-m3.log` exactly.

When `setMessageReaction` is claimed, `sm-convo-react` opens the six
`sm-convo-reaction` choices. Aggregated `sm-convo-reaction-chip` controls show
the per-emoji count and whether the current session reacted. Selecting another
emoji replaces the current user's reaction; pressing the current user's chip
sets that emoji to `reacted: false`. Each intent carries a required mutation
identity: replaying one identity is a no-op even after another reaction, while
a distinct identity that repeats the current state remains idempotent. The
shared starter log contains no reaction actions, so
the deterministic fixture does not invent initial reactions.

## Profile avatar picker

The own-profile edit state shows `sm-profile-avatar-picker` and one
`sm-profile-avatar-*` choice per committed Alice-through-Henry persona ref
when `setAvatar` is claimed. Every option renders its thumbnail and exposes an
accessibility-selected current state. `src/data/avatar-refs.ts` is the sole
avatar-reference constant module consumed by both picker options and provider
admission; changing the vocabulary is one table edit. This picker is a
deliberate interim seam: Contract does not yet expose a portable file-input
primitive, so the UI cannot drive the Snapback adapter's arbitrary local-file
upload path directly.
`listProfiles@3` now carries the nullable originating `avatarRef` alongside
`avatarUrl`. The declaration/provider field is frozen and the picker selection
derives directly from it. The Snapback adapter maps the backend profile's
`avatarSourceDigest` back to the canonical committed source ref in the closed
fixture-ref vocabulary. Several picker aliases contain the same bytes, so a
digest cannot honestly recover which alias was selected; profiles without a
recognized source digest project `null`.

## Composer media picker

When `createPost` is claimed, the feed composer shows `sm-compose-attach` and
opens a fixture-media dialog. Its six image choices and one video choice come
from the same `COTERIE_IMAGE_URLS` and `COTERIE_VIDEO_URLS` maps the memory
provider validates: mutations receive exact `media/img-*.png` or
`media/vid-01.mp4` refs, while previews use the corresponding served
`/assets/fixtures/...` URLs. Selected items remain visible above the composer
and can each be removed before posting.

Selection mirrors `createPost@1`: up to four distinct images or one video,
never both. Choosing a video replaces selected images; choosing an image
replaces the video; a fifth image choice is disabled. Media-only posts are
allowed because the declared mutation rejects only an empty text-only post.
The fixture dialog is deliberate rather than an upload simulation: Contract
still has no portable file-input primitive, matching the profile avatar
picker's interim design. Providers that do not claim `createPost` render no
attach affordance, based only on `listProviderClaims@1` and never provider
identity.

## Claims-gated affordances

`listProviderClaims@1` reports provider-neutral operation names, kinds, and
compatibility tokens. Routes use those rows—not provider identity—to gate
every mutation affordance, including post and conversation composer inputs and
submits, feed like/repost controls, logout, profile edits/follows/avatars,
message quotes/reactions, and chat settings. An operation the selected adapter
has not qualified has no affordance at all; it is never rendered as a dead
button. Query-driven screens remain present and render their typed loading,
error, stale, empty, and ready states without query-claim gating. Memory
reports every declaration operation it implements. The Snapback adapter
derives its claim rows from the same M1+M2+M3-minus-typing allow-list used by
its refusal path, and tests require those two views to agree.
`observeTyping@1` and `setTyping@1` instead return
`SnapbackTypingPermissionBackingUnavailableError`, naming
`issues/20260817-ephemeral-membership-permission-backing.md`; this is an honest
unclaimed-platform-gap result, not a later-milestone refusal.

## Provider surface and v8 overlay

Declaration v8 extends the landed v7 quote/reaction surface recorded in
[`scripts/v7-declaration-delta.md`](./scripts/v7-declaration-delta.md) with the
frozen M3 messaging table above.
It inherits the frozen M1 account/session/profile/avatar seam:

- `listSession@2` and revised `listProfiles@3`
- `signup@2`, `login@1`, `logout@1`, `editProfile@1`, and `setAvatar@2`

V7 bumped `listMessages` and `sendMessage` to `@3` for their changed
quote/error shapes. V8 bumps both to `@4` for receipt/membership semantics and
bumps `listChats` to `@3`; it preserves `listProviderClaims@1` and extends the
M4 reaction shape to `setMessageReaction@2` because current membership is now
a declared precondition. Query tokens live in the core query objects; mutation
tokens live in the namespaced milestone compatibility-token extensions. The brief's M5
`searchSocial`, `setChatAccent`, and `setDisappearing` tokens live under
`coterie.m5CompatibilityTokens`, not the M3 namespace.

Exact's current declaration core carries compatibility tokens on queries but
not mutations. Mutation tokens are therefore recorded in the corresponding
namespaced `coterie.m1CompatibilityTokens` through
`coterie.m5CompatibilityTokens` declaration extensions; queries also carry
their tokens in the core query field.

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
The memory projection also updates live profile, feed, and search avatar
deliveries. A direct-chat row changes only when it displays that persona: in
Alice's `d-alice-bob` row Alice's own change leaves Bob's avatar untouched,
while Bob's change updates it; group-chat rows retain their M2 null-avatar
semantics. The landed v6 provider accepts all eight picker refs; the
pre-rebase v5 checkout used to accept only `media/avatar-alice.png` and
`media/avatar-bob.png`, which is why
the replay checklist includes an explicit eight-ref proof. Signup credentials,
active sessions, and revoked tokens exist only for the life of the provider
process. Logout moves the current token into an in-process revocation ledger;
restart resets everything. This is deterministic client/provider evidence,
not durable or server-authoritative auth evidence.

The pre-M2 declaration v5 digest was `df0562a779095d79`; the first M2 v6
generation was `0614938f8ff02c4e`. The corrected v6 surface in this tree is
`2b035e0c69068f02`. Replaying the v7 overlay produces the merged declaration
digest `61fcaaa7b60092b4`; the v8 messaging surface generates
`69a5aa9950796671`.
The Snapback adapter implements the frozen M1+M2 token sets and the M3 durable
messaging set without changing the shared declaration digest. Password signup/sign-in/logout use
Snapback's built-in password provider and `AuthCoordinator`; the session query
projects coordinator principal changes, while profiles use the generated
`getMyProfile`, `ensureMyProfile`, `editProfile`, streaming `listProfiles`, and
per-profile streaming `profileStats` references. Avatar changes upload through
`createAssetClient` and attach with `attachMyAvatar`. M2 feed, thread, profile-
post, and profile-stat reads all use stream transport with polling fallback
disabled. M3 chats and messages use the same stream-only posture; identity
joins complete before publication, and each declaration query consumes one
fully live backend window. There is no one-shot tail fetch or adapter archive:
membership, unread, quoted-message, and receipt changes remain live on every
row in the admitted product envelope.
Connection-only cells publish socket loss and recovery without counting as
profile-data revisions.

The product envelope is **1,000 conversations per profile** and **1,024
messages per conversation**. Those are complete live-result bounds, not page
sizes. `listChats` takes all 1,000 rows in one live window and `listMessages`
takes all 1,024 rows in one live window. Before any crossing write,
`createGroup`, a creating `openDm`, and `addMember` refuse with
`CHAT_ENVELOPE_EXCEEDED` when any newly enrolled participant already has 1,000
chats; `sendMessage` refuses with
`MESSAGE_ENVELOPE_EXCEEDED` when the conversation already has 1,024 messages.
The exact boundary succeeds, the next write changes nothing, and both
limitations surface through the adapter as `SnapbackProviderError`. Reusing an
existing DM at the chat boundary remains legal. `markReceipt` uses the same
1,024-required-message bound per membership incarnation before its single
atomic watermark update.

The operation map is deliberately app-owned and contains no seed machinery:

| Declaration operation | Snapback operation(s) |
| --- | --- |
| `listSession@2` | `AuthCoordinator` principal + `getMyProfile` |
| `listProfiles@3` | streaming `listProfiles` + one retained streaming `profileStats` per profile; `avatarSourceDigest` → fixture-vocabulary `avatarRef`, consumed directly by the picker UI |
| `listProviderClaims@1` | adapter-local frozen M1+M2+M3-minus-typing claim projection |
| `signup@2` | password signup + `ensureMyProfile` |
| `login@1` / `logout@1` | password sign-in / auth logout through `AuthCoordinator` |
| `editProfile@1` | `getMyProfile` + `editProfile` |
| `setAvatar@2` | `avatarUpload` + `attachMyAvatar` |
| `listFeed@3` | streaming `followingFeed` or `globalFeed` |
| `listThread@1` | streaming `thread` |
| `listProfilePosts@1` | profile identity join + streaming `profilePosts` |
| `createPost@1` | optional `postImageUpload` / `postVideoUpload` + `createPost` |
| `setFollow@1` | profile identity join + `setFollow` |
| `setLike@1` | `setLike` |
| `setRepost@2` | `setRepost` (including its declared reply refusal) |
| `listChats@3` | one 1,000-row fully live membership-scoped `listChats` window + backend-maintained per-incarnation unread count; `typingHint: null` |
| `listMessages@4` | one 1,024-row fully live membership-scoped `listMessages` window, quoted-message projection, required-viewer receipt and group receipt summary |
| `openDm@1` | atomic `openDm` result (`created` or `reused`) |
| `createGroup@1` | profile identity joins + `createGroup` |
| `addMember@1` / `removeMember@1` / `promoteAdmin@1` | profile identity join + matching backend membership mutation |
| `leaveChat@1` | `leaveChat` |
| `sendMessage@4` | `sendMessage`, including the optional quoted-message identity |
| `markReceipt@1` | one atomic `markReceiptsThrough` membership-watermark mutation |
| `observeTyping@1` / `setTyping@1` | deliberately unclaimed; membership-backed ephemeral permission ticket |
| `setMessageReaction@2` | unclaimed; the landed backend has no reaction operation/table (M4 surface) |

`ensureFixture*`, `getMyFixturePost`, and `getMyFixturePostMedia` are seed-
installer operations, never declaration mappings and never provider claims.

The adapter translates a declaration cursor
`{ v: 1, mode, sortAt, eventId }` to Snapback's backend `pageKey` by parsing
`sortAt` as the exact ISO millisecond timestamp and rebuilding
`<16-digit-ms>:<eventId>`. The millisecond value must be nonnegative and its
zero-padded decimal must be exactly 16 digits. On output the adapter splits
that same backend key and checks
the timestamp against `eventCreatedAt` before minting the base64url cursor.
Malformed, non-canonical, or cross-mode tokens become
`FeedCursorInvalidError`; the terminal short page carries `null`, while every
row in a full 20-row page carries the same next cursor.

This adapter claims **M1+M2+M3-minus-typing plus provider discovery only**.
Typing calls use the ticket-bearing unclaimed-platform-gap error described
above. Reactions and later milestone operations return
`SnapbackMilestoneUnsupportedError`; they never synthesize rows or acknowledge
a fake mutation. Snapback's error translation is an exact allow-list; prefix
families are deliberately not used:

| Operation | Exact Snapback diagnostic | Coterie error |
| --- | --- | --- |
| `signup` | `SNAPBACK_AUTH_PASSWORD_EXISTS` | `DuplicateEmailError` |
| `signup` | `SNAPBACK_AUTH_PASSWORD_POLICY` | `PasswordTooShortError` |
| `signup` | application `DUPLICATE_HANDLE` before password issuance | `DuplicateHandleError` |
| `signup` | application `DUPLICATE_HANDLE` after password issuance | `PartialRegistrationError` |
| `login` | `SNAPBACK_AUTH_CREDENTIAL_INVALID` (or locally malformed login input) | `InvalidCredentialsError` |
| `editProfile`, `setAvatar` | `SNAPBACK_AUTH_SESSION_EXPIRED`, `SNAPBACK_AUTH_SESSION_REVOKED` | `SessionRequiredError` |
| `setAvatar` | `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED`, `SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED` | `AvatarReferenceInvalidError` |
| `createPost`, `setFollow`, `setLike`, `setRepost` | application `PROFILE_REQUIRED`, or exact expired/revoked session diagnostics | `SessionRequiredError` |
| `createPost` | application `POST_BODY_TOO_LONG` | `PostBodyInvalidError` |
| `createPost` | application `POST_IMAGE_COUNT_INVALID` | `ImageCountInvalidError` |
| `createPost` | application `POST_MEDIA_MIXED` | `MediaMixInvalidError` |
| `createPost` | application `POST_KIND_MEDIA_MISMATCH`, `POST_KIND_INVALID` | `MediaReferenceInvalidError` |
| `createPost` | application `POST_PARENT_NOT_FOUND` | `ParentPostNotFoundError` |
| `createPost` upload | `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED`, `SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED` | `MediaReferenceInvalidError` |
| `setFollow` | application `PROFILE_NOT_FOUND` | `ProfileNotFoundError` |
| `setFollow` | application `SELF_FOLLOW_FORBIDDEN` | `SelfFollowInvalidError` |
| `setLike`, `setRepost` | application `POST_NOT_FOUND` | `PostNotFoundError` |
| `setRepost` | application `REPLY_REPOST_FORBIDDEN` | `ReplyRepostForbiddenError` |
| `openDm` | application `PROFILE_REQUIRED`, `PROFILE_NOT_FOUND`, `SELF_DM_FORBIDDEN` | `SessionRequiredError`, `ProfileNotFoundError`, `DirectMessageSelfError` |
| `createGroup` | application `PROFILE_REQUIRED`, `PROFILE_NOT_FOUND`, `GROUP_NAME_INVALID`, `GROUP_DESCRIPTION_TOO_LONG`, `GROUP_SIZE_INVALID` | `SessionRequiredError`, `ProfileNotFoundError`, `GroupNameInvalidError`, `GroupDescriptionInvalidError`, `GroupMembersInvalidError` |
| `addMember` | application `PROFILE_REQUIRED`, `PROFILE_NOT_FOUND`, `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED`, `NOT_GROUP_ADMIN`, `NOT_GROUP_CHAT`, `MEMBER_ALREADY_EXISTS`, `GROUP_MEMBER_LIMIT_REACHED` | `SessionRequiredError`, `ProfileNotFoundError`, `ChatNotFoundError`, `ChatAdminRequiredError`, `GroupRequiredError`, `ChatMemberAlreadyExistsError`, `ChatMemberLimitError` |
| `removeMember` | application `PROFILE_REQUIRED`, `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED`, `NOT_GROUP_ADMIN`, `NOT_GROUP_CHAT`, `MEMBER_NOT_FOUND`, `REMOVE_SELF_WITH_LEAVE` | `SessionRequiredError`, `ChatNotFoundError`, `ChatAdminRequiredError`, `GroupRequiredError`, `ChatMemberNotFoundError`, `RemoveSelfInvalidError` |
| `promoteAdmin` | application `PROFILE_REQUIRED`, `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED`, `NOT_GROUP_ADMIN`, `NOT_GROUP_CHAT`, `MEMBER_NOT_FOUND` | `SessionRequiredError`, `ChatNotFoundError`, `ChatAdminRequiredError`, `GroupRequiredError`, `ChatMemberNotFoundError` |
| `leaveChat` | application `PROFILE_REQUIRED`, `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED`, `NOT_GROUP_CHAT` | `SessionRequiredError`, `ChatNotFoundError`, `ChatMembershipRequiredError`, `GroupRequiredError` |
| `sendMessage` | application `PROFILE_REQUIRED`, `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED`, `MESSAGE_BODY_REQUIRED`, `MESSAGE_BODY_TOO_LONG`, `QUOTED_MESSAGE_NOT_FOUND` | `SessionRequiredError`, `ChatNotFoundError`, `ChatMembershipRequiredError`, `MessageBodyInvalidError`, `QuotedMessageInvalidError` |
| `listMessages`, `markReceipt` | application `CHAT_NOT_FOUND`, `CHAT_MEMBERSHIP_REQUIRED` (and `PROFILE_REQUIRED` for the mutation) | `ChatNotFoundError`, `ChatMembershipRequiredError` (and `SessionRequiredError`) |

Local avatar URL/fetch/body-read/signature failures use
`AvatarReferenceInvalidError`; equivalent committed-post-media failures use
`MediaReferenceInvalidError`. The backend owns the immutable-`parentId` reply
check and emits `REPLY_REPOST_FORBIDDEN`; the adapter maps that exact code and
does not read the bounded thread projection before reposting. `PROFILE_NOT_OWNED`,
`THREAD_REPLY_LIMIT_EXCEEDED`, `CHAT_ENVELOPE_EXCEEDED`,
`MESSAGE_ENVELOPE_EXCEEDED`, `RECEIPT_ENVELOPE_EXCEEDED`, and every unlisted backend
diagnostic surface as `SnapbackProviderError`; provider faults never
masquerade as declared user recovery errors.

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

In another terminal, use the printed URL. The M3 seed command is idempotent;
it composes `seed-m2.mjs`, then installs the conversations, membership
incarnations, quoted messages, and receipt rows. The lower seed composes
`seed-m1.mjs` and installs the personas, post media, follow graph,
posts/replies, likes, and attributed reposts. The acceptance runner
invokes that same installer itself, so the explicit seed is needed for
interactive development but does not have to precede acceptance:

```bash
export COTERIE_SNAPBACK_URL=http://127.0.0.1:<printed-port>
node demos/coterie/snapback/seed-m3.mjs --url "$COTERIE_SNAPBACK_URL"

cd demos/coterie
COTERIE_PROVIDER=snapback bun run dev
```

### M3 schema transition: DESTRUCTIVE-WITH-RESEED

The M3 backend adds the required `conversations.chatPageKey` field plus five
required `conversationMembers` projections: `chatPageKey`, `unreadCount`,
`receiptCount`, `deliveredThroughSequence`, and `readThroughSequence`. Coterie
has no populated production store: the dev lane is disposable and the
acceptance stores are memory or test scratch. Following the disposable-data
path in `guide/backend/migrations.md`, this transition is declared
**DESTRUCTIVE-WITH-RESEED** rather than presented as a preservation migration.

Delete only the disposable Coterie dev database named by the `--db` argument,
start the current schema, then run `seed-m3.mjs`; it composes `seed-m2.mjs`,
which composes `seed-m1.mjs`. If any store later contains data that must be
preserved, this declaration no longer applies: use the reviewed `snapback
migrate` loop with explicit required-field backfills before activating the
schema.

The shared headless provider-proof runner selects steps from
`listProviderClaims@1`. The Snapback lane runs its 14 claimed M1+M2+M3
binding steps across both `provider-boot` and `injected-signed-out`; the one
typing step per scenario is recorded as `skipped-by-claim`, not attempted or
counted as proof.

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

`accept:coterie` is the parameterized headless binding-level provider proof. It
boots the selected provider through the same generated bindings as the app,
loads Alice from the shared persona fixture, and checks that every step's
declared `sm-*` identifier belongs to the frozen
`benchmarks/tools/social-messenger/CONTRACT.md` vocabulary. It does not mount or
drive those controls. Provider claims select the steps: unclaimed milestone
operations are written to the artifact as `skipped-by-claim`. The runner
accepts either a boot session that it revokes or an already-empty session list
as the same signed-out precondition. It then proves login
returns and delivers a new session token, runs profile edit → observable
generated-query invalidation, creates a text post and observes it in Global,
follows Dave and observes his existing originals enter Following, toggles a
like on then off with both states observable, then runs the M3 chain: reopen a
deduplicated DM, send text, send and resolve a quoted reply, observe
`sent → delivered → read` without regression, observe and expire a typing
lease, and create a group where a non-admin removal is refused before the
creator removes the member. Memory uses its optional clock-advance capability;
other qualifying providers are observed through the same public expiry
projection. It finally proves logout revokes the exact last Alice token.
Tokens stay local to the runner for comparison; the JSON artifact records only
boolean token receipts, and a partial failure triggers best-effort session
revocation before provider disposal. Both providers run the `provider-boot`
and `injected-signed-out` scenarios. The Snapback M1+M2+M3-minus-typing lane requires its
configured server and streaming socket and installs fixtures through
`seed-m3.mjs`. The runner reuses the shared assertion aggregator and writes
the artifact under the ignored `.data/acceptance/` directory, printing the
absolute path. The artifact mechanism is
`headless-generated-binding-provider-proof`: it proves only the claimed
provider operations exercised through generated bindings over the frozen
selector vocabulary. Mounted Contract semantics, two-client choreography,
sender-avatar and quote-jump UI behavior, group dropout choreography, and
removed-member route rendering live in the integration tests and the separate
post-landing choreography program; this artifact makes none of those claims.

`test:snapback-provider` starts and tears down an isolated Snapback server and
runs Exact provider conformance with formal probes for M1
`listProfiles@3`+`editProfile@1`, M2 `listFeed@3`+`createPost@1`, and M3
`listMessages@4`+`sendMessage@4`. The suite
has no milestone selector, so those are the exact formal pairs rather than a
claim that it individually invokes the whole allow-list. Adapter-specific
probes additionally cover: two-client pushed profile edits; client B observing
client A's post creation and like-count change with polling disabled; client B
observing client A's message send and its own receipt transition through one
stream-only `listMessages` handle; the M3 membership mutation matrix; live
profile counts; feed/profile/thread projection; post-media upload; repost
attribution and reply refusal; post-signup author/reposter identity hydration
without a profile subscription; exact image/video/avatar rendition delivery;
fixture and non-fixture identity joins;
malformed-login and exact
password-byte round trips; exact and unknown diagnostic mapping; post-adoption
login/signup rollback; logout transport failure and post-revocation response
loss; a forced duplicate-handle interleaving plus incomplete-profile recovery;
avatar byte sniffing, truncated bodies, attach refusal, and digest reuse; slow
profile-stream failure; later-milestone refusals; and stream disconnect/recovery cells
with polling disabled. A paved two-browser-context Coterie harness does not
exist yet, so that stronger LLP 0266 D10 evidence remains outside this lane.

Run the completed memory lane with:

```bash
COTERIE_PROVIDER=memory bun run accept:coterie
```

Additional providers select the same runner with the same boot variable.

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
