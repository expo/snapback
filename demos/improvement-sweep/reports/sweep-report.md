# LLP 0137 Phase 1 — improvement-sweep report (Stage 6 synthesis)

**Date:** 2026-08-01.
**Authority:** [LLP 0137](../../../llp/0137-react-web-backend-championship.plan.md),
Stage 6. **Baseline under test:** the public `@expo/snapback-*` 0.1.7
closure, consumed as an external npm user. **Phase 1 froze no Snapback
revision**; every capsule pins the exact package versions its arm ran
against, and every fix cited below is on `main` awaiting the next release
cut (0.1.8) unless stated otherwise.

This report produces **no backend ranking, no composite, and no
win/lose claim** (LLP 0137, "Improvement evidence, not ranking
evidence"). Its five deliverables: the gap ledger, the longitudinal
comparison, the differentiator inventory, the prioritized improvement
program, and the dated dry-well assessment.

## What ran

| Piece | Result | Evidence (under `demos/improvement-sweep/`) |
| --- | --- | --- |
| G1 qualification | complete, 6/7 (gap → g1-f5, fixed) | `arms/g1-*/` |
| A2 web (calibration) | 11/12 pass, 1 GAP | `arms/a2-*`, Diary 0042 |
| A1 web | 10/13 (1 fail, 1 GAP, 1 refusal) | `arms/a1-*web`, Diary 0043 |
| A3 web | 12/12 pass | `arms/a3-*`, Diary 0044 |
| A4 web | 9/11 (2 fail) | `arms/a4-*web`, Diary 0045 |
| A5 web | 11/13 (1 fail, 1 GAP) | `arms/a5-*`, Diary 0046 |
| A6 web | 10/10 pass | `arms/a6-*`, Diary 0047 |
| A1 Expo iOS | 7/10 (2 GAP, 1 fail) | `arms/a1-snapback-expo-ios/` |
| A4 Expo iOS | 8/12 (3 GAP, 1 fail) | `arms/a4-snapback-expo-ios/` |
| Firebase A1 probe (Stage 3) | 5 dimensions | `probes/a1-firebase-web/` |
| Track C (Exact) | program GAP, 4 unready gates | `arms/a1-exact-*/` |

**52 findings** were filed (every one with the seven LLP 0137 ledger
statements in `arms/*/findings/*.json`), **21 already fixed on `main`**
by the between-arms fix loop, **zero Stop-class defects** anywhere,
including the probe. Track B's Android halves did not run: the two Expo
arm *pairs* LLP 0137 commissions are half-complete (iOS receipts only),
recorded as an honest program GAP — an iOS pass establishes nothing
about Android under LLP 0064.

## 1. The gap ledger

Machine-readable index with dispositions:
[`gap-ledger.v1.json`](./gap-ledger.v1.json). Organized here by the ten
frozen dimensions; each headline names its dedup group.

**Release-vehicle note (applies to every "fixed" below):** external
consumers cannot see any of the 21 fixes until a 0.1.8 closure ships;
0.1.7 remains the pinned baseline the arms measured. Cutting and
re-verifying 0.1.8 is the improvement program's first item.

### Installed-product first hour

- Scaffold's own template generates a degraded-result advisory (g1-f1,
  open). Raw reset vs versioned-seed collision wedges the next dev
  start (a2-f7, open). Anonymous public reads impossible from the
  packaged client outside a browser (a4-f6, open — longitudinal repeat
  from Diary 0030). Expo entry needed an undocumented WebCrypto
  polyfill (a1expo-f1, fixed).

### TypeScript inference and contract fidelity

- Generated `api.ephemeral` references rejected by the React binding
  over a version-stamp mismatch between two of our own codegen
  consumers (a2-f2, fixed).

### React reactivity and lifecycle

- Presence room permanently wedged whenever the provider owns live
  queries — the first-party React path could not reach the product's
  showcase feature (a2-f1, fixed). No offline surface on hooks
  (a1-f5, fixed: `freshness`/`retention`/outbox projections). Live
  subscriber wedged the watch-reload evolution loop (a3-f5, fixed). RN
  carrier cycles live→stale every ~2s (a1expo-f7, author-gated deep
  diagnosis — needs a simulator-equipped lane).

