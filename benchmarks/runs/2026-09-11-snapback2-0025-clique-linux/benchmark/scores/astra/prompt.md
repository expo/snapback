You are gpt-6-astra. In this benchmark run, one session of your own model family built the production-shaped app Clique (a social messenger), alone and timed, on Snapback 2 (`snapback2@0.0.25`, authored in Quarry). This is the rerun of the 2026-09-05 three-backend run on the newer package: score Snapback 2 alone, on the same absolute rubric, so the number compares with that run's Snapback 2 score (Convex `convex@1.45.0` and Supabase `@supabase/supabase-js@2.112.4` against a hosted project). Your job now is to **score Snapback 2 out of 100**, holistically and by category, from the evidence this session left behind.

## Read these, and only these

The brief: `/home/ccheever/clique-0025-20260911/instrument/social-messenger.md` (skim for the milestone shape; you are scoring backends, not the app).

Your lane, with `diary.md` (per-milestone build experience), `essay.md` (the closing comparison), `run-log.md` (timestamped events, attributions), `final-report.md` (status, results, correction loops, gaps), and `run-record.json` where present:

- `/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/`

Read the narrative files in full. You may open the lanes' source files to check a specific claim. Do **not** open any other lane under `/home/ccheever/clique-0025-20260911/lanes/` (other model families' lanes, or `attempt1/`), any `grading/` directory, and never open or print `provider-secrets.env`. This is a read-only task: run nothing, write nothing, change nothing.

## How to score

- **100** = ideal for this brief: every milestone expressible directly, no workaround, nothing to prove twice. **75** = good, occasional friction. **50** = usable with substantial workarounds or missing pieces. **25** = fought the build at every step. **0** = unusable for this brief.
- Score the backend **as experienced on this brief through its published surface**, not its reputation or what you know it can do elsewhere. Evidence in the lane files decides; when a lane lost time to its own mistakes or to the environment (attributions `agent-error`, `environment`, `ambiguous` in `run-log.md`), do not charge the backend for it. Charge the backend for `*-defect` attributions, platform gaps, missing capabilities, and documentation that misled.
- Where the milestone outcomes differ between backends, weigh **why** they differ: a lane that self-downgraded milestones because the platform refused a product-preserving design is a backend finding; a lane that ran out of time on client-side test plumbing is only partly one.
- Be consistent with the rubric an earlier scorer applied to three backends: the same kind of friction gets the same kind of penalty. The **overall** score is your holistic judgement, not an average of the categories.

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

Your final message must be exactly one fenced JSON block (```json … ```) and nothing else, shaped:

```json
{
  "scorer": {"family": "astra", "model": "gpt-6-astra", "basis": "own lane's narrative files (Snapback 2 only)"},
  "backends": {
    "snapback2": {
      "overall": {"score": 0, "note": "..."},
      "setup_and_docs": {"score": 0, "note": "..."},
      "data_modeling": {"score": 0, "note": "..."},
      "authorization": {"score": 0, "note": "..."},
      "queries_and_live": {"score": 0, "note": "..."},
      "writes_and_transactions": {"score": 0, "note": "..."},
      "offline_sync": {"score": 0, "note": "..."},
      "media_assets": {"score": 0, "note": "..."},
      "background_work": {"score": 0, "note": "..."},
      "client_integration": {"score": 0, "note": "..."},
      "diagnostics_dev_loop": {"score": 0, "note": "..."},
      "scale_and_limits": {"score": 0, "note": "..."},
      "operations": {"score": 0, "note": "..."},
      "verdict": "one sentence",
      "would_use_again_for": "one sentence"
    },
  },
  "notes": ["up to five sentences on what most helped and most hurt Snapback 2 in this run"]
}
```

Scores are integers 0–100. Every category must be present for every backend. Notes cite the lane evidence (a milestone, a diagnostic, a run-log attribution), not general knowledge.


## Evidence transport override
The first scoring attempt could not initialize the host read-only sandbox. All required narratives and the brief are supplied verbatim below. Read these inline contents; DO NOT CALL TOOLS. This fresh scoring attempt includes the separately completed M7 narratives. The rubric and exclusions above remain unchanged. Do not interpret the prior environment failure as a backend defect.


<evidence-file path="/home/ccheever/clique-0025-20260911/instrument/social-messenger.md">
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

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/diary.md">
## M1 boundary
Built real password signup/login, persisted and revocable sessions, profile onboarding/editing, unique handles, uploaded avatars, Expo Router and frozen UI-kit screens. The built-in auth and typed mutations were straightforward; fixture registration and media uploads used the same API as the app. An inherited Expo URL fought isolation: initial browser requests reached the other assigned run's port before network inspection revealed the wrong environment value. The affected attempt is invalid and the URL is now pinned. Router Stack also retained hidden profile nodes; Slot matches this simple single-screen app better. Prior React and browser-debugging familiarity saved time. No missing platform capability was established in M1. Compared with Convex, the local owner needed no hosted setup; compared with Supabase, profile authorization and live reads required less separate configuration. This is experience-based, not a controlled comparison.
## M2 boundary
Built text/image/video posts, Following/Global pagination, explicit repost feed entries, follows and public counts, likes, direct reply threads, and mutation-ID deduplication. All starter posts and media replay through the public auth/mutation path. Maintained counts and merge feeds felt natural once Quarry's rule vocabulary was clear. The compiler rejected a 1,000-lane merge's closure budget; the required 500-lane merge fits. Index replacement required a generated migration, which retained profiles and backfilled five maintains. The difficult loops were mostly client/instrument integration: Metro watched transient compiler folders and crashed, React Native Web discarded the kit's semantic value props, and choreography assumed feed tabs remained reachable on profiles. The vendor patch mirrors existing state into ARIA, with no changed outcomes. React/browser familiarity helped more than backend familiarity here. Compared with SQL, maintain and merge saved custom joins and counters but made declared worst-case bounds a design concern earlier. Compared with Convex, the SDK supplies loaded live pages, while Quarry demands more explicit index direction and cardinality.
## M3 boundary
Built canonical DM pairs, distinct groups, membership/admin controls, typing, engine delivery acknowledgements, authored read watermarks, quoted replies, and full-history reads for joiners. The suite and final choreography pass. The default starter group has Erin but choreography never opens her client, so its aggregate receipt expectation is impossible. I preserved that exact mismatch and used the documented fixture adapter with a separately created Alice/Bob/Carol trio; the starter group is unchanged by that workaround.
The engine's delivery log and typing channels saved substantial backend code. The client lifecycle fought me: asynchronous roster admission could be interrupted by full-page navigation, separate quote lookups lagged bubble appearance, and a profile-query reset incorrectly unmounted an established account into onboarding. A targeted two-client removal reproduction found that last root cause. Retained history now survives that reset; revoked avatar leases are handled without an error overlay. I also invalidated an attempt that overlapped source changes. Prior browser debugging and React lifecycle familiarity saved more than any database knowledge. Compared with Convex, the explicit delivery-custody machinery is useful but has more states to understand. Compared with Supabase, automatic delivery receipts and ephemeral channels remove backend plumbing, while correct local history still required app logic. The major lesson is that readable/complete/live/authorized are different dimensions, and treating one transient query state as account state is expensive.

## M4 boundary
Built real photo/video messages, reactions with one reaction per actor, caption/text edits, tombstone deletion, and server-clock windows generated from the frozen config. Asset revocation and a real 61-second expired-edit proof passed. Upload custody and declarative window checks were compact. The client fought me: asynchronous draft settlement meant a recipient could see the committed message before the sender had actionable controls. Passive browser diagnostics finally separated that from initially suspected read-write and layout churn. Drafts now retain their explicit message identity and targeted controls. Composite message pages replaced per-row subscriptions after the documented 256-shape ceiling; ten rich rows fit the compiler budget, fifty did not. Prior React/browser knowledge helped the most, but my premature root-cause assumptions cost retries. Compared with Convex/Supabase, media authorization and once-ready asset types reduce custom server code; the bounded client history/prediction lifecycle needs more careful UI integration.

## M5 boundary
Built server-scheduled disappearing messages from the pinned window config, one-view photo custody, shared colors/backgrounds and admin group details, Unicode word-prefix people/in-chat/global search, and warm-offline search over SDK-held data. Both the server-only expiry proof and final choreography pass. Indexed Unicode search and row timers were short declarations. The difficult work was again lifecycle and web presentation: once references disappear from held projections, an authorized viewer must outlive a row update, and my retained UI map initially kept an expired row after reconnect. The final design captures only the selected asset in a parent viewer and reconciles retained rows with authoritative pages. RN Web also required explicit selected-state and image-URI semantic attributes on the kit. A directory backfill needed smaller certified chunks; conditional expiry inserts preserved create-only mutation targeting. Prior React and distributed-state familiarity helped, but it did not eliminate several wrong initial diagnoses. Relative to Supabase, asset custody and local indexed search remove substantial bespoke code; relative to Convex, these built-in paths are attractive but introduce more explicit receipt and history states. No unexpressible M5 capability was established.

## M6 boundary
Built the logged no-network push provider seam, connected-recipient suppression, standalone token/password custom-client API docs and executable demo, all thirteen replay verbs, 50-action conformance plus semantic verification, and fresh-instance replay preparation. Offline queued messages passed the frozen web choreography. Native simulator proof is unavailable on Linux and remains separately not-run; Hermes export passed. The same public SDK worked from an independently installed clean client directory with no generated application files. Push emission and the outbox were easy to express; exposing a useful message field manifest required joining receipts, read state, roster and reactions. The first conformance test incorrectly expected a replies property instead of the actual items field, and the adapter initially treated the scale credential rules as an array; both were agent errors caught locally. The package auth guide specifies session expiry/refusal but no numeric token TTL, so API.md states that limitation. Compared with Supabase, durable offline mutation replay and delivery custody save substantial application plumbing; compared with Convex, the custom-client story is similarly compact, while typed action targets and bounded operation cost shape implementation choices. Scale execution follows on its own clock and is not claimed by the authoring green.

## M8 boundary
Built server-maintained lifetime totals and seven UTC day buckets, time-limited Trending, scheduled digests through the real effect seam, account-wide unread custody, and multi-device offline convergence. The suite, choreography, final Hermes export, closed-client digest/restart proof, read/unsend/member-removal digest proof, configured-expiry counter proof, and an explicitly web-only durable restart proof pass. The separate replay verified every invariant checkpoint; after additive migration its full-corpus Insights and Trending match independently reconstructed values and render in a separate web client. Native simulator artifacts remain unavailable on Linux.

Counts and indexed rank reads felt easy once the maintains were defined. The digest fought the compiler's closure budget, so I used compact author-period totals and bounded contribution jobs. An install-phased periodic timer did not honor the UTC anchor; a persisted anchored row timer does. CLI receipt polling reported an unavailable owner although its job completed, and the retained trace made recovery straightforward. Partial local counts initially appeared as complete totals, and a nullable conversation join crashed the larger browser fixture. Explicit server freshness and defensive nullable-row handling fixed those errors. A durable view-once label also separated content identity from a transient asset reference. Global search now pages all memberships and uses bounded per-chat searches instead of silently truncating at a 100-lane merge. A final quote-history check added native scrolling and older-page acquisition; its web layout timing required a correction.

Prior React, SQL aggregation, and distributed-state familiarity saved design time, but neither translated directly into Quarry grammar or its certificates. Missing ergonomics included UTC-anchored period scheduling and reliable long-job CLI receipt polling; the documented primitives still allowed the required behavior. Compared with Convex, Quarry made bounded work and state custody more explicit and required more syntax-learning loops. Compared with Supabase, native maintains, typed effects, authorization-aware retained data, and durable writes removed several separate systems I would otherwise have assembled. This stage exposed the trade: less infrastructure assembly, more careful reasoning about partial data, read authority, and certified fanout. The client remains compact and dense; its maintainability needs a formatting/refactoring pass beyond this timed build.

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/essay.md">
# Building Clique on Snapback 2

This was an independent cold build with one backend package, one operator, and a fixed product instrument. My comparison with Convex and Supabase is therefore a comparison of engineering models informed by prior knowledge, not a controlled benchmark in which I implemented this same application on three systems. I did not inspect another implementation. What I can describe directly is where Snapback 2 made this application shorter, where it made me stop and learn, and which mistakes belonged to my client rather than the backend.

The strongest impression is that Snapback combines more of a messenger's difficult substrate than a conventional database product does. Authentication, indexed queries, transactional writes, asset custody, delivery records, ephemeral channels, local retained data, queued mutations, schedules, and effects were available through one package. The application still required substantial code, but many difficult features could be attached to existing concepts. A disappearing message had a server deadline and a row timer. A delivered message had engine-maintained custody and acknowledgments. A push notification crossed an explicit effect boundary. These were concrete primitives, not diagrams of infrastructure I still needed to provision.

That integration mattered most for media and offline work. On a Supabase-shaped implementation I would expect to combine database policy, object storage authorization, a local store, a write queue, reconciliation, and some form of realtime transport. Each component can be understandable in isolation, but their shared lifetime rules become application work. Here, the asset references and local client machinery already participated in the backend's authorization model. The web queue survived a browser restart and then committed in order. This does not establish native runtime behavior on Linux; I produced Hermes bundles and explicitly left simulator proofs unavailable. It does establish that the integration was usable beyond a static online demo.

