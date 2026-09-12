# Grader evidence and action trace — lane `astra-snapback2`

Sanitized published artifact. Fixture passwords, bearer tokens and session
identifiers are redacted; opaque backend IDs are shown truncated or as
`<placeholder>`. Raw transcripts are not published.

- **Lane backend:** `snapback2-0.0.24` (public npm package), Expo Router web client.
- **Run scope:** full (M1–M8 + scale replay).
- **Grader:** family `claude`, model `claude-opus-5`, fresh session, no builder context.
- **Wave:** `astra`. **Probe set:** none committed (`none-uncommitted`).
- **Session outcome:** completed. One re-run used (M4 choreography segment).

## Contamination control

The builder's `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and
`run-log.md` are present in the lane and were **not** opened at any point.
`README.md`, `API.md`, `AGENTS.md`, `package.json`, `coverage-manifest.json`,
`run-record.json`, the lane source, and the lane's evidence/receipt artifacts
were read, as the protocol requires. No other lane under
`/home/ccheever/clique-ri-20260911/lanes/` was read. The session is **not**
contaminated.

## Host, processes and ports

Ubuntu Linux x86_64, AMD EPYC 9454, shared with other sessions.
Node v24.13.1, Playwright 1.62.1 / Chromium 151 from the shared cache.

Processes the grader started, and killed at the end — no `pkill`/`killall` was
used at any point:

| PID | What | Port |
|---|---|---|
| 2249803 | `npx snapback2 dev --port 53100` (backend) | 53100 |
| 2359932 | same backend, restarted deliberately mid-digest-period for m8-a11 | 53100 |
| 2252521 / 2252534 / 2252535 | `npm run dev` → `expo start --web --port 53101` | 53101 |

Only ports 53100 and 53101 were bound, both inside the assigned 53100–53119 range.

## Pre-flight integrity checks

| Check | Result |
|---|---|
| `diff -r instrument/choreography lane/choreography` | identical except the lane's `node_modules/` + `package-lock.json` |
| `diff -r instrument/metering lane/metering` | identical |
| `diff -r instrument/ui/src lane/ui/src` | 8 files differ; **every** hunk adds only an `aria-valuetext` mirror of an already-present `accessibilityValue.text`. No visual, data-prop or native-semantic change. Declared in the lane README and retained as a patch. Accepted. |
| `diff instrument/fixtures/config/* lane/config/*` | all four window/digest configs byte-identical to the frozen fixtures |
| backend window config in force during grading | `snapback/windows.q` generated from `config/windows.shortened.json`: edit 60 s, delete 120 s, 24h→180 s, 7d→300 s. `snapback/digestconfig.q`: period 120 s, anchor 0. This is the fixture pack's shortened-windows/digest profile, as grading requires. |
| `npx snapback2 check` | `ok 4fd78d96 58 ops` |

## Phase 1 — builder suite, clean invocation

Run as documented (`npm run acceptance -- --milestone mN`) against the
grader-started backend and web client. All seven in-scope milestones green:

| Milestone | Result |
|---|---|
| m1 | pass — checks duplicate-handle, signup, profile-edit, avatar, duplicate-email |
| m2 | pass — 22 assertions marked |
| m3 | pass |
| m4 | pass |
| m5 | pass |
| m6 | pass |
| m8 | pass |

M7 has no suite: `run-record.json` records `m7.status = "not-run"` with reason
"Reserved for separate fresh session by user", and the coverage manifest's
`scope` omits M7.

<a id="coverage"></a>
## Phase 2 — coverage-manifest spot-verification → **honest**

Mechanical completeness: every `suite-required` assertion of the manifest's
declared scope (M1–M6, M8) is mapped — 58 mappings, 0 missing, 0 mappings
pointing at a non-suite-required or unknown ID.

Every acceptance script was read in full. Sixteen mappings were sampled and
their observable independently re-executed by the grader. Representative
findings:

- `m8-a01 → independent-six-total-counts` reconciles the Insights read-model
  against **raw server tables** (`posts`, `likes`, `reposts`, `follows`), not
  against itself. Grader recomputed the same way and matched exactly
  (`{posts:146, likes:154, reposts:7, replies:17, followers:2, following:2}`).
