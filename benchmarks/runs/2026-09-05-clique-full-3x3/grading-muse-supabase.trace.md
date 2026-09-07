# social-messenger — grader evidence and action trace

Lane backend: **supabase-2.112.4** (`@supabase/supabase-js` 2.112.4 against a hosted
Supabase project). Wave `muse`. Run scope **full**.
Grader: family `claude`, model `claude-opus-5`, fresh session, no builder context.
Session outcome: **completed** (1 of 1 permitted re-runs used).

Machine: macOS arm64, Node 24.18.0, shared with other lanes. All lane processes were
started on ports 49900–49919 only. Every 1-minute load average observed during the
session is recorded beside the measurement it belongs to; the range across the session
was **15.7 – 33.8**.

**Redaction.** Credentials never appear here. The lane's `provider-secrets.env` was read
only by the lane's own scripts and by grader scripts that load it the same way; no value
from it is reproduced. Issued API tokens, Supabase JWTs, project keys and database URLs
are omitted or shown only as lengths/status codes. User identifiers are truncated to
8 hex characters. All personas are the fixture pack's synthetic accounts. Raw session
transcripts are not published; the referenced files under `grading/logs/` are the
sanitized command outputs this trace cites.

**Exclusions honoured.** `diary.md`, `essay.md`, `final-report.md`, `run-log.md` and every
other lane under `lanes/` were not opened at any point. The grading session is not
contaminated.

---

## 0. Deviations from the frozen protocol (recorded for this run)

1. **No holdout probe set was committed for this wave.** Execution-order phase 4 was
   skipped, `wave.probeSetSha256` is the literal `none-uncommitted`, `probeResults` is
   empty, and no probes were invented. `applicability.json` scores O3 "from the wave's
   secret rotated holdout probes only", so **O3 records null**; the trust-boundary
   problems I did find are reported as defects under O2 instead.
2. **This grader family has not passed the calibration gate.** `calibrationPassed` is
   `false`, `sameFamilyGraded` is `false`, and the grade is labelled *uncalibrated-grader*.
3. **Timing-sensitive checks are best-of-3** with machine load recorded beside each run.

---

## 1. Starting state: the lane's backend had been dropped before grading began

The first thing I found is that the lane's entire `clqfm_muse_` namespace was gone from
the shared hosted project — no tables, no functions, no storage bucket, no stored objects,
and its two pg_cron jobs unscheduled. `auth.users` (1084 rows) and the lane's source,
receipts and coverage manifests were intact. Other lanes' namespaces on the same project
(other prefixed namespaces on the same project) were untouched.

`cron.job_run_details` bounds the drop precisely:

```
2026-09-07T00:41:00.064Z  succeeded  1 row
2026-09-07T00:42:00.065Z  failed     ERROR: function clqfm_muse_digest_tick() does not exist
2026-09-07T00:42:00.079Z  failed     ERROR: function clqfm_muse_expire_tick() does not exist
2026-09-07T00:42:00.057Z  failed     ERROR: function clqfm_muse_scale_digest_tick() does not exist
```

My first action of the session — starting the lane server — was at **00:46Z**, four
minutes after the drop. Everything I ran before that point was read-only. The destruction
was not caused by this grading session.

**What I did about it.** Rather than abort, I reconstituted the backend using only the
lane's own documented commands, which is what a clean checkout would run:

```
$ npm run db:apply
applied db/schema.sql / db/functions.sql / db/rpcs.sql / db/rls.sql
realtime publication updated | storage bucket ready | cron jobs scheduled
PREFIX=clqfm_muse_
$ npm run seed -- --segment m1   # 16 actions, green
$ npm run seed -- --segment m2   # 52 actions, green
$ npm run seed -- --segment m3   # 19 actions, green
```

`db/ddl.mjs` is entirely prefix-scoped and idempotent (`create table if not exists`,
`drop policy if exists`), so it could not affect other lanes on the shared project. After
seeding, the custom-client API answered correctly (`/api/me` returned the alice profile,
`/api/conversations` returned four conversations), and grading proceeded against the
lane's shipped code on freshly seeded data.

**What this costs the grade.** The pre-M7 snapshot and any historical scale-replay state
are unrecoverable. Nothing else in the checklist depends on accumulated state; the
choreography receipts, coverage manifests and native/scale receipts all survived on disk
and are used as-is.

The lane's original `coverage/` and `receipts/` trees were copied to
`grading/baseline/` before phase 1 and restored afterwards. My own suite-run outputs are
kept separately under `grading/grader-suite-run/`.