Quarry changed the authoring experience substantially. My default reflex for backend logic is TypeScript or SQL. In TypeScript, I tend to write the operation and then reason about its transaction boundaries and queries. In SQL, I tend to reason from sets, indexes, joins, and constraints. Quarry required the operation's bounded shape to be legible to the compiler. A loop, merge, or projection that looked small in fixture data could still be refused because its declared envelope was too large. I had to learn which reads were structurally complete, which prefixes established uniform authorization, and how maintained values participated in a query's budget.

Those refusals were both friction and useful feedback. I initially imposed a per-user membership limit to make a global search shape look complete. The scale fixture correctly broke that assumption. That was my design error, not a backend defect. Removing the limit preserved the product model. Increasing the merge to cover every conversation then exceeded the query budget; alternative merge forms also produced explicit diagnostics. The eventual client pages conversation discovery and issues bounded per-chat indexed searches. It avoids silent truncation, but it is less elegant than expressing the complete search as one query. The boundedness model prevented an unexamined large query from looking deceptively finished, while making the solution more operationally explicit.

Convex is the closer mental comparison for the reactive application layer. I associate its programming model with transactional functions and subscribed query results that fit naturally into TypeScript components. Snapback offered that kind of integrated feedback loop, but added distinctions I had to handle deliberately: server versus twin results, authoritative summaries versus partial local projections, primary pages versus retained history, and committed rows versus queued drafts. These distinctions are valuable information. They are also additional product states. A component that simply renders any available count can tell a convincing lie, as my first Insights screen did when it displayed a partial local zero as a total.

The repair for Insights was intentionally narrow. The brief required freshness on load and refresh, not a continuously reactive aggregate. I used an authenticated online read for that screen and for Trending, leaving the offline-aware client in charge of messaging. The totals themselves remained server-computed. Maintains made the lifetime counts and daily buckets compact, and the rank table made the time-limited Trending read straightforward. The final full-corpus checks compared these results with independent reconstruction from posts, likes, follows, and repost records. I did not infer correctness from a tile displaying a plausible number.

Digests were the point where the data model expanded most. Counting unread messages is not just counting rows with a timestamp. Membership changes, read acknowledgments, unsend, expiry, and replay suppression all affect whether a recipient should receive a digest. I used separate per-period custody and ongoing unread counters, keyed to the current membership incarnation. A compact author-period counter and bounded follow contributions avoided an over-budget aggregate. This is domain complexity that would exist with any backend. Supabase would make the relational pieces familiar, but would still need a careful scheduled transaction or worker. Convex would make the procedural code more familiar to me, but would not remove the need to design period eligibility and idempotency.

Scheduling also exposed a concrete ergonomic difference. The periodic timer I first chose was phased from installation, not from the configured UTC boundary. The initial proof looked too early and found no payloads; later inspection showed the correct payloads. Rather than accept that phase mismatch, I moved to a persisted row deadline at the next configured anchor and advanced it in the digest job. This met the required schedule with the available primitives, including a real backend restart. A direct UTC-anchor option would have made the intent easier to express and harder to get wrong.

Several expensive correction loops were plainly client mistakes. A transient profile query had been allowed to reset an established account into onboarding. Draft settlement could remove actionable controls before the sender saw the committed row. React Native Web did not expose some selected-state semantics where the frozen harness expected them. A conversation join could be null during local hydration, which crashed the full-corpus browser until I guarded it. The original quote jump was web-specific; the final pass added native scroll positions and older-history acquisition. None of these should be credited as database shortcomings simply because they happened while using this backend.

View-once media taught a related modeling lesson. An asset reference is not a durable description of the kind of message that was sent. A held projection can omit that reference, and an authorized viewer must have a controlled lifetime of its own. I ultimately kept a durable view-once label, requested an authorized reference when opening, and kept the viewer above the row's changing lifetime. That is a better domain model than allowing reference presence alone to determine whether a photo control exists. Snapback supplied the byte-custody mechanism; I still had to make the user interface respect it.

The operator tools were unusually helpful for recovering from uncertainty. Checks named the refusal family and the site. Traces exposed actual rows, writes, deliveries, and job progress. The scale analytics CLI stream reported an unavailable owner even though the owner was alive and its durable job had completed. That diagnostic is a package defect from this run's evidence. A fresh status read and the job trace established what had happened, so I could continue without rerunning the migration blindly. I value this inspectability. It also suggests that long-job monitoring deserves the same reliability attention as the underlying job engine.

The custom-client exercise was another useful boundary test. A clean client installation, without this project's generated files, could authenticate, list conversations, read history, normalize the message contract, and send and observe a message through the public SDK. That reduced the concern that the React integration was hiding an inaccessible backend. The documentation still left one practical uncertainty: it described session expiry and refusal but did not give a numeric token lifetime or expiry instant. I documented the limitation instead of inventing a guarantee. Similarly, I did not convert web evidence or an exported bundle into a claim about a native simulator.