- `m6-a13 → frozen-50-action-schema-and-actual-state` runs the frozen fixture
  validator and then an independent actual-state reconciliation of all 13
  action classes. Grader re-ran both: validator `valid ... 50 actions, 0 markers,
  13 verbs`; receipts 50/50 `committed`, 13 distinct verbs.
- `m2-a24 → page-no-gaps-no-duplicates` pages both feeds fully and asserts row-id
  uniqueness plus recovery of all 25 seeded rows. Grader reproduced: global
  307 rows / 0 dupes / 25-of-25, following 138 rows / 0 dupes / 25-of-25.
- `m3-a15 → all-segments-idempotent` re-installs every installed starter segment
  twice and diffs conversation and history ID lists. Grader reproduced against a
  three-way snapshot (conversations 17→17, alice posts 146→146, DM history 88→88).

Three mappings are **thinner than their assertion text but not dishonest**; each
was independently confirmed by the grader rather than taken on the suite's word:

| Assertion | Suite asserts | Grader independently confirmed |
|---|---|---|
| m2-a13 "no preview card" | `iframe count === 0` | 0 `sm-feed-media` nodes, 0 iframes, the only `<img>` is `sm-feed-author-avatar`, body text is the bare URL |
| m2-a16 "reposted by {display name}" | API `actor.principal === B` | rendered `↻ Reposted by Bob Bennett` via `sm-feed-repost-attribution` |
| m4-a07 "taps ❤️ again: reaction removed" | API `react(emoji:null)` | server ends with 0 reactions after re-tapping the active emoji |

One provenance caveat: `coverage-manifest.json`'s `validated: true` flag and
`evidence/coverage-validation.log` are produced by the lane's own
`scripts/coverage.mjs`, which re-derives the manifest from the per-milestone
coverage receipts the suites themselves write — it is lane-self-attestation, not
an externally issued harness validation receipt. The `honest` verdict above
therefore rests on the grader's own reading of all seven acceptance scripts and
independent re-execution of the sampled observables, not on that flag.

No milestone is adjudicated `capability-failure`.

<a id="m1"></a>
## Phase 3 — independent checklist execution

All grader scripts are the grader's own; none reuse the lane's test helpers.

### M1 — accounts and profiles (13/13 pass)

- **m1-a01/a02/a03/a04** (browser, fresh signup): a new email + 15-character
  password signed up and landed authenticated; handle `alice` was refused with a
  visible `sm-profile-error`; re-signing up with the same email produced a
  visible `sm-auth-error` ("email is already registered").
  Screenshots `m1-a03-duplicate-handle.png`, `m1-a04-duplicate-email.png`.
- **m1-a07 [grader]**: a session token read `profiles.mine` successfully, then
  `auth.logout()` was called from the issuing client; a *separate* client holding
  the same bearer was refused with `E_AUTH_SUPERSEDED`. Server-side revocation
  confirmed.
- **m1-a08**: profile edit re-read through a brand-new login session — display
  name and bio persisted.
- **m1-a10/a11**: fixture avatar uploaded; the asset fetched back (767 bytes);
  the own-profile screen renders a decoded image (`naturalWidth > 0`).
  Screenshot `m1-a11-avatar-profile.png`.
- **m1-a12 [grader, source]**: `snapback/schema.q:1` is `use identity password`
  — the backend's built-in auth. Verified in the backend binary that this is a
  named adaptive KDF at standard published parameters: the binary embeds the
  `argon2 0.5.3` crate and the encoded form
  `$argon2id$v=19$m=19456,t=2,p=1$…`, i.e. argon2id at the OWASP-recommended
  19 MiB / t=2 / p=1 profile.
- **m1-a13 [grader, source]**: the stored credential in `.snapback/store.sqlite`
  is an `argon2id$v=19$m=19456,t=2,p=1` PHC string. A byte-level scan for a
  fixture password in plaintext across `.snapback/` (SQLite store, WAL, blobs,
  `log.jsonl`), `evidence/`, `artifacts/`, `replays/`, `snapback/`, `src/`,
  `app/` and `scripts/` returned nothing. The fixture credential files
  themselves live outside the app and are the declared test-fixture exception.

