# Grading trace — lane `astra-snapback4` (social-messenger, backend `snapback4-0.4.12`)

Sanitized evidence and action trace. Credentials are redacted throughout:
fixture persona passwords are referred to as `<fixture-pw>`, bearer tokens as
`<token>`, and principal IDs are truncated. Raw session transcripts are not
published. Machine-readable results: `grading/grader-report.json` (the 101
M1–M7 IDs the frozen schema admits) and `grading/m8-assertion-results.json`
(the 18 M8 IDs).

- Grader family `claude`, model `claude-opus-5`; wave `full-3models-astra`.
- Session outcome: **completed**, 0 re-runs used, not contaminated.
- `calibrationPassed: false` — the claude family has not passed
  `instrument/grader/calibration.md`. This grade is labeled
  **uncalibrated-grader** and is not claim-eligible.
- Assertion manifest pinned at
  `sha256:e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`
  (`0.3.0-m8`, 119 unique assertion IDs; the manifest's own `counts` block is
  stale at 116 because M2 carries 27 assertions, not 24).

## Contamination control

The lane contains `diary.md`, `essay.md`, `final-report.md`, `FINAL.md` and
`run-log.md`. None was opened at any point in this session, and no other lane
under `lanes/` was read. Nothing excluded reached the grader, so
`grader.contaminated` is `false`.

Builder-authored inputs that were read, all of them permitted: `README.md`,
`API.md`, `package.json`, `CONTRACT.md`, `run-record.json` (fields other than
the diary pointer), `milestones.json`, `suite-status.json`,
`coverage-manifest.json`, `native-artifacts.json`, `evidence/**`, `artifacts/**`,
and the application and test sources under `src/`, `app/`, `ui/`, `snapback/`
and `scripts/`.

## Recorded deviations from the frozen protocol

1. **No holdout probe set.** `instrument/grader/probes/rotation-log.md` has no
   rows — no probe set was ever committed for this wave. Execution-order
   **phase 4 was skipped in full**; no probes were invented.
   `wave.probeSetSha256` is the sentinel `none-uncommitted` and `probeResults`
   is `[]`. Because `applicability.json` permits O3 to be scored "from the
   wave's secret rotated holdout probes only", **O3 records `null`** even
   though its predicate (M6 green plus M1–M5 attempted) holds. Under
   `nullDimensionRule` that means per-dimension scores publish with no
   weighted total.
2. **Uncalibrated grader family**, graded anyway per the wrapper.
   `sameFamilyGraded: false` — the builder harness is `gpt-6-astra`
   (`run-record.json`), a different family.
3. **Host load recorded beside every timing measurement.** Other sessions share
   this machine. `uptime` 1-minute load averages during this session ranged
   from **37 to 176** (samples below). Absolute latencies here are diagnostics
   only.

## Environment and processes

macOS arm64; Node `v24.18.0` from the absolute Volta toolchain path, as
`ENVIRONMENT.md` directs. Nothing is `struck-by-environment`, so `runScope` is
`full` and every assertion is graded at the brief's bar. Playwright chromium
came from the lane's already-installed `choreography/node_modules/playwright`
plus the host browser cache; no install into `instrument/` was performed and
nothing under `instrument/` was written.

Ports used, all inside the assigned 49360–49379 range:

| Port | Role | PIDs started by the grader |
|---|---|---|
| 49360 | lane backend (`npm run backend`, shortened windows + digest) | 80002, push worker 80016 |
| 49361 | exported web shell (`node scripts/serve.mjs`, existing `dist/`) | 82905 |
| 49363 | fresh verification instance spawned by the lane's own `m8` acceptance | transient, closed by the suite |
| 49365 | grader's own digest-probe instance (3 starts, 2 restarts) | 29507, 29521, 34222, 34227, 40188, 40224 |
| 49366 | grader's own fresh `--fresh --replay` M8 instance | 83777, 83785 |

Every PID above was started by this session and only those PIDs were signalled.
No `pkill`, `killall` or pattern kill was used at any point. The 49365 and
49366 instances were stopped by their own scripts; 80002/80016/82905 were left
running until the end of the session and then terminated individually.

Backend startup confirmed the shortened configs and the auth posture:

```
Server window config: config/windows.shortened.json
Server digest config: config/digest.shortened.json
snapback4 dev: loopback identity attempts have no per-peer or per-email minute
  limits; Argon2 slots: 10 on this host
```