I would describe the resulting trade as less infrastructure assembly and more explicit state reasoning. Snapback made several difficult messenger capabilities available without introducing a separate service for each one. Its compiler and client exposed costs and authority states that another stack might leave implicit. That helped the final implementation, but it also made a cold start demanding. Better examples around composite history, partial summaries, large discovery sets, and anchored schedules would have prevented several detours. The final application is production-shaped in its persisted model and exercised behavior, not evidence of production operations, long-term reliability, or polished maintainability. The dense client code and local-only environment are real limits. What this run demonstrates is that the package's integrated model can carry a fairly demanding messenger, provided the engineer treats its receipts, bounds, and lifetimes as part of the product rather than incidental SDK details.

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/run-log.md">
lane id astra-clique-snapback2
model gpt-6-astra
effort=medium
backend=snapback2-0.0.25
start=1789163268
1789163284 M1 start; orientation; source=fixture evidence=instrument/ENVIRONMENT.md; Linux wrapper overrides host facts
1789163361 server backend launcher PID=2735350 port=53200 evidence=evidence/backend.log
1789163444 lookup source=package README/guide auth/assets/init/quarry; first product edit M1 profiles + Router; error environment background child exited; retry foreground tool session; evidence=evidence/backend.pid
1789163475 server backend PID=2742828 launcher=2742788,2742821 port=53200; web PID=2745801 launcher=2745704 port=53201
1789163475 error agent-error seed TypeScript module mode; retry scripts/package.json type=module; evidence=evidence/seed-m1.log
1789163616 correction loop environment: inherited EXPO_PUBLIC_SNAPBACK_URL=53100 sent initial M1 browser signup/profile requests outside assigned lane; discovered request URL in scripts/debug.mjs; no source inspected. Invalid suite attempt discarded. Pin 53200 explicitly; evidence=evidence/acceptance-m1.log. Web PID=2745801 stopped.
1789163657 error agent-error M1 suite strict selector found retained Stack profile twice; use Router Slot for single active screen; evidence=evidence/acceptance-m1-retry.log
1789163668 server PID inventory ["2742821 2742820 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground","2742828 2742821 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2760065 2760064 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201 --clear"]
1789163735 M1 green suite=evidence/suite-m1.json choreography=evidence/choreography-m1.jsonl ios=artifacts/m1-ios
1789163735 M2 start lookup source=package guide writes/merge/maintain/indexes evidence=snapback/feeds.q
1789163777 lookup source=package guide rules; errors agent-error maintain public syntax and ambiguous principal index fixed; certification limit diagnostic closure 6723910>4194304 for 1000 follows, reduced declared bound to required 500; obsolete generated template journey archived; evidence=evidence/check-m2*.log
1789163984 correction loop environment: Metro FallbackWatcher ENOENT on transient .snapback/build/.tests-NMmoHO crashed web server after compiler run; exclude generated/evidence/harness trees and cap workers=4; evidence=tool session 36011
1789163984 server PID inventory ["2742821 2742820 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground","2742828 2742821 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2786746 2786745 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789164090 correction loop environment UI kit accessibilityValue dropped by react-native-web; mirror identical state in aria-valuetext, vendored kit compatibility patch; source=diagnostic scripts/debug-media.mjs and fixture ui/src; M2 first choreo red retained.
1789164125 correction loop agent-error M2 profile route did not offer feed tabs expected by frozen follow choreography; add persistent feed navigation tabs to profile/thread surfaces; evidence=evidence/choreo-m2.log
1789164173 retry environment Metro restarted to actually load blockList; second ENOENT same correction loop; suite-status failure now also updates linkage (agent-error). evidence=evidence/acceptance-m2-final.log
1789164181 server PID inventory ["2742821 2742820 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground","2742828 2742821 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789164292 M2 green suite=evidence/suite-m2.json choreography=evidence/choreography-m2.jsonl ios=artifacts/m2-ios
1789164292 M3 start lookup source=package guide deliver/retain/channel/offline/programs evidence=shared/thread.ts
1789164526 M3 errors agent-error: DM scan nonuniform cap refusal resolved with unique dmPairs; text narrowing mismatch fixed; obsolete scaffold client archived after API evolution. TypeScript web/native conditional mismatch uses browser namespace at .web boundary; evidence=evidence/check-m3*.log,evidence/typecheck-m3.log
1789164612 instrument mismatch source=fixture starter-m3.log + choreography group-receipt-waits-for-slowest-member: Erin never launched; exact skip evidence=evidence/instrument-skip-m3.json. Workaround documented fixture adapter selects real trio created via groupCreate; original starter untouched.
1789164630 correction loop agent-error M3 secondary-tab DM resolver ignored queued result and existing pair; use live membership query to resolve existing DM before mutation; evidence=evidence/choreo-m3.log
1789164691 knowledge lookup source=package guide schedule/effects/connected/expiry; config topic E_GUIDE_UNKNOWN (no JSON-import recipe), will generate Quarry constants from frozen JSON configs at startup; evidence=instrument/fixtures/config/*.json
1789164782 correction loop agent-error M3 quote excerpt fetched separately and not present at bubble arrival; derive excerpt from loaded source row. Online-only roster controls now use ready headless client with keepalive so full-page navigation cannot interrupt durable-admission setup. evidence=evidence/choreo-m3-retry.log,scripts/debug-remove.mjs
1789164869 correction loop ambiguous M3 typing expiry exceeded 5s with channel ttl4s; use ttl2s to budget transport and scheduling delay. Need subsequent timing proof; evidence=evidence/choreo-m3-final.log
1789164895 correction loop agent-error M3 removed membership denied composite query cleared rendered history; retain previously displayed rows in running conversation, purge on engine removed events. No new rows admitted after loss of membership; evidence=evidence/choreo-m3-final.log
1789164952 M3 correctness refinement: read watermarks derive from last viewed message server timestamp, monotonic max, so an offline read cannot mark unseen future arrivals read; source=model knowledge evidence=snapback/messages.q
1789165082 correction loop agent-error: source/schema changed during M3 attempt4, subsequent browser contexts lost conversation surface; clean independent browser works; rerun with source frozen. evidence=evidence/choreo-m3-verified.log,scripts/debug-conversation.mjs
1789165259 correction loop agent-error confirmed root cause: transient profiles.mine reset sent established account to onboarding and unmounted conversation; unhandled avatar lease refusal added error overlay. Keep confirmed onboarding per account through resets; catch avatar revocation. evidence=evidence/debug-cutoff.log
1789165485 M3 green suite=evidence/suite-m3.json choreography=evidence/choreography-m3.jsonl ios=artifacts/m3-ios; documented trio adapter and original instrument mismatch retained
1789165485 M4 start
1789165609 lookup source=package grammar diagnostic config comments use --; initial # and // refused E_QUARRY_SYNTAX (agent-error); config compiled with shortened fixture, backend enforces now-message.at windows; evidence=evidence/check-m4*.log
1789165864 correction loop agent-error M4 send response arrived after edit interaction and cleared new edit draft; clear submitted draft before awaiting, preserve subsequent input, disable concurrent send; evidence=evidence/debug-edit.log,evidence/choreo-m4.log
1789165909 error agent-error accidental scratch redirect /tmp-not-used denied by host; no file created; work remains in lane. evidence=tool output Permission denied
1789165975 lookup source=package guide live-query warns 256 live-shape limit and no per-row subscriptions. M4 refinement batches author/quote/reactions/receipts into conversation pages; 50-row composite E_BOUND heap18526680>8388608, 10-row view certifies; raw history API retains50. evidence=evidence/check-m4-composite*.log
1789166381 correction loop agent-error M4 composite reset caused repeated read writes, competing with edits; issue once per settled message id. Two-browser reproduction now edits visibly. evidence=evidence/debug-edit-pair.log
1789166444 server PID inventory ["2742821 2742820 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground","2742828 2742821 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789166593 correction loop agent-error M4 passive diagnostics revealed clicked action can target a different row during query/history layout changes; keep admitted message rows ordered by original message time through source transitions. Diagnostic green is not claimed: concurrent own reproduction affected timing. evidence=evidence/browser-m4-diagnostic.log
1789166644 lookup source=package guide assets, offline, live-query, pagination, successor, job, proc, expressions: once custody, held indexed search, bounded repair jobs, source transitions. Initial guide path node_modules/snapback2/guide absent; corrected to dist/guide (agent-error). evidence=node_modules/snapback2/dist/guide/
1789166814 correction agent-error M4 root cause refined: sender can still display draft-only bubble after recipient sees committed row. Draft omitted actions; harness long-press fallback selected first unrelated global Edit. Drafts now retain explicit mutation messageId and same targeted actions; FIFO queues edit after send. Prior layout diagnosis was incomplete. evidence=evidence/browser-m4-diagnostic.log,shared/thread.ts
1789166902 M4 green suite=evidence/suite-m4.json choreography=evidence/choreography-m4.jsonl ios=artifacts/m4-ios
1789166902 M5 start
1789167250 M5 corrections agent-error: directory backfill100 exceeded E_STEPS2251928>1000000, chunk25 passed; expiry set on insert instead of post-insert update preserves create-only mutationTarget typing; once asset reference retained in memory through held projection stripping. Suite passes including server second-fetch refusal. Adapter wait190s covers configured180s expiry; source=package guide, diagnostic, fixture evidence=evidence/check-m5.log,evidence/acceptance-m5-custody.log
1789167392 correction loop agent-error/environment M5 RN Web discards kit accessibilityState.selected on button; mirror actual selected state into aria-pressed. Current choreography already red on color; change made during expiry wait, no green claimed. evidence=evidence/debug-settings.log,evidence/choreo-m5.log
1789167538 correction loop agent-error M5 server expiry passed but UI retained map survived authoritative disappearance during cold reconnect. Prune retained rows against server primary pages and wait for delivery drain catch-up before connected conversation becomes interactive. evidence=evidence/expiry-proof.json,evidence/choreo-m5.log
1789167725 correction loop agent-error/environment M5 background loaded but RN Web wrapper lacked changing observable URI; mirror URI semantic value. Once viewer moved to parent Modal so authoritative row pruning cannot unmount its allowed view. source=diagnostic, package guide evidence=evidence/debug-background.log,evidence/choreo-m5-purge.log
1789167752 lookup source=package guide auth/operator/effects/schedule and generated types; fixture action-schema/sample50/invariant manifest reread for upcoming M6 requirements. No scale adapter authored before M6. evidence=node_modules/snapback2/dist/guide/,instrument/fixtures/action-schema.md
1789168126 M5 green suite=evidence/suite-m5.json choreography=evidence/choreography-m5.jsonl ios=artifacts/m5-ios expiry=evidence/expiry-proof.json
1789168126 M6 start
1789168309 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789168327 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789168329 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay
1789168392 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789168393 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay
1789168455 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789168456 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay
1789168546 scale server PID inventory ["3349224 3349222 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --project scale-instance --port 53202 --foreground","3349242 3349224 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --project scale-instance --port 53202 --foreground"]
1789168581 M6 green suite=evidence/suite-m6.json choreography=evidence/choreography-m6.jsonl ios=artifacts/m6-ios native=unavailable/Linux
1789168581 scale replay start log=instrument/fixtures/scale.log project=scale-instance evidence=evidence/scale-replay
1789168781 replay error attribution=ambiguous actions=8057 Error: {"op":"groups.dmCreate","result":{"state":"rejected","code":"E_CONSTRAINT","family":"schema","message":"memberships cap 100 reached for group (principal) = {\"Array\":[{\"Id\":\"user:artAOpIkop47dr5LJBas-w\"}]}","guide":"schema/runtime","rewrite":"fix the rejected mutation input and retry"}} evidence=evidence/scale-replay
1789168839 correction loop agent-error scale cap100 wrongly generalized named probe envelope to every user; failed at action8058. Remove cap; fresh retry preserves original replay clock1789168581. evidence=evidence/scale-replay/result.json
1789168839 M8 start actualPlanningStart=1789168581 marker recorded late (agent-error); M8 wall conservatively begins at M6 boundary
1789168909 scale retry server PIDs []
1789168581 scale replay start log=instrument/fixtures/scale.log project=scale-instance-retry evidence=evidence/scale-replay-retry
1789168962 retry PIDs ["3484558 3484557 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground","3484572 3484558 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground"]; search1000 E_BOUND closure16523370>4194304, reverted100 pending batched scope workaround. Initial retry owner never started; dependent seed attempts refused E_OWNER_NOT_RUNNING (agent-error). evidence=evidence/check-scale-cap-repair.log
1789168581 scale replay start log=instrument/fixtures/scale.log project=scale-instance-retry evidence=evidence/scale-replay-retry
1789169337 scale checkpoint 10% verification start evidence=evidence/scale-replay-retry
1789169350 scale verification 10% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry
1789170044 scale checkpoint 50% verification start evidence=evidence/scale-replay-retry
1789170095 scale verification 50% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry
1789170232 server PID inventory ["2742821 2742820 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground","2742828 2742821 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789170257 M8 digest proof main owner exact PIDs 2742828,2742821 stopped; replacement parent 190870 evidence=evidence/server-m8-restart.log
1789170273 M8 restart retry attribution=agent-error wrong shim dist/cli.js nonexistent; use installed bin command parent=208396; search batch array refused E_QUARRY_SYNTAX and cursor range refused E_ARGS_TYPE held_search canonical discovery. source=package guide pagination,diagnostic evidence=evidence/check-search-batch-cursor.log
1789170281 server PID inventory [" 208428  208396 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789170312 M8 correction loops attribution=agent-error: object arrays refused (scalar arrays only); maintain sum syntax corrected to 'sum table of field'; digest500 following closure exceeded 4MiB, replaced wide maintain with compact per-period totals and chunked contributions; nonuniform contribution prefix corrected with follower/followId cap3; reviewed derived periodPosts removal migration and backfilled analytics/unread. source=package guide,diagnostic evidence=evidence/check-m8*.log,evidence/migration-m8-reviewed.json,evidence/backfill-analytics-m8.log
1789170312 M8 Insights first UI totals came from partial twin (0), corrected load/refresh to authenticated online client; historical test attempted immutable at update E_CONSTRAINT, corrected operator historical insert fixture without weakening production rule; suite green. Choreography no unliked recent Alice candidate after suite, added normal API handoff post. attribution=agent-error evidence=evidence/acceptance-m8-online.log,evidence/acceptance-m8-historical.log,evidence/choreo-m8.log
1789170312 M8 knowledge lookup source=package guide pagination, package generated types; expanded global search attempts: 1000-lane closure over bound; array merge lane E_QUARRY_SYNTAX bounded range required; cursor membership range E_ARGS_TYPE held_search canonical authorization discovery. Existing100-lane query retained pending alternate implementation. attribution=ambiguous evidence=evidence/check-search-batch.log,evidence/check-search-batch-cursor.log
1789170616 M8 anchored digest closed-client proof restart exact PIDs 208428,208396 killed; parent=425274 evidence=evidence/server-m8-anchor-restart.log
1789170636 server PID inventory ["2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789170636 M8 correction attribution=agent-error: second no-unliked choreography failure was actually unobservable false toggle state, explicit aria-pressed fixed UI bridge; M8 choreography green evidence=evidence/choreo-m8-toggle.log. M8 Hermes export success evidence=evidence/hermes-m8.log
1789170636 M8 digest proof initially checked18s after bucket but period timer was install-phased28s after UTC boundary; independent data inspection showed exact expected counts emitted later. source=package guide schedule,diagnostic. Replaced period timer with anchored persisted row timer; time? trigger needs distinct present cutoff argument; named index and deny syntax corrected. attribution=agent-error evidence=evidence/digest-proof-first.log,evidence/check-digest-anchor*.log
1789170636 Search paged discovery and bounded per-chat queries implemented across all memberships, eight concurrent requests, same SDK twin query offline. M5 regression found view-once reference absent from item projection while present in rich server metadata; use both admitted representations. attribution=ambiguous evidence=evidence/acceptance-search-regression.log
1789170657 server PID inventory [" 447721  447712 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground","2804740 2804739 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"]
1789170858 M8 digest real-clock proof green evidence=evidence/digest-proof.json
1789170931 additional web durable queue restart proof green; web shell available, backend partitioned; not native simulator evidence=evidence/web-durable-proof.json
1789171047 M8 correction attribution=agent-error: restart invoked before previous owner exit, attachment saw E_OWNER_NOT_RUNNING; retried foreground after exact PID exit, new native PID447721 parent447712. source=diagnostic,package CLI help evidence=evidence/server-m8-anchor-retry.log. A failed SDK stack dumped an incidental minified package line into its diagnostic; subsequent reads avoid that line.
1789171047 M8 view-once marker correction: rich metadata fallback insufficient under held projection; added durable hasOnce and authorized on-open onceReference query, backfilled metadata with chunk1 after chunk25 delivery fanout refused. Optional result type guard fixed. M5 full suite green evidence=evidence/acceptance-search-regression-marker.log attribution=agent-error
1789171047 M8 web queue restart proof passed after fixing initial auth-screen readiness race. Backend partitioned while web shell remained accessible; no native simulator claim. source=diagnostic evidence=evidence/web-durable-proof.json attribution=agent-error
1789171047 M8 environment guard correction: app config now accepts explicit loopback backend in assigned53200–53219 range only, allowing own scale instance53202 while rejecting inherited53100. source=environment evidence=app.config.js
1789171175 scale verification 100% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry
1789171175 scale replay end pass=true actions=167157 excludedProbeMs=64666 verification=manifest verified evidence=evidence/scale-replay-retry
1789171180 M8 full-corpus successor/backfill start after final M6 invariant verification evidence=evidence/scale-upgrade.log
1789171187 M8 final suite all required IDs pass; final Hermes export success; M5 full choreography regression green after view-once marker and global search changes. source=diagnostic evidence=evidence/acceptance-m8-final.log,evidence/hermes-m8-final.log,evidence/choreo-m5-m8-regression.log
1789171187 M8 documentation correction attribution=agent-error README initially referenced nonexistent examples path; corrected to scripts/custom-client-demo.mjs. API documents full search pagination, latest read watermark and durable view-once label. evidence=README.md,API.md
1789171218 M8 full-corpus successor/backfill start after final M6 invariant verification evidence=evidence/scale-upgrade.log
1789171294 M8 scale web server PID inventory [" 764438  764436 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53203"]
1789171469 M8 scale successor first status E_OWNER_RUNNING while automatic derived backfill held owner; read-only retry succeeded and explicit analytics job began. attribution=environment evidence=evidence/scale-upgrade-first-status-refusal.log,evidence/scale-upgrade.log
1789171469 M8 operator backfill optimization: labelOnce chunk10 certifies where25 was over envelope; unread migration also labels once metadata in its existing message pass. Exact same app semantics; scale successor updated while independent analytics job runs. source=diagnostic attribution=agent-error evidence=evidence/check-once-backfill-ten.log,evidence/check-unread-once-combined.log
1789171575 M8 digest custody proof green read/unsend/member removal and no all-zero emissions evidence=evidence/digest-custody-proof.json
1789171648 M8 scale analytics CLI --wait returned E_OWNER_NOT_RUNNING Resource temporarily unavailable (os error11), but exact owner remained running and trace showed job done3196chunks. Attribution=snapback2-defect (false owner-not-running diagnostic during receipt polling); execution completed. Switched next job to enqueue then periodic status and final trace; unread pass includes once labels, redundant label sweep omitted. source=package guide job,diagnostic evidence=evidence/scale-analytics-trace.json,evidence/scale-upgrade.log
1789171721 M8 knowledge lookup source=package CLI why; first calls omitted required --as persona, corrected to --as alice with empty args. attribution=agent-error evidence=evidence/why-insights.json,evidence/why-trending.json
1789171785 M8 full corpus analytics/unread/once-marker migration done evidence=evidence/scale-unread-summary.json
1789171884 M8 correction attribution=agent-error: final verifier process loaded before expected-statistics file writer edit, so missing file is verification tooling race; reconstructing expectations independently from unchanged core tables after additive migration. Browser proof timeout retained, adding DOM/console diagnostics. evidence=evidence/scale-insights-proof.log,evidence/scale-browser-proof-first.log
1789171884 M8 correction: unread job trace had no message writes, so previous note claiming combined once labeling was premature; explicitly checked latest scale programs and enqueued standalone labelOnce chunk10. source=diagnostic attribution=agent-error evidence=evidence/scale-unread-summary.json,evidence/scale-label-job.json
1789171904 M8 configured expiry clears unread custody with no connected client evidence=evidence/expiry-counter-proof.json
1789171938 M8 full corpus once-label job done evidence=evidence/scale-label-summary.json
1789171953 M8 full-corpus Insights/Trending five persona exact totals and rankings verified; search beyond100 conversations verified evidence=evidence/scale-insights-proof.json
1789172036 M8 scale web diagnostic: second Metro in same project served Constants URL53200 despite its expo config reporting53202; no scale account exists on main, yielding401/403. Attribution=ambiguous (shared-root Metro/config cache suspected). Isolating copied own client in scale-client and restarting exact PIDs764438,764436 on53203. source=diagnostic evidence=evidence/scale-browser-error.json,evidence/scale-expo-config.json
1789172036 M8 app config correction attribution=agent-error: preserve scaffold SQLite/SecureStore/video plugins when adding Expo Router, rather than replacing plugin array. evidence=app.config.js
1789172055 isolated scale web PID 1114379 2727672 /bin/bash -lc EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:53202 ../node_modules/.bin/expo start --web --port 53203 > ../evidence/scale-web-isolated.log 2>&1
1789172055 isolated scale web PID 1114381 1114379 node ../node_modules/.bin/expo start --web --port 53203
1789172121 legacy once labels migration main=5 scale=0 evidence=evidence/once-label-migration.json
1789172190 M8 clarification: frozen scale.log contains zero view-once media actions, so zero once-label writes were expected, not a failed asset backfill. Main authenticated-history metadata migration labeled5 legacy view-once rows. Source=fixture,diagnostic attribution=agent-error evidence=evidence/once-label-migration.json,evidence/scale-label-summary.json
1789172190 M8 client endpoint correction uses Expo public build variable directly with config fallback; shared Constants remained suspect. Both main and isolated scale copies updated. source=model knowledge,diagnostic attribution=agent-error evidence=src/backend.ts
1789172221 M8 full corpus web Insights/Trending rendered, backend origin53202 verified evidence=evidence/scale-browser-proof.json
1789172226 M8 full corpus web Insights/Trending rendered, backend origin53202 verified evidence=evidence/scale-browser-proof.json
1789172538 M8 full scale browser Insights/Trending green after null conversation join guard; isolated Metro53203 served correct53202 API. Main/scale build variable is explicit. Attribution=agent-error for unguarded nullable row; source=diagnostic evidence=evidence/scale-browser-error.json,evidence/scale-browser-proof.json
1789172538 M8 final compatibility correction: quote jump previously used web DOM only; added native scroll positions and older-page acquisition. M3 suite paging test initially clicked before settlement on larger dev history, now waits for rows; beyond-head test caught web layout offset, fixed post-layout DOM scroll. source=diagnostic attribution=agent-error evidence=evidence/acceptance-quote-regression-settled.log,evidence/quote-history-proof.json
1789172635 M8 green suite=evidence/acceptance-m8-final.log coverage=evidence/coverage-m8.json choreography=evidence/choreo-m8-final.log Hermes=artifacts/m8-ios-final; native-simulator=unavailable Linux. Additional digest/restart/custody/expiry, web durable restart, full scale API/browser and quote-history proofs pass. End of milestone authoring.
1789172635 Essay start before final tally; comparison source=model knowledge and this run's package guide/diagnostic experience; no alternate backend checkout inspected.
1789173204 final server/worker PID inventory before exact-PID cleanup [{"pid":447712,"ppid":447708,"args":"node node_modules/.bin/snapback2 dev --port 53200 --foreground"},{"pid":447721,"ppid":447712,"args":"/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground"},{"pid":447722,"ppid":447721,"args":"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2/dist/compiler.mjs --worker"},{"pid":1114379,"ppid":2727672,"args":"/bin/bash -lc EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:53202 ../node_modules/.bin/expo start --web --port 53203 > ../evidence/scale-web-isolated.log 2>&1"},{"pid":1114381,"ppid":1114379,"args":"node ../node_modules/.bin/expo start --web --port 53203"},{"pid":1114798,"ppid":1114381,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":1114799,"ppid":1114381,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":1114805,"ppid":1114381,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":1114811,"ppid":1114381,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":2804739,"ppid":2804709,"args":"sh -c \"expo\" start --web --port 53201"},{"pid":2804740,"ppid":2804739,"args":"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201"},{"pid":2805132,"ppid":2804740,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":2805133,"ppid":2804740,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":2805142,"ppid":2804740,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":2805150,"ppid":2804740,"args":"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js"},{"pid":3484558,"ppid":3484557,"args":"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground"},{"pid":3484572,"ppid":3484558,"args":"/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground"},{"pid":3484574,"ppid":3484572,"args":"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2/dist/compiler.mjs --worker"}]
1789173206 exact-PID server cleanup green evidence=evidence/server-cleanup.json
1789173235 Reporting lookup source=fixture protocol/schema/metering README. Direct invocation through the instrument symlink hit ENOENT /home/ccheever/fixtures/social-messenger/invariant-manifest-combined.json because of frozen relative imports; no outside file existed/read. Base authoring schema validated through the provided lane helper; full composed grading/metering record is explicitly not claimed without external grader/driver provenance. attribution=environment evidence=evidence/record-validation.json
1789173235 Reporting correction attribution=agent-error: summary extraction initially looked for phase rather than type=segment-summary, causing TypeError; corrected extraction and verified all current suite SHA256 linkages. Evidence=evidence/finalization.log
1789173235 Essay completed before tally; final audit coverage and base-schema validation pass. M3 choreography rerun solely re-bound the updated regression-suite hash; no product edits followed M8 boundary. Evidence=evidence/choreo-m3-final-linkage.log,evidence/coverage-validation.json
1789173235 final report, essay, diary, pins, LOC and cleanup receipts complete; evidence=final-report.md
end=1789173235
1789173632 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789173633 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay
1789176852 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789176854 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay
1789177166 adapter conformance start log=instrument/fixtures/sample-50.log project=. evidence=evidence/sample-replay
1789177168 adapter conformance end pass=true actions=50 excludedProbeMs=0 verification=sample pending semantic suite evidence=evidence/sample-replay

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/final-report.md">
# Clique — final report

Lane `astra-clique-snapback2`; model `gpt-6-astra`, effort `medium`; backend public npm `snapback2@0.0.25`. All requested authoring milestones are green under ENVIRONMENT.md's suite-plus-choreography bar. M7 was not attempted. This run was **not strictly port-clean**: the first discarded M1 browser attempt contacted 53100 through an inherited environment variable. No other lane's source was inspected.

The essay was written before this tally: [essay.md](essay.md). The qualitative milestone record is [diary.md](diary.md).

## Clocks and milestone results

Raw run start: **1789163268**. Final authoring boundary: **1789172635** (9367s from run start). Latest passing receipt, including post-boundary suite-linkage verification: **1789172809.688**. Report generation: **1789173235**. Replay overlapped M8 on its own clock and is not added again to elapsed wall.

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First observed suite+choreo green epoch | Suite assertions / choreography passed |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1789163268 | 1789163735 | 467 | 1789163679.315 | 7 / 3 |
| M2 | green | 1789163735 | 1789164292 | 557 | 1789164238.076 | 22 / 9 |
| M3 | green | 1789164292 | 1789165485 | 1193 | 1789165415.687 | 7 / 7 |
| M4 | green | 1789165485 | 1789166902 | 1417 | 1789166870.881 | 5 / 5 |
| M5 | green | 1789166902 | 1789168126 | 1224 | 1789168046.281 | 6 / 4 |
| M6 | green | 1789168126 | 1789168581 | 455 | 1789168500.247 | 5 / 1 |
| M8 | green | 1789168581 | 1789172635 | 4054 | 1789170355.921 | 6 / 5 |
| M7 | not-run | — | — | — | — | Separate fresh session excluded |

M1 is charged from the run start, including the 16 seconds before its explicit start marker. The M8 start marker was late; its charged start is conservatively the M6 boundary. First-green receipt times can precede the boundary because artifact export, additional proofs and corrections continued. The final M3 receipt was regenerated after the essay to bind the updated regression-suite hash; its original first-green receipt remains in evidence. No milestone reached the four-hour cap; there were no capability failures.

Every current suite receipt is hash-matched to its current choreography summary. [Coverage validation](evidence/coverage-validation.json) confirms the combined manifest covers every suite-required ID. Per-milestone suites, manifests and JSONL receipts are under `evidence/suite-mN.json`, `coverage-mN.json`, and `choreography-mN.jsonl`. [run-record.json](run-record.json) is an authoring-phase record validated against the base protocol schema; full composed grading/metering validity is not claimed.

## Replay and scale

Original start **1789168581**, verified end **1789171175**, gross **2594s**. All **167157** actions settled. Checkpoint pauses at 10/50% total **64.666s**; measured final verification is **99.257s**. Separating both yields **2430.077s** of replay/setup/retry wall. The unchanged raw runner receipt records only the 10/50 exclusions; [scale-clock.json](evidence/scale-clock.json) makes the final-verification correction explicit.

The first instance stopped after 8,057 accepted actions when my erroneous 100-membership cap rejected action 8,058. The successful retry used a fresh seeded instance and retained the original clock. A setup retry also failed before its owner was running. None of these intervals were erased.

10%, 50% and 100% invariant verification all pass. Final counts include 1008 users, 50228 posts, 100015 messages, 5921 follow edges, 1002 conversations and 2054 memberships. Verification checks every manifest per-user/per-chat count, group roster, named O5 fixture and named spot entity. Hash: `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`. Full settlement receipts and checkpoints: [scale-replay-retry](evidence/scale-replay-retry/).

After verification, additive M8 migration preserved core fixture state. [Full-corpus API proof](evidence/scale-insights-proof.json) verifies six totals, seven UTC buckets and Trending for five accounts against independent reconstruction. [Scale browser proof](evidence/scale-browser-proof.json) verifies real rendering and API origin 53202. Search beyond the first 100 conversations is exercised. These are local API/browser samples; they do not claim the independent grader's complete M8 degradation bands.

## Native and additional proofs

Seven milestone Hermes exports exist; [artifact inventory](evidence/native-build-artifacts.json) records paths, bytes, magic and hashes. M8's authoritative export is `artifacts/m8-ios-final`. M6 and M8 Apple simulator proofs are **unavailable / not-run because this is Linux**. Neither the exports nor the web restart screenshot substitutes for native execution.

Additional passing evidence: [anchored digest and restart](evidence/digest-proof.json), [digest read/unsend/revocation](evidence/digest-custody-proof.json), [configured expiry and unread cleanup](evidence/expiry-counter-proof.json), [web durable queue restart](evidence/web-durable-proof.json), [out-of-head quote jump](evidence/quote-history-proof.json), and final TypeScript/Quarry checks. The web restart proof kept the web shell reachable while partitioning the backend; it is explicitly not a fully offline native cold launch.

## Corrections and attribution

[Correction register](evidence/correction-register.json) retains 64 logged error/retry/correction entries with attribution and evidence. This is a count of recorded entries, **not an invented exact count of independent loops**: some lines bundle related corrections and some diagnoses were later revised. The full timestamped history is [run-log.md](run-log.md).

| Area | Attribution and resolution |
|---|---|
| Initial endpoint, module mode, duplicate route screen | Inherited environment plus agent setup errors; discarded cross-port attempt, explicit endpoint guard, module scope and Router Slot |
| M2 web semantics and Metro watcher | Environment/integration: explicit accessibility values, worker cap and generated-tree exclusions |
| M3 DM identity, roster navigation, onboarding reset | Agent errors: canonical pair index, authenticated keepalive admission, persistent confirmed account state |
| M3 starter-group receipt check | Exact instrument mismatch: Erin is a member but no Erin client is launched; documented fixture adapter uses a real Alice/Bob/Carol trio, preserving the original starter |
| M4 edit drafts and bounded composite pages | Agent errors: preserve draft identity/actions; clear submitted input before awaiting; ten rich rows fit where fifty exceeded budget |
| M5 once/expiry/history presentation | Agent errors and web integration: parent viewer, authoritative retained-row reconciliation, durable kind label and on-open reference |
| Replay cap and setup retry | Agent error: fixture probe envelope was incorrectly made a universal membership cap; fresh retry retained clock |
| M8 aggregates and digest | Agent errors: server freshness, compact contributions, UTC-anchored row timer, exact custody cleanup |
| Long-job CLI polling | snapback2-defect: E_OWNER_NOT_RUNNING / Resource temporarily unavailable while owner lived and job completed; status plus trace recovered completion |
| Scale web and nullable joins | Shared-root configuration ambiguity followed by an agent null-handling error; isolated client and guarded hydration |
| Quote history and evidence linkage | Agent test/scroll timing errors fixed; current suite hashes re-bound with a fresh M3 choreography run |

## Resolved package pins

| Package | Resolved version |
|---|---|
| expo | 54.0.37 |
| expo-constants | 18.0.14 |
| expo-file-system | 19.0.24 |
| expo-image-picker | 17.0.11 |
| expo-linking | 8.0.12 |
| expo-router | 6.0.24 |
| expo-secure-store | 15.0.8 |
| expo-sqlite | 16.0.10 |
| expo-video | 3.0.16 |
| react | 19.1.0 |
| react-dom | 19.1.0 |
| react-native | 0.81.5 |
| react-native-safe-area-context | 5.6.2 |
| react-native-screens | 4.16.0 |
| react-native-web | 0.21.2 |
| snapback2 | 0.0.25 |
| snapback2-linux-x64 | 0.0.25 |
| typescript | 5.9.2 |
| playwright | 1.62.1 |

The root lockfile and independent clean-client install retain the exact backend pin. No source checkout or alternate backend implementation was used.

## Hand-authored lines

**1827 physical lines across 105 files**, under the method in [hand-authored-loc.json](evidence/hand-authored-loc.json). Counts include tests, migrations, diagnostics and report tooling. Installed packages, isolated copies, known unchanged scaffold helpers and generated constants are excluded. Vendored UI counts are changed lines only. Dense single-line source makes physical LOC a weak complexity measure; byte counts are retained in the JSON inventory.

| File | Counted lines | Category |
|---|---:|---|
| app.config.js | 6 | configuration |
| app/_layout.tsx | 10 | client |
| app/chat/[id].tsx | 1 | client |
| app/chats.tsx | 1 | client |
| app/chatsettings/[id].tsx | 1 | client |
| app/conversation/[handle].tsx | 1 | client |
| app/conversation/group/[group]/index.tsx | 1 | client |
| app/conversation/group/[group]/settings.tsx | 1 | client |
| app/index.tsx | 1 | client |
| app/insights.tsx | 1 | client |
| app/new-chat.tsx | 1 | client |
| app/post/[postId].tsx | 1 | client |
| app/profile/[handle].tsx | 1 | client |
| app/profile/edit.tsx | 1 | client |
| app/search.tsx | 1 | client |
| app/settings.tsx | 1 | client |
| metro.config.js | 1 | configuration |
| scripts/acceptance.mjs | 27 | tooling/tests |
| scripts/backfill-once-labels.mjs | 6 | tooling/tests |
| scripts/build-insights-expected.mjs | 13 | tooling/tests |
| scripts/choreo.mjs | 5 | tooling/tests |
| scripts/cleanup-servers.mjs | 12 | tooling/tests |
| scripts/configure-digest.mjs | 1 | tooling/tests |
| scripts/configure.mjs | 3 | tooling/tests |
| scripts/custom-client-demo.mjs | 21 | tooling/tests |
| scripts/debug-conversation.mjs | 1 | tooling/tests |
| scripts/debug-cutoff.mjs | 1 | tooling/tests |
| scripts/debug-edit-loop.mjs | 1 | tooling/tests |
| scripts/debug-edit-pair.mjs | 1 | tooling/tests |
| scripts/debug-edit.mjs | 1 | tooling/tests |
| scripts/debug-media.mjs | 1 | tooling/tests |
| scripts/debug-remove.mjs | 1 | tooling/tests |
| scripts/debug-settings.mjs | 1 | tooling/tests |
| scripts/debug.mjs | 1 | tooling/tests |
| scripts/digest-custody-proof.mjs | 11 | tooling/tests |
| scripts/digest-proof.mjs | 21 | tooling/tests |
| scripts/ephemeral-suite.mjs | 11 | tooling/tests |
| scripts/expiry-counter-proof.mjs | 5 | tooling/tests |
| scripts/expiry-proof.mjs | 2 | tooling/tests |
| scripts/finalize-report.mjs | 22 | tooling/tests |
| scripts/finish-scale-upgrade.mjs | 5 | tooling/tests |
| scripts/group-reset.mjs | 1 | tooling/tests |
| scripts/insights-suite.mjs | 19 | tooling/tests |
| scripts/inspect-members.mjs | 1 | tooling/tests |
| scripts/m5-schema.py | 30 | tooling/tests |
| scripts/m5-ui.py | 21 | tooling/tests |
| scripts/m5-viewer.py | 3 | tooling/tests |
| scripts/m8-refine.py | 52 | tooling/tests |
| scripts/m8-schema.py | 32 | tooling/tests |
| scripts/media-suite.mjs | 9 | tooling/tests |
| scripts/messaging-suite.mjs | 12 | tooling/tests |
| scripts/observe-browser.mjs | 4 | tooling/tests |
| scripts/offline-suite.mjs | 7 | tooling/tests |
| scripts/pids.mjs | 2 | tooling/tests |
| scripts/prepare-choreo.ts | 1 | tooling/tests |
| scripts/quote-history-proof.mjs | 2 | tooling/tests |
| scripts/replay.ts | 50 | tooling/tests |
| scripts/scale-browser-proof.mjs | 5 | tooling/tests |
| scripts/scale-insights-proof.mjs | 7 | tooling/tests |
| scripts/scale-label-finish.mjs | 3 | tooling/tests |
| scripts/seed.ts | 31 | tooling/tests |
| scripts/setup.mjs | 5 | tooling/tests |
| scripts/social-suite.mjs | 27 | tooling/tests |
| scripts/upgrade-scale.mjs | 11 | tooling/tests |
| scripts/verify-replay.mjs | 43 | tooling/tests |
| scripts/web-durable-proof.mjs | 21 | tooling/tests |
| scripts/window-proof.mjs | 1 | tooling/tests |
| shared/thread.ts | 33 | client |
| snapback/access.q | 3 | backend |
| snapback/delivery.ts | 10 | backend |
| snapback/digest.q | 125 | backend |
| snapback/feeds.q | 16 | backend |
| snapback/follows.q | 22 | backend |
| snapback/groups.q | 103 | backend |
| snapback/insights.q | 21 | backend |
| snapback/messages.q | 220 | backend |
| snapback/posts.q | 55 | backend |
| snapback/profiles.q | 42 | backend |
| snapback/push.q | 12 | backend |
| snapback/runtime.q | 4 | backend |
| snapback/schema.q | 406 | backend |
| src/Auth.tsx | 15 | client |
| src/backend.ts | 3 | client |
| src/Connectivity.tsx | 1 | client |
| src/Connectivity.web.tsx | 2 | client |
| src/GlobalSearch.tsx | 22 | client |
| src/Insights.tsx | 3 | client |
| src/Media.tsx | 3 | client |
| src/Media.web.tsx | 3 | client |
| src/Messaging.tsx | 27 | client |
| src/online.ts | 2 | client |
| src/platform.ts | 3 | client |
| src/platform.web.ts | 5 | client |
| src/Profile.tsx | 16 | client |
| src/Search.tsx | 9 | client |
| src/Social.tsx | 12 | client |
| src/Trending.tsx | 4 | client |
| ui/src/Avatar.tsx | 2 | vendored UI changed lines |
| ui/src/ChatListRow.tsx | 1 | vendored UI changed lines |
| ui/src/ChatSettingsForm.tsx | 7 | vendored UI changed lines |
| ui/src/Composer.tsx | 1 | vendored UI changed lines |
| ui/src/FeedCard.tsx | 4 | vendored UI changed lines |
| ui/src/MessageBubble.tsx | 1 | vendored UI changed lines |
| ui/src/PollDisplay.tsx | 3 | vendored UI changed lines |
| ui/src/ReceiptTicks.tsx | 1 | vendored UI changed lines |

## Candid gaps and limits

- The initial discarded 53100 request violated the assigned-port rule. It included signup/profile traffic. It was detected and stopped; no claim of a perfectly isolated run is made.
- Native simulator execution is unavailable on this host. Native UI, plugin integration and native durable restart have bundle evidence only.
- The frozen starter-group aggregate receipt check is structurally impossible as written without Erin. [Exact instrument skip](evidence/instrument-skip-m3.json) and original receipt are retained; the documented trio adapter passed without weakening receipt rules.
- Global search uses paged per-chat requests because a 1,000-lane merge exceeded closure/heap limits and alternate batch forms were refused. The low-level convenience merge still has a documented 100-lane envelope. Large broad searches incur multiple requests; the UI renders results in bounded batches.
- Long-job CLI --wait polling was unreliable under this run's load. Durable jobs completed and were verified by trace. Period timers have no UTC-anchor syntax; the app implements the configured anchor with a persisted row deadline.
- Numeric authentication token TTL is not documented/exposed by the public AuthSession type. Clients handle expiry/refusal rather than assuming permanent tokens.
- The package's native test command was discovered but not executed because its public surface did not expose an owner-port selector within the assigned range. Authenticated suites and copied choreography provide the functional bar.
- No independent external grader ran; no complete M8 10/50/100 browser degradation score is claimed. Token counts, compaction counts, tool totals and exact four-way phase splits are unavailable rather than estimated. The official unavailable adapter is recorded; full graded/metered record composition remains external.
- This is local, production-shaped software, not a deployed or operationally audited service. Client formatting/refactoring and broader production hardening remain work beyond the timed instrument.

Process shutdown is recorded in [server-cleanup.json](evidence/server-cleanup.json); only exact tracked lane PIDs are terminated.

end=1789173235

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/run-record.json">
{
  "schemaVersion": 1,
  "lane": "snapback",
  "laneVariant": "bare",
  "carrier": "web",
  "brief": "social-messenger",
  "harness": {
    "name": "Codex API session; native usage stream unavailable inside authorized lane",
    "model": "gpt-6-astra",
    "effort": "medium",
    "environment": {
      "os": "Ubuntu Linux x86_64",
      "host": "expose-builder-pixel",
      "snapback2": "0.0.25",
      "snapback2-linux-x64": "0.0.25",
      "node": "v24.13.1",
      "ports": "53200–53219"
    }
  },
  "timestamps": {
    "startedAt": "2026-09-11T21:47:48.000Z",
    "finishedAt": "2026-09-12T00:26:49.688Z"
  },
  "firstGreenProofAt": "2026-09-11T21:54:39.315Z",
  "wallClock": {
    "totalSeconds": 9541.68799996376,
    "phases": {
      "orientation": null,
      "authoring": null,
      "verification": null,
      "diagnosis": null
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
      "diagnosis": null
    }
  },
  "toolUses": null,
  "correctionLoops": [
    {
      "attribution": "environment",
      "summary": "1789163444 lookup source=package README/guide auth/assets/init/quarry; first product edit M1 profiles + Router; error environment background child exited; retry foreground tool session; evidence=evidence/backend.pid",
      "evidence": "run-log.md:8",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789163475 error agent-error seed TypeScript module mode; retry scripts/package.json type=module; evidence=evidence/seed-m1.log",
      "evidence": "run-log.md:10",
      "errorCode": null
    },
    {
      "attribution": "environment",
      "summary": "1789163616 correction loop environment: inherited EXPO_PUBLIC_SNAPBACK_URL=53100 sent initial M1 browser signup/profile requests outside assigned lane; discovered request URL in scripts/debug.mjs; no source inspected. Invalid suite attempt discarded. Pin 53200 explicitly; evidence=evidence/acceptance-m1.log. Web PID=2745801 stopped.",
      "evidence": "run-log.md:11",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789163657 error agent-error M1 suite strict selector found retained Stack profile twice; use Router Slot for single active screen; evidence=evidence/acceptance-m1-retry.log",
      "evidence": "run-log.md:12",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789163777 lookup source=package guide rules; errors agent-error maintain public syntax and ambiguous principal index fixed; certification limit diagnostic closure 6723910>4194304 for 1000 follows, reduced declared bound to required 500; obsolete generated template journey archived; evidence=evidence/check-m2*.log",
      "evidence": "run-log.md:16",
      "errorCode": null
    },
    {
      "attribution": "environment",
      "summary": "1789163984 correction loop environment: Metro FallbackWatcher ENOENT on transient .snapback/build/.tests-NMmoHO crashed web server after compiler run; exclude generated/evidence/harness trees and cap workers=4; evidence=tool session 36011",
      "evidence": "run-log.md:17",
      "errorCode": null
    },
    {
      "attribution": "environment",
      "summary": "1789164090 correction loop environment UI kit accessibilityValue dropped by react-native-web; mirror identical state in aria-valuetext, vendored kit compatibility patch; source=diagnostic scripts/debug-media.mjs and fixture ui/src; M2 first choreo red retained.",
      "evidence": "run-log.md:19",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164125 correction loop agent-error M2 profile route did not offer feed tabs expected by frozen follow choreography; add persistent feed navigation tabs to profile/thread surfaces; evidence=evidence/choreo-m2.log",
      "evidence": "run-log.md:20",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164173 retry environment Metro restarted to actually load blockList; second ENOENT same correction loop; suite-status failure now also updates linkage (agent-error). evidence=evidence/acceptance-m2-final.log",
      "evidence": "run-log.md:21",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164526 M3 errors agent-error: DM scan nonuniform cap refusal resolved with unique dmPairs; text narrowing mismatch fixed; obsolete scaffold client archived after API evolution. TypeScript web/native conditional mismatch uses browser namespace at .web boundary; evidence=evidence/check-m3*.log,evidence/typecheck-m3.log",
      "evidence": "run-log.md:25",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164630 correction loop agent-error M3 secondary-tab DM resolver ignored queued result and existing pair; use live membership query to resolve existing DM before mutation; evidence=evidence/choreo-m3.log",
      "evidence": "run-log.md:27",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164782 correction loop agent-error M3 quote excerpt fetched separately and not present at bubble arrival; derive excerpt from loaded source row. Online-only roster controls now use ready headless client with keepalive so full-page navigation cannot interrupt durable-admission setup. evidence=evidence/choreo-m3-retry.log,scripts/debug-remove.mjs",
      "evidence": "run-log.md:29",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789164869 correction loop ambiguous M3 typing expiry exceeded 5s with channel ttl4s; use ttl2s to budget transport and scheduling delay. Need subsequent timing proof; evidence=evidence/choreo-m3-final.log",
      "evidence": "run-log.md:30",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789164895 correction loop agent-error M3 removed membership denied composite query cleared rendered history; retain previously displayed rows in running conversation, purge on engine removed events. No new rows admitted after loss of membership; evidence=evidence/choreo-m3-final.log",
      "evidence": "run-log.md:31",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789165082 correction loop agent-error: source/schema changed during M3 attempt4, subsequent browser contexts lost conversation surface; clean independent browser works; rerun with source frozen. evidence=evidence/choreo-m3-verified.log,scripts/debug-conversation.mjs",
      "evidence": "run-log.md:33",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789165259 correction loop agent-error confirmed root cause: transient profiles.mine reset sent established account to onboarding and unmounted conversation; unhandled avatar lease refusal added error overlay. Keep confirmed onboarding per account through resets; catch avatar revocation. evidence=evidence/debug-cutoff.log",
      "evidence": "run-log.md:34",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789165609 lookup source=package grammar diagnostic config comments use --; initial # and // refused E_QUARRY_SYNTAX (agent-error); config compiled with shortened fixture, backend enforces now-message.at windows; evidence=evidence/check-m4*.log",
      "evidence": "run-log.md:37",
      "errorCode": "E_QUARRY_SYNTAX"
    },
    {
      "attribution": "agent-error",
      "summary": "1789165864 correction loop agent-error M4 send response arrived after edit interaction and cleared new edit draft; clear submitted draft before awaiting, preserve subsequent input, disable concurrent send; evidence=evidence/debug-edit.log,evidence/choreo-m4.log",
      "evidence": "run-log.md:38",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789165909 error agent-error accidental scratch redirect /tmp-not-used denied by host; no file created; work remains in lane. evidence=tool output Permission denied",
      "evidence": "run-log.md:39",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789166381 correction loop agent-error M4 composite reset caused repeated read writes, competing with edits; issue once per settled message id. Two-browser reproduction now edits visibly. evidence=evidence/debug-edit-pair.log",
      "evidence": "run-log.md:41",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789166593 correction loop agent-error M4 passive diagnostics revealed clicked action can target a different row during query/history layout changes; keep admitted message rows ordered by original message time through source transitions. Diagnostic green is not claimed: concurrent own reproduction affected timing. evidence=evidence/browser-m4-diagnostic.log",
      "evidence": "run-log.md:43",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789166644 lookup source=package guide assets, offline, live-query, pagination, successor, job, proc, expressions: once custody, held indexed search, bounded repair jobs, source transitions. Initial guide path node_modules/snapback2/guide absent; corrected to dist/guide (agent-error). evidence=node_modules/snapback2/dist/guide/",
      "evidence": "run-log.md:44",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789166814 correction agent-error M4 root cause refined: sender can still display draft-only bubble after recipient sees committed row. Draft omitted actions; harness long-press fallback selected first unrelated global Edit. Drafts now retain explicit mutation messageId and same targeted actions; FIFO queues edit after send. Prior layout diagnosis was incomplete. evidence=evidence/browser-m4-diagnostic.log,shared/thread.ts",
      "evidence": "run-log.md:45",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789167250 M5 corrections agent-error: directory backfill100 exceeded E_STEPS2251928>1000000, chunk25 passed; expiry set on insert instead of post-insert update preserves create-only mutationTarget typing; once asset reference retained in memory through held projection stripping. Suite passes including server second-fetch refusal. Adapter wait190s covers configured180s expiry; source=package guide, diagnostic, fixture evidence=evidence/check-m5.log,evidence/acceptance-m5-custody.log",
      "evidence": "run-log.md:48",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789167392 correction loop agent-error/environment M5 RN Web discards kit accessibilityState.selected on button; mirror actual selected state into aria-pressed. Current choreography already red on color; change made during expiry wait, no green claimed. evidence=evidence/debug-settings.log,evidence/choreo-m5.log",
      "evidence": "run-log.md:49",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789167538 correction loop agent-error M5 server expiry passed but UI retained map survived authoritative disappearance during cold reconnect. Prune retained rows against server primary pages and wait for delivery drain catch-up before connected conversation becomes interactive. evidence=evidence/expiry-proof.json,evidence/choreo-m5.log",
      "evidence": "run-log.md:50",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789167725 correction loop agent-error/environment M5 background loaded but RN Web wrapper lacked changing observable URI; mirror URI semantic value. Once viewer moved to parent Modal so authoritative row pruning cannot unmount its allowed view. source=diagnostic, package guide evidence=evidence/debug-background.log,evidence/choreo-m5-purge.log",
      "evidence": "run-log.md:51",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789168781 replay error attribution=ambiguous actions=8057 Error: {\"op\":\"groups.dmCreate\",\"result\":{\"state\":\"rejected\",\"code\":\"E_CONSTRAINT\",\"family\":\"schema\",\"message\":\"memberships cap 100 reached for group (principal) = {\\\"Array\\\":[{\\\"Id\\\":\\\"user:artAOpIkop47dr5LJBas-w\\\"}]}\",\"guide\":\"schema/runtime\",\"rewrite\":\"fix the rejected mutation input and retry\"}} evidence=evidence/scale-replay",
      "evidence": "run-log.md:65",
      "errorCode": "E_CONSTRAINT"
    },
    {
      "attribution": "agent-error",
      "summary": "1789168839 correction loop agent-error scale cap100 wrongly generalized named probe envelope to every user; failed at action8058. Remove cap; fresh retry preserves original replay clock1789168581. evidence=evidence/scale-replay/result.json",
      "evidence": "run-log.md:66",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789168839 M8 start actualPlanningStart=1789168581 marker recorded late (agent-error); M8 wall conservatively begins at M6 boundary",
      "evidence": "run-log.md:67",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789168909 scale retry server PIDs []",
      "evidence": "run-log.md:68",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789168581 scale replay start log=instrument/fixtures/scale.log project=scale-instance-retry evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:69",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789168962 retry PIDs [\"3484558 3484557 node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground\",\"3484572 3484558 /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground\"]; search1000 E_BOUND closure16523370>4194304, reverted100 pending batched scope workaround. Initial retry owner never started; dependent seed attempts refused E_OWNER_NOT_RUNNING (agent-error). evidence=evidence/check-scale-cap-repair.log",
      "evidence": "run-log.md:70",
      "errorCode": "E_BOUND"
    },
    {
      "attribution": "ambiguous",
      "summary": "1789168581 scale replay start log=instrument/fixtures/scale.log project=scale-instance-retry evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:71",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789169337 scale checkpoint 10% verification start evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:72",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789169350 scale verification 10% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:73",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789170044 scale checkpoint 50% verification start evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:74",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789170095 scale verification 50% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:75",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789170273 M8 restart retry attribution=agent-error wrong shim dist/cli.js nonexistent; use installed bin command parent=208396; search batch array refused E_QUARRY_SYNTAX and cursor range refused E_ARGS_TYPE held_search canonical discovery. source=package guide pagination,diagnostic evidence=evidence/check-search-batch-cursor.log",
      "evidence": "run-log.md:78",
      "errorCode": "E_QUARRY_SYNTAX"
    },
    {
      "attribution": "agent-error",
      "summary": "1789170312 M8 correction loops attribution=agent-error: object arrays refused (scalar arrays only); maintain sum syntax corrected to 'sum table of field'; digest500 following closure exceeded 4MiB, replaced wide maintain with compact per-period totals and chunked contributions; nonuniform contribution prefix corrected with follower/followId cap3; reviewed derived periodPosts removal migration and backfilled analytics/unread. source=package guide,diagnostic evidence=evidence/check-m8*.log,evidence/migration-m8-reviewed.json,evidence/backfill-analytics-m8.log",
      "evidence": "run-log.md:80",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789170312 M8 Insights first UI totals came from partial twin (0), corrected load/refresh to authenticated online client; historical test attempted immutable at update E_CONSTRAINT, corrected operator historical insert fixture without weakening production rule; suite green. Choreography no unliked recent Alice candidate after suite, added normal API handoff post. attribution=agent-error evidence=evidence/acceptance-m8-online.log,evidence/acceptance-m8-historical.log,evidence/choreo-m8.log",
      "evidence": "run-log.md:81",
      "errorCode": "E_CONSTRAINT"
    },
    {
      "attribution": "agent-error",
      "summary": "1789170636 M8 correction attribution=agent-error: second no-unliked choreography failure was actually unobservable false toggle state, explicit aria-pressed fixed UI bridge; M8 choreography green evidence=evidence/choreo-m8-toggle.log. M8 Hermes export success evidence=evidence/hermes-m8.log",
      "evidence": "run-log.md:85",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789170636 M8 digest proof initially checked18s after bucket but period timer was install-phased28s after UTC boundary; independent data inspection showed exact expected counts emitted later. source=package guide schedule,diagnostic. Replaced period timer with anchored persisted row timer; time? trigger needs distinct present cutoff argument; named index and deny syntax corrected. attribution=agent-error evidence=evidence/digest-proof-first.log,evidence/check-digest-anchor*.log",
      "evidence": "run-log.md:86",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789171047 M8 correction attribution=agent-error: restart invoked before previous owner exit, attachment saw E_OWNER_NOT_RUNNING; retried foreground after exact PID exit, new native PID447721 parent447712. source=diagnostic,package CLI help evidence=evidence/server-m8-anchor-retry.log. A failed SDK stack dumped an incidental minified package line into its diagnostic; subsequent reads avoid that line.",
      "evidence": "run-log.md:91",
      "errorCode": "E_OWNER_NOT_RUNNING"
    },
    {
      "attribution": "agent-error",
      "summary": "1789171047 M8 view-once marker correction: rich metadata fallback insufficient under held projection; added durable hasOnce and authorized on-open onceReference query, backfilled metadata with chunk1 after chunk25 delivery fanout refused. Optional result type guard fixed. M5 full suite green evidence=evidence/acceptance-search-regression-marker.log attribution=agent-error",
      "evidence": "run-log.md:92",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789171047 M8 web queue restart proof passed after fixing initial auth-screen readiness race. Backend partitioned while web shell remained accessible; no native simulator claim. source=diagnostic evidence=evidence/web-durable-proof.json attribution=agent-error",
      "evidence": "run-log.md:93",
      "errorCode": null
    },
    {
      "attribution": "environment",
      "summary": "1789171047 M8 environment guard correction: app config now accepts explicit loopback backend in assigned53200–53219 range only, allowing own scale instance53202 while rejecting inherited53100. source=environment evidence=app.config.js",
      "evidence": "run-log.md:94",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789171175 scale verification 100% pass=true all entity/user/chat/roster counts and named O5 fixtures checked evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:95",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789171175 scale replay end pass=true actions=167157 excludedProbeMs=64666 verification=manifest verified evidence=evidence/scale-replay-retry",
      "evidence": "run-log.md:96",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789171187 M8 documentation correction attribution=agent-error README initially referenced nonexistent examples path; corrected to scripts/custom-client-demo.mjs. API documents full search pagination, latest read watermark and durable view-once label. evidence=README.md,API.md",
      "evidence": "run-log.md:99",
      "errorCode": null
    },
    {
      "attribution": "environment",
      "summary": "1789171469 M8 scale successor first status E_OWNER_RUNNING while automatic derived backfill held owner; read-only retry succeeded and explicit analytics job began. attribution=environment evidence=evidence/scale-upgrade-first-status-refusal.log,evidence/scale-upgrade.log",
      "evidence": "run-log.md:102",
      "errorCode": "E_OWNER_RUNNING"
    },
    {
      "attribution": "agent-error",
      "summary": "1789171469 M8 operator backfill optimization: labelOnce chunk10 certifies where25 was over envelope; unread migration also labels once metadata in its existing message pass. Exact same app semantics; scale successor updated while independent analytics job runs. source=diagnostic attribution=agent-error evidence=evidence/check-once-backfill-ten.log,evidence/check-unread-once-combined.log",
      "evidence": "run-log.md:103",
      "errorCode": null
    },
    {
      "attribution": "snapback-defect",
      "subAttribution": "defect",
      "summary": "1789171648 M8 scale analytics CLI --wait returned E_OWNER_NOT_RUNNING Resource temporarily unavailable (os error11), but exact owner remained running and trace showed job done3196chunks. Attribution=snapback2-defect (false owner-not-running diagnostic during receipt polling); execution completed. Switched next job to enqueue then periodic status and final trace; unread pass includes once labels, redundant label sweep omitted. source=package guide job,diagnostic evidence=evidence/scale-analytics-trace.json,evidence/scale-upgrade.log",
      "evidence": "run-log.md:105",
      "errorCode": "E_OWNER_NOT_RUNNING"
    },
    {
      "attribution": "agent-error",
      "summary": "1789171721 M8 knowledge lookup source=package CLI why; first calls omitted required --as persona, corrected to --as alice with empty args. attribution=agent-error evidence=evidence/why-insights.json,evidence/why-trending.json",
      "evidence": "run-log.md:106",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789171884 M8 correction attribution=agent-error: final verifier process loaded before expected-statistics file writer edit, so missing file is verification tooling race; reconstructing expectations independently from unchanged core tables after additive migration. Browser proof timeout retained, adding DOM/console diagnostics. evidence=evidence/scale-insights-proof.log,evidence/scale-browser-proof-first.log",
      "evidence": "run-log.md:108",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789171884 M8 correction: unread job trace had no message writes, so previous note claiming combined once labeling was premature; explicitly checked latest scale programs and enqueued standalone labelOnce chunk10. source=diagnostic attribution=agent-error evidence=evidence/scale-unread-summary.json,evidence/scale-label-job.json",
      "evidence": "run-log.md:109",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789172036 M8 scale web diagnostic: second Metro in same project served Constants URL53200 despite its expo config reporting53202; no scale account exists on main, yielding401/403. Attribution=ambiguous (shared-root Metro/config cache suspected). Isolating copied own client in scale-client and restarting exact PIDs764438,764436 on53203. source=diagnostic evidence=evidence/scale-browser-error.json,evidence/scale-expo-config.json",
      "evidence": "run-log.md:113",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789172036 M8 app config correction attribution=agent-error: preserve scaffold SQLite/SecureStore/video plugins when adding Expo Router, rather than replacing plugin array. evidence=app.config.js",
      "evidence": "run-log.md:114",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789172190 M8 clarification: frozen scale.log contains zero view-once media actions, so zero once-label writes were expected, not a failed asset backfill. Main authenticated-history metadata migration labeled5 legacy view-once rows. Source=fixture,diagnostic attribution=agent-error evidence=evidence/once-label-migration.json,evidence/scale-label-summary.json",
      "evidence": "run-log.md:118",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789172190 M8 client endpoint correction uses Expo public build variable directly with config fallback; shared Constants remained suspect. Both main and isolated scale copies updated. source=model knowledge,diagnostic attribution=agent-error evidence=src/backend.ts",
      "evidence": "run-log.md:119",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789172538 M8 full scale browser Insights/Trending green after null conversation join guard; isolated Metro53203 served correct53202 API. Main/scale build variable is explicit. Attribution=agent-error for unguarded nullable row; source=diagnostic evidence=evidence/scale-browser-error.json,evidence/scale-browser-proof.json",
      "evidence": "run-log.md:122",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789172538 M8 final compatibility correction: quote jump previously used web DOM only; added native scroll positions and older-page acquisition. M3 suite paging test initially clicked before settlement on larger dev history, now waits for rows; beyond-head test caught web layout offset, fixed post-layout DOM scroll. source=diagnostic attribution=agent-error evidence=evidence/acceptance-quote-regression-settled.log,evidence/quote-history-proof.json",
      "evidence": "run-log.md:123",
      "errorCode": null
    },
    {
      "attribution": "ambiguous",
      "summary": "1789173204 final server/worker PID inventory before exact-PID cleanup [{\"pid\":447712,\"ppid\":447708,\"args\":\"node node_modules/.bin/snapback2 dev --port 53200 --foreground\"},{\"pid\":447721,\"ppid\":447712,\"args\":\"/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground\"},{\"pid\":447722,\"ppid\":447721,\"args\":\"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2/dist/compiler.mjs --worker\"},{\"pid\":1114379,\"ppid\":2727672,\"args\":\"/bin/bash -lc EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:53202 ../node_modules/.bin/expo start --web --port 53203 > ../evidence/scale-web-isolated.log 2>&1\"},{\"pid\":1114381,\"ppid\":1114379,\"args\":\"node ../node_modules/.bin/expo start --web --port 53203\"},{\"pid\":1114798,\"ppid\":1114381,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":1114799,\"ppid\":1114381,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":1114805,\"ppid\":1114381,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":1114811,\"ppid\":1114381,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":2804739,\"ppid\":2804709,\"args\":\"sh -c \\\"expo\\\" start --web --port 53201\"},{\"pid\":2804740,\"ppid\":2804739,\"args\":\"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/expo start --web --port 53201\"},{\"pid\":2805132,\"ppid\":2804740,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":2805133,\"ppid\":2804740,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":2805142,\"ppid\":2804740,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":2805150,\"ppid\":2804740,\"args\":\"/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/jest-worker/build/workers/processChild.js\"},{\"pid\":3484558,\"ppid\":3484557,\"args\":\"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground\"},{\"pid\":3484572,\"ppid\":3484558,\"args\":\"/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --project scale-instance-retry --port 53202 --foreground\"},{\"pid\":3484574,\"ppid\":3484572,\"args\":\"node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2/dist/compiler.mjs --worker\"}]",
      "evidence": "run-log.md:126",
      "errorCode": null
    },
    {
      "attribution": "agent-error",
      "summary": "1789173235 Reporting correction attribution=agent-error: summary extraction initially looked for phase rather than type=segment-summary, causing TypeError; corrected extraction and verified all current suite SHA256 linkages. Evidence=evidence/finalization.log",
      "evidence": "run-log.md:129",
      "errorCode": null
    }
  ],
  "handAuthoredLoc": {
    "lines": 1827,
    "files": 105,
    "sharedUiLines": 20
  },
  "diary": "diary.md",
  "socialMessenger": {
    "instrumentVersion": "social-messenger@0.3.6-m8",
    "runScope": "full",
    "executionOrder": [
      "M1",
      "M2",
      "M3",
      "M4",
      "M5",
      "M6",
      "M8"
    ],
    "milestones": [
      {
        "milestone": "M1",
        "status": "green",
        "start": 1789163268,
        "end": 1789163735,
        "wallSeconds": 467,
        "firstGreenEpoch": 1789163679.315,
        "finalProofEpoch": 1789163679.315,
        "suiteTests": 5,
        "suiteAssertions": 7,
        "choreography": {
          "total": 3,
          "required": 3,
          "implemented": 3,
          "passed": 3,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m1.json",
        "coverage": "evidence/coverage-m1.json",
        "receipt": "evidence/choreography-m1.jsonl",
        "suiteSha256": "sha256:93f07fd9118090c6dbdf9cd36954231cfcb4b5c757f8fcb5c4e2b9c3397d9b48"
      },
      {
        "milestone": "M2",
        "status": "green",
        "start": 1789163735,
        "end": 1789164292,
        "wallSeconds": 557,
        "firstGreenEpoch": 1789164238.076,
        "finalProofEpoch": 1789164238.076,
        "suiteTests": 13,
        "suiteAssertions": 22,
        "choreography": {
          "total": 9,
          "required": 9,
          "implemented": 9,
          "passed": 9,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m2.json",
        "coverage": "evidence/coverage-m2.json",
        "receipt": "evidence/choreography-m2.jsonl",
        "suiteSha256": "sha256:8e8f0f81e2ce4b7f7e74041230a6ccd4999495f74df5cdbd80588053152769ed"
      },
      {
        "milestone": "M3",
        "status": "green",
        "start": 1789164292,
        "end": 1789165485,
        "wallSeconds": 1193,
        "firstGreenEpoch": 1789165415.687,
        "finalProofEpoch": 1789172809.688,
        "suiteTests": 7,
        "suiteAssertions": 7,
        "choreography": {
          "total": 7,
          "required": 5,
          "implemented": 7,
          "passed": 7,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m3.json",
        "coverage": "evidence/coverage-m3.json",
        "receipt": "evidence/choreography-m3.jsonl",
        "suiteSha256": "sha256:377f1a437a9e04eb9c1ed672908f825d30157b135de100fd57c0bc34c54f67ea"
      },
      {
        "milestone": "M4",
        "status": "green",
        "start": 1789165485,
        "end": 1789166902,
        "wallSeconds": 1417,
        "firstGreenEpoch": 1789166870.881,
        "finalProofEpoch": 1789166870.881,
        "suiteTests": 5,
        "suiteAssertions": 5,
        "choreography": {
          "total": 5,
          "required": 5,
          "implemented": 5,
          "passed": 5,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m4.json",
        "coverage": "evidence/coverage-m4.json",
        "receipt": "evidence/choreography-m4.jsonl",
        "suiteSha256": "sha256:3334e25a4bc49d3bba6202d77ff5056e53af101bd0da44367d49ecc9dd1c8ba5"
      },
      {
        "milestone": "M5",
        "status": "green",
        "start": 1789166902,
        "end": 1789168126,
        "wallSeconds": 1224,
        "firstGreenEpoch": 1789168046.281,
        "finalProofEpoch": 1789171138.546,
        "suiteTests": 6,
        "suiteAssertions": 6,
        "choreography": {
          "total": 4,
          "required": 2,
          "implemented": 4,
          "passed": 4,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m5.json",
        "coverage": "evidence/coverage-m5.json",
        "receipt": "evidence/choreography-m5.jsonl",
        "suiteSha256": "sha256:4a712e0ea13ed2202117f1f313d9bbc5337cd05e7f33059bab41c7abd216a4bf"
      },
      {
        "milestone": "M6",
        "status": "green",
        "start": 1789168126,
        "end": 1789168581,
        "wallSeconds": 455,
        "firstGreenEpoch": 1789168500.247,
        "finalProofEpoch": 1789168500.247,
        "suiteTests": 4,
        "suiteAssertions": 5,
        "choreography": {
          "total": 1,
          "required": 1,
          "implemented": 1,
          "passed": 1,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m6.json",
        "coverage": "evidence/coverage-m6.json",
        "receipt": "evidence/choreography-m6.jsonl",
        "suiteSha256": "sha256:4e1097da5503126eb5e73ba5e854635684d787f1f59b7d6e92e929dd1b6bfba3"
      },
      {
        "milestone": "M8",
        "status": "green",
        "start": 1789168581,
        "end": 1789172635,
        "wallSeconds": 4054,
        "firstGreenEpoch": 1789170355.921,
        "finalProofEpoch": 1789171211.591,
        "suiteTests": 5,
        "suiteAssertions": 6,
        "choreography": {
          "total": 5,
          "required": 5,
          "implemented": 5,
          "passed": 5,
          "failed": 0,
          "skipped": 0,
          "notImplemented": 0,
          "requiredUnimplemented": 0
        },
        "suite": "evidence/suite-m8.json",
        "coverage": "evidence/coverage-m8.json",
        "receipt": "evidence/choreography-m8.jsonl",
        "suiteSha256": "sha256:1d75f6295f7de8eb84b08bff744315810410d376848fcc4023b8b24146611bd6"
      },
      {
        "milestone": "M7",
        "status": "not-run",
        "reason": "Separate fresh session explicitly excluded"
      }
    ],
    "authoringBoundaryEpoch": 1789172635,
    "reportEpoch": 1789173235,
    "nativeArtifacts": "evidence/native-build-artifacts.json",
    "replay": "evidence/scale-clock.json",
    "coverage": "evidence/coverage-all.json",
    "metering": {
      "adapter": "unavailable-null",
      "adapterVersion": "unavailable-null.v1",
      "source": null,
      "turns": null,
      "unavailableReason": "no-retained-native-rollout-in-authorized-lane",
      "sourceIds": [],
      "compatibilityEvents": []
    },
    "grading": "not-run; independent grading remains external"
  },
  "notes": "Authoring-phase record validates the base protocol schema only. Full composed grading/metering schema is not claimed: no external grader or retained driver/native token provenance was supplied in this authorized lane. Exact token, tool-count, compaction and phase totals are null, not estimated. Initial M1 requests accidentally reached reserved port 53100 from an inherited environment variable; discarded attempt is disclosed. M1 includes initial orientation; M8 clock starts conservatively at M6 boundary. Latest M3 choreography was rerun after the essay solely to bind the updated regression-suite receipt; this is a separate evidence-finalization tail."
}

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/m7/diary.md">
# M7 diary

I inherited a substantial Quarry/Expo application and read its own API, reports, code and acceptance suites before changing it. I used a fresh local backend and replayed the three starter segments through the existing seed command. Before editing schema or application code, I exported each persona's authorized custom-client view with that persona's bearer token. I did not read the inherited diary/essay, other lanes, or a Snapback checkout.

I added a group poll composer and poll message display using the supplied kit. Polls inhabit the existing message table, inherit delivery and expiry, and use a separate per-user vote table. A vote is a set-state mutation with a deduplicated client mutation ID. The existing SDK handles offline queue custody. Settings now shows a required, persisted conversation messageCount; sends increment it, first unsend decrements it, and scheduled expiry removes the contribution only when the message has not already been tombstoned.

The inherited schema already had both messageCounts and liveMessageCounts aggregates. That made the backfill straightforward, but it did not eliminate the requested migration: conversations had no messageCount field. I installed an optional column, ran a bounded system job over every conversation using the existing deletion-aware aggregate, and then installed the required-column successor. The successor reports and exact API snapshot comparison provide evidence of the real transition.

The schema work felt easy. The public successor guide described the operation that I needed, and the compiler accepted the new schema and programs without a product-schema correction. Ordinary text, media and polls share the same counter paths. The migration's narrowing report explicitly showed that no null count values remained.

The harder work was test lifecycle and UI settlement. The inherited disconnected-recipient push test did not tolerate being run immediately after a Bob browser suite: the backend still reported a live stream. My first explanations were too confident. Closing parent API clients and switching subprocesses to asynchronous execution did not alone solve it. A public connected-table diagnostic finally exposed the actual precondition, and waiting for zero let the unchanged M6 suite pass. A quote-click DOM timeout passed on a subsequent unchanged suite run. I also corrected my own count-display assertion to wait for the authoritative update, and my first poll display confused retained outbox work with work still queued. Choreography correctly caught the latter: the vote had arrived, but its busy marker had not cleared.

Compared with SQL migrations I know, this backend made additive changes and checked narrowing explicit and reviewable, with a typed fill job between them. Compared with document stores, it required more declared bounds and provided a stronger executable schema contract. The existing aggregates reduced the migration work substantially, so this experience should not be represented as implementing counting from nothing. This was a starter-state migration, not a migration-at-scale exercise.

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/m7/essay-paragraphs.md">
Picking up this application was primarily an exercise in discovering its existing invariants. The useful seam was the ordinary message: placing poll metadata there reused delivery, receipts, deletion and expiry, while a separate vote row preserved a simple one-vote-per-user identity. The mutation-ID ledger and the SDK queue meant I did not need to invent a second offline protocol. The implementation still had to distinguish an admitted intent, a committed intent, and the later disappearance of its retained ledger entry; treating those as one event caused a real visible bug.

The migration was more concrete than adding a new query. The application already maintained deletion-aware counts, but conversations did not have the new field. An optional-column successor, a bounded fill job, and checked narrowing to a required field made that transition visible in the backend's own reports. Exporting the authorized API view before any schema change and comparing it immediately afterward gave the preservation claim a narrow, inspectable basis. The small starter fixture makes no claim about large-database migration behavior or about populated message-media cases that the fixture does not contain.

The most instructive friction came from running an existing production-shaped test suite in a new orchestration context. A disconnected-recipient assertion could fail while the backend still considered a departed browser stream connected, even though the same suite passed alone. My initial diagnosis did not explain all the evidence; measuring the declared connection predicate did. The experience suggests that this backend's types and transactional successors help substantially with data changes, while the engineer must still be precise about transport lifetime, local presentation, and test preconditions. That comparison is based on this artifact and general engineering experience, not on inspecting competing implementations.

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/m7/run-log.md">
lane id astra-clique-snapback2
model gpt-6-astra
effort=medium
backend=snapback2-0.0.25
phase=m7
start=1789176401
1789176441 lookup instrument ENVIRONMENT, global rulings, M7, CONTRACT, assertions, fixtures/choreography README; inherited API, README, run-log, final-report and source reviewed. Pre-M7 carries messageCounts and liveMessageCounts aggregates, no conversation count field. source=node_modules/snapback2/README.md,npx-snapback2-guide-successor evidence=m7/guide-successor.txt
1789176441 server backend launch PID=2025173 port=53200 evidence=m7/backend.log
1789176549 fresh owner seeded m1/m2/m3 via app seed; token-authenticated eight-persona M6 snapshot complete evidence=m7/pre-snapshot/manifest.json; server PIDs=[{'pid': 2015605, 'args': '/home/ccheever/.local/bin/codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json --color never -m gpt-6-astra -c model_reasoning_effort=medium -C /home/ccheever/clique-0025-20260911/lanes/astra-snapback2 -o /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/m7/FINAL.md - '}, {'pid': 2026223, 'args': 'npm exec snapback2 dev --port 53200 --foreground                           '}, {'pid': 2026276, 'args': 'sh -c "snapback2" dev --port 53200 --foreground '}, {'pid': 2026277, 'args': 'node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/.bin/snapback2 dev --port 53200 --foreground '}, {'pid': 2026284, 'args': '/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2-linux-x64/bin/snapback2 dev --port 53200 --foreground '}, {'pid': 2026285, 'args': 'node /home/ccheever/clique-0025-20260911/lanes/astra-snapback2/node_modules/snapback2/dist/compiler.mjs --worker '}]; launch background exited, restarted foreground (environment) evidence=m7/backend.log; lookup guide proc/offline evidence=m7/guide-proc.txt,m7/guide-offline.txt
1789176681 successor optional field installed; backfill wrote both existing conversations; required field successor accepted; eight persona snapshot exact comparison passed. UI uses kit PollCompose/PollDisplay and SDK vote work state. No compiler/type errors. evidence=m7/backfill.log,m7/successor-required.json,m7/snapshot-comparison.log,m7/typecheck.log
1789176713 server PID inventory evidence=m7/server-pids.json PIDs=[2015605, 2026223, 2026276, 2026277, 2026284, 2026285, 2053317, 2053399, 2053698, 2053699, 2053706, 2053712]
1789176765 correction loop attribution=agent-error: M7 parent suite kept Bob API client connected while M6 asserts closed-recipient push. Close M7 clients/page before regression subprocesses; no inherited suite/product fix. evidence=m7/regression-first/m6.log,scripts/polls-suite.mjs
1789176783 knowledge lookup sources=ui/src/PollCompose.tsx,ui/src/PollDisplay.tsx,choreography/choreography.mjs,package react-core.d.ts; initial guessed component/segment paths absent, corrected with rg (agent-error). Added explicit web selected/busy semantics as inherited kit convention. iOS Hermes export passed evidence=m7/hermes.log
1789176833 M7 authoring checks green; inherited regression first attempt retained; corrected regression running. Frozen copied choreography executable cmp-identical to instrument. setup identity refreshed for Ubuntu host. evidence=m7/typecheck-final.log,m7/regression-first/,setup-identity.json
1789176874 server PID inventory evidence=m7/server-pids.json PIDs=[2026223, 2026276, 2026277, 2026284, 2026285, 2053317, 2053399, 2053698, 2053699, 2053706, 2053712]
1789176874 correction loop attribution=agent-error: second M6 push failure disappears in isolated invocation; synchronous regression subprocess blocks parent event-loop transport closure. Changed only M7 regression runner to async execFile. Previous suite results retained. Connection diagnostic initially invalid inline range syntax (E_QUARRY_SYNTAX); split page binding. PID inventory overmatched lane-name in codex controller args; explicitly excluded controller before cleanup. evidence=m7/regression-second/m6.log,m7/m6-isolated.log,m7/connections-after-second.json,m7/server-pids.json; lookup source=npx snapback2 guide connected
1789176900 correction loop attribution=agent-error: count API was correct but test asserted first hydrated settings render before live successor arrived (2 vs 1). Wait for semantic count value, retaining 20s timeout. evidence=m7/acceptance-third.log; ad-hoc connected query remains syntactically invalid, diagnostic abandoned without app mutation evidence=m7/connections-corrected.json
1789176924 scheduled expiry proof passed for text plus poll, both count contributions removed without explicit expiry mutation. Custom-client normalization extended with poll type. evidence=m7/expiry-proof.json,scripts/custom-client-demo.mjs
1789176971 exact server process trees recorded evidence=m7/server-pids.json PIDs=[2026223, 2026276, 2026277, 2026284, 2026285, 2053317, 2053398, 2053399, 2053698, 2053699, 2053706, 2053712]
1789177068 correction attribution=ambiguous: async runner alone did not fix M6; earlier connection explanation was incomplete. Headless login/close probe reports zero SSE before/after; now observe real Bob connected count until zero before closed-recipient suite, without changing inherited tests. M3 DOM-detach timeout retained and eligible for brief best-of-three timing retries. evidence=m7/check-close.log,m7/regression-fourth/,m7/guide-connected.txt
1789177200 M7 suite green including all seven previously-green suites. M6 precondition observed stream drain to zero after approximately 30s, then unchanged suite passed; earlier async-closure causal claim superseded by observed transport-liveness lag. source=diagnostic attribution=ambiguous evidence=m7/acceptance-fifth.log,m7/regression/results.json,m7/regression/m6-precondition.json
1789177275 correction loop attribution=agent-error: choreography live tallies and offline delivery succeeded, but settled vote stayed busy because UI treated retained outbox work as queued. Use durable entry.state===queued instead; committed/rejected/expired ledger entries are not pending. source=package react-core.d.ts,store/outbox.d.ts evidence=m7/choreography.log,src/Polls.tsx
1789177346 M7 choreography green after pending-state correction; final typecheck and Hermes export pass. Diary and closing essay written before final tally. evidence=m7/choreography-second.log,m7/typecheck-pending-fix.log,m7/hermes-final.log,m7/diary.md,m7/essay-paragraphs.md
1789177346 exact server process trees recorded evidence=m7/server-pids.json PIDs=[2026223, 2026276, 2026277, 2026284, 2026285, 2053317, 2053398, 2053399, 2053698, 2053699, 2053706, 2053712]
1789177369 exact-PID server cleanup completed; no pattern kills evidence=m7/server-cleanup.json
1789177435 final coverage/hash/snapshot audit passed; diary and essay precede tally; status=green evidence=m7/final-report.md,m7/final-report.json
end=1789177435

</evidence-file>


<evidence-file path="/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/m7/final-report.md">
# M7 final report

Status: **green**. Lane astra-clique-snapback2; model gpt-6-astra; effort=medium; backend=snapback2-0.0.25.

Raw start epoch: **1789176401**. Raw end epoch: **1789177435**. Wall: **1034 seconds**.

Implemented group poll composition, live member tallies, changeable idempotent votes, offline queue presentation, and a required conversation messageCount displayed in settings. Counts include polls and exclude tombstones and scheduled expiry. API and upgrade instructions are documented in the lane README/API.

## Acceptance and evidence

- `npm run acceptance -- --milestone m7`: **pass**, all six suite-required assertion IDs covered. [Suite](suite-m7.json), [coverage](coverage-m7.json), [passing run](acceptance-fifth.log).
- Frozen choreography, **M7 as the sole selected segment**: **pass**, both required assertions. The live assertion retained all three actor/option attempts; the offline vote queued, arrived once, and cleared pending. [Passing output](choreography-second.log), [summary](choreography-summary.json), [all attempts](choreography.jsonl). The summary's suite SHA-256 matches the current suite receipt.
- Previously green suites **M1, M2, M3, M4, M5, M6, M8: all pass**. [Regression results](regression/results.json). Their inherited assertion implementations were not repaired. Earlier failed attempts remain under regression-first, regression-second, regression-fourth, and the acceptance logs; the final regression pass needed one attempt per suite.
- Schema certification passed for both migration stages. TypeScript passed after the final UI correction. Final iOS Hermes export: [artifact verification](artifact-verification.json), [export log](hermes-final.log). No iOS simulator claim on Linux.
- Scheduled text-plus-poll expiry reduced a count from two to zero: [expiry proof](expiry-proof.json). Independent persona/API count reconstruction passed: [count verification](count-verification.json).

## Migration and preservation

The pre-M7 schema **already carried count structures**: messageCounts and deletion-aware liveMessageCounts (plus author-specific counts). It did **not** have conversations.messageCount. A new optional count column and poll fields/tables were installed by a schema successor; the system backfill wrote both existing conversations; a second successor made the count required with zero null/affected rows. [Predecessor schema](pre-schema.q), [optional successor](successor-optional.json), [backfill receipt](backfill.log), [required successor](successor-required.json).

A fresh backend was seeded through the app's m1/m2/m3 seed commands. The previous main runtime was retained under inherited-runtime and never used as this migration's database; the scale databases were not used. Before product/schema edits, eight independent persona-token custom clients exported the M6 field manifest. Exact normalized pre/post comparison passes for **8 personas, 2 conversations and 15 unique messages**. [Pre snapshot and hashes](pre-snapshot/manifest.json), [post snapshot](post-snapshot/manifest.json), [comparison](snapshot-comparison.json). Tokens are not included in exported files. Comparison was captured immediately after backfill, before acceptance mutated application state.

## Correction loops and attribution

- **environment / agent setup:** initial background launch did not survive its shell; relaunched through a persistent foreground session. All actual server trees were recorded. Initial file-path guesses were corrected with file discovery.
- **agent-error:** the initial PID filter also matched the controller's lane argument; it was excluded before any cleanup. Exact recorded server trees, rather than pattern matching, governed termination.
- **ambiguous test/transport lifecycle:** M6 push checks failed while a preceding Bob stream remained reported connected. Initial parent-client and synchronous-subprocess explanations were incomplete; those claims are corrected in the log. Measuring the public connected predicate and waiting until zero satisfied the unchanged test's precondition. [Connection samples](regression/m6-precondition.json), [isolated passing M6](m6-isolated.log).
- **agent-error:** an ad-hoc connection diagnostic used invalid Quarry range syntax (E_QUARRY_SYNTAX); the final diagnostic takes one principal and returns its connection count. No product schema or stored data was changed by these refused diagnostics.
- **agent-error:** a settings assertion sampled the initial cached count before its live update; it now waits for the semantic value. [Failed attempt](acceptance-third.log).
- **ambiguous timing:** an unchanged M3 quote click detached during one regression run. That failure is retained; later unchanged runs passed. The M7 runner permits up to three attempts only for timing failures, per the global ruling.
- **agent-error:** the first choreography proved vote delivery but caught a busy marker retained after commit. The UI now tests queued entry state rather than the existence of a retained outbox ledger entry. [Failure](choreography.log), [correction pass](choreography-second.log).

No capability failures or unexpressible required platform feature were encountered. Incidental syntax/test failures were correction loops, not milestone capability failures. No inherited product failure was repaired under M7.

## Limits and gaps

- This is the prescribed starter-state migration, not a scale migration. The starter message snapshot contains **0 populated media references and 0 messages with reactions**; preservation checks for those absent message fields are therefore vacuous. Populated message fields, quoted replies and persona-specific receipt states were compared exactly; prior media/reaction suites also pass.
- The phase does not supply native simulator execution. It supplies an iOS Hermes build and web interaction evidence.
- Poll vote enumeration uses the inherited 50-member group envelope. Membership churn exceeding 50 distinct voters on one poll was not exercised.
- Regression requires a running owner/web server and this lane's migration snapshots. Its disconnected-recipient check explicitly waits for transport liveness to clear.

[Diary](diary.md) and [closing essay](essay-paragraphs.md) were written before this tally. [Run log](run-log.md) retains timestamped lookup, error and correction evidence. Only ports 53200 and 53201 were used. [Recorded server PIDs](server-pids.json) were stopped with exact-PID cleanup; no pattern kills were used. [Cleanup](server-cleanup.json).

end=1789177435

</evidence-file>
