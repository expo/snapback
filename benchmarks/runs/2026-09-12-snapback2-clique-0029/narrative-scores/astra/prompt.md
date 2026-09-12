You are gpt-6-astra, scoring one fresh Clique diagnostic cell built on published snapback2@0.0.29. Score the backend experience out of 100, holistically and by category, using only the supplied brief and this cell's continuous-builder and fresh-M7 narratives. This is one uncontrolled diagnostic observation, not a comparative or efficiency claim. No earlier score or another cell's findings are supplied.

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
    "family": "astra",
    "model": "gpt-6-astra",
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

SHA-256: `d556b1517df3775bdc4f7558ecfaee01d5886352bccd24ad7df0451768e9aa71`

````text

## M1 — Accounts and profiles
Built password signup/login, profile onboarding, unique handles, all textual fields, authorized uploaded avatars, live public profiles, persistent sessions and logout in an Expo Router shell using the frozen kit. Built-in auth was easy to call and the generated mutation types quickly caught the old avatar field. The package starter saved wiring time but came with unrelated chat fixture tests that no longer described this build. My first cleanup script and fixture-key assumptions cost avoidable retries. The browser unexpectedly requested an unassigned old URL despite the current Expo configuration showing this lane's URL; an explicit lane URL fixed it. I have not established why that happened and attribute the routing correction to environment, not a demonstrated Snapback defect.

The actual avatar flow required less plumbing than the signed-URL/upload-table pairing I would normally assemble with Supabase. Convex would make the data functions more familiar because they are TypeScript; Quarry requires learning its constrained grammar. Built-in identity meant no adaptive-KDF implementation or external auth service. Prior React/Expo familiarity helped more than backend familiarity. The standalone platform test starts a temporary owner unless given a port; I missed that option once and recorded the out-of-range process, which had exited. The app suite and choreography pass; the derived platform suite is separately blocked because it expects its own row seed, while this app seeds through real signup and mutation calls.

## M2 — Posts and follow graph
Built text, multi-image and video posts, follow/unfollow, explicit set-state likes/reposts with persisted intent deduplication, direct replies, server counts, profile feeds, and 20-item cursor feeds. The seed replay handles all M2 verbs and real uploads. A bounded merge over compact feed heads expresses the 500-follow shape without per-follower writes. Maintained counts and nested profile/media projections were concise. The unique-key extension for own-author reposts needed an explicit index migration: the owner said exactly which index would be replaced, kept serving the previous generation, and accepted the reviewed plan without dropping content.

Most friction was mine in the client: a React Native helper missing on web, a missing direct Expo asset dependency, feed tabs unavailable from profile routes, and hidden retained Stack screens yielding duplicate composer IDs. Switching to one active Router Slot made the kit's selectors unambiguous. The suite's initial pagination assertion also assumed Bob followed enough seeded accounts; it now installs the needed follows explicitly. Those are not Snapback defects. Realtime media and count updates passed the frozen choreography on retry. Compared with SQL/Supabase, the indexed merge has less query freedom but its bound is explicit; compared with Convex, the extra language makes small model edits slower initially, while generated client types and automatic invalidations feel similarly direct. I have not yet measured the scale envelope, so this is an authoring comparison only.

## M3 — Messaging core
Built pair-deduplicated DMs, separate group entities, bounded membership/admin operations, complete history queries, quoted replies, TTL typing, generated delivered receipts and server read cursors. The matching choreography finally passes every required implemented check, including the removed-member cutoff and retained history. An iOS Hermes export is present; no native execution is claimed.

This was the most demanding step so far. Quarry's output-byte certificate immediately explained why embedding fifty full rosters inside fifty chat-list rows was untenable. Compact counterpart cards fixed that cleanly. Typing and generated delivery acknowledgements required little backend code. The hard part was consuming the client's richer state model correctly. A follower tab returns a durable queued result even online; resolving a DM from a live pair query handles that correctly. A hard browser navigation can outrun durable admission, exactly as the offline guide warns; the web shell now synchronously journals those admin intents until SDK admission, using idempotent server operations on resumption. The frozen harness's parallel login startup also collided with the documented password-auth concurrency limit; initial randomized backoff reduced that collision without changing the rate limiter.

Several apparent platform problems were my own interpretation mistakes. A cached Metro transform caused a validatePath failure that vanished with a lane-isolated cache. The stubborn retained-history failure was ultimately the shell presenting profile onboarding when a profile query became unavailable. The exact UI reproduction, including a second tab, made that visible; preserving a previously known public profile and distinguishing unavailable from absent fixed it. Cache merging and stable message IDs also make partial-history presentation more robust, but they were not the decisive fix. Prior React knowledge helped write the UI quickly and also tempted me to treat every query as a conventional loading/data pair. Convex would give me a more familiar query model here; Supabase would make me write more delivery and cache machinery myself. Snapback provides substantial machinery, but its authority and custody distinctions impose a real learning cost. No comparative performance claim follows from these authoring observations.

## M4 — Rich messaging
Built authorized image/video messages, full-screen media, replacement reactions, edit windows and delete-for-everyone tombstones. Generated asset types and server duration checks made the backend small. The image adapter fought me: a logical protected asset URL cannot be assigned directly to the UI kit's image. Fetching authorized bytes through assetBlob and handing the kit an object URL fixed the actual blank-image failure. The final suite checks loaded bytes and choreography passes the media, reaction, edit and delete flows. Native uses useAssetFile and the Hermes export succeeds; native execution remains unavailable.

Prior Expo and browser media familiarity helped diagnose rendering, while Quarry's type diagnostics caught invalid upsert syntax before deployment. Compared with Supabase, asset ownership follows the message cell with less signed-URL bookkeeping. Compared with Convex, the dedicated language still makes unfamiliar mutations slower to author, but deduplicated intent records and server time are straightforward. No real push or expiry claims belong to this milestone.

## M5 — Ephemeral content, settings and search
Built shared color/background and admin-only group identity/disappearance settings, row-scheduled expiry, per-recipient view-once photos, three indexed search scopes, and account-partitioned saved-text search. The first image opening and a direct server re-fetch test returned 200 then 410. The shortened edit/delete windows also refused late writes. The final choreography passes expiry after reopening, warm-offline search and customization; Hermes export succeeds.

The package's specialized asset and schedule primitives substantially reduced backend code. Its rule language rejected a greater-than comparison against time, so I used the documented owner timer instead of a timed read rule. Two client mistakes were material. I gave the global-search merge helper twenty-row pages when its contract requires single-row heads; the first suite was masked by locally cached matches. A direct pagination probe exposed the explicit partial receipt, and a separate head endpoint now returns exactly the same 99 chat matches through the global pager. I also let my extra persisted history cache outlive a server-deleted expiring row. Honoring the stored server deadline on load, rendering and periodic purge fixed the reopen choreography. This extra cache is another consistency surface to maintain, which is a cost worth stating plainly.

Compared with Supabase, built-in custody and view-once authorization are unusually integrated; with either Supabase or Convex I would normally author more of that machinery. Search feels less natural than SQL or a managed search API: bounds and the client N-way merge dictate endpoint shape and request count. Prior React experience helped build the surface but did not substitute for reading the helper's exact receipt contract. No scale performance claim is yet supported.

## M6 — Offline queues, push and client API
Built a pending presentation over the SDK's durable account outbox, explicit stopped-work recovery, a connected-recipient check and logged local push provider, API documentation and an executable headless client, and all thirteen replay verbs. The frozen fifty-action sample settles fully and its state passes 142 independent assertions. Web choreography proves two offline messages pending, ordered flush and normal read receipts. The Hermes export is present; native cold-start execution is unavailable on Linux and is not claimed.

The SDK supplied FIFO admission and retry custody, so this step needed surprisingly little queue machinery. I initially passed pending as a receipt enum, while the kit has a separate pending flag; generated UI types caught that. The provider seam is intentionally no-network and its effect runner settles and logs payloads. The API's explicit complete/capped versus partial/refused results require more explanation than a conventional JSON array, but they let the demo avoid treating unavailable history as empty. Prior headless-client and test design familiarity paid off in the conformance adapter. Compared with Supabase, durable local writes are a much larger supplied feature; compared with Convex, the offline authority model is richer but less familiar.

The replay adapter submits actual signup and application mutations sequentially and records committed receipts. A separate verifier checks full table counts, every manifest count map, named fixtures and independently selected API samples. Its sampling is explicitly builder diagnostic, not the hidden grader's sample. Scale execution is deferred to the complete M8 schema on a fresh instance and has its own clock. Package password-auth throttling will be honored and included in that clock. No envelope claim is made before that execution.

## M8 — Insights, digest and multiple devices
Built server-maintained lifetime and UTC-day aggregates, ranked recent-post candidates, a persisted digest clock and resumable period sweep, and the Insights/Trending kit surfaces. The suite validates totals against actual accepted content, zero-filled days, ranking, ties and exclusion of old highly liked content. Multi-device choreography passes message convergence, cross-device read clearing and dual-offline ordering/receipts. The separate fresh digest owner proves emission with every app client closed, exact starter payloads, a restart before the deadline, quiet-period suppression and retry deduplication. Native restart proof remains unavailable on Linux; the Hermes build is present.

The aggregate language was concise once the source fields were in place. Filling new source metadata from existing server timestamps was an ordinary resumable job, not a client scan or a historical-time shortcut in replay. My old-post test originally used an uncertified partial profile loop; explicit bounded voter IDs expressed the intended test correctly. The more instructive failure was a one-shot Insights query during restored offline state. Retrying on connection alone did not cure it. An observed SDK query supplied the readiness lifecycle and rendered the correct maintained values. The cross-device read failure likewise exposed a missing mutation-readiness dependency after hard navigation; the standalone reproduction passed and the corrected frozen segment passed afterward.

Scheduling changed the shape of the backend more than the UI. Persisted clock rows, unique period receipts and transactional effect emission make restart behavior explicit. The fold spans job chunks rather than a single snapshot: concurrent changes during a long digest sweep remain a consistency risk, especially expiry, read cursors and membership changes between contribution and emission. The closed-client proof does not erase that limitation. Trending also relies on server timers retiring candidates at their stored deadline. Compared with Convex, TypeScript jobs would be more familiar, but the bounds and resumable progress are clearer here. Compared with Supabase, I wrote less queue/trigger plumbing but had less freedom for a single aggregate SQL query. The current celebrity feed design merges immutable heads on read and adds no per-follower write amplification; scale execution is still in progress, so its practical cost is not yet known.

Post-green hardening and regression: I bounded history/search rendering, moved web saved text to IndexedDB, added native quote scrolling, and made media viewing a full-screen conversation-owned modal. This made two optimistic-state omissions visible: pending replies lacked quoted context and predicted edits lacked their label. Both now derive from the same queued intent/history the user sees. A group settings timeout did not reproduce in the complete remove/re-add probe or the next frozen M3 segment; it remains an intermittent ambiguous failure, not an established platform defect. These follow-up costs are recorded after first-green times rather than silently folded into a faster initial build. Native interactions remain unproved on Linux.

Scale checkpoint follow-up: the 10% invariant snapshot passed 3,204 checks and the measured within-checkpoint read ratios stayed below 3×. The first write after that pause returned retryable `E_TRANSPORT` while the owner remained alive. I had not implemented bounded transport retries in the fixture adapter. I added same-ID logical retries, retained the verified checkpoint on restart, and continued the exact receipt-bound log. This is adapter hardening; the underlying connection event is not an established platform defect. A receipt audit also caught my stale M3 log citation and exposed a composer draft-clearing race, which was fixed and re-proved. The final report must include those costs rather than presenting the initial greens as the whole build.

## Final scale boundary — 1789205009

The separate replay settled all 167,157 actions and passed final entity, authority, named-content and normalized media checks. Building the verifier felt straightforward once every receipt and index had an explicit role. The browser at full scale fought me: its durable sync did not finish inside 30 seconds, despite fast headless queries. Celebrity writes passed the relative-cost check, and the separate group visibility probe measured a 3.712-second p95. Trending missed the literal intermediate interpolation ceiling by about 0.033 ms; I retained the failure. General database and browser-testing familiarity helped separate an intact corpus from an unsuccessful performance objective. The package supplied no calibrated instrument ceilings or Linux Apple simulator. Compared with the alternatives I know, the single typed authority surface helped functional work, while diagnosing hydration and owning the replay/proof machinery imposed substantial extra work. The canonical store was stopped, copied with matching streaming SHA256, and remained unchanged after destructive probes on the copy. These results qualify the earlier functional greens; they do not establish an O5 performance pass.

````


## Input: essay.md

SHA-256: `3a3aba91b6f5fa1328364228663ab86094a6783583e219ba716446cd3f281db8`

````text
# Building Clique on Snapback 2

I came into this build with much more general React, database and API familiarity than Quarry familiarity. That distinction mattered. The visible app was not especially exotic: profiles, feeds, conversations, media, search and a few reporting screens. The difficult work was deciding which state was authoritative, which state was merely saved on a device, and which state was still an uncommitted user intention. Snapback supplies unusually substantial machinery for those distinctions. It also makes the application confront them more explicitly than the conventional loading/data/error model that I initially reached for.