`grading/work/backend.log` holds 97 lines for the whole session with **zero**
errors, panics or unhandled exceptions across roughly 5,200 requests — only the
`dev refusal:` lines my own adversarial probes provoked.

## Side effect of phase 1 (disclosed)

Running the documented entrypoint `npm run acceptance -- --milestone mN`
rewrites `evidence/mN-suite.json`, `evidence/mN-coverage.json` and
`suite-status.json` in place. The builder's originals are preserved under
`grading/work/builder-originals/`, **except `evidence/m1-suite.json` and
`evidence/m1-coverage.json`**, which the m1 re-run overwrote before the backup
was taken. `coverage-manifest.json` — the authoritative assertion→test mapping
that phase 2 verifies — was untouched and is also backed up. The grader's own
suite receipts are kept under `grading/work/grader-suite-runs/`, and at the end
of the session the builder's originals were **restored in place** so that the
lane's execution-time record stands as the builder ran it, per the brief's rule
that execution-time statuses stand as run. The one exception is
`evidence/m1-suite.json`, which is still the grader's re-run — it has the same
verdict (`pass: true`, 7/7 mapped assertions) but it is the grader's receipt,
not the builder's, and `evidence/m1-coverage.json` is likewise the grader's.

## Phase 1 — builder suite, re-run by the grader

Entrypoint exactly as documented, against the running backend and web shell.

| Milestone | Grader re-run | Load before → after (1-min avg) |
|---|---|---|
| m1 | pass, 6/6 tests | 144.7 → 144.8 |
| m2 | pass, 11/11 tests | 152.0 → 167.6 |
| m3 | **fail** — `quoted-excerpt-jumps-to-original` | 166.1 → 175.5 |
| m3 (re-run) | **fail**, same test, same symptom | 165.7 → 159.3 |
| m4 | pass, 4/4 tests | 175.5 → 174.0 |
| m5 | pass, 6/6 tests | 149.0 → 150.0 |
| m6 | pass, 4/4 tests | 150.0 → 155.1 |
| m8 | pass, 4/4 tests | 156.3 → 155.0 |

The m3 failure was reproducible across both runs. Because the suite rethrows at
the first failure, `m3-a15` was never reached in the grader's run and is
recorded `suiteResult: not-covered`; the builder receipt had it covered and
passing, and I verified it independently (below). This is the only
suite-vs-grader divergence in the lane: see **d-01**.

## Phase 2 — coverage-manifest spot verification → `honest`

Mapping completeness, checked mechanically against the frozen manifest:

| Milestone | suite-required | mapped | missing | extra |
|---|---|---|---|---|
| M1 | 7 | 7 | — | — |
| M2 | 22 | 22 | — | — |
| M3 | 7 | 7 | — | — |
| M4 | 5 | 5 | — | — |
| M5 | 6 | 7 | — | `m5-a06` (a `[grader]` assertion the suite also covers) |
| M6 | 5 | 5 | — | — |
| M8 | 6 | 6 | — | — |
| M7 | 6 | 0 | all 6 | — (M7 not attempted) |

Honesty, checked by reading every mapped test body
(`scripts/acceptance.mjs` inline for M1, `scripts/test-m{2,3,4,5,6,8}.mjs`):

- The UI-mapped tests drive the **real exported web build** through real file
  choosers (`page.waitForEvent('filechooser')` with fixture media), real error
  nodes, and real decode checks (`img.complete && img.naturalWidth > 0`) — not
  proxies for the observable.
- The API-mapped tests assert **server state** through the generated api
  surface, including the retried-write-id idempotency check for `m2-a15` and
  the `ownReaction` + `reactionSummary` pair for `m4-a06`/`m4-a07`.
- `m6-a13` runs the **instrument's own** `instrument/fixtures/validate.mjs`
  over `sample-50.log` and then the lane's replay, asserting 50 actions and 13
  verbs plus `verification.pass` — harness-validated, not self-asserted.
- `m8-a01` recomputes the six expected totals from `starter-m2.log` and
  compares them to `api.insights`, so the test cannot pass on a client-side
  count.

Independent re-execution agreed with the mapping on all 58 suite-required
assertions. The single divergence (`m3-a10`/`m3-a11`) is the suite being
*stricter than the product in a racing way* — stricter, not dishonest. Verdict
**honest**; `dishonestMilestones` is empty, so no milestone is adjudicated to
`capability-failure`.

## Phase 3 — independent execution

### `[choreo]` assertions — from harness receipts only, never re-driven