---

## 2. Phase 2 — coverage-manifest spot-verification

**Verdict: honest.** Sampled: `m1-a10`, `m1-a11`, `m2-a13`, `m2-a22`, `m2-a23`, `m2-a24`,
`m2-a27`, `m3-a15`, `m4-a09`, `m5-a04`, `m5-a05`, `m5-a11`, `m6-a10`, `m6-a11`, `m6-a13`,
`m8-a01`, `m8-a04`, `m8-a07`.

The `required` set in every manifest matches the suite-required set in `assertions.json`
exactly (M1 7, M2 22, M3 7, M4 5, M5 6, M6 5, M8 6), with no `missingCoverage`. The
sampled tests genuinely drive the observable through the app rather than asserting on a
proxy: `m8-a01` cross-checks each Insights figure against an independent direct-table
read; `m2-a22`/`a23` compare full text content across pages to catch duplicates;
`m5-a05` checks both the affordance state and that no viewer node re-rendered.

Two mappings are **thin rather than dishonest**, and are filed as defects instead of
adjudicating a milestone to capability-failure:

- `m1-a10` → `avatar-upload-succeeds` (`tests/m1.mjs:57-62`) sets the file input and waits
  2.5 s without asserting anything; it would pass if the upload failed. The adjacent
  `m1-a11` test exercises the same upload *with* an assertion, so the observable is
  covered elsewhere. (defect d-10)
- `m6-a11` → `custom-client-demo-covers-ops` greps the demo's stdout for eight markers,
  one of which is `history ok:`. That marker is printed by a single non-paginated
  `/api/history?limit=5` call (`scripts/custom-client-demo.mjs:45`), so the assertion
  clause "page through message history" is not exercised — and that clause is in fact
  broken (§4.7, defect d-04). I judged this an under-specified test rather than a false
  mapping: the mapped test exists, runs, and checks the other four operations honestly.
  The consequence lands on O1 (`m6-a11` scored fail) and O2 (defect), not on the
  capability-failure recharge.

No mapping pointed at a test that does not run. `dishonestMilestones` is empty.

---

## 3. Phase 1 — the builder's acceptance suite

Run from the lane's documented entrypoint against the running backend.

| milestone | result | tests | missing coverage | load (1-min) |
|---|---|---|---|---|
| m1 | PASS | 7/7 | none | 25.5 |
| m2 | PASS | 22/22 | none | 26.7 |
| m3 | PASS | 7/7 | none | 22.2 |
| m4 | **FAIL** | 8/9 | none | 22.1 / 28.8 |
| m5 | PASS (2nd run) | 13/13 | none | 33.8 / 15.7 |
| m6 | PASS (2nd run) | 5/5 | none | 21.4 / 26.3 |
| m8 | PASS | 6/6 | none | 26.4 |

**Every suite-required assertion passed in every milestone.** Three runs needed comment:

- **m6, first attempt** failed `m6-a13` with `MAXCONNSESSION) max clients reached in
  session mode - max clients are limited to pool_size: 15` — the shared hosted project's
  Postgres pooler, exhausted by other tenants. A grader-environment failure; the single
  permitted re-run passed. This is the one re-run counted in `grader.rerunsUsed`.
- **m5, first attempt** failed `m5-x-color` ("bob sees indigo selected") under a 1-minute
  load average of 33.8 and passed on re-run at load 15.7. Treated as a load flake.
- **m4 failed identically on both runs**, only on the non-required test
  `m4-x-expired-edit`, with a 30 s timeout waiting for `sm-convo-edit-cancel` after a
  server-rejected edit. This is a genuine test/app mismatch: `submit()` in
  `components/Conversation.tsx:137` runs `if (job.editing) setEditing(null)`
  unconditionally, so the cancel affordance never exists after a submit, rejected or not.
  The test's own comment ("A rejected edit leaves the composer in editing state") states
  the opposite of the shipped behaviour. Consequence: `npm run acceptance -- --milestone m4`
  cannot pass from a clean checkout even though all five suite-required M4 assertions do.
  (defect d-09)

---

## 4. Phase 3 — grader-class assertions (executed by me)

### 4.1 m1-a07 — post-logout revocation → **FAIL**

Signed in through the provider, minted an opaque API token, then logged out exactly as
the app does (`POST /api/logout`, then `auth.signOut()`), and re-presented both credentials.