The strongest part of the experience was how much backend behavior could follow from a small declaration. A message table with delivery and retention declarations acquired recipient logs and receipt machinery. An image cell could own authorization and a view-once policy. A row deadline could drive server-side removal with all clients closed. Count and sum read models were maintained with the underlying writes. These are not merely conveniences in writing code. They eliminate several opportunities for a developer to update a message but forget its notification log, or delete a row but leave its asset URL usable. For an app with disappearing and view-once content, that integration is valuable.

I would normally expect to assemble those pieces more manually with Supabase. Postgres gives me considerably more query freedom, and SQL is a language I already know how to inspect and optimize. But database rows, object storage, realtime subscriptions, mobile caches and a durable client write queue do not become one coherent lifecycle just because they share a project. I would have to decide how signed URLs expire, how an offline recipient learns about a deletion, how receipts are acknowledged, and how a retried mobile write avoids duplicating content. Snapback had answers to those questions in the package guide. Some of those answers took time to understand, but I was not starting from an empty page.

Convex would feel more familiar at the function-authoring layer. Writing TypeScript queries and mutations keeps application logic and ordinary test logic in a language I use routinely. Quarry introduces a second language, its own grammar and its own restrictions on expressions and iteration. Small mistakes such as shaping scalar ranges like rows, forgetting a focal dot, or assuming a comparison was legal in a rule caused compiler refusals. The repair messages were often useful and concrete. Nevertheless, a good diagnostic is still a correction loop, and the language boundary consumed real attention that a TypeScript backend would not have demanded in the same way.

The restrictions also had an upside. The compiler made costly shapes visible early. A chat list embedding large rosters is an attractive piece of UI code until its output grows with both conversation count and membership count. The output certificate forced me to make that list compact and move details to the conversation surface. Similarly, a mutation loop over an arbitrary first page is not automatically a complete fan-out. The refusal made me distinguish a genuinely bounded argument list from a population I had merely truncated. SQL would let me write a costly query and discover its cost later; Quarry often requires an explanation of the bound before it admits the operation. That changes the order of engineering decisions.

Search showed both sides of this trade. Indexed Unicode word-prefix matching was supplied, and the same vocabulary applied to held data. But complete global search across many chats wanted a particular endpoint topology: a paged membership directory, one search head per chat, and a client merge that refills those heads. I initially connected that helper to a normal twenty-row search endpoint. The helper correctly returned a partial receipt explaining that it expected one row. My first UI test did not catch the problem because locally saved matches happened to make the screen look right. A direct pagination probe exposed it, and the dedicated head endpoint produced the same result count as complete scoped paging. The lesson was not that the tool was unreliable. It was that a visually plausible fallback can mask a broken authoritative path unless the test distinguishes them.

Offline support was the other major learning curve. The durable SDK does more than cache a query response. It has account-bound custody, admitted intentions, an outbox, writer/follower coordination and recovery states. That is much more useful for a messaging app than an optimistic UI that quietly drops work after restart. It also means an online-looking tab can legitimately return a queued result while another tab owns the writer. I first waited only for committed results when resolving a DM. Reading the authoritative pair query instead handled that state correctly. A hard navigation can also outrun admission; the guide explicitly says not to assume a write is durable before admission returns. My small journal for navigation-sensitive admin actions exists because that is an application boundary the SDK cannot infer from a click.

Several apparent backend defects were application or environment errors. A shared Metro transform cache led to a puzzling runtime method failure that disappeared with a lane-isolated cache. An authenticated avatar/image URL was not a directly renderable public URL; the UI kit needed authorized bytes exposed through the right platform adapter. A temporarily unavailable profile query was not proof that the signed-in account lacked a profile. Treating it that way hid saved conversations behind onboarding. Later, an imperative Insights query ran during restoration and returned a never-held partial result. Using the SDK's observed query lifecycle solved the initial load. These failures are worth retaining in the record because a final green screenshot would hide how easily familiar React assumptions can misread a richer client state machine.

My extra saved-text cache deserves scrutiny too. It made warm search and retained conversation presentation straightforward across route reloads, but it created another consistency surface. The first expiry choreography found a server-deleted message still displayed from that cache. The final implementation honors stored server deadlines during loading, rendering and periodic purging, as well as consuming removal events. That fixed the tested path. It does not make the architectural cost disappear: whenever an application adds a second cache alongside a custody-aware SDK, the application must be precise about what it stores and how it revokes it. In a less timed project I would spend more time reducing that duplication through the package's item/history bindings.

The scheduled digest was a different kind of work. A persisted row clock, transactional effect emission and a unique user-period receipt gave me a clear restart story. A fresh owner emitted the expected payloads with app clients closed, survived a restart before its deadline, and did not duplicate a replayed period. The remaining weakness is the fold across job chunks. It is not one global snapshot. Concurrent membership, read-state or expiry changes during a long sweep can change the eligibility of a contribution before final emission. The closed-client proof is meaningful, but it does not prove every concurrent schedule race. Supabase could make a single aggregate SQL snapshot attractive here; Convex or another function backend might instead lead me toward more incremental counters. Snapback's resumable jobs make progress explicit, while leaving the application responsible for this consistency design.

I also want to separate what this run demonstrates from what it does not. The app exports iOS Hermes bundles, but this Linux machine cannot produce Apple simulator execution evidence. Web choreography is not a substitute for that proof. The notification provider is a logged local seam, not a claim of APNs or FCM delivery. The scale adapter uses real registrations and application mutations, settles each action and preserves receipts. Its own clock includes auth throttling and records checkpoint verification separately. At the time of writing this essay the replay is still running, so I am not turning an authoring impression into a performance claim. The later report will carry the actual result, including failures.

My overall assessment is that Snapback reduced the amount of independent infrastructure I had to invent, especially around media authorization, recipient delivery and durable offline intentions. It added friction at the language boundary and where its client authority model differed from my habits. It changed the shape of the work by bringing bounds, custody and resumable jobs into ordinary product engineering decisions. I would choose between it, Convex and Supabase based on which of those costs a project most needs to pay explicitly. This run makes the benefits tangible, but it also leaves concrete work to harden rather than a blanket claim that an integrated backend makes consistency automatic.

The final regression also changed my assessment of the client boundary. A known post's durable composite observer could remain `unavailable`, with `partial` and `never-held`, while a normal authenticated SDK client returned the complete thread. The profile composite showed a similar symptom. I separated the profile's point read and added a narrowly scoped online, read-only observer using the already authenticated bearer for unavailable composites. It closes on offline cuts and never touches the write queue. That is workable application code, but it adds a second read path and deserves to be counted as friction. The retained diagnostic does not establish whether the cause is coverage planning, client integration, or a platform defect; it does establish that the original screen could wait forever. A mature application should surface that distinction and offer recovery rather than equating missing local coverage with a missing entity.

````


## Input: run-log.md

SHA-256: `52966bbe83271a992409dce53ff25f0b57b70fba08e04f4f310470c7512da1d4`

````text
lane id astra-clique-snapback2
model gpt-6-astra
effort=medium
backend=snapback2-0.0.29
start=1789191381