The lane's `choreography/` copy is **byte-identical** to the frozen instrument
(`choreography.mjs`, `receipts.schema.json`, `setup-identity.mjs`,
`lib/json-schema.mjs`, `VERSION` = `0.3.8-m8` all hash-match), so the receipts
are trustworthy evidence. All **41** receipt records across
`evidence/m{1,2,3,4,5,6,8}-choreo.jsonl` validate against the frozen
`receipts.schema.json` (0 invalid). Every segment summary reports
`status: passed` with `requiredUnimplemented: 0`.

I mapped harness check names to manifest IDs by reading the frozen
`choreography.mjs`, and confirmed two checks that cover compound assertions
actually assert both clauses:

- `member-add-promote-remove-leave-and-live-cutoff` fences the `m3-a12` cutoff
  behind a *later DM progress marker* reaching the removed member, so a merely
  slow client cannot produce a false pass, and separately asserts the removed
  member still holds **exactly one** copy of the pre-removal message
  (`m3-a13`).
- `typing-indicator-within-2s-expires-within-5s` records both the appear and
  the expire measurement, so `m3-a06` and `m3-a07` each get their own bound.

Best-of-3 records for the manifest's `timing-sensitive` assertions, taken from
the harness's retained attempts (the grader may not re-drive these):

| Assertion | measurements (ms) | best | bound |
|---|---|---|---|
| m1-a09 | 196.9 / 132.0 / 207.2 | 132.0 | none |
| m2-a04 | 828.4 / 1074.5 / 1179.8 | 828.4 | none |
| m2-a07 | 1779.5 / 1878.0 / 2517.7 | 1779.5 | none |
| m2-a14 | 410.4 / 569.4 / 505.9 | 410.4 | none |
| m2-a19 | 341.1 / 32.0 / 36.5 | 32.0 | none |
| m3-a01 | 1803.4 / 751.0 / 1623.0 | 751.0 | none |
| m3-a06 | 35.6 / 114.2 / 26.6 | 26.6 | 2000 |
| m3-a07 | 2985.3 / 2691.5 / 2903.9 | 2691.5 | 5000 |
| m4-a02 | 2064.1 / 2026.7 / 2085.8 | 2026.7 | none |
| m4-a05 | 2246.1 / 909.9 / 1669.3 | 909.9 | none |
| m4-a08 | 1077.0 / 809.0 / 1050.3 | 809.0 | none |

`m3-a08` is tagged `timing-sensitive` in the manifest but the frozen harness
runs it single-attempt, so no three-measurement record exists — recorded as
**d-07**, a harness-configuration mismatch rather than a lane fault.

`m2-a18`'s harness check needed all three attempts (two failures at 15.2 s and
17.3 s, then a pass at 7.8 s) — see **d-03**.

### `[grader]` assertions

**`m1-a12` / `m1-a13` — password storage (source inspection).**
`snapback/schema.q:1` is `use identity password`, the backend's built-in
auth. `snapback4 guide personas` documents the provider path and states
"Password hashing runs in bounded concurrent slots outside the engine mutex /
Argon2 slots equal the host's available cores, capped at 16 and never below 2",
and the running backend confirms `Argon2 slots: 10 on this host`. No hashing is
hand-rolled anywhere in the lane and no provider internals are touched — the
m1-a12 bar for a built-in/managed provider is met on the documented path.
For `m1-a13` I scanned `.snapback4/`, `dist/`, `evidence/`, `snapback/`,
`artifacts/`, `scale-instance/`, `digest-instance/` and
`verification-instance/` for all 8 distinct fixture passwords and for their
base64, hex and URL-encoded forms: **no match anywhere**. Server persistence,
client bundles and logs are clean, so m1-a13 passes. Eleven lane scripts under
`scripts/` do embed the literals; that is neither persistence, bundle nor log,
and is filed as cosmetic **d-05**.

**`m1-a07` — logout revocation (API).** Logged in as a fixture persona with
`<fixture-pw>`, confirmed `api.whoAmI` authorized, called `logout(url, <token>)`,
then reused the **same** bearer on a fresh client:

```
beforeLogout      : authorized
afterLogout       : denied {code: "E_AUTH", family: "auth", message: "sign in to continue"}
afterLogoutWrite  : failed E_AUTH
```

Server-side revocation holds for both reads and writes. **pass**

**`m4-a10` — edit after the shortened window.** `config/windows.shortened.json`
gives `editWindowSeconds: 60`; `snapback/config.q` is generated from it
(`fn editWindow(): 60000`), so the window is a server constant, not a mutation
argument.

