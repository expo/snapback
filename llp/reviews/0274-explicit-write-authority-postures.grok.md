# Review: LLP 0274 — Explicit write-authority postures (round 1)

**Reviewer:** Grok (grok-4.6, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 1 — full blind review of the initial Draft
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

I'll run an adversarial design review of LLP 0274 against the governing specs and the code it claims to extend. First I'll load the review skill and the documents in scope.This is a design review of the Draft spec against governing docs and the current code, not a git-diff review. I'll load the sibling specs and the implementation they claim to extend.I'll pull the governing D5/D6/0065 sections and the live write-policy, governance, and runtime seams in parallel.I'll read the write-policy IR, the D5 governance comparator, and the runtime dispatcher next, and fan out on the demos in parallel.I'll gather the write-policy implementation across storage, runtime, manifest, and codegen so the report can cite the current Phase 1a seams preciselyI'll. inventory the five Snapback demos' schemas, generic writes, and auth/write policies from the actual files.Next I’ll read each demo’s schema, functions, and generated write-policy artifacts.Next I’ll read the dispatcher, HostPlan preflight, buffered-write seam, and runtime/codegen write-policy surfaces.I have the dispatcher and HostPlan preflight; next I’ll read runtime insert/patch/delete, codegen write-policy, and unique-disclosure handling.I’ll pull write-policy checks, graffiti rendering, and default auth on mutations next.# Actual write behavior of the five Snapback demos

None of these demos use `insert-each` or `delete-where`. Every generic write is `insert`, `patch`, or `delete` (by id). Generated `writePolicyChecks` never list unique constraints as needing `discloseUniqueConflicts` (`kind` is `not-applicable` or `owner-partitioned` with empty `constraints`). Schema uniques that *would* collide on insert are called out under H.

---

## 1. `demos/campfire`

### A. Schema tables

From [`/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/campfire/snapback/schema.mjs`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/campfire/snapback/schema.mjs):

| Table | Visibility | Owner field | Unique | Membership |
|---|---|---|---|---|
| `rooms` | `public-read` (14–16) | none | none | none |
| `messages` | `public-read` (17–25) | none | `by_room_sequence` on `[roomId, sequence]` (24) | none |
| `reactions` | `public-read` (26–36) | none | `by_message_emoji_user` on `[messageId, emoji, userKey]` (35) | none |

`authorizationTables: []` in generated review. Auth mode is `sessions` (38–43). Comments say functions stay public with no membership model (1–4, 39–42); generated ops are **not** `public`.

### B. Generic writes

All JS handlers (`defineJsMutation`), surface `ctx-db`. No HostPlans for writes.

**`sendMessage`** ([functions.mjs](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/campfire/snapback/functions.mjs) 104–140; review 346, 652):
- `insert` `messages` `{ roomId, sequence, author, body }` (133–138)
- `sequence` = max existing + 1, server-computed (129–132)
- `author` and `body` are **caller-supplied args** (107–108, 117–120) — **not** `authUserId()`
- `rooms` is read-only here; rooms come from seed

**`toggleReaction`** (143–179; review 429, 609, 695):
- `delete` `reactions` by existing `_id` if same `(emoji, userKey)` (168–170)
- else `insert` `reactions` `{ roomId, messageId, emoji, userKey }` (172–177)
- `userKey` and `emoji` are **caller-supplied** (147–148) — not auth-stamped

No `patch`. No writes to `rooms`.

### F. Authority tables generically written

None. All tables `authorityTableClass: "ordinary"`; write posture on every table is insert/patch/delete/`insert-each`/`delete-where` = `refused` (review 505–516, 542–553, 579–590). Generic writes are `genericWriteDisposition: "migration-pending"`.

### G. Auth on mutating ops

Generated review: both mutations `authRequirement.value: "optional-user"`, `origin: "legacy-default"` (285–288, 368–371). Source does not set `auth`. Schema comments claim public (39–42); generated review does not.

### H. Unique / `discloseUniqueConflicts`

- `messages.by_room_sequence` — `sendMessage` insert can race on `(roomId, sequence)`
- `reactions.by_message_emoji_user` — `toggleReaction` find-then-insert can race

Generated `uniqueConflictDisposition` for all three write sites: `{ constraints: [], kind: "not-applicable" }` (633–636, 676–679, 719–722). **No current `discloseUniqueConflicts` requirement in the review.** Those uniques would need disclosure if public-read write posture ever left `migration-pending`.

---

## 2. `demos/chirp`

### A. Schema tables

From [`schema.mjs`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/chirp/snapback/schema.mjs):

| Table | Visibility | Owner | Unique | Membership |
|---|---|---|---|---|
| `profiles` | `public-read` (3–10) | none | `by_handle` on `[handle]` (10) | none |
| `posts` | `public-read` (12–20) | none | none | none |
| `likes` | `public-read` (22–26) | none | `by_post_user` on `[postId, userHandle]` (26) | none |

`authorizationTables: []`. `authMode: "dev"`.

### B. Generic writes

JS handlers only.

**`createPost`** ([functions.mjs](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/chirp/snapback/functions.mjs) 49–62; review 59, 570, 742):
- `insert` `posts` `{ authorHandle, body, createdAt: ctx.runtime.now(), replyToId, likeCount: 0, replyCount: 0 }` (56)
- `authorHandle` is **caller-supplied** (50) — not `authUserId()`
- if `replyToId`: `patch` parent `posts` `{ replyCount: parent.replyCount + 1 }` (57–59)

**`toggleLike`** (65–82; review 612, 656, 699, 785):
- if existing: `delete` `likes` by `_id` (74); `patch` `posts` `{ likeCount }` (75)
- else: `insert` `likes` **`args` whole** (`{ postId, userHandle }`) (79); `patch` `posts` `{ likeCount }` (80)
- `userHandle` is **caller-supplied** (66)

No writes to `profiles`.

### F. Authority tables

None. All ordinary / public-read / write posture `refused` / sites `migration-pending`.

### G. Auth

Both mutations `optional-user` / `legacy-default` (review 11–13, 80–82). Source does not set `auth`.

### H. Unique / disclose

- `likes.by_post_user` — `toggleLike` insert can race
- `profiles.by_handle` — unused by mutations

All write-site `uniqueConflictDisposition.kind: "not-applicable"` (empty constraints). No generated disclose requirement.

---

## 3. `demos/graffiti`

### A. Schema tables

From [`schema.mjs`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/snapback/schema.mjs):

| Table / collection | Visibility | Owner | Unique | Membership |
|---|---|---|---|---|
| `cells` | `public-read` (30–41) | none | **none** — `by_board` on `[boardId]` is not unique (39) | none |
| `boardCursors` (ephemeral) | publish/subscribe `allow.roomPermission('boardMember')` (63–65) | n/a | connection-keyed latest map | room permission, not a membership table |

`authorizationTables: []`. `authMode: "dev"`.

### B. Generic writes

**Only HostPlan write:** `paintCell` (`defineMutation` + `insert(...)`) in [functions.mjs](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/snapback/functions.mjs) 53–72; review 107, 184–226.

- Form: **`insert` only** — not patch, not upsert
- Table: `cells`
- Fields: `boardId`, `x`, `y`, `color` from args; **`authorId: authUserId()`** (67)
- `boardId`/`x`/`y`/`color` are caller-supplied; `authorId` is **host-stamped from auth**, not an arg
- Review: `writeForm: "insert"`, `surface: "host-plan"`, `genericWriteDisposition: "migration-pending"`, `ownerField: null`

No `ctx.db` writes. Ephemeral cursor publish is not a durable generic write.

### C. paintCell append-only vs overwrite

**Append-only new insert.** Comments state HostPlan has no upsert-by-coordinate; rows only grow (functions.mjs 3–8; schema.mjs 4–6).

**Stamps `authorId`** via `authUserId()` (67). Headless test: painted row `authorId === ADA` ([headless.mjs](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/tests/acceptance/headless.mjs) 103–105).

**Logical overwrite: yes, without deleting the prior row.** Another user paints the same `(x,y)`; both rows remain; renderer last-writer-wins. Test: Ada then Grace at (1,1) → two stacked marks, newest color wins (127–135).

**Rendering:**
- Contract [`data.ts`](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/surfaces/contract/data.ts) 52–70: `listCells` is oldest-first (`asc('_createdAt')`, functions.mjs 44); forward pass leaves newest color per cell. Does **not** consult `authorId`.
- Widget [`render.mjs`](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/surfaces/widget/render.mjs) 36–49: same LWW, newest `_createdAt` (ties: later row).
- Erase = paint `EMPTY_COLOR` (`#f1f1f4`) as another append ([board.mjs](file:///private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/surfaces/contract/board.mjs) 14, 28).

### F. Authority tables

None. `cells` ordinary / public-read / all write forms `refused` (review 166–177).

### G. Auth

- `listCells`: `auth: 'public'` explicit (functions.mjs 46; review 11–13)
- `paintCell`: **`optional-user` / `legacy-default`** (review 72–75) because `authUserId()` is in the plan (`authorizationInputs: ["authUserId"]`, 81–83). No `auth:` on the mutation.

### H. Unique / disclose

No unique index on `cells`. Review `uniqueConflictDisposition.kind: "not-applicable"`. **Nothing to disclose.**

---

## 4. `demos/messaging-snapback`

### A. Schema tables

From [`schema.mjs`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/messaging-snapback/snapback/schema.mjs):

| Table | Visibility | Owner | Unique | Membership / permissionBacking |
|---|---|---|---|---|
| `users` | `public-read` (19–24) | none | `by_handle` `[handle]` (24) | none |
| `conversations` | `public-read` (26–42) | none | none (`by_updated` on `lastMessageAt`) | none — `memberHandles` is denormalized JSON, **not** a membership declaration |
| `conversationMembers` | `public-read` (44–52) | none | `by_conversation_user` `[conversationId, userHandle]` (52) | **not** `.membership()` — ordinary public rows |
| `messages` | `public-read` (54–67) + `assetSharing: public-read` (67) | none | none | none |
| `reactions` | `public-read` (69–79) | none | `by_message_user_emoji` `[messageId, userHandle, emoji]` (79) | none |
| `viewOnceMessages` | `public-read` (81–93) | none | none | none |
| `viewOnceConsumptions` | `public-read` (95–103) | none | `by_message_principal` `[viewOnceMessageId, principal]` (103) | none |
| `typing` (ephemeral) | `allow.all()` publish/subscribe (131–132) | n/a | connection-keyed | none |

`authorizationTables: []`. `authMode: "dev"`. Schema comments: interactive surface is client-asserted personas; view-once derives principals from auth (4–8).

### B. Generic writes (JS handlers; no HostPlan mutations)

**`sendMessage## Phase 1a write-policy`** (277–313; as shipped review 642 (attack, 157 surface for LLP4, 1617 0274)

**Governing) split:** codegen — `optional-user`: `writePosture` already treats
- `insert` ` every nonmessages` `{ conversationId,-owner ordinary authorHandle, authorName, table as **all body, replyToId?,- image?, createdAt }` (forms `refused`**,295–305 while the)
- `authorHandle` **runtime dispatcher still / `authorName` ** passcaller-supplied** (280-throughs** declared non-owner tables via–281)
 `Ok(None)`. That- `image` via is the Phase `ctx.assets.attach 1a migration` if ` window, not anassetId`
 Open posture.

---- `patch

### 1. `` `conversations` `{ lastgeneric_owner_write_field` — dispatcherMessageText, lastMessageAuthor, SomeName, lastMessageAt }` ( /306 None /–310 Err

```180)

94:**181`39send:src/storage.rs
///ViewOnce`** (315 Resolve the one installed table-–356; reviewpolicy locus for a generic write 712. ...
///, 1316 Phase 1a returns `, 1488) —None` only for the declared- **non-owner migration window;
/// authority tables and omissionauthenticated**:
- `insert still refuse here, while `` `viewOnceMessages` `{ conversationId, authorPrincipalSome(field)` enters
/// the complete owner enforcement path.
pub(crate) fn: ctx.auth.user generic_owner_write_field<'a>(
   Id, asset, grants: table: &'a TableManifest {}, caption, createdAt }`,
    form: GenericTable (339–346)
WriteFormV1,
) -> SnapbackResult<- `authorPrincipal` **Option<&'a str>> {
auth-stamped** (    if table.membership.is_some() || table.328,permission_backing {
        let 341)
- then _ = form;
        return Ok `(ctxNone.);
assets   . }
grant    match table.visibility.(...,as_ref() {
        Some {( stateTable:Visibility 'Vpending1'::Owner { field }) => })` per recipient
 Ok(Some(field)),- `patch` `view
        Some(
            TableOnceMessages` `{ grants }`VisibilityV1::PublicRead
            | TableVisibilityV map1::Membership { .. }
 recipient            | TableVisibilityV1 → grant::AnyOf { .. },
        ) => Ok(Id (352None),
        None =>–353)
 Err(SnapbackError::- `recipients` callererror(
            "SNAPBACK_TABLE_WRITE_UN-supplied (319DECLARED_REFUSED",)

**`openViewOnce
            ...
        )),`** (358–396
    }
}
```

|; review 566,  Return1359) — **authenticated | Meaning | Enforcement**:
- `insert` that `viewOnceConsumptions` follows |
|---|---|---| `{ viewOnceMessageId,
| ** principal: ctx.auth.`Ok(Some(field))userId, openedAt }` (388–392`** | Ordinary)
- `principal` ** owner table. |auth-stamped** ( Full owner path:366, 390 host-stamp insert)
- then `ctx., refuse ownerassets input.,activate im(grantIdmutability, old-row)` — not a table check, delete write

**`closeView-where owner filter. `Once`** (398–form` is unused except426; review  in59, 1918) error details. |
| ** — **authenticated**:
-`Ok(None)` — looks up caller declared non-owner** | Phase in `gr 1a **migrationants` via-pending pass-through**. | `ctx. Callauth.userId` (ers skip owner enforcement and406–414 run the **)
- `ctx.assetspre-0264 generic.revoke(grantId)` write**. |
| **`Ok(None
- `patch` `view)`Once —Messages authority`** `{ | grants Membership or ` }` with **permission_backing`.that principal | Same `’s entryNone` type removed** (415. **–423)
Owner- Does **not** insert path is/ notdelete entered.** Specialized seams are consum supposed to refuse.ptions

**` |
| **`Err(deleteViewOnceForEveryone`SNAPBACK_TABLE_WRITE** (428–460_UNDECLARED_REF; review 344, USED)`** | No installed visibility. | Fail1402, 1531-closed.) — **authenticated**:
 |

Tests- refuses lock this contract unless `message for.authorPrincipal === ctx. every form (`insertauth.userId` (`,440–442 `insert-each`, `)
- revokespatch`, `delete`, `delete-where`):

``` remaining grants
- loop `delete` `viewOnce528Consumptions` by `_id:566` (454:src/storage/tests–456.rs
fn)
- `delete` ` every_generic_form_viewOnceMessages` by iduses_the_phase_ (457)

**`toggle1a_policy_dispatchReaction`** (462–() {
    // owner ->493; review 884, Some("ownerId")
    //  public144-5read ->, 183 None  ("pres2) — `optionalerves pre-0264 runtime-user`:
- ` behavior")
    // undedelete` existingclared -> SNAP `reactions` or `BACK_TABLE_WRITE_insert` `{ messageIdUNDECLARED_REFUSED, userHandle, emoji,
    // permission_backing -> None  ("bypass createdAt }` (481 owner enforcement; the specialized seam–490 refuses")
}
```

)
- `userHandle`**` **caller-supplied** (form` is not a465)

**`startDirectMessage`** (495 policy input–538; review 800.** All five forms share one, 1746, 1789, 187 visibility/5) — `optional-authority branch.

####user`:
- may Callers (every return existing DM ( `Some`no write)
- vs `None` is else `insert` `conversations a fail-open hinge` `{ kind: 'dm)

| Site | File |', title: '', memberHandles If: [selfHandle `,Some otherHandle], lastMessage` | If `None`Text, lastMessageAuthorName |
|---|---|---|---|: '',
| HostPlan preflight lastMessageAt, created | `src/storage.rsAt: }`308 (8525`–533 | Owner input)
- `insert` ` / imconversationMembers` `{ conversationIdmutability / require, userHandle: selfHandle sealed `, joinedAt }` (534ownerWriteCheck` on Patch)
- `insert` `/Delete | **NoconversationMembers` `{ conversationId ownerWrite, userHandle: otherHandleCheck; insert/delete-where unrestricted, joinedAt }` (535 by)
- all handles owner** |
| **caller-supplied** ( Owner-check497–500 resolution | `)

**`createGroup`** (540–570;src/storage.rs:327 review5 `257 |, Physical 166 old-row check0, 170 | **Hard3) — `optional- error** `owneruser`:
- `insertWriteChecks cannot bind a migration` `conversations` `{ kind-pending non-owner table: 'group', title,` |
| HostPlan Insert memberHandles: [ | `src/storage.rscreatorHandle, ...others:3389` | Stamp], lastMessageText, `auth lastMessageAuthorName: '',.userId`; require lastMessageAt, principal | **No stamp created;At caller }` values ( kept556–** |
| HostPlan Patch564)
- loop `insert | `src/storage.rs` `conversationMembers` `{:3469` | Rec conversationId, userHandle,heck physical joinedAt }` (565 old owner– |567 **Patch)
- `creatorHandle` / ` any physical row** |
|memberHandles` **caller HostPlan Delete | `src-supplied** (543/storage.rs:3557` | Recheck physical–545)

 old owner | **Delete anyNo generic writes physical row** |
| Host to `users`.

Plan DeleteWhere | `src### E. View/storage.rs:3899`- |once grants Scan, closeViewOnce, membership `table_ inserts, clientvisibility: Owner` | **`table_visibility: None-asserted handles

**` = unGrfiltered scan** |
| HostPlan InsertEach | `srcants map:** `viewOnceMessages.grants` is/storage.rs:3996` JSON “ | Stamp principal | **No stamprecipient principal → live grantId** |
| Buffered commit” (schema stamp | `src/storage.rs:4729` | Stamp 87–88 insert / refuse owner input /). Created empty then patched after `ctx.assets.grant(..., { state im: 'pending' })` (343mutability | **No stamp, no input–353). Owner refusal-visible bookkeeping;** |
| Buffered Patch asset policy apply is `read | `src/storage.rs: 'owner-only:4854` | Soft no-op if physical'` + `gr owner mismatch | **Applyants: true` (265 if row–274).

 exists physically**`** |
| Buffered Delete applycloseViewOnce`:** authenticated | `src/storage.rs; refuse:4924` | Soft `VIEW no-op if physical owner_ONCE_NOT_REC mismatch | **Delete if rowIPIENT` if caller not exists physically** |
| JS in map; revoke early gate | `src/ that grantruntime.rs:5112`; patch map via `installed_owner_write_field` | Insert without that principal (398 refuses owner field +–425). missing Comment principal; patch refuses: revoke + owner mutate clear id | **No owner input so check** later author |

`form delete-for-everyone does` is discarded not stage unknown- for authority tables (`let _ = formgrant (419–421`).

).

**Conversation membership inserts:** not a---

### 2. HostPlan preflight (`~ membership table. `startDirect3060`) andMessage` inserts two `ownerWriteCheck`

 `conversationMembers` rowsGeneric for forms are asserted classified first (` handles (5343060–307–535).5`), `createGroup` inserts one then:

```307 per handle6:320 including6:src/storage.rs creator (565
if–567). Unique table.membership.is_some on `(() {
    return Err(conversationId, userHandle)`.membership_hostplan_write

**Client-asserted_denied(target));
 handles:** identity is}
if let Some(owner UI persona_field) = generic_, “owner_write_field(an argument on every call, not atable, form)? {
    real session” ([identity. // Inserttsx](file:///private / InsertEach/tmp/claude-501: owner value/-Users-ccheever must be omitted or AuthUser-projects-snapback/Id
    // Patch:b6c9f681 owner field forbidden-3da6-45dd-8d7c; id-ca12e936a must be owner76b/scratchpad/_write_check_prewt-llp/demos/flight_safe
messaging-snapback/src    // Delete: id must/lib/identity.tsx) 1–4 be preflight-safe
). `    // DeleteWhere / nonsendMessage.-writes: no ownerauthorHandle`/`authorNameWrite`, `toggleReaction.userHandle`, `startDirectMessageCheck
}
// every.selfHandle`/`otherHandle`, `createGroup.creatorHandle owner-policy Patch/Delete needs exactly one sealed ownerWriteCheck
// digest`/`memberHandles of` are all refuse bytes must args. View match
```

**Requirements-once path is**

- the exception: `author **OwnerPrincipal` / consumption Patch/Delete:** exactly one `ownerWriteCheck` `principal` / grant lookup use `ctx.auth.userId`.

### bound F. to Authority that tables step

; targetNone. All id must be resol ordinaryvable before plan bindings (` / public-read / writeowner_write_check_ posture `refused` / sitespreflight_safe`).
 `migration-pending`.

- **Owner### G. Auth on mutating Insert / ops

| Op | Generated InsertEach:** no ` auth |ownerWriteCheck`. Owner input Origin | omitted or Source `auth` `AuthUserId` ( |
|---|---|---|---|compatibility marker only;
| `sendMessage txn` | `optional-user rest` | legacy-default (amps).
- **Owner588–590 DeleteWhere:** no `) | unsetownerWriteCheck`. Filter |
| `toggleReaction` | `optional-user` is the authority (` |owner legacy-default (823–825-filtered`).
- **Non-owner) | unset |
| `startDirectMessage` | ` (`optional-user` | legacyNone`):**-default (733–735 **) | unset |
| `no** `ownerWritecreateGroup` | `optionalCheck` allowed-user` | legacy- laterdefault (218–220 (`3275–) | unset |
| `3285sendViewOnce` | `` errorsauthenticated` | explicit (664 if one–667 is bound). Insert) | `'/delete-authenticated'` (322where/patch) |
| `openView/delete proceed withoutOnce` | `authenticated` owner machinery | explicit (505–508.
- **Membership) | `'authenticated'` ( tables:** refused360) |
| `close **before** the dispatcher (`View308Once` | `authenticated` | explicit (11–5–3087`), `14) | `'authenticated'` (400) |
| `SNAPBACK_MEMBERSHIP_deleteViewOnceForEveryone`HOSTPLAN_WRITE_DENIED | `authenticated` | (`.
- **`permissionsame_backing` without pattern; membership:** ** source 430not** refused) | `'authenticated'` |
 here. Dispatcher| `messageImageUpload` returns `None` → | `public` | explicit HostPlan generic write is ** (248–not** owner250) | owner-blocked. Code still `gen stillctx.auth.userId refuses with` (259) `SNAPBACK_TABLE_ |
| `viewOnceImageWRITE_AUTHORITY_TABLEUpload` | `authenticated`_INELIGIBLE`. | (267 Runtime) | owner `ctx. Hostauth.userId` (Plan is a hole274) |

### H. if a hand-authored plan Unique / disclose

Uniques targets that such generic inserts can hit:
- `conversation a table.
- **MediaMembers.by_conversation_ collection child tables:** refused (`user` — DM3040/group member–3057 inserts
- `reactions.`).

Preby_message_user_flight then resolves everyemoji` — ` sealed check againsttoggleReaction` insert
- the **physical** row (`get `viewOnceConsumptions._document_from_txby_message_principal``, `329 — `openViewOnce`8`) and `owner_row_matches`. insert (handler also Miss refuses `VIEW or not_ONCE_ALREADY_-owned:CONSUMED` first)
- declared `users.by_handle refusal **or** identical` — unused by mutations-absent (`owner_absent

All 15 write_targets`). Later Get-site dispositions/Guard/return are `not see absence-applicable` / empty constraints, not the foreign. **No generated row (`3651–365 disclose requirement.** Those7`).

--- three

### 3. Buffered insert write seam (`apply_buffered_writes* uniques would need`, it if posture ` left `~migration-pending`.

---

##4716`)

`apply_buffered_writes` is 5. `demos/ a thin wrapper (`team-chat`

### Asrc/storage/mutation_writes.rs:599`) into `apply_buffered_writes_with_lifecycle_gated` (`src/storage.rs:4535`).

Owner re-check. Schema tables

From [`schema.mjs`](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45 is **inside thedd-8d7c committing-ca12e936a76b/scratchpad/ txn**, only forwt-llp/demos/ `MembershipWriteGate::Denyteam-chat/snapback` (raw/schema.mjs):

 `ctx.db`,| Table | Visibility | Owner not sanctioned membership plans field | Unique | Membership /):

```4717: permission477Backing |
|---|---|5:src---|---|---|
| `/storage.rs
// rerooms` | `-resolve installed policy below everymembership` via `roomMembers`, ` buffered producer
if let Some(owner_resourceField: '_id'field) = generic_owner`, roles `owner`/`_write_field(tablemember` (34–45) | none | none |, form)? { ... stamp audience / refuse of ` input / imroomMembers` |
| `mutability }
```roomMembers` | `owner

Then on` on `user apply:

```4852Id` (11–15:4935:src/storage.rs
) | `userId` | none declaredlet before = get_document_from_tx(...)?; | **`.  // PHYSICALmembership({ id: 'roomMembers', ... })` (
if write15–32)** —_gate == Deny {
    private if let Some(owner_ authorization backing.field) = generic_owner_write_field(...)? {
        if !owner_ Roles `owner`/`member`,row_matches(before, pending `invited`, bootstrap owner_field, principal `owner`, `last) { continue; }  // softHolder.protect: 'owner'`, `principalAddressed no-op
    }
Writes.remove}
```

**Physical vs visibility**

- Commit: true`, provenance owner check uses **`get_document_from_tx`** (`156 `full`. Transitions: owner insert other→`invited`; self setRole invited→member72–15692; self remove invited`): `SELECT * FROM t/member; owner remove other WHERE _id = ?` |
| ` — **roomParticipants` | `anyphysical existence**, no visibility-of` owner SQL(`userId.
- **`)` **Noneor`** membership on `roomId` owner owner field:**/ nomember owner ( re47–69-check. Patch) | `userId`/delete apply if the on owner arm | physical ` row exists.
- JS early gateby_room_user` may `[roomId, userId have refused]` (68) | ** bufferingdisplay/fan-out only an invisible row;**, “ **commit doesnever a permission oracle” ( not re-evaluate membership/public-schema 5–7read/any-of visibility**.
- Buffered) |
| `messages` forms are | membership on only Insert/Patch/Delete (no `roomId` owner delete/-memberwhere ().70
- Sanction–85ed membership writes skip) | none | `by this owner block entirely_room (`471_page_key7`).

---

` `[roomId, page### 4. RuntimeKey]` (84) | JS `ctx audience.db` gate (`installed of `roomMembers` |
_owner_write_field| `deliveries` |` ~5112)

```509 `owner` on `recipient5:5112:srcId` (86–101/runtime.rs
/// The storage) | `recipientId` transaction repeats this check, so | `by_recipient_page_key` `[recipient this is an early
///Id, pageKey]` ( diagnostic/side-effect fence98); `by_message rather than trusted authority.
fn_recipient` `[messageId installed_owner_write_, recipientId]` (100field(...) -> Snapback) | none |

GeneratedResult<Option<String>> {
    generic_owner_ `authorizationTables`:write_field(table, only `roomMembers` kind form).map(|field| field `.mapmembership(`str (::reviewto 5–76_owned))
}
```

**Insert). Write posture:
 (`- `deliver3478–3524ies`: ordinary, owner-write admitted (`insert`/`insert-each` `owner-host-stamped`, `patch`/`delete` `owner-old-row-checked`)**  
If `Some`: refuse owner field in values (`SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED`); require `auth.userId` (`SNAPBACK_AUTH_USER_MISSING`); do **not** stamp in`, `delete-where` the handler (commit `owner-filtered`) (1577–158 stamps).  
8)
- `messagesIf `None`: any`, `rooms`, values accepted ( `roomParticipants`: ordinaryowner field may, **all generic be caller forms `refused`-authored).

**Patch** (1634 (`3526–3574–1645`), 1738 / Delete (`3576––17493600`)**  
Owner im, 1795mutability only if `Some–1806`. Existence is **)
- `roomMembers`:`effective_ **`authorityTableClass:point_is_visible` "membership"`**, all**, not physical:

```355 generic forms `refused`1: (1672–3574:1683)

### Bsrc/runtime.rs
let. Generic writes vs membership (stored, visibility, storage API_visible) = self.read

Handlers_table_visibility_point in [`handlers.mjs`](...)?;
(/private/tmp/claudelet existed = self.effective-501/-Users-c_point_is_visiblecheever-projects-snap(visibility, existed_in_storage, storageback/b6c9_visible, effective)?;
if existed { self.writes.push(BufferedWrite::Patch { ... }); }
Ok(Value::Bool(f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/existed))
```

`effective_demos/team-chat/point_is_visible`snapback/handlers.mjs (`2699–). Mutations2718`): hidden stored row declared in [`functions.mjs`](/private ≡ absent;/tmp/claude-501 then re/-Users-ccheever-eval visibility-projects-snapback/ on the bufferedb6c9f681 overlay. **-3da6-45`visibility == None` ⇒dd-8d7c any-ca12e936a effective76b/scratchpad/ row is visible**wt-llp/demos/ (`2717`).team-chat/snapback

`read_table_/functions.mjs).visibility_point` (`263 **7–2665No HostPlan mutations`): `storage**_visible` is true (live queries when visibility/pages is `None`. are HostPlans).

So:

- Owner

**`createRoom`** table (handlers 30–46: JS patch; review 219/delete only buffer, 204 if the7):
- **Not **read- generic:** `ctx.membershipvisible** (.roomMembers.bootstrap({owned title, createdBy: ctx) row exists;.auth.userId, commit rechecks createdAt })` ( **physical owner**.
- Migration34–38-pending () — creates `public-read / membership /rooms` + owner ` any-of):roomMembers`
- **Generic ` JS uses **read visibility**insert`** `room as the earlyParticipants` `{ roomId, gate; commit uses userId: ctx.auth **physical existence** and.userId, displayName **does not re-check visibility**.
- Host, status: 'owner', changedAt }` (39–45)
- `displayPlan neverName` caller-supplied; uses ` `userId` **effective_point_is_auth-stamped**

visible` for**`inviteMember`** writes.

 (48JS has–81; review 497 no `insert, 1826,Each 1958):
-` / `deleteWhere **Not generic:** `ctx`.

---

### .membership.roomMembers.insert5. `FunctionWritePolicy({ roomId, userIdV1` and: args.user activation validation

StructId, role: 'inv (`ited' })` (61src/manifest.rs:8991–899–65)
- **8`):

-Generic `patch` `semantic**_version existing `:roomParticipants` `{ display String` (requiredName, status: 'inv)
- `disclosures: Vecited<',Table changedWriteAtConflictDisclosure }` (V166>`– —72) ` **or `table`, `writeForm`,insert`** `{ ` roomIdconstraint,`, user `Idoperations:`
 args.userId, display- `opaque_write_postName,ure: status Option:< 'Stringinvited', changedAt }` (>`
- `declared_table74_–ceiling80: Option)
<- Target `Vec<String>>`

ActivationuserId` / (`src/manifest `displayName` **caller.rs:2998-supplied** (`–3079args.userId` is`):

Validated `v.principal:

()`)

**`acceptInvite- Function`** (83–94 **must; review 152 be a, 2223 Mutation**.
-): `
semantic-_ **versionNot generic:** `ctx.membership.` **roomMembers.setSelfRole(must be exactly** `snapback.owner-writeroomId, 'member').v1`.
-` (88)
- **Generic `patch` Each disclosure: `** `roomParticipants` `{write_form ∈ {insert, insert-each status: 'member', changedAt }` (89–92, patch, delete, delete)

**`leaveRoom`-where}`; `operations`** (96–115 non-empty, **sorted; review 623,  unique**, **1871, 191includes this5):
- **Generic function name**; non `delete`** each-empty table/constraint own `deliveries` row.
- Disclosure identity by `( `_id` (106–108)
- **Nottable, write_form, constraint, operations)` unique in generic:** `ctx.membership the function.
- Opaque.roomMembers.removeSelf( pairroomId)` (109)
: either both- **Generic `patch`** `roomParticipants` `{ absent, or `opaque status: 'left', changed_write_posture`At }` (110–113 is `conservative)

**`ownerRemoveMember-v1` (or`** (122–143 omitted) **and** `; review 1092,declared_table_ceiling` 2133 is non-empty) — moderator **and cleanup:
- **Not generic** sorted:** `ctx.membership.-roomMembers.removePrincipal(roomunique.

**Not validatedId, targetPrincipal)` first here (123–126**

- No)
- **Generic `patch `authRequirement` coupling`** `roomParticipants`.
- No check `{ status: 'removed', that disclosures changedAt }` (137– match140)
- **Does not delete real unique the indexes (codegen target’s `deliveries`** — does comment that).
- `: Phase 1a cannot mutatewrite_ anotherpolicy principal`’s owner slice is optional; absence (133–135)
 is fine.

Emission- Declared `writes` (` include `deliveries` (packages/snapback-codegenfunctions.mjs 142/index.mjs:554) but handler0–5548`, has **no deliveries `5798–580 generic write**

1`)**`sendMessage`** always attaches `write (145–190; reviewPolicy` on mutations 1390, 200: version2, 2090 + `discloseUniqueConflicts`):
- `insert` + optional opaque `messages` `{ roomId ceiling, authorId: ctx..

---

### auth.userId, author6. `packages/Namesnap: authorback-codegen/write-policy.mjs`

.displayName, body,**`genericDisposition pageKey: ctx.runtime` (`.id(), createdAt }` (60–64`)**

168–175```)
- `author
no visibility                        Id` **auth-st → legacy-undeclaredamped**; `authorName`
authority ( from ownmembership / permission) `roomParticipants   → generic-refused.displayName`;
visibility.kind `body` caller === 'owner'          -supplied
- `insert → owner-policy
any` `deliveries` ** other installedwithout `recipientId`** `{ roomId, visibility        messageId, authorId, → migration-pending
``` author

**Name`,derive bodyWrite,Post pageKey: ctx.ure` (`90–113runtime.id(), createdAt,`)** — governance unread: false }` (179 identity, **not** the– runtime188 dispatcher)
- Review: `owner:

- NonInputDisposition: "host-stamped"-ordinary **or** `policy !== 'owner`, `ownerField:'` → **every "recipientId"`, ` form `refused`**.
- Owner →principalSource: "auth. `insert`/`insert-each`: `owner-host-stuserId"` (2003–2013) — host stamps recipient = caller
- Commentamped`; `patch`/`: only the sender’s delivery untildelete`: `owner-old-row-checked`; ` a crossdelete-where`: `owner-principal fan-out write-filtered`.
- Public model exists (176–178-read write)
Posture is already- Returns `{ messageId, **all refused** while recipients: 1 }` (189)

**`markRoom runtime is pass-through (`write-policy.test.mjsRead`** (192–:62–75`).

205; review 793,**Opaque 2177 census** (`scan):
- loop `GenericpatchWriteSites`, `147–227` own`)

- Parses `deliveries` `{ unread JS;: false }` ( walks199–202 selected)
- Review: owner `__snapbackHandlers[op-policy, `owner]` or wholeInputDisposition: "refused program.
- Class"`ifies ( `doesctx.db.insert|patch|delete` with not change owner literal table when field possible)

.
- Parse failureNo `insert → `{-each` / `delete opaque-where`.

: true }### D.`. Dynamic Deliveries, mark table →-read, moderator cleanup, `table ownership: null`.

**Deliveries model

**`buildWrite (kernel, not production fanPolicyChecks` (`604–769`)**-out):**
- One

- Mutations row per send only., owner-s Authority-profile ops skippedliced to **sender if they have no generic `** via host-stamped `recipientctx.db` sitesId`
- Inserted.
- Module ** without`unread: selected operation / parse-opaque false`** (187 / dynamic) — sender inbox table:
  - If does **all** declared writes not start unread
- Other are ordinary non members get-owner → ` **no** delivery rowsmigration-pending-declared- in this kernelwrite-set` rows +
- Unique `( warning (recipientId, pageKey)`no opaque ceiling and `(messageId, recipient required).
  - ElseId)`
- ` → `opaqueunreadDeliveries` live-module` row; query: `recipient requires `opaqueWritePostureId ==: conservative authUserId() &&-v1` + ceiling unread == true` (functions **exactly.mjs 51–58 equal** to declared)
- Inbox write set; conservative all-form unique census pages: `define.
- `OwnedKeysetPages` ondeclaredNonOwnerDisposition`: `deliveries` owner `' `recipientId` (60migration-pending'` (default–70, warn)

**Mark-read:**) or `'refused'` member (Phase 1b flip/owner required → ( `SNAPBACK_TABLE_193).WRITE_POLICY_INEL LoadIGIBLE`).

**Row own room shape (`exact deliveries via `by_recipientProjectionRow` `315–_room` +394`)** `ctx.auth.user — matchesId` (20– schema `$defs.writePolicy26, 194). Patch thoseCheck`.

**` with `unread: trueprincipalSource`:** `'`auth to `false`. Bounded at.userId'` iff `owner-policy`; else `' 256 (not-applicable'103–`; opaque →105, 195– `'runtime-resolved'`.197).

**Moderator cleanup Schema also allows (`ownerRemove `'none'` (Member`):**
unused- Membership `).

**`ownerInputremovePrincipal` (Disposition`:**

authorized| owner Case-remove | Value-other)
- Display row |
|---|---|
| → Owner `status: 'removed'` insert/insert
- **No inbox-each, ctx. cleanup**db or owner of the removed field omitted principal’s deliveries | `host-stamped

` |
| Owner Host**Who owns which rows:**Plan insert with

| Row `AuthUserId` in | Identity values | `sealed-auth / owner-user-id-marker stamp` |
| Owner patch/ | Visibility ownerdelete | `refused` |
|---|---|---|
 |
| Else | `not-applicable` |
| `rooms` | `createdBy|: Opaque ctx | `runtime-resolved` |

---

.auth.userId`### 7. `visibility via bootstrap | membership,-governance.mjs`

** not owner-`POLICY_GOVERNANCEfield |
|_VERSIONS` (`56 `roomMembers` | `userId` = bootstrap–77`)**

- ** selfv1:** baseline / invitee principal/ledger/record ` | owner(`*.vuserId`); **1`, bodyauthority digest `... table** |
| `room-Participants` | `userIdbody:v1`, comparator `snap` = auth on create; inviteback.visibility-governance-comparator.v1` (e on invite | anyread-only). **-of owner(`No `writePosture`userId`) or room.**
- **v2 membership |
| `messages`:** `*.v | `authorId: ctx2` domains.auth.userId`, comparator `... | membership on `roomId-` |
| `deliveriescomparator.v2`. **` | `recipientRequiresId` host-stamped `writePosture`.** to **sender

Unknown /**; `authorId` = mismatched schema versions sender | owner(` → `SNAPrecipientId`) |

`BACK_TABLE_VISIBILITYleaveRoom` can_POLICY_PROVENANCE delete only the_INVALID` (`243 caller’s deliveries6–244 (owner4`).

**`canonical-oldWritePosture` (`252–-row309-checked).`)**

- Exact Owner cannot delete another keys: `semanticVersion`, user’s deliveries.

 `### Fdis.positions Authority`, ` tablesowner generField`, `authorityTableClassically written

**`, `globalUniqueDisclosures`roomMembers` is the`.
- **` only authority table**semantic (`Versionauthority` must be `TableClass: "membership"`snapback.owner-write). Generic insert.v1`.** Anything else/:patch **/delete/``writePosture semanticVersion is unsupportedinsert-each`/`delete-where` are **ref`** (used**. Handlers usesame provenance `ctx.membership. code).
- DispositionroomMembers.{ enumbootstrap,insert,setSelf **only**: `refusedRole,removeSelf,removePrincipal}` only — ** | owner-host-stzeroamped | owner-old- generic `ctxrow-checked | owner-.db` writes to `filtered`.
- `authorityroomMembers`**.

`TableClass`: `ordinaryinviteMember` / | membership | permission-backing `acceptInvite` / ``.
- Disclosures uniqueleaveRoom` / `owner afterRemoveMember` are `authority canonical sortCreating: true` (functions.

**`compareWritePost.mjs 102ures` (`366–401, 116,`)**

1. 126 Both, 136) because missing → ` they goequal`. One missing → through the membership API.

 **Generic`incomparable`**.
 writes that2. If *do* exist `semanticVersion`, are to `ownerField`, or ` `roomParticipants` (ordinaryauthorityTableClass` differ →, posture **`incomparable`** refused (owner- →field ** `rebind is notmigration-pending`), `messages narrowing**` (membership visibility).
3. Per form, posture: same refused → `migration-pending → equal; ``), and `deliveries`refused → * (`` → **growth**; `* → refusedowner-policy`).

### G. Auth on` → **narrowing**; mutating ops

All mutations any other change `auth: 'authenticated'` (e.g. explicit in source `owner-host-stamped` → hypothetical (functions.mjs  `open`)93, 101 → **`in, 115, 125comparable`**.
4. Disclosures keyed by `, 135, 146, table\0writeForm155\0constraint`: add →). growth; remove → Review matches narrowing; ops ` add → growthorigin: "explicit"` /; ops remove → narrowing; `value: "authenticated"` add+remove → in (83comparable.
5. `–86,combineRelations`: 174–177 growth+narrowing → in, 520comparable.

Product–523, 730 comparator–733 (`407–414, 1288–129`): read × write;1, etc mixed.).

Plus axes in → incomparable.

**v-handler permission1 → v checks:
2 lift**

- Artifact- invite upgrade (`: `requireRole(room1361Id, 'owner')`–1413 (50`,)
- leave `2783–2821: `requireRole(roomId, 'member')``): derive `writePosture` from (97)
- current table send / + static mark-read: `require `discloseUniqueConflicts` parsedRole(roomId, ' from successor `functionsowner', 'member')`.mjs`. Non (146, 193-static disclosures refuse)
- owner-.
- Git ratchetremove: `removePrincipal` (`335 (membership2–3414`): dow transition)

ngrade v### H. Unique / disclose2→v1 refused.

| v Unique1 predecessor | Hit is lifted then by | compared. If successor posture Review disposition ≠ derived lift, treated as growth/incomparable → needs `approved-transition` ( |
|---|---|---|
| `roomParticipants.by_room_user` | `or G1 publiccreateRoom`/`inviteMember` insert | `not-applicable` |
| `messages-read introduction).
- Legacy.by_room_page ledger upgrade_key` | `send only if **Message` insert (`pageKeyno predecessor chain** = ctx. (Gruntime.id()`) | `1-migration roots only).

**`not-applicable` |
| `deliveries.by_authorityKind`** — **not** on writerecipient_page_key` posture. Only quarantine | `sendMessage` insert verdicts (`162 | **2–1640`owner-partitioned``): `visibility-override |**, empty constraints; delegation | table-policy- preflight includes `unique-transition | governance-record`.disclosure` (201 Write axis uses **2`authorityTableClass`**.

---

### 8) |
| `deliveries.by_message_recipient. `authorization-review.` | sameschema.json` `writePolicy insert | lumChecks`

Section const: `snapback.authorizationped as `owner-partitioned` |

-review.write-policy-`markchecks.v2` (`225`).

FullRoomRead` patch and enums on `leaveRoom` delete on `$defs.writePolicyCheck` (`260 `–320`):

| Field | Enumdeliveries` are / also `owner-partitioned shape` ( |
|---|---|
|189 `siteResolution` | `6–exact-static`,189 `exact-plan-step8, 2204`, `runtime-ceiling-–2206member`, `opaque-module). **Generated`, `migration-pending- review does not emitdeclared-write-set` a disclose |
| `runtime-neededClass` | `javascript- unique list.** `roomhandler`, `host-planParticipants` and` |
| `surface` `messages` uniques | `ctx-db`, ` would needhost disclosure-plan` |
 if those tables| `writeForm` | `insert`, `insert- left `migration-each`, `patch`, `pending`. Ownerdelete`, `delete-where-partitioned delivery`, `opaque` |
| uniques are treated as not `writeFormCeiling` | requiring `null` caller ` or uniquediscloseUniqueConflicts` (` subset of `constraintsinsert\|patch\|delete` |
| `table: []`).

---

Resolution` | `exact`,## Cross-demo comparison `runtime-ceiling-member

| Demo |`, `opaque-module` |
| `policyKind` Write style | `owner`, `public | Auth--read`, `membership`,stamped identity? `any-of`, ` | Caller-assertundeclared`, `runtimeed identity? |-resolved` |
| ` Authority tabledeclarationOrigin` | `declared generic writes`, `legacy-default`, | `runtime-resolved` |
| `ownerFieldResolution` insert-each / delete-where | `exact`, `not |
-|applicable---|`, `---|---|runtime---|-resolved` |
| `generic---|---|
| campWriteDisposition` | `ownerfire | JS `-policy`, `generic-ctx.db` | norefused`, `migration- | `author`,pending`, `legacy-unde `userKey` | noneclared`, `runtime- | noneresolved` |
| `principal |
| chirp | JSSource` | `auth. `userIdctx.`,db ``none |`, `not-applicable`, ` no | `authorHandle`,runtime-resolved` |
| `userHandle` | none `ownerInputDisposition` | | none |
| graffiti | `host-stamped`, HostPlan ` `sealed-auth-userinsert` | `-id-marker`, `authorId:refused`, `not- authUserId()` | coordsapplicable`, `runtime-resolved` |
| `absentDisposition/color only | none` | `ctx-db | none |
| messaging--false`, `hostsnapback | JS `ctx.db` | view--plan-no-effect`, `declared-refusal`,once only (`author `not-applicable`, `Principal` / `runtime-resolved` |
|principal`) | handles `uniqueConflictDisposition.kind` | `owner-partition/names on chated`, `declared-disclosure writes`, `not-applicable`, | none | none |
| `runtime-resolved` |
 team-chat | JS `| `authorityTableClass` | `ordinary`, `membershipctx.db` + membership`, `permission-backing`, API | `createdBy`, `runtime-resolved` |
 `userId`, `author| `writeElevation` |Id`, host **-stamped `recipientconst** `unavailableId` | `display` |
| `resultEgress` | **const** `Name`, invitee `userseparate-phase-not-Id`, `body` |covered` |

**Schema ** vs producer:** `exactnone** (membership API only) | none |

**ProjectionRow` can emit `uniqueConflictDisposition.kind =Public-read write 'missing-disclosure' posture** (`, but that pathcampfire, chir **refuses generationp, graffiti `**. Successful reviewcells artifacts`, never contain all messaging it. Schema tables, team has no `missing-disclosure`.-chat `messages`/`

---

### 9. Delete-where scans with `table_visibility:rooms None``

The/`roomParticipants`): generated successor dispositions refuse every generic form; **product live sites** delete-where path are `migration-pending`:

```3906:3914 / `pre-0264:src/storage.rs
-runtime-behavior`.

let scan_plan = Query**Only ownerPlan {
    table_visibility-policy generic: owner_field.map(| writes in thisfield| TableVisibilityV1 set:** team-chat `deliveries`::Owner { field }),
    table: table.name.clone(),
    filters: insert ( filter.clone(),
    ...host-stamped),
};
```

When ` patch (`generic_owner_write_markRoomRead`), delete (`field` is `None`,leaveRoom`). this is **`table_visibility: None`**. Empty filter = **clear matching table** (comment `3904–3905`). Owner delete-where is tested as principal-filtered (`src/storage/tests.rs:500–525`); anonymous owner scan is a no-op.

Many other `table_visibility: None` sites exist (`src/runtime.rs:3058`, `5244`, membership/admin/tests). Those are **reads / overlay re-filter**, not write-policy delete-where. The write fail-open is specifically this HostPlan scan.

---

### 10. Standard patterns / public writes

Shipped writers: **`defineOwnedCrud` only** (`packages/snapback-codegen/standard-patterns.mjs:182–348`).

- Requires `visibility: { kind: 'owner', field }` (`91–117`).
- Refuses authority-bearing tables (`201–207`).
- Mutations `auth: 'authenticated'`.
- Create omits owner from args; plan sets `AuthUserId` (host restamps).
- Update/delete emit sealed `ownerWriteCheck` with `SNAPBACK_ROW_NOT_FOUND` (`index.mjs:8834–8848`). Non-CRUD HostPlan Patch/Delete get `absent: no-effect`.
- Unique indexes must include owner **or** be named in `discloseUniqueConflicts`.

Also shipped, **read-only**: `defineOwnedUniqueLookup`, `defineOwnedKeysetPages`, `defineMembershipKeysetPages`.  
`.data()` / `lowerDataResourceV1` withdrawn. **No `definePublicCrud` / public-write pattern.**

Public-read tables can still be written by **hand-authored** HostPlan/JS in Phase 1a (warn + `migration-pending`).

---

### 11. `authRequirement` derivation / default

Closed set: `public | optional-user | authenticated`.

| Layer | Behavior |
|---|---|
| Authoring omit | `authoredFunctionManifestFields` omits the field (`index.mjs:10915`) |
| Manifest decorate / projection | `fn.authRequirement ?? 'optional-user'` (`11602`, `11634`, `14014`, …) |
| Sessions mode omit | Warning `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT`; still **legacy `optional-user`** (`4473–4479`) |
| Runtime load | `effective_auth_requirement()` → `unwrap_or(OptionalUser)` (`src/manifest.rs:9312–9314`) |
| `defineOwnedCrud` | Explicit `authenticated` |
| Familiar builder | Auth required; never defaults to public (`familiar.mjs`) |

**Write policy does not tighten auth.** A `public` / `optional-user` mutation may still perform owner inserts; anonymous hits `SNAPBACK_AUTH_USER_MISSING` at insert, not at admission.

---

### 12. Unique-constraint conflict oracle

**Generation (authorization, not runtime typing)** — `uniqueConflictFact` (`write-policy.mjs:299–313`):

- Only for `policy === 'owner'`.
- Insert/insert-each: all unique indexes. Patch: unique indexes intersecting patched fields (conservative opaque: all).
- Indexes **containing the owner field** → `owner-partitioned` (no disclosure).
- Global unique indexes: each must have an operation-bound disclosure or `SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED`.
- Delete / delete-where: no unique census.

Disclosures are part of **writePosture identity**; adding an operation is **growth** (needs LLP 0234 approval).

**Runtime** — `map_unique_constraint_error` (`src/storage.rs:15504–15529`): SQLite UNIQUE → `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. Comment: **error typing, not write authorization**. No owner-partition at commit; no disclosure check. Oracle is generate-time only.

`defineOwnedCrud` independently enforces the same disclosure floor (`standard-patterns.mjs:253–281`).

---

## Fail-open map: `None` = no owner check / pass-through

This is the hinge for any **Open** posture. Today **`Ok(None)` is not “open policy”; it is “skip the owner engine.”**

1. **Declared non-owner** (`public-read` / `membership` / `any-of`): runtime pass-through on **every** generic form. Governance `writePosture.dispositions` already say **`refused`**. Review rows say `migration-pending` + `authoritativeChecks: ['pre-0264-runtime-behavior']`.

2. **HostPlan DeleteWhere + `None`:** unfiltered physical scan. Empty filter deletes **all rows**.

3. **HostPlan Insert / InsertEach + `None`:** no stamp; caller may set any “owner” (or no owner). Preflight does not require `AuthUserId`.

4. **HostPlan Patch/Delete + `None`:** physical id, no visibility, no `ownerWriteCheck`.

5. **Buffered commit + `None`:** no stamp, no owner-input refusal, no old-owner recheck. Apply if physically present.

6. **JS insert + `None`:** owner field **not** stripped; caller-authored owner survives to commit.

7. **JS patch/delete + `None`:** early gate is **read visibility**; commit is **physical** and does **not** re-apply membership/any-of/public-read.

8. **Authority `None` is the same type as migration `None`.** Membership HostPlan is separately denied. **`permission_backing` HostPlan is not.** JS `ensure_permission_backing_write` only fences **service principals**. Ordinary-user generic writes to permission-backing rely on `enforce_membership_write_gate`, which only refuses **`table.membership`**, not `permission_backing`.

9. **Adding Open by leaving `None` as pass-through** would ship Open as the current public-read fail-open, while `deriveWritePosture` still publishes **`refused`**. Comparator would **not** see a write-axis growth.

10. **Adding a new disposition** (e.g. `open`) requires: `canonicalWritePosture` enum, `compareWritePostures` (today `refused → open` = **growth**; `owner-* → open` = **incomparable**), schema, `genericDisposition`, review row fields, and a **new dispatcher arm** that is **not** `Ok(None)` unless 0274 explicitly wants pass-through.

11. **Owner-field rebind** is already `incomparable` (governed). Semantic-version bump is `incomparable` / unsupported until `canonicalWritePosture` is extended.

12. Unique oracle: Open-on-public-read makes **every** unique index global. Phase 1a skips unique census for non-owner (`not-applicable`). An Open posture that reuses that skip **will not require disclosures** unless 0274 adds them.

**Phase 1b already has the refuse flip:** `declaredNonOwnerDisposition: 'refused'` at codegen; runtime comment at `18121–18123` says the non-owner arm becomes a refusal. 0274 should not treat that arm as a safe Open default.I have the IR and D5 text. Next I’ll read the runtime dispatcher, the v1→v2 lift, and the 0065/0231 constraints that 0274 has to stay inside.I verified graffiti against the code: `paintCell` is an append-only HostPlan insert with `authorId: authUserId()`, not an in-place patch. The rest of this review is against that ground truth and the shipped 0264 seams.

VERDICT: NOT READY

The Draft is in the right shape: one table-policy IR, two explicit postures, no inference from `public-read`, a typed dispatcher instead of `None`, and a lift that mirrors 0264’s v1→v2 edge. S0’s demo facts are accurate. The holes below are ones two implementers would ship differently, or that classify a real authority widening as ungoverned narrowing.

## MATERIAL

### 1. The formwise rank product does not govern “write broader than read,” and it treats authority-field introduction from `open-write` as narrowing

D4 claims both of these:

- the write-axis order is `refused < owner < authenticated-write < open-write`;
- “the transition that creates broader write than read authority is governed under D4.”

The comparator as written is the product of that rank order with the existing read order. That product does **not** treat write>read as a governed fact.

**Failure scenario A (write>read created, classified `narrowing`, no approval).**  
Table is G1 `public-read` + explicit `open-write` with `patch`/`delete` admitted (campfire-shaped). Successor keeps the same write posture and changes read to `owner { field: author }`.

- Read: `public-read → owner` = narrowing (`compareReadPolicies`).
- Write: equal (same `open-write`, same forms).
- Product: **narrowing**. No remotely-prior approval, no separation receipt.

After the change, an anonymous (or non-owner) caller may still patch/delete Alice’s row. The shipped JS early gate today uses `effective_point_is_visible` (`src/runtime.rs:3551-3574`); D6 requires **physical** existence instead. The caller now gets the value-free `true`/`false` existence bit — and a committed mutate — for a row they cannot read. D4 says that capability must be governed. The comparator lets it land as self-proving narrowing.

The same hole exists for `public-read` + `authenticated-write` → `owner`/`membership`/`any-of` + same write posture, and for role-narrowing a membership audience while leaving `open-write` in place.

**Failure scenario B (caller-controlled bytes become an owner predicate, classified `narrowing`).**  
Campfire `messages` is `open-write`; `author` is a caller string (`demos/campfire/snapback/functions.mjs:118-137`). Attacker inserts rows with `author: "<victim-id>"`. Successor is `owner { field: author }` (or `authenticated-write { attribution: author }`) with the same admitted forms.

D4: “open has no authority field, so open-to-authenticated/owner may narrow to a valid field.” Rank 3→1 (or 3→2) is narrowing. Combined with a simultaneous public→owner read change, both axes narrow. No approval.

Stored attacker-chosen strings are now the owner/attribution predicate. D4 already treats `owner { A } → owner { B }` as incomparable because field identity is authority. Introducing the field from `open-write` is the larger rebind and is classified as the one case that does **not** need a receipt.

D8 #15 lists “cross-axis read/write changes” but never requires a fixture that write-equal + read-narrower is `incomparable` whenever write rank exceeds the new read maximum. Until that is the rule, the “write>read is governed” sentence is false.

### 2. The required LLP 0264 amendment does not actually change the Phase 1b flip that would kill these postures

The dated D1/D2 note says v1’s ban on explicit non-owner postures is lifted, then: “Owner derivation and every undeclared/non-owner default in D2 remain unchanged.”

0264 D2’s table, D10’s `SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE`, and the Phase 1b flip paragraph still say: after corpus closure, **every** generic write to ordinary `public-read` / `membership` / `any-of` refuses. They have no “unless `write` is present” exception.

**Failure scenario.** 0274 is Accepted and implemented. Campfire `messages` has `write: { kind: 'open-write', forms: { insert: admitted, ... } }`. The 34-job receipt is minted. An implementer (or a later agent) applies 0264 Phase 1b as still written: `declaredNonOwnerDisposition: 'refused'` and “flip the matching pre-0264 pass-through arm” for any non-owner **read** kind.

`genericDisposition` today is `visibility.kind === 'owner' ? owner-policy : migration-pending` (`write-policy.mjs:60-64`). A 1b flip that only changes the non-owner **read** arm to refuse will refuse `open-write`/`authenticated-write` tables. Runtime `generic_owner_write_field`’s `PublicRead | Membership | AnyOf => Ok(None)` arm (`src/storage.rs:18124-18128`) flipped to `Err(POLICY_INELIGIBLE)` does the same, because the write member is not on `TableVisibilityV1` today.

0274 D7’s “INELIGIBLE remains the Phase 1b result for a non-owner read policy **with no explicit posture**” is the intended rule. It is not the amendment text 0264 will receive, and it is not what 0264’s flip paragraph says.

### 3. The LLP 0234 D5 amendment is specified as inventory sync; D5’s normative write order would stay wrong

0234 D5 currently: refused-to-owner, new form, or disclosure/`operations[]` growth is write growth; owner-field, semantic-version, and unproved changes are incomparable.

0274’s landing note: add a “dated cross-reference” that “changes no approval, ledger, receipt, quarantine, or activation machinery; it keeps the closed-version inventory synchronized.”

**Failure scenario.** Implementer A updates only `POLICY_GOVERNANCE_VERSIONS` (v2→v3 names) and leaves `compareWritePostures` as shipped (`visibility-governance.mjs:366-401`): any non-`refused` disposition change is **incomparable**. `open-write → owner` then requires an approval that 0274 D4 calls narrowing. Implementer B replaces the comparator with ranks. Same tree, opposite ratchet verdicts.

Worse: 0234 D5 still says “old schema readers refuse rather than silently drop the write axis.” That sentence does not mention `authorityKind`, `attributionField`, or `open-admitted`. A v2-pinned reader that maps unknown dispositions to `refused` (D8 #16 forbids this; 0234 D5 as amended-by-cross-ref does not) will treat `public-read`/`open-write` as read-only and green a successor that is actually open.

The write-axis partial order **is** approval machinery. A cross-reference is not an amendment.

### 4. The authoring object cannot enter the existing canonicalizer; the lowerer is unspecified

D1 puts `write` on the same object as `kind: 'public-read'`.

Shipped `canonicalPolicyLeaf` for `public-read` is `exactKeys(policy, ['kind'], ...)` (`visibility-governance.mjs:184-186`). Owner/membership/`any-of` are equally closed. `TableVisibilityV1` has no write member (`src/manifest.rs:1939-1954`). `normalizePolicyBody` already stores read `policy` and `writePosture` as siblings — but nothing says “strip `write` before read canonicalization and derive `writePosture` from it.”

**Failure scenario.** Implementer A passes `visibility({ kind: 'public-read', write: {...} })` into `canonicalVisibilityPolicy` → `SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID` on unknown field `write`. Campfire cannot generate. Implementer B stuffs `write` into the normalized `policy` object so the read digest includes write bytes; then a forms-only edit looks like a read change and the read comparator misfires. Implementer C adds an adjacent `TableManifest.write_posture` and never puts `write` in the visibility enum; activation and `generic_owner_write_field` never see it, so `authenticated-write` stays `Ok(None)` and is fail-open anonymous write (the current PublicRead arm).

0231 D6 is satisfied only if the lowerer is closed. It is not.

### 5. Restamp-on-unchanged-patch is incompatible with two shipped empty-values continues

D3: “Restamping occurs even when the authored patch would otherwise leave all values unchanged.”  
D6: JS “buffers a host-owned restamp obligation”; commit “independently repeats … stamp/restamp.”

Shipped HostPlan Patch:

```3473:3475:src/storage.rs
if values.is_empty() {
    continue;
}
```

Shipped buffered apply:

```4849:4851:src/storage.rs
if values.is_empty() {
    continue;
}
```

Neither path consults a side-channel obligation. Empty values never reach `patch_document`.

**Failure scenario.** Authenticated-write table, Alice owns the stored attribution. Bob’s handler does `ctx.db.patch(t, id, {})`, or a HostPlan patch whose only authored change is the (forbidden) attribution field and is stripped to `{}`. Early gate may return `true`. Commit hits `values.is_empty()` and **skips**. Attribution stays Alice. D3’s “latest responsible principal” is false. A later compacted graffiti `paintCell` that patches the same color is a no-op restamp miss: Grace paints Ada’s cell the same color, `authorId` remains Ada.

Two implementers: (1) inject attribution into `values` **before** the empty continue (must also not trip `ATTRIBUTION_INPUT_REFUSED`); (2) treat restamp as metadata and still hit the continue. The spec does not pick.

### 6. Anonymous authenticated-write HostPlan insert with the sealed `AuthUserId` marker cannot emit the specified code

D3 allows omit **or** sealed `AuthUserId` on insert; the marker is not trusted.  
D7: no principal → `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED`, and `SNAPBACK_AUTH_USER_MISSING` “remains owner-insert-specific.”  
D8 #9: every anonymous HostPlan form returns that one code, byte-identical for missing and present targets.

Shipped HostPlan Insert **evaluates the value map first**, then stamps if owner (`src/storage.rs:3407-3433`). `ValueExpr::AuthUserId` with no user is `SNAPBACK_AUTH_USER_MISSING` (`src/value_expr.rs:144-152`).

**Failure scenario.** Graffiti after D9: `authenticated-write`, `paintCell` still carries `authorId: authUserId()` (`demos/graffiti/snapback/functions.mjs:67`), `auth: 'authenticated'` added. A stale or forged invocation reaches the executor with no `user_id` (nested/system root, or optional-user leftover before generation is fixed).

- Marker present: eval fails `SNAPBACK_AUTH_USER_MISSING` (owner-insert code, details are not “table + write form only”).
- Field omitted: dispatcher can emit `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED`.

Same posture, two public codes. D8 #9 fails. A client that treats `AUTH_USER_MISSING` as “log in and retry owner insert” gets the wrong remediation.

Preflight must refuse missing principal **before** `eval_value_map`, including when the only attribution expression is the compatibility marker. That order is not written.

### 7. D9’s Team Chat “no new posture” cannot close the job that actually exists

Verified against `demos/team-chat`:

| Surface | Read policy | Generic write | After 1b without a 0274 posture |
|---|---|---|---|
| `deliveries` | `owner { recipientId }` | insert (host-stamps sender), patch, delete | already owner-policy; S0 is right |
| `messages` | **membership** | `sendMessage` `ctx.db.insert` (`handlers.mjs:168-175`) | **INELIGIBLE** |
| `roomParticipants` | **any-of** owner\|membership | create/invite/accept/leave/remove insert+patch; invite writes **another principal’s** `userId` (`handlers.mjs:74-80`) | **INELIGIBLE**, and invite is recipient-shaped |

D9: “No new posture. Restructure deliveries into recipient-owned read markers and ordinary membership-visible messages.”

Owner-write is derived **only** from owner-read (0264 D2, 0274 D1). `messages` cannot become derived owner-write while remaining membership-visible. `authenticated-write` on `messages` lets any authenticated principal insert/delete any room’s messages; D1 says membership read “contributes no role or relation to the write decision.” Handler `requireRole` is not the dispatcher. That is the overbroad posture D9 forbids.

`roomParticipants` invite cannot become owner-policy: owner insert would host-stamp the **inviter**, and naming `userId` is `OWNER_INPUT_REFUSED`. It is the same class of cross-principal write as the fan-out they refused to model.

**Failure scenario.** Team Chat is marked closed because deliveries were restructured and the 0274 receipt cites “no new posture.” `messages` and `roomParticipants` still project `migration-pending` (today they do). Phase 1b flip refuses `sendMessage` / `inviteMember`. Or someone “closes” them with table-wide `authenticated-write`, and any signed-in user forges a JS/HostPlan insert into another room’s `messages` or rewrites another user’s participant row. The 34-job receipt can either miss this job or count it dishonestly.

Messaging view-once is specified well enough (`closeViewOnce` really does patch the author’s `grants` map; `demos/messaging-snapback/snapback/functions.mjs:398-424`). Team Chat is not.

### 8. D8 does not include the 0065/D6 negatives the current code will get wrong

0065 requires explicit semantics **and** negative acceptance for anything that is not the owner profile. D8 is strong on anonymous-vs-authenticated, stamp input, and comparator ranks. It does not require:

- owner-read + `open-write`/`authenticated-write` point patch/delete of a physically present, read-invisible row (physical success vs today’s visibility `false` no-buffer);
- HostPlan `ownerWriteCheck` bound to an open/auth patch (today `Some(field)` **means** “require ownerWriteCheck + `owner_row_matches`”; if anyone returns `Some(attributionField)` from a still-`Option<&str>` dispatcher, authenticated-write silently becomes owner-write);
- `defineOwnedCrud` / `ownedRowGuard` must not lower onto either new posture;
- unique census actually runs for non-owner tables (`uniqueConflictFact` is `policy === 'owner'` only, `write-policy.mjs:329-331`; campfire `by_room_sequence`, reactions `by_message_emoji_user`, chirp `likes.by_post_user`, messaging `conversationMembers.by_conversation_user` / `reactions.by_message_user_emoji` all need disclosures the day they leave `migration-pending`, and today’s review rows say `not-applicable`).

**Failure scenario.** Qualification reports green on D8’s listed groups. Implementation keeps `generic_owner_write_field -> Option<&str>` and returns `Some(authorId)` for authenticated-write so the stamp path can reuse owner insert. Preflight then requires `ownerWriteCheck` and commit runs `owner_row_matches` on `authorId`. Bob cannot paint over Alice. Graffiti’s product meaning, which this Spec chose restamp to preserve, is gone — and D8 #11 never ran against the HostPlan/ownerWriteCheck seam.

## Minors

1. **FunctionWritePolicyV1 is pinned to `snapback.owner-write.v1` at activation** (`src/manifest.rs:2998-3001`). The Spec rotates “the” write semantic identity to `snapback.write-authority.v2` and never says this carrier stays. Rotating it breaks every mutation install; leaving it makes two live meanings of `owner-write.v1`.

2. **`validateStoredPolicyBody` / ledger digest verify are v2-special-cased** (`visibility-governance.mjs:2452-2458`, `1469`). A `=== v2` check will reject v3 bodies or hash them in the v2 domain. Spell the v3 key set and digest domains in the validation matrix, not only in the identity list.

3. **Insert rank is a lie.** Owner insert and authenticated-write insert (same field) admit the same principals and do the same host stamp. Rank 1→2 is false growth; 2→1 is false narrowing (unguarded). Harmless if conservative, messy if someone uses insert-only tables to launder a later patch admission.

4. **`genericWriteDisposition: open-write` next to existing `owner-policy`** is an inconsistent taxonomy. Close the combinations (`owner-policy` ⇒ `attributionField` null, etc.).

5. **Row-id domain `snapback:write-policy-check:v2` under section `write-policy-checks.v3`** will be mis-implemented. Say why the id domain lags, and that `policyDigest` is the v3 **body** digest, not today’s `snapback:installed-table-policy:v1` read digest (`write-policy.mjs:353`).

6. **`preflightChecks[]` / `authoritativeChecks[]` are not closed enums.** 0264 goldens depend on exact strings. v3 will drift across implementers.

7. **Lift of a hand-crafted v1 posture** with owner dispositions and `ownerField: null` is allowed by current `canonicalWritePosture` and becomes `authorityKind: owner` with a null field. Require the exact `deriveWritePosture` owner matrix **and** non-null `ownerField` / ordinary class.

8. **Asset-collection / `permissionBacking` HostPlan** still sit outside the ordinary dispatcher. 0274 only names authority tables. A `permission_backing` table with `write: open-write` is not specified; today’s HostPlan path does not refuse it in preflight.

9. **`WriteWithActivity` wrapper** is handled in `write-policy.mjs` and never mentioned. Exhaustive form classification should name it.

10. **D9 demo table is otherwise right** (I checked): graffiti is append-only insert + LWW render, not patch; campfire/chirp/messaging ordinary writes are caller-asserted; view-once `closeViewOnce` patches the author’s map; team-chat send inserts one sender-stamped delivery and `ownerRemoveMember` does not delete another inbox. Missing: the unique-disclosure list those open-write adoptions will require; `viewOnceConsumptions` after the grant-row restructure; messaging `users` correctly omitted (no generic writes).

11. **Empty `DeleteWhere` on write>read** is a cardinality oracle (scan uses `table_visibility: None` when no owner field, `src/storage.rs:3906-3908`). D8 parks counts in egress; if pairing remains legal, the residual should be named as an admitted disclosure, not discovered in review.

12. **Read-your-writes overlay** only injects owner stamps for `TableVisibilityV1::Owner` (`src/runtime.rs:5175-5180`). Authenticated-write handlers that read back the row they just inserted will not see `authorId` unless this is generalized. Not authority, but it will break graffiti-like JS that asserts the stamp.

13. **No Open Questions section** for the 0264 D2/D10/1b edit surface or the 0234 write-order replacement, which is how those contradictions survived.

The two-posture scope, restamp choice, “public-read never implies write,” and the Team Chat / view-once product rulings should stay. Fix the comparator so write>read and authority-field introduction cannot hide as narrowing; write the real 0264/0234 amendments; specify the lowerer and the restamp/AuthUserId evaluation order; and close Team Chat’s actual remaining generic writes. Then this is ready for implementation.