1789191381 knowledge lookup source=fixture attribution=environment evidence=instrument/ENVIRONMENT.md; beginning cold build, Linux override ports 53300–53319.
1789191480 M1 start=1789191381; orientation included. knowledge lookup source=package README/guide attribution=environment evidence=evidence/init.log,node_modules/snapback2/dist/guide/auth.md; init/check successful. First product edit follows; no skills used. Token metering unavailable in tool surface; no estimates.
1789191579 knowledge lookup source=package README/guide attribution=environment evidence=node_modules/snapback2/dist/guide/assets.md; server PID=3575004 port=53300 evidence=evidence/owner-start.json. First-pass type diagnostic stale scaffold avatarUrl journey replaced with app suite evidence=evidence/m1-check.log.
1789191603 error/retry attribution=agent-error evidence=evidence/m1-check.log; cleanup loop hit fixture directory before deleting chat.test.ts; corrected specific file. server PID=3579262 port=53301 evidence=evidence/web.pid.
1789191752 correction-loop 1 attribution=environment evidence=evidence/m1-suite.json,evidence/expo-config.txt,scripts/browser-check.mjs; browser resolved 53200 despite lane Expo config 53300 and unset public env vars; explicit lane URL fixes client routing. Only accidental refused requests reached 53200; no other lane inspected. server child PIDs=3579310,3579311. iOS Hermes export evidence=artifacts/m1-ios.
1789191795 retry attribution=agent-error evidence=evidence/m1-choreo-output.log; fixture credentials key is starter, then overbroad sed damaged ternary; corrected exact line. Suite m1 passes evidence=evidence/m1-suite.json.
1789191812 knowledge lookup source=diagnostic attribution=environment evidence=evidence/m1-platform-test.log,evidence/m1-cli-query.json; exercised test/run/why/trace/data/persona commands. Setup identity requires relative paths (schema itself only string); corrected per diagnostic.
1789191841 correction-loop 2 attribution=agent-error evidence=evidence/m1-choreo-output.log; logout succeeded but subsequent login stayed on settings; harness expects authenticated landing feed, corrected login navigation.
1789191875 M1 green suite=evidence/m1-suite.json choreography=evidence/m1-choreo.jsonl Hermes=artifacts/m1-ios; firstGreenAt is frozen segment summary recordedAt. Error attribution=agent-error evidence=evidence/m1-platform-test.log: test command default launched ephemeral owner PID=3591354 port=38789 outside range; process already exited. Future platform tests use --port 53302. Platform derived tests blocked due empty built-in seed; app fixture seed uses real auth/write path.
1789191921 M2 start; knowledge lookup source=package README/guide attribution=environment evidence=node_modules/snapback2/dist/guide/fanout.md,node_modules/snapback2/dist/guide/maintain.md,node_modules/snapback2/dist/guide/merge.md; feed heads and bounded merge chosen.
1789192064 M2 authoring diagnostic attribution=agent-error source=model knowledge evidence=evidence/m2-typecheck.log,scripts/browser-check.mjs; RN Web lacks Image.resolveAssetSource; use Expo Asset.fromModule for fixture poster. Explicit image-list overload and native video props corrected. M2 seed installed 52 actions evidence=evidence/m2-seed-output.log.
1789192189 M2 suite passes initial coverage evidence=evidence/m2-suite.json; pagination test corrected seed-follow assumptions attribution=agent-error. Added persisted mutation-id dedup after review of set-state retry obligation; revalidation follows.
1789192267 correction-loop 3 attribution=agent-error evidence=evidence/m2-choreo-output.log; frozen harness switches feed tabs directly after profile follow; shell lacked tabs outside feed. Added global feed tab navigation to secondary authenticated routes; kit profile back-to-feed retained.
1789192314 knowledge lookup source=diagnostic attribution=environment evidence=evidence/m2-owner-status.json,evidence/m2-migration.log; own-author repost required extending feed unique key with repost bool; reviewed index-only drop plan and applied explicit migration, no rows dropped.
1789192350 correction-loop 3 iteration 2 attribution=agent-error evidence=evidence/m2-choreo-attempt1-output.log; Expo Stack retained hidden composer DOM and caused duplicate test IDs on reply navigation. Switched layout to Router Slot, one active screen. First choreography attempt non-green; rerun after fix.
1789192433 M2 green suite=evidence/m2-suite.json choreography=evidence/m2-choreo.jsonl Hermes=artifacts/m2-ios. M3 start; knowledge lookup source=package README/guide attribution=environment evidence=node_modules/snapback2/dist/guide/deliver.md,node_modules/snapback2/dist/guide/offline.md,shared/thread.ts.
1789192787 M3 first-pass diagnostics attribution=agent-error evidence=evidence/m3-check.log,evidence/m3-typecheck.log; overwide roster-in-chat-list projection exceeded 1MiB compile bound, replaced with two compact DM counterpart cards and bounded preview. time/int fallback corrected by explicit timestamp branches. Durable store enabled for SDK delivery acknowledgements.
1789192886 correction-loop 4 attribution=snapback2-defect subAttribution=defect evidence=evidence/m3-failure.png,evidence/m3-carrier-repro.log; documented indexedDbRangeStore() refuses at client construction with this.validatePath is not a function; investigating installed public export, no package source inspected.
1789192918 correction-loop 4 diagnostic refinement attribution=ambiguous evidence=evidence/m3-carrier-client-repro.log; public Node client with documented store reaches ready, so failure appears Metro/browser-specific rather than all package arms. Retrying with lane-isolated Metro cache. Killed only own PIDs 3579311,3579310,3579262.
1789192950 server PID=3644913 exited before bind (shell job lifetime); restart uses nohup. New PID recorded in evidence/web-restart2.pid port=53301.
1789192994 server PID=3647854 port=53301 evidence=foreground exec session 26053; background restart PID=3647059 exited with tool job lifecycle. Metro cache now .metro-cache inside lane.
1789193004 correction-loop 4 resolved attribution=environment (supersedes provisional snapback2-defect/ambiguous) evidence=evidence/m3-browser-carrier.log; lane-local Metro cache and fresh foreground server removed validatePath failure. Documented IndexedDB store works without package edits. Same shared-transform issue may explain M1 URL, inference only.
1789193151 correction-loop 5 attribution=ambiguous evidence=evidence/m3-auth-concurrency.log,evidence/m3-choreo-attempt1-output.log; harness concurrently signs in four users; documented owner permits two concurrent password operations, returning E_AUTH_RATE_LIMIT with wait60 for overload. Added generic randomized initial login backoff (0–1.8s) to spread concurrent startup. No rate-limit bypass or credential special cases; no failed auth automatically retried.
1789193257 correction-loop 6 attribution=agent-error evidence=evidence/m3-choreo-attempt2-output.log; same-account follower tab returns queued for DM create (documented). Resolver waited only for immediate committed value. Added live dmWith query and resolves through authoritative pair state, including queued settlements.
1789193407 M3 retry attribution=agent-error evidence=evidence/m3-precondition.log,evidence/m3-choreo-attempt3-output.log; prior failed lifecycle left Dave in starter group, invalidating next slowest-recipient/add-member preconditions. Restore 3-person roster via own admin mutation. Adapter now maps frozen starter group to canonical id routes /chat/g-starter; does not report outcomes or alter checks.
1789193615 correction-loop 7 attribution=ambiguous evidence=evidence/m3-cutoff-recent.json,evidence/m3-memberships.json,evidence/m3-choreo-attempt4-output.log; no memberRemove commit exists: hard navigation raced SDK durable admission, so Dave legitimately remained member. Added synchronous account-scoped web admission journal for group administration, replayed through same authenticated idempotent Quarry mutations on next page. This closes pre-admission unload gap explicitly described by package offline guide; no server authorization bypass.
1789193657 evidence improvement attribution=agent-error evidence=scripts/acceptance.mjs,scripts/choreo.mjs; future suite and choreography receipts get immutable timestamped paths plus latest aliases, preserving linked hashes across retries. Earlier failed attempts retained copied JSONL but their original linked suite sidecars were overwritten; this historical linkage limitation will be reported.
1789193734 correction-loop 7 iteration 2 attribution=agent-error evidence=evidence/m3-choreo-output.log; removal now commits and cutoff passes, but local component-only history was lost on an authority-driven remount. Retained pre-removal rows moved to account-scoped page memory, with generated removal events purging actual deleted rows. New-message reads remain server-gated.
1789193794 knowledge lookup source=package generated types attribution=environment evidence=node_modules/snapback2/dist/react-native/source.d.ts; native kit image URIs now use documented useAssetFile, web uses useAssetUrl. Fixed-size four-image hook wrapper preserves React hook order; view-once will remain component-only.
1789194001 correction-loop 7 iteration 3 attribution=agent-error evidence=evidence/cutoff-probe.log,evidence/cutoff-probe-two-tabs.log; isolated removal/two-tab probe preserves history, but full workflow still contracts partial page snapshots. Cache now unions observed message IDs rather than replacing complete history with any nonempty partial page, preserves known author cards, and rejects generated removed IDs permanently.
1789194186 correction-loop 7 root cause established attribution=agent-error evidence=evidence/cutoff-ui-probe.log,evidence/cutoff-ui-probe.png; Dave remained authenticated but Shell rendered Create your profile when profiles.mine was temporarily unavailable/partial during follower coordination. This hid the entire conversation, not a server history loss. Shell now distinguishes unavailable from authoritative absence and preserves its known public profile per account. Earlier cache hypotheses were incomplete; no Snapback defect established.
1789194363 M3 green suite=evidence/m3-suite.json choreography=evidence/m3-choreo.jsonl Hermes=artifacts/m3-ios. M4 start; knowledge lookup source=package README/guide attribution=environment evidence=node_modules/snapback2/dist/guide/expiry.md,node_modules/snapback2/dist/guide/recipes/quarry-window-config.js,instrument/fixtures/config/windows.production.json.
1789194530 M4 authored config-derived owner-time edit/delete checks, actual media sends, caption editing, asset-clearing tombstones, and idempotent per-user emoji reactions. First-pass upsert diagnostic corrected (by index syntax unsupported for upsert). evidence=evidence/m4-check.log source=diagnostic attribution=agent-error.
1789194669 correction-loop 8 attribution=agent-error evidence=evidence/m4-failure.png,evidence/m4-suite-output.log,node_modules/snapback2/dist/types.d.ts; kit URI used logical SDK asset URL directly. Added documented authenticated assetBlob resolution to object URLs for web kit images, native remains useAssetFile. Suite now uses frozen rendered-source byte helper, covering RN Web CSS images.
1789194977 M4 green evidence=evidence/m4-choreo.jsonl,evidence/m4-suite.json,artifacts/m4-ios
1789194977 M5 start source=fixture evidence=instrument/social-messenger.md
1789195080 M5 knowledge lookup source=package README/guide evidence=node_modules/snapback2/dist/guide/{assets,expiry,recipes/global-message-search.ts}; correction agent-error python executable absent using python3
1789195090 M5 correction source=diagnostic attribution=snapback2-defect E_QUARRY_UNKNOWN rule vocabulary eq/ne but not >; use documented schedule removal within required tolerance evidence=evidence/m5-check.log; agent-error shape field missing dot corrected
1789195273 M5 suite passes evidence=evidence/m5-suite.json; test config=shortened fixture windows for expiry choreography
1789195378 M5 knowledge lookup source=package README/guide evidence=node_modules/snapback2/dist/guide/{offline,auth,operator,fanout,maintain,schedule}.md
1789195405 M5 correction attribution=agent-error global-search probe unbounded retry on issues; stopped exact probe PID 3775350 and bounded diagnostic pages evidence=scripts/m5-search-probe.mjs
1789195451 M5 correction attribution=agent-error source=diagnostic global pager refuses multi-row heads: search page returned more than one row; probe observed 0 global vs 100 scoped matches evidence=evidence/m5-search-pagination-probe.log; fix queued after active choreography
1789195653 M5 choreography failure attribution=agent-error expiry retained in client local history despite timer firing; source=diagnostic evidence=evidence/m5-choreo-output.log,evidence/m5-expiry-owner-status.json
1789195718 M5 correction attribution=agent-error custom history cache must honor stored server expiry as well as removed events; purge on load/render/timer; global search uses one-row head endpoint; adapter wait 185000ms for frozen shortened 180s ttl evidence=src/history.ts,src/global-search.ts,choreography-adapter.json
1789195854 M5 final Hermes bundle re-export after optional-data type narrowing evidence=artifacts/m5-ios,evidence/m5-types.log
1789196028 M5 green evidence=evidence/m5-suite.json,evidence/m5-choreo.jsonl,artifacts/m5-ios,evidence/m5-search-pagination-fixed.log,evidence/window-authority-probe.json
1789196028 M6 start source=fixture evidence=instrument/social-messenger.md
1789196352 M6 suite passes; sample 50 actions 13 verbs 142 independent state checks; effects 25 sent zero failed source=diagnostic evidence=evidence/m6-suite.json,evidence/sample-verification.json,evidence/m6-owner-status.json
1789196497 M6 green evidence=evidence/m6-suite.json,evidence/m6-choreo.jsonl,artifacts/m6-ios; native unavailable Linux evidence=simulator-status.json; scale verifier authored and replay deferred until full M8 schema on fresh instance
1789196497 M8 start source=fixture evidence=instrument/social-messenger.md
1789196717 M8 correction attribution=agent-error source=diagnostic optional comparisons require ?? fallback and scalar range cannot be row-shaped; fixed seven explicit day helper outputs evidence=evidence/m8-check-1.log,snapback/insights.q
1789196989 M8 correction attribution=agent-error source=diagnostic one-shot load ran during restoring offline state and never refreshed on connected; rerun load on connection transitions evidence=evidence/m8-insights-probe.log,src/insights.tsx,src/feed.tsx
1789197043 server start digest proof PID=3863958 port=53304 source=diagnostic evidence=evidence/digest-owner-start.json
1789197116 digest proof mid-period stop exact PID=3863958 nextAt=1789197120000 evidence=evidence/digest-clock-before.json
1789197177 M8 correction attribution=agent-error hypothesis connection-triggered imperative refresh insufficient; observed same never-held partial. Use SDK observed query readiness for initial load, retain explicit refresh evidence=evidence/m8-insights-probe-2.log
1789197201 server restart digest proof PID=3870081 port=53304 evidence=evidence/digest-owner-restart.json
1789197301 M8 correction attribution=agent-error digest verifier parsed multi-line job receipts as one JSON; parse final receipt; prior job had completed safely evidence=evidence/digest-proof.log
1789197338 M8 correction attribution=agent-error source=diagnostic test fixture mutation used uncertified partial profile loop; replace with explicit bounded voter IDs evidence=evidence/m8-old-trend-diagnostic.json,scripts/old-trend.q
1789197497 M8 suite passes; digest proof passes exact payloads closed clients mid-period restart quiet suppression and retry dedup evidence=evidence/m8-suite.json,evidence/digest-proof.json
1789197579 server start scale PID=3892702 port=53303 source=diagnostic evidence=evidence/scale-owner-start.json
1789197579 M8 choreography failure cross-device read state attribution=ambiguous source=diagnostic evidence=evidence/m8-choreo-output.log; reproducing independently
1789197784 M8 correction attribution=agent-error read effect must retry on mutation readiness transitions; exact independent semantic-row probe passed source=package README/guide evidence=evidence/m8-read-sync-probe.log,node_modules/snapback2/dist/guide/live-query.md,src/messaging.tsx
1789197786 scale replay start own clock fresh instance PID=3892702 port=53303 starter verified replayMode=true evidence=evidence/scale-starter-verification.json,.replays/scale/snapback/runtime.q
1789197788 scale replay execution returned see own raw start/end evidence=evidence/scale-clock.json
1789197788 scale verification final evidence=evidence/scale-verification-final.json
1789197788 scale replay final verification returned evidence=evidence/scale-verification-final.json
1789197899 scale correction attribution=agent-error E_AUTH_RATE_LIMIT is error.code, absent from String(error); 16 committed registrations retained and resume same log receipts; premature verification nonconforming correctly recorded evidence=evidence/scale-clock-1789197787.json,evidence/scale-verification-premature-1789197788.json
1789197899 diagnostic output incident attribution=environment Node uncaught SDK error included a minified packaged source line; not consulted as implementation knowledge; future replay errors sanitized to message/code evidence=evidence/scale-attempt-1789197787-output.log
1789197899 M8 green evidence=evidence/m8-suite.json,evidence/m8-choreo.jsonl,artifacts/m8-ios,evidence/digest-proof.json; native unavailable Linux evidence=simulator-status.json
1789197900 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789197961 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198021 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198052 essay written after M8 and before final numerical tally; scale still running evidence=essay.md,diary.md
1789198082 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198142 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198203 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198263 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198324 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198385 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198445 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198493 post-green hardening attribution=agent-error bounded rendered history/search, moved web saved-text cache to IndexedDB, native quote scroll and older-page loading wired; formatting and startup docs added; affected suites/choreography rerun next evidence=src/history.ts,src/local-store.web.ts,src/messaging.tsx,README.md
1789198506 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198525 final M5 regression selects shortened window config before expiry check source=fixture evidence=instrument/fixtures/config/windows.shortened.json
1789198566 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198627 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198687 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198748 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198808 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198869 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198921 post-green regression correction attribution=agent-error once viewing lifetime moved from row to conversation Modal and account/message opened marker survives row remount; exact standalone probe had refused reopening but frozen multi-context check failed evidence=evidence/final-m5-choreo-output.log,evidence/once-ui-probe.log,src/messaging.tsx
1789198930 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789198990 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199051 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199051 digest proof owner stopped exact PID=3870081 after completed proof evidence=evidence/digest-proof.json
1789199111 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199172 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199195 final M5 regression green after IDB pagination and conversation-owned Modal; production windows restored evidence=evidence/final-m5-choreo-output.log
1789199232 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199293 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199353 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199414 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199475 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199535 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199596 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199640 correction agent-error: optimistic quotes now resolve their original from account-local history; investigating post-green group-settings timeout with full remove/readd probe; evidence=src/messaging.tsx,scripts/cutoff-ui-probe.mjs
1789199656 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199717 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199747 knowledge lookup source=fixture scale performance contract; expanded checkpoint verifier to k20 after3 warmups, full published global-search pager, page1/page50, fan-in/celebrity feeds, insights/trending. Builder diagnostics remain distinct from hidden grading. evidence=instrument/social-messenger.md,scripts/scale-probes.mjs
1789199769 final M3 optimistic-quote correction regression attempt completed; evidence=evidence/final-m3-suite-output.log,evidence/final-m3-choreo-output.log
1789199777 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199787 final M3 regression green; group remove/readd timeout did not recur in full diagnostic or frozen rerun, retained as ambiguous intermittent miss. evidence=evidence/final-m3-choreo-output.log,evidence/final-cutoff-ui-probe.log
1789199797 final M4 regression attempt complete evidence=evidence/final-m4-suite-output.log,evidence/final-m4-choreo-output.log
1789199817 scale probe preflight agent-error Node interprets client TS under root commonjs; transpile authored production pager to lane-local audit ESM with installed TypeScript before diagnostic import. Module preflight passes evidence=scripts/scale-probes.mjs,.audit/global-search.mjs
1789199838 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199848 post-green correction agent-error: edited text prediction preceded server editedAt; derive edited label from queued edit intent too. evidence=evidence/final-m4-suite-output.log,src/messaging.tsx
1789199899 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199912 post-green journal: bounded rendering and native/modal UX corrections recorded; private session/state paths excluded from accidental source publication evidence=diary.md,.gitignore
1789199926 final M6 regression attempt complete evidence=evidence/final-m6-suite-output.log,evidence/final-m6-choreo-output.log
1789199959 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789199975 M6 final suite push miss after prior browser segment; inspecting documented connected virtual SSE presence. CLI data connected returns E_SCHEMA_TABLE_UNKNOWN, virtual relation is program-only. Retry after closed transports settle; evidence=evidence/final-m6-suite-output.log,node_modules/snapback2/dist/guide/live-query.md source=package README/guide attribution=ambiguous
1789200005 final M6 regression green without product change after closed transports settled; prior push miss retained ambiguous evidence=evidence/final-m6-choreo-output.log
1789200020 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200044 final M8 regression attempt complete evidence=evidence/final-m8-suite-output.log,evidence/final-m8-choreo-output.log
1789200080 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200117 M8 post-green correction agent-error: chat list contracted/reordered during partial computed snapshots; preserve displayed account-scoped conversation identity/order and monotonic read cursor. source=package README/guide evidence=node_modules/snapback2/dist/guide/live-query.md,evidence/final-m8-choreo-output.log,src/messaging.tsx
1789200141 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200176 final M8 regression green; acceptance sources moved to TypeScript per brief. Legacy M1/M2 suite aliases frozen to preserve first-green hashes. evidence=evidence/final-m8-choreo-output.log,scripts/acceptance.ts
1789200201 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200216 knowledge lookup source=package README/guide testing.md; authored isolated TypeScript wire journey for outsider read, non-author edit, and stale membership incarnation. Draft held outside backend until active choreography ends. evidence=.audit/clique.test.ts
1789200262 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200287 wire journey first-pass type diagnostic agent-error E_OP_INVALID Cannot find module node:crypto or corresponding type declarations; use supported global crypto.randomUUID. No isolated owner had started. evidence=evidence/final-platform-journey.json
1789200319 M1 final regression correction agent-error: newly created profile is canonical (API probe complete) while composite social read unavailable in browser; separate point profile read with own-profile/known-profile fallback and readiness-aware absence. evidence=evidence/final-m1-suite-output.log,src/profile.tsx
1789200323 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200332 isolated platform journey green owner PID=4047064 port=53302 supervisor stopped/reaped exact owner; outsider reads, non-author edits, stale membership incarnation proved. Scope selected journey, not full derived suite. evidence=evidence/final-platform-journey.json
1789200352 final M1 regression green after point-profile fallback evidence=evidence/final-m1-choreo-output.log
1789200383 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200444 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200504 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200565 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200625 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200681 correction-loop ambiguous: durable observed composite posts.thread returns unavailable partial Some data is not downloaded detail never-held for canonical readable post; plain same-bearer observer succeeds. Added read-only online fallback with authenticated snapshot.token from public generated types; closes on offline/account change, never writes. evidence=evidence/final-thread-probe.log,evidence/final-thread-probe-fixed.log,src/read-fallback.ts source=package README/guide
1789200686 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200746 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200807 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200868 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200928 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789200989 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201049 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201110 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201170 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201212 final M5 full regression attempt complete and production windows restored evidence=evidence/final-m5-suite-output.log,evidence/final-m5-choreo-output.log
1789201231 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201292 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201327 final M5 regression green and production config restored; added actual SDK local.caughtUp sync status for user feedback and scale cold-start observation. Backend URL uses explicit EXPO_PUBLIC_CLIQUE_BACKEND_URL with assigned default; export caches isolated. evidence=evidence/final-m5-choreo-output.log,src/messaging.tsx,src/backend.ts
1789201352 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201360 server start static scale web PID=4144709 port=53305 evidence=exec-session-60104,artifacts/scale-web; final iOS Hermes export produced artifacts/m8-ios-final evidence=evidence/final-ios-export.log
1789201412 final M8 green and product source frozen; final check and published why/trace/persona diagnostics retained source=package README/guide evidence=evidence/final-check.json,evidence/final-trace.json,evidence/why-help.txt,evidence/persona-help.txt
1789201413 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201472 fixture/source integrity audit copied UI/choreography/metering source identical excluding install lockfile; Hermes artifacts hashed without inspecting bundle source. Published why follows bounded feed query. evidence=evidence/instrument-integrity.json,evidence/hermes-artifacts.json,evidence/final-following-why.json
1789201473 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201517 scale verification separates exact invariant pass from timing probe failures; a slow/erroring timing probe is recorded and does not underfill the replay by stopping subsequent actions. evidence=scripts/verify-replay.mjs
1789201534 replay auth backoff 60s source=diagnostic attribution=environment evidence=evidence/scale-output.log
1789201562 scale verifier binds all frozen log SHA256 values and exact unique settled action count at checkpoint/final before independent state inspection. evidence=scripts/verify-replay.mjs
1789201671 correction agent-error: final M3 claim mistakenly read stale prior-green choreography log after gated suite failure. Audit caught latest suite failure; first send completion cleared newly typed reply draft and quote. Preserve drafts changed while admission is in flight, applied to post/message composers. Product freeze reopened for this fix. evidence=evidence/final-m3-suite-output.log,evidence/m3-failure.png,src/messaging.tsx,src/feed.tsx
1789201807 M3 corrected final regression genuinely green: new suite and new choreography completed, not stale alias. Re-exported final Hermes/web after draft-preservation fix. evidence=evidence/final-m3-suite-output.log,evidence/final-m3-choreo-output.log,evidence/final-ios-export.log
1789201943 final M8 suite and new choreography green after draft fix; scale static web carrier checked against assigned 53303 using observed request origins, no bundle-source inspection. evidence=evidence/final-m8-choreo-output.log,evidence/scale-web-carrier.json
1789201968 scale verification 10% evidence=evidence/scale-verification-10%.json
1789201968 scale execution attempt returned evidence=evidence/scale-clock.json
1789202005 product source and final/historical Hermes artifacts hash-bound after last source fix; M8 new final receipt green. Scale 10-percent checkpoint reached and independent verification/probes running. evidence=evidence/product-source-manifest.json,evidence/hermes-artifacts.json,evidence/scale-output.log
1789202092 scale checkpoint10 verified 3204 checks and read ratios within3; first resumed mutation E_TRANSPORT while owner PID3892702 healthy. Preserve failed attempt log, bounded same-id logical retries, retain completed checkpoint on resume. attribution=ambiguous evidence=evidence/scale-attempt-1789197900-output.log,evidence/scale-verification-10%.json,scripts/replay.ts
1789202654 scale continuing beyond 67000 acknowledged actions after transport-resume correction; checkpoint10 read ratios deepHistory1.02 followingFanIn1.03. No cross-backend speed claim. evidence=evidence/scale-verification-10%.json,evidence/scale-output.log
1789202807 scale beyond83000 settled actions; approaching half checkpoint. Recorded own server process tree for exact-PID shutdown, no pattern kills. evidence=run-log.md
1789202921 scale verification 50% evidence=evidence/scale-verification-50%.json
1789202921 replay retry same idempotent action E_TRANSPORT attempt=1 attribution=ambiguous evidence=evidence/scale-output.log
1789202953 scale50 checkpoint verified3204 checks exact25128 posts50015 messages; within-checkpoint read ratios below3; resumed successfully. evidence=evidence/scale-verification-50%.json
1789203255 diagnostic preservation correction: early m5-check.log was overwritten by later success. Reproduced timed row-read comparison on isolated .audit/rule-gap without starting an owner or changing app source; exact diagnostic now immutable evidence=evidence/timed-rule-gap.json source=diagnostic attribution=agent-error
1789203488 scale browser probe preflight correction agent-error: React Native Web Text does not emit aria-valuetext here; observe actual SDK-backed visible sync label. Product unchanged. evidence=evidence/sync-status-probe.json,scripts/scale-browser-probes.mjs
1789203496 preserved preflight sync attribute miss evidence=evidence/sync-status-attribute-attempt.json
1789203570 sync text preflight passes after2s; archival copy raced alias replacement, renamed to truthful text-attempt receipt. Original attribute miss observed10 null values; not claimed as preserved raw file. Scale verifier/probe receipts now retain unique attempt copies. evidence=evidence/sync-status-text-attempt.json,scripts/verify-replay.mjs
1789203934 scale resumed execution returned evidence=evidence/scale-clock.json,evidence/scale-output.log
1789203997 scale replay end=1789203933 start=1789197787 all167157 actions settled; probeMs147959 excluded from active replay clock. Final invariant verification running on canonical fresh instance. evidence=evidence/scale-clock.json,evidence/scale-settled.jsonl,evidence/scale-final-verification.log
1789204126 scale verification final evidence=evidence/scale-verification-final.json
1789204233 supplemental named-media probe first-pass agent-error: assetUrl returns Promise, missing await caused absolute-URL refusal; download/carrier flag invalid for images E_ASSET_CARRIER_IMAGE. Fix from public generated types/refusal: await ordinary assetUrl then authenticated assetBlob. Unhandled promise again printed packaged minified source in diagnostic output; not requested or used for implementation. evidence=evidence/scale-named-verification-attempt-1789204172.log,node_modules/snapback2/dist/types.d.ts source=diagnostic
1789204318 named media probe corrected against published asset contract: images decoded/oriented/re-encoded and video metadata stripped, so original file hash was invalid expectation. Compare normalized RGBA pixels and decoded video frames using existing Pillow/ffmpeg. No app/backend changes. source=package README/guide attribution=agent-error evidence=node_modules/snapback2/dist/guide/assets.md,evidence/scale-named-verification-1789204233.json
1789204426 environment diagnostic supplemental image/video decoder preflight: Pillow unavailable (ModuleNotFoundError) and ffmpeg command not found. Use already-installed Chromium canvas/image/video decoding; compare normalized image pixels and5 sampled video frames/dimensions/duration. No new dependencies. evidence=scripts/verify-named.mjs source=diagnostic attribution=environment
1789204487 named-message verifier first-pass diagnostic agent-error E_INPUT data index reactions.byMessage does not end in intrinsic id; CLI requires unique or id-ended ordering. Select existing unique byMessageActor. evidence=evidence/scale-named-verification-1789204427.json source=diagnostic
1789204570 canonical scale owner PID=3892702 stopped after final3242 and supplemental135 invariant checks; original store preserved for grading. evidence=evidence/scale-owner-stop.json,evidence/scale-named-verification.json
1789204623 probe copy preparation agent-error: SQLite store is5196644352 bytes; whole-file readFileSync hashing refused ERR_FS_FILE_TOO_LARGE above2GiB after copy completed. Use streaming hashes; canonical owner already stopped, no data mutation. evidence=evidence/scale-owner-stop.json
1789204633 probe copy owner start PID=741492 port=53303 evidence=evidence/scale-probe-owner-start.json,evidence/scale-copy.json
1789204940 scale browser probe failure: cold durable sync exceeded30s; celebrity-write p95 ratio0.827784 passes3x. Preserve failure; independently measure group-visible latency on probe clone. attribution=ambiguous source=diagnostic evidence=evidence/scale-browser-probes.json
1789205009 scale performance final: all167157 actions settled; final3242 plus named135 checks pass; read interpolation trending failure retained; cold sync30s failure retained; celebrity write ratio0.827784 pass; group visible p95=3711.708239ms measured20 after3 warmups, no calibrated absolute ceiling. Canonical store streaming hash unchanged. attribution=ambiguous source=diagnostic evidence=evidence/scale-read-curve.json,evidence/scale-browser-probes.json,evidence/scale-group-probes.json,evidence/scale-canonical-preserved.json
1789205030 shutdown exact recorded main3575004/probe741492 owners via published dev stop; Expo3647854/static4144709 SIGTERM; recorded Metro worker cleanup only. all assigned ports free=True evidence=evidence/shutdown.json
1789205048 final report audit pass: all7 requested milestone latest suite/choreography receipt hashes match; M7 not-run; scale invariants pass with cold-sync and trending performance failures; native M6/M8 unavailable Linux; all own servers stopped. Base run-record schema validates; no hidden grading or native metering fabricated. evidence=final-report.md,milestone-results.json,evidence/run-record-validation.json,evidence/shutdown.json