### Relational composition and aggregates

- "Channels I belong to" inexpressible against a resource-scoped
  membership declaration (a2-f3, design decision). Bounded keyset verbs
  (`.lt/.gt/.take`) absent from the packaged `ctx.db` — a **regression
  vs Diary 0034's repo-main evidence** (a2-f5, open). Generated keyset
  pages accept only owner partitions, so the org board cannot use the
  safe pagination path (a3-f7, design decision).

### Retained offline and reconnect settlement

- Web floor: retention is per-query opt-in and was undocumented
  (a1-f4, fixed); pending outbox blanked the retained render (a1-f6,
  fixed with the retained-pre-intent presentation); protected retained
  reads remain the already-owned lease-custody GAP (a2-f8,
  owned-elsewhere). Mobile floor: no durable on-device store — every
  Expo client silently runs in-memory (a1expo-f3, **open, the largest
  mobile gap**); the offline queue could never engage on RN's fetch
  error class (a1expo-f2, fixed); reset-install stranded connected
  clients with no recovery surface (a6-f3, fixed).

### Authorization and revocation

- No admin revocation of another member under the v1 private roster
  (a2-f4, design decision). Membership tables cannot be seeded, so
  fixture resets cannot retire authority (a3-f1, design decision).
  Filter-vs-deny split between the two membership idioms undocumented
  (a1-f7, open). Auth refusals collapsed through the action boundary
  (a4-f5, fixed). Downgrade rotation wedged live handles on Expo
  (a1expo-f4, fixed). Dev shutdown orphaned a secret-shaped sidecar
  (g1-f5, fixed).

### Conflicts, jobs, effects, and ambiguity

- **Outbound actions were unauthorable on 0.1.7 in every form** — the
  sweep's single worst product fact (a4-f1 + a5-f1, fixed:
  `f2b237ee` + plain `ctx.fetch` in `117dcae2`). everyMs catch-up ran
  at epoch-0 trusted time (a4-f4, fixed). `defineJobStatusQuery` made
  the whole app unbootable (a6-f1, fixed). App refusals collapse to
  `SNAPBACK_HANDLER_FAILED` (a3-f3, author-gated design analysis).

### Assets, text search, vector retrieval, and notifications

- **The asset sharing chain**: an `assetRef` field made its table
  unqueryable (a1-f1, fixed); attach admission not honored at commit —
  row attachment impossible (a1-f2, owned by the 0044 core lane, open;
  Diary 0048's Faceplate arm attached successfully on repo `main`, so
  the repair may already exist unrecorded — the 0.1.8 re-verification
  settles it); the packaged asset client cannot authenticate sessions
  (a1-f3, open); schema-module intents silently dropped (a1-f8, open);
  `text/plain` accepts can never finalize (a1-f10, open); documented
  pasteable delivery lanes absent from the packaged runtime (a4-f3,
  open). Membership-visible search inexpressible (a3-f2, design
  decision). Vector retrieval remains an honest GAP with an Accepted
  design (LLP 0132). No mobile push boundary (a4expo-f1, open,
  sequenced behind the now-fixed egress lane).

### Hosted deployment and operations

- No hosted path for a mobile Snapback app: sessions routes and
  production email delivery are local-target-only (a1expo-f5, open,
  program-level — LLP 0045/0072/0129 lines). Web-arm hosted evidence
  was out of scope for these local-target arms (G2 posture recorded per
  capsule).

### Diagnostics, documentation, agent usability, and escape hatches