<a id="m2"></a>
### M2 — posts and the follow graph (27/27 pass)

Independently re-executed through the custom-client API: post creation (text,
2-image, video), follow/unfollow projection (including that older posts leave
the Following feed), Global-feed retention after unfollow, unfollowed-author
visibility split, idempotent like set-state (double `active:true` → count 1;
`active:false` → 0), repost toggle and attribution, a followed user's repost
surfacing the original author, direct-reply thread ordering with nested replies
excluded, replies absent from both feeds, implicit self-follow feed membership
for 25 own posts with follower/following counts unchanged, and full pagination
(page 1 = 20 rows, `next` present, 0 duplicates, all 25 seeded rows recovered in
both tabs).

Browser-verified separately: the URL in a text post renders as `role="link"` and
tapping it calls `window.open` with exactly that URL (system browser), with no
unfurl card; feed pagination in the UI reached 140 (Following) and 100 (Global)
rendered rows with zero duplicate rows; the repost attribution string renders as
`↻ Reposted by Bob Bennett`.
Screenshots `m2-a12-link.png`, `m2-a13-nopreview.png`.

<a id="m3"></a>
### M3 — messaging core (15/15 pass)

API-verified: `dmCreate` from either direction and repeated returns one and only
one channel per pair; two groups with identical membership coexist as distinct
conversations with correct 3-member rosters; a non-admin's `memberRemove` is
rejected `ADMIN_REQUIRED` with membership unchanged; a quoted reply carries the
quoted excerpt; re-installing all three starter segments changed nothing.

Additionally reconfirmed by hand (beyond the checklist): the receipt aggregate
is monotonic `sent → sent → delivered → read`, only flips to `read` once **every**
original recipient has seen, a member added *after* the send never enters that
message's audience, and a removed member drops out of the active audience while
the aggregate stays `read`.

<a id="m4"></a>
### M4 — media, reactions, edit/delete (12/12 pass)

- **m4-a01/a03**: recipient fetched the photo (2 100 B) and video (49 779 B,
  duration 5 000 ms) message assets from a query result.
- **m4-a06/a07**: 👍 → ❤️ replaced in place (always exactly one reaction per
  user); re-tapping the active emoji cleared it to zero.
- **m4-a09**: a UI edit inside the window re-rendered the *same* bubble with an
  `edited` label — server message count delta 0 and `editedAt` set.
  Screenshot `m4-a09-edited-label.png`.
- **m4-a10 [grader]**: under the shortened window an edit at t+0 s committed and
  the same edit at **t+66 s was refused server-side** with
  `EDIT_WINDOW_EXPIRED`; the stored body remained the in-window text. This is a
  server refusal, not the absence of a UI affordance.
- **m4-a12 [grader]**: the photo asset served 2 118 bytes before
  delete-for-everyone; after it, the **same URL** is refused with "asset is
  unavailable" and the row is tombstoned.

<a id="m5"></a>
### M5 — ephemeral, chat config, search (12/12 pass)

- **m5-a01/a02/a03 [grader]**, with the fixture pack's shortened windows
  (24h option = 180 s):
  1. A control message was sent while the DM was **off**, then the DM was set to
     disappearing, then the ephemeral message was sent (`expiresAt` = +180 s).
  2. Carol viewed the message in the browser and found it in search, then the
     browser was closed — **every client closed across expiry**.
  3. After the TTL: the server no longer returns the expired message in history
     or in search, while the control message from the same chat is still served.
  4. Relaunching from the **same persistent browser profile** (IndexedDB
     preserved): the expired bubble is gone, the cached control message still
     renders. Screenshot `m5-a02-purged.png`.
  5. Connectivity then cut (`Offline — synced messages` indicator shown): offline
     search for the token returns only the control message.
     Screenshot `m5-a03-offline-search.png`.
  An earlier attempt was invalidated by a grader setup error (the "control"
  message had itself been sent into an already-disappearing chat); it was
  rebuilt and re-run rather than reported.
