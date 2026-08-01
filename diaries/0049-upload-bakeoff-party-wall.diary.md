# Diary 0049: Upload bakeoff — Party Wall (App B), five arms

**Demo:** `demos/upload-bakeoff/party-wall/` (LLP 0139 App B)
**Author:** Claude (Fable 5), the session that built the LLP 0044 pipeline
— bias disclosed; per-arm evidence is scripted and printed by each
driver. Checklist frozen in the app README before any arm. Realtime
measurements are per-mechanism pushes with polling disabled or provably
absent; latencies are local-vs-cloud where noted and never compared as
like-for-like.

## 2026-08-01 — snapback, arm 1, PASS (8/8)

The backend is the flagship demo's three files, copied verbatim — this
app IS demos/party-wall, disclosed up front. Driver friction was mine
(the session userId lives at `credential.session.userId`; my first guess
was wrong; precise validation problems from the client made both driver
bugs one-look fixes).

- **Live burst:** `transport: 'stream', fallbackToPoll: false` — five
  posts arrived as WebSocket `live_replace` frames in **20–22 ms** from
  mutation; thumb readiness arrived over the reserved
  `_snapback.assetRecord` projection on the same socket; zero polls.
- **Revocation is the headline:** `leaveEvent` blanked the member's
  subscription in **18 ms** via the witnessed authorization lane, and
  byte delivery 403'd on the next request. Nothing else measured today
  revokes both the feed AND the bytes, pushed, transactionally.
- **Delete:** post delete dropped from the feed in 18 ms; bytes 403 for
  members immediately; unreferenced photo follows the declared 61 s
  reference-GC grace.
- **GPS:** stripped on the served thumb (strip-declared intent; the
  platform refused to let the intent not decide).
- Outsider: empty wall, 403 bytes, 400 signed-out (strict is
  deliberately not pasteable; the pasteable profiles exist separately).

## 2026-08-01 — convex, arm 2, PASS (shared deployment, disclosed)

Official path end to end; live feed via `ConvexClient` websocket
subscription. **Shared-deployment disclosure (0102 amendment):** my
deploy replaced the deployment's function set (union-deployed App A's
functions to keep its arms alive); later the same day Lane β's Clip
Locker deploy replaced mine and dropped App A's index — see
`issues/20260801-bakeoff-convex-deployment-is-not-namespaceable.md`.
My evidence was collected while my functions were live; the deployment's
current state does not carry them.

- **Live burst:** ~**140 ms** pushes (cloud RTT included) — the
  subscription model (server re-runs the query, pushes results) is
  clean and the client API is pleasant.
- **Revocation, the sharpest field finding of the day:** removing the
  member re-ran the gated query and pushed `[]` in **120 ms** — but
  **already-learned file URLs kept serving (200)** after leaving, and
  after row-only deletion the stored file stayed fetchable until app
  code called `storage.delete`. Feed access and byte access are two
  different authority systems and only one of them hears about
  membership.
- **GPS served in originals** (no derivative pipeline at all — feeds
  serve the uploaded bytes); anonymous fetch of a member URL: 200 by
  documented capability-URL design.
- No auth provider on this deployment, so membership is advisory
  app logic over caller-supplied identity strings — posture recorded,
  not judged as the product's auth story.

## 2026-08-01 — supabase, arm 3, PASS (shared project, cleanup proven)

The heavyweight arm: 3 tables + 7 row policies + 2 storage policies +
realtime publication membership, applied over the direct pg connection.

- **The RLS recursion trap cost the most wall-clock of the day:** my
  membership-read policy referenced its own table, and *every* policy
  touching membership then recursed — surfaced not as Postgres's 42P17
  but as the storage API's `DatabaseInvalidObjectDefinition` 503,
  three services away from the mistake. The canonical fix (SECURITY
  DEFINER membership function) is documented folklore; nothing warned
  at policy-creation time. Diagnostics-quality note: worst
  distance-from-cause measured in the bakeoff.