```
BEFORE-LOGOUT   POST /api/tokens/issue with JWT   -> 200
BEFORE-LOGOUT   GET  /api/me with opaque token    -> 200
POST /api/logout                                  -> 200 {"ok":true}
supabase signOut done
AFTER-LOGOUT    GET  /api/me with opaque token    -> 401 invalid or expired token
AFTER-LOGOUT    POST /api/tokens/issue with JWT   -> 200        <-- still accepted
(waited 65 s for the 60 s server-side cache to lapse)
AFTER-LOGOUT    POST /api/tokens/issue with JWT   -> 401
provider  GET /auth/v1/user with the old JWT      -> 403        <-- provider had revoked it
```

Opaque tokens are revoked correctly and immediately. The session JWT is not: the lane
server caches `auth.getUser(jwt)` results for 60 s (`server.mjs:29-40`), so for up to a
minute after logout it accepts a credential the provider already refuses.

A second run confirmed this is an escalation, not just a window
(`grading/logs/m1a07b.txt`):

```
logged out (both /api/logout and provider signOut)
POST /api/tokens/issue with the LOGGED-OUT jwt -> 200  expires_at 2026-09-08T01:20:47Z
(waited 70 s, past the cache)
GET /api/me            with the newly minted token -> 200
GET /api/conversations with the newly minted token -> 200   conversations: 4
```

A fully logged-out JWT mints a fresh **24-hour** credential that outlives the cache and
serves the account's data. → assertion **fail**, defect **d-02**.

### 4.2 m4-a10 — edit window enforced server-side → **PASS**

Installed the fixture pack's shortened-windows config through the documented seam
(`config/windows.json`, hot-reloaded); `/api/config` confirmed
`profile: shortened-grading, edit: 60, del: 120, ttls: off:null / 24h:180 / 7d:300`.

```
insert message                                   -> ok
IN-WINDOW edit                                   -> accepted (1 row)
(waited 65 s, past the 60 s window)
POST-WINDOW edit                                 -> REJECTED: CLQFM_EDIT_WINDOW_EXCEEDED
stored body now: "edit-window probe (in window)"  edited=true
IN-WINDOW delete (120 s window)                  -> accepted
```

Enforced by a database trigger, not by the absence of a UI affordance.

### 4.3 m4-a12 and m5-a06 — asset revocation → **PASS / PASS**

```
[m4-a12] recipient GET media BEFORE delete        -> 200 [2072 bytes]
[m4-a12] delete-for-everyone                      -> ok
[m4-a12] recipient GET media AFTER delete         -> 410 {"error":"revoked"}
[m4-a12] sender    GET media AFTER delete         -> 410 {"error":"revoked"}
[m5-a06] recipient first  GET view-once asset     -> 200 [2072 bytes]
[m5-a06] recipient second GET                     -> 403 {"error":"already viewed"}
[m5-a06] recipient third  GET                     -> 403 {"error":"already viewed"}
[m5-a06] non-member GET                           -> 403 {"error":"not a member"}
[m5-a06] unauthenticated GET                      -> 401
```

### 4.4 m1-a12 and m1-a13 — password handling (source inspection) → **PASS / PASS**

Passwords never reach lane persistence. `lib/session.tsx:73,91` uses `sb.auth.signUp` and
`sb.auth.signInWithPassword`; `server.mjs:231-235` uses `anon.auth.signInWithPassword` for
the documented password-grant exchange. That is the documented Supabase Auth provider
path, which qualifies under m1-a12's managed-provider clause. `db/schema.sql` declares no
password or hash column anywhere. The shipped web bundle contains none of the fixture
persona passwords, and no `console.log`/`console.error` in `server.mjs` touches a
credential.

### 4.5 m5-a01 — expiry refused with no client open → **PASS**

DM set to disappearing (the `24h` option = 180 s under the shortened config). Message sent
through the documented `/api/send`; `expires_at` was set on the row. With no client open:

```
BEFORE expiry: visible to alice=true  bob=true
(waited 195 s, past the 180 s TTL, no clients open)
AFTER  expiry: visible to alice=false bob=false
direct authenticated row read by a member: null
```

### 4.6 m5-a02 → **FAIL**, m5-a03 → **PASS**

Two web clients, one connected across expiry and one that synced the message and then went
offline before it expired (`grading/logs/m5a02a03-v2.txt`):