````


## Input: final-report.md

SHA-256: `d9da06b0c961f4a60bba9a8216a2408bb1fe74ef43d751605e15bb1ee0f1ad95`

````text
# Clique — astra-clique-snapback2

Model gpt-6-astra, effort medium, exact public backend snapback2@0.0.29. Started 1789191381; report endpoint 1789205048; total wall 13667 seconds. Alone, cold, in this lane. No other lane or source checkout was inspected.

## Milestones

Green below means a passing coverage suite and frozen choreography segment with a valid suite hash. It does not claim hidden grader or native-simulator success. Initial milestone walls end at logged boundaries; receipt time is the exact first combined green. Later corrections and rechecks are charged to the run's additional wall and are not hidden inside faster first-green figures.

| Milestone | Status | Start epoch | Boundary end epoch | Wall s | First-green receipt epoch | Time to first green s | Latest choreography |
|---|---|---:|---:|---:|---:|---:|---|
| M1 | green | 1789191381 | 1789191875 | 494 | 1789191850.004 | 469.004 | [2026-09-12T08:05:40.280Z](evidence/m1-choreo-1789200325570.jsonl) |
| M2 | green | 1789191921 | 1789192433 | 512 | 1789192387.467 | 466.467 | [2026-09-12T08:13:03.086Z](evidence/m2-choreo-1789200688916.jsonl) |
| M3 | green | 1789192433 | 1789194363 | 1930 | 1789194288.084 | 1855.084 | [2026-09-12T08:29:38.972Z](evidence/m3-choreo-1789201681720.jsonl) |
| M4 | green | 1789194363 | 1789194977 | 614 | 1789194745.808 | 382.808 | [2026-09-12T07:58:34.821Z](evidence/m4-choreo-1789199857556.jsonl) |
| M5 | green | 1789194977 | 1789196028 | 1051 | 1789195964.317 | 987.317 | [2026-09-12T08:20:12.773Z](evidence/m5-choreo-1789200976306.jsonl) |
| M6 | green | 1789196028 | 1789196497 | 469 | 1789196366.43 | 338.430 | [2026-09-12T07:59:50.361Z](evidence/m6-choreo-1789199977728.jsonl) |
| M7 | not-run | — | — | — | — | — | not-run |
| M8 | green | 1789196497 | 1789197899 | 1402 | 1789197822.102 | 1325.102 | [2026-09-12T08:30:40.559Z](evidence/m8-choreo-1789201815405.jsonl) |

