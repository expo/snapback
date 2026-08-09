# LLP 0208: Clique pilot capability-gap closure

**Type:** Plan
**Status:** Draft
**Systems:** Auth, React client, Offline/outbox, Diagnostics, Search,
Schema, Memberships, Assets, Push, Relational queries, Operations, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-09
**Related:** LLP 0201 (the benchmark this evidence comes from), LLP 0197
(publication standard), LLP 0198 (surpass-Convex plan — this is direct
evidence against its victory conditions), LLP 0193 (errors-as-docs
completeness), LLP 0107 (optimistic lifecycle), LLP 0151 (first-party
identity — Wave 4 program), LLP 0043 (offline replay retention), LLP 0073
/ LLP 0136 (search), LLP 0080 / LLP 0120 / LLP 0157 (relational and
aggregation), LLP 0056 / LLP 0100 (memberships), LLP 0044 / LLP 0180
(assets), LLP 0143 / LLP 0045 (push), LLP 0036 (app config), LLP 0108
(inline handler dialect), LLP 0061 (guide), LLP 0189 (verification
cadence)

## Summary

The LLP 0201 P2 pilot built **Clique** — the canonical social-messenger
benchmark app (WhatsApp × Twitter: accounts, feeds, group messaging,
media with view-once, disappearing messages, search, offline, push seam,
a 166k-action scale replay, and a blind day-2 evolution session) — on
Snapback 0.1.15 end to end. It produced the richest single body of
builder evidence the platform has: a milestone diary, a fresh-engineer
M7 diary, a timestamped run log, a scored B1–B11 rubric, and a
qualitative closing essay, all written under the instrument's sequencing
rules.

This Plan converts that record into a prioritized gap register and
closure program. The headline findings it responds to:

- **Auth is the single biggest score floor** (B2 = 48): no password
  credentials, no production mail adapter, an undocumented session-mint
  HTTP shape, and no client-arm logout for external-bearer custody.
- **The durable outbox's silence caused the worst hours of the run**
  (holistic-cited moment), and the sibling trap — a durably-queued
  mutation whose settlement promise *rejects* — was **independently
  rediscovered blind** by the M7 engineer. Convergent evidence from two
  mutually-blind sessions is the strongest signal this pilot can emit.
