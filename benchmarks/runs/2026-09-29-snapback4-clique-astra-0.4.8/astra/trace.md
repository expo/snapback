# social-messenger grading trace — lane `astra-snapback4`

Sanitized evidence and action trace. This is the published companion to
`grader-report.json`; the raw session is retained privately for audit only.

- Lane backend: `snapback4-0.4.8` (`snapback4@0.4.8`, `snapback4-expo@0.4.8`, instrument commit `30fea66c`).
- Grader: family `claude`, model `claude-opus-5`, fresh session, no builder context.
- Wave `full-3models-astra`, run scope `full`. Session outcome `completed`, 0 re-runs, not contaminated.
- Assertion manifest pinned at `sha256:e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` (version `0.3.0-m8`, 119 ids).

**Redaction.** All persona and service credentials are written as `[REDACTED]`.
Fixture-persona emails are retained because they are the checklist's own named
subjects and carry no personal data. No bearer token, service token or password
appears in this trace. The grader's service-worker token was written to a
mode-0600 file outside this artifact and is not reproduced.

**Excluded inputs.** I did not open the lane's `diary.md`, `essay.md`,
`final-report.md`, `FINAL.md` or `run-log.md`, and I read no other lane. None
reached me; the session is not contaminated. (`scripts/start-worker.mjs` and
`scripts/owned-server.mjs` append to `run-log.md`; I let them write but never
read it.)

---

## 0. Environment and processes

macOS arm64, Node v24.18.0 from the absolute toolchain directory. Ports
49360–49379 only; all twenty were free at session start.

| role | port | pids |
|---|---|---|
| lane backend (`npx snapback4 dev`) | 49360 | 86970, 87061 — stopped mid-session for the m8-a11 restart test |
| lane backend after the restart test | 49360 | 37932, 37972 |
| web static server (`node scripts/serve.mjs`) | 49361 | 93077 |
| lane effects worker (`scripts/start-worker.mjs`, label `push-worker-grader`) | — | 90508 — stopped before the m8-a11 test |
| grader effects worker (no in-process dedupe) | — | 34191, then 38097 after the restart |
| grader-owned isolated instance for the M8 clock tests | 49367 | 50268, 50275 — stopped at the end of that probe |

Every pid above was started by me and recorded in
`grading/artifacts/pids.txt`. Only those pids were signalled. No `pkill`,
`killall` or pattern kill was used at any point, and no port outside the
assigned range was touched.

Machine load (`uptime`, 1/5/15-minute averages), sampled beside the timing work
because other sessions share this machine:

| moment | load |
|---|---|
| session start, before the backend | 32.94 / 19.16 / 13.33 |
| backend up, before the first suite | 32.66 / 20.99 / 14.30 |
| after the M6 suite re-run | 7.42 / 14.49 / 17.27 |
| during the M4 edit-window wait | 7.56 / 8.10 / 9.74 |
| during the M5 expiry window | 5.50 / 6.68 / 8.56 |

The choreography timings I score are the builder-run harness's own recorded
measurements, so this load record describes my own probing environment; the
load at the time of the harness run is a property of that earlier run.

**Window configuration.** Grading ran on the fixture pack's shortened profile.
`config/active.json` reports `profile: "shortened-grading"`, `editWindowSeconds`
60, `deleteForEveryoneWindowSeconds` 120, disappearing ttls 180 s and 300 s, and
`serverTimeAuthoritative` true — byte-identical in content to
`instrument/fixtures/config/windows.shortened.json`. The digest schedule matched
`instrument/fixtures/config/digest.shortened.json` (120 s periods anchored to
00:00:00 UTC), and `snapback/schedule.q` declares `schedule dailyDigest every
120s`.

**Milestone statuses** (from `milestone-record.json`, since `run-record.json` is
the base protocol record and carries no statuses): M1–M6 and M8 `green`, M7
`not-run`. Native artifact per milestone is `ios-hermes-export` with
`simulatorProof: false`. Nothing is `struck-by-environment` per `ENVIRONMENT.md`.

**One self-inflicted write.** My very first suite invocation ran before I had
started the web server on 49361, so `scripts/acceptance.mjs` wrote a
`pass:false` receipt over `evidence/m1-suite.json` (its recorded digest was
`e50167a6…`; the overwrite is `e54989e0…`). That is my environment error, not a
lane defect. I snapshotted the whole evidence directory immediately afterwards
to `grading/artifacts/evidence-snapshot-after-first-run/`, and my own
re-executed suite runs are the phase-1 evidence of record in any case.

---

## 1. Phase 1 — the lane's documented acceptance entrypoint

Run exactly as `README.md` and `package.json` document:
`npm run acceptance -- --milestone mN`, against the running backend and web
build, for `m1 m2 m3 m4 m5 m6 m8`.

| milestone | tests | result | log |
|---|---|---|---|
| m1 | 6 | 6 pass (first attempt: 5 pass / 1 fail, see §6 d-01) | `grading/artifacts/acc-m1.log`, `acc-m1-run2.log` |
| m2 | 11 | all pass | `grading/artifacts/acc-m2.log` |
| m3 | 5 | all pass | `grading/artifacts/acc-m3.log` |
| m4 | 7 | all pass | `grading/artifacts/acc-m4.log` |
| m5 | 7 | all pass (includes a real 175 s expiry wait with clients closed) | `grading/artifacts/acc-m5.log` |
| m6 | 4 | all pass (first attempt: 2 pass / 2 fail, see §6 d-03) | `grading/artifacts/acc-m6.log`, `acc-m6-run2.log` |
| m8 | 5 | all pass | `grading/artifacts/acc-m8.log` |

Every suite-required assertion of every in-scope milestone reported `pass`, with
`missing: []` in all seven receipts. The lane's own coverage writer re-validated
the manifest green through the frozen validator
(`instrument/metering/coverage-manifest.mjs`): 58 mappings across 7 milestones,
`coverage-manifest.json` digest
`ffe76ccd63a9d2bd9e72202cd1e10a28e4a9d7af8eebc548a4a680d96dd057d4`.

The two first-attempt failures are the two defects in §6; neither is an
environment loop of mine, and both are separated from the defect counts of the
assertions themselves.

---

## 2. Phase 2 — coverage-manifest spot-verification  {#coverage}

Verdict **honest**, no milestone adjudicated to `capability-failure`.