All immutable retained suite attempts, required-ID coverage, choreography assertions and hashes are in [milestone-results.json](milestone-results.json). Early M1/M2 green receipts and their legacy suite aliases are preserved. Some pre-immutable failed-attempt aliases were overwritten during the initial build; their logs remain, but full historical sidecar attestation is not claimed.

## Replay

Fresh isolated owner on port 53303, authored app schema, real fixture-authenticated writes, starter segments verified independently, replay-mode suppressing push and digest. Log receipt count: 167157. Own raw start 1789197787, end 1789203933, wall 6146 seconds; checkpoint probe exclusion 147.959 seconds. Status settled. No numeric replay cap was supplied by the frozen pilot placeholders; capSeconds is null.

- 10%: verified 3204 independent assertions; [receipt](evidence/scale-verification-10%.json).
- 50%: verified 3204 independent assertions; [receipt](evidence/scale-verification-50%.json).
- final: verified 3242 independent assertions; [receipt](evidence/scale-verification-final.json).

Supplemental named fixtures: 135 checks, pass=true, including browser-decoded image pixels and sampled video frames; [receipt](evidence/scale-named-verification.json).

Read-curve rules: false; [read curve](evidence/scale-read-curve.json). Full-store-copy browser/write probes: false; [browser/write evidence](evidence/scale-browser-probes.json). Cold sync exceeded the 30-second deadline (observed 30251.346065 ms); celebrity-write p95 ratio 0.8277841904825788 passed the 3× rule. Separately measured group-to-visible delivery: pass=true, p95=3711.7082389999996 ms; [receipt](evidence/scale-group-probes.json). Extra probe content is confined to .replays/scale-probes; .replays/scale remains the canonical invariant artifact.

The trending interpolation rule failed literally: the 50% p95 was 46.712369 ms against a 46.679231 ms ceiling. The full/10% ratio passed, but that does not erase the intermediate miss; this is a performance failure, not an instrument skip.

The first registration attempt stopped after 16 accounts because my error handler checked the wrong error field. It resumed against the same hash-bound receipts and session identities after correction. A later post-checkpoint retryable transport refusal was fixed with bounded retries of the same idempotent action, preserving the verified checkpoint. Rate limiting was respected with sixty-second waits; no users/actions were omitted. Builder sample seed 620260912 is disclosed and is not the hidden grader's seed. API probes use k=20 after three warm-ups and a 30-second timeout. Full-app and celebrity-write limitations are recorded with the probe results; no O5 score or browser p95 is invented.

## Evidence and artifacts

The canonical scale owner was stopped before a streaming-hash-verified store copy was made for write probes; see [copy proof](evidence/scale-copy.json). Exact recorded server PIDs and shutdown results are in [shutdown evidence](evidence/shutdown.json).

- M1–M6 and M8 each have an iOS Hermes export under artifacts/mN-ios. The final corrected client also has artifacts/m8-ios-final; hashes and byte counts are in evidence/hermes-artifacts.json. These are bundles, not simulator proof.
- M6/M8 Apple simulator proof: unavailable/not-run on Ubuntu Linux x86_64; [simulator-status.json](simulator-status.json). M7 was expressly excluded.
- Closed-client scheduled digest, restart before deadline, exact payloads, quiet suppression, and retry dedup: [digest proof](evidence/digest-proof.json).
- Frozen 50-action replay covers all thirteen verbs and independently verifies resulting state: [sample verification](evidence/sample-verification.json).
- Selected isolated TypeScript authority journey: [platform receipt](evidence/final-platform-journey.json). This is not a full derived-suite pass; the early broad derived run was blocked by empty static seed rows.
- Startup/configs in [README.md](README.md); token-capable headless API and normalized history manifest in [API.md](API.md).

## Corrections and attribution

The following 22 grouped loops apply the protocol's completed-work/contrary-evidence definition. First-pass compiler errors are separately timestamped in run-log.md and are not counted again. Platform attribution is not inferred merely from time spent.

1. **environment** — Initial client used port 53200 despite lane config; explicit URL and isolated Metro cache corrected it. Refused requests only; no other lane inspected. Evidence: run-log.md:1789191752; evidence/expo-config.txt.
2. **agent-error** — Successful login stayed on Settings; navigate to authenticated feed. Evidence: run-log.md:1789191841.
3. **agent-error** — M2 navigation lacked feed tabs outside feed, then Stack retained duplicate hidden composers. Two iterations; global tab navigation and Router Slot. Evidence: evidence/m2-choreo-attempt1-output.log; run-log.md:1789192267,1789192350.
4. **environment** — Documented IndexedDB carrier failed in Metro with validatePath; isolated cache/server resolved it. Supersedes provisional platform attribution. Evidence: evidence/m3-browser-carrier.log; run-log.md:1789193004.
5. **ambiguous** — Concurrent harness logins exceeded two concurrent password operations. Generic initial randomized backoff reduced collision; no limiter bypass. Evidence: evidence/m3-auth-concurrency.log.
6. **agent-error** — DM resolver expected immediate commit in a same-account follower tab; observe canonical pair state for queued settlements. Evidence: evidence/m3-choreo-attempt2-output.log.
7. **agent-error** — Membership cutoff workflow required pre-admission unload journal, retained history, and correct unavailable-profile handling. Four iterations; decisive root cause was Shell treating partial profile as absent. Evidence: evidence/cutoff-ui-probe.log; run-log.md:1789193615,1789193734,1789194001,1789194186.
8. **agent-error** — Kit image used protected logical asset URL directly; resolve authenticated assetBlob to web object URL. Evidence: evidence/m4-failure.png; run-log.md:1789194669.
9. **agent-error** — Global-search pager received 20-row heads instead of its documented one-row contract; corrected endpoint. Evidence: evidence/m5-search-pagination-probe.log; evidence/m5-search-pagination-fixed.log.
10. **agent-error** — Expired server messages remained in custom history cache; honor server deadline on load/render and periodic purge. Evidence: evidence/m5-choreo-output.log; evidence/m5-expiry-owner-status.json.
11. **agent-error** — Insights and Trending one-shot reads ran before usable local state; connection retry insufficient, observed queries fixed initial loading. Two iterations. Evidence: evidence/m8-insights-probe.log; evidence/m8-insights-probe-2.log.
12. **agent-error** — Conversation mark-read effect missed mutation-readiness transition; include readiness in dependencies. Evidence: evidence/m8-read-sync-probe.log; run-log.md:1789197784.
13. **agent-error** — Scale auth backoff inspected String(error) instead of error.code; failed after 16 registrations, fixed and resumed receipt-bound exact log. Evidence: evidence/scale-attempt-1789197787-output.log.
14. **agent-error** — Post-green bounded history rendering exposed view-once row lifetime; moved viewer to conversation Modal with account/message opened marker. Evidence: evidence/once-ui-probe.log; run-log.md:1789198921.
15. **agent-error** — Optimistic reply/edit text appeared without quoted preview/edited label; derive both from queued intent and known original. Two cases of incomplete optimistic presentation. Evidence: evidence/m3-suite-1789199201242.json; run-log.md:1789199640; evidence/final-m4-suite-output.log.
16. **ambiguous** — Post-green M3 group-settings timeout did not recur in complete remove/readd probe or frozen rerun; no platform root cause established. Evidence: evidence/m3-choreo-1789199201303.jsonl; evidence/final-cutoff-ui-probe.log.
17. **ambiguous** — M6 push assertion immediately after browser teardown missed event; passed without product change after transports settled. Evidence: run-log.md (M6 final push retry); evidence/final-m6-suite-output.log.
18. **agent-error** — Partial chat-list snapshots shifted positional rows during M8 cross-device reads; preserve displayed account-scoped row identity/order and monotonic read state. Evidence: evidence/m8-choreo-1789200013412.jsonl; src/messaging.tsx.
19. **agent-error** — Final M1 created profile canonically but composite social read was unavailable on screen; separate point-profile read with viewer/known-profile fallback. Evidence: evidence/m1-suite-latest.json; src/profile.tsx; run-log.md (M1 final profile correction).
20. **ambiguous** — Durable observed composite thread remained unavailable/partial/never-held for a canonical readable post. A plain same-bearer observer succeeds; added online read-only fallback, closed on offline cuts. No source-level platform diagnosis claimed. Evidence: evidence/final-thread-probe.log; evidence/final-thread-probe-fixed.log; src/read-fallback.ts.
21. **agent-error** — Receipt audit found a stale green choreography log had been cited after a gated suite failure. The failed M3 suite exposed send completion clearing the next draft; preserve text, quote and attachments changed while admission is in flight. Re-ran the suite and frozen segment; all attempts retained. Evidence: run-log.md (stale M3 log correction); evidence/final-m3-suite-output.log; src/messaging.tsx; src/feed.tsx.
22. **agent-error** — Scale resumed after a 38-second checkpoint probe with a retryable transport refusal while the owner stayed healthy. Adapter lacked bounded retry handling; added retries of the exact idempotent logical action and checkpoint-aware receipt resumption. Underlying connection trigger remains ambiguous. Evidence: evidence/scale-attempt-1789197900-output.log; evidence/scale-verification-10%.json; scripts/replay.ts.

## Package pins

| Package | Resolved version |
|---|---|
| expo | 54.0.37 |
| expo-asset | 12.0.13 |
| expo-constants | 18.0.14 |
| expo-file-system | 19.0.24 |
| expo-image-picker | 17.0.10 |
| expo-linking | 8.0.12 |
| expo-router | 6.0.23 |
| expo-secure-store | 15.0.8 |
| expo-sqlite | 16.0.10 |
| expo-video | 3.0.16 |
| react | 19.1.0 |
| react-dom | 19.1.0 |
| react-native | 0.81.5 |
| react-native-safe-area-context | 5.6.2 |
| react-native-screens | 4.16.0 |
| react-native-web | 0.21.2 |
| snapback2 | 0.0.29 |
| @types/react | 19.1.17 |
| typescript | 5.9.2 |
| snapback2-linux-x64 | 0.0.29 |

The copied choreography resolves Playwright 1.62.1 and Ajv 8.20.0. Runtime/toolchain binary hashes are bound in setup-identity.json and the choreography receipts. No source repository was read. Uncaught SDK diagnostics printed minified installed-package lines automatically in diagnostic output; no source file was requested, and those excerpts were not used as implementation knowledge. These accidental displays are disclosed as source-fence incidents.

## Hand-authored lines

Physical and nonblank final lines by authored/modified source file; hand-authored count is whitespace-normalized inserted/replaced nonblank lines against the public init scaffold or published global-search recipe. Unchanged generated scaffolding, generated config Quarry, copied UI/harness, package lock, media and build artifacts excluded from authored total. Scripts include diagnostics and authoring tools, separately identifiable by path. This is a ceremony proxy, not semantic effort.