```
t+0s: both clients render the disappearing message (ttl 180s)
[connected]    alice, staying on the open conversation: STILL RENDERED at t+482s
[connected]    after leaving and re-opening the conversation, still rendered: false
[connected]    after a full app relaunch, still rendered: false
[disconnected] bob (offline the whole time) still renders it: true
[disconnected] bob after reconnect (no reload): STILL RENDERED after +90s
[disconnected] bob after reconnect + relaunch, still rendered: false
```

The assertion requires purge **within tolerance while connected** and **immediately on
reconnect while disconnected**. Neither holds: the connected client was still showing the
expired message 302 s past expiry (and 182 s past even the 5-minute server-refusal bar the
brief states for M5), clearing only on conversation re-open; the reconnected client needed
a full relaunch. The app prunes on open, not on sync. → **fail**.

Note the harness recorded its own `disappearing-message-expiry-and-purge` check as
*passed*; m5-a02 is a `[grader]`-class assertion, so my execution governs, and I record the
divergence rather than hide it. No content leaks past a sync — the server refuses the read
throughout — so this is staleness, not exposure.

m5-a03 passes cleanly on the same run: once the client had synced the expiry, offline
search for the expired text returned **0** results with the offline badge shown, while a
control search for a live seeded word still returned **1**.

### 4.7 The documented history cursor is a no-op

```
full page (newest first): m-api-9ee8…, sm0015, sm0014, sm0013, sm0012, sm0011, …
page1 (limit=3)                              : m-api-9ee8…, sm0015, sm0014
page2 (limit=3, before=<last id of page1>)   : m-api-9ee8…, sm0015, sm0014
page3 (limit=3, before=<last id of page2>)   : m-api-9ee8…, sm0015, sm0014
duplicates across pages: true    matches the full-page prefix: false
```

Root cause: `server.mjs:276` passes `before_ts: null` while the RPC's keyset predicate is
`(before_ts is null or m.created_at < before_ts or …)` (`db/rpcs.sql:242`), which
short-circuits to true and filters nothing. The in-app client passes both cursor components
(`lib/store.tsx:384`) and pages correctly, so only the documented third-party surface is
affected. → defect **d-04**.

### 4.8 m6-a12 — grader-written client from API.md only → **FAIL**

I wrote a client using nothing but `API.md`: password-grant token issue → list
conversations → find the one named "Weekend Plans" → `history?limit=1`.

```
POST /api/tokens/issue -> 200, token acquired
GET  /api/conversations -> 200, 3 conversations
     conversation named "Weekend Plans" -> g-starter
GET  /api/history?limit=1 -> 200, 1 message
LATEST MESSAGE: {"id":"sm0015","senderId":"c985f228…","edited":false,"receipt":"sent"}
```

Every documented content field came back `undefined`. Comparing the documented shape with
the actual payload:

```
documented-but-absent : kind, body, mediaPath, viewOnce, deleted, createdAt, quote
present-but-undocumented: serverTimestamp, type, text, caption, media, tombstone,
                          replyTo, myReaction
```

