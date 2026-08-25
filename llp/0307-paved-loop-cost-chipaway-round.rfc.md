# LLP 0307: Paved-loop cost chip-away round

**Type:** RFC
**Status:** Implemented
**Systems:** Agent experience, Developer experience, CLI, Local server
lifecycle, Code generation, React/Expo, Live queries, Ephemeral state,
Offline sync, Diagnostics, Guide, Benchmarks, Testing
**Author:** Claude / Charlie Cheever
**Date:** 2026-08-24
**Revised:** 2026-08-24 (status: Implemented — lane D landed `2d8d468a0`
completing Track E1's integration slice with observational isolation and
honest evidence semantics; the §7.7 integrated-fixture remainder is
re-opened as its own ticket rather than overclaimed. Every track of the
round is now executed or explicitly routed; the packed 200k replay
qualification runs post-landing and the S2/S3 conditionals plus the
Familiar-offline S3 unit remain the round's declared open tails.)
**Revised:** 2026-08-24 (implementation record, end of day: the round is
executed. Track T — T1 closed (CI/Metro watch, `d850372c8`; root cause was
`CI=1` disabling Metro's watcher, not the alias bytes), T2 closed
(tri-state probe, `3523efec6`), T3 delivered as LLP 0307.000 →
`snapback replay` landed `80c8e3caf`, T4 closed (defineAuth disposition-1
+ guide, `301c52c1a`), T5 items 1–2 closed (presence churn diagnostic +
recipe, same landing), T6 drift-gate slice closed (allowlist parity gate,
`3523efec6`; authorability stays with the open S3 unit). Track E — E1 all
four W5 tickets implemented (A `9159d5e3a`, B `40a5593e1`+fix-forwards,
C `6d386e792`; D integration proof in flight at record time), E2 closed
(`5e7ff95c9`). Track Q — Q-a executed clean for LLP 0299 (see the Q-a
record above); its web-bundling blocker fixed (`ed05f9b88`). Track S — S1
Implemented; S2 remains conditional on W5-in-use evidence; S3 remains the
open Familiar-offline unit. Extra product fix surfaced by qualification:
sessions acknowledge wire drift (closed with a served regression). Every
landing carried dual codex+grok review with fix rounds; the full per-lane
record lives in the session's review artifacts and lane reports.)
**Revised:** 2026-08-24 (r3, loop close + acceptance: round 2 verdicts were
grok READY on r2 and codex NOT READY solely on one remaining disposition
error — E4 retaining M7 handoff self-containment outside LLP 0281's
instrument authority — fixed here along with both families' non-material
editorial leftovers (four-track one-liner, node/HUD routing row, Q-a
binding-term obligation, OQ1/OQ2 wording). r3's targeted fixes are
unreviewed; verdicts bind to r2 hash `e594e38e…`. Loop closed under the
author's delegated two-round stop rule; Status set to Accepted under the
author's delegated decision authority of 2026-08-24. The full round record
is `llp/reviews/0307-paved-loop-cost-chipaway-round.run.md`.)
2026-08-24 (r2, after round-1 dual review — codex ultra NOT
READY ×7, grok xhigh NOT READY ×4: Track Q narrowed to the LLP 0299
supervised-ports slice per the author's live direction and split from the
deferred declared-dev probe; the Metro root-cause claim corrected (alias
bytes do rotate; mechanism undiagnosed — T1 is investigate-first); OQ2
re-ruled as a scored capability-boundary outcome after review showed the
"documented leave" is a whole-application migration under LLP 0252 with no
executable path; T6 re-ruled so the capability id never lands without its
settlement-ledger unit, with 0306 OQ3 now ruled here; E3 reduced to routing
split across its real owners pending LLP 0297 acceptance; E4 confined to
LLP 0281's instrument authority with session-shape changes routed to an
LLP 0201 protocol amendment; v.json typed-escape deferred to the canonical
validator owners; S1 cross-ownership recorded — LLP 0043 semantics, LLP
0275 D9 package API, CLI owner verb, LLP 0201 consumer; execution-baseline
wording reconciled with LLP 0295's table.)
2026-08-24 (r1, super-refine loop start: Draft→Review; the five
open questions are ruled under the author's delegated judgment of 2026-08-24
— see each question's ruling line. Rulings remain author-revisable.)
**Related:** LLP 0295, LLP 0306, LLP 0299, LLP 0300, LLP 0301, LLP 0302,
LLP 0297, LLP 0281, LLP 0267, LLP 0219, LLP 0253, LLP 0257, LLP 0275,
LLP 0043, LLP 0201, LLP 0186, LLP 0144, LLP 0041, LLP 0252, LLP 0058,
LLP 0114, LLP 0179, LLP 0307.000, Diary 0113,
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`,
`issues/20260824-metro-generated-module-freshness.md`,
`issues/20260824-fixed-port-stale-listener-false-positive.md`,
`issues/20260824-first-party-headless-replay-helper.md`,
`issues/closed/20260824-guide-gap-familiar-defineauth-spelling.md`,
`issues/closed/20260824-activity-presence-volatile-value-publish-storm.md`,
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
   the URL-first implementation landings (LLP 0299 supervised listener
   pinning; LLP 0301 URL-first lifecycle; LLP 0302 declared-dev binding,
   which removed external-binding clock expiry entirely — the program LLP
   0300 umbrellas) are inside that closure. The port/lifecycle tax that
   dominated both 0.1.25 lanes is *claimed* fixed in a published package
   for the first time. The highest-leverage next act is qualification, not
   design.
2. **The four W5 runtime-cost tickets are accepted design with zero
   code.** LLP 0267 §7 is Accepted at v0.15 and graduated to four open
   implementation tickets; none has any code on `main` (verified: no
   `QueryCostObservation` / `MutationPhaseCost` / `LiveDeliveryWave` /
   `pendingDeliveryReason` symbols exist anywhere). They also own the
   pre-inconsistency client diagnostic the reopened subscription-contention
   ticket demands. That — not any milestone-cost attribution — is why
   executing them is the round's largest implementation item. (The other
   part of move 5, per-milestone token metering, **landed** at `59894588b`
   and is treated below as behavior to validate, not work to do. The
   0.1.25 pair's Familiar M3 sink has its own owners in this round: T1,
   T5, and the E4 typing-clock split.)

The round has four tracks: **Q** (qualify the published ports fix — Q-a
now, the caller-owned Q-b before the next pin),
**T** (tickets filed with this RFC — straightforward, implementable as
written), **S** (items needing a Spec before implementation), and
**E** (existing open tickets whose execution this round sequences but does
not re-own).

## Where the project actually is

- LLP 0295's five moves: moves 1–4 are substantially landed on `main`
  (vertical contract batch, W1 fixed-origin lifecycle, W2 authority
  transitions, W4 safe composition) with named leftovers in 0295's own
  execution table — the declared-refusal remainder (picked up here as E2),
  the `whereApplicable` guide fact, and the W3 fixture catalogue/export
  parity. Move 5 splits: metering landed (`59894588b`); the four
  runtime-cost tickets have zero code (above). R1 cold probes are green;
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
  still Draft/open; a material share of the 0.1.25 pair's error loops and
  wall was instrument- or harness-attributable (0306 §F4's harness items
  and §G catalog — typing clock, RN Web observability, poisoned
  selectors), so the next full pin re-pays that noise unless the bump
  lands first.

## Verification of LLP 0306 against `main` (2026-08-24, `9a782983d`)

| 0306 claim | Verdict on `main` | Consequence |
| --- | --- | --- |
| Supervised `--expo` cannot pin ports | Fixed (LLP 0299 Implemented; in published 0.1.26) | Track Q qualifies it; no design work |
| External AppBinding 1h expiry, no refresh | Fixed by removal: declared-dev bindings refuse `expiresAt` and re-verify via the LLP 0302 §3 standing gate; only supervisor-owned bindings keep TTL+refresh | Track Q; retire the item |
| `--expo` × `--external-client-origin` exclusivity | Deliberate and normative (LLP 0301: "declares a client owned outside Snapback") | Not a defect; guide teaches the split |
| Metro keeps rotated hashed generated modules | **Symptom confirmed, mechanism undiagnosed**: the supervisor performs no Metro invalidation and passes no cache flags — but the stable alias's bytes DO rotate (`renderAppBindingAlias` embeds the digest specifier; rewritten every generation), so the r1 "alias bytes never change" diagnosis was wrong. Watcher coverage, new-file detection, HMR non-propagation, and descriptor-asset caching are the candidate mechanisms | Ticket filed (Track T1, investigate-first) |
| False `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` | **Confirmed, unticketed**: two emit sites rewrite any descriptor-health failure with no OS-listener probe; guide documents the code as "occupied port" | Ticket filed (Track T2) |
| No first-party headless replay adapter | **Confirmed**: no CLI verb, no acceptance-package helper; the guide instructs an app-authored loader | Ticket filed (Track T3) + Spec (S1) |
| Familiar cannot author `offline_mutation_replay` | **Confirmed**, and profile-independent: the id is missing from the authorable `TARGET_CAPABILITY_IDS` set while present in the Rust registry, target manifest, and the experimental-maturity mirror; no parity gate exists between the authorable set and the registry | Existing ticket augmented with code pointers (Track T6) |
| Familiar generated server lacks `defineAuth` | Deliberate (LLP 0253 disposition 4) but the guide has **zero** Familiar auth spelling and the export-parity ticket excludes the symbol | Guide-gap ticket filed (Track T4) |
| `v.doc` optional fields required on return | By design: present-null discipline, type model and runtime agree, documented in guide | Retire; teaching covered by vertical fixtures |
| `v.json()` types results `unknown` | Confirmed; honest but unergonomic. Canonical `v` is shared by both profiles, and a naive `v.json<T>()` would propagate an unchecked assertion through generated arguments/results as if runtime-validated | Deferred to the canonical validator/result owners (OQ4, revised) |
| Presence `touch()` storms the wire per keystroke | Partially true: idle-delete, send-withdraw, and unchanged-value dedup all ship; the live trap is a **volatile value thunk** defeating dedup, exactly as LLP 0257 warned, with no diagnostic naming it | Ticket filed (Track T5) |
| No end-to-end latency timeline | **Confirmed**: LLP 0219 channel carries only outbox/churn codes; the emitter is still labelled a stub; all four W5 tickets open with zero code | Track E1 (execute), S2 (assess) |
| Declared refusals lose `appCode` at clients | Partially addressed: the server preserves declared codes (folding only undeclared/empty ones — the observed Familiar fold was a bare `throw`, i.e. correct), types declare `details.appCode`, one source-checkout demo proves it; missing: one shared typed client helper, a packed-package regression, the Familiar-hook arm | Track E2 (execute existing ticket) |
| No pre-flight node-count/size inspector or HUD | **Confirmed**: LLP 0297 in Review (round-1 both-families NOT READY; narrowed to Option E); the 4,096-node identity budget vs 65,536-node admission budget mismatch is live; overload diagnostics reachable only via server inspection | E3 routing (blocked on 0297 acceptance); client-visible diagnostics land through E1/W5 |

## The round

### Track Q — qualify the published ports fix (no new design)

Narrowed 2026-08-24 by the author to the slice relevant to the big ports
fix, and split per review so failures route to the owner whose mechanism
actually ran:

- **Q-a (this round): supervised `--expo` ports probe — qualifies LLP 0299
  only.** Against **published 0.1.26**: scaffold the shipped template,
  `snapback dev --expo` with a pinned port range, reach one authenticated
  live query, perform one regeneration while Metro keeps running, and let
  the session cross a supervised binding term — via a shortened supervisor
  term where the supervisor exposes one; if it does not, Q-a drops the
  term-crossing step (refresh evidence stays with the existing supervised
  refresh tests) and that gap is recorded as an obligation, since a
  minutes-scale probe cannot wait out the 1-hour default. Pass: the lane
  never
  inspects shipped lifecycle source, never leaves `--expo`, ports land
  where pinned, and the supervised binding refreshes. A completed
  supervised rendezvous means the declared-dev path (LLP 0302) is *not*
  exercised here — a supervised-probe failure routes to LLP 0299 (or the
  supervisor chain), never to 0302. Known hole going in: T1 predicts the
  regeneration step may still need a Metro restart; the probe measures
  that cost in isolation rather than discovering it mid-milestone.
- **Q-b (deferred, before the next full pin): caller-owned lifecycle probe
  — qualifies LLP 0301/0302.** `snapback dev` plus a caller-owned
  `expo start` consuming `EXPO_PUBLIC_SNAPBACK_URL`, declared-dev binding
  minted in-process, one episode crossing a reconnect. Deferred because
  the author scoped this round's probe to the ports fix; it must run
  before the next full pin so the pin's lifecycle claims cover the path
  agents actually reconstructed by hand in 0.1.25.

Whether Q-a rides LLP 0295's R2 machinery or runs standalone is OQ1
(ruled: standalone).

**Q-a executed 2026-08-24** against published 0.1.26
(`benchmarks/runs/2026-08-24-qa-ports-probe-0126/record.md`). Verdict:
**LLP 0299's ports contract qualifies clean** — all three pinned ports
landed exactly, Metro's range walk behaved correctly under real
contention, no false `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER`, help
documents the surface. Except-for findings, all routed off-0299: the
supervised Expo *web* bundle is broken at published 0.1.26
(`issues/20260824-expo-web-bundling-import-specifier-blocker.md`, wave
lane I); the shipped template's done-oracle is red at guest bootstrap
(`issues/20260824-template-guest-bootstrap-done-oracle-red.md`);
`snapback run` refuses public queries on sessions targets
(`issues/20260824-snapback-run-sessions-target-public-query-refusal.md`);
Metro freshness reproduced with the closure's own
`SNAPBACK_EXPO_METRO_WATCH_INERT` warning corroborating lane T1's
CI-passthrough diagnosis; and no shortened binding term exists (the
term-crossing obligation stands). The next publication should carry the
lane-I fix before any full pin.

**Q-b executed 2026-08-25** against published 0.1.27
(`benchmarks/runs/2026-08-25-qb-lifecycle-probe-0127/record.md`). Verdict:
**the caller-owned LLP 0301/0302 journey qualifies clean** — URL-first
scripts shipped in the template, declared-dev binding with no expiry
structurally possible, the §3 standing gate auto-re-verified across a
live backend replacement with zero manual binding work, and the
caller-owned Metro served a schema successor hot (corroborating the T1
CI fix from the caller side). Q-a's binding-term obligation is resolved
for this path: declared-dev has no clock term. Off-spec findings routed:
`issues/20260825-livequery-headless-transport-default.md` and
`issues/20260825-caller-owned-devloop-papercuts.md`. Both pin gates (Q-a,
Q-b) are now green; the full-pin gate waits only on T1 (landed) and the
instrument bump.

### Track T — tickets filed with this RFC

1. `issues/20260824-metro-generated-module-freshness.md` —
   **investigate-first** (revised r2): the alias bytes already rotate, so
   the observed staleness has an undiagnosed mechanism. Reproduce under
   supervised Metro comparing alias bytes/mtime against the served bundle;
   distinguish watcher coverage, new-file detection, HMR non-propagation,
   and descriptor-asset caching; the repair preserves the atomic
   generated-graph publication boundary.
2. `issues/20260824-fixed-port-stale-listener-false-positive.md` — probe
   the port before choosing the diagnostic; a stale descriptor with no
   listener gets a stale-descriptor remediation (or auto-recovery), not a
   phantom-listener claim.
3. `issues/20260824-first-party-headless-replay-helper.md` — the tracking
   anchor for S1, **inventory-only**: no replay implementation starts from
   this ticket before the S1 Spec is accepted.
4. `issues/closed/20260824-guide-gap-familiar-defineauth-spelling.md` — the
   guide-gap half only (document the paved spelling with retrieval-eval
   cases). The `defineAuth` export itself ships from the LLP 0253 dated
   amendment (OQ4), not from this ticket.
5. `issues/closed/20260824-activity-presence-volatile-value-publish-storm.md` —
   dev diagnostic naming the volatile value, guide callout, optional
   coalescing (API surface, if taken, ruled through LLP 0257's owner).
6. `issues/20260824-familiar-offline-replay-capability-unathorable.md`
   (filed from the run, landed with this RFC) — augmented with exact code
   pointers and **revised r2**: a bare vocabulary add is ruled out (it
   would convert the generate-time fail-closed refusal into later runtime
   traps at the un-offered settlement ledger). The immediate slice is a
   drift gate that does not change authorability: a parity test binding
   the authorable set to the Rust registry through an explicit, tested
   allowlist of intentionally non-authorable ids, plus a generate-time
   refusal naming the full vocabulary table (0306 idea 5). Authorability
   itself lands only as the S3 unit.

### Track S — needs a Spec before implementation

- **S1. `snapback replay` / headless replay surface** — cross-owned, one
  Spec: LLP 0043 owns replay/custody semantics; **LLP 0275 D9 owns the
  `@expo/snapback-acceptance` public API, lifecycle, and compatibility
  contract the helper extends**; the CLI owner governs the verb; LLP 0201
  is consumer and evidence source, never owner. The Spec decides the
  contract (pooling, custody, pacing, receipts, resume) and where
  transport-id minting defaults live (0306 idea 13 — at the layer that
  also owns the acknowledge loop, not the raw client). Both full pairs to
  date invented this adapter; Explicit's scale babysitting (11,314s) and
  Familiar's scale failure are its cost ceiling. Note: S1 changes the
  *shape* of the next pin's scale segment; it is not a pin-admission gate.
  Ruled packaging (OQ5): helper-first, thin CLI verb.
- **S2. Client-visible latency timeline** (owner: LLP 0219 channel +
  LLP 0267 §7 posture). Deliberately **conditional**: the four W5 tickets
  (Track E1) already promise mutation phase costs, delivery lag, and the
  `pendingDeliveryReason` join as pull-only local inspection. Author this
  Spec only if, after W5 lands, an agent still cannot answer "why is this
  message late?" without bisection — the gap 0306's Familiar M3 paid 50
  minutes for. Commissioning it now would double-own W5's surface.
- **S3. Familiar offline authoring completion** (owner: LLP 0253 +
  LLP 0058) — **no longer conditional** (revised r2 with the T6 re-rule):
  making `offline_mutation_replay` authorable is one owned unit — schema
  acceptance, generated facts, settlement-ledger binding admission,
  queue-aware client acceptance, and refuse-before-output for targets
  lacking the ledger — landed through a dated LLP 0253/0058 amendment.
  The id never becomes authorable ahead of the unit (see ruled question
  6). Until the unit lands, Familiar-only benchmark lanes stop carrying
  native-queue obligations (question 2's boundary treatment applies).

### Track E — execute existing open work this round depends on

1. **The four W5 runtime-cost tickets** (`20260822-runtime-cost-recorder…`,
   `…client-runtime-cost-and-delivery-inspection`, `…equivalent-work…`,
   `…integration-proof`). Accepted design, zero code, and they own the
   pre-inconsistency subscription diagnostic the reopened contention ticket
   demands. This is the round's largest implementation item and the
   precondition for S2's assessment.
2. **Declared-refusal remainder**
   (`20260822-declared-refusal-client-code-preservation.md`) — a named
   move-1 leftover in 0295's own table, picked up here: one shared typed
   client helper (Coterie's hand-rolled `applicationCode()` is the
   duplication to delete), a packed-package regression, and the
   Familiar-hook arm. The server/type halves are already done — this is
   small and closes a whole class of string-matched nested-envelope
   assertions.
3. **Node-ceiling routing (reduced r2 — this RFC finishes nothing of
   LLP 0297).** LLP 0297 is Review, round-1 both-families NOT READY, and
   its two branches have different owner chains. This round only routes:
   the generated-artifact identity branch (the
   `20260822-guide-gap-generated-app-canonical-node-ceiling.md` blank-boot
   case) to the artifact/binding owners (LLP 0114/0179), and the
   result-equality/silent-swallow branch to the result and live-query
   owners with its own delivery fixture — both **blocked on LLP 0297
   acceptance**. Any interim operational cap is 0297-owned. Underdetermined
   equality work stays out of Track E entirely.
4. **Instrument bump before the next full pin**
   (`20260821-clique-instrument-observability-version-bump.md`, LLP 0281 —
   instrument scope only): typing-clock/render split, structural
   selectors, M7 choreography segment, compact structured choreography
   misses, detached scale watching *as observation*. M7 handoff
   self-containment is **not** in the bump (r3): it changes replay-path
   custody under LLP 0201/0277 and stays with its own ticket,
   `issues/20260822-m7-handoff-not-self-contained.md`. Two boundaries (r2): per-milestone token metering
   **landed** (`59894588b`) — the bump validates its emission on the
   harness path rather than re-implementing it; and session *shape*
   (milestone-boundary session splits or compaction) changes the
   experimental treatment LLP 0201 normatively fixes (one continuous
   M1–M6/M8 session), so it lands only through an explicit LLP 0201
   protocol amendment, not through 0281 (question 7). Metering-present as
   a run admission check (0306 OQ5) is recommended **yes**.

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
   landings — start immediately, land continuously. T1/T2 deliberately
   race Q-a: they are defect repairs inside the supervised loop, not
   lifecycle redesign, so the race is safe and both inform the probe.
2. Q-a (supervised ports probe) against published 0.1.26 as soon as a
   lane is free; its result decides whether the LLP 0299 class is closed
   or bounces back before more is built on it. Q-b runs before the next
   full pin.
3. S1 (replay Spec) next — it changes the shape of every future scale
   segment (not pin admission).
4. E1 (W5 implementation) in parallel lanes. **E4 (instrument bump) also
   runs in parallel from the start** — it is a pin gate and depends on
   nothing in E1 (r2 correction; r1 had it transitively behind W5). E3 is
   routing only, blocked on LLP 0297 acceptance.
5. Full published pin (both profiles) only after: Q-a and Q-b green, T1
   landed, the instrument bump landed, and per-milestone metering
   verified emitting on the harness path — so its numbers finally
   attribute cost instead of summing a five-hour session. W5 (E1) is
   explicitly **not** a pin gate.

## Open questions — ruled 2026-08-24 (delegated author judgment)

All seven are ruled under the author's delegated judgment of 2026-08-24
(1–5 at r1, confirmed live by the author the same day; 2 and 4 revised and
6–7 added at r2 after round-1 review); each ruling is author-revisable.

1. Does the Q-a probe run standalone (cheap, this week) or as an R2
   admission cell under LLP 0295's machinery?
   **Ruled: standalone first.** R2's controller work must not gate a
   minutes-per-cell journey check; R2 consumes the probe's findings, not
   its schedule.
2. For Familiar-only Clique lanes, is M8-schedule graded N/A, or does the
   lane charter stop forbidding the LLP 0253-documented "leave the profile
   for cron" move? (Vehicle: the next pin's LLP 0201 charter; 0281 carries
   no completion-profile work.)
   **Ruled (revised r2): score it as an explicit capability-boundary
   outcome** — a visible `profile-boundary: cron` result that is neither a
   failure nor an in-profile success — and drop the M8-schedule obligation
   from Familiar-only lane charters. The r1 wording ("in-profile escape")
   was defective twice over: review showed the "documented leave" is a
   whole-application Familiar→Explicit migration under LLP 0252's
   no-mixing rule, with no executable migration verb today — not an
   in-lane escape — and counting any escape as in-profile success would
   pave cron for Familiar by scoring fiat (violating LLP 0295 objective 7
   and this RFC's own non-goals). If the author wants the real-user path
   exercised, that is a separately chartered forced-migration cell, gated
   on an executable migration path, with attribution segmented at the
   switch. This is 0306 idea 12 done honestly: the obligation leaves the
   Familiar prompt; the boundary stays visible.
3. Should S2 be commissioned now instead of conditionally?
   **Ruled: stays conditional on W5.** Executing the four accepted W5
   tickets first is the sequencing this RFC exists to defend; commissioning
   a second observability surface before the first has code would
   double-own it.
4. `defineAuth`: export from the Familiar entrypoint, or bless the
   cross-package import in the guide? And does `v.json()` grow a typed
   escape or stay `unknown`?
   **Ruled (revised r2, split):** **export `defineAuth` from the Familiar
   generated entrypoint** (schema-level auth is already disposition-1; an
   unreachable constructor is a trap, not a boundary) — via the LLP 0253
   dated amendment plus its vertical fixture, with the guide-gap ticket
   carrying the documentation half. The `v.json<T>()` half is **deferred,
   not accepted**: canonical `v` is shared by both profiles and
   `InferValidator` would propagate an unchecked `T` into generated
   arguments, results, and clients as if runtime-validated — the r1
   "same honesty as a caller cast" claim was wrong. Any typed-JSON
   convenience must come from the canonical validator/result owners with
   an explicitly assertive spelling that cannot masquerade as validation;
   nothing in this round depends on it.
5. Replay packaging (S1): CLI verb, acceptance-package helper, or both?
   **Ruled: helper-first, thin CLI verb wrapping it.** Lanes and app
   scripts need the programmatic surface (pacing, receipts, actor pools);
   the verb is the discoverable one-liner. The S1 Spec binds the contract
   under the cross-ownership recorded in Track S (LLP 0043 semantics,
   LLP 0275 D9 package API, CLI owner verb); this ruling binds only the
   packaging.
6. (Added r2 — rules 0306's open question 3.) Does Familiar grow an
   authorable `offline_mutation_replay`, or does Clique stop asking
   Familiar-only lanes for native durable queue replay?
   **Ruled: both, in that order's inverse.** Immediately, the lanes stop
   asking (question 2's boundary treatment) and the T6 drift gate lands
   with the id on the tested intentionally-non-authorable allowlist and a
   generate-time refusal naming the full vocabulary table. Authorability
   arrives only as the S3 unit — id + generated facts + settlement-ledger
   binding admission + queue-aware client acceptance + refuse-before-output
   — through the LLP 0253/0058 dated amendment. The id alone never lands.
7. (Added r2.) Do the 0306 session-shape observations (milestone-boundary
   session splits or receipt compaction for benchmark lanes) enter the
   instrument bump?
   **Ruled: no — routed to an explicit LLP 0201 protocol amendment
   decision.** One continuous M1–M6/M8 session is part of LLP 0201's
   experimental treatment (context accumulation is measured, not
   incidental); changing it through the instrument bump would alter
   comparability under the wrong owner. The bump takes only observation
   changes (detached scale watching, compact choreography misses); the
   author decides the session-shape question at LLP 0201 when the next
   pin is chartered.