```
sent                : sent
editInsideWindow    : sent
waited              : 68 s
editAfterWindow     : failed EDIT_WINDOW_CLOSED
storedTextAfterwards: "grader edit INSIDE window"
```

Rejected server-side and the row is unchanged, not merely an absent UI
affordance. **pass**

**`m4-a12` — asset after delete-for-everyone.** The recipient fetched the photo
successfully immediately before the delete, then:

```
delete                   : sent
recipient fetch after    : denied E_ASSET_UNKNOWN
sender fetch after       : denied E_ASSET_UNKNOWN
row                      : tombstone true
```

**pass**

**`m5-a01` / `m5-a02` / `m5-a03` — ephemeral expiry and purge.** Shortened TTL
is 180 s (`disappearingOptions[1]`). A DM was set to `24h`, one message sent,
`expiresAt` confirmed set with a 180 s server deadline. A **persistent** Chromium
profile signed in, opened the conversation, saw the message in the bubble list
*and* in global search, then closed. Every API client was closed too, and I
waited 205 s with nothing connected.

```
messageByIdAfterExpiry       : null (refused/absent)
inHistoryAfterExpiry         : false
inServerChatSearchAfterExpiry: false            -> m5-a01 pass
sessionRestoredOnRelaunch    : true
purgedOnRelaunch             : true (absent at the first poll after mount)
                                                 -> m5-a02 pass
offlineSearchExpiredHits     : 0
offlineSearchControlHits     : 6 (control term, offline)
                                                 -> m5-a03 pass
```

The same relaunched profile was then put offline via `context.setOffline(true)`;
the expired text returned nothing while a control term still returned 6 hits
from the synced corpus, so the offline index really was live and really had
dropped the expired row. `snapback/schema.q:183-184` declares
`expiresAt: time ?` with `expire at .expiresAt`, so expiry is engine-driven, as
the lane claims.

**`m5-a06` — asset after the view.** `first fetch: served`,
`second fetch: denied E_ASSET_VIEWED`, and a **non-member's** fetch of the same
asset: `denied E_ASSET_UNKNOWN`. **pass**

**`m6-a12` — grader-written variation from `API.md` alone.** I wrote a client
using only the documentation (page `api.inbox`, compare `item.chat.title`,
retain `item.conversation`, then `api.apiHistory({conversation})` and take
`data[0]`), without reading lane source first. It worked on the first attempt:

```
inboxPages 1, distinctTitles 5, conversation resolved from the title
pageSizeAtMost50 true, pageAtMost20 true, newestFirst true
latest: "Quote navigation proof", ordinal 27, type text
fieldManifestMissing: []   (all 15 documented history fields present)
```

`API.md` is accurate and sufficient, including the warning that titles are not
unique and the membership-vs-conversation-ID distinction. One documentation
trap I did hit and `API.md` does warn about: `api.directConversation` returns a
row whose `.conversation` is the chat and whose `.id` is the membership —
"Never substitute a handle for a principal or conversation ID". My first
attempt used `.id`; that was my error, and the doc covers it. **pass**

**`m8-a08`…`m8-a12` — scheduled digest.** Run on the grader's own instance
(port 49365) with the lane's schema and the shortened digest schedule
(`schedule dailyDigest every 120s: digest`), four fresh accounts, aligned to a
real 120 s period boundary with no clock advance and no backdating. Scenario
inside period 1: carol follows bob; bob follows alice; alice posts twice; alice
DMs bob three times; alice and carol hold a group **bob is not a member of**
(roster verified) in which carol sends four messages; the fourth persona does
nothing. All clients were closed before the period closed, and the backend was
**restarted mid-period-1 before any emission**.

Emissions read from `evidence/push-provider/<key>.json`, the authoritative
per-key durable seam, not only the convenience JSONL:

```
bob   : exactly 1 digest, {newFollowers:1, newPostsInFollowing:2,
                           unreadMessages:3, unreadChats:1}   == expected
alice : exactly 1 digest, unreadMessages 4  (she IS in the group)
carol : 0 digests   (she only sent; sends are excluded for the sender)
quiet : 0 digests
per-user count: all <= 1
```

→ `m8-a08` pass (exactly one per active user, all four counts correct),
`m8-a09` pass, `m8-a12` pass — the four messages in the chat bob is not in
contributed **zero** to his counts, while alice's counts prove the messages did
exist. Then period 2 with no activity at all and a **second** restart
mid-period:

```
period-1 emissions after two restarts : 2 (unchanged)
period-1 bob digests                   : 1 (unchanged)
period-2 emissions                     : 0
idempotency keys                       : all distinct
```

→ `m8-a10` pass, `m8-a11` pass. `snapback/schema.q:406-421` shows why this is
structural rather than lucky: the job runs `as p.principal`, counts unread only
over `digestMemberships` (the viewer's own memberships) with
`.sender != viewer and not .deleted`, and emits `once [p.principal, periodEnd]`,
so the idempotency key is the user-period pair.

**`m7-a08`** records `not-run`: no M7 evolution occurred, so there is no
pre-M7 snapshot to compare against.

### suite-required assertions, independently re-executed

**Custom-client API pass** (`grading/work/g-api-suite.mjs`, 35 assertions
across M2–M5). Notable results beyond a bare pass:

- `m2-a02`/`m2-a03`: both image assets and the video asset were **fetched**,
  not just referenced.
- `m2-a08`: the Following feed went 67 → 16 entries on unfollow, alice-projected
  entries 51 → 0, including the oldest sampled alice posts. My first predicate
  wrongly counted **bob's own reposts of alice's content** as alice entries; 5
  such entries correctly remain, because `m2-a26`'s implicit self-follow rule
  keeps them. Re-checked with the corrected predicate: **pass**.
- `m2-a24`: a full walk of both tabs gave 0 duplicate `(id, repost)` keys and
  page 1 + page 2 exactly equal the first 40 of the walk — no duplicates and no
  gaps.
- `m2-a20`: the thread returned exactly the two direct replies in chronological
  order with the nested reply correctly excluded.
- `m3-a03`: `openDirect` twice, from both sides, resolved to one conversation ID.
- `m4-a06`/`m4-a07`: 👍 → ❤️ → cleared, with `ownReaction` and
  `reactionSummary` agreeing at each step (`[["❤️",1]]`, then empty).
- `m5-a09`: `people('car')` and `people('CAR')` both return carol.

**Browser-automation pass** (`grading/work/g-web-suite.mjs`, 18 assertions on
the exported web build). Notable:

- `m1-a01`: signup with a 17-character password; `m1-a03` surfaced
  "That handle is taken."; `m1-a11` confirmed the avatar `<img>` **decoded**
  (`naturalWidth > 0`) after a reload, not merely that a node exists.
- `m2-a12`: the URL renders as `testID="sm-text-link"` with
  `accessibilityRole="link"`. Rather than accept a role attribute, I clicked it
  and caught the resulting popup — it opened the `https://example.com/g-…`
  target, which is `Linking.openURL` reaching the system browser
  (`ui/src/linkify.tsx:20-30`). `m2-a13`: 0 iframes and 0 `sm-feed-media` nodes
  in that card.
- `m2-a16`: the attribution line reads "Reposted by Bob Bennett".
- `m2-a22`/`m2-a23`: item counts grew past 20 on scroll in both tabs,
  corroborating the API paging result.
- `m4-a01`: photo picked through the real file chooser and rendered **inline**
  (`naturalWidth > 40`), not as a placeholder.
- `m4-a03`: the video bubble renders a play affordance rather than a bare
  `<video>`; my first predicate demanded `<video>` in the bubble and failed.
  Opening the affordance mounts `sm-media-viewer-video` containing a real
  `<video>` with a source, and the API pass confirms the recipient row is
  `type: "video"` with fetchable bytes — **pass**. (Playback on the recipient is
  `m4-a04`, a `[choreo]` assertion, which the harness receipt passes.)
- `m5-a11`: results rendered under per-chat `sm-search-group` headings.
- `m8-a01`/`m8-a04`: all six total nodes present, 7 day rows.

<a id="m3-a10"></a>**`m3-a10` / `m3-a11` — the suite divergence, resolved.**
The suite's test quotes a message **26 messages back** (one original, 25
fillers, then the quoted reply), opens the conversation, and asserts the
excerpt immediately after the reply bubble appears. Server-side the quoted row
resolves fine — `api.messageById` on the reply's `replyToId` returned
`{text: "Coffee after work?", ordinal: 1, complete: true}` in **48 ms**. Driving
the same screen myself with an explicit settle wait:

```
immediate : "… | Quote navigation proof | … | Quoted message unavailable | Reply | React"
settled   : "… | Quote navigation proof | … | Coffee after work? | Reply | React"
quote resolved in 206 ms
tap -> original visible and inside the viewport   (m3-a11)
```