- **Live burst:** postgres_changes over websocket, ~**330 ms** pushes
  (first 839 ms), **RLS enforced per delivery** — after membership
  removal, new inserts were provably NOT delivered to the revoked
  subscription. Genuinely strong authorization-realtime integration.
- **But the storage path lagged revocation:** the next *query* was
  empty and new frames stopped, yet a byte fetch **served 200
  immediately after membership removal** (Snapback's per-request check
  refused in 18 ms on the same test shape). One more revocation
  surface than the field's mental model has.
- **Delete is two systems:** the row delete pushed a DELETE frame in
  594 ms (old-row identity only under RLS); the object needed its own
  explicit storage delete.
- GPS: served in originals; the transform endpoint re-encode drops it
  as a side effect (same shape as App A).

## 2026-08-01 — pocketbase, arm 4, PASS (local binary)

- **Live burst: 1 ms SSE pushes** (local, honest caveat) and — better —
  **rules are re-checked per delivery**: the revoked member's
  subscription provably received nothing new. For a single binary with
  zero infra, the realtime-authorization integration embarrassed two
  cloud arms.
- **But bytes are outside the rule system entirely:** file URLs served
  the outsider, the signed-out fetch, and the revoked member alike
  (public-by-URL default; `protected` is opt-in per field). Record
  rules gate metadata; possession gates bytes.
- Record delete removed the file with it (URL 404) — cleanest
  delete-fate again.
- **Trap for the diary:** PocketBase auto-writes `pb_migrations/` into
  the CWD and replays them into every "fresh" instance — my first
  failed run's collections resurrected into three subsequent "clean"
  data dirs until I pinned `--migrationsDir` into the temp dir.
- GPS: originals serve it; `?thumb=` re-encode drops it.

## 2026-08-01 — firebase, arm 5, ACCESS GAP (both halves)

Storage remains unprovisioned (App A's Blaze-cliff finding) and this
project's Firestore rules deny client writes (console-owned; no rules
deployment possible with these credentials) — so even the
metadata-liveness half gapped. Recorded per the 0102 amendment as
environment evidence. The structural finding stands regardless: a photo
feed on Firebase is **two products with two authorization models**
(Firestore rules + Storage rules) **plus a billing-plan gate** before
the first byte.

## The comparative tables

**What "live" actually is, and revocation truth:**

| Arm | Push mechanism | Burst push | Feed revoked | New frames after revoke | Bytes after revoke |
| --- | --- | --- | --- | --- | --- |
| snapback | WS live_replace + witnessed auth lane | 20–22 ms local | pushed blank, 18 ms | none (subscription dead) | **403 next request** |
| convex | WS query re-run push | ~140 ms cloud | pushed `[]`, 120 ms | n/a (query gates) | **200 — learned URLs live on** |
| supabase | WS postgres_changes | ~330 ms cloud | no retraction; next query empty | **not delivered (RLS per delivery)** | **200 immediately after leave** |
| pocketbase | SSE | 1 ms local | no retraction; next query empty | **not delivered (rules per delivery)** | **200 — public by URL** |
| firebase | (gap) | — | — | — | — |

