# LLP 0307: Paved-loop cost chip-away round

**Type:** RFC
**Status:** Draft
**Systems:** Agent experience, Developer experience, CLI, Local server
lifecycle, Code generation, React/Expo, Live queries, Ephemeral state,
Offline sync, Diagnostics, Guide, Benchmarks, Testing
**Author:** Claude / Charlie Cheever
**Date:** 2026-08-24
**Related:** LLP 0295, LLP 0306, LLP 0299, LLP 0300, LLP 0301, LLP 0302,
LLP 0297, LLP 0281, LLP 0267, LLP 0219, LLP 0253, LLP 0257, LLP 0275,
LLP 0043, LLP 0201, LLP 0186, LLP 0144, LLP 0041, Diary 0113,
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`,
`issues/20260824-metro-generated-module-freshness.md`,
`issues/20260824-fixed-port-stale-listener-false-positive.md`,
`issues/20260824-first-party-headless-replay-helper.md`,
`issues/20260824-guide-gap-familiar-defineauth-spelling.md`,
`issues/20260824-activity-presence-volatile-value-publish-storm.md`,
`issues/20260824-familiar-offline-replay-capability-unathorable.md`

## Summary

This RFC turns LLP 0306's published-0.1.25 cost findings and LLP 0295's
program state into one executable round. Its contribution beyond those two
documents is **verification against current `main`** (`9a782983d`,
2026-08-24): every load-bearing 0306 claim was re-checked against the code,
so this round proposes work only where the gap is confirmed live, and
explicitly retires items the corpus still lists as open but the code has
already closed.

Two facts reshape the priority order:

1. **0.1.26 published today** (LLP 0041 §0.1.26, source `118babab1`), and
   all four URL-first implementation landings (LLP 0299 supervised listener
   pinning; LLP 0301 URL-first lifecycle; LLP 0302 declared-dev binding,
   which removed external-binding clock expiry entirely) are inside that
   closure. The port/lifecycle tax that dominated both 0.1.25 lanes is
   *claimed* fixed in a published package for the first time. The
   highest-leverage next act is qualification, not design.
2. **LLP 0295 move 5 (cost/evidence visibility) is accepted design with
   zero implementation.** LLP 0267 §7 is Accepted and graduated to four
   open tickets; none has any code on `main` (verified: no
   `QueryCostObservation` / `MutationPhaseCost` / `LiveDeliveryWave` /
   `pendingDeliveryReason` symbols exist anywhere). Meanwhile the single
   largest *authoring* wall sink in the 0.1.25 pair (Familiar M3, 3,015s)
   was precisely an inability to tell transport latency from render cost.
   The biggest open lever is executing already-ruled design, not ruling
   more.

The round has four tracks: **Q** (qualify the published paved loop),
**T** (tickets filed with this RFC — straightforward, implementable as
written), **S** (items needing a Spec before implementation), and
**E** (existing open tickets whose execution this round sequences but does
not re-own).

## Where the project actually is

- LLP 0295's five moves: moves 1–4 are landed on `main` (vertical contract
  batch, W1 fixed-origin lifecycle, W2 authority transitions, W4 safe
  composition). Move 5 is unimplemented (above). R1 cold probes are green;
  R2 is commissioned, machinery in active repair, not yet run.
- LLP 0306 (landing with this RFC) is the 0.1.25 full-scope pair: both
  profiles authoring-green M1–M6/M8 + fresh-session M7; Explicit completed
  167,157-action scale; Familiar stopped honestly at 2,620. The expensive
  work was leaving the paved loop and reconstructing lifecycle, identity,
  replay, and observability by hand.
- 0306 named four product chip-aways that survive the URL-first landings:
  generated-module freshness, a first-party replay helper, live
  latency/size diagnostics, and capability/refusal vocabulary parity. All
  four are confirmed live on `main` by this round's verification.
- The instrument half (LLP 0281 / the observability version-bump ticket) is
  still Draft/open; roughly half of the 0.1.25 pair's error loops were
  instrument- or harness-attributable, so the next full pin re-pays that
  noise unless the bump lands first.

## Verification of LLP 0306 against `main` (2026-08-24, `9a782983d`)

| 0306 claim | Verdict on `main` | Consequence |
| --- | --- | --- |
| Supervised `--expo` cannot pin ports | Fixed (LLP 0299 Implemented; in published 0.1.26) | Track Q qualifies it; no design work |
| External AppBinding 1h expiry, no refresh | Fixed by removal: declared-dev bindings refuse `expiresAt` and re-verify via the LLP 0302 §3 standing gate; only supervisor-owned bindings keep TTL+refresh | Track Q; retire the item |
| `--expo` × `--external-client-origin` exclusivity | Deliberate and normative (LLP 0301: "declares a client owned outside Snapback") | Not a defect; guide teaches the split |
| Metro keeps rotated hashed generated modules | **Confirmed, unticketed**: nothing on the supervised path invalidates Metro; the stable alias's bytes never change while its import target rotates | Ticket filed (Track T1) |
| False `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` | **Confirmed, unticketed**: two emit sites rewrite any descriptor-health failure with no OS-listener probe; guide documents the code as "occupied port" | Ticket filed (Track T2) |
| No first-party headless replay adapter | **Confirmed**: no CLI verb, no acceptance-package helper; the guide instructs an app-authored loader | Ticket filed (Track T3) + Spec (S1) |
| Familiar cannot author `offline_mutation_replay` | **Confirmed**, and profile-independent: the id is missing from the authorable `TARGET_CAPABILITY_IDS` set while present in the Rust registry, target manifest, and the experimental-maturity mirror; no parity gate exists between the authorable set and the registry | Existing ticket augmented with code pointers (Track T6) |
| Familiar generated server lacks `defineAuth` | Deliberate (LLP 0253 disposition 4) but the guide has **zero** Familiar auth spelling and the export-parity ticket excludes the symbol | Guide-gap ticket filed (Track T4) |
| `v.doc` optional fields required on return | By design: present-null discipline, type model and runtime agree, documented in guide | Retire; teaching covered by vertical fixtures |
| `v.json()` types results `unknown` | Confirmed; honest but unergonomic; design choice | Small decision routed to LLP 0253 (OQ4) |
| Presence `touch()` storms the wire per keystroke | Partially true: idle-delete, send-withdraw, and unchanged-value dedup all ship; the live trap is a **volatile value thunk** defeating dedup, exactly as LLP 0257 warned, with no diagnostic naming it | Ticket filed (Track T5) |
| No end-to-end latency timeline | **Confirmed**: LLP 0219 channel carries only outbox/churn codes; the emitter is still labelled a stub; all four W5 tickets open with zero code | Track E1 (execute), S2 (assess) |
| Declared refusals lose `appCode` at clients | Partially addressed: the server preserves declared codes (folding only undeclared/empty ones — the observed Familiar fold was a bare `throw`, i.e. correct), types declare `details.appCode`, one source-checkout demo proves it; missing: one shared typed client helper, a packed-package regression, the Familiar-hook arm | Track E2 (execute existing ticket) |
| No pre-flight node-count/size inspector or HUD | **Confirmed**: LLP 0297 in Review (round-1 both-families NOT READY; narrowed to Option E); the 4,096-node identity budget vs 65,536-node admission budget mismatch is live; overload diagnostics reachable only via server inspection | Track E3/E4 |

## The round

### Track Q — qualify the published paved loop (no new design)

Run the Clique `--expo` journey against **published 0.1.26** as a cheap
R1-style probe (per-profile: scaffold, supervised Expo with a pinned port
range, M1 auth + live two-client query, one additive schema change, one
regeneration while Metro keeps running) before any full pin. Pass criteria:
the lane never inspects shipped lifecycle source, never leaves `--expo`,
and every binding survives the session via the 0302 standing gate. Fail
criteria route to LLP 0299/0301/0302 as qualification defects. Note the
known open hole going in: T1 (Metro freshness) predicts the regeneration
step still needs a Metro restart — the probe should *measure* that cost in
isolation rather than discover it mid-milestone. Whether this probe rides
LLP 0295's R2 machinery or runs standalone is OQ1.

### Track T — tickets filed with this RFC (straightforward)

1. `issues/20260824-metro-generated-module-freshness.md` — invalidate,
   don't restart: make rotation change the bytes Metro already watches
   (smallest candidate: codegen rewrites the stable alias's bytes on
   rotation) so the supervised loop survives regeneration.
2. `issues/20260824-fixed-port-stale-listener-false-positive.md` — probe
   the port before choosing the diagnostic; a stale descriptor with no
   listener gets a stale-descriptor remediation (or auto-recovery), not a
   phantom-listener claim.
3. `issues/20260824-first-party-headless-replay-helper.md` — the tracking
   anchor for S1; the ticket carries the reinvented-bug inventory.
4. `issues/20260824-guide-gap-familiar-defineauth-spelling.md` — document
   the paved Familiar auth spelling; LLP 0253 rules export vs documented
   import (OQ4).
5. `issues/20260824-activity-presence-volatile-value-publish-storm.md` —
   dev diagnostic naming the volatile value, guide callout, optional
   coalescing.
6. `issues/20260824-familiar-offline-replay-capability-unathorable.md`
   (filed from the run, landed with this RFC) — augmented with exact code
   pointers; the minimal vocabulary repair (add the id + a parity gate
   binding the authorable set to the Rust registry) is implementable as
   written and closes the drift class, independent of the larger
   settlement-ledger acceptance.

### Track S — needs a Spec before implementation

- **S1. `snapback replay` / headless replay surface** (owner: LLP 0043
  semantics, LLP 0201 first consumer). The design question is packaging —
  CLI verb, published `@expo/snapback-acceptance` helper, or verb-wrapping-
  helper — plus whether generated headless clients mint transport
  `clientMutationId` by default (0306 idea 13). Both full pairs to date
  invented this adapter; Explicit's scale babysitting (11,314s) and
  Familiar's scale failure are its cost ceiling. Recommended: helper
  package + thin CLI verb, transport identity minted by default.
- **S2. Client-visible latency timeline** (owner: LLP 0219 channel +
  LLP 0267 §7 posture). Deliberately **conditional**: the four W5 tickets
  (Track E1) already promise mutation phase costs, delivery lag, and the
  `pendingDeliveryReason` join as pull-only local inspection. Author this
  Spec only if, after W5 lands, an agent still cannot answer "why is this
  message late?" without bisection — the gap 0306's Familiar M3 paid 50
  minutes for. Commissioning it now would double-own W5's surface.
- **S3. Familiar offline authoring completion** (owner: LLP 0253 +
  LLP 0058). If the T6 vocabulary repair plus settlement-ledger admission
  proves to need profile-surface decisions (queue-aware `useSnapbackMutation`
  defaults, capability-conditional codegen), graduate the ticket into a
  dated LLP 0253 amendment rather than growing the ticket.

### Track E — execute existing open work this round depends on

1. **The four W5 runtime-cost tickets** (`20260822-runtime-cost-recorder…`,
   `…client-runtime-cost-and-delivery-inspection`, `…equivalent-work…`,
   `…integration-proof`). Accepted design, zero code, and they own the
   pre-inconsistency subscription diagnostic the reopened contention ticket
   demands. This is the round's largest implementation item and the
   precondition for S2's assessment.
2. **Declared-refusal remainder**
   (`20260822-declared-refusal-client-code-preservation.md`): one shared
   typed client helper (Coterie's hand-rolled `applicationCode()` is the
   duplication to delete), a packed-package regression, and the
   Familiar-hook arm. The server/type halves are already done — this is
   small and closes a whole class of string-matched nested-envelope
   assertions.
3. **LLP 0297 Option E close-out**: finish the narrowed
   generated-artifact-category ruling and fix the live 4,096-vs-65,536
   identity/admission budget mismatch it documents; the open
   `20260822-guide-gap-generated-app-canonical-node-ceiling.md` blank-boot
   case is its acceptance fixture.
4. **Instrument bump before the next full pin**
   (`20260821-clique-instrument-observability-version-bump.md`, LLP 0281):
   typing-clock/render split, structural selectors, M7 choreography
   segment, handoff self-containment — plus the 0306 session-shape items
   (milestone-boundary session splits or compaction, detached scale
   watcher, compact structured choreography misses) and the honest-Familiar
   completion-profile ruling (OQ2). Per-milestone token metering as a run
   admission check (0306 OQ5) is recommended **yes** and belongs here.

## Non-goals

- Re-owning LLP 0295's phases, scorecard, or R2 admission machinery; this
  RFC routes into that program and sequences one round of it.
- Adding Familiar cron, relaxing the 1,024 ceilings, `RuntimeNow` in
  protected queries, or any intentional-boundary removal (0306 "no plan"
  list stands).
- Touching LLP 0276's rearchitecture program.
- New benchmark surface: instrument changes stay inside LLP 0281's bump.

## Sequencing

1. Track T tickets and E2 (refusal remainder) are ordinary optimistic
   landings — start immediately, land continuously.
2. Track Q probe against published 0.1.26 as soon as a lane is free; its
   result decides whether the lifecycle class is closed or bounces back to
   0299/0301/0302 before anything else is built on them.
3. S1 (replay Spec) next — it changes the shape of every future scale
   segment and unblocks the next full pin's scale cost.
4. E1 (W5 implementation) in parallel lanes; E3/E4 behind it.
5. Full published pin (both profiles) only after: Q green, T1 landed,
   instrument bump landed, and per-milestone metering emitting — so its
   numbers finally attribute cost instead of summing a five-hour session.

## Open questions

1. Does the Track Q probe run standalone (cheap, this week) or as an R2
   admission cell under LLP 0295's machinery? Recommended: standalone
   first — R2's controller work should not gate a five-minute-per-cell
   journey check.
2. For Familiar-only Clique lanes, is M8-schedule graded N/A, or does the
   lane charter stop forbidding the LLP 0253-documented "leave the profile
   for cron" move? (Owner: LLP 0201/0281 instrument bump; either answer
   fixes B7=28 being read as product failure.)
3. Should S2 be commissioned now instead of conditionally? Only if the
   author judges the M3-class cost intolerable for the *next* pin rather
   than the one after W5.
4. `defineAuth`: export from the Familiar entrypoint, or bless the
   cross-package import in the guide? And smaller: does `v.json()` grow a
   typed escape (`v.json<T>()`) or stay `unknown`? (Owner: LLP 0253.)
5. Replay packaging (S1): CLI verb, acceptance-package helper, or both?
   Both full pairs' evidence slightly favors a helper (lanes need
   programmatic pacing and receipts), with the verb as a thin wrapper.