So both assertions **pass** on independent execution. The suite fails because
it races, and it races because `src/Chats.tsx:53` renders the terminal string
`"Quoted message unavailable"` for the entire in-flight window — there is no
loading branch. Recorded as `suiteResult: fail`, `result: pass`, plus defect
**d-01**.

**`m3-a15` — seed idempotency**, verified directly since the suite never
reached it. Segments `m1`, `m2`, `m3` replayed, then replayed again:

```
before / after 1st / after 2nd : all identical
people 20, chats 17, globalPosts 115, dmMessages 58, followersOfAlice 4
```

**pass**

**M6.** `scripts/custom-client-demo.mjs` ran green from the lane checkout on
both documented paths — the password path and the `CLIQUE_TOKEN` issued-token
path (`m6-a10`), and reading it confirms it exercises authenticate, full inbox
paging, `apiHistory` paging via `next`, send, and the documented 1 s polling
loop, asserting the field manifest on the row it sent (`m6-a11`).
For `m6-a08`/`m6-a09` I re-derived the payloads myself from
`evidence/push-provider/<key>.json` with no recipient client connected:

```
text (207-char body) : targetUserId == recipient principal
                       chatId       == conversation
                       senderDisplayName == sender's profile name
                       preview      == first 80 chars exactly (length 80)
view-once            : preview "Photo"; the caption string appears nowhere
                       in the payload
plain video          : preview "Video"
```

For `m6-a13` I ran the instrument's own validator and the lane's replay:
`valid sample-50.log: 50 actions, 0 markers, 13 verbs` and
`{pass: true, actions: 50, verbs: 13, verification.pass: true}`.

**M8 insights and trending**, on the grader's own fresh `--fresh --replay`
instance (port 49366) seeded with m1/m2/m3. For `m8-a01` I recomputed the six
totals from `starter-m2.log` with my own independent parser:

```
expected {posts:3, likesReceived:2, repostsReceived:1,
          repliesReceived:1, followers:4, following:2}
server   identical
```

`m8-a03`: today's bucket went 3 → 4 after one post, with the seven day
ordinals exactly the contiguous UTC week ending today. `m8-a04`: 7 rows, the
six non-today days all zero rather than omitted. `m8-a05`/`m8-a07`: a 3-like
post ranked first, with the two 2-like posts behind it newest-first (indices 1
and 2). `m8-a06`: after a 25 h dev-clock advance a 4-like post dropped out of
Trending. Trending returned the documented top-ten cap before the advance.

### Milestones not demonstrated

`m6-a01`…`m6-a07`, `m8-a17`, `m8-a18` (nine `simulator` /
`native-artifact` assertions) record **`not-run`**. The frozen harness itself
records the absence, in both segment summaries:

```
supplementalExternal: [{ id: "ios-simulator-m6", pass: null, receipt: null,
                         status: "not-recorded", requiredForGreen: false }]
```

No native receipts exist anywhere in `evidence/`. The brief is explicit that
"missing evidence leaves native/O4 proof absent rather than passing it", and
`greenRequired: false` means this does not disturb M6's or M8's web green. The
grader is forbidden from re-running the simulator, so these cannot be rescued.
They score not-passed in O1's denominator.

`m7-a01`…`m7-a09` record **`not-run`**. `ENVIRONMENT.md` directs that M7 is a
separate fresh session run by the orchestrator after this grading, and
`milestones.json` and `coverage-manifest.json` have no M7 entry. `m7-a09` is
the conditional regression assertion; the report schema reserves
`not-applicable` for the case where *no milestone was previously green*, which
does not hold here (M1–M6 and M8 were green), so it records `not-run` like the
rest.

## Phase 4 — holdout probes: not executed

Skipped in full per deviation 1. `probeResults` is empty and no probe was
invented. For completeness, and **explicitly not as O3 input**, the
trust-boundary behavior I did observe while hunting defects is below.

<a id="d-04"></a>**Adversarial pass beyond the checklist (O2 input).** Against a
private group holding only two personas, probed as an outsider and as a
non-author member:

```
non-member readHistory      : data = []          (empty, not an error leak)
non-member messageById      : data = null
non-member roster           : data = []
non-member searchChat       : data = []
non-member global search    : no leak (0 rows for the exact message text)
non-member send             : failed NOT_MEMBER
non-member react            : failed MESSAGE_NOT_FOUND
non-member addMember(self)  : failed GROUP_ONLY        <- misleading code, d-04
non-member setAccent        : failed NOT_MEMBER
non-member setDisappearing  : failed NOT_ADMIN
member, not author: edit    : failed NOT_AUTHOR
member, not author: delete  : failed NOT_AUTHOR
  -> row still intact, unedited, not tombstoned
saveProfile on self         : another user's profile unchanged
7-char signup password      : rejected E_AUTH
501-char post               : failed E_INPUT
201-char bio                : failed E_INPUT
handle "has space"          : failed E_INPUT
link "not-a-url"            : failed E_INPUT
self-follow                 : failed SELF_FOLLOW
empty message               : failed E_INPUT
```