- The dominant open category by count. Fixed: `snapback dev` swallowing
  failure envelopes (a4-f2), the misattributed evolution refusal
  (a3-f4), the stale react-expo guide page (a1expo-f6), jobs custody
  guide page (a6-f2). Open guide gaps: sessions test-persona recipe
  (a2-f6), versioned-seed sessions recipe (a1-f9), sessions schema
  evolution path (a3-f6), config API shapes (a4-f7 — 0102-epoch
  repeat), `inline_handler_v1` subset (a5-f3), `v.array` diagnostic
  naming `v.json()` (a5-f2), authoring-loop page still hedging the
  shipped public closure (g1-f2), deep-link scheme approval recipe
  (a4expo-f2), runtime-readiness receipt documentation (g1-f4), and the
  run-capsule schema's inability to represent G1 (g1-f3 — a G0
  prospective-amendment debt this program owes itself).

### Synthesis distinctions (per LLP 0137)

- **Table stakes still missing:** durable on-device store (mobile),
  asset *sharing* (attach → query → deliver → paste), mobile push
  boundary, anonymous public client, membership-scoped
  search/pagination.
- **Repeated first-hour/daily-loop friction:** sessions recipes
  (personas, seeds, evolution, config) — five separate guide gaps with
  the same shape: the capability exists, the recipe is unwritten.
- **Breadth gaps exposed by one advanced app:** vector retrieval (A5,
  owned by LLP 0132); recurring + one-off scheduling observability
  (A6, jobs guide now landed).
- **Differentiators worth amplifying:** section 3.
- **Maturity/ecosystem gaps code cannot close:** hosted mobile,
  physical-device receipts, Android receipts, Exact Native carrier
  (Track C gates).
- **Mobile-only findings:** the entire a1expo/a4expo family — the
  mobile floor is where the product story is thinnest.
- **Architectural rethink triggers: none.** Every finding has a
  smallest-coherent-fix inside Snapback's existing authority,
  settlement, local-first, target, and capability model. No arm asked
  for a Convex-shaped, Supabase-shaped, or Firebase-shaped subsystem.

## 2. Longitudinal comparison vs the frozen LLP 0102 record

The frozen record: Snapback ranked 7th of 7 at 62.84 (practical tie
with Appwrite at 63.16), with the deficit concentrated in "missing
offline, assets/search/vector, hosted deployment, external-package
lifecycle, and maturity — not in authority or settlement correctness"
(`demos/backend-bakeoff/reports/final-report.md`). This sweep is not
rank-comparable to that record (moving revision, by design) — but on
shared product facts:

**Reversed outright:**

- **Research room (Diary 0031).** The frozen Snapback arm was
  product-blocked at 1 pass / 2 GAP / 12 fail — sessions + streamed
  actions refused at cold start; verdict "Not for this application at
  the frozen commit." This sweep's A5: the same composition is the
  arm's *strongest* surface — 11/13 in a 5-second suite on the public
  closure, with attempt-custody settlement vocabulary
  (`effectMayHaveExecuted`, receipted fences) nobody in the frozen
  field matches, and a clean secret-custody story where the frozen
  Convex arm carried the program's only Stop-class defect.
- **Dispatch scheduling (LLP 0121).** The frozen verdict said
  transactional one-off scheduling would keep a Dispatch builder on
  Convex. A6 proved commit-atomic `ctx.jobs.enqueue` with
  `enqueues` facts on receipts, injected-clock drains, and append-only
  attempt ledgers — from public npm, with receipt-level producer
  association Convex does not offer.
- **External-package lifecycle.** 0102's final confirmation ran from
  repo source; this entire sweep ran from the public registry behind
  G1's byte-audited publication ledger.

**Improved:**

- **Assets (Diary 0030):** wholesale GAP → a real
  upload/rendition/strict-delivery/deletion/revocation lifecycle with
  transactional revocation-on-replace (owner lane) — but the *sharing*
  chain (attach → query → deliver) is broken on 0.1.7 (a1-f1/f2/f3).
- **Web offline floor (Diary 0027 bar):** queued durability + ordered
  exactly-once replay now exceed the frozen bar's evidence quality;
  retained *protected* reads remain behind it (honest GAP, lease lane).
- **Chat (Diary 0028/0034):** native zero-durable-amplification
  presence where frozen Convex had two GAPs; 33–37 ms push vs the
  frozen Convex 40 ms median; 12-check suite in seconds.

