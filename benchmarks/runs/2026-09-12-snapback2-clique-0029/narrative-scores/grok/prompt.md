You are grok-4.6, scoring one fresh Clique diagnostic cell built on published snapback2@0.0.29. Score the backend experience out of 100, holistically and by category, using only the supplied brief and this cell's continuous-builder and fresh-M7 narratives. This is one uncontrolled diagnostic observation, not a comparative or efficiency claim. No earlier score or another cell's findings are supplied.

## Permitted evidence

Read the supplied contents in full. Inputs are the frozen brief; the continuous builder's diary.md, essay.md, run-log.md, final-report.md and run-record.json where present; and fresh M7's m7/diary.md, m7/essay-paragraphs.md, m7/run-log.md and m7/final-report.md where present. Missing files remain explicitly missing. Independent grader outputs, other cells, prior runs, implementation plans and source-review findings are excluded. Builder attributions are observations to assess, not independently proven causal facts.

All permitted contents will be supplied verbatim inline with a per-file hash record after the two source phases finish. Call no tools, inspect no other source, write no files, and infer no missing evidence. Scores describe only the supplied evidence; they are separate from the independently graded assertions and any native/cap/custody qualification.

## How to score

- **100** = ideal for this brief: every milestone expressible directly, no workaround, nothing to prove twice. **75** = good, occasional friction. **50** = usable with substantial workarounds or missing pieces. **25** = fought the build at every step. **0** = unusable for this brief.
- Score the backend **as experienced on this brief through its published surface**, not its reputation or what you know it can do elsewhere. Evidence in the lane files decides; when a lane lost time to its own mistakes or to the environment (attributions `agent-error`, `environment`, `ambiguous` in `run-log.md`), do not charge the backend for it. Charge the backend for `*-defect` attributions, platform gaps, missing capabilities, and documentation that misled.
- When assessing milestone outcomes, weigh **why** they occurred: a lane that self-downgraded milestones because the platform refused a product-preserving design is a backend finding; a lane that ran out of time on client-side test plumbing is only partly one.
- Apply the fixed anchors consistently: the same kind of friction gets the same kind of penalty. The **overall** score is your holistic judgement, not an average of the categories.

## Categories (score each, 0–100, with a note of at most 40 words citing the evidence)

1. `setup_and_docs` — getting started, documentation quality and discoverability, README/guide accuracy.
2. `data_modeling` — authoring the schema and the server-side program: the language's ergonomics, expressiveness, learning cost.
3. `authorization` — expressing who can read and write what, and how naturally the product's membership boundaries map onto it.
4. `queries_and_live` — reads, pagination, feeds, and live updates / realtime in the client.
5. `writes_and_transactions` — mutations, atomicity, idempotency, retries.
6. `offline_sync` — offline writes, outbox, replay, conflict handling, durability across restarts.
7. `media_assets` — uploads, storage, media typing, per-recipient and view-once delivery.
8. `background_work` — effects, scheduled work, row timers, jobs/backfills, the push seam.
9. `client_integration` — the React/Expo web and native arms: hooks, auth lifecycle, reconnect, subscriptions, the paved template.
10. `diagnostics_dev_loop` — quality of error messages, check/test/trace tooling, how fast a wrong program became a right one.
11. `scale_and_limits` — behaviour under the brief's envelope (500 follows, 1,000 conversations, the scale replay), bounds and ceilings, performance.
12. `operations` — seeding, reset, migrations, recovery from bad state, observability of the running backend.
13. `overall` — holistic.

## Output

Return exactly one fenced JSON block and nothing else:

```json
{
  "scorer": {
    "family": "grok",
    "model": "grok-4.6",
    "basis": "this cell continuous-builder and fresh-M7 narrative files; independent grade excluded"
  },
  "backends": {
    "snapback2": {
      "overall": {
        "score": 0,
        "note": "..."
      },
      "setup_and_docs": {
        "score": 0,
        "note": "..."
      },
      "data_modeling": {
        "score": 0,
        "note": "..."
      },
      "authorization": {
        "score": 0,
        "note": "..."
      },
      "queries_and_live": {
        "score": 0,
        "note": "..."
      },
      "writes_and_transactions": {
        "score": 0,
        "note": "..."
      },
      "offline_sync": {
        "score": 0,
        "note": "..."
      },
      "media_assets": {
        "score": 0,
        "note": "..."
      },
      "background_work": {
        "score": 0,
        "note": "..."
      },
      "client_integration": {
        "score": 0,
        "note": "..."
      },
      "diagnostics_dev_loop": {
        "score": 0,
        "note": "..."
      },
      "scale_and_limits": {
        "score": 0,
        "note": "..."
      },
      "operations": {
        "score": 0,
        "note": "..."
      },
      "verdict": "one sentence",
      "would_use_again_for": "one sentence"
    }
  },
  "notes": [
    "up to five sentences on what most helped and most hurt Snapback 2 in this run"
  ]
}
```

Scores are integers 0–100. Every category must be present. Each note is at most 40 words and cites the supplied lane evidence. The overall score is holistic, not a category average.


## Input: frozen-brief.md

SHA-256: `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6`

````text
# Brief: social-messenger (canonical full-app benchmark)