- **Diagnostics are bimodal** (B10 = 55): refusal-path errors approach
  the 90 anchor while runtime handler errors and client-side failure
  modes (resubscribe storms, silent queueing) are 30-grade bisection
  zones. This is the same shape LLP 0207 named ("the no-refusal failure
  layer") before its dissolution to owners; the pilot supplies the
  concrete cases.
- **The strengths are real and must not regress:** live watch-reload
  additive migration (B8 = 90, "Snapback's strongest card"),
  idempotent-by-clientKey crash recovery at 166k-action scale, honest
  capability GAP rows changing designs *before* runtime, and the served
  build-bound guide.

Pilot record: `/Users/ccheever/clique-runs/p2-pilot/snapback-lane/`
(essay.md, diary.md, scores.md, run-log.md, clique/m7-diary.md,
clique/m7-log.md). Per repo convention the diaries land under `diaries/`
and the pilot record under `benchmarks/records/` at P2 close-out, once
all three lanes finish; this Plan cites the moments it needs directly so
it does not block on that landing.

Scores for orientation (builder-scored, pilot, not claim-eligible):
B1 72 · B2 48 · B3 78 · B4 55 · B5 62 · B6 55 · B7 58 · B8 90 · B9 68 ·
B10 55 · B11 74 · holistic 72.

## Method and priorities

Gaps are tiered by (score leverage × fix cost), not by subsystem:

- **Tier 1 — defects.** Wrong behavior in a published release. Fix
  regardless of roadmap.
- **Tier 2 — diagnostics dead zones.** The two failure modes that
  produced hours-long bisection with zero platform signal. Highest
  leverage per line of code.
- **Tier 3 — missing capabilities.** Score ceilings for the social-app
  class. Larger lifts; several belong to already-commissioned programs
  and this Plan feeds them evidence rather than duplicating a lane.
- **Tier 4 — papercuts and docs.** Cheap, mostly guide-shaped; several
  are one-line API affordances discovered by probing.

Each gap names its evidence (score dimension + recorded moment), its
proposed closure, and its owner — the governing LLP or existing
`issues/` ticket where one exists. Where an open ticket already covers a
gap, this Plan escalates or annotates it instead of forking a duplicate.

## Tier 1 — defects

### G1. Typed `client.search()` refuses its own release's generated references

- **Evidence:** B6; run-log M5 — `SNAPBACK_SEARCH_REFERENCE_INVALID`
  contract-generation hash mismatch between the typed `client.search()`
  wrapper and a generated resource-scoped search reference **within the
  single 0.1.15 release**; plain `client.query()` executes the same
  search. Version skew inside one published version.
- **Closure:** fix the hash-binding skew; add a qualification gate that
  exercises the typed search wrapper against freshly generated
  references (this escaped because nothing in the publication path
  composes the two).
- **Owner:** LLP 0073 / LLP 0136 surface owners; qualification per
  LLP 0189. New ticket.

### G2. Durably-queued mutation settles by *rejecting* (`SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED`)

- **Evidence:** B8 (the one discount on a 90); m7-diary "queued-but-
  rejected" — a `useSnapbackMutation` call made offline queues durably
  and replays on reconnect, but its settlement promise rejects when the
  mutation's result contract can't install locally. The M7 engineer's
  rollback-on-error erased a pending marker for a vote that then settled
  fine; the original builder had absorbed the same lesson implicitly
  (fire-and-forget text sends). Two blind sessions, same bug shape.
- **Closure:** a queued dispatch must not surface as an error. Resolve
  `{queued: true}` (matching the imperative client's contract), or at
  minimum reject with a distinct, documented diagnostic class that the
  React arm's docs call out at the mutation hook.
- **Owner:** LLP 0107 (optimistic lifecycle);
  `issues/20260808-first-class-react-optimistic-create.md` is adjacent
  (a provider-owned optimistic path would dissolve the hand-rolled
  rollback pattern that made this bite). New ticket for the settlement
  contract itself.

### G3. Handler runtime errors are generic where generate-time refusals are exemplary

- **Evidence:** B10; run-log M2 — `ctx.runtime.newId()` (typo for
  `id()`) produced only `SNAPBACK_HANDLER_FAILED` with no property name,
  no line — "markedly worse than everything around it" (diary). The
  generate-time analyzer meanwhile names file/line/column and the
  violated profile, and fails closed with the old functions still
  serving (praised in both sessions).
- **Closure:** carry the underlying JS error detail (TypeError message,
  property, position) through the handler-failure surface, at least in
  dev. This is the concrete first case for the no-refusal failure layer
  that LLP 0207's dissolution routed to LLP 0193 and the diagnostics
  owners.
- **Owner:** LLP 0193; LLP 0178 for the contrast standard. New ticket.

## Tier 2 — diagnostics dead zones

### G4. The durable outbox is silent: queued is indistinguishable from committed

- **Evidence:** B4; holistic-cited moment — one transient
  connectivity-classified refusal silently queued a settings write
  (`{queued:true}` resolves like success), every later mutation queued
  behind it, and the screen was "randomly broken under load" for ~2h of
  suite flakes. The builder's fix — a 30-line app-wide `OutboxFlusher`
  draining on live-connection/online/5s-poll — was required to make the
  platform's own guarantee usable, and the lesson generalized to "every
  screen needs outbox awareness."
- **Closure, three parts:**
  1. **Default drain.** The React arm owns an app-wide outbox drain
     (live-connection restore, online event, poll) so no screen needs
     bespoke awareness. The builder's `OutboxFlusher` is effectively the
     spec.
  2. **Observable queue state.** A hook exposing queue depth /
     oldest-pending so UIs can render pending affordances.
  3. **Dev-mode signal.** Console warning when a mutation queues, and
     when the queue head has been wedged past a threshold.
- **Owner:** LLP 0043; `issues/20260731-js-arm-lease-custody-and-
  sessions-outbox.md` covers adjacent custody work. New ticket for the
  React-arm drain + observability. G2 and G4 should land as one
  coherent "outbox truthfulness" story.

### G5. Resubscribe storms have zero diagnostics and can saturate the main thread

- **Evidence:** B3; run-log M3 — inline args objects to
  `useSnapbackQuery` plus a per-render `useSnapbackPresence` value
  object saturated the browser main thread until Playwright clicks
  stopped landing; ~50 minutes of bisection; no console warning
  anywhere. The skill documents the trap as "wasteful" — the pilot shows
  it is a hard render/resubscribe loop, dramatically understated.
- **Closure:** prefer the structural fix — key the subscription on a
  value-hash of args rather than object identity, deleting the foot-gun
  class for queries and presence alike. If that carries unacceptable
  cost, ship a dev-mode storm detector (N resubscribes of the same
  reference within M ms → named warning). Update the skill/guide wording
  either way.
- **Owner:** escalate
  `issues/20260806-usesnapbackquery-inline-args-resubscribe.md` from P3
  with the pilot evidence (it currently reads "correct but wasteful");
  extend its scope to `useSnapbackPresence` value/options churn.

## Tier 3 — missing capabilities

### G6. No password credentials, no production mail adapter (B2's floor)

- **Evidence:** B2 = 48 — the pilot hand-rolled scrypt hashing in a
  trusted gateway minting sessions through the sanctioned broker seam.
  Signup/login/logout is table stakes for the social class; the essay's
  Convex comparison names "auth-in-a-box" as Convex's clearest win.
- **Closure:** this Plan does **not** commission an auth lane — identity
  is Wave 4's program (LLP 0151,
  `issues/20260808-wave4-identity-program.md`,
  `issues/20260808-identity-architecture-decision.md`). It contributes
  the evidence and one shaping input: short of full built-in password
  auth, a supported **credential-provider seam** (platform owns hash
  verification, rotation, session mint; app supplies credential policy)
  would have moved B2 most of the way, and the email-code flow needs a
  production mail adapter to count at all.
- **Owner:** LLP 0151 / Wave 4. No new ticket; this section is the
  pointer.

### G7. Broker-seam papercuts: undocumented mint HTTP shape; no external-bearer logout

- **Evidence:** B2, B9; run-log M1 — `auth.mintSession` over HTTP
  refused every guessed body shape (`SNAPBACK_AUTH_REQUEST_INVALID`;
  the guide documents no input shape), so the gateway shells out to the
  CLI **per sign-in** — untenable at 1,000-user replay scale. And
  `authLogout` demands AuthCoordinator custody; external-bearer sessions
  revoke only via raw `POST /auth/logout`, discovered by probing.
- **Closure:** document the mint host-op's HTTP contract (or expose a
  supported non-CLI mint path for brokers); add a client-arm logout for
  external-bearer custody. Both are small and independent of G6's
  program.