**Regressed (both caught and fixed on main during the sweep):**

- The outbound effect lane: the frozen 0102 Snapback arm could author
  fetching actions; packaged 0.1.7 could not (a4-f1) — fixed.
- Bounded `ctx.db` verbs: present in Diary 0034's repo-main rerun,
  absent from packaged 0.1.7 (a2-f5) — still open; the packaged closure
  is narrower than the repo surface the rerun measured.

**Repeated unchanged since 0102:** the unpaved anonymous public lane
(a4-f6) and undocumented config shapes (a4-f7) — both filed in the
0102 epoch, both re-paid by a public consumer this sweep.

## 3. Differentiator inventory (must-not-regress)

Consolidated from every arm's differentiator-watch, with the Firebase
A1 probe as the offline-floor contrast. These are the properties the
fix program must protect; each capsule carries the full entry.

1. **Settlement envelopes and receipts.** Structured mutation results
   (`result`, `changed_count`, `version`, receipt with
   `snapshotVersion`/`affectedTables`/`enqueues`) made idempotency,
   conflict, and dispatch evidence one-line assertions in every arm. The
   probe's contrast: Firebase has *no* receipt/changed-count/version
   envelope — idempotency is the author's job. Keep: closed envelope,
   one-commit-one-version.
2. **Push latency.** 33–37 ms cross-client web (A2), 33–42 ms to a real
   iOS device (A1 Expo), ≤122 ms for composed facts on-device (A4
   Expo), vs frozen Convex 40 ms median. Keep: sub-50 ms local-target
   delivery from the committed write set.
3. **Honesty surfaces.** `freshness: retained|current` as a first-class
   fact, refuse-with-clarity retention codes, `rqsStoreInfo`, honest
   connection axis. The probe found Firebase's entire honesty surface
   is one `fromCache` boolean — and it *silently falls back to an empty
   in-memory cache* when the persistence lease is contended, rendering
   an empty notebook with no degradation fact anywhere. Keep: no
   fabricated overlays, no silent degradation, retention refusals named
   on the handle.
4. **Custody boundary for protected data at rest.** Snapback retains
   protected rows only under lease custody; Firebase cold-retains
   protected rows for whoever holds the device profile, with rules
   unevaluated for cached reads. Keep: never protected bytes at rest
   without custody, uniform denials on every surface.
5. **Uniform non-disclosing denials.** Byte-uniform
   `SNAPBACK_AUTH_PERMISSION_DENIED` across read/subscribe/write/cursor
   surfaces, on web and on device, including post-rotation and
   post-logout probes — the strongest negative contract in any arm this
   program or 0102 recorded. Keep verbatim.
6. **Zero-durable-amplification ephemeral state.** Typed TTL/rate-
   budgeted presence with the durable version provably pinned across
   publishes (A2: 20 publishes, zero durable writes; A4: ten publishes
   under load). Frozen Convex needed durable rows + cleanup cron. Keep:
   the ephemeral lane never touches durable versions.
7. **Revocation-active live barriers.** Established handles blank
   ~1.7 s after authority change, then terminal-deny; later commits
   undelivered (A2, A4, both Expo arms). Keep: blank-then-deny ordering.
8. **Deep-link invitation flow (mobile).** OS-delivered `sweepshell://`
   link redeemed through one authority-creating transactional mutation
   (seat + consumed invite + attributed RSVP) — "the best mobile
   invitation flow I have tested" (Diary 0045). Keep: atomic attributed
   entry composing with OS delivery.
9. **Suite-loop velocity.** Full-contract acceptance suites: A1 6.6 s,
   A3 4.7 s, A5 ~5 s, A4 17.7 s, A6 seconds-class; the 10-check
   on-device iOS receipt suite in 61 s; A2's 12-check suite in seconds.
   Driven by the machine-readable dev lifecycle (ready descriptor +
   `snapback.dev.v1` events + stdin-close stop), ~100 ms session
   minting, injected-clock drains, and receipted versioned
   reset-install. Keep: the lifecycle protocol and deterministic seams.