The manifest maps exactly the suite-required set per milestone and nothing else:
M1 7, M2 22, M3 7, M4 5, M5 6, M6 5, M8 6 — 58 mappings, which is precisely the
suite-required population of `assertions.json` for those milestones.

I read every mapped test in `scripts/acceptance.mjs` and
`scripts/acceptance-m{2,3,4,5,6,8}.mjs` and checked that the named test actually
drives the assertion's observable, then re-executed each sampled observable
myself (§3). Sampled ids are listed in the report. Nothing is no-opped or
fabricated, and several mappings are stronger than the bar requires:

- `m3-a11` waits on the jumped-to bubble's bounding rect being inside the viewport, not merely on a click.
- `m3-a15` diffs full per-conversation message-id lists, inbox membership and the Global feed before and after re-seeding every installed segment.
- `m4-a10` waits the real 61 s edit window rather than stubbing a clock.
- `m5-a01..a03` wait real server expiry with every client closed and relaunch a persistent browser profile to observe the purge.
- `m2-a24` reconstructs keyset order across page boundaries instead of only counting rows.

Two mappings are **incomplete rather than dishonest**. In each case I executed
the clause the mapped test leaves unasserted, and both pass:

1. `m1-a08` — "Editing display name **and** bio persists". The mapped test
   `profile fields persist` fills handle and bio, saves, and asserts only that
   the bio is shown. The save does write the display name (filled by the
   preceding test), but the display-name clause is never read back. My API check
   set and read back both fields, then restored them.
2. `m8-a05` — "Trending ranks the post with the **most likes** first". The
   mapped test gives its two Trending posts **equal** like counts, so ordering by
   like count is never differentially exercised — only the tie-break is. On an
   isolated instance with 3 / 2 / 1 likes I confirmed strict like-count ordering.

A third, narrower note: `m1-a03`'s mapped test exercises duplicate-handle
rejection at profile save rather than at signup. That is the only place a handle
exists in this app's flow — the brief specifies signup as email + password, with
handle among the profile fields — so this is a correct reading of the observable,
not a gap.

---

## 3. Phase 3 — independent checklist execution

I re-executed the checklist myself through the custom-client API and browser
automation on the web build. My probe sources are under `grading/probes/` and
their structured results under `grading/artifacts/probe-*.json`. They are
grader-authored: I read the lane's tests only to judge the coverage mapping, and
wrote my own assertions against the schema and the brief.

Three of my first-pass checks failed on **my own** mistakes, and I record them so
the defect counts stay clean: I used `authorId`/`actorId` where the feed rows
carry `author.principal`/`actor`; I asserted `sm-search-result` nodes are nested
inside `sm-search-group` when the frozen kit renders the group as a sibling
header; and I asserted a "media URL no longer serves" against the SDK's
client-local `blob:` handle instead of the server's `/assets/{id}` endpoint. All
three were re-specified and re-run (§3.4, §3.5, §3.7).

### 3.1 M1 — accounts and profiles  {#m1}

Via the published auth and client APIs (`grading/artifacts/probe-m1.json`), plus
browser automation (`probe-web.json`, `probe-web2.json`):

- `m1-a01` / `m1-a02` — a 7-character password is refused (`E_AUTH`); a ≥8 character signup succeeds and the new session reads `myProfile` and the authenticated feed without denial.
- `m1-a03` — server refuses a duplicate handle with `HANDLE_TAKEN` / "That handle is taken."; in the web UI `sm-profile-error` renders that text and the save does not navigate away. On a *cold* client the visible error is instead the platform's store-identification message — defect d-01.
- `m1-a04` — signup on an existing email is refused; `sm-auth-error` renders "that email already has an account; sign in instead" and the app does not land authenticated.
- `m1-a08` — both clauses: display name and bio persist and read back on the own profile; restored afterwards.
- `m1-a10` / `m1-a11` — a fixture avatar uploads through `client.upload`, is placed via `placeAvatar`, serves non-zero bytes, resolves for a peer, and paints on the own-profile screen as a loaded `<img>` (naturalWidth 256).
- `m1-a07` `[grader]` — `logout(url, token)`, then the same bearer: `myProfile` is denied `E_AUTH` and a `social.publish` mutation is refused. Verified independently of the lane's own unmapped logout test.

#### Password storage  {#m1-kdf}

`m1-a12` **pass**. The lane uses the platform's built-in password identity, not
a hand-rolled scheme: `snapback/schema.q` line 1 is `use identity password`, and
`app/_layout.tsx` calls `useAuth().signup` / `.login` from `snapback4/react`.
Grepping `app/`, `src/` and `snapback/` finds no hashing, salting or credential
persistence code at all. The documented provider path hashes with Argon2
(`npx snapback4 guide auth`: "Password hashing runs in bounded concurrent slots",
"Argon2 slots equal the host's available cores", "Unknown emails perform the same
Argon2 verification work"), and the backend announced "Argon2 slots: 10 on this
host" at startup. Verifying the lane uses that path rather than provider
internals, the store's credential records carry
`$argon2id$v=19$m=19456,t=2,p=1$…` — argon2id at the standard published
parameter set — in 17 records.

`m1-a13` **pass**. No fixture-persona password string occurs in
`.snapback4/store.sqlite` or its WAL, in the web bundles (`dist/`,
`dist-scale/`), in the iOS Hermes exports (`artifacts/`), in `app/`, `src/`,
`snapback/` or `ui/`, or in any evidence log. No bearer token pattern appears
anywhere in `evidence/`, which corroborates the README's claim that the worker's
service bearer is never printed into evidence. Persona passwords do appear in the
lane's own harness and seed scripts (`scripts/acceptance*.mjs`,
`scripts/debug-*.mjs`, `scripts/durable-offline-probe.mjs`, `scripts/inspect.mjs`);
those are the declared test-fixture class, live outside the application bundle,
and are the fixture pack's own published values.

### 3.2 M2 — posts and the follow graph  {#m2}

API results in `probe-m2m3.json` and `probe-m2m3b.json`;
`probe-m2-selffollow.json` for the self-follow trio.