- **Owner:** auth protocol owners (LLP 0057, LLP 0059); guide pages per
  LLP 0061. New ticket (one, both papercuts).

### G8. Declared-membership integration tax: product apps run two rosters

- **Evidence:** B1, B5; essay "the declared-authority systems don't
  quite fit a messenger's product shape" — the membership declaration is
  deliberately closed (private roster, no admin-promotes-other,
  bootstrap-owns-creation, one membership command per mutation), so a
  visible-roster product keeps a display table *and* the declared seats,
  synchronized across five mutations. Same story for membership-flavored
  `assetSharing`. The essay predicts most ported social apps pay this.
- **Closure options, ascending ambition (owner chooses):** an opt-in
  readable roster projection; a promote-other transition; relaxing
  one-command-per-mutation for creation flows; or a sanctioned mirror
  pattern the codegen keeps in sync. The security rationale for the
  closed machine is airtight and documented — the ask is a paved bridge
  from it to product-shaped rosters, not a weakening.
- **Owner:** LLP 0056 / LLP 0100. New ticket to commission the design
  choice.

### G9. Relational v1 cannot express the follower join (the canonical social query)

- **Evidence:** B1; diary M2 — the Following feed (follows ⋈ entries)
  fails relational v1's constraints (joined side must be unique, no
  parameterized root filters), so it is a hand-written JS k-way merge
  whose cost is linear in follow count. The scale replay measured 1.8×
  p50 at 100× fan-in (u0500 vs u0005) — fine at this envelope,
  structurally exposed under the grader's degradation rules.
- **Closure:** widen relational queries toward parameterized root
  filters + non-unique joins, or offer a first-class feed/fan-out
  primitive. The 40-line JS merge was praised as an escape hatch — the
  gap is declarative expression, not capability.
- **Owner:** LLP 0080 (+ LLP 0120 / LLP 0157 for the aggregation
  algebra). New ticket referencing both.

### G10. No `count()` aggregate

- **Evidence:** B8; m7-diary — the message-count backfill paged and
  counted rows under the 1024-row query cap; "a real count aggregate
  would make maintained-counter backfills nicer." Maintained counters
  are the platform's own recommended pattern, so backfilling them is a
  recurring need.
- **Closure:** a bounded server-side count (at minimum: count over an
  index range) usable from handlers.
- **Owner:** LLP 0120 / LLP 0157. New ticket.

### G11. JS-arm protected cold-offline reads are hand-rolled (named GAP, priced by the rubric)