Everything is enforced server-side; nothing was enforced only by UI absence.
The one blemish is the refusal **code**: `addMember` checks
`require conversations[conversation].isGroup = true else GROUP_ONLY`
(`snapback/schema.q:244-246`) before the admin guard, and for a non-member the
conversation row is unreadable, so `GROUP_ONLY` comes back for a conversation
that is in fact a group. The denial is correct and leaks nothing — only the code
misleads. Cosmetic **d-04**.

<a id="d-03"></a>**Follow fan-out, measured** (evidence for d-03). Three samples
of unfollow → post → follow → the post appearing in the follower's Following
feed, at the API level: **63 / 63 / 129 ms**, load 37–39. So the server-side
projection is fast, and the harness's two ~15–17 s failures on
`repost-following-feed-surface` were a client-surface liveness gap, not a
fan-out problem. That is why d-03 is minor and scoped to the web surface.

<a id="state"></a>**Dev-instance state observations** (evidence for d-06). The
seeded alice↔bob DM reports `disappearing: "24h"`, left set by the builder's M5
probe, so messages in that chat expire after 180 s under the shortened config;
and `api.me` for the first persona returns the display name
`"Alice Choreo 84b13eec 3"`, written by the choreography profile-edit check.
Acceptance residue in the dev instance is expected by the brief — which is
exactly why the scale replay uses a fresh instance — but neither value is reset
afterwards, which can surprise a later reader.

## Results summary

| Scope | IDs | pass | not-run | fail |
|---|---|---|---|---|
| M1–M7 (the prior-wave 101) | 101 | 85 | 16 | 0 |
| M8 (the added 18) | 18 | 16 | 2 | 0 |
| **Complete manifest** | **119** | **101** | **18** | **0** |

Per milestone: M1 13/13, M2 27/27, M3 15/15, M4 12/12, M5 12/12, M6 6/13,
M7 0/9, M8 16/18. The 18 not-run results are exactly the nine
simulator/native-artifact assertions and the nine M7 assertions. No assertion
is `fail`, and none is `struck-by-environment` — nothing is struck in this run.

### Frozen-schema limitation and the prior measurement-coverage gap

`instrument/grader/grader-report.schema.json` constrains
`assertionResults` with `patternProperties: "^m[1-7]-a[0-9]{2}$"` and
`additionalProperties: false`, so a schema-valid grader report **cannot carry an
M8 result at all** — even though `assertions.json` version `0.3.0-m8` defines 18
M8 assertions and `applicability.json` puts M8 in every full-run observing set.
The report here therefore carries exactly the 101 M1–M7 IDs and validates
clean, and the 18 M8 results are written to
`grading/m8-assertion-results.json` under the same `result`/`method`/
`suiteResult` vocabulary. The two files partition the 119 manifest IDs exactly,
with zero overlap (verified mechanically).

This is also the shape of the **prior measurement-coverage gap**: the
structured `assertionResults` of the September 5 and September 12 waves carried
only the 101 IDs listed in `GRADER_ASSERTIONS_101.txt`. Those waves' notes
could *describe* M8 observations in prose, but they never produced a
machine-comparable 18-ID M8 result set, so no M8 subtotal from them is
comparable to this one. The three figures this session reports — the prior-101
subtotal (85 pass / 16 not-run), the 18 M8 results (16 pass / 2 not-run), and
the complete 119-result total (101 pass / 18 not-run) — are kept separate for
exactly that reason, and the 119-result total is not comparable to any prior
wave's headline number.

## Defects

| id | severity | milestone | summary |
|---|---|---|---|
| d-01 | minor | M3 | Quote preview shows the terminal "Quoted message unavailable" while the lookup is in flight; also destabilises the lane's own m3 test |
| d-02 | major | — | Replay record omits four pinned O5 degradation-rule measurements |
| d-03 | minor | M2 | Web Following-feed liveness gap (harness needed 3 attempts; server projects in 63–129 ms) |
| d-04 | cosmetic | M3 | `addMember` returns the misleading code `GROUP_ONLY` to a non-member of a real group |
| d-05 | cosmetic | — | Fixture passwords hardcoded in eleven lane scripts rather than read from fixtures/env |
| d-06 | cosmetic | — | Dev-instance residue not reset (DM left `disappearing: 24h`; persona display name overwritten) |
| d-07 | cosmetic | M3 | `m3-a08` is tagged timing-sensitive but the frozen harness runs it single-attempt |