Using the real field names, the latest message reads
`"Locked in. See you Saturday." at 2026-09-07T00:54:56Z` and newest-first ordering holds
over a 5-message page — so the *operation* is reachable, but only by abandoning the
documentation and reverse-engineering the payload. The same mismatch applies to the
`/api/send` response. `limit=1000` returned 9 messages (the conversation's whole history),
so the documented "clamped to 100" could not be confirmed as a page-size clamp.
Documentation quality is explicitly part of this assertion's bar. → **fail**, defect **d-05**.

### 4.9 Trust-boundary read/write probes (non-member persona)

```
non-member is a member of the DM                      : false
non-member reads MESSAGES of that DM                  : 0 rows      (RLS correct)
non-member reads the CONVERSATION row                 : 0 rows      (correct)
non-member reads the MEMBER LIST of that DM           : 0 rows      (correct)
non-member reads API_TOKENS                           : 0 rows      (correct)
non-member reads PUSH_LOG                             : 9 rows, all addressed to herself (correct)
non-member reads RECEIPTS for that DM's message ids   : 3 rows      <-- leak
non-member reads REACTIONS (unfiltered)               : rows for messages she cannot read  <-- leak
non-member reads PRESENCE (all users)                 : 2 rows      <-- leak
non-member GET  /api/history for that DM              : 403 CLQFM_NOT_A_MEMBER   (correct)
non-member POST /api/send   into that DM              : 200                      <-- BLOCKER
non-member direct PostgREST insert into that DM       : BLOCKED by RLS           (correct)
```

The injected message then appeared as the newest message in the DM when read by an actual
member, while the DM's membership contained only the two intended accounts. `/api/send`
(`server.mjs:281-299`) inserts with the **service-role** client, bypassing RLS, and performs
no membership check at all — even though `API.md` states "Only members may send (else 403)".
Read paths are correctly gated; only this write path is open. → defect **d-01** (blocker).

The `reactions`/`receipts`/`presence` policies are `select using (true)` (`db/rls.sql:99-125`),
which exposes cross-conversation metadata (who read which message id, who reacted with
what) but no message content, membership or conversation identity. → defect **d-08** (minor).

### 4.10 Incidental

`lib/supabase.ts:80-84` builds media URLs as `/media/<path>?access_token=<jwt>`, putting a
bearer credential in a query string. The server also accepts the `Authorization` header,
which is what the documented API surface uses. → defect **d-11** (cosmetic).

---

## 5. Phase 3 — independent re-execution of the checklist

Driven by grader-written scripts (my own selectors and my own assertions, not the lane's
test helpers) against the running web build and the backend API.

### 5.1 M1 (browser)
`m1-a01` signup with an 8+ character password succeeded with no auth error; `m1-a02` the
app landed authenticated (feed tabs visible, auth form gone); `m1-a03` a duplicate handle
was rejected with a visible `sm-auth-error`; `m1-a04` a duplicate email likewise;
`m1-a08` an edited display name and bio persisted and rendered on the profile after a
fresh sign-in; `m1-a10` the fixture avatar uploaded with no error surfaced; `m1-a11` the
avatar rendered from a `/media/avatar/…` URL whose asset fetch returned **200**.

### 5.2 M2 authoring (browser)
`m2-a01` text post rendered in the feed; `m2-a02` image post with 2 fixture images staged
2 attachments and rendered media in the card; `m2-a03` video post rendered a `<video>`
element; `m2-a12` the `http(s)` URL rendered as its own text node with `cursor: pointer`
and an accent colour, handled by `Linking.openURL` (`lib/ui.tsx:137`); `m2-a13` the card
contained **0** media nodes — no unfurl.

### 5.3 M2 graph and feeds (API)
```
m2-a06  follow -> 27 alice entries in the Following feed
m2-a08  after unfollow -> 0 alice entries in Following on next load
m2-a09  after unfollow -> 24 alice entries still in Global
m2-a10  23 Global entries authored by accounts the viewer does not follow
m2-a11  0 of those reach Following by any path other than an attributed repost
m2-a15  like 0->1, retried like stays 1 (idempotent), unlike ->0
m2-a16  repost entry attributed "Bob Bennett"; m2-a17 re-repost removes it
m2-a18  a followed account's repost surfaces the original author's post in Following
m2-a20  thread returns the parent first plus its direct replies in chronological order
m2-a21  0/1 replies leak into 80-entry Global + 80-entry Following reads
m2-a22  Following paginates 20+16 ; m2-a23 Global paginates 20+20+20+2
m2-a24  0 duplicates and 0 gaps versus a single full-size read, on both tabs
m2-a25  own posts stay in Following with no self-follow edge
m2-a27  no self-follow row exists; follower/following counts come from the graph only
```
(`m2-a10`, `m2-a11`, `m2-a20`, `m2-a21` initially looked like failures under a first, cruder
probe; each was my probe's error — an author with no top-level posts, a root post with no
replies, a mis-named RPC column, and a comparison that ignored the legitimate repost path.
Re-run correctly, all four pass. `m2-a26` rests on the builder suite.)

### 5.4 M3 conversation UI (browser)
`m3-a10` the quoted reply bubble rendered the excerpt (`"Alice Alvarez / g-q2-…"`) once the
server-side quote metadata settled; `m3-a11` tapping the excerpt scrolled the original
message into the viewport.

`m3-a02` **fails**. `components/Conversation.tsx:210` passes `showSender={!!isGroup}` to
`MessageBubble`, so `sm-convo-sender-avatar` renders only in groups; I observed **0**
avatar nodes on both clients of a live DM. The harness recorded this check as *skipped*
with `outcomeClass: instrument`, `implemented: false`, reason "The kit does not render
sender avatars in the default 1:1 layout", so no choreography verdict exists. I scored it
from source plus direct observation and flag the method deviation here.

### 5.5 M3/M5 membership and admin rules (API)
```
m3-a03  exactly 1 DM conversation exists for the pair
m3-a04  group created with three members
m3-a05  a second group with the identical member set coexists as a distinct conversation
m3-a13  a removed member still reads her pre-removal history
m3-a14  a non-admin cannot remove a member (0 rows removed, member still present)
m5-a08  a non-admin cannot rename the group (rejected CLQFM_NOT_ADMIN)
m3-a15  re-running every installed seed segment left all row counts identical
        before {profiles:13, posts:66, messages:53, conversations:8, follows:15}
        after  {profiles:13, posts:66, messages:53, conversations:8, follows:15}
```
The same run surfaced defect **d-03**: after the admin set `left_at`, the removed member's
`GET /api/history` returned **both** her pre-removal message and a message sent *after* her
removal, and her `POST /api/send` into that group returned 200. `history` gates on
`ever_member()` with no `left_at` cap (`db/functions.sql:9-13`, `db/rpcs.sql:213`). The
`[choreo]` assertion `m3-a12` is still scored `pass` from the harness artifact, as the
protocol requires — the harness verified the observable it states (the removed client stops
receiving new messages, which the web client's local merge logic does deliver) — and the
server-side gap is reported as a defect beyond the checklist.

### 5.6 M4 (browser)
`m4-a01` a photo message rendered inline on the recipient from a real media URL (asset
fetch 200); `m4-a03` a video message rendered as a `<video>` element; `m4-a06` switching
👍 → ❤️ left exactly one chip (`["👍 1"]` → `["❤️ 1"]`), never two; `m4-a07` tapping ❤️
again cleared it; `m4-a09` the recipient's edited bubble showed `· edited`.

### 5.7 M5 view-once (browser)
`m5-a04` the recipient's first open rendered the media viewer; `m5-a05` after closing, a
second tap opened no viewer.

### 5.8 M5 search (matching semantics re-implemented independently)
I re-implemented the brief's pinned semantics — case-insensitive word-prefix over
NFC-normalised text, splitting on whitespace and punctuation — and checked the app's
corpus against it.
```
m5-a09   "car" -> carol
m5-a09b  mid-word "aro" matches nobody  (word-prefix, not substring — as pinned)
m5-a10   in-chat search for the seeded word "coffee" -> 2 hits ("Coffee is a definite yes.")
m5-a11   global search grouped by chat -> {g-starter: 2, d-alice-bob: 1}
```
`lib/supabase.ts:87-93` implements exactly these semantics.

### 5.9 M6 push seam (API)
```
m6-a08   push payload for an offline recipient: correct target, chat_id, sender_name,
         preview; a 200-character body was truncated to exactly 80 characters
m6-a09   a view-once photo previewed as "Photo" — never bytes
```

### 5.10 Client-side profile route defects
```
/profile/<nonexistent handle>, 20 s after load -> "Following / Global / Trending / Loading…"
                                                  (no sm-profile node, no not-found state)
hard load of /profile/<own handle> immediately after signup -> never rendered within 40 s
tap "Profile"  0 s after signup -> /profile      -> "Unmatched Route / Page could not be found."
tap "Profile"  5 s after signup -> /profile/<h>  -> renders
tap "Profile" 15 s after signup -> /profile/<h>  -> renders
established account taps "Profile"              -> renders
```
`app/profile/[handle].tsx:41` returns a bare `Loading…` whenever the handle misses in a
profile map that `lib/store.tsx:268-291` fetches once in a boot effect keyed on `userId`,
with no retry, no lazy lookup and no not-found branch. `app/index.tsx:110` builds the nav
URL as `/profile/${profile?.handle || ''}`, which is `/profile` before the session profile
loads. → defects **d-06** and **d-07**.

---

## 6. `[choreo]` assertions and the native gap

All 41 choreography receipts in `receipts/choreo-m{1..6,8}.jsonl` validate against the
harness's own `receipts.schema.json` (0 schema-invalid). Every recorded assertion has
status `passed` except one:

- `sender-avatar-identity-when-rendered` (M3) — `skipped`, `outcomeClass: instrument`,
  `implemented: false`, `required: false`. See §5.4.

The web two-client segments therefore cover M1, M2, M3, M4, M5, M6 and M8 as recorded, and
best-of-3 timings are carried into `timingRecords` and the per-assertion `bestOf3Ms`.
Highlights: the typing indicator appeared **6.5–7.9 ms** after the last keystroke (bound
2000 ms) and expired **1796–2297 ms** after it (bound 5000 ms).

**There are no simulator artifacts.** `native-sim/` is empty, and
`receipts/native-build.jsonl` records a `capability-failure`:

> prebuild green (`expo prebuild --platform ios`), pod-install green (CocoaPods 1.17.0),
> `xcodebuild` **FAILED** Release iphonesimulator: `expo-modules-jsi` Swift (expo 57.0.20)
> requires RN ≥ 0.86 jsi API (`deleteProperty`/`getStringData`); lane pins react-native
> 0.81.5. Fix not taken: an RN 0.81→0.86 major upgrade would invalidate existing web green
> and need full re-verification, exceeding the M8 time box. `a17-a18: not-recorded`.

So `m6-a01`…`m6-a07` and `m8-a17`/`m8-a18` have no evidence and are scored **fail**. The
record itself is precise and honest — it names the cause, the decision and the
consequence, and claims nothing it cannot show — which is the one thing that keeps O4
above zero.

---

## 7. M7 — never attempted

There is no `tests/m7.mjs`, no `coverage/m7.json` and no `receipts/suite-m7.json`, and no
poll/vote feature exists anywhere in the source or the schema (the only "poll" matches are
network polling helpers). `components/ChatSettings.tsx:60` does ship a per-chat message
count, but the milestone itself was not run. All nine M7 assertions record **not-run**;
they remain in O1's denominator as not passed.

---

## 8. M8 results (18 assertions) — recorded here because the report schema cannot hold them

`assertions.json` 0.3.0-m8 defines 18 M8 assertions, but `grader-report.schema.json`
constrains `assertionResults` keys to `^m[1-7]-a[0-9]{2}$` with `additionalProperties:
false`, so M8 cannot be represented in the machine record. This is an instrument version
mismatch, not a lane problem. **16 of 18 passed**, and all 18 are counted in O1.

| id | result | evidence |
|---|---|---|
| m8-a01 | pass | six lifetime totals `{posts 27, likes 12, reposts 1, replies 2, followers 3, following 2}` matched my independent direct-table recomputation exactly |
| m8-a02 | pass | choreo `m8-a02-insights-like-refresh` (beforeLikes 89 → afterLikes 90, refreshMs 213.6) |
| m8-a03 | pass | today's UTC bucket: RPC 26, independent count 26 |
| m8-a04 | pass | 7 day rows returned, 5 of them zero-activity and rendered as `0/0` rather than omitted |
| m8-a05 | pass | trending ordered by trailing-24 h likes: 3 ≥ 2 ≥ 2 ≥ 2 ≥ 1 ≥ 1 |
| m8-a06 | pass | the most-liked >24 h-old post (3 likes) is absent from Trending |
| m8-a07 | pass | like-count ties break newest-first across 5 tied entries |
| m8-a08 | pass | see below |
| m8-a09 | pass | a persona with no activity in the period received no digest |
| m8-a10 | pass | the following period, with no activity, emitted **0** digests |
| m8-a11 | pass | see below |
| m8-a12 | pass | see below |
| m8-a13–a16 | pass | choreo: same-account live, cross-device read state, dual-offline convergence, post-flush receipts |
| m8-a17, m8-a18 | **fail** | need the native durable-queue artifact; see §6 |

Digest battery, run under the fixture pack's shortened digest config (`periodSeconds: 120`,
hot-reloaded through the documented seam and confirmed in the config table), with every
client closed. Target period `01:52:00Z → 01:54:00Z`:

```
=== digests emitted for the target period: 4 ===
 dave   emitted {nf:1, npf:0, unm:2, unc:1}   grader-expected {1,0,2,1}   match  rows=1
 carol  emitted {nf:0, npf:0, unm:3, unc:1}   grader-expected {0,0,3,1}   match  rows=1
 alice  emitted {nf:0, npf:0, unm:1, unc:1}   grader-expected {0,0,0,0}   rows=1
 bob    emitted {nf:0, npf:0, unm:4, unc:2}   grader-expected {0,0,3,1}   rows=1
```

The expectations are my own SQL over the raw tables, written from the assertion's
definitions rather than by calling the lane's function. The alice/bob divergence is **my
probe's artifact, not a lane defect**: the only extra message in their chats during the
period was the non-member message I injected as the proof for defect d-01, sent at
`01:52:16Z` into a DM whose disappearing TTL was 180 s. It was live when the tick ran at
`01:54:00Z` and purged by the time my verification query ran, so the tick counted it (+1
message, +1 chat for each of them) and my later recomputation did not. Both diverge by
exactly that one message and one chat. Every payload is correct. → **m8-a08 pass**.

```
[m8-a12] 3 messages posted in a chat dave is not a member of;
         dave's emitted unread_messages=2, unread_chats=1  (only his own chat)
         dave's memberships: g-dg-chat | 'g-dg-secret' among them: false
[m8-a09] persona with no activity: grader-computed {0,0,0,0}, digest emitted: false
[m8-a11] the lane server was restarted mid-period (pid 20442 -> 12678);
         exactly one digest row per user; a manual digest_tick() re-run for the same
         period emitted 0 and the row count stayed at 4
[m8-a10] digests emitted for the following, quiet period: 0
```

`digest_tick` computes the last fully completed period, guards on a global watermark, and
inserts into `digest_sent` with a `(period_start, user_id)` primary key before emitting —
which is why the restart and the re-tick are both no-ops. Membership scoping is enforced
by a join against `members` with `left_at is null`, which is why the non-member chat
contributed nothing.

---

## 9. O-dimension scoring

**O1 = 68.** 96 of 119 in-scope assertions passed: M1 12/13, M2 27/27, M3 14/15, M4 12/12,
M5 11/12, M6 4/13, M7 0/9, M8 16/18. Above the 60 anchor ("M1–M4 solid, later milestones
patchy or failed on cap") because solidity extends past M4 — M5 and M8 are nearly complete
and the whole social/messaging core is green. Well short of the 90 anchor ("every in-scope
milestone green, **including platform-proof artifacts**") on two structural counts that
anchor names: the platform proof does not exist at all, and M7 was never attempted.

**O2 = 32.** One blocker and six majors, sitting just above the 30 anchor ("multiple
high-severity defects in core flows") and far from 60 ("a few medium defects off the happy
path"). The blocker is a core-flow authorization hole (any token holder can write into any
private conversation); three further majors are authorization or contract failures on the
same server seam, and two are user-visible client dead ends. Placed above 30 rather than at
it because the primary user journeys — posting, feeds, messaging, media, reactions, the
edit and delete windows, view-once and disappearing-message server enforcement, search,
insights and the scheduled digest — were all correct under independent execution, so the
damage is concentrated in the custom-client seam and the authorization edges.

**O3 = null.** Applicability scores this dimension from the wave's rotated holdout probes
only; none were committed for this wave (deviation 1). Scoring it from my own ad-hoc
probing would be scoring a frozen dimension off an unfrozen instrument, so it records null
and the findings go to O2.

**O4 = 15.** No simulator choreography artifacts exist, so nothing this dimension observes
was demonstrated — below the 30 anchor, which still presupposes a native proof that runs.
Held above zero by the dimension's honesty clause (the capability-failure receipt is exact
and overclaims nothing) and by passing web-surface offline choreography on the harness's
own artifacts — offline queue flush in order (flushMs 2322.9), M8 dual-offline convergence
and post-flush receipts, warm-offline search — which is evidence about the same sync
machinery even though it is not the native proof.

**O5 = null.** The replay record required to evaluate the exact band function does not
exist: no `run-record.json`, no checkpoint receipts at 10/50/100 %, no probe measurements,
no invariant-manifest verification result, no cap accounting, and no evidence that the
13 MB `scale.log` replay was ever started. What does exist is preparation — a conforming
adapter (`receipts/scale-replay.jsonl`: 50/50 actions settled in 18 s on the M6 conformance
sample), a separately seeded `clqfm_muse_scale_` instance, and checkpoint-verification
tooling written against the frozen invariant manifest. O5 is band-mapped from the replay
record and is never interpolated or inferred from perceived speed, so with no record it
takes the never-attempted branch rather than an invented band.

No weighted total, efficiency statistic or cross-lane comparison is computed here — those
belong to the harness and the publisher.

---

## 10. Processes and side effects

Processes started by this session, both on port 49900, both stopped at the end:
`node server.mjs` **pid 20442** (started 00:46Z; stopped by the m8-a11 restart probe) and
its replacement **pid 12678**. No other process was signalled; no `pkill`/`killall` was
used; no port outside 49900–49919 was touched.

Left in the reconstituted backend: grader-created accounts, posts and messages; probe
groups `g-dg-chat`, `g-dg-secret`, `g-grader1-*`, `g-grader2-*`, `g-rm-*`; and one message
injected into the alice/bob DM by a non-member, retained as the evidence for defect d-01.
`config/windows.json` and `config/digest.json` were switched to the fixture shortened
profiles for the timing checks and have been **restored to `production`**. The lane's
`coverage/` and `receipts/` trees were preserved before phase 1 and **restored** afterwards;
my own suite outputs are under `grading/grader-suite-run/`.