- **Evidence:** B4 — writes are excellent (durable outbox, ordered
  exactly-once replay, persisted binding receipt), but protected-data
  cold retention is a named GAP on the JS arm, so M6's offline reads are
  a hand-built localStorage snapshot — exactly the rubric's 30-anchor.
- **Closure:** a supported snapshot-cache helper for the JS arm
  (platform-managed, provenance-aware via `binding.source`,
  policy-aware enough to exclude view-once/expired content) capturing
  most of the value short of porting the Contract arm's lease path. The
  honest GAP row stays until then.
- **Owner:** LLP 0043 / LLP 0155 / LLP 0129;
  `issues/20260808-offline-image-bytes-not-retained.md` records the
  asset-bytes half from run 6. New ticket for the helper, linking both.

### G12. Schema expressiveness: stored arrays and unique-on-optional

- **Evidence:** B1 — no `v.array()` on stored fields forced an
  img1..img4 column splay (and `v.json()` for poll options in M7);
  unique index on an optional field is refused, forcing
  required-with-generated-default workarounds for clientKey/dmKey.
- **Closure:** bounded stored arrays (even fixed-max, matching the
  bounded-children philosophy) and unique-where-present index semantics.
- **Owner:** LLP 0004 / LLP 0131 / LLP 0110. New ticket.

### G13. No server-side connected-client predicate for push suppression

- **Evidence:** B7 = 58, the 60 anchor verbatim ("connection tracking
  hand-built") — a presenceHeartbeats table written every 25s, with
  "connected" judged as heartbeat < 60s, purely to suppress push for
  connected recipients.
- **Closure:** expose the platform's own connection knowledge (it
  terminates the live connections) as a queryable predicate for
  mutations/actions.
- **Owner:** LLP 0143 / LLP 0045. New ticket.

### G14. No readable app-config store

- **Evidence:** B1; diary M4 — the secrets/config surface is write-only
  for actions, so runtime-tunable config (edit windows, disappearing
  TTLs) became config-as-data: an appConfig row behind an operator-gated
  mutation.
- **Closure:** either bless config-as-data as the documented pattern
  (it worked; a guide recipe may be the whole fix) or extend LLP 0036's
  surface with readable non-secret config.
- **Owner:** LLP 0036 + guide. New ticket (may resolve docs-only).

## Tier 4 — papercuts and docs

### G15. Asset-surface papercuts

- **Evidence:** B5; run-log M4/M5 — signed-URL issuance has no
  client-arm method (raw POST + protocol header, found by probing);
  empty issuance body 422s instead of defaulting to the primary
  variant; a command's non-optional asset child demands a required
  mutation arg, fighting a single image-or-video mutation (solved with
  optional children + handler validation); `ctx.assets.attach` is
  owner-only, which sank the first view-once design.
- **Closure:** client-arm issuance method; default variant on empty
  body; document the optional-children pattern. Additionally, promote
  the pilot's **per-recipient grant rows / transfer-at-open** view-once
  pattern into a guide recipe — ~80 lines, survived every hostile probe
  (403 before open, 200 during, 403 after close), and non-obvious
  precisely because of the owner-only attach rule.
- **Owner:** LLP 0044 / LLP 0180 + guide. New ticket.

### G16. API consistency papercuts

- **Evidence:** B3, B9 — `PresenceState`'s field is `entries` while the
  surface projection calls it `members` (silent empty list on misread);
  headless `liveQuery` demands an explicit `connectionId`, discovered
  via error.
- **Closure:** align the presence field names (or alias); default the
  connectionId or name the requirement in the reference at the call
  site.
- **Owner:** LLP 0013 / LLP 0107 (presence), LLP 0093 / LLP 0012
  (headless client). New ticket.

### G17. Docs at the point of need (guide-gap batch)

- **Evidence:** B9 — three findable-when-needed failures: the inline
  handler dialect's restrictions are learned from refusals rather than
  read (both sessions); `useSnapbackQuery`'s live-reference-only rule
  surfaces at runtime, not where hooks are introduced; the persisted
  binding receipt means offline boot *succeeds*
  (`binding.source: 'persisted-receipt'`) — apps must branch on
  provenance, and the pilot's offline detection was built for a failure
  that never came.
- **Closure:** file as `guide-gap` tickets per LLP 0061 §5 — a dialect
  restriction list on the handlers page (LLP 0108 is the source of
  truth), a loud live-only note on the React page, and a provenance
  branch example on the offline page.