**Bytes-vs-metadata authority (the field's recurring split):** Snapback
is the only arm where feed authority and byte authority are one system
(the sharing declaration) — every other working arm has at least one
surface (learned URLs, storage lag, public files) where bytes outlive
the membership that justified them.

## Snapback frictions → tickets

None new this app. The two driver-side stumbles (userId path; raw
delivery-URL guessing, already guide-covered) repeated App A's; the
0048 note stands. The realtime API surface (`transport`, `fallbackToPoll`,
`onUpdate`) did exactly what the checklist needed with no reading beyond
the acceptance suite.

## Cross-arm process notes (0102 disclosures)

Convex shared-deployment interference disclosed above and ticketed.
Supabase namespace cleanup proven (bucket absent, users removed, tables
dropped via cleanup.sql; the security-definer helper dropped with them).
PocketBase and Snapback arms were fully local; Firebase touched only
namespaced auth users (removed) and attempted namespaced doc writes
(denied).

## 2026-08-01 — Round 2, Snapback arm rerun (fresh-context builder)

Purpose: measure whether the post-round-1 fix wave helped. Method: a
fresh-context builder (no diary/issue/round-1-arm access, and — unlike
round 1 — no `demos/party-wall` access either: it authored the entire
membership/sharing/live backend from the guide alone) rebuilt this
app's Snapback arm against the frozen checklist; a full-context
verifier reran its driver end to end and wrote this entry. Builder
commit `78120ce4`; arm `demos/upload-bakeoff/party-wall/snapback-r2/`.

**Verification: confirmed.** Driver rerun 8/8, exit 0 in the verifier's
own run. Spot-checks held: leave → live blank pushed in 17 ms as an
`authorization_quarantine` frame (builder observed 19 ms — ordinary
variance) with bytes 200→403 on the next request; delete left the live
feed in 14 ms; the GPS-tagged upload served thumb and primary bytes
GPS-free.

**Headline: 8/8 on the first driver attempt, fresh-authored, ~10 min.**
Round 1's Snapback arm copied its backend verbatim from
`demos/party-wall` (disclosed at the time — round 1 measured nothing
about authoring this backend); round 2's builder wrote schema,
membership grammar, sharing declaration, upload intent, and six
operations from the guide in 4:42 to a first-attempt-clean codegen and
~8:30 to a fully green checklist. Zero failed codegen runs, zero failed
driver runs, zero product diagnostics hit in anger. The freshness
confound therefore cuts the opposite way from a normal rerun: the
*stronger* condition (no prior backend, no repo context) produced the
*better* result.

**Latency vs round 1:** burst visibility 30–36 ms post→visible /
43–49 ms upload→visible (round 1: 20–22 ms `live_replace` deliveries —
different measurement points, same order of magnitude); revocation
blank 17–19 ms vs 18 ms; delete 14 ms vs 18 ms. No regression; the
witnessed lane (`authorization_snapshot`/`authorization_quarantine`)
now carries the auth-scoped feed end to end.

**Round-1 frictions, dispositioned:** both round-1 stumbles (the
`credential.session.userId` path guess and raw delivery-URL guessing)
are **GONE** — the sessions persona recipe and the assets §Deliver
routes landed in the docs sweep, and the builder minted three personas
and fetched bytes without a single wrong guess.

**New frictions (all docs-shaped, none product):** (1) the assets page
named a `client.assets.start` accessor that does not exist — the real
surface is `createAssetClient(client)` from the `/assets` entry (guide
fixed in this entry's landing); (2) the one-boot
`startServer({ startupArtifacts, captureImpersonationCapability })`
provisioning form was undocumented — found only inside a transcluded
example (sessions guide now documents it); (3) byte-identical burst
fixtures silently dedup to one blob — by design, now documented with
byte-distinct fixture guidance, alongside the also-undocumented-but-true
attach-before-ready behavior the builder verified by experiment;
(4) the live-queries page's `meta.kind` list omitted the witnessed-lane
kinds (`authorization_snapshot`/`authorization_quarantine`) that
membership-gated feeds actually deliver (page fixed); (5) signed-out
byte fetches return 400-before-401 by protocol-offer design — real,
kept as an open docs ticket
(`issues/20260801-guide-gap-signed-out-byte-fetch-is-400.md`).
Environmental, not product: the dirty-checkout binary-identity skip
cost a 33 s cargo first boot (same class as faceplate round 2; the
recovery is self-describing).

**Verdict for App B: the fix wave helped decisively.** Both round-1
frictions eliminated; a strictly harder authoring condition produced a
first-attempt-green build in a quarter of round 1's wall-clock; every
new finding is documentation, and four of the five were fixed in this
same landing.