Total 2145 hand-authored added nonblank lines across 104 files. Copied UI: 3671 physical source lines, excluded from authored total.

| File | Final physical lines | Authored added nonblank lines |
|---|---:|---:|
| app/_layout.tsx | 4 | 4 |
| app/chat/[id]/index.tsx | 5 | 5 |
| app/chat/[id]/settings.tsx | 5 | 5 |
| app/chats.tsx | 4 | 4 |
| app/conversation/[handle].tsx | 5 | 5 |
| app/conversation/group/[group]/index.tsx | 5 | 5 |
| app/conversation/group/[group]/settings.tsx | 5 | 5 |
| app/index.tsx | 6 | 6 |
| app/insights.tsx | 4 | 4 |
| app/new-chat.tsx | 4 | 4 |
| app/post/[id].tsx | 5 | 5 |
| app/profile/[handle].tsx | 5 | 5 |
| app/profile/edit.tsx | 4 | 4 |
| app/search.tsx | 10 | 10 |
| app/settings.tsx | 5 | 5 |
| app.config.js | 14 | 0 |
| app.json | 12 | 4 |
| choreography-adapter.json | 1 | 1 |
| config/digest.production.json | 8 | 8 |
| config/windows.production.json | 24 | 24 |
| index.js | 3 | 0 |
| metro.config.cjs | 18 | 3 |
| package.json | 45 | 25 |
| scripts/acceptance-m2.ts | 30 | 30 |
| scripts/acceptance-m3.ts | 9 | 9 |
| scripts/acceptance-m4.ts | 9 | 9 |
| scripts/acceptance-m5.ts | 11 | 11 |
| scripts/acceptance-m6.ts | 7 | 7 |
| scripts/acceptance-m8.ts | 10 | 10 |
| scripts/acceptance.ts | 37 | 37 |
| scripts/audit-source.py | 22 | 22 |
| scripts/auth-concurrency.mjs | 1 | 1 |
| scripts/browser-check.mjs | 2 | 2 |
| scripts/build-m5.py | 80 | 72 |
| scripts/build-m8.py | 70 | 65 |
| scripts/chat-check.mjs | 2 | 2 |
| scripts/choreo.mjs | 5 | 5 |
| scripts/client-m5.py | 23 | 23 |
| scripts/config.mjs | 6 | 6 |
| scripts/custom-client-api.mjs | 5 | 5 |
| scripts/custom-client-demo.mjs | 3 | 3 |
| scripts/cutoff-probe.mjs | 3 | 3 |
| scripts/cutoff-ui-probe.mjs | 5 | 5 |
| scripts/digest-proof.mjs | 3 | 3 |
| scripts/final-report.mjs | 38 | 38 |
| scripts/format.mjs | 1 | 1 |
| scripts/insights-probe.mjs | 1 | 1 |
| scripts/log.mjs | 2 | 2 |
| scripts/m5-asset-probe.mjs | 1 | 1 |
| scripts/m5-search-probe.mjs | 5 | 5 |
| scripts/old-trend.q | 8 | 8 |
| scripts/once-ui-probe.mjs | 1 | 1 |
| scripts/package.json | 1 | 1 |
| scripts/prepare-m3.ts | 2 | 2 |
| scripts/read-sync-probe.mjs | 1 | 1 |
| scripts/replay.ts | 28 | 28 |
| scripts/scale-browser-probes.mjs | 21 | 21 |
| scripts/scale-curve.mjs | 5 | 5 |
| scripts/scale-group-probes.mjs | 13 | 13 |
| scripts/scale-probes.mjs | 23 | 23 |
| scripts/seed.ts | 38 | 38 |
| scripts/serve-web.mjs | 5 | 5 |
| scripts/setup.mjs | 5 | 5 |
| scripts/start-backend.mjs | 2 | 2 |
| scripts/sync-status-probe.mjs | 1 | 1 |
| scripts/thread-probe.mjs | 1 | 1 |
| scripts/verify-named.mjs | 16 | 16 |
| scripts/verify-replay.mjs | 24 | 24 |
| scripts/verify-sample.mjs | 6 | 6 |
| scripts/windows-probe.mjs | 1 | 1 |
| snapback/access.q | 3 | 0 |
| snapback/admin.q | 15 | 14 |
| snapback/delivery.ts | 5 | 5 |
| snapback/digest.q | 54 | 51 |
| snapback/digestConfig.q | 3 | 0 |
| snapback/feeds.q | 15 | 9 |
| snapback/follows.q | 11 | 4 |
| snapback/groups.q | 100 | 56 |
| snapback/insights.q | 10 | 8 |
| snapback/messages.q | 161 | 102 |
| snapback/notifications.q | 10 | 2 |
| snapback/posts.q | 58 | 53 |
| snapback/profiles.q | 27 | 14 |
| snapback/runtime.q | 2 | 0 |
| snapback/schema.q | 314 | 175 |
| snapback/seed.ts | 2 | 1 |
| snapback/tests/clique.test.ts | 29 | 29 |
| snapback/windows.q | 5 | 0 |
| src/MediaView.tsx | 42 | 19 |
| src/Provider.tsx | 12 | 12 |
| src/Provider.web.tsx | 10 | 10 |
| src/Shell.tsx | 47 | 47 |
| src/action-journal.ts | 36 | 36 |
| src/asset-uri.ts | 3 | 3 |
| src/asset-uri.web.ts | 31 | 31 |
| src/backend.ts | 1 | 1 |
| src/feed.tsx | 108 | 108 |
| src/global-search.ts | 54 | 8 |
| src/history.ts | 88 | 88 |
| src/insights.tsx | 26 | 26 |
| src/local-store.ts | 2 | 2 |
| src/local-store.web.ts | 3 | 3 |
| src/media.tsx | 17 | 17 |
| src/messaging.tsx | 281 | 281 |
| src/profile.tsx | 66 | 66 |
| src/read-fallback.ts | 39 | 39 |
| src/scroll.ts | 2 | 2 |
| src/search.tsx | 78 | 78 |
| src/witness-state.ts | 79 | 19 |
| tsconfig.json | 15 | 5 |

## Candid limits

- Full-scale browser cold sync exceeded 30 seconds. Functional milestone greens do not mean the scale performance objectives passed.
- Digest aggregation crosses job snapshots. Membership, expiry, or read changes between accumulation and emission can make the final payload inconsistent; the closed-client proof does not prove that race safe.
- Durable composite hydration produced `partial / never-held` for a known thread. A same-bearer online read-only observer is the documented-surface workaround; it adds a second read path. Root platform-versus-integration attribution remains ambiguous.
- Quarry row-rule comparison vocabulary rejected the desired timed predicate with `E_QUARRY_UNKNOWN`: “the platform rule vocabulary has eq/ne but not >; move the bounded comparison into a mutation require” (evidence/timed-rule-gap.json); disappearing and Trending removal use scheduled deletion plus client deadline filtering. No exact per-read deadline guarantee is claimed.
- Global search uses the published client N-way pager over all membership scopes, not a single server-wide query. Its measured growth, including a full search at each checkpoint, is reported rather than presumed acceptable.
- The notification seam logs real server emissions and local effect results; it is not connected to APNs/FCM or another external push provider.
- Simulator interactions and native durable-queue restart proofs are unavailable on Linux. Hermes export cannot substitute for them.
- No hidden grading session ran. No driver-native per-turn token stream, first-edit byte receipt, clock-skew attestation, watchdog or terminal-prefix provenance was exposed inside the permitted lane. Token counts, caps, charges and phase estimates are null. The base run record validates; a full composed scored record is not claimed.
- The run was one local existence test on this EPYC host. It provides no comparative latency ordering or variance claim against another backend or host.
- An early platform-test command accidentally selected port 38789; its isolated PID was already reaped. All subsequent starts used assigned ports. Initial refused client traffic to 53200 was corrected before M1 proof. These environment-fence mistakes are retained, not erased.

See the pre-tally [essay](essay.md), milestone [diary](diary.md), and timestamped [run log](run-log.md).

end=1789205048

````


## Input: run-record.json

SHA-256: `19b947814ca1100a2f113b427e558f6febc8e20ff93751b4a3c6f080c1d8d4a3`

````text
{
  "schemaVersion": 1,
  "lane": "snapback",
  "laneVariant": "bare",
  "carrier": "web",
  "brief": "social-messenger",
  "harness": {
    "name": "Codex",
    "model": "gpt-6-astra",
    "effort": "medium",
    "environment": {
      "expo": "54.0.37",
      "expo-asset": "12.0.13",
      "expo-constants": "18.0.14",
      "expo-file-system": "19.0.24",
      "expo-image-picker": "17.0.10",
      "expo-linking": "8.0.12",
      "expo-router": "6.0.23",
      "expo-secure-store": "15.0.8",
      "expo-sqlite": "16.0.10",
      "expo-video": "3.0.16",
      "react": "19.1.0",
      "react-dom": "19.1.0",
      "react-native": "0.81.5",
      "react-native-safe-area-context": "5.6.2",
      "react-native-screens": "4.16.0",
      "react-native-web": "0.21.2",
      "snapback2": "0.0.29",
      "@types/react": "19.1.17",
      "typescript": "5.9.2",
      "snapback2-linux-x64": "0.0.29",
      "node": "v24.13.1",
      "npm": "11.8.0",
      "os": "Ubuntu Linux x86_64",
      "host": "expose-builder-pixel / expo-build-1000",
      "cpu": "AMD EPYC 9454",
      "ports": "53300–53319",
      "playwright": "1.62.1",
      "backend": "public npm exact snapback2@0.0.29"
    }
  },
  "timestamps": {
    "startedAt": "2026-09-12T05:36:21.000Z",
    "finishedAt": "2026-09-12T09:24:08.000Z"
  },
  "firstGreenProofAt": "2026-09-12T05:44:10.004Z",
  "wallClock": {
    "totalSeconds": 13667,
    "phases": {
      "orientation": null,
      "authoring": null,
      "verification": null,
      "diagnosis": null,
      "replay": 6146,
      "m7Session": null
    }
  },
  "tokens": {
    "input": null,
    "output": null,
    "source": null,
    "phases": {
      "orientation": null,
      "authoring": null,
      "verification": null,
      "diagnosis": null,
      "replay": null,
      "m7Session": null
    }
  },
  "toolUses": null,
  "correctionLoops": [
    {
      "attribution": "environment",
      "summary": "Initial client used port 53200 despite lane config; explicit URL and isolated Metro cache corrected it. Refused requests only; no other lane inspected.",
      "evidence": "run-log.md:1789191752; evidence/expo-config.txt"
    },
    {
      "attribution": "agent-error",
      "summary": "Successful login stayed on Settings; navigate to authenticated feed.",
      "evidence": "run-log.md:1789191841"
    },
    {
      "attribution": "agent-error",
      "summary": "M2 navigation lacked feed tabs outside feed, then Stack retained duplicate hidden composers. Two iterations; global tab navigation and Router Slot.",
      "evidence": "evidence/m2-choreo-attempt1-output.log; run-log.md:1789192267,1789192350"
    },
    {
      "attribution": "environment",
      "summary": "Documented IndexedDB carrier failed in Metro with validatePath; isolated cache/server resolved it. Supersedes provisional platform attribution.",
      "evidence": "evidence/m3-browser-carrier.log; run-log.md:1789193004",
      "errorCode": "this.validatePath is not a function"
    },
    {
      "attribution": "ambiguous",
      "summary": "Concurrent harness logins exceeded two concurrent password operations. Generic initial randomized backoff reduced collision; no limiter bypass.",
      "evidence": "evidence/m3-auth-concurrency.log",
      "errorCode": "E_AUTH_RATE_LIMIT"
    },
    {
      "attribution": "agent-error",
      "summary": "DM resolver expected immediate commit in a same-account follower tab; observe canonical pair state for queued settlements.",
      "evidence": "evidence/m3-choreo-attempt2-output.log"
    },
    {
      "attribution": "agent-error",
      "summary": "Membership cutoff workflow required pre-admission unload journal, retained history, and correct unavailable-profile handling. Four iterations; decisive root cause was Shell treating partial profile as absent.",
      "evidence": "evidence/cutoff-ui-probe.log; run-log.md:1789193615,1789193734,1789194001,1789194186"
    },
    {
      "attribution": "agent-error",
      "summary": "Kit image used protected logical asset URL directly; resolve authenticated assetBlob to web object URL.",
      "evidence": "evidence/m4-failure.png; run-log.md:1789194669"
    },
    {
      "attribution": "agent-error",
      "summary": "Global-search pager received 20-row heads instead of its documented one-row contract; corrected endpoint.",
      "evidence": "evidence/m5-search-pagination-probe.log; evidence/m5-search-pagination-fixed.log"
    },
    {
      "attribution": "agent-error",
      "summary": "Expired server messages remained in custom history cache; honor server deadline on load/render and periodic purge.",
      "evidence": "evidence/m5-choreo-output.log; evidence/m5-expiry-owner-status.json"
    },
    {
      "attribution": "agent-error",
      "summary": "Insights and Trending one-shot reads ran before usable local state; connection retry insufficient, observed queries fixed initial loading. Two iterations.",
      "evidence": "evidence/m8-insights-probe.log; evidence/m8-insights-probe-2.log"
    },
    {
      "attribution": "agent-error",
      "summary": "Conversation mark-read effect missed mutation-readiness transition; include readiness in dependencies.",
      "evidence": "evidence/m8-read-sync-probe.log; run-log.md:1789197784"
    },
    {
      "attribution": "agent-error",
      "summary": "Scale auth backoff inspected String(error) instead of error.code; failed after 16 registrations, fixed and resumed receipt-bound exact log.",
      "evidence": "evidence/scale-attempt-1789197787-output.log",
      "errorCode": "E_AUTH_RATE_LIMIT"
    },
    {
      "attribution": "agent-error",
      "summary": "Post-green bounded history rendering exposed view-once row lifetime; moved viewer to conversation Modal with account/message opened marker.",
      "evidence": "evidence/once-ui-probe.log; run-log.md:1789198921"
    },
    {
      "attribution": "agent-error",
      "summary": "Optimistic reply/edit text appeared without quoted preview/edited label; derive both from queued intent and known original. Two cases of incomplete optimistic presentation.",
      "evidence": "evidence/m3-suite-1789199201242.json; run-log.md:1789199640; evidence/final-m4-suite-output.log"
    },
    {
      "attribution": "ambiguous",
      "summary": "Post-green M3 group-settings timeout did not recur in complete remove/readd probe or frozen rerun; no platform root cause established.",
      "evidence": "evidence/m3-choreo-1789199201303.jsonl; evidence/final-cutoff-ui-probe.log"
    },
    {
      "attribution": "ambiguous",
      "summary": "M6 push assertion immediately after browser teardown missed event; passed without product change after transports settled.",
      "evidence": "run-log.md (M6 final push retry); evidence/final-m6-suite-output.log"
    },
    {
      "attribution": "agent-error",
      "summary": "Partial chat-list snapshots shifted positional rows during M8 cross-device reads; preserve displayed account-scoped row identity/order and monotonic read state.",
      "evidence": "evidence/m8-choreo-1789200013412.jsonl; src/messaging.tsx"
    },
    {
      "attribution": "agent-error",
      "summary": "Final M1 created profile canonically but composite social read was unavailable on screen; separate point-profile read with viewer/known-profile fallback.",
      "evidence": "evidence/m1-suite-latest.json; src/profile.tsx; run-log.md (M1 final profile correction)"
    },
    {
      "attribution": "ambiguous",
      "summary": "Durable observed composite thread remained unavailable/partial/never-held for a canonical readable post. A plain same-bearer observer succeeds; added online read-only fallback, closed on offline cuts. No source-level platform diagnosis claimed.",
      "evidence": "evidence/final-thread-probe.log; evidence/final-thread-probe-fixed.log; src/read-fallback.ts",
      "errorCode": "partial / never-held"
    },
    {
      "attribution": "agent-error",
      "summary": "Receipt audit found a stale green choreography log had been cited after a gated suite failure. The failed M3 suite exposed send completion clearing the next draft; preserve text, quote and attachments changed while admission is in flight. Re-ran the suite and frozen segment; all attempts retained.",
      "evidence": "run-log.md (stale M3 log correction); evidence/final-m3-suite-output.log; src/messaging.tsx; src/feed.tsx"
    },
    {
      "attribution": "agent-error",
      "summary": "Scale resumed after a 38-second checkpoint probe with a retryable transport refusal while the owner stayed healthy. Adapter lacked bounded retry handling; added retries of the exact idempotent logical action and checkpoint-aware receipt resumption. Underlying connection trigger remains ambiguous.",
      "evidence": "evidence/scale-attempt-1789197900-output.log; evidence/scale-verification-10%.json; scripts/replay.ts",
      "errorCode": "E_TRANSPORT"
    }
  ],
  "handAuthoredLoc": {
    "lines": 2145,
    "files": 104,
    "sharedUiLines": 3671
  },
  "authParity": {
    "posture": "sessions",
    "notes": "Real password signup/login and generated bearer sessions for app, starter, sample and scale; developer persona only for isolated diagnostic wire journey."
  },
  "diary": "diary.md",
  "notes": "Base schema diagnostic record. The composed social-messenger scored record requires driver-native usage, first-edit, terminal/clock provenance and a grader session that are unavailable inside this lane; none were fabricated. Ordinary phase splits are null because work interleaved and no trustworthy phase meter exists. Replay overlaps post-green regression and reporting; phases are not additive. See milestone-results.json for exact receipt-bound greens, all retained attempts, scale verification and explicit Linux native unavailability. Essay written after original M8 green before this tally. Single existence run; no comparative magnitude/variance claim."
}