**Status:** DRAFT — freeze-candidate. This brief freezes at LLP 0201 P3
(after the pilot calibrates budgets and the prerequisite artifacts
exist). Until freeze, nothing here supports a claim. Governing plan:
`llp/0201-social-messenger-canonical-benchmark.plan.md`; publication
rules: LLP 0197; scoring definition: LLP 0198 P0.0(e) (new brief family
⇒ this brief's own preregistered rubric, below).

**Design rule for this document:** the brief decides everything two
reasonable agents would build differently. The lane's remaining
decisions are backend-shaped only: schema, auth wiring, sync strategy,
media pipeline, API surface. Where this brief is silent and the choice
is not backend-shaped, lanes take the simplest option and note it in
the diary.

## The app

A group messaging and social app named **Clique**, built as an Expo
(Expo Router) client on the lane's backend, targeting iOS, Android,
and web. (Clique is the product name used in the UI and docs; the
brief family and measurement identity remain `social-messenger`.)
Accounts, profiles, a follow graph and post feeds, WhatsApp-shaped
messaging
(DMs and groups, typing, receipts, quoted replies, reactions,
media, edit/delete, disappearing and view-once), per-chat
customization, search, engagement insights and a trending view, a
server-scheduled daily digest, offline-first behavior (including
multi-device convergence), push emission at the provider seam, and a
documented third-party client API.

Lanes use the frozen presentational UI kit and fixture pack (LLP 0201
P1 artifacts; versions pinned at freeze). All test media and personas
come from the fixture pack — lanes never generate test content.

## Global rulings

These apply across all milestones.

- **Conflict policy: last-write-wins** by server arrival order.
  No lane builds CRDTs or custom merge logic.
- **Links:** `http(s)` URLs in any text are auto-detected and rendered
  as tappable text opening the system browser. **No unfurling, no
  OpenGraph fetching, no previews.**
- **Images:** JPEG/PNG/WebP, ≤10 MB. Client-side downscaling is
  permitted but not required.
- **Video:** MP4 (H.264/AAC), ≤50 MB, ≤60 s. Played as uploaded —
  **no transcoding, no thumbnail generation required** (a poster frame
  is optional).
- **Time windows:** message edit within **15 minutes** of send;
  delete-for-everyone within **60 minutes**; disappearing-message
  options **off / 24 h / 7 d**. There is no delete-for-me. The app
  reads its window durations from a config file with these production
  defaults; grading runs the fixture pack's **shortened-windows
  config** so expiry behavior is testable in minutes. Window
  enforcement is always server-side against server time — a backend
  that accepts caller-supplied timestamps for window checks fails the
  relevant probe.
- **Digest schedule** (M8): the app reads its digest schedule from a
  config file with the production default (one digest per user per
  day, computed at 08:00 UTC); grading runs the fixture pack's
  **shortened digest config** (one period every 2 minutes) so
  scheduled emission is testable in minutes. Like the time windows,
  the schedule is evaluated server-side against server time.
- **Revocation semantics** (applies to view-once, delete-for-everyone,
  and disappearing expiry): the guarantee is
  **server-authoritative refusal plus client purge at the next sync**.
  The server refuses reads/assets from the moment of
  revocation/expiry; connected clients purge within the stated
  tolerance; a disconnected client purges immediately on reconnect.
  Revoked and expired content must never render from the offline
  cache after the client has synced the revocation — **view-once
  media is never durably cached at all** and never renders offline
  after its one view. Bytes a client copied while access was valid
  (screenshots, exports) are outside the threat model. **Unfollow is
  projection-scoped, not content revocation:** it server-
  authoritatively removes the account's posts from the viewer's
  Following feed (purged locally on next load) but never revokes
  access to the posts themselves, which remain readable in Global.
- **Write idempotency:** toggle-shaped operations (like, repost,
  reaction, follow, poll vote) are expressed as **idempotent
  set-state intents** (set/clear, not flip) carrying client-generated
  mutation IDs, so at-least-once delivery and offline-queue retry can
  never invert intended state. Queued offline writes replay in order.
- **Identity is entirely in-system.** No device address-book access,
  no phone-number identity, no contact upload/matching (that flow
  needs SMS verification and measures OS permission plumbing, not the
  backend). "Contacts" means registered accounts: discovery is
  people-search by display name or handle; the de-facto contact set is
  who you follow and who you share chats with.
- **Self-follow is implicit feed membership.** The Following feed always
  includes the viewer's own original posts and reposts, even when the viewer
  follows no accounts. This is not a persisted follow edge: users cannot
  follow or unfollow themselves, follower/following counts exclude the
  implicit relationship, and feed entries remain unique.
- **Out of scope everywhere:** email sending (so: no verification, no
  password reset), SMS, OAuth/social login, device address-book
  access, quote-posts, link previews, message forwarding, voice notes
  (the media pipeline is already priced by photo/video; recording
  measures the client, not the backend), calls, E2E encryption,
  blocking/reporting, follow requests/private accounts, real APNs/FCM
  delivery.
- **Platform proof per milestone:** interaction proofs run on web
  (two browser contexts for two-client choreography); every milestone
  also produces an iOS Hermes bundle export as a build artifact. M6's
  offline proofs additionally run on the iOS simulator as a separately
  recorded native/O4 artifact; absence of that artifact cannot support a
  native claim but does not block the web authoring-green clock. M8's
  offline queued-write restart proof is the same class of separately
  recorded native artifact, under the same rule. Android is a
  spot-check outside scored runs, not a per-run requirement.
- **Seeding:** a versioned, idempotent seed installs the fixture
  personas and starter content. Both seeds — the small starter seed
  and the scale seed — are fixture-pack **action logs** replayed
  through the app's own write path. The starter log ships
  **segmented per milestone** (the M1 segment has only registrations
  and profiles; follows and posts arrive with M2's segment; chats
  and messages with M3's): a lane installs each segment when its
  milestone first needs it, that milestone's budget absorbs the
  segment's replay tooling, and idempotency ("running it twice
  changes nothing") is judged **per installed segment** — M3's
  seed-idempotency acceptance item covers every segment installed so
  far, and each milestone's suite re-runs it. The
  M6-budget replay-adapter ruling applies to the **scale** replay
  only (see "Scale envelope and performance").
- **Acceptance entrypoint:** the lane ships one documented command
  (e.g. `npm run acceptance`) that runs the scripted acceptance suite
  from a clean checkout against the running backend — the same
  invocation shape for every lane, so grader environment loops don't
  contaminate defect counts. Timing-sensitive checks (typing
  latency, live updates) are judged **best-of-3** under grader
  execution so machine-load flakes don't inflate defect severity.

## Scale envelope and performance

The app must remain correct and responsive at this envelope (visible
to builders by design — whether the agent designs for scale is part of
what the benchmark measures):

- ~1,000 registered users; ~50,000 posts; ~100,000 messages total;
  one "busy" group chat with 10,000 messages and 50 members; a probe
  user who follows 500 accounts and belongs to 100 conversations; one
  **celebrity** account followed by 900 of the 1,000 users, authoring
  ~200 posts spread through the log (M8's fan-out fixture — whether a
  lane fans out on write or filters at read time, the celebrity is
  where that decision's cost becomes visible); and a named
  **celebrity-follower** who follows the celebrity plus 4 small
  accounts (the read-path comparison fixture).
- The fixture pack provides the envelope as an **action log**: one
  action per line, human-readable but structured (e.g.
  `2026-01-03T10:15:00Z u0117 post "Coffee time"`,
  `… u0117 follow u0042`, `… u0042 send g003 "on my way"`), produced
  once by a committed deterministic generator (seeded RNG). The log
  is deliberately backend-neutral — no SQL dumps, no rows shaped
  like any backend's schema.

**Replay contract** (frozen with the brief):

- **Replay order is authoritative; log timestamps are documentary.**
  Content ordering follows replay order and server arrival time —
  lanes never backdate, and no privileged time seam is required for
  seeding. No chat in the scale log has disappearing messages
  enabled, so nothing is expired-on-arrival.
- **Registration is real:** the log's `register` actions run through
  the actual signup path (yes, ~1,000 password hashes — that is
  load, not waste); all scale-user credentials, including the probe
  user's, live in the fixture pack for the grader.
- **The replay adapter is authored inside M6's budget** and drives
  the app's **own mutation and auth path** (headless client, API, or
  the app's function surface — whatever the lane has), covering
  **every action-log verb** per the fixture pack's frozen action
  schema (register, profile-set, follow, post, like, repost, reply,
  chat-create, group-create, member-add, send, react, and so on —
  the schema file is the authority). Each action **settles before
  the next** so authoritative replay order is reproducible.
  **Replay execution** runs on its own recorded clock with its own
  wall cap — exhausting it scores O5, never the lane's completion
  statuses.
- **The push seam is disabled during replay** (a pinned replay-mode
  flag) so lanes don't diverge on ~100k notification side effects;
  receipts and feeds behave normally.
- **Base state:** the scale replay runs against a **fresh backend
  instance seeded with the starter log** (mirroring M7's ruling) —
  never the dev instance, whose acceptance and choreography residue
  would make exact-count verification fail spuriously. The
  invariant manifest is generated over the combined starter + scale
  content, so expected counts are exact. The M6 adapter-conformance
  check (50-action sample log) runs on the dev instance.
- End state is verified against the log's **invariant manifest** —
  per-entity counts, per-chat message counts, follow-edge counts,
  and named spot entities. Mechanics: corpus-wide counts come from
  the harness's **settle-receipt accounting** (every action
  acknowledged during replay — a fully acknowledged replay
  establishes the *expected* counts from the log itself); the
  *actual* end state is then independently verified by a **seeded
  deterministic sample covering every action-schema class**, whose
  seed is committed with the wave's probe set and hidden from
  builders — the adapter cannot predict which entities are checked,
  so no-opping any action class risks detection: 10 sampled chats'
  message counts via paged API history, the busy chat counted
  exactly by full paging, the probe user's conversation count, 10
  sampled users resolvable with correct profiles via people search,
  10 sampled users' follow counts via web-UI profiles, 10 sampled
  posts with their like/repost/reply counts via the feeds, sampled
  group membership lists via chat settings, sampled reactions and
  quoted replies on named messages via the field manifest. In
  addition, the **named O5 fixtures are checked exactly, at each
  checkpoint, before probes run**: the probe user's 500 follows, the
  5-follow comparison user's count, the celebrity's follower count
  (exactly 900) and post count, the celebrity-follower's 5-account
  following list, and the busy group's 50-member
  roster — a fixture mismatch, like any **manifest nonconformance,
  caps O5 at its failure band (0)** — performance is never scored on
  an artifact that did not validly reach the envelope, nor against
  an underfilled workload.
- The log carries **checkpoint markers at 10% and 50%**: replay
  pauses at each marker, probes run (their wall time excluded from
  the replay cap), and replay resumes — so growth is a curve through
  three sizes, not a two-endpoint ratio.

Performance grading runs on full-app runs after M6, using the
custom-client API and web client on the run machine. Probes run
sequentially (no concurrency), k=20 requests per probe after 3
warm-ups, 30 s timeout; each lane's **deployment posture** (local
binary, local dev server, hosted dev deployment) is a pinned record
field. **O5 is a scale-safety gate, not a comparative speed
statistic** — postures differ across backends, so cross-backend
latency ordering is never a claim; what is scored is viability at
the envelope. Absolute latency ceilings are **calibrated at P3 from
the pilot** (recorded with the budget caps). What is pinned now,
because it is hardware-independent, are **degradation rules** — the
signal is pathological growth, not milliseconds:

- Paging deep into the 10k-message chat must not grow superlinearly:
  p95 of page 50 ≤ 3× p95 of page 1.
- Following-feed load for the 500-follow probe user ≤ 3× the same
  query for a 5-follow user.
- Global message search latency at the full corpus ≤ 3× the same
  query at the 10% checkpoint, with the 50% checkpoint on or below
  the line between them (no superlinear blow-up mid-curve).
- Receipt aggregation in the 50-member group must not visibly stall
  message send/render.
- Cold-start initial sync of the probe user's account (100
  conversations) completes without timeout or unbounded memory
  growth; its wall time is recorded.
- **Celebrity write path (M8):** the celebrity's post-create
  acknowledgement p95 ≤ 3× a 5-follower author's post-create p95 —
  fan-out-on-write must not make the write path scale visibly with
  follower count.
- **Celebrity read path (M8):** Following-feed load p95 for the named
  celebrity-follower ≤ 3× the 5-follow comparison user's feed load —
  read-time filtering must not push the fan-out cost onto followers.
- **Insights (M8):** the probe user's Insights load at the full
  corpus ≤ 3× the same load at the 10% checkpoint, with the 50%
  checkpoint on or below the line between them; the load must not
  transfer the corpus to the client (a page-and-count-client-side
  implementation fails structurally, not just on latency).
- **Trending (M8):** Trending at the full corpus ≤ 3× the 10%
  checkpoint, under the same mid-curve rule.
- No probe may time out, error, or OOM at the envelope.

The exact probe queries rotate with the holdout set; the envelope
above is the published contract. Absolute numbers are indicative only
(local, colocated); network-realistic performance measurement is a
future leg once a hosted service exists (LLP 0201 D2).

## Screens (pinned)

Auth (sign up / sign in) · Feed (Following / Global / Trending
tabs) · Post thread · Compose post · Own profile (view + edit,
follower/following counts) · Insights (reached from own profile) ·
Other-user profile (follow toggle, counts) · Chats list ·
Conversation · Chat settings · New chat / new group · Search (people /
this chat / all messages) · Settings (account, log out).

The UI kit provides the presentational components and design tokens
for all of these; wireframe notes ship with the kit. Lanes wire data
and navigation.

## Fixture personas

Eight personas, `alice`…`henry` (`<name>@example.com`), passwords in
the fixture pack, each seeded with a profile, avatar, and starter
content (chats, group, posts, and a follow graph) defined by the
pack's seed manifest. The seeded follow graph is asymmetric by design
(some pairs follow one way only) so Following-feed acceptance can
distinguish the two feeds.
Two-client proofs use Alice and Bob in separate browser contexts,
driven by the choreography script.

---

## Milestones

An extension milestone, **P1 — Clique Pay** (wallets and bill splitting,
`clique-pay.md`, 2026-09-03), exercises the exact value model; it belongs to
neither run and enters neither completeness denominator.

Reduced run = M1–M3. Full run = M1–M8. Each milestone lists its spec
and its acceptance checklist — observable behaviors the grader
executes independently. Numbering is identity, not execution order:
the continuous session runs M1–M6 and then M8; M7 remains the
fresh-session day-2 milestone, run after the continuous session is
graded (M8 was added by the 2026-08-11 amendment — LLP 0201's dated
amendments — and keeps prior records comparable: runs that predate it
record M8 `not-run`).

**Budgets.** Cap keys (LLP 0201 D2): the **wall cap** is keyed by
milestone and shared by every lane in every family of a wave; the
**token cap** is keyed by (cap family, milestone) — cap families
enumerate the model matrix (primary Claude frontier; GPT frontier;
the mid-tier model as its own family; Kimi and Grok each their own
cap-advisory family — wall caps recorded for reference, token caps
recorded as inapplicable, never enforced, with the pilot safety
limits as hard stops), and no per-backend token caps exist. Wall cap(m) = 2× the slowest
tier-1 pilot lane's wall figure; primary token cap(m) = 2× the
largest tier-1 pilot token figure; the GPT and mid-tier families'
token caps come from their Convex mini-pilots via LLP 0201 D2's
max-over-backends pilot-figure transfer rule, 2× applied after
transfer, clamped at 2× the safety limit; pilot figures read green
pilot milestones, with the safety limit standing in as the *figure*
where a pilot lane has no green one — the ordinary 2× formula then
applies, the same rule as LLP 0201 D2/P2 (numbers recorded in the
table at the end at P3). Unused budget
does not roll over. M8 postdates the P2 pilot: its caps calibrate
from the P2b M8 pilot extension (LLP 0201, dated amendment
2026-08-11) under the same formulas, with the safety limits standing
in until those figures exist.

**Executors.** At P1 every checklist item is split into atomic
assertions with stable IDs, and every assertion (not merely every
numbered item — compound items get one class per clause) is assigned
exactly one executor class: **suite-required** (the builder's
scripted suite must cover it; the harness validates a coverage
manifest mapping every suite-required assertion to a test),
**[choreo]** (two-client behavior executed by the web harness, plus M6 native
behavior recorded by a separate lane-native harness artifact), or **[grader]** (source inspection,
API probing, snapshot comparison — grader phase only). **A
milestone's green receipt requires both a passing suite run
(coverage-validated) and a passing run of that milestone's
choreography segment** — realtime behavior gates green too; only
[grader] assertions are deferred to grading. M6 assertions marked
`native-artifact` are recorded and scored independently and do not gate web
authoring green; missing evidence leaves native/O4 proof absent rather than
passing it. The grader
spot-verifies the coverage mapping is honest. Tags below mark items
whose class is not obvious from phrasing. M8 assertions marked
`native-artifact` follow the M6 rule: separately recorded and scored,
never gating web authoring green.

**Statuses and dependencies.** A milestone ends in exactly one
execution-time status: `green` (harness-recorded passing suite run
plus passing choreography segment — this stops the milestone's
authoring clock), `capability-failure` (cap exhausted; the lane
proceeds to the next non-blocked milestone), `aborted` (abandoned
mid-attempt before cap exhaustion — treated as a capability failure
for proceed/completeness purposes, distinct in the record),
`blocked-by-M{n}` (a prerequisite failed; when several did, the
record lists the complete failed-prerequisite set, `n` = the lowest;
never counted as an additional independent capability failure), or
`not-run` (the lane terminated before reaching it). A milestone
whose prerequisite is itself blocked is likewise blocked, recording
the transitive failed set. Charging (mirrors LLP 0201 D2):
wall-exhausted `capability-failure` = full wall cap plus actual
tokens; token-exhausted = token cap plus actual wall; `aborted` =
full wall cap plus actual tokens, flagged `aborted`. A dishonest coverage mapping found
at grading **adjudicates** the milestone to `capability-failure` —
scoring-only and non-retroactive: execution-time statuses,
dependencies, termination history, and other milestones' clocks
stand as run; the published wall recharges that milestone to its
cap; O1 scores its checklist not-passed. The prerequisite DAG: M2
requires M1; M3 requires M1; M4, M5 require M3; **M6 requires M2,
M3, M4, and M5** (its checklist re-verifies likes, media,
view-once, and search behavior offline); **M8 requires M6** (it
extends M6's offline and push obligations and reads M2's social
graph); M7 requires M6. Scoring DAG: M3 requires M1 only; M3 does
not require M2. Reduced-run protocol: execute M1, then M2, then M3
in that order — do not start M3 to avoid an unfinished M2; a
reduced run that skips M2 is non-conforming even though M3's
scoring prerequisite is only M1. Two
consecutive `capability-failure`/`aborted` results (blocks do not
count) end the lane; the record carries an orthogonal termination
reason. All full-run milestones stay in the completeness
denominator regardless of status.

### M1 — Accounts and profiles

Spec:

- Sign up with email + password (password ≥8 chars). The lane uses
  its backend's **built-in auth if it supports password
  credentials**; otherwise it implements password auth with a named
  adaptive KDF — argon2id, scrypt, or bcrypt at standard published
  parameters. Fast unsalted hashes do not qualify. Never plaintext or
  reversible; the gap between "built-in fit" and "hand-rolled" is
  priced by rubric dimension B2, not hidden. Third-party identity
  services are out of scope (identity is in-system).
- Sessions are expiring tokens; logout revokes server-side.
- Sign in; sessions persist across app restart; log out invalidates
  the session server-side.
- Profile fields (exactly these): display name (1–50 chars), handle
  (unique, 3–20 chars, `[a-z0-9_]`), avatar image, bio (≤200), location
  (≤50), link (one URL). Handle uniqueness is enforced server-side.
- Own-profile editing for every field, including replacing the avatar.

Acceptance:

1. Sign up as a new user; app lands in the authenticated state.
2. Duplicate handle is rejected with a visible error; duplicate email
   likewise.
3. Kill and relaunch the app; still signed in.
4. Log out; relaunch; signed out. The old session token no longer
   works against the backend (the API sub-assertion is marked
   run-scope-conditional in the applicability manifest — [grader]
   via the API on full runs only).
5. Edit display name and bio; changes visible on the other client
   without manual refresh.
6. Upload a fixture avatar; it renders on the profile (avatars
   beside posts and messages are asserted at M2/M3, where those
   surfaces exist).
7. [grader] Source inspection: passwords stored via built-in auth
   or a named adaptive KDF; no plaintext or reversible password
   storage in server persistence, client bundles, or logs. The
   fixture pack's credential files are a declared test-fixture
   exception (they live outside the app). A backend's managed auth
   provider qualifies by its documentation — the grader verifies the
   lane uses the documented provider path, not provider internals.

### M2 — Posts and the follow graph

Spec:

- Post types: text (≤500 chars); images (1–4 fixture images);
  video (exactly 1). Image and video may carry a text body; a post
  never mixes images and video.
- **Follow graph:** follow/unfollow any other user from their profile
  (toggle; takes effect immediately — no requests, no private
  accounts). Profiles show follower and following counts.
- Likes: toggle, one per user per post, count visible.
- Reposts: toggle, one per user per post; appears in feeds attributed
  "reposted by {display name}". No quote-posts.
- Replies: any post can be replied to; a reply is a post referencing
  its parent. The thread screen shows the parent and its **direct**
  replies, chronological. Parents show a reply count. Replies never
  appear in feeds, only on thread screens.
- **Feeds, two tabs** (Following is the default): **Following** —
  reverse-chronological original posts and reposts from the viewer plus
  accounts the viewer currently follows; after an unfollow, that other
  account's posts (including older ones) no longer appear on next load.
  **Global** —
  reverse-chronological original posts and reposts from everyone.
  Both paginate 20 per page with infinite scroll.
- Profile screens list that user's posts, reverse-chronological.

Acceptance:

1. Create a text, an image (2 images), and a video post; all render
   in the Global feed on the other client without manual refresh,
   with the author's avatar and display name.
2. Bob follows Alice; Alice's posts appear in Bob's Following feed and
   her follower count updates live. Bob unfollows; on next feed load
   her posts (including older ones) are gone from Following but remain
   in Global. With no explicit self-follow edge, Bob's own original posts
   and reposts remain in Following throughout; the implicit relationship
   does not change his follower/following counts.
3. A post from a user Bob doesn't follow appears in his Global feed
   but not his Following feed.
4. A URL in a text post is tappable; no preview card renders.
5. Like from client B; count updates live on client A. Unlike works.
6. Repost from client B; feeds show the attributed repost; reposting
   again removes it. A repost by a followed user surfaces the original
   author's post in the Following feed. A viewer's own repost of an
   unfollowed author is labeled as a repost and is not a direct
   follow-projection hit; the author's original must appear via the
   follow edge.
7. Reply to a post; reply count increments live; thread screen shows
   parent + direct replies in order; the reply is absent from both
   feeds.
8. Feed pagination: with >20 seeded posts, scrolling loads the next
   page in both tabs; no duplicates, no gaps.

### M3 — Messaging core

Spec:

- **DMs:** at most one DM channel per user pair; starting a DM with an
  existing counterpart opens the existing channel.
- **Groups are entities:** created with a name (1–50 chars), optional
  description (≤200); 2–50 members; multiple groups with identical
  membership are distinct. The creator is an admin; admins can add and
  remove members and promote others to admin; anyone can leave. Adds
  take effect immediately — **no invitation/acceptance flow**.
- Text messages, ≤2000 chars.
- **Quoted replies** (WhatsApp-style): a reply carries a pointer to
  the quoted message; the bubble shows a quoted excerpt; tapping it
  scrolls/jumps to the original. No thread model.
- **Typing indicators:** appear on other members' screens within 2 s
  of typing, expire within 5 s of the last keystroke. Shown as "…"
  in the conversation and a hint in the chats list.
- **Receipts**, per message, monotonic: `sent` (accepted by the
  backend) → `delivered` (fetched by the recipient's client) →
  `read` (recipient viewed the conversation). Rendered as
  single-check / double-check / colored double-check. In groups the
  aggregate indicator shows a state only when every member of the
  message's **recipient set** has reached it — the recipient set is
  **membership at send time**, and members who leave or are removed
  before reaching a state drop out of the aggregate requirement.
- New members see the group's **full prior history** on join.
- Removed members immediately stop receiving new messages but keep
  their local copy of history from before removal.

Acceptance:

1. Alice DMs Bob; Bob replies; both see messages live with sender
   avatars. Starting the "same" DM again reuses the channel.
2. Create a group with Alice, Bob, Carol; a second group with the same
   three members coexists.
3. Bob types; Alice sees "…" within 2 s; it expires when he stops.
4. Receipt ticks transition sent → delivered → read as Bob's client
   fetches and then opens the conversation; group indicator waits for
   the slowest member.
5. Quoted reply renders the excerpt; tapping jumps to the original.
6. Admin removes Carol; she no longer receives new messages but still
   sees pre-removal history. A non-admin cannot remove members.
7. Seed is idempotent (second run: no duplicates).

### M4 — Media messages, reactions, edit/delete

Spec:

- Photo and video messages: fixture asset → picker → upload →
  rendered inline from a query result on the recipient; optional
  caption ≤500 chars.
- **Reactions:** any emoji, at most one per user per message; tapping
  the same emoji removes it, a different one replaces it; aggregate
  counts on the bubble.
- **Edit** own text messages ≤15 min after send; edited bubbles show
  an "edited" label; recipients see the new content. Media messages:
  caption is editable, media is not.
- **Delete-for-everyone** ≤60 min after send; the bubble becomes a
  "This message was deleted" tombstone for all members; the asset is
  no longer served.

Acceptance:

1. Photo message end-to-end: Alice picks a fixture image, sends; Bob
   sees it rendered (not a placeholder) live.
2. Video message end-to-end; plays on the recipient.
3. Bob reacts 👍; Alice sees it live; Bob switches to ❤️ (replaces);
   taps ❤️ again (removes).
4. Alice edits a sent message; Bob sees the new text and the label.
   Under the shortened-windows config, an edit attempted after the
   window is rejected **server-side** (the grader verifies via the
   API, not just the absence of the UI affordance).
5. Alice deletes a message; Bob sees the tombstone; the media URL no
   longer serves the asset.

### M5 — Ephemeral, chat config, search

Spec:

- **Disappearing messages:** per-chat setting (off / 24 h / 7 d),
  changeable by any member (admins only in groups); applies to
  messages sent after the change; the chat shows the current setting.
  Expiry is **server-enforced**: the server refuses expired content
  within 5 minutes of expiry with no client open, and clients purge
  per the global revocation ruling (connected: within tolerance;
  disconnected: on reconnect). Expired messages also leave the local
  store and offline search results once the client has synced the
  expiry.
- **View-once photos:** sender flags a photo message as view-once;
  each recipient can open it exactly once; after closing, reopening is
  denied and the backend refuses the asset. In groups, one view per
  member.
- **Chat customization**, synced to all members: group name and
  description editable by admins; accent color from the kit's pinned
  8-color palette; background image (fixture upload) rendered behind
  the conversation. DMs: color and background only.
- **Search** — matching semantics pinned as **case-insensitive
  word-prefix over Unicode-normalized (NFC) text** ("cof" matches
  "Coffee time"; mid-word substrings are explicitly not required —
  arbitrary substring would conflict with every tier-1 backend's
  indexed text search and force full scans at the envelope). Case
  folding is Unicode simple case folding; word boundaries split on
  whitespace and punctuation; the frozen fixture corpus and probes
  stay within Latin-script text, so locale-specific folding edge
  cases are out of scope. Newest first, paginated. Three scopes: people — all registered accounts by
  display name or handle; messages within one chat; messages across
  all the user's chats, grouped by chat. At M5, search over
  **already-synced** messages must keep working **warm-offline** (the
  running app loses connectivity — no restart); cold-start offline
  search is M6's obligation, re-verified there.

Acceptance:

1. [grader] Set a DM to disappearing (shortened-windows config):
   with both clients closed at expiry, the server refuses the expired
   message (API check); each client purges it on next
   launch/reconnect; it no longer appears in offline search after
   that sync.
2. View-once photo: Bob opens it once; second open is denied; direct
   asset fetch after the view is refused (server-side).
3. Admin sets group color + background; Carol sees both; non-admin
   cannot rename the group.
4. People search finds "car" → Carol; in-chat search finds a known
   seeded string; global search groups results by chat.
5. Warm-offline: with the app running, cut connectivity; search over
   previously synced messages still returns results (no restart —
   cold-start offline search is verified at M6).

### M6 — Offline writes, push seam, custom-client API

Spec:

- **Offline reads:** cold-starting the app with the backend
  unreachable shows all previously synced chats, messages, and
  already-viewed media — **except view-once media and revoked/expired
  content**, per the global revocation ruling. Message search over
  synced content also works cold-offline (re-verifying M5's warm
  guarantee against the durable store).
- **Offline writes:** composing while offline queues messages with a
  visible `pending` state; on reconnect they flush **in order** and
  walk the normal receipt states. Likes and reactions queue the same
  way.
- **Push seam:** when a message arrives for a user with no connected
  client, the backend emits a notification payload through its
  provider seam and logs it:
  `{targetUserId, chatId, senderDisplayName, preview}` — preview is
  the first 80 chars of text, or `"Photo"`/`"Video"` for media and
  view-once. Real APNs/FCM delivery is out of scope.
- **Custom-client API**, for third-party clients. Deliverables:
  a docs artifact (`API.md`) and a headless Node demo script
  (`scripts/custom-client-demo.mjs`). A third-party developer with
  only an access token and `API.md` must be able to: authenticate
  (or use an issued token), list their conversations, page through
  message history, send a text message, and receive new messages
  (streaming or documented polling — state which). API tokens are
  scoped to one user, expire, and die with logout/revocation —
  `API.md` states the issuance, expiry, and revocation story. REST
  is **not** required; the backend's native protocol is fine if
  `API.md` makes it followable. **Minimum message-object field
  manifest** (what the history operation must expose per message, so
  probes and the M7 snapshot are backend-neutral): id, conversation
  id, sender id, server timestamp, type, text/caption, media
  reference, edited flag, tombstone flag, reply-to id, reactions
  (emoji, count, caller's own state), and — for the caller's own
  messages — the receipt state.

Acceptance:

1. [native-artifact] Cold-start offline (iOS simulator, backend stopped): history and
   previously viewed media render; synced-message search works; a
   previously viewed view-once photo does **not** render.
2. [native-artifact] Send two messages offline; both show pending; on reconnect they
   arrive in order and reach `read` normally.
3. With Bob's clients closed, Alice messages him; the logged push
   payload has the right target, sender, and preview; a view-once
   photo previews as "Photo".
4. `custom-client-demo.mjs` runs green against the live backend from
   a clean checkout, exercising every listed operation.
5. [grader] Grader-written variation: following only `API.md`,
   fetch the latest message of a named conversation. (Documentation
   quality is part of the bar.)
6. The scale-replay adapter passes the fixture pack's action-schema
   conformance check (replays a 50-action sample log green,
   harness-validated) — adapter authoring is thereby inside M6's
   coverage manifest, cap, and authoring clock, not deferrable
   off-clock.

### M7 — Day-2 evolution (fresh session, after the continuous session — M1–M6 plus M8 — is graded)

Run by a **fresh agent session** with no builder context. **Data
environment (author ruling, 2026-08-08): the pre-replay starter
state** — a fresh backend instance seeded with the starter log, not
the scale replay's ~100k-message database (migration-at-scale is a
possible future leg). The pre-M7 snapshot is exported through the
custom-client API over the M6 field manifest, using each persona's
token, before the M7 session starts.

Spec, two parts (the second exists because polls alone could live in
a new table without ever touching existing data — the backfill is
what forces a real migration):

1. Add **group polls** — a new message type: question (≤200 chars),
   2–4 options (≤50 chars each); one vote per user, changeable
   (idempotent set-state, per the global ruling); live tallies
   visible to all members; votes queue offline like reactions.
2. Add a **backfilled field**: every conversation gains a message
   count, shown in chat settings, **backfilled over all existing
   conversations** and maintained forward. Count semantics: currently
   visible messages — excludes tombstoned and expired messages;
   polls count as messages.

Existing data must survive the schema change intact. The record
notes whether the pre-M7 schema already carried count structures
(a lane may have maintained counts early; the field keeps B8's
forced-migration signal honest). The M7 session
runs under the same aid condition as the lane it continues, on its
own recorded clock, and writes its own diary entry and closing-essay
paragraphs under the same essay-before-numbers sequencing; it scores
rubric dimension B8.

Acceptance:

1. Create a poll in a group; members vote; tallies update live;
   changing a vote adjusts counts; a duplicate/retried vote intent
   does not flip state.
2. An offline vote queues and settles on reconnect.
3. Message counts are correct for pre-existing conversations
   (backfill) and increment with new messages.
4. Pre-existing messages, media, receipts, and reactions are intact
   after the migration — the grader compares against the **pre-M7
   snapshot exported through the custom-client API** before M7
   started (backend-neutral by construction).
5. The acceptance suites of previously-green milestones still pass
   (prior failures are preserved, not repaired under M7's budget).

### M8 — Insights, digest, and multi-device offline (continuous session, after M6)

Added by the 2026-08-11 amendment (LLP 0201, dated amendments) to
close the coverage holes the instrument otherwise leaves open:
aggregation/reporting, genuinely scheduled server-side work, high
fan-out, and offline depth. Authored in the same continuous session
as M1–M6, immediately after M6; requires M6. M7 is unchanged: still
fresh-session, still requiring only M6, its regression item covering
whatever milestones were previously green (including M8). M8 adds no
starter-log segment — its acceptance creates the activity it
measures, over content the existing segments already seed.

Spec:

- **Insights screen** (reached from own profile):
  - Lifetime totals, exactly these six: posts, likes received,
    reposts received, replies received, followers, following.
  - Seven-day activity: for each of the trailing 7 UTC days (server
    time), posts created and likes received that day. Days with no
    activity render as zero, not omitted.
  - Freshness pinned: values reflect server state as of screen load;
    pull-to-refresh re-queries; live update is not required. Whether
    counts are maintained (counters, read models) or computed
    (aggregate queries) is backend-shaped — the scale envelope's
    Insights degradation rules are the only constraint.
  - Totals are server-computed: the client never derives a total by
    paging the corpus (structurally enforced by the Insights
    degradation rule at the envelope).
- **Trending** (third feed tab, after Following and Global): the top
  10 original posts (replies excluded, reposts count toward nothing
  here) from the trailing 24 h of server time, ranked by like count
  descending, ties newest-first. Recomputed on load and
  pull-to-refresh; live update is not required; an empty trailing
  window shows the kit's empty state.
- **Daily digest** (scheduled, server-side): on the digest-config
  schedule (see Global rulings), the backend computes, per user,
  activity since that user's previous digest period and emits one
  payload through the M6 push seam (logged, like all seam traffic):
  `{targetUserId, kind: "digest", periodStart, periodEnd,
  newFollowers, newPostsInFollowing, unreadMessages, unreadChats}`.
  Rules: emission is driven by the schedule alone — it requires no
  connected client and no client interaction, so lazy read-triggered
  evaluation cannot satisfy it; a user whose counts are all zero
  gets no digest; exactly one digest per user per period, idempotent
  under retry and backend restart; counts respect authorization —
  activity in chats the user is not a member of, and
  expired/tombstoned content, never contributes. The push seam's
  replay-mode flag also disables digests during the scale replay.
- **Multi-device and deeper offline** (one account on two clients;
  the global last-write-wins ruling applies unchanged — M8 adds no
  merge semantics):
  - Signed in on two clients: messages sent, edited, and reacted-to
    on one appear live on the other, and **read state syncs across
    the account's own devices** — opening a conversation on one
    client clears its unread indication on the other.
  - Both clients offline: each composes in the same chat; on
    reconnect both messages flush and settle in server-arrival
    order, no loss, no duplicates, receipts advancing normally.
  - Queued writes survive restart: composing offline, killing the
    app, and relaunching still offline shows the queued messages
    still pending; they flush in order on reconnect. (M6 requires
    the queue while the app stays running; M8 requires the queue to
    be durable.)

Acceptance:

1. Alice's Insights totals match the seeded content; Bob likes one
   of Alice's posts; after refresh her likes-received total
   increments.
2. The 7-day breakdown buckets a post created today under today and
   renders days with no activity as zero.
3. Trending ranks the post with the most likes in the trailing 24 h
   first; an older heavily-liked post (>24 h) is absent; a tie
   breaks newest-first.
4. [grader] Under the shortened digest config with every client
   closed: seeded activity produces exactly one logged digest per
   active user with correct counts; a persona with no activity in
   the period gets none; a following period with no new activity
   emits none; a backend restart mid-period does not double-emit.
5. [grader] Digest authorization: activity in a chat the target
   user is not a member of never contributes to that user's digest
   counts.
6. Same-account convergence: Alice signs in on two clients; a
   message sent on client 1 appears on client 2 live; opening the
   conversation on client 1 clears the unread indication on
   client 2.
7. Both of Alice's clients go warm-offline; each composes one
   message in the same chat; on reconnect both settle in
   server-arrival order, no duplicates, and receipts advance
   normally.
8. [native-artifact] Compose offline; kill and relaunch the app
   still offline; the queued messages render as pending; on
   reconnect they flush in order and reach `read` normally.

---

## Holdout probes

A rotated probe set — trust-boundary shaped (cross-user DM access via
the API, removed-member delivery, view-once re-fetch, expired edit
window, session invalidation after logout, **server-side denials
surviving the offline cache**, scheduled-digest authorization — a
digest must never count chats its target cannot read) and
performance shaped (the exact
queries measured against the scale envelope's degradation rules,
including the M8 celebrity and aggregate rules) —
is maintained outside this brief, run by the grader, and **published
after each scored wave, rotated for the next** (LLP 0201 D3).
Builders never see the current wave's **scored** probes; the trust
obligations and the scale envelope they test against are published
here. Custody and comparability per LLP 0201 D3: the wave's probe
set is hash-committed before its first lane starts, and the rotation
log records the category mapping; probes whose target behavior a
failed milestone never built score under a preregistered rule
(not-passed or excluded-with-note) frozen with the probe set.
**Anchor probes are non-scored**
(author ruling, 2026-08-08): each category's unchanged cross-wave
anchor is a published continuity diagnostic that never bears on
O3/O5 — scores read only the wave's secret rotated probes, which
cover every category.

## Scoring

Two layers per LLP 0201 D4. The grader scores outcome (45); the
builder scores experience (55); the builder separately records a
holistic 0–100 **before** seeing any computed total or metric, citing
2–3 concrete moments. Sequencing: closing essay → dimension scores →
holistic → numbers revealed.

**Applicability (frozen; author ruling 2026-08-08 — nulls block
totals):** a run scores only the dimensions it exercises. Each
dimension's **observing milestones**: O1/O2 — all in-scope; O3 —
M6 green plus M1–M5 attempted; O4 — M6 green; O5 — the replay; B1 —
M1–M3, plus M8 on full runs; B2 — M1; B3 — M2–M3, plus M8 on full
runs; B4 — M6, plus M8 on full runs; B5 — M1–M2 on reduced runs,
plus M4–M5 on full runs; B6 — M5; B7 — M6, plus M8 on full runs;
B8 — M7; B9/B10/B11 — the whole run. Per-dimension rules (these govern; there is no blanket
O-rule): O1 and O2 score whenever the grading phase ran, over every
in-scope milestone regardless of status (failed/blocked checklists
score not-passed — the partial-credit design); O3 and O4 require M6
green (O3 additionally M1–M5 attempted); O5 requires the replay
*attempted* — its exact function scores failures, including its 0
branches, so an attempted replay is never null; B-dimensions score
if every observing milestone was at least attempted
(`green`/`capability-failure`/`aborted`), except B9/B10/B11, which
score if at least one milestone was attempted (terminated lanes'
experience data is exactly what must publish). Never-attempted
scopes record null. So reduced runs (M1–M3) record null for O3, O4,
O5, B4, B6, B7, B8. The P1 applicability manifest instantiates this
table at assertion granularity for the record schema. A **complete
lane**, by enumeration: M6 green, replay attempted, M7 attempted,
every other milestone attempted — that is execution completeness; a
weighted total and L4 eligibility additionally require a **usable
grading record** (the dual grader-abort outcome nulls O-dimensions
and overrides these applicability rules). **Any run with a null dimension publishes
per-dimension scores and efficiency statistics only — no overall
weighted total**; L4 statistics read complete lanes, with every lane
reported and the completion rate published alongside (the Holistic
section's "report both" applies only when a weighted total exists).
On reduced
runs, anchors are interpreted over M1–M3 scope only (O1's 60-anchor
reads "M1–M2 solid, M3 patchy"; B5 reads over avatars and post
media). The holistic score is recorded and published for every run
as narrative evidence, never a claim statistic.

Anchors describe what ~30 / ~60 / ~90 look like; interpolate.

### Grader-scored outcome (45)

**O1. Functional completeness — 13.** Fraction and quality of the
frozen acceptance checklists passing, with **every milestone of the
run's scope in the denominator** regardless of status — non-green
milestones (`capability-failure`, `aborted`, `blocked-by-M{n}`,
`not-run`) score their checklists as not passed (the status
distinction matters for attribution, not for completeness
credit). *30:* core features
partially work; several checklist items fail. *60:* M1–M4 solid,
later milestones patchy or failed on cap. *90:* every in-scope
milestone green, including platform-proof artifacts.

**O2. Correctness under grading — 7.** Severity-weighted defects the
grader finds beyond the checklist (crashes, wrong data, broken flows).
*30:* multiple high-severity defects in core flows. *60:* a few
medium defects off the happy path. *90:* only cosmetic nits.

**O3. Trust boundaries — 8.** Holdout-probe results: authorization
enforced server-side, not by UI absence. *30:* a probe reads another
user's private data. *60:* core reads protected; a secondary probe
(e.g., expired-window edit) succeeds when it shouldn't. *90:* every
probe correctly denied, including asset access after view-once/delete.

**O4. Observed offline behavior — 9.** What the offline acceptance
actually demonstrated, and honesty of any gap between claim and
guarantee. *30:* cold-start offline shows an empty or broken app.
*60:* reads work; offline writes lost or mis-ordered, or receipts
wrong after flush. *90:* reads, ordered queued writes, receipt
transitions, and offline search all behave as specced on the native
proof — on full runs including M8's durable-queue restart and
multi-device convergence evidence.

**O5. Performance at the scale envelope — 8.** A **scale-safety
gate**, mapped by an exact function of the frozen invariants — never
a cross-backend speed comparison (deployment postures differ; see
the replay contract), never perceived feel; absolute latencies
publish as diagnostics only. Full-app runs only; the rubric-wide
"interpolate" instruction does not apply to O5. Function (the P3
decision table instantiates it against the frozen ceilings): **0**
if the invariant manifest does not conform or replay's cap was
exhausted; **30** if any degradation rule fails or any probe times
out/errors/OOMs; **60** if all rules pass but any ceiling is
exceeded or replay used >80% of its cap; **90** if every probe's
observed ceiling utilization is ≤50% and replay used ≤50% of its
cap; **75** otherwise (all rules and ceilings pass, 90's condition
not met). Bands evaluate **first-match in the order 0, 30, 60, 90,
75** — the function is total and unambiguous by construction. Each
degradation rule's measurable predicate (the p95 comparisons over
k=20 samples) is frozen with the probe set.

### Builder-scored experience (55)

**B1. Schema and data-model ergonomics — 6.** Declaring this app's
model: chats, membership, messages, receipts, reactions, posts, and
the follow graph with its feed read-models — on full runs including
M8's aggregate read-models (insights totals, 7-day buckets,
trending).
*30:* fought the model layer; workarounds encode the model in blobs
or duplicate state. *60:* workable with boilerplate or missing
constructs (e.g., no clean unique constraint). *90:* the model
expressed directly; constraints (handle uniqueness, DM dedupe)
enforced where declared.

**B2. Auth ergonomics — 5.** Real signup/login/sessions on this
backend. *30:* hand-rolled critical pieces (hashing, tokens) or
fought the built-in system into shape. *60:* built-in auth fit with
notable ceremony or docs gaps. *90:* secure-by-default flow wired
quickly; sessions and server-side scoping composed with the data
layer.

**B3. Realtime ergonomics — 6.** Live queries and ephemeral state
(typing, presence-ish). *30:* polling or hand-built channels for core
liveness. *60:* live data easy but ephemeral state needed a durable
workaround (tables + expiry jobs). *90:* both durable-live and
ephemeral expressed with purpose-built primitives.

**B4. Offline/sync authoring ergonomics — 7.** Effort to *author* the
offline behavior (distinct from O4's observed result). *30:* the
offline layer was built by hand (own cache, own queue, own conflict
handling). *60:* platform gives reads or writes but not both, or the
guarantees were hard to determine from docs. *90:* offline reads and
queued writes fell out of the platform with configuration-level
effort, and the docs stated the actual guarantees.

**B5. Media and storage ergonomics — 4.** Upload, serve, authorize,
and delete media, including view-once/tombstone asset denial. *30:*
CORS/auth/URL ceremony dominated; asset denial required hacks. *60:*
happy path smooth; access revocation awkward. *90:* policy-integrated
storage: upload trivial, per-recipient/one-view denial expressible
server-side.

**B6. Search ergonomics — 3.** Building the three search scopes with
the offline requirement. *30:* full client-side scan hand-rolled with
no help. *60:* server search easy but the offline requirement forced
a second parallel implementation. *90:* one coherent approach covered
online and offline search.

**B7. Push/actions ergonomics — 3.** Detecting no-connected-client
and emitting through the seam; on full runs, also authoring M8's
scheduled digest. *30:* no server-side hook existed;
polling or external infra required, or the digest needed an external
scheduler. *60:* doable with plumbing
(connection tracking or scheduling hand-built). *90:*
presence/connectivity, a notification seam, and scheduled server-side
work were first-class.

**B8. Day-2 evolution experience — 6.** Scored by the M7 session: the
schema-change-against-live-data loop. *30:* migration risked or
required manual data surgery; codegen/types fought the change. *60:*
migration worked but the workflow was undocumented or nervous
(no dry-run, unclear rollback). *90:* additive evolution was routine:
declare, migrate, types flow through, data verifiably intact.

**B9. DX, docs, setup — 6.** From zero to productive: install,
scaffold, dev loop, doc discoverability at point of need. *30:*
setup consumed a milestone's budget; docs missing or wrong. *60:*
productive after friction; some knowledge only in community sources.
*90:* first green proof fast; every needed doc was findable when
needed and correct.

**B10. Diagnostics and error quality — 4.** When things failed, did
the platform say why (LLP 0193's errors-as-docs bar). *30:* opaque
errors; debugging by bisection. *60:* accurate but shallow errors;
root causes needed digging. *90:* errors named the actual cause and
pointed at the fix or doc.

**B11. Operations and maturity — 5.** Running, inspecting, and
trusting the backend during development: data inspection, logs,
resets, lifecycle. *30:* opaque runtime; state inspected by writing
code. *60:* adequate basics, gaps in inspection or lifecycle. *90:*
productized dev operations: console/CLI inspection, clean resets,
trustworthy lifecycle.

### Holistic (builder, non-formulaic)

One 0–100 for "what was this experience actually like," explicitly not
computed from B1–B11, recorded before any totals are visible, with 2–3
cited moments. Divergence between holistic and weighted totals is
signal, not error — report both.

## Narrative artifacts

Per lane: a run diary (`diaries/` convention) with a timestamped entry
at each milestone boundary, and a 1–2 page closing essay — purely
qualitative, comparing the backend against alternatives the model
knows — written before any metrics are visible.

## Budget caps and performance ceilings (placeholder — set at P3 from pilot)

Cap keys, formulas, and fallbacks: see the Budgets paragraph in
the Milestones preamble (the single authority). At P3 this table
grows one row per milestone, with one token-cap column per cap
family.

| Milestone | Wall cap | Token cap |
|---|---|---|
| M1–M7 | *pilot-calibrated* | *pilot-calibrated* |
| M8 | *P2b-extension-calibrated* | *P2b-extension-calibrated* |
| Scale replay (own clock) | *pilot-calibrated (rerun after the M8 scale-log regeneration)* | n/a |

| Performance probe | Absolute p95 ceiling |
|---|---|
| *per rotated probe set* | *pilot-calibrated* |

## Lane-prompt block (placeholder — instantiated at freeze)

The verbatim per-lane prompt is instantiated at P3 freeze from this
brief plus the kit/fixture versions and budget caps, and recorded here,
following the messaging brief's convention.

````


## Input: diary.md

SHA-256: `76f52393cd854f88821b594f2e23a2be2ea44434373a973aafe393134c0fe52a`

````text
# Diary

## M1

Built identity (password auth), profiles, follow graph, and the Expo Router shell with the frozen UI kit. Seeded personas through the action log. Acceptance suite and web choreography both went green.

Easy: Snapback `use identity` plus `snapback2 init` chat template gave a working owner quickly. Profile live-query for Bob watching Alice's edit landed without extra plumbing.

Fought: auth rate limits during suite signups; Quarry dummy expressions (`non-final expression must be a write`); iOS Hermes export died on `react-native-screens` types (recorded attempted, not a simulator proof).

Prior familiarity: Expo Router layouts and Playwright testIDs. Missing docs: exact owner URL/token-store pairing for Expo web; discovered from the package guide and generated client types.

Backend vs others at this step: closer to Convex than Supabase — schema-first live queries, no hand-rolled REST. The Quarry type checker is stricter than either, which slowed the first compile but caught real mistakes.

## M2

Built posts, likes, reposts, following/global/trending feeds, thread replies, and the persistent feed shell. Suite green (`receipts/suite-m2.json`). Web choreography reached 8/9 required checks; `repost-following-feed-surface` stayed red (Global not observable after unfollow, or viewer-repost counted as a direct hit). Recorded capability-failure on remaining choreography after repeated correction loops (Playwright `.first()` vs hidden DOM, tab remount resetting to Following, follow-button state vs merge).

Easy: live text/image/video posts between two browsers; like/unlike and reply thread once the feed stayed mounted.

Fought: Expo stack leftover `sm-feed-item` nodes; `router.replace("/")` remounting FeedTabProvider; `counts.followingThem` point-read disagreeing with the follow merge; nested FeedCard Pressable intercepting Playwright clicks.

Prior familiarity: Playwright visibility vs occlusion. Missing: a first-party “feed tab” primitive; we invented Chrome overlay + sessionStorage tab. Platform gap: no skip flag on `useQuery`, so dummy principals poisoned follow counts.

Backend vs others: merge feeds (`merge timeline … for f in follows[viewer]`) are the distinctive Snapback move — one query instead of fan-out jobs. Live updates on that merge after unfollow were the hard part, more brittle than a Convex index range I’d control from the client.

## M3

Suite already green from the prior stretch (DMs, groups, quotes). Web choreography died in login: four Playwright contexts `Promise.all` against Snapback’s two concurrent password attempts. Recorded as instrument/platform. Easy: deliver-to-memberships. Fought: cannot raise identity rate limits from Quarry.

## M4–M8 (suites)

M4 suite green after pointing reaction-replace at `reactionsOn` (richThread last 5 could not see `sm0001`). M5 and M8 suites green. M6 sample-50 adapter still `E_FIELD oncePhoto` on an owner that never installed successors past generation dde1dc08. Scale replay on a fresh instance not run. Native simulator artifacts recorded unavailable on Linux. Two consecutive choreography capability-failures (M2, M3) ended the lane per protocol.

````


## Input: essay.md

SHA-256: `29d6dc3b7b4de5fedd9713867a0c2ee21521025c65b3c6f9b5df37165e2a5303`

````text
# Essay: building Clique on Snapback 2

I came into this lane with Convex and Supabase as the two backends I actually
know how to ship a messenger-shaped app on, plus enough Firebase/Appwrite
scar tissue to have opinions. Snapback 2 is none of those. It is a schema
language (Quarry), a live-query runtime, an identity primitive, and a
deliver/receipts/effects stack that wants the product to be expressed as
tables, merges, and jobs rather than as HTTP handlers.

## Where it reduced friction

The first hour was the best hour. `use identity` plus `snapback2 init` gave a
password-auth owner and a typed client without me inventing JWT refresh,
session cookies, or a users table. Profiles were a table with `unique
byHandle` and a public read rule. Follows were another table. I did not write
a `/api/follow` route. I did not write a websocket. Two Expo clients pointed
at the same owner and Alice’s profile edit appeared on Bob’s screen because
the query was live. That is the Convex feeling, except the schema is the
program, not a TS file that happens to live next to the queries.

Feeds were the second place the model earned its keep. A following feed as

```
merge timeline last 40 by byActorTime:
  [viewer]
  [f.followed] for f in follows[viewer] first 500
```

is a single idea: self-follow is a merge lane, not a row, and unfollow is
deleting a follow row so that lane disappears. I have written the Convex
equivalent with two indexes and a client-side merge. I have written the
Supabase equivalent with a view and then fought RLS. Here the merge is the
product. Likes, repost counts, and “did I repost this” were maintained
aggregates hanging off the same timeline table. When it compiled, the live
heads were free.

Deliver-to-memberships for DMs and groups is the third. Receipts, typing
channels with TTL, and `once` image fields are in the language. View-once
and disappearing expiry are schedules on the row, not a cron I had to
remember. The digest job is a `chunk` loop. I did not stand up a queue.

## Where it added friction

Quarry is a type checker that talks in cost meters. That is useful until it
is not. `richThread last 50` with nested projections blew `E_BOUND`. Dummy
expressions were illegal (`non-final expression must be a write`). A `proc`
cannot return a value I wanted to reuse; a `fn` cannot see `now`. I learned
those by being refused, not by reading a tutorial that led with them. The
guide is complete if you already know which guide to open. It is not a
getting-started narrative.

The client is the other half of the product and Snapback does not help you
with Playwright. `useQuery` vs `usePage`, `{ c: null }` as a new object every
render, Expo Router keeping profile screens mounted with `sm-feed-item`
still in the DOM — those are ordinary React problems, except the
choreography harness treats DOM order as truth. `.first()` does not skip
`display:none`. I spent most of M2 on that, not on Quarry. Convex would have
left me in the same hole. Supabase would have too. The difference is I also
could not reach for `skip: !principal` on a query, so a dummy
`p: "dev:alice"` poisoned follow-button state.

Password auth is fixed at two concurrent attempts, eight per account, sixteen
per IP, thirty-two per owner, per sixty seconds. The M3 choreography logs in
Alice, Bob, Carol, and Dave with `Promise.all`. That is a structural clash
between the frozen harness and the platform. I could not raise the limit from
Quarry. I recorded it as a platform/instrument gap. On Convex I would have
turned the rate limiter off in the test project. On Supabase I would have
used the service role. Here the identity primitive is not mine.

Live merge after unfollow was the sharp edge. The suite could see the
follow row come and go. The web feed sometimes still showed Alice’s original
as a direct Following hit, or Global did not show a post Playwright could
call visible, depending on whether Expo had remounted the tab provider.
`router.replace("/")` reset React state to `following`. I persisted the tab
in `sessionStorage`. That fixed eight of nine M2 checks. The ninth,
`repost-following-feed-surface`, did not go green in this session.

## How the shape of the work changed

On Supabase the work is: tables, RLS, then a lot of client caching so the
UI does not look dead. On Convex the work is: tables, indexes, then queries
that feel like the UI. On Snapback the work is: get the Quarry to admit the
shape, then keep the React tree from lying to Playwright. There is almost
no “write the API.” There is a lot of “name the index so the merge is
legal.” Effects (Ibex) fire push and digest without me running a worker,
which is closer to Convex actions scheduled on cron than to Supabase
pg_cron plus Edge Functions.

I would use Snapback again for a product whose live projections *are* the
product — feeds, presence, receipts — and whose team will live in the
guide. I would not use it yet for a test harness that logs in four browsers
at once, or for an agent that has four hours per milestone and a DOM
contract as strict as this one. The backend reduced the number of files
that had to exist. It increased the number of times I had to ask the
compiler what a page of twenty rows is allowed to remember.

````


## Input: run-log.md

SHA-256: `bf0d7ea5265e143edb4ea2d3124f5ae021490b50303950312680862ef1056f56`

````text
lane id grok-clique-snapback2
model grok-4.6
effort=xhigh
backend=snapback2-0.0.29
start=1789191914

1789191914 bootstrap: created run-log.md; lane empty except instrument symlink. source: diagnostic
PID owner=3888645 port=53400

1789193803 M1 suite pass receipts/suite-m1.json source: diagnostic
1789194xxx M1 choreography green receipts/choreo-m1.jsonl source: diagnostic
PID owner=3888645 port=53400 snapback2
PID expo=3893982 port=53401

1789198748 M2 choreography retry: hide FeedBody/profile/thread sm-feed-item off-route (Playwright .first() was targeting display:none cards); router.navigate('/') on feed-tab click; explicit follow boolean. attribution: agent-error. source: diagnostic receipts/choreo-m2.jsonl

1789199220 M2 choreography retry: feed as real index route + FeedQueryProvider (avoid display:none layout collapse); last 40 feed page; profile posts use non-sm-feed-item testID. attribution: agent-error. source: diagnostic receipts/choreo-m2.jsonl

1789199700 M2 choreography retry: persistent visible FeedBody under opaque stack overlay so feedProjectionState can observe following/global while on profile; composer hidden off-feed; dismissTo+replace home; profile posts not sm-feed-item. attribution: agent-error. source: diagnostic

1789200000 M2 choreography retry: persist feed tab in sessionStorage; do not replace(/) on tab click (was remounting provider and resetting tab to following). attribution: agent-error. source: diagnostic

1789200600 M2 choreography retry: in-flow stack when off-feed so FeedBody stays isVisible behind profile; tab click pushes /; only active feed list renders. attribution: agent-error. source: diagnostic

1789201200 M2 choreography retry: follow counts query only after principal exists (dummy p:dev:alice made Unfollow look like Follow); replace(/) + history.replaceState to drop leaked ?handle=. attribution: agent-error. source: diagnostic

1789201600 M2 choreography retry: restore 8/9 Chrome (dismissTo, overlay display:none, persisted tab) plus principal-scoped follow counts. attribution: agent-error. source: diagnostic

1789202100 M2 choreography retry: 8/9 chrome + principal-scoped follow counts, no sm-profile gate, no history.replaceState. attribution: agent-error. source: diagnostic

1789202900 M2 choreography retry: wait for follow counts status=ready before rendering sm-profile so unfollow sends following:false. attribution: agent-error. source: diagnostic

1789203400 M2 choreography retry: forceFeed on tab click so overlay hides immediately without waiting for pathname. attribution: agent-error. source: diagnostic

1789203700 M2 choreography retry: forceFeed hides overlay immediately; composer only when pathname is feed (avoid duplicate sm-compose-input). attribution: agent-error. source: diagnostic

1789204000 M2 choreography retry: restore 8/9 chrome; client-filter following feed by myFollows so unfollow drops originals immediately. attribution: agent-error. source: diagnostic

1789204300 M2 choreography retry: follow button state from myFollows list (counts.followingThem was null while merge still included Alice). attribution: agent-error. source: diagnostic

1789204800 M2 choreography retry: revert to 8/9 configuration (overlay+dismissTo+persist tab, no client follow filter, counts.followingThem). attribution: agent-error. source: diagnostic

1789205100 M2 choreography not green after repeated application misses on repost-following-feed-surface (and intermittently repost-toggle-live-attribution). Best result 8/9 required checks. Suite remains green receipts/suite-m2.json. Recording capability-failure for M2 choreography green-bar (wall-clock exhaustion on remaining feed-surface checks). attribution: agent-error + ambiguous (follow counts vs merge live projection). evidence: receipts/choreo-m2.jsonl

1789205400 M3 choreography fatal at login: frozen harness Promise.all of alice+bob+carol+dave (4) vs snapback2 password auth 2 concurrent attempts (E_AUTH_RATE_LIMIT, wait 60s; choreo timeout 20s). Recorded as instrument/platform gap. Suite already green receipts/suite-m3.json. source: package README/guide auth.md, diagnostic

1789206100 wrap: essay.md and final-report.md written. M1 green. M2/M3 consecutive choreography capability-failures. M4 suite green choreo-failed. M5/M8 suites green choreo not-run. M6 suite a13 fail. Scale replay not-run. Killing recorded PIDs only.
end=1789206100

````


## Input: final-report.md

SHA-256: `c7184d78755f65ab5c034a038a23b4dc3734998bd4f1327a240285f57f09f421`

````text
# Final report — grok-clique-snapback2

lane id: grok-clique-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.29
host: Ubuntu Linux x86_64 (AMD Ryzen 5 3600, host 450b / expose-builder-pixel-a)
ports: owner 53400 PID 3888645; expo web 53401 PID 3893982

## Clock

| | epoch |
|---|---|
| start | 1789191914 |
| end | 1789206100 |
| wall_s | 14186 (~3.94 h) |

Approximate first-green / boundary times (from run-log and receipts):

| milestone | start_epoch (approx) | first suite green | choreography | wall note |
|---|---|---|---|---|
| M1 | 1789191914 | 1789193803 | green `receipts/choreo-m1.jsonl` | foundation |
| M2 | 1789193803 | suite-m2.json (prior session) | not green; best 8/9 | ~3h correction on feed DOM |
| M3 | 1789205242 | suite-m3.json already pass | fatal login (instrument) | 4 parallel logins vs 2 concurrent |
| M4 | 1789205542 | 17892055xx suite pass | choreo-failed (photo bubble) | |
| M5 | 1789205542 | suite pass | not-run (carol context) | |
| M6 | 1789205542 | suite fail a13 | not-run | sample-50 oncePhoto / rate limit |
| M8 | 1789205542 | suite pass | not-run (alice2 context) | |

## Status

| milestone | status | suite | choreography | notes |
|---|---|---|---|---|
| M1 | green | pass `receipts/suite-m1.json` | green `receipts/choreo-m1.jsonl` | |
| M2 | capability-failure | pass `receipts/suite-m2.json` | application, 8/9 best | `repost-following-feed-surface` remained red |
| M3 | capability-failure | pass `receipts/suite-m3.json` | instrument fatal at login | see gap: 4× Promise.all login vs 2 concurrent |
| M4 | capability-failure | pass `receipts/suite-m4.json` | application miss | photo/video live render |
| M5 | not-run (choreo) / suite green | pass `receipts/suite-m5.json` | not-run | blocked by same login concurrency as M3/M5 carol |
| M6 | capability-failure | fail m6-a13 | not-run | sample-50 `E_FIELD oncePhoto`; owner generation stuck at dde1dc08 |
| M7 | not-run | — | — | out of scope this session |
| M8 | not-run (choreo) / suite green | pass `receipts/suite-m8.json` | not-run | alice2 login; native sim unavailable |

Two consecutive capability-failures (M2 then M3 choreography) are the protocol stop. Later suite runs were extra evidence, not a claim that M2/M3 went green.

## Correction loops (attribution)

| loop | attribution | evidence |
|---|---|---|
| Quarry proc/fn/now/job chunk, E_BOUND richThread last 50 | snapback2-defect / language | check refusals; slimmed thread to last 5 |
| Auth rate-limit during suite signups | environment | reused seeded logins |
| Persistent FeedBody + display:none vs Playwright `.first()` | agent-error | receipts/choreo-m2.jsonl click timeouts |
| `router.replace("/")` remount reset tab to following | agent-error | sessionStorage tab persist; 8/9 M2 |
| `counts.followingThem` dummy `p: "dev:alice"` | agent-error | follow button said Follow while merge still had Alice |
| 4 parallel choreography logins vs 2 concurrent password attempts | snapback2-defect + instrument | guide/auth.md; M3 fatal outcomeClass instrument |
| Owner successor not installing (generation stayed dde1dc08) | snapback2-defect / environment | `snapback2 dev --status`; later .q not serving |
| iOS Hermes export react-native-screens types | environment | dist-ios-m1 empty |
| Native Apple simulator | environment | Linux host; receipts/simulator-status.json |

## Suite and choreography per milestone

- M1: suite pass, choreo green.
- M2: suite pass (coverage-m2.json). Choreo not green; required misses concentrated on `repost-following-feed-surface` and intermittently `repost-toggle-live-attribution`.
- M3: suite pass (a03,a04,a05,a10,a11,a14,a15). Choreo fatal before assertions (login wait for authenticated surface).
- M4: suite pass (a01,a03,a06,a07,a09). Choreo application misses on photo/video live render and downstream reaction/delete.
- M5: suite pass (a04,a05,a08–a11). Choreo not run.
- M6: suite fail a13 sample-50 adapter (`E_FIELD missing field oncePhoto` and/or auth rate limit). a08–a11 pass (push log, custom-client-demo).
- M8: suite pass (a01,a03–a07). Choreo not run.

## Native artifacts

- iOS Hermes bundle export: attempted, failed (`react-native-screens` SearchBarNativeComponent). Not native-simulator proof.
- M6 ios-simulator-m6: unavailable / not-run — Ubuntu Linux x86_64, no Xcode/simulator. See `receipts/simulator-status.json`.
- M8 ios-simulator-m8: unavailable / not-run — same.

## Scale replay

Not executed on a fresh owner instance. Planned as a second `snapback2 dev --port 53402` with `replayMode` against `fixtures/social-messenger/scale.log` and `invariant-manifest-combined.json`. Blocked by M6 adapter a13 and the two-consecutive-CF stop. start/end epochs: not-run. verification: not-run.

## Resolved package pins

- snapback2 0.0.29 (npm), linux-x64 binary sha256 as in setup-identity.json (`2b0d8d20…`)
- expo ~54.0.37, expo-router ~6.0.24, react 19.1.0, react-native 0.81.5
- playwright 1.62.1 (choreography)
- instrument social-messenger@0.3.8-m8, ui kit vendored under `ui/`

## Hand-authored line counts (lane product, not instrument copies)

Approximate, excluding `node_modules`, `.snapback`, copied `choreography/` and `metering/`, vendored `ui/`:

| file | lines |
|---|---|
| scripts/acceptance.mjs | 681 |
| snapback/tests/chat.test.ts | 764 |
| snapback/schema.q | 333 |
| snapback/messages.q | 278 |
| scripts/replay.mjs | 306 |
| app/conversation/[handle].tsx | 377 |
| components/FeedBody.tsx | 165 |
| snapback/groups.q | 168 |
| components/PostCard.tsx | ~90 |
| app/profile/[handle].tsx | ~120 |
| components/Chrome.tsx | ~75 |
| lib/feedData.tsx | ~30 |
| lib/feedTab.tsx | ~40 |
| lib/provider.tsx | ~40 |
| scripts/seed.mjs | ~40 |
| scripts/custom-client-demo.mjs | ~24 |
| API.md | (present) |
| remaining snapback/*.q (profiles, follows, posts, feeds, insights, digest, admin, access, notifications, config) | ~800 combined |

Exact per-file totals for the whole tree including copies: 37681 lines / 134 files (dominated by vendored metering/choreography tests).

## Candid gap list

1. M2 web choreography never fully green; Following vs Global after unfollow/repost is the remaining product/DOM gap.
2. Snapback password auth 2-concurrent vs frozen choreography `Promise.all` of 3–4 personas (M3/M5/M8).
3. Owner successor generation did not advance past `dde1dc08` after later Quarry edits (`reactionsOn`, optional `oncePhoto`); sample-50 still `E_FIELD oncePhoto`.
4. No `useQuery` skip; dummy principals are dangerous.
5. iOS Hermes export and native simulator proofs unavailable/failed on this Linux host.
6. Scale replay not run on a fresh instance.
7. Seed logs only exist for m1–m3; m4–m8 seed mapped onto starter-m3.
8. `richThread` bounded to last 5; reaction-replace test had to move to `reactionsOn`.
9. Push/digest effects: 39 failed, 1004 sent on the long-lived owner (digest firing on shortened 2m schedule).
10. Expo iOS export blocked by react-native-screens types.

end=1789206100

````


## Input: run-record.json

Missing file; no source SHA-256.

[MISSING: run-record.json — not present in the preserved continuous-builder boundary.]


## Input: m7/diary.md

SHA-256: `95174c5fd8fdcec9fd34e97aed58a5e9e2a5f0ce2cd9a629ca9d489770720114`

````text
# M7 diary — grok-clique-snapback2

Built group polls as a real message type (question, 2–4 options, live tallies) plus a conversation-level `visibleMessageCount` that was backfilled over the starter conversations and shown in chat settings. Votes are idempotent set-state: each client mutation id is stored on `pollVoteIntents` so a retry cannot flip the current option, while a new id can change the vote. Offline votes use the existing Snapback outbox the same way reactions do.

Easy: additive Quarry tables (`polls`, `pollOptions`, `pollVotes`) and `snapback2 check` once the shape was legal. The engine actually installed the first successor (`dde1dc08` → `c1f23b23`) and backfilled two maintains. Headless create/vote/retry worked on the first smoke. The kit already had PollDisplay/PollCompose and chat-settings messageCount, so UI wiring was mostly data, not pixels.

Fought: a job that `update`s `messages` is priced as delivery fan-out × chunk size and refuses `E_BOUND` — you cannot backfill a column on a `deliver` table that way. Dropping a column I had already installed was `E_SUCCESSOR_DESTRUCTIVE`. Nested `maintain` point reads inside `latestPolls` made the React offline client report `partial/computed-key` even while online, so the choreography never saw `sm-poll-option` until tallies moved to the client. Password auth’s 16/IP/60s limit made nested previously-green suites fail unless they paused. MutationId on `pollVotes` is immutable, so a change-vote could not record the new id until a separate intent table existed.

A migration on Snapback 2 is a schema successor the running owner installs (or refuses with a plan file). Additive tables and optional columns are the happy path; required columns need a fill job; dropping anything needs `--apply-migration`. Maintains backfill themselves. Jobs cannot write maintain targets and should not touch `deliver` rows. Compared with “add a column and UPDATE in SQL” this is stricter and more honest about fan-out cost, and compared with a document store it forces the backfill to be a named job or an engine-built maintain rather than a silent reshape.

````


## Input: m7/essay-paragraphs.md

SHA-256: `e4d86568f27097aa7c5f9189cdd42e31a44f926f6a901d0337b77e9e8bd1288a`

````text
Day-2 on this backend is not “open a migration file and hope.” The owner is already serving a generation; `check` certifies a new one; `dev` either installs it transactionally or keeps the old generation and writes a refusal with a plan. That split is the whole feeling of M7. Polls could have been a side table that never touched existing rows — and in fact the first successful successor did exactly that, plus an optional `messages.visible` and two new maintains that the engine backfilled. The brief’s forced migration is the second move: a field on every conversation, filled by a job. The job that tried to stamp `visible` onto `messages` was illegal not because the language lacks UPDATE, but because `messages` carries `deliver to memberships`, so a 100-row chunk is priced as five thousand delivery writes. The legal backfill was `update conversations` from `messageCounts`. That is a real schema successor with a named fill, and it is also a reminder that “touch existing data” has a cost model.

The day-2 product work was polls, and the surprising fight was not the vote rule. Idempotent set-state is a table with a unique mutation id: retry finds the intent and returns current state; a new id updates the one-vote-per-user row. What the two-client harness actually tripped on was a live query that nested a maintain lookup inside a page shape. Headless Node, with no offline store, returned tallies immediately. The web client, which always mounts IndexedDB, marked the same query `unavailable` / `computed-key` / “some data is not downloaded.” Choreography then timed out on `sm-poll-option` while the composer — a mutation hook, not that query — rendered fine. Flattening the query to options plus votes, counting in the UI, made the poll appear and the live and offline vote checks go green. That is the M7 lesson in one sentence: a successor can be correct in Quarry and still invisible to the offline-first client if the read is not a held range.

Previously green suites still pass if you do not pretend the owner is empty. Nested M1–M5/M8 runs on the same seeded instance hit password rate limits (two concurrent, eight per account, sixteen per IP, thirty-two per owner, then wait sixty seconds) and leftover follow edges. The regression item is therefore as much an operations problem as a product one: wait out the auth window, do not assume starter counts stay exact after forward writes, and keep prior failures (M6 sample-50, M2/M3 choreography) unrestored. The pre-M7 snapshot, taken over the M6 field manifest with each persona’s session before any successor, compared equal after the migration. Existing messages, media, receipts, and reactions survived. That is the bar the brief asked for, and it is the bar this backend can meet when the successor stays additive and the fill job stays off the delivery log.

````


## Input: m7/run-log.md

SHA-256: `5d06f455735ea2ab896f43b3158d3cf3d820f2682b691f3747ba23489a750eac`

````text
lane id grok-clique-snapback2
model grok-4.6
effort=xhigh
backend=snapback2-0.0.29
phase=m7
start=1789208836

1789208836 start: M7 fresh session. Read instrument ENVIRONMENT.md, CONTRACT.md, social-messenger.md §M7, assertions.json M7, fixtures README, choreography README (m7 sole segment). Host overlay: Ubuntu Linux x86_64 Ryzen 5 3600 host 450b / expose-builder-pixel-a, Node 24.18.0, Playwright 1.62.1. Ports 53400–53419. source: instrument/ENVIRONMENT.md, instrument/social-messenger.md, user prompt

1789209264 knowledge lookup: snapback2 successor/migration guide (npx snapback2 guide successor / dist/guide/successor.md). Additive tables/optional columns/new maintains install transactionally; required columns on populated rows need fill job then require; maintain regrouping replaces union of projected IDs; jobs cannot write maintained targets. source: node_modules/snapback2/dist/guide/successor.md

1789209264 knowledge lookup: pre-M7 schema already carries `maintain messageCounts: count messages by conversationId` (raw row count). `groups.conversation` already returns `messageCount` as that maintain; chat settings UI does not pass it to ChatSettingsForm. deleteForEveryone hard-deletes; expireMessage schedule deletes. No poll tables. Recorded for B8 honesty. source: snapback/schema.q, snapback/groups.q, snapback/messages.q

1789209264 plan: start fresh owner on inherited schema; seed starter-m1/m2/m3 via scripts/seed.mjs; export m7/pre-snapshot/ over M6 field manifest; then successor (polls + visible discriminator + visibleMessageCounts) and backfill job. Do not reuse prior store residue.

PID owner=4128980 port=53400 snapback2 (fresh after reset)

1789209592 seed starter-m1 16 actions. source: scripts/seed.mjs
1789209738 seed starter-m2 52 actions, starter-m3 18 actions (m3 ~65s, likely auth rate-limit wait). attribution: environment
1789209738 pre-M7 snapshot exported to m7/pre-snapshot/ (8 personas; alice 2/15, bob 2/15, carol 1/9). manifest sha256:7dc92bc9084a72033b65c75858404ff056b432ca144f0bbaad222a51046197ce. source: scripts/export-m7-snapshot.mjs

17892100xx check: fill job updating messages refused E_BOUND (deliver fan-out × 100). attribution: snapback2-defect / language. workaround: do not update `messages` in jobs; backfill `conversations.visibleMessageCount` instead. evidence: snapback2 check diagnostic heap/write amplification

17892100xx first successor installed c1f23b23 from dde1dc08: added polls/pollOptions/pollVotes, messages.visible, visibleMessageCounts, pollOptionCounts; backfilledMaintains=2. Attempt to drop visible/visibleMessageCounts then refused E_SUCCESSOR_DESTRUCTIVE. attribution: agent-error (reverted a live additive column). kept visible + added conversations.visibleMessageCount. generation 6d41ae7d. source: snapback2 guide successor, snapback2 dev --status --json

1789210057 job fillConversationCounts --as system --wait: 4 conversations (conversation-1/2, d-alice-bob, g-starter). post-migration alice: dmCount=6 stored=6, gCount=9 stored=9, history sm0015 intact. evidence: diagnostic query

1789210280 smoke: sendPollIdentified + setVote idempotent retry keeps option; change with new mutationId moves tally. source: diagnostic

1789210293 m7 suite first run: a01,a03,a06,a07 ok; a04 failed (retry flipped). a09 nested m2 pagination fail (global page1 33 vs expected 20). attribution: agent-error (setVote did not persist later mutationIds; feed was last 40). evidence: receipts/suite-m7.json first fail

17892104xx added pollVoteIntents table so each mutationId is recorded and retried as no-op. feeds.globalFeed/followingFeed last 40 → last 20 to match brief 20/page and m2-a23. check 91677243. source: snapback2 check, social-messenger.md M2 pagination

1789210556 suite retry: a04 ok; a06 failed because d-alice-bob had grown to 12 (forward writes). a09 m2-a11 frank-in-following from leftover a22 follows. attribution: agent-error (hardcoded starter counts; re-run pollution). evidence: suite log

17892106xx a06 now compares live messageCount to paged visible history and requires storedMessageCount non-null plus starter minimums. m2-a11 unfollows frank before asserting. a09 waits 65s between nested suites for E_AUTH_RATE_LIMIT (8/account, 16/IP, 32/owner per 60s). source: snapback2 guide auth.md

1789210707 m7 suite pass including a09 (m1,m2,m3,m4,m5,m8). receipts/suite-m7.json sha256 ad3947e7…. evidence: receipts/suite-m7.json

PID expo=4155564 (metro MainThread) port=53401; parent npx 4155549 (after restart; earlier 4138423 killed to pick up UI)

1789211185 snapshot compare ok mismatches=0. m7-starter-poll seeded on g-starter with m7-option-a/b.

17892113xx choreo m7 miss: sm-poll-option never appeared. debug: latestPolls status=unavailable reason={code:partial, message:Some data is not downloaded, detail:computed-key}. nested pollOptionCounts maintain inside the page shape is unheld for the offline IndexedDB client. attribution: snapback2-defect / language. workaround: return options+votes; tally in the UI. evidence: playwright dump + useQuery snapshot

17892118xx choreo m7 green after flattening latestPolls and rendering PollDisplay above the thread ScrollView. receipts/choreo-m7.jsonl green:true. evidence: CHOREOGRAPHY OUTCOME green

1789211822 wrap: diary, essay-paragraphs, final-report. snapshot-compare ok. killing recorded PIDs only (owner 4128980, expo 4155549/4155564).
end=1789211822



````


## Input: m7/final-report.md

SHA-256: `e12a86b625b27dce8e03d0df7a1f496cd035772f58fa24718557c73270f1a457`

````text
# M7 final report — grok-clique-snapback2

lane id: grok-clique-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.29
phase: m7
host: Ubuntu Linux x86_64 (AMD Ryzen 5 3600, host 450b / expose-builder-pixel-a)
ports: owner 53400 PID 4128980; expo web 53401 PID 4155564 (npx parent 4155549)

## Clock

| | epoch |
|---|---|
| start | 1789208836 |
| end | 1789211822 |
| wall_s | 2986 (~0.83 h) |

## Status

`green`

Suite `npm run acceptance -- --milestone m7` pass (`receipts/suite-m7.json`).
Coverage `receipts/coverage-m7.json` maps m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09.
Choreography `node choreography/choreography.mjs m7` green (`receipts/choreo-m7.jsonl`).

## Snapshot

Pre-M7 export: `m7/pre-snapshot/` (one JSON per starter persona + `manifest.json`).
Post-M7 compare: `m7/snapshot-compare.json` ok, mismatches 0.
preExistingCountStructures: true — inherited `maintain messageCounts: count messages by conversationId`. M7 added `conversations.visibleMessageCount` (optional, filled by `fillConversationCounts`), `messages.visible`, `visibleMessageCounts`, and poll tables.

## Previously green suites (m7-a09)

| milestone | result |
|---|---|
| M1 | pass `receipts/suite-m1.json` |
| M2 | pass `receipts/suite-m2.json` |
| M3 | pass `receipts/suite-m3.json` |
| M4 | pass `receipts/suite-m4.json` |
| M5 | pass `receipts/suite-m5.json` |
| M8 | pass `receipts/suite-m8.json` |
| M6 | not re-run (prior a13 failure preserved) |

## Correction loops

| loop | attribution | evidence |
|---|---|---|
| Job updating `messages` refused E_BOUND (deliver fan-out × 100) | snapback2-defect / language | `snapback2 check` heap/write amplification |
| Dropping already-installed `visible` / `visibleMessageCounts` | agent-error | `E_SUCCESSOR_DESTRUCTIVE` plan; kept additive columns |
| Duplicate vote mutationId flipped after a prior change (immutable mutationId on vote row) | agent-error | m7-a04; fixed with `pollVoteIntents` |
| Nested maintain in `latestPolls` → web offline `partial/computed-key` | snapback2-defect / language | playwright `sm-poll-debug` JSON |
| PollDisplay inside collapsed ScrollView / composer-only visible | agent-error | choreo miss then dump of testIDs |
| Nested prior suites hit E_AUTH_RATE_LIMIT | environment + snapback2 auth | guide auth.md; 65s pauses in a09 |
| m2 page size last 40 vs suite expect 20 | agent-error / inherited mismatch | feeds.q last 20 (brief 20/page) |

## Candid gaps

1. `visibleMessageCount` on conversations is filled at migration and on poll create; live settings read `messageCounts` (remaining rows). Tombstones that stayed as `deletedAt` rows would still count until `visible` is maintained on every write path.
2. Jobs cannot backfill columns on `deliver` tables at starter scale even, let alone scale.log.
3. Web live queries that nest maintains are unusable with the default IndexedDB offline store.
4. M6 a13 (`oncePhoto` / sample-50) was not repaired.
5. M2/M3/M4 web choreography from the continuous session remain as previously recorded; M7 did not re-run them.
6. Feed page size was changed last 40 → last 20 so nested m2 pagination matched the brief; that is a small inherited-query correction under M7.

end=1789211822

````