- **m5-a04/a05/a06 [grader]**: the first explicit view returned 2 110 bytes; a
  second view was denied ("already viewed"); a **plain, non-viewing** direct
  fetch of the same asset URL afterwards is refused server-side, and a
  non-member's fetch is refused with "asset is unavailable".
- **m5-a08**: non-admin rename rejected `ADMIN_REQUIRED`, title unchanged.
- **m5-a09**: `car` → Carol, `CAR` → Carol (case-insensitive), `chen` → Carol
  (prefix of the *second* word), and `arol` correctly does **not** match — i.e.
  genuine word-prefix matching, not substring.
- **m5-a10/a11**: in-chat search is scoped to the searched chat; global search
  returns rows each carrying a `chat {id,title}` grouping key across 2+ chats and
  renders them under chat headings. Screenshot `m5-a11-search-grouping.png`.

<a id="m6"></a>
### M6 — offline writes, push seam, custom-client API (6 pass, 7 not-run)

- **m6-a08/a09**: with Bob's clients closed and his absence confirmed through the
  backend's presence view, the logged push payload carried
  `targetUserId=<bob>`, `chatId=<dm>`, `senderDisplayName="Alice Alvarez"` and a
  preview of exactly 80 characters; the clip logged `"Video"`; the view-once
  photo logged exactly `"Photo"` and its caption text appears in **no** logged
  payload.
- **m6-a10/a11**: `scripts/custom-client-demo.mjs` run standalone returned
  `{"pass":true}` covering authenticate, list-conversations, page-history,
  send-text, poll-new-message, issued-token and logout-revokes-token.
- **m6-a12 [grader]**: a client written **only from `API.md`**, without reading
  lane source, paged `groups.mine` until `conversation.title === "Proof Trio"`
  (found after 3 rows), then read `external.history` and took `data[0]`. Every
  documented field (`id, conversationId, senderId, timestamp, type, text, media,
  edited, tombstone, replyTo, reactions, receipt`) was present; the documented
  one-message page size and newest-first ordering held, and the documented
  cursor continuation worked. The documentation was sufficient with no guesswork.
- **m6-a13**: frozen validator green on `sample-50.log`; adapter receipts
  50/50 committed, 13 verbs, plus an independent actual-state reconciliation.