Full statements and evidence pointers are in `grading/grader-report.json`.

## O-dimension scores

| Dim | Score | Basis |
|---|---|---|
| O1 | 78 | 101/119 assertions, 7 of 8 milestones green; short of the 90 anchor on both its clauses |
| O2 | 84 | No blocker, no product defect above minor, zero crashes, every authorization probe denied |
| O3 | **null** | Scorable only from holdout probes; none committed this wave |
| O4 | 15 | No simulator artifact exists; lifted off zero by an exemplary honesty posture |
| O5 | **band 75** | Manifest conformant, 15.5% of cap, no rule failure; 90 unreachable without frozen ceilings |

<a id="o5"></a>**O5 inputs in full.** `run-record.json` is the base protocol
schema only, so there is no `performanceProbes.o5Inputs` block; I applied the
band function to the replay evidence directly
(`evidence/scale-{result,10pct,50pct,final,finalization,sql-verification,m8-probes}.json`).

Replay: 167,243 actions, start→end 2,241 s with 5,544 ms excluded, i.e. **2,235 s
against a 14,400 s cap = 15.5%**. Invariant manifest conformed at the 10% and
50% checkpoints and at the final envelope, including `settle-accounting-vs-
invariant-manifest` and the named O5 fixtures (`named:u0005`, `named:u0500`,
`named:u0900`, `named:u0901`, `named:g0001` all pass at every checkpoint, and
`scale-final-probes.mjs` re-checks the named following counts against the
manifest). The end state was independently corroborated through the published
read-only SQL views — 1,008 profiles, 5,921 follow edges, 50,228 posts,
100,015 messages — matching settle accounting exactly.

Measured probes, k=20 after 3 warm-ups, sequential (ms, p95):

| probe | 10% | 50% | final |
|---|---|---|---|
| busy-page-1 | 10.76 | 1.86 | 1.26 |
| busy-page-50 | 4.17 | 2.23 | 1.29 |
| following-u0005 (5-follow) | 3.21 | 2.54 | 1.99 |
| following-u0500 (500-follow) | 5.21 | 2.56 | 1.76 |
| following-u0901 (celebrity-follower) | 3.93 | 2.04 | 2.08 |
| global | 3.51 | 2.16 | 2.66 |
| search | 6.36 | 5.61 | 6.39 |
| insights-u0500 | — | — | 8.78 |
| insights-u0900 | — | — | 15.76 |
| trending | — | — | 16.96 |

Rules I could evaluate all pass: page 50 ≤ 3× page 1 (1.29 vs 1.26), the
500-follow user ≤ 3× the 5-follow user (1.76 vs 1.99), the celebrity-follower
read path ≤ 3× the 5-follow user (2.08 vs 1.99), and search at full ≤ 3× at 10%
(6.39 vs 6.36) with the 50% point (5.61) below the line. No probe timed out,
errored or OOMed.

Four pinned rules were **never measured** (defect d-02): the celebrity write
path, the Insights and Trending mid-curve comparisons (both measured only
post-final, and the lane's own note concedes they are "not a full hidden-grader
O5 assessment"), the 50-member-group receipt-aggregation stall check, and the
probe user's 100-conversation cold-start initial-sync wall. Under the frozen
first-match function, unmeasured is not *failed*, so band 30 does not fire.
Band 60 cannot fire either, because this instrument version freezes **no**
absolute p95 ceilings (`social-messenger.md:1046` is a pilot-calibrated
placeholder; `grader/probes/categories.md:54` defers them to P3) and cap use is
15.5%. Band 90 requires every probe's ceiling utilization ≤ 50%, which is
undefined without those ceilings and without a committed probe set — so the
function falls through to **75**. A wave that commits a probe set and freezes
ceilings should re-band this lane; with the four missing measurements supplied
it could also move down.

Per `nullDimensionRule`, the null O3 means this lane publishes per-dimension
scores and efficiency statistics only, with **no overall weighted total**. No
weighted total, efficiency statistic, or cross-lane comparison is computed
anywhere in this report — those are the harness's and publisher's jobs.