- `m2-a01..a03` — text, 2-image and 1-video posts created and read back; both images and the video fetch non-zero bytes for a peer; no post mixes images and video.
- `m2-a06` — Bob follows Alice and her post arrives in his Following feed.
- `m2-a08` — after the unfollow, every Alice-authored row leaves Following, including a post created before the follow was observed (the "including older ones" clause).
- `m2-a09` — the same posts remain in Bob's Global feed; `followState.following` is false.
- `m2-a10` / `m2-a11` — a post by a *demonstrably* non-followed author (I cleared the pre-existing starter follow edge first, which my first attempt had wrongly assumed absent) appears in Global and, after a 4 s settle window, is absent from Following.
- `m2-a15` — unlike clears the flag and decrements to the base count.
- `m2-a17` — re-issuing set-true keeps the repost; set-false removes it and the repost row leaves the feed projection.
- `m2-a18` — Carol (followed) reposts Dave's (not followed) post; Bob's Following row carries `author = Dave` and `reposter = Carol`.
- `m2-a20` / `m2-a21` — the thread returns exactly the two *direct* replies in chronological order, a reply-to-a-reply is excluded, `replyCount` is 2, and none of the three replies appear in either feed.
- `m2-a24` — 24 fresh posts paged through both feeds: every non-final page is exactly 20 rows, no duplicate row ids, no dropped posts, and keyset order preserved across page boundaries.
- `m2-a25..a27` — I first enumerated and cleared **all** of Erin's follow edges through `publicapi.followEdges` (my first attempt cleared only four named personas and left one edge). With `followingCount` provably 0, her own original post and her repost both stay in her Following feed, and neither her follower count nor her following count changes.

#### Set-state idempotency  {#idem}

A dedicated probe (`grading/probes/idem.mjs`) confirms the global set-state
ruling for likes and reposts: three consecutive set-true calls leave the count at
1; a second user's like takes it to 2; two set-false calls leave it at 1; repost
true/true/false/false returns to 0; and a retried mutation replaying the *same*
write id does not double-apply. This is why I treat the one anomalous reading in
my first M2 pass as a probe artifact rather than a lane defect.

#### Web observables  {#m2-web}

- `m2-a12` / `m2-a13` — exactly one `role=link` in the post body; clicking it opens a popup at the exact `https://…` URL (the web equivalent of the system browser); zero `sm-feed-media` nodes, so no unfurl card.
- `m2-a16` — the Global feed row renders "↻ Reposted by Carol Chen": the attribution names the reposter's display name.
- `m2-a22` / `m2-a23` — Following 3 rows on first paint → 45 after scrolling; Global 14 → 48. Combined with the API paging check, both tabs page past 20.
- `m2-a05` — the post card renders the author's display name and a painted avatar node.

### 3.3 M3 — messaging core  {#m3}

- `m3-a03` — `createDM` from either direction and repeated returns the same conversation id; each side's inbox shows exactly one DM channel with the peer.
- `m3-a04` / `m3-a05` — a group with Alice, Bob and Carol (roster 3, creator admin); a second group with the identical title and roster has a distinct id and a separate message stream — a message sent to the first does not appear in the second.
- `m3-a14` — a non-admin's `remove` is refused `NOT_ADMIN` with the roster unchanged; `promote` is refused too.
- `m3-a15` — re-running the m1, m2 and m3 starter segments left profiles, inbox membership, every conversation's full message-id list and the Global feed identical under a deep equality diff.

#### Quoted replies  {#m3-quote}

- `m3-a10` — the reply bubble renders `sm-convo-quote-preview` containing the original's text, and the server-side row carries a `quote` pointer (so the excerpt is not merely a client-side echo).
- `m3-a11` — with 26 filler messages pushing the original out of view, tapping the quote preview brings the original fully inside the viewport, measured by bounding rect.

#### Sender avatars in conversation bubbles  {#m3-avatar}

`m3-a02` **fail** — a grader determination; the frozen harness never adjudicated
it. See §5 for the harness's skip and §6 d-02 for the defect. Measurements:

| surface | sender-avatar nodes | loaded `<img>` | settle | identity |
|---|---|---|---|---|
| DM, Bob's client | 20 | **0** | 30 s | `aria-valuetext` = `alice`, label "Avatar for Alice …" |
| group, Bob's client | 2 | **0** | 15 s | `aria-valuetext` = `alice` / `carol` |
| feed, same page load | 20 | **20** | 6 s | — |

The node is present exactly once inside each `sm-convo-bubble` with the correct
identity and accessible label, so the harness's stated reason for skipping ("the
kit does not render sender avatars in the default 1:1 layout") is inaccurate. But
the node is always the initials-fallback `DIV`, never the sender's uploaded
image, and the fallback rendered with no initials text at all in group bubbles.
Alice's avatar asset resolves normally over the API and paints 20/20 in the feed
on the same page load, so this is an asset-resolution failure inside the
message-bubble component (`useAsset(author?.avatar?.id)` never reaches `ready`)
rather than a missing node or a race. M1's checklist explicitly defers "avatars
beside posts and messages" to M2/M3, so the asserted surface is the uploaded
avatar beside messages, and it does not render.

### 3.4 M4 — media messages, reactions, edit/delete  {#m4}

- `m4-a01` / `m4-a03` — fixture image and video sent as messages; the recipient's rows carry `photo` / `video` and the assets serve 2062 and 49779 bytes.
- `m4-a06` / `m4-a07` — switching 👍 → ❤️ replaces the single reaction record rather than adding one (`reactionChips` = `[❤️, 1]`); a second member's reaction coexists as a distinct record; setting `emoji: null` removes only that member's record and leaves the other member's intact. My first attempt used the wrong shape — `reactionRows` returns per-user reaction records, not counted chips — and had Carol react in a DM she is not a member of; both were corrected and re-run in a group.
- `m4-a09` — the edited bubble renders an "edited" label beside the new text.

#### Edit window, server-side  {#m4-window}

`m4-a10` `[grader]` **pass**. Under `config/active.json`'s shortened
`editWindowSeconds: 60`, an in-window edit succeeds and marks the row `edited`;
after waiting 62 986 ms the identical edit is refused **server-side** with
`EDIT_WINDOW_CLOSED` and the stored text is unchanged. Verified through the API,
not by the absence of a UI affordance.

#### Media after delete-for-everyone  {#m4-delete}