````


## Input: m7/diary.md

SHA-256: `80cd38702cb18b4b06934032b81e458fc50daedb906673973dc6f418321e3113`

````text
I inherited the lane without builder context and used its own code, API documentation, latest suite status, run log, and final report. I did not read its diary or essay, another lane, or a Snapback source checkout. The first useful discovery was that messageCounts already existed as an unfiltered maintained aggregate. That did not satisfy this phase: conversations still needed a real persisted field, and tombstones had to stop contributing to the displayed count.

I built group poll composition and display with the frozen UI kit. The backend validates the question and options, requires group membership, stores a poll as a delivered message, and keeps each member's choice behind a unique message/actor key. Vote intents use the existing mutation-id deduplication pattern. The UI uses the SDK's durable outbox for pending votes and live observations for shared tallies. I added the count field through an optional-column successor, a bounded backfill, and a required-column successor. Sends, poll creation, delete-for-everyone, and scheduled expiry maintain it transactionally.

The easy parts were finding existing patterns and reusing them. The seed and custom-client paths were sufficiently concrete to run without guessing a transport protocol. The kit already had the poll controls, including the accessibility semantics needed by choreography. The successor status described what changed and certified that making the count required would not encounter null rows. The immediate post-migration snapshot matched every original field.

What fought me was mostly integration discipline. The segmented seed exhausted the authentication allowance, and my first retry was too early. Quarry required an explicit optional-value guard before an ordered comparison. My first expiry-cleanup chunk was too large once receipt fanout and derived index work were counted; reducing the resumable chunk solved it without dropping rows. TypeScript found two callback annotations to make explicit. I initially called those inherited failures without a pre-edit baseline, then corrected that claim in the log. The product acceptance and choreography did not need a correction loop.

This migration felt like a staged deployment with an executable progress receipt. Compared with the SQL migrations I have written, I spent less effort designing the count aggregation and more effort expressing the batch's certified bound. The optional/backfill/required sequence was familiar. The important difference was that backfill chunks commit independently, so I used maintained per-conversation aggregates rather than a reset-and-increment population sweep that could miscount concurrent writes. Compared with document-store application backfills I know, the generated types and required-column narrowing report made completion more explicit. These are experience comparisons, not measured claims about another backend.

The limits matter. This starter has text messages, so the required message-media and reaction fields are empty in its snapshots. The final activity audit shows normal receipt advancement from reading chats during the mandatory suites; it does not pretend that all post-test receipt strings stayed byte-for-byte unchanged. The exact migration-boundary comparison is separately preserved. Expiry depends on owner timers, so a late timer can briefly leave the stored count ahead of wall-clock visibility. Poll voting currently carries the same bounded-audience style as the inherited reactions: a poll caps historical voters at fifty, which is a limit under long membership churn. Web offline behavior is proved; the Hermes artifact does not establish native execution. The recorded servers are stopped and the fresh migrated store remains available for inspection.

````


## Input: m7/essay-paragraphs.md

SHA-256: `222414eb2360b7906c1e85da7006c5791648a335a6034ed17fdadcb7e663d1e5`

````text
Day-2 work made the distinction between a convenient aggregate and a product migration concrete. The inherited application already counted message rows internally, yet the requested field still required a successor, a backfill, and a stronger count definition. Snapback's public package gave me a fairly direct route: preserve the old shape, add an optional field, populate it with a resumable job, then ask the successor checker to certify the required field. Seeing the old and new generations and a zero-null narrowing result was more useful than treating a successful compiler run as proof that production data had migrated.

Polls fit the existing application well. The same membership rules, delivered-message path, intent IDs, and durable outbox were reusable, and the frozen UI kit kept visual work from dominating the exercise. The sharp edges appeared at boundaries: authentication throttling between seed segments, explicit narrowing of optional timestamps, and the cost of receipt fanout inside a backfill chunk. The compiler's refusal was actionable, but the author still had to understand why a seemingly small maintenance sweep multiplied into a large certified operation. No source checkout was needed to resolve those issues.

The most persuasive evidence was the sequence of observations: token-based snapshots before the schema change, exact original-field equality immediately afterward, regression suites against the migrated app, and then an offline vote observed settling in another browser. Those observations have narrower meanings than a blanket claim of production readiness. The starter does not exercise populated message-media and reaction migration, scheduled expiry has a lateness boundary, historical poll participation is capped, and native execution was not available. The backend helped make the migration inspectable; it did not remove the engineer's responsibility to explain what the evidence actually covers.

````


## Input: m7/run-log.md

SHA-256: `80c35342328624e5030e42a662123b8185f65056d5e6e51e4fb53f5f2a2693e6`