- **Owner:** LLP 0061 pipeline. Three guide-gap tickets.

### G18. Operations papercuts

- **Evidence:** B11 — standalone `snapback start` refused a capability
  the dev supervisor grants (forcing supervisor-managed instances for
  the scale lane), and the supervisor reports ready before sessions
  settle (every driver needed a retry loop).
- **Closure:** align standalone-start capability grants with the
  supervisor's; make readiness include session settlement (or expose a
  distinct settled signal).
- **Owner:** LLP 0041 / LLP 0123. New ticket.

### G19. Membership-visible search is the one slow surface at scale

- **Evidence:** B11/scale probes — search.busyChat p50 582ms / p95
  806ms over the 10k-message chat, ~15–20× every other probe (paging
  stayed flat page1→page50; feeds and chat lists all < 80ms p95).
- **Closure:** profile before the scored waves; this is a
  measurement-first ticket, not a redesign commission.
- **Owner:** LLP 0073. New ticket.

## What must not regress

The record is equally specific about strengths, and several closures
above are extensions of them rather than departures:

1. **Refusals-as-docs.** Generate-time refusals with file/line/column
   and named profiles; fail-closed reload keeping the old functions
   serving; typed `refusals:[...]`/`ctx.refuse` crossing to clients as
   stable appCodes. G3/G4 extend this culture to the runtime and client
   layers; nothing may dilute it.
2. **Live watch-reload additive migration** (B8 = 90): schema edits
   against a running sessions-mode server, `generated-and-loaded` in
   ~1s, zero-diff data across a forced backfill. "Snapback's strongest
   card" — the scored waves will re-measure it.
3. **Idempotent-by-clientKey writes** turning a hard kill at 88k/166k
   replay actions into bookkeeping (fast-forward, carry the clock, zero
   errors).
4. **The honest capability index.** GAP rows changed the pilot's
   architecture twice on day zero. Closing a gap must retire its row;
   until then the row stays honest.
5. **The served, build-bound guide** and the app-code-as-pattern-
   language property the M7 session leaned on.

## Sequencing

1. **Wave A (defects + dead zones): G1–G5.** Small, independent,
   highest leverage; G2+G4 land together as the outbox-truthfulness
   story. Target: next qualified publication after review.
2. **Wave B (papercuts): G7, G14–G18.** Mostly docs and one-line
   affordances; batchable across parallel lanes.
3. **Wave C (capability commissions): G8–G13.** Each needs its owner
   LLP to rule on design before implementation; this Plan's job is to
   commission with evidence attached, not to design them here.
4. **G6 flows to Wave 4 (identity)** and G19 to a measurement ticket;
   neither is a lane of this Plan.

Priorities should be **revisited when the Convex and Supabase lanes
finish**: gaps where competitors also struggle matter less against
LLP 0198's victory conditions than gaps where they glide (the essay
names auth-in-a-box and effortless reactive joins as Convex's wins —
G6 and G9 are therefore likely to survive reprioritization at the top).

Verification follows LLP 0189: each closure lands with its own scoped
evidence; the benchmark rubric is re-scored only by future instrument
runs, not claimed from fixes.

## Non-goals

- Redesigning the closed membership machine's security model (G8 asks
  for a bridge, not a weakening).
- Porting the Contract arm's lease path to JS wholesale (G11 asks for a
  bounded helper).
- The P1 choreography-harness defect (segment-green structurally
  unreachable; iOS-simulator receipt requirement) — real, but it is
  benchmark-instrument work owned by LLP 0201, already noted in the run
  journal as pre-scored-wave repair.
- Landing the pilot diaries/records themselves — that is the P2
  close-out, after all three lanes finish.

## Open questions

1. **G5 mechanism:** value-hash subscription keys vs. dev-mode storm
   detector — does the structural fix carry acceptable hashing cost on
   hot paths? (Owner: React arm.)
2. **G2 contract:** resolve `{queued:true}` (breaking for callers that
   await settlement semantics) vs. a distinct rejection class
   (non-breaking, still error-shaped)? Interacts with the imperative
   client's existing contract.
3. **G8 depth:** which rung of the ascending-ambition ladder does the
   membership owner pick? A readable roster projection alone may
   dissolve most of the dual-roster tax.
4. **G14:** is config-as-data the blessed answer (docs-only closure) or
   does LLP 0036 grow a readable tier?
5. **Reprioritization gate:** does Wave C wait for the Convex lane's
   scores, or start on the two gaps already known to be Convex wins
   (G6 via Wave 4, G9)?