`m4-a12` `[grader]` **pass**, tested against the *real* server asset endpoint.
My first attempt fetched the SDK's `blob:nodedata:…` handle, which is a
client-local object URL over already-downloaded bytes and therefore cannot
measure the server; I located the true endpoint in the SDK
(`GET {base}/assets/{id}` with the caller's `Authorization` header) and re-ran:

- before the delete, the endpoint serves bytes to the recipient;
- after delete-for-everyone, the same URL returns **HTTP 410** for the recipient and for the sender;
- the row is a tombstone with `photo: null` and an empty body;
- a fresh authorization attempt is denied.

The same probe confirmed the endpoint is bearer-scoped: an unauthenticated
request and a non-member's bearer are both refused.

### 3.5 M5 — ephemeral, chat config, search  {#m5}

- `m5-a04` — the recipient's first authorization of the view-once asset succeeds and serves non-zero bytes.
- `m5-a05` / `m5-a06` `[grader]` — the second and third authorizations are denied `E_ASSET_VIEWED`; the one-fetch budget is per principal and enforced by the server, not by a UI affordance.
- `m5-a08` — a non-admin's `setIdentity` is refused `NOT_ADMIN` with the title unchanged; the admin's rename then applies.
- `m5-a09` — `car`, `CAR`, `Car` and `caro` all find Carol; `arol` and `rol` do **not**, so matching is case-insensitive **word-prefix**, not infix. Display-name words match too (`chen`).
- `m5-a10` — in-chat search for `cof` returns the seeded "Coffee after work?"; a nonsense term returns zero rows.

#### Grouped global search  {#m5-search}

`m5-a11` **pass**, re-specified after my first check made a wrong structural
assumption. The frozen kit renders `sm-search-group` as a **sibling header**
(`SearchBar.tsx` emits a `<Text>` header before each group's run of rows), not as
a container, so "results outside a group" is meaningless here. Re-specified
semantically: the node sequence starts with a group header, every result is
preceded by a header, no header label repeats — so results are contiguous per
chat — and no group is empty. All hold, with ≥2 chat groups.

#### Ephemeral expiry with every client closed  {#m5-expiry}

`m5-a01`, `m5-a02`, `m5-a03` `[grader]` all **pass**
(`grading/artifacts/probe-m5expiry.json`). A DM set to the shortened `24h` mode
received a server ttl of exactly 180 000 ms, server-assigned (`expiresAt - at`).
A persistent browser profile signed in, opened the chat, and confirmed the
message was searchable *before* expiry; then every client — that browser context
and all API clients — was closed, and I waited 175 s past the deadline. A
non-expiring control message in the same chat provides the negative control
throughout.

- `m5-a01` — a fresh session gets `null` from `messaging.message`, the row is absent from history and from server-side chat search, the media is denied, and `GET /assets/{id}` refuses. The control message survived.
- `m5-a02` — relaunching the *same* persistent profile: the control bubble renders (proving history loaded from the device) while the expired bubble is absent and does not reappear.
- `m5-a03` — with that relaunched client set offline, offline search still returns the control message but returns **zero** hits for the expired one, so the purge survived into the offline index.

### 3.6 M6 — push seam, custom-client API, replay adapter

#### Push payloads  {#m6-push}

`m6-a08` / `m6-a09` **pass** (`probe-m6.json`). Only Alice connected; Bob had no
client open. A 212-character message produced exactly one logged payload with
`targetUserId` = Bob, `chatId` = the DM, `senderDisplayName` = Alice's profile
display name, and `preview` = the first 80 characters (length exactly 80). A
view-once photo previewed `"Photo"`. Two supplementary checks: an ordinary photo
previews `"Photo"` and a video previews `"Video"`; and one message yields exactly
one payload (no duplicate after an 8 s settle). The sender received no push for
their own message.

#### Custom-client demo from a clean checkout  {#m6-client}

`m6-a10` / `m6-a11` **pass**. I built a genuinely clean directory containing only
a `package.json` depending on `snapback4@0.4.8` installed from npm — no lane
`node_modules`, no generated types — copied in `scripts/custom-client-demo.mjs`,
and ran it as documented. Exit 0 with
`{"pass":true,"conversations":20,"historyPages":1,"sentId":"…","receivedBy":"polling",…}`.
Source review plus the green run confirm every listed operation: password login
(or an issued `CLIQUE_TOKEN`), `publicapi.conversations` paged to exhaustion via
the cursor, `publicapi.history` followed to a second page with an overlap check,
`messaging.send` with a stable write id distinct from the entity id, and receipt
by the documented polling path with the full documented field set asserted.

#### Grader-written variation from API.md alone  {#m6-a12}

`m6-a12` `[grader]` **pass**, and this is a genuine documentation result rather
than a formality. Working in the same clean directory and reading **only**
`API.md` — no lane source, no generated types — I wrote a program to fetch the
latest message of a *named* conversation: list every conversation page by cursor
(API.md's own instruction to use `next` rather than page length, and to list
before looking up a name because titles need not be unique), resolve the title
with explicit ambiguity handling, read `publicapi.history` page 1, take the
newest row, assert the documented message field set, and cross-check API.md's
"newest ordinal first" claim against the returned page. It worked on the first
attempt:

```
{"pass":true,"conversation":"Weekend Plans","conversationId":"…","role":"admin",
 "latest":{"id":"…","ordinal":18,"type":"text","edited":false,"tombstone":false,
 "serverTimestamp":1790659736221,"textPreview":"Custom-client demo …",
 "receipt":"sent","media":null},"pageOrdinals":[18,17,16,15,14]}
```

A missing title errors explicitly rather than silently picking a conversation.
Every documented field was present and the ordering claim held.

#### Replay adapter conformance  {#m6-replay}

`m6-a13` **pass**. I ran the frozen validator directly:
`node instrument/fixtures/validate.mjs sample-50.log` →
"valid sample-50.log: 50 actions, 0 markers, 13 verbs … validated 1 logs and 50
actions against 0.1.0-p1". The lane's adapter replayed the 50-action log on the
dev instance under **my** suite invocation, and the receipt written by that run
(`evidence/sample-50-verification.json`, timestamped inside my M6 run) records
`pass: true` with 32 stored-state verification checks, none failing.

#### The absent simulator artifact  {#m6-native}

`m6-a01` … `m6-a07` all record **not-run**. The lane recorded no iOS simulator
artifact: the m6 segment summary carries
`supplementalExternal: [{id:"ios-simulator-m6", pass:null, receipt:null,
status:"not-recorded", requiredForGreen:false}]`, and `milestone-record.json`
records `native.kind: "ios-hermes-export"` with `simulatorProof: false` and
`unavailable.simulator`. The brief is explicit that these `native-artifact`
assertions do not gate web authoring green but that "missing evidence leaves
native/O4 proof absent rather than passing it" — so they are recorded as not-run,
not as passes and not as failures. `snapback4 witness ios` exists in the pinned
CLI, so the capability was available; the run's qualification treats installed
native proof as optional, which is why this is a scope fact rather than a defect.

For completeness and for O4's benefit, the adjacent web evidence that *does*
exist: the m6 web assertion `offline-message-queue-flush-in-order` passed, with
two messages pending offline and an in-order flush (`flushMs` 6423.1) reaching
`read`. That is real, but it is the web carrier, not the artifact these
assertions name, and no cold-start-offline scenario was observed on any platform.

### 3.7 M8 — insights, digest, multi-device  {#m8}

`m8-a01` **pass** (`probe-web.json`). All six lifetime totals from
`analytics.insights` were reconciled against the source entities — posts counted
from `social.authorPosts`, likes/reposts/replies summed from those posts'
counters, followers and following from `social.followState` — and each matching
`sm-insights-total-*` tile was asserted to display that exact value: posts 97,
likesReceived 4, repostsReceived 25, repliesReceived 21, followers 4, following 2.

#### Insights buckets and Trending, on an isolated instance  {#m8-trend}

`m8-a03`–`m8-a07` **pass** (`probe-m8trend.json`). Because two of these require
a >24 h clock delta, I stood up a **grader-owned** instance on port 49367 with a
copy of the lane's `snapback/*.q` and its own store, so I never advanced the
clock of the store under test.

- `m8-a03` — the 7 buckets are exactly `floor(serverNow/86400000) - 6 … 0`; a post created now increments only the last bucket, no earlier bucket changes, and the post's own server day equals that bucket. UTC day boundaries from server time.
- `m8-a04` — on a fresh instance 6 of 7 days carry explicit zero `posts` and zero `likesReceived`; the array is always length 7 with numeric counters, so quiet days are present as zeros, not omitted.
- `m8-a05` — exercised with **unequal** like counts (3 / 2 / 1): the 3-like post ranks first and the full order is strictly by like count. This is the clause the lane's mapped test does not differentially exercise.
- `m8-a07` — two posts tied at 3 likes: the newer ranks ahead of the older, with server timestamps confirming the order.
- `m8-a06` — a 3-like post is in Trending; advancing that instance's dev clock 25 h drops it out while a newly created post enters, and the old post keeps its 3 likes (it falls out of the window rather than losing data).

The isolated instance was stopped at the end of the probe.

#### Scheduled digest, every client closed  {#m8-digest}

`m8-a08`, `m8-a09`, `m8-a10`, `m8-a12` `[grader]` all **pass**
(`probe-m8digest.json`). Under the shortened digest config (120 s periods
anchored to 00:00:00 UTC) I created four fresh grader accounts so the expected
counts are exact rather than inferred from residue, aligned to the start of a
period, authored a precise activity set, and closed **every** client before the
boundary:

| authored | target's expected count |
|---|---|
| account B follows the target | `newFollowers` 1 |
| the target follows D; D publishes 2 posts | `newPostsInFollowing` 2 |
| B sends 3 messages in a DM with the target | `unreadMessages` 3, `unreadChats` 1 |
| B sends 5 messages in a group the target is **not** in (roster checked) | must contribute nothing |

- `m8-a08` — exactly one digest for the target in that period, with `periodStart`/`periodEnd` matching the aligned window and counts `newFollowers 1, newPostsInFollowing 2, unreadMessages 3, unreadChats 1` — all four exact.
- `m8-a09` — the fresh persona that did nothing received zero digests in any period.
- `m8-a10` — a whole following period in which nobody acted emitted no digest for the previously active target.
- `m8-a12` — the five messages in the non-member group contributed nothing: the target's counts stayed 3 and 1. Corroborated in source: `digestCounts` iterates only `members where .principal = principal`, and the emit is guarded by a positive-activity condition.

#### Restart mid-period  {#m8-restart}

`m8-a11` `[grader]` **pass** (`probe-m8restart.json`). The lane's own worker
de-duplicates deliveries in-process by provider id, which would mask a backend
re-emission, so I stopped it and ran a **grader-written** worker
(`grading/probes/grader-worker.mjs`) that logs every `notify` delivery with its
effect id and no dedupe at all. Then: fresh accounts, activity authored inside a
period, all clients closed, the backend killed (pids 86970/87061) and restarted
mid-period (new pids 37932/37972), the grader worker restarted against the new
instance, and the boundary awaited with 45 s of grace. Result: the target had
exactly **one distinct digest effect** for that period with the correct counts
(`newFollowers 1`, `unreadMessages 2`), and no user anywhere had more than one
distinct digest effect for that period. The mechanism is visible in source as
`emit notify … once [p.principal, periodEnd]`.

#### Multi-device, from the choreography artifacts

`m8-a13`–`m8-a16` **pass**, scored from the harness receipts — see §5.

#### The absent simulator artifact  {#m8-native}

`m8-a17` and `m8-a18` record **not-run**, on the same footing as M6: the m8
segment summary carries `ios-simulator-m8` with `status: "not-recorded"`,
`pass: null`, `requiredForGreen: false`. The lane's own web durable-offline probe
(`evidence/m8-durable-queue.json`: `offlineRelaunchPending true`,
`exactlyOnce true`, `receiptsRead true`, ordinals 131/130) demonstrates the
behaviour on the **web** carrier, but it is a builder assertion on the wrong
carrier for these two ids, and O4 may not be scored from builder assertions.

### 3.8 M7 — not attempted in this run  {#m7}

All nine M7 assertions record **not-run**. `ENVIRONMENT.md` states that M7 is a
separate fresh session run later by the orchestrator *after* grading ("do not
attempt it"), and `milestone-record.json` records M7 status `not-run`. Nothing
poll-related exists in the lane, so each assertion's precondition never existed.
`m7-a08` cannot be snapshot-compared because no migration was performed, and I
did not export a pre-M7 snapshot for a milestone that runs after this grade.
`m7-a09` is `conditionalOn: previously-green-milestones`, and that condition **is**
satisfied (M1–M6 and M8 are green) — so it is `not-run`, not `not-applicable`:
the regression re-run simply never happened under an M7 budget. These nine score
not-passed in O1's denominator; the attribution is never-attempted-by-instruction,
not failure.

---

## 4. Phase 4 — holdout probes: not run  {#probes}

**Deviation, recorded.** No holdout probe set was hash-committed for this wave.
Execution-order phase 4 was skipped in full, `wave.probeSetSha256` is the
sentinel `none-uncommitted`, and `probeResults` is empty. No probe was invented
and no anchor-probe continuity diagnostic exists for this wave.

The consequence for **O3** is recorded as `null`. Its applicability predicate
(M6 green plus M1–M5 attempted) *is* satisfied, but O3's own rule makes the
wave's secret rotated holdout probes its only permitted input, so with zero
probes there is nothing to score and any number would be fabricated.

I did make incidental trust-boundary observations while hunting defects, and they
are reported below and in the defect list, but they are deliberately **not** used
as O3 input. For the record, a 13-probe cross-principal sweep
(`probe-defects.json`) found **no** authorization hole:

| attempted by a non-member / non-owner | server response |
|---|---|
| read DM history | denied |
| read a DM message by id | denied |
| read the DM roster | denied |
| in-chat search inside the DM | denied |
| find the DM message via global search | not returned |
| read the DM through `publicapi.history` | denied |
| send into the DM | `NOT_MEMBER` |
| advance a read watermark in the DM | `NOT_MEMBER` |
| react to a DM message | `NOT_FOUND` |
| edit another user's message | `NOT_FOUND` |
| delete another user's message | `NOT_FOUND` |
| change the DM expiry mode | `NOT_FOUND` |
| take another user's handle | `HANDLE_TAKEN` |

The targeted message was unchanged afterwards (not edited, not tombstoned, text
intact). Separately: a removed group member's read of a post-removal message is
denied and her send is refused `NOT_MEMBER`, while her pre-removal history
remains; the server asset endpoint refuses an unauthenticated request and a
non-member's bearer, and returns 410 after delete-for-everyone; view-once assets
refuse the second fetch per principal; and expired messages and their media are
refused server-side with every client closed.

---

## 5. Choreography artifacts — the only basis for `[choreo]` assertions and O4  {#choreo}

Receipts read from `evidence/m{1,2,3,4,5,6,8}-choreo.jsonl`, all at receipt
version `0.3.8-m8`. Every segment summary reports `green: true`,
`browserPass: true`, `nonGreenCause: null`, with zero failed and zero
required-unimplemented assertions. I did not re-drive the harness.

| segment | assertions (total/required/implemented/passed/skipped) | supplementalExternal |
|---|---|---|
| m1 {#choreo-m1} | 3 / 3 / 3 / 3 / 0 | — |
| m2 {#choreo-m2} | 9 / 9 / 9 / 9 / 0 | — |
| m3 {#choreo-m3} | 7 / 5 / 6 / 6 / 1 | — |
| m4 {#choreo-m4} | 5 / 5 / 5 / 5 / 0 | — |
| m5 {#choreo-m5} | 4 / 2 / 4 / 4 / 0 | — |
| m6 | 1 / 1 / 1 / 1 / 0 | `ios-simulator-m6` **not-recorded** |
| m8 {#choreo-m8} | 5 / 5 / 5 / 5 / 0 | `ios-simulator-m8` **not-recorded** |

### Best-of-3 timing records

All three measurements are retained for every timing-sensitive check, per the
frozen rule. Bounds are recorded only where the harness applies an explicit one.

| assertion | measurement | attempt 1 | attempt 2 | attempt 3 | best | bound | verdict |
|---|---|---|---|---|---|---|---|
| m1-a09 | attempt wall (ms) | 12146.0 ✗ | 12464.7 ✗ | **1934.7** ✓ | 1934.7 | — | pass |
| m2-a04 | attempt wall, text post | **4765.1** ✓ | 1527.0 ✓ | 2192.6 ✓ | 1527.0 | — | pass |
| m2-a07 | followVisibleMs | 1205.9 | 1216.3 | 1185.5 | 1185.5 | — | pass |
| m2-a14 | likeVisibleMs | 1983.4 | 2431.0 | 2055.9 | 1983.4 | — | pass |
| m2-a19 | replyCountVisibleMs | 2486.2 | 1669.6 | 1253.6 | 1253.6 | — | pass |
| m3-a01 | visibleMs | 5435.2 | 3844.1 | 4337.2 | 3844.1 | — | pass |
| m3-a06 | visibleAfterLastKeystrokeMs | 122.6 | 61.7 | 94.9 | 61.7 | 2000 | pass |
| m3-a07 | expiresAfterLastKeystrokeMs | 1843.8 | 2435.2 | 3197.4 | 1843.8 | 5000 | pass |
| m4-a02 | attempt wall | 15938.3 ✗ | 13332.1 ✓ | 11860.6 ✓ | 11860.6 | — | pass |
| m4-a05 | attempt wall | 19441.1 ✓ | 12943.9 ✓ | 12704.2 ✗ | 12704.2 | — | pass |
| m4-a08 | attempt wall | 11918.0 ✓ | 13364.0 ✓ | 12072.7 ✓ | 11918.0 | — | pass |

`m3-a08` is tagged timing-sensitive in the manifest but the frozen harness runs
it `bestOf: 1`, so no three-measurement record exists; its single measurement is
10 852.1 ms and it passed. M3's typing receipt and segment summary both stamp
`typingObservationBoundaryVersion: "v2"`, as the receipt format requires.

Also recorded from the receipts: `m2-a04`'s image and video legs each failed
attempt 2 and passed attempts 1 and 3; `m3-a10`'s harness counterpart
(`quoted-reply-excerpt-and-jump`, `required: false`) failed 2 of 3 and passed
attempt 2; m5's `disappearing-message-expiry-and-purge` ran 314 774 ms and
`view-once-single-view-and-refusal` 40 931 ms, both single-attempt passes; m6's
offline flush recorded `flushMs` 6423.1; m8's dual-offline convergence recorded
`firstFlushMs` 5693.9 and `secondFlushMs` 5650.3, and its receipt check
`firstReadMs` 15.0 / `secondReadMs` 14.7.

### The one skipped assertion  {#choreo-skip}

m3's `sender-avatar-identity-when-rendered` is recorded `implemented: false`,
`required: false`, `status: skipped`, `pass: null`, `outcomeClass: instrument`,
with the reason "The kit does not render sender avatars in the default 1:1
layout; identity is checked only when the app opts into that node." Reading the
harness source, the check is gated on
`testId(bubble, "sm-convo-sender-avatar").count() > 0` evaluated immediately after
the preceding live-DM check, and had it run it would then have required the
avatar's semantic value to equal the sender handle.

My web automation contradicts the stated reason — the node is present, once per
bubble, with the correct identity — so I adjudicated `m3-a02` myself rather than
leave a real defect hidden behind an inaccurate instrument skip, and failed it on
a different and verified ground (§3.3, defect d-02). This is flagged so the
harness is neither credited with nor blamed for that determination, and so the
instrument gap is visible to whoever maintains it.

---

## 6. Phase 5 — defects beyond the checklist

### d-01 — major (M1): first profile-save on a cold client is refused, and the form stays stuck  {#d-01}

On a freshly loaded web client the first `saveProfile` mutation is refused with
the platform's internal message **"the backend store is not identified yet;
mutation was not admitted"** instead of being deferred until the replica has
identified its store. Worse, the form does not recover in place: a second save on
the same mounted form is refused identically, and only re-navigating the route
clears it.

Quantified over six trials, varying only the settle delay between the form
mounting and the save:

| trial | settle before save | first save | retry on the same form |
|---|---|---|---|
| 1 | 0 ms | refused (store not identified) | saved |
| 2 | 0 ms | refused | saved |
| 3 | 0 ms | refused | saved |
| 4 | 1500 ms | saved | — |
| 5 | 4000 ms | saved | — |
| 6 | 8000 ms | saved | — |

3 of 3 with no delay, 0 of 3 with ≥1.5 s. Two consequences beyond the checklist:

1. In a duplicate-handle attempt on a cold client, the *visible error* is this internal diagnostic rather than anything about the handle — so the user-facing error slot misattributes the cause. My first M1 acceptance run failed exactly here, with the lane's own assertion `/handle|unique|taken/i` receiving the store message.
2. It destabilises the lane's own gate. The frozen choreography's `profile-edit-live-visibility` failed **2 of its 3 attempts** with "Bob's live Alice profile did not become observable within 10000ms" and `outcomeClass: "application"` — the harness's own taxonomy assigns those to the lane — then passed on attempt 3 in 167 ms. Two hard 12 s failures followed by a 167 ms success is the same cold-client signature.

Data integrity is **not** affected: a dedicated probe confirmed the stored handle
never changes on a refused or immediate save and never violates the 3–20
constraint, and the once-observed empty handle field appeared only inside the
stuck state.

Evidence: `grading/artifacts/acc-m1.log` (first run),
`grading/artifacts/probe-web.json`, the six-trial table above, and
`evidence/m1-choreo.jsonl` attempts 1–2 of `profile-edit-live-visibility`.

### d-02 — major (M3): message-bubble sender avatars never load the uploaded image  {#d-02}

See §3.3 for the measurements. 20 of 20 sender-avatar nodes in a DM and 0 of 2 in
a group are initials-fallback `DIV`s with zero loaded images after 30 s and 15 s
of settling, while the same users' avatars render as 20 of 20 fully painted
`<img>` elements in the feed on the same page load and their avatar assets
resolve normally over the API. In group bubbles the fallback rendered with no
initials text at all. This is the ground on which `m3-a02` fails.

### d-03 — minor (M6): the acceptance entrypoint silently depends on a separately started worker  {#d-03}

`npm run acceptance -- --milestone m6` fails `m6-a08` and `m6-a09` after a 90 s
wait with **"Push payload not delivered within 90 seconds"** when
`node scripts/start-worker.mjs` is not already running. The message names neither
the worker nor the JSONL file it is polling, and the suite neither starts the
effects seam nor checks that it is up, even though the seam is the thing under
test. `README.md` does document starting the worker, so this is a diagnostics and
self-containment gap rather than a missing capability: with the worker started,
all four M6 tests pass. It cost one wasted suite cycle and would mislead anyone
reproducing the lane.

Evidence: `grading/artifacts/acc-m6.log` (2 fail) versus `acc-m6-run2.log`
(4 pass), the only difference being the running worker.

### d-04 — cosmetic: thin margins on live two-client updates  {#choreo-flake}

6 of the 44 recorded choreography attempts failed and were rescued by best-of-3:
`profile-edit-live-visibility` 2/3, `feed-image-post-live-update` 1/3,
`feed-video-post-live-update` 1/3, `quoted-reply-excerpt-and-jump` 2/3,
`photo-message-live-render` 1/3, `reaction-live-replace-remove` 1/3. The
profile-edit pair is explained by d-01; the rest are timeouts on a shared
machine, absorbed by the frozen best-of-3 rule and therefore **not** scored as
failures. Recorded because several passing attempts sit within a few seconds of
the harness's observation windows.

### Searched and found clean

No crash, no data loss and no wrong count appeared in any probe. Specifically:
the 13-probe cross-principal sweep (§4) found no authorization hole; set-state is
idempotent under repeats and under replayed write ids; feed pagination produced
no duplicates and no gaps over 24 fresh posts in both tabs; the seed is
idempotent under a deep state diff; expiry, view-once and post-delete asset
refusal are all server-enforced with clients closed; digest counts matched
authored activity exactly, including across a mid-period backend restart; and
`m6-a12` showed `API.md` to be accurate and sufficient on a first reading.

---

## 7. Phase 6 — O-dimension scores

Full anchor citations and justifications are in `grader-report.json`. Summary:

| dimension | score | one-line basis |
|---|---|---|
| O1 functional completeness | **80** | 100/119 pass, exactly 1 failure; every attempted milestone green on both legs; short of the 90 anchor on "every in-scope milestone" (M7 0/9, never attempted by instruction) and on "including platform-proof artifacts" (no simulator artifact ⇒ 9 native-artifact assertions unevidenced). |
| O2 correctness under grading | **65** | Two major defects (d-01, d-02), one minor, one cosmetic, against a wide sweep that found no authorization hole, no wrong data and no crash. |
| O3 trust boundaries | **null** | Predicate satisfied, but the wave committed no holdout probe set and O3's only permitted input is those probes. Deviation recorded in §4. |
| O4 observed offline behavior | **55** | Ordered offline flush, receipt progression, dual-device convergence and warm-offline search all verified from harness artifacts on the web carrier; the entire cold-start-offline group and the required native proof are absent; the gap is disclosed honestly in the receipts and record. |
| O5 performance at the scale envelope | **band 30** | Band-mapped, not interpolated. Manifest conforms and the cap was not exhausted (18.7%), so not band 0; band 30 fires on both of its clauses — two mid-curve degradation rules fail and the 10% cold-start-sync probe timed out at its 30 s limit. |

### O5 inputs as read

`run-record.json` is the base protocol record and carries no
`performanceProbes.o5Inputs`, so the band inputs were read from
`milestone-record.json`, `evidence/scale-assessment.json` and
`evidence/scale-{10%,50%,full}-verification.json`, as the run record's own notes
field directs.

- **Manifest conformance:** verified at all three checkpoints — 81/81, 81/81 and 85/85 checks passing, `replay.verification: true`. Every named O5 fixture check passes: profile and follow counts for u0005, u0500, u0900 and u0901; "all conversations u0500"; "celebrity exact post count"; and the sampled chat/roster set including the 50-member group g0050. ⇒ band 0 does not fire on nonconformance.
- **Wall cap:** `replay.totalWallSeconds` 2689.06 against `capSeconds` 14400 ≈ 18.7% (replay-only 2563.51 ≈ 17.8%), probe wall excluded as the contract requires. ⇒ band 0 does not fire on exhaustion.
- **Degradation rules:** the lane's own `scale-assessment.json` records `allBuilderChecksPass: false`, with two of the frozen mid-curve rules failing — `global-message-search midpoint at/below endpoint line` (10% 17.829 ms, 50% 21.523 ms, full 16.587 ms, linear midpoint 17.277 ms) and `insights-u0500 midpoint at/below endpoint line` (3.961 / 6.566 / 9.429 ms, linear midpoint 6.391 ms). ⇒ band 30 fires.
- **Probe timeout:** the 10% checkpoint's cold-start-initial-sync probe recorded `pass: false`, "TimeoutError: page.waitForFunction: Timeout 30000ms exceeded" against its 30 000 ms limit, while the contract states no probe may time out, error or OOM. ⇒ band 30 fires independently.

Diagnostics only, not a comparative claim: deep-history page 50 / page 1 ratio
1.09; 500-follow feed / 5-follow feed 0.84; celebrity-follower feed / 5-follow
feed 0.78; celebrity post-ack / small-author post-ack 0.81; search full/10%
0.93; insights full/10% 2.38; trending full/10% 0.78 with its midpoint test
passing; cold sync 13.87 s at 50% and 12.93 s at full. Deployment posture as
recorded: "local published macOS arm64 binary, durable SQLite". The lane's own
notes state the u0500 Insights 10% and 50% figures came from a separately
verified prefix replay after the main run rather than the original checkpoint
timings, that no absolute P3 ceilings were supplied so no absolute score is
claimed, and that "failures remain failures" with no post-hoc tolerance — an
honest disclosure that I am reporting rather than discounting.

No weighted total, efficiency statistic or cross-lane comparison is computed
here; those belong to the harness and publisher.

---

## 8. Recorded deviations, limitations and result partition

1. **No holdout probe set committed.** Phase 4 skipped entirely;
   `wave.probeSetSha256` = `none-uncommitted`; `probeResults` empty; no probes
   invented; O3 = null. See §4.
2. **Grader family not calibrated.** `calibrationPassed: false` — the claude
   family has not passed `grader/calibration.md`, so this grade is labelled
   `uncalibrated-grader`. `sameFamilyGraded: false`: the builder is
   `gpt-6-astra`, a different family, so this is not an abort-fallback regrade.
3. **Timing best-of-3 with load recorded.** All three measurements retained per
   timing-sensitive check (§5), with machine load recorded in §0 because other
   sessions share this machine.
4. **Report-schema limitation.** The frozen grader-report schema restricts
   `assertionResults` keys to `^m[1-7]-a[0-9]{2}$` and therefore cannot carry M8
   at all. All 119 assertions were graded in this one independent session: the
   101 M1–M7 results are in `grader-report.json` and the 18 M8 results are in
   `grading/m8-assertion-results.json`, in the same record shape with the same
   enum values. No id appears in both files; validated as an exact partition of
   the manifest's 119 ids with zero overlap.
5. **Prior measurement-coverage gap.** The September 5 and September 12
   structured `assertionResults` carried only the 101 ids in
   `GRADER_ASSERTIONS_101.txt`. Their notes could describe M8 observations, but
   they did not provide a machine-comparable 18-id M8 result set, so no M8
   subtotal from those runs is comparable to this one.
6. **Instrument observation, not a lane defect.** The frozen choreography's M3
   sender-avatar skip reason is inaccurate (§5, §3.3); I adjudicated `m3-a02`
   myself and say so explicitly in the assertion note.

### Result partition

| set | pass | fail | not-run | total |
|---|---|---|---|---|
| M1 | 13 | 0 | 0 | 13 |
| M2 | 27 | 0 | 0 | 27 |
| M3 | 14 | 1 | 0 | 15 |
| M4 | 12 | 0 | 0 | 12 |
| M5 | 12 | 0 | 0 | 12 |
| M6 | 6 | 0 | 7 | 13 |
| M7 | 0 | 0 | 9 | 9 |
| **prior-101 subtotal (M1–M7)** | **84** | **1** | **16** | **101** |
| **M8 (separate file)** | **16** | **0** | **2** | **18** |
| **complete total** | **100** | **1** | **18** | **119** |

Every not-run is one of: M7's nine (never attempted by environment instruction)
or one of the nine `native-artifact` assertions with no simulator proof
(m6-a01…a07, m8-a17, m8-a18). The single failure is `m3-a02`.

---

## 9. Artifacts produced

- `grading/grader-report.json` — schema-valid against `instrument/grader/grader-report.schema.json` (AJV 2020, `strict:false`, `allErrors:true`).
- `grading/m8-assertion-results.json` — the 18 M8 results.
- `grading/trace.md` — this file.
- `grading/probes/` — grader-authored probe sources; `grading/artifacts/` — logs, structured probe results, suite logs, recorded pids, and the evidence snapshot.
- The grader's service-worker token was held in a mode-0600 file during the session and **deleted at the end of the session**; its contents are not reproduced in any artifact.