````text
lane id astra-clique-snapback2
model gpt-6-astra
effort=medium
backend=snapback2-0.0.29
phase=m7
start=1789209905
1789209949 knowledge lookup: lane README.md API.md final-report.md run-log.md suites; instrument ENVIRONMENT.md social-messenger.md global/M7 CONTRACT.md fixtures/README.md choreography/README.md assertions.json; public package README and guide successor/dev help. Pre-schema maintained messageCounts=count messages, no conversation count column. Prior latest suites green m1,m2,m3,m5,m8; failing m4,m6. Fresh store prepared by archiving stopped inherited .snapback and seed stamps. attribution=environment evidence=m7/pre-source,m7/prior-suite-status.json,m7/inherited-snapback
1789209961 fresh backend server PID=1083410 port=53300 evidence=m7/evidence/pre-owner.json
1789210001 seed m1/m2 settled; m3 refused E_AUTH_RATE_LIMIT: too many password authentication attempts; diagnostic requires wait 60 seconds. Retry after cooldown without changing app. attribution=environment evidence=m7/evidence/seed-m3.log. Node actual v24.13.1 differs host wrapper declaration; record actual tool version. knowledge lookup public guide job/schedule and lane ui PollCompose/PollDisplay.
1789210008 m3 retry still rate-limited; prior cooldown had not elapsed (agent-error retry timing). No capability failure; wait required full interval. evidence=m7/evidence/seed-m3-retry.log
1789210030 implementation decision: use kit PollCompose/PollDisplay, dedicated capped pollVotes with unique message/actor and intent dedup; count optional column then bounded backfill then required successor. Forward writes and expiry update counter transactionally; existing raw maintain preserved. evidence=snapback/schema.q,m7/pre-source/snapback/schema.q
1789210050 snapshot comparator authored before schema changes; compares every original conversation/message field and verifies pre-snapshot SHA256 hashes, allows only new conversation.messageCount. evidence=m7/compare-snapshots.mjs
1789210083 snapshot exported all eight personas via token API evidence=m7/pre-snapshot/manifest.json
1789210152 first compiler refusal E_QUARRY_TYPE polls.q optional timestamp ordered comparison; narrow with if before require, as diagnostic directs. attribution=agent-error evidence=m7/evidence/migration-stage1-check.log
1789210162 compiler E_BOUND/E_STEPS backfill chunk100 exceeds certified receipt fanout/write ceilings; reduce message sweep chunk to1 without reducing population, per diagnostic. attribution=agent-error evidence=m7/evidence/migration-stage1-check2.log
1789210177 snapshot exported all eight personas via token API evidence=m7/post-snapshot/manifest.json
1789210177 pre/post snapshot exact original fields comparison passed evidence=m7/evidence/snapshot-comparison.json
1789210177 optional successor installed; fillMessageCounts done (15 messages visited,2 conversations backfilled); required-column successor compiled/applied. evidence=m7/evidence/backfill-receipt.json,m7/evidence/migration-stage2-installed.json
1789210237 UI poll compose/display and durable SDK vote outbox wired. Typecheck reports inherited implicit-any callbacks src/messaging.tsx current parameters; no M7 type error; preserve prior failure. Public offline guide consulted. evidence=m7/evidence/typecheck1.log,m7/evidence/guide-offline.txt,src/polls.tsx
1789210340 M7 suite authored for six required assertions plus negative authorization/bounds, idempotency, expiry and snapshot receipt checks; regression subruns preserve m4/m6 and wait61s between suites for documented auth ceiling. evidence=scripts/acceptance-m7.ts
1789210355 web static server {"pid":1097252,"port":53301,"root":"/home/ccheever/clique-0029-20260912/lanes/astra-snapback2/m7/web"} evidence=m7/evidence/web-server.log
1789210361 regression m1 cooldown before auth suite evidence=m7/evidence/regression-m1.log
1789210383 poll fixture created through own API evidence=m7/evidence/choreography-fixture.json
1789210428 regression m1 pass=true evidence=evidence/m1-suite-1789210428826.json
1789210428 regression m2 cooldown before auth suite evidence=m7/evidence/regression-m2.log
1789210433 documentation extended for poll API, offline semantics, optional/backfill/required migration and timer-lateness limitation; inherited store archive moved under m7/inherited/.snapback to keep generated files under .snapback. Snapshot starter has15 text messages and no populated message media/reactions. evidence=API.md,README.md,m7/pre-snapshot/manifest.json
1789210450 first M7 acceptance core all five tests passed (backfill,poll creation/bounds,change votes,idempotency,forward counts/settings/expiry); regression m1 passed, remaining four running. iOS Hermes export started (Linux has no simulator). evidence=m7/evidence/acceptance-attempt1.log,m7/evidence/ios-export.log
1789210478 read-only git status unavailable: lane is not a git repository. No git actions required. Existing authored authority journey started via public snapback2 test --port53302 --journeys-only, owner PID will be taken from receipt. attribution=environment evidence=m7/evidence/platform-journeys.json
1789210495 regression m2 pass=true evidence=evidence/m2-suite-1789210495181.json
1789210495 regression m3 cooldown before auth suite evidence=m7/evidence/regression-m3.log
1789210521 authored backend journey passes; transient test owner PID=1101767 port=53302 auto-reaped by CLI. iOS Hermes export succeeds. Regression m2 passes. evidence=m7/evidence/platform-journeys.json,m7/evidence/ios-export.log,evidence/m2-suite-1789210495181.json
1789210547 correction to earlier typecheck attribution: no pre-edit typecheck was run, and inherited final-types.log passed; cannot establish baseline cause of callback implicit-any errors. Add explicit any annotations to existing any-state callbacks; erased types only, no product behavior repair. attribution=ambiguous evidence=m7/evidence/typecheck1.log,evidence/final-types.log,src/messaging.tsx
1789210562 regression m3 pass=true evidence=evidence/m3-suite-1789210562544.json
1789210562 regression m5 cooldown before auth suite evidence=m7/evidence/regression-m5.log
1789210596 typecheck clean after two erased callback annotations; m1/m2/m3 regressions pass; frozen copied harness and UI used as inherited, no harness modification. evidence=m7/evidence/typecheck2.log,m7/evidence/regression-m3.log
1789210628 regression m5 pass=true evidence=evidence/m5-suite-1789210628720.json
1789210628 regression m8 cooldown before auth suite evidence=m7/evidence/regression-m8.log
1789210636 frozen choreography and PollDisplay hashes exactly match instrument; audited all Quarry conversation/message writers for count maintenance. evidence=m7/evidence/frozen-surface-hashes.txt,snapback/messages.q,snapback/groups.q
1789210696 regression m8 pass=true evidence=evidence/m8-suite-1789210696331.json
1789210717 npm acceptance m7 passes; all six suite-required assertions covered; previously passing m1,m2,m3,m5,m8 all pass; m4/m6 prior failures left untouched. Starting standalone M7 choreography. evidence=m7/evidence/acceptance.json,m7/coverage.json,m7/evidence/regressions.json
1789210725 M7 choreography exit=0 evidence=m7/evidence/choreography-1789210717286.jsonl
1789210778 M7 standalone frozen choreography green including live tallies and queued offline vote reconciliation; no choreography correction loop. evidence=m7/evidence/choreography-1789210717286.jsonl
1789210779 snapshot exported all eight personas via token API evidence=m7/final-snapshot/manifest.json
1789210779 final snapshot original content intact=true; normal receipt advances=10 after regression/choreography activity evidence=m7/evidence/final-snapshot-audit.json
1789210823 shutdown SIGTERM own backend server PID=1083410 port=53300 evidence=m7/evidence/shutdown.json
1789210823 shutdown SIGTERM own web server PID=1097252 port=53301 evidence=m7/evidence/shutdown.json
1789210824 final API audit: all original content fields intact;10 original receipt values naturally advanced sent→read during required regression/choreography. Exact equality is proved at immediate migration boundary, not falsely claimed after user activity. evidence=m7/evidence/snapshot-comparison.json,m7/evidence/final-snapshot-audit.json
1789210879 M7 diary written after implementation, acceptance, choreography, final audit and shutdown; before final numerical tally. evidence=m7/diary.md
1789210879 closing essay paragraphs written before final numerical tally. evidence=m7/essay-paragraphs.md
1789211006 report-generation SyntaxError before output: inline Markdown backticks terminated JS template. Move report prose to separate data file and rerun evidence audit. attribution=agent-error evidence=m7/evidence/report-generation-error.txt,m7/report-template.md
1789211006 final evidence audit passed: coverage complete, choreography suite hash linked, pre-snapshot hashes unchanged, prior m4/m6 entries unchanged, recorded servers stopped; report written after diary/essay. evidence=m7/final-report.md,m7/result.json
end=1789211006
1789211017 final evidence audit passed: coverage complete, choreography suite hash linked, pre-snapshot hashes unchanged, prior m4/m6 entries unchanged, recorded servers stopped; report written after diary/essay. evidence=m7/final-report.md,m7/result.json
end=1789211017

````


## Input: m7/final-report.md

SHA-256: `14fad06b9354775bda2a07b938ed9b7e928735e5606c53e57b2fd48628f03759`

````text
# M7 — Day-2 evolution

lane id astra-clique-snapback2  
model gpt-6-astra; effort=medium; backend=snapback2-0.0.29  
status=green  
start=1789209905  
end=1789211017  
wallSeconds=1112

Group polls and a persisted conversation message count are shipped. Work stayed in this lane, alone, without reading another lane, a Snapback source checkout, or an inherited diary/essay. The exact public npm pin remains 0.0.29. Actual executable Node was v24.13.1, despite the host wrapper declaring 24.18.0; the inherited setup identity correctly records the actual executable. There were no capability-failure episodes.

## Migration and snapshots

The predecessor already had `maintain messageCounts: count messages by conversationId`, but no conversation count field and no tombstone exclusion. A new optional `conversations.messageCount`, a visibility aggregate, poll data, and M7 programs were installed as a successor. The backfill visited all 15 starter messages and updated both existing conversations to 6 and 9. The required-column successor reported zero null/affected rows. New conversation creation initializes zero; text/media/poll creation, unsend, and scheduled expiry maintain the field transactionally.

- Fresh predecessor owner: [receipt](evidence/pre-owner.json); original generation `0ad1107b963bebf3d1629c0c09473eab4a329969cc986ce6513058cf37d783ab`.
- Optional successor: [installed report](evidence/migration-stage1-installed.json).
- Backfill: [plan](evidence/backfill-plan.json), [completed job](evidence/backfill-receipt.json).
- Required successor: [installed report](evidence/migration-stage2-installed.json), generation `1bf9a88c84995a86c807ae6612e5ded13479b160e89a91392f4bca91696975fe`.
- Reviewable backend change: [patch](backend.patch); [final source hashes](evidence/final-source-hashes.json).
- Pre-snapshot: [eight-persona hash manifest](pre-snapshot/manifest.json), exported through each persona's issued token and the M6 custom-client helper before schema changes. The scale store was never used.
- **Immediate post-migration comparison: exact pass**, all original conversation/message fields, media references, reactions and own receipt values: [comparison](evidence/snapshot-comparison.json), [post snapshot](post-snapshot/manifest.json).
- **Final post-test audit: original content intact**, with ten normal sent→read receipt advances caused by the required browser suites/choreography. Final state is therefore not byte-for-byte receipt equality with the pre-snapshot: [explicit deltas](evidence/final-snapshot-audit.json), [final snapshot](final-snapshot/manifest.json). No receipt was restored or falsified to hide user activity.

## Acceptance and choreography

`npm run acceptance -- --milestone m7` passed on its first run. [Suite receipt](evidence/acceptance.json) and [coverage](coverage.json) cover all six suite-required assertions: m7-a01, a03, a04, a06, a07, a09. Tests exercise UI creation, server bounds and membership refusals, changing votes, duplicate and stale retry intents, backfill, text/media/poll counts, duplicate sends/deletes, expiry, settings display, and prior-suite regressions.

The unmodified frozen harness ran **m7 alone** and passed both required checks. All three live-tally attempts passed; measured click-to-other-client-tally times were 558.9, 360.7, and 570.9 ms. Bob's offline vote showed pending, settled after reconnect, incremented Alice's observed tally, and cleared pending. [Choreography receipt](evidence/choreography-1789210717286.jsonl) and [output](evidence/choreography-attempt1.log). The suite hash linked by choreography matches the current passing receipt. [Frozen source hashes](evidence/frozen-surface-hashes.txt).

The previously passing suites all passed again:

| Suite | Result | Receipt |
|---|---|---|
| M1 | pass | [receipt](../evidence/m1-suite-1789210428826.json) |
| M2 | pass | [receipt](../evidence/m2-suite-1789210495181.json) |
| M3 | pass | [receipt](../evidence/m3-suite-1789210562544.json) |
| M5 | pass | [receipt](../evidence/m5-suite-1789210628720.json) |
| M8 | pass | [receipt](../evidence/m8-suite-1789210696331.json) |

The inherited latest M4 and M6 suites were failing; their status/receipt entries were preserved exactly and those product failures were not repaired. The baseline is [prior-suite-status.json](prior-suite-status.json), not an earlier first-green claim. [Regression summary](evidence/regressions.json).

Additional validation: `snapback2 check` passes; [TypeScript check](evidence/typecheck2.log) passes; the inherited [authored authority journey](evidence/platform-journeys.json) passes on port 53302. This is a journeys-only receipt, not a claim that the full derived suite passed. Web export and [iOS Hermes export](evidence/hermes.json) succeed. Native simulator execution was unavailable on Linux and is not claimed.

## Error and correction record

Six recorded error/correction episodes are retained; none is attributed to a proven Snapback implementation defect.

| Episode | Attribution | Correction and evidence |
|---|---|---|
| Seed M3 hit E_AUTH_RATE_LIMIT after earlier segments | environment | Honored the documented cooldown; [first refusal](evidence/seed-m3.log), [successful retry](evidence/seed-m3-retry2.log) |
| First seed retry happened before cooldown elapsed | agent-error | Waited the full interval; [retry refusal](evidence/seed-m3-retry.log), timestamped run log |
| Optional expiresAt used in ordered OR comparison | agent-error | E_QUARRY_TYPE required an explicit presence guard; [diagnostic](evidence/migration-stage1-check.log) |
| Backfill cleanup chunk100 exceeded fanout/index/write bounds | agent-error | E_BOUND/E_STEPS: reduced message chunk to1 while retaining the complete sweep; [diagnostic](evidence/migration-stage1-check2.log), [passing check](evidence/migration-stage1-check3.log) |
| Two callback implicit-any errors; initial inherited attribution lacked a baseline | ambiguous; attribution correction is agent-error | Added erased type annotations and corrected the log's claim; [first check](evidence/typecheck1.log), [passing check](evidence/typecheck2.log) |
| Report generator embedded Markdown backticks in a JS template literal | agent-error | SyntaxError before any report was written; moved prose into a separate template file; [diagnostic](evidence/report-generation-error.txt) |

No product acceptance or choreography retry was needed. The unavailable git repository was an environment fact, not a failed product capability. Knowledge sources and their timestamps are in [run-log.md](run-log.md).

## Candid gaps

- The required starter has 15 text messages and empty message-media/reaction fields. Exact snapshot preservation is real, but it does not prove a populated message-media/reaction backfill or a scale migration. Existing posts with media are outside the M6 message manifest.
- Expiry uses the owner's persisted timer. A late timer can briefly leave the stored count ahead of wall-clock visibility; no exact zero-lateness guarantee is claimed. The timed expiry acceptance case passed.
- Poll votes are capped at 50 historical voters per poll. This matches the current membership ceiling but can refuse a new voter after enough membership churn. This is an application bound, not a claimed platform inability.
- M4/M6 inherited failures remain; the M7 run does not upgrade those milestones. The new poll read path reuses the inherited authenticated fallback for unavailable durable composite coverage.
- Offline poll settlement was proved on web. Hermes export is not an iOS simulator proof.
- Final normal activity advanced ten original receipt values. Use the immediate post-migration snapshot for exact migration equality; the final audit lists every allowed receipt delta explicitly.
- No hidden grader ran and no comparative backend performance claim is made.

## Process closure

Backend PID 1083410 (53300) and static web PID 1097252 (53301) were stopped with exact-PID SIGTERM. Test-owner PID 1101767 (53302) was automatically reaped by the public CLI. No other PID was killed; no assigned port remained listening. [Shutdown receipt](evidence/shutdown.json).

The fresh migrated backend remains in the lane's `.snapback/`; the stopped inherited development store is archived at `m7/inherited/.snapback/`. The scale database was not read or modified. The [diary](diary.md) was written before the [essay paragraphs](essay-paragraphs.md), and both preceded this numerical tally.

end=1789211017
````