- **m6-a01 … m6-a07: not-run.** See [Native proof](#native).

<a id="m7"></a>
### M7 — day-2 evolution (0 pass, 9 not-run)

`run-record.json` records `m7.status = "not-run"` ("Reserved for separate fresh
session by user"), and the coverage manifest scope omits M7. No poll surface, no
message-count backfill and no pre-M7 snapshot exist, so `m7-a08`'s snapshot
comparison has no baseline. All nine assertions record `not-run`; per O1's rule
they still count as not passed in the denominator.

<a id="m8"></a>
### M8 — insights, digest, multi-device (16 pass, 2 not-run)

> Recorded here rather than in `assertionResults` because
> `grader-report.schema.json` restricts that map to `^m[1-7]-a[0-9]{2}$` with
> `additionalProperties: false`, while `assertions.json` and
> `applicability.json` (0.3.0-m8) both place M8 in full-run scope. These results
> are counted in O1.

| ID | Result | Evidence |
|---|---|---|
| m8-a01 | pass | Insights six lifetime totals reconciled against raw `posts`/`likes`/`reposts`/`follows` tables — exact match |
| m8-a02 | pass | choreography `m8-a02-insights-like-refresh` |
| m8-a03 | pass | a post created now increments the last bucket (51→52); bucket day == `floor(now/86400000)` (UTC boundary) |
| m8-a04 | pass | 7 contiguous day buckets returned, 3 of them zero-valued and still rendered |
| m8-a05 | pass | the 8-like trailing-24 h post ranks first |
| m8-a06 | pass | a 48 h-old post with 8 likes is absent from Trending (ranking expiry enforces the window) |
| m8-a07 | pass | 6-like tie broken newest-first (tieNew index 1 before tieOld index 2) |
| m8-a08 | pass | see the digest experiment below |
| m8-a09 | pass | the persona with no activity received no digest |
| m8-a10 | pass | the next period, with no activity, produced 0 digest rows and 0 digest pushes |
| m8-a11 | pass | the backend was deliberately stopped and restarted mid-period; exactly 5 rows and 5 pushes, one per active user. `digestHistory` also carries `unique byTargetPeriod: target, periodStart` |
| m8-a12 | pass | 5 messages in a chat the target is not a member of contributed nothing to the target's counts |
| m8-a13–a16 | pass | choreography (same-account live delivery, cross-device read state, dual warm-offline convergence, receipts after flush) |
| m8-a17/a18 | not-run | native simulator — see [Native proof](#native) |

**Digest experiment (m8-a08 … m8-a12).** Shortened config: 120 s period anchored
at 00:00 UTC. The target's inbound graph was quiesced, then the grader aligned to
a fresh period boundary and produced exactly: 1 new follower, 2 posts by the one
account the target follows, 3 unread messages across 2 chats, plus 5 messages in
a group the target is **not** in. All grader clients were then closed and the
backend was restarted mid-period. After the period completed, the target's single
digest row and its single logged push both read
`newFollowers 1 / newPostsInFollowing 2 / unreadMessages 3 / unreadChats 2` —
exactly as constructed, with the non-member chat's traffic excluded. Across all
personas: 5 digests, 5 pushes, one per active user; the quiet persona and the two
send-only personas received none.

<a id="choreo"></a>
### Choreography ([choreo]-class assertions)

The grader ran the **frozen harness itself** (the lane's byte-identical copy,
verified above) with grader-owned receipts under `grading/receipts/`, rather than
reading the builder's stored receipts. Two-client web segments were executed by
the harness; simulator assertions were never re-driven by the grader.

| Segment | Outcome | Notes |
|---|---|---|
| m1 | green | 3 assertions |
| m2 | green | 9 assertions; `follow-unfollow-live-projection` and `repost-following-feed-surface` each had one failing attempt inside best-of-3 |
| m3 | green | 7 assertions; `typing-indicator-within-2s-expires-within-5s` had one failing attempt inside best-of-3 |
| m4 | **green on re-run** | attempt 1 failed `video-message-live-playback` (10 s locator timeout on the recipient bubble); attempts 2 and 3 green — see defect d-02 |
| m5 | green | includes `disappearing-message-expiry-and-purge` (211.6 s) and `view-once-single-view-and-refusal` |
| m6 | green | `offline-message-queue-flush-in-order` (web-scoped segment; native re-scope is documented in the frozen `choreography/simulator.md`) |
| m8 | green | 5 assertions, all keyed by frozen assertion ID |

<a id="native"></a>
### Native (simulator) proof — unavailable

`evidence/simulator-status.json` records `pass: null` for both M6 and M8 with the
reason "Ubuntu Linux x86_64 host has no Apple iOS simulator. Hermes exports are
not simulator proofs." The lane's `artifacts/m*-ios/` trees are Expo/Hermes
bundle exports (`.hbc` + `metadata.json`), recorded in `run-record.json` as
native artifacts but never claimed as simulator execution; the lane README states
"An iOS bundle export is not simulator proof."

The grader accepts that framing and does **not** accept a web export as native
proof. `m6-a01 … m6-a07`, `m8-a17` and `m8-a18` are graded `not-run`. This is a
host limitation honestly declared by the lane, not a concealed gap — but it does
mean no cold-start-offline behaviour was demonstrated at all, which is what caps
O4.

<a id="timing"></a>
### Timing-sensitive checks (best-of-3, with machine load)

The host is shared. `uptime` 1-minute load average is recorded beside each
measurement set. All values are from the grader's own harness runs.

| Assertion | Measurements (ms) | Best | Verdict | Load at run |
|---|---|---|---|---|
| m1-a09 profile edit live | 960.9 / 826.4 / 1397.0 | 826.4 | pass | 1.80 (sample at run start) |
| m2-a04 feed post live (text) | 1512.0 / 1675.6 / 412.1 | 412.1 | pass | 2.70 → 3.73 (bracketing samples) |
| m2-a07 follower count live | 9108.6 / 14116.0 / 13286.4 | 9108.6 | pass (1 attempt failed) | 2.70 → 3.73 |
| m2-a14 like count live | 2086.7 / 1727.7 / 1932.7 | 1727.7 | pass | 2.70 → 3.73 |
| m2-a19 reply count live | 1953.9 / 2355.4 / 2568.2 | 1953.9 | pass | 2.70 → 3.73 |
| m3-a01 DM live both clients | 2560.7 / 2641.5 / 2859.5 | 2560.7 | pass | 2.70 → 3.73 |
| m3-a06 typing within 2 s | 13073.5 / 13536.0 / 13738.5 (attempt wall time; the 2 s bound is enforced inside the harness assertion) | 13073.5 | pass (1 attempt failed) | 2.70 → 3.73 |
| m3-a07 typing expires within 5 s | same assertion as above | — | pass | 2.70 → 3.73 |
| m4-a02 photo live render | 5993.4 / 2617.6 / 2130.6 | 2130.6 | pass | 4.02 (sample at run start) |
| m4-a04 video live playback | 16823.1 (fail) / 8727.6 / 7247.3 | 7247.3 | pass on best-of-3 | attempt 1 inside the 2.70 → 3.73 bracket; attempts 2 and 3 at 3.73 and 4.02 |
| m4-a05 reaction live | 2959.9 / 1454.6 / 1495.8 | 1454.6 | pass | 4.02 |
| m4-a08 edit live | 420.0 / 1673.5 / 1041.2 | 420.0 | pass | 4.02 |

Session-wide 1-minute load average ranged **0.47 – 4.02**.

## Phase 4 — holdout probes: not run

No probe set was hash-committed before this wave, so this phase was skipped by
the run wrapper. `wave.probeSetSha256` is the sentinel `none-uncommitted` and
`probeResults` is empty. No probes were invented. Consequently **O3 is recorded
null**: its rule admits only the wave's secret rotated holdout probes as input,
and improvising probes to fill that slot would break the rule. The
grader's own trust-boundary sweep below is reported as O2 defect evidence only.

<a id="trust"></a>
## Trust-boundary sweep (defect-hunting input to O2, not O3)

21 probes against a private group the probing account is not a member of, and
against unauthenticated access. **20 of 21 correctly denied.**

| Probe | Result |
|---|---|
| outsider reads app history of that group | denied |
| outsider reads enriched `external.history` of that group | denied |
| outsider reads `groups.info` | denied |
| outsider sends into the group | rejected `NOT_MEMBER` |
| outsider adds themselves as a member | rejected `ADMIN_REQUIRED` |
| outsider reacts / edits / unsends someone else's message | rejected `NOT_FOUND` (×3) |
| outsider reads receipts / reactions of that message | denied (×2) |
| outsider fetches the group photo asset by URL | refused "asset is unavailable" |
| outsider global message search for the private token | 0 hits |
| outsider chat-scoped search inside that group | rejected |
| removed member reads messages sent after removal | denied |
| reading another user's digest history | own rows only |
| unauthenticated trending / global feed / people search / conversation history | refused `E_AUTH_REQUIRED` (×4) |
| non-admin promotes themselves to admin | rejected `ADMIN_REQUIRED`; role stayed `member` |
| **outsider marks a receipt on someone else's message** | **committed** — see d-05 |

The one permitted call was investigated: `messages.mark` only touches
`messageReceipts[messageId, viewer]`, which does not exist for a non-recipient,
so it is a verified no-op. It is also **not** an existence oracle — `mark` returns
`committed` identically for a fabricated non-existent message id, and
`react`/`edit`/`unsend`/`receipts` return identical refusals for real-but-private
and non-existent ids alike. Classified cosmetic.

Note on message IDs: they are sequential (`…-0000000001b24801`), so enumeration is
cheap; the uniform refusals above are what makes that harmless.

<a id="d-01"></a>
## Defect d-01 (major) — edit addressed to the optimistic draft id

**Reproduction.** In the web client, send a message and tap **Edit** on it
before its optimistic draft row has been reconciled with the server row
(~≤1 s). Change the text and send.

**Observed.** The client issues
`{"op":"messages.edit","args":{"messageId":"draft-1789179946210-0.538…","body":"…"}}`
— the *client-side* optimistic id, not the server message id. The server
correctly refuses with `NOT_FOUND`. The edit is lost: the original row keeps its
original body and `editedAt` stays null.

**Frequency.** 6 of 6 fresh browser sessions failed with a 300 ms delay between
send and Edit. A paired 8-trial run alternating the delay: 4/4 failed at 300 ms,
4/4 edited correctly in place at 2 000 ms. In 1 of those 6 fresh sessions the
edited text was instead posted as a **second, separate message**, leaving the
original *and* a near-duplicate in the history
(`messages.send(new)` twice on the wire).

**Source.** `src/Messaging.tsx` inserts an optimistic row
`{id: 'draft-'+key, …}` into the rendered list; the bubble's `onEdit` captures
that row and `onSend` then calls `edit.run({messageId: editing.id})`.

**Why it does not fail a checklist assertion.** m4-a08/m4-a09 exercise the edit
after normal settling, where the server id is in place; the choreography segment
passed 3/3 under the grader's own harness run, and the grader's own settled UI
edit (`m4-a09`) edited in place with a server message-count delta of 0.

Screenshots `m4-edit-draft-id-failure.png`, `m4-ui-edit-duplicate.png`.

## O-dimension determination

- **O1 = 72.** 101 / 119 in-scope assertions pass (84.9 %). M1–M5 complete
  (13/13, 27/27, 15/15, 12/12, 12/12), M6 6/13, M7 0/9, M8 16/18. Above the 60
  anchor, far below 90 (a whole milestone never attempted; no platform proof).
- **O2 = 58.** One major defect in a core M4 flow that loses user data, plus
  three minor and one cosmetic. Nothing else: receipts, audiences, pagination,
  seed idempotence, Insights totals and digest counts all reconciled exactly, and
  20/21 trust probes denied.
- **O3 = null.** Applicable by predicate (M6 green, M1–M5 attempted) but its only
  admissible input — the wave's rotated holdout probes — does not exist.
- **O4 = 30.** No simulator artifacts exist, so neither the 60 nor the 90 anchor
  is reachable. Not lower because the honesty of the declared gap is exemplary
  and the web-scoped offline segments the harness did record are all green.
- **O5 = band 30.** Invariant manifest conforms exactly at all three checkpoints
  of both replays including named fixtures (so not band 0) and no wall cap was
  exhausted, but the frozen mid-curve degradation rule fails twice:

  | Replay | Probe | p95 @10 % | p95 @50 % | p95 @full | line at 50 % | verdict |
  |---|---|---|---|---|---|---|
  | scale | global-search | 4.236 | **4.407** | 4.182 | 4.212 | fails |
  | scale-m8 | trending | 47.282 | **48.122** | 48.013 | 47.607 | fails |

  Both failures survive the alternative reading of "the line between them" as the
  endpoint mean (4.209 / 47.647). Every 3× ratio rule passes, cold-start sync of
  the 100-conversation probe account completed in 57.9 s with a sawtooth heap,
  and no probe timed out, errored or OOMed — but the band function is first-match
  in the order 0, 30, 60, 90, 75, so those branches are never reached. The lane's
  own record already flags these two midpoint misses rather than smoothing them.

No weighted total, efficiency statistic or cross-lane comparison is computed.

## Grader-owned artifacts

- `grading/grader-report.json` — schema-valid machine record (AJV 2020, `SCHEMA VALID: true`).
- `grading/receipts/` — the grader's own choreography receipts and observations
  for m1–m6 and m8, including all three m4 attempts.
- `grading/screenshots/` — browser evidence referenced above.
- `grading/work/` — grader scripts and raw result JSON (not published as evidence;
  retained for audit).