10. **Deterministic ordering and sequences.** Commit-order `_version`
    gave deterministic message order, stable cursors, and correct naive
    sequence/capacity/fence logic with zero extra machinery (A2, A3,
    A4, A6). Keep: serialized commits, monotonic versions.
11. **Deterministic export and byte-audited packaging.** Byte-identical
    exports across reset/replay (A1); the publication ledger's triple
    hash match + `doctor`'s six-boundary qualification (G1) — no
    competitor offers an equivalent. Keep both.
12. **The 0031-reversal itself.** Sessions + `streamAttempt` +
    `fetchStream` on the public closure is now a differentiator;
    Diary 0046 asks for a packaged-closure conformance fixture so it
    can never silently regress.

## 4. The prioritized improvement program (0.1.8+)

Ordered by product impact; every item carries its acceptance witness in
the finding/ticket it cites.

1. **Cut 0.1.8 and re-verify.** All 21 fixed findings are invisible
   until released. Ship the closure, then run the fix-loop
   re-verification pass (dated diary entries + capsule reruns of the
   affected acceptance facts: A2 presence-beside-live-query, A4/A5
   egress, A6 job-status boot, A1 offline projections, Expo
   crypto/queue/rotation legs, G1 clean-finish).
2. **Close the asset sharing chain** (A4's and A5's verdicts hang on
   it): verify/close a1-f2 attach admission (0044 core lane owns it;
   Faceplate suggests it may already be repaired — record it), a1-f3
   sessions-authenticated asset client, a4-f3 pasteable delivery lanes,
   a1-f8 schema-module intent refusal, a1-f10 text detection. LLP 0139
   (Active) owns the competitive placement of the result and should
   inherit these tickets' witnesses.
3. **Mobile floor durable store** (a1expo-f3): an RN arm in the
   persistence ladder over the existing persisted-entry contract —
   the single change that makes Track B's A1 contract meetable — plus
   the a1expo-f7 connection-cycle diagnosis (needs a simulator-equipped
   lane; carrier-agnostic halves already audited).
4. **Push-notification boundary** (a4expo-f1): device-token
   registration + provider relay recipe, now unblocked by the egress
   lane fix; the app-side intent/attempt ledger pattern already proved
   the ambiguity discipline.
5. **Hosted mobile path** (a1expo-f5): sessions routes + production
   email/broker delivery reachable from a mobile client — LLP
   0045/0072/0129 program lines; keep the honest local-only claims
   until real.
6. **Membership expressiveness family** (author decisions, one design
   review): self-scoped seats projection (a2-f3), principal-addressed
   admin revocation (a2-f4), seedable membership fixtures (a3-f1),
   membership search visibility (a3-f2), membership keyset partitions
   (a3-f7). One coherent decision about what the private-roster posture
   licenses would settle all five.
7. **Author-gated diagnostics identity:** structured app refusal codes
   (a3-f3) and the bounded `ctx.db` verbs (a2-f5); then the open guide
   batch (sessions recipes ×5, inline-handler subset, `v.array`
   naming, authoring-loop refresh, deep-link recipe, readiness
   receipt) — highest count, lowest cost.
8. **Program debts:** G0 prospective amendment for the capsule schema
   (g1-f3) + re-freeze; Track B Android receipts; template polish
   (g1-f1); anonymous packaged client (a4-f6).
9. **Track C successor gates** (long pole, separate program): portable
   plan tier covering membership/JS-handler shapes, advanced authority
   pin, app-agnostic carrier onboarding, native asset surface
   (`gap-record.json` names all four with citations).

**Protection work threaded through all of it:** the packaged-closure
conformance fixtures the diaries ask for — presence beside live
queries, sessions + streamAttempt + fetchStream, attach-and-query,
60 s idle connection hold on RN — so the differentiator inventory can
never regress silently.

## 5. Dry-well assessment (dated 2026-08-01)

**The dry-well trigger does not fire. The well is still yielding.**

The trigger (LLP 0137, Phase 2): Charlie judges the backlog thin enough
that a ranking would outlast it — default signal: a re-verification
sweep across the six contracts producing no new table-stakes or
Stop-class findings. Today:

- One sweep epoch produced 52 findings; 31 remain open, including
  table-stakes capabilities (asset sharing, mobile durable store, push
  boundary, hosted mobile, membership expressiveness).
- No re-verification sweep has run at all: the closure containing the
  21 fixes does not exist yet (0.1.8 uncut), so the default signal
  cannot even be evaluated.
- Track B is half-run (no Android receipts) and Track C is gated —
  Phase 2's mobile and Exact legs would rank an incomplete surface.
- Encouraging, and worth recording: **zero Stop-class findings** across
  nine arms and a probe, zero architectural rethink triggers, and three
  frozen-epoch verdicts (Diary 0031, LLP 0121, external-package
  lifecycle) reversed on the merits. The improvement program is
  converging — the well yields fixes, not redesigns.

**Reassessment condition:** after 0.1.8 ships, the re-verification pass
lands, the asset chain closes, and the mobile durable store exists, run
the next sweep epoch (or a targeted re-verification across all six
contracts). If that epoch produces no new table-stakes or Stop-class
findings, bring this assessment back to Charlie with a
championship-freeze proposal. Until then, Stage 7 stays deferred.

## The fix-loop stream

21 closed 0137 tickets (in `issues/closed/`), 31 open 0137 tickets +
Track C gate + assistance-policy ratification (in `issues/`). Fix
commits on `main` (between-arms lanes, all post-0.1.7): `cf665e2b`,
`b1006fa2` (A2 React/codegen); `c40dbd1a` (A1 offline
projection/docs); `b34c5df5`, `d6ae72cb` (assetRef contracts/watch);
`812b5bd8`, `c50c9a58` (A3 evolution); `f2b237ee`, `117dcae2`,
`7437e6e0`, `bdf4763c`, `2e9ef1b0` (A4 egress/diagnostics/cron);
`01ddd8e2` (A6 jobs/custody/terminal-auth); `e1f9ac49` (Expo lane);
`37764b2e` (G1 sidecar); plus guide/LLP companions (LLP 0107 journal,
LLP 0129 revision, jobs guide page).

**LLP 0139 fold (landed concurrently, cited never rewritten).** The
file-upload bakeoff's synthesis
(`demos/upload-bakeoff/reports/summary.md`, commit `10071fa4`) owns
the asset field's competitive placement. Its per-axis calls place
Snapback first on upload robustness (the only protocolized-resume
arm), privacy defaults ("alone in the field": mandatory EXIF/GPS
decision, nothing serves anonymously), authorization depth, realtime
integration, deletion truth, operational surface, and diagnostics;
mid-field on ceremony (6 concepts / 3 files + codegen vs PocketBase's
zero-file floor and Convex's three steps); and it found one real
defect — the policy gate's 2 MiB inspection ceiling 413'd the
client's own TUS chunks on the first 120 MB video — ticketed and
fixed in a parallel landing. Its steal tickets (queryable
sha256/size, thumbs-by-URL ergonomics, ceremony floor) join this
report's improvement program at item 2's asset chain; its Faceplate
arm (Diary 0048, repo posture, 8/8 with GPS-strip-by-default,
transactional revocation-on-replace, 199 ms to served bytes) is the
repo-side evidence that the sharing chain's remaining breaks are
packaging-and-closure work, not design work.

## Honesty notes

- Probe and frozen evidence are labeled with source and date
  everywhere; the frozen 0102 composite is quoted as frozen history,
  not re-scored. This sweep's arms are not rank-comparable to it or to
  each other (moving revision, by design).
- The five finding files using drifted dimension/classification
  vocabulary are preserved as written; the ledger normalizes with a
  note (see `gap-ledger.v1.json`).
- Diary 0048's Faceplate arm ran from repo workspace packages, not the
  public closure; it is cited only as repo-posture evidence.
- Budgets: every arm finished inside its ceiling; G1 ran untimed as
  prescribed. No assistance events beyond the recorded ones in
  capsules; posture breaks are enumerated per-capsule.
