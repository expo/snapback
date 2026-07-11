**Reviewer family:** Claude
**Provider / runtime:** claude-code session (Claude Fable 5)
**Date:** 2026-07-11
**Redacted:** No — full local repository access; `.agent-local-secrets.md` was
not read.
**Method:** Interactive fresh-session review; this session did not author
LLP 0052 (the draft names Claude (Fable 5) from another session as co-author,
so this is the same-family fresh-session leg of the LLP 0005 loop — the
cross-family leg is a concurrent GPT/Codex review, which was **not** read
before this review was written). Verification-driven: the draft's factual
claims were checked against the pinned `@exact/renderer` / `@exact/contract`
0.1.2 sources under `demos/all-aboard/surfaces/contract/node_modules/`, the
All Aboard app sources, LLP 0029, and Diary 0008. Review of the working-tree
draft as of 2026-07-11, before revision.

# Review: LLP 0052 — Contract update economy and reactive host state

## Overall assessment

The diagnosis is right and it survives verification: every mechanism claim I
checked matches the pinned sources, and the "paved-road idioms compose into
worst-case patches" framing correctly assigns the fix to the framework rather
than the app. The five-item shape is right, and D5-first sequencing (measure
before optimizing) is the correct instinct.

I would not accept the draft as-is. The design section conflates two distinct
costs — dataflow **recompute** cost and patch **apply** cost — and that
conflation produces one overstated claim (that D3 demotes D1/D2 to
"optimizations"; untrue on the DOM mirror, where there is no thread
separation) and one real design gap (D4's shallow comparator cannot memoize
`boardTrains`, the draft's own second-listed offender). D1 also needs a
delivery-semantics paragraph before it is implementable. All of this is
fixable in one revision; none of it undermines the direction.

## Strengths

1. **The factual base checks out.** The renderer's props-reference fast path
   is exactly as described ("same props reference means nothing to lower or
   apply", `dom-mirror.ts:1460–1464`, ENG-23260; lowering cache keyed per
   props reference at `:419–438`). The signal layer's `Object.is` write skip
   is real (`signals.ts:592`, and `:706` for propagation). The inspector
   already computes the D5 bit per write (`dataflow-inspector.ts:191`).
   `nowMs` threads through ~20 derives (`app.contract:123–155`), the
   quantization mitigation is live (`app.contract:170–171`,
   `nowMs = now() - now() % 5000`), the palette singletons are module
   constants (`data.ts:205–209`), and all five module-state setters exist
   (`data.ts:85, :151, :176, :293, :330`). G9/G14/G15 are registered in
   LLP 0029 as cited, with G15's body pointing back at this RFC.
2. **Right altitude.** Each ingredient is traced to its individually sound
   rationale (ENG-23260 fixed real re-lowering waste; the `Object.is` skip is
   correct; helpers-returning-objects is the documented authoring idiom), so
   the RFC correctly indicts the *composition*, not any single part — which is
   what justifies framework-side ownership.
3. **Honest about the mitigation.** "Frequency treated, size untreated"
   matches the diary's own residual-suspect note (Diary 0008:1654–1657 — "the
   every-5s pass still re-derives everything").
4. **Layered design with a cheap first step.** Remove the cause (D1/D2), make
   it unshippable (D3), make it legible (D4/D5). D5 is genuinely small — the
   per-write `changed` bit already exists; extending it to a per-commit,
   per-derive attribution is bounded work with outsized diagnostic value.
5. **Plugged into the gap program.** The G9/G14 subsumption claims are real
   (checked against LLP 0029's entries), so accepting this RFC retires
   registered debt rather than creating a parallel track.

## Concerns

- **major — The design conflates patch-apply cost with recompute cost, and
  D3's payoff is overstated on the DOM mirror.**
  D3 says "a render in which nothing visibly changed produces an empty patch
  by construction, and D1/D2 become optimizations rather than
  correctness-of-performance requirements." With D3 alone, every tick still
  runs every derive and re-evaluates the view; only the *patch* is empty. On
  native hosts (VM off the UI thread) that plausibly ends the jank — the UI
  thread sees an empty patch. On web there is no thread separation: the DOM
  mirror shares the page's main thread (Diary 0008:1679–1681), the incident
  was observed on desktop web too (draft §Motivation; Diary 0008:1643–1646),
  and the diary explicitly names the residual recompute pass as the next
  suspect (`:1654–1657`). After D3, the periodic recompute stall remains on
  web; D1/D2/D4 stay load-bearing there.
  **Resolve by:** adding a small cost-model table — four costs (derive
  recompute · view re-eval · encode/serialize · UI-thread apply) × which of
  D1–D5 removes each, per host class — and rewording the D3 claim to "empty
  patch by construction; recompute cost is D1/D2/D4's job."

- **major — D4's shallow comparator cannot memoize the draft's own
  second-listed offender.**
  `boardTrains` (`data.ts:578–615`) returns
  `{hero, heroPrev, heroNext, before: rows.map(withMeta), rest:
  rows.map(withMeta), …}` — fresh arrays of fresh per-row spread objects on
  every call. A shallow compare of the return value compares `before`/`rest`
  by *reference*, which differs every recompute, so the memo never hits. The
  same shape applies to any list-of-rows derive, which is the common case in
  real screens. (themePalette is already singleton-fixed;
  `getSelectedStation` returns a flatter object that shallow compare may
  catch; the list derives are the mass.)
  **Resolve by:** stating which layer owns list-shaped derives. Either (a) D4
  grows keyed/structural memoization (per-row identity by stable key, e.g.
  train id), or (b) arrays are explicitly delegated to D3 — by the time the
  view destructures a row into node props they are scalars, so the per-node
  shallow compare catches them — and D4-shallow is documented as
  flat-object-only. (b) is cheaper and probably right; it just needs to be
  said, because as drafted D4 promises what its comparator cannot deliver.

- **major — D1's delivery semantics are unspecified at the level an
  implementation needs.**
  "The host owns delivery; a change invalidates exactly the derives that read
  the binding" leaves open: (1) Is a host-binding update an ordinary state
  write in the existing commit machinery (same `Object.is` skip, same
  batching), or a new path? (2) Atomicity — a rotation changes safe-area
  insets and (eventually) dimensions together; one commit or two (tearing)?
  (3) Initial value *timing* — synchronous read at mount vs. async arrival
  with a defined interim value (distinct from the capability-absence default
  the draft already asks about). (4) Subscription lifecycle — N components
  binding geolocation: one refcounted host watch or N? (5) Ordering relative
  to user actions in the same frame.
  **Resolve by:** a short "Delivery semantics" subsection. "Host bindings are
  host-written state, batched into at most one commit per frame, with the
  same equality skip" would answer (1), (2), and (5) in one sentence; (3) and
  (4) need one more each.

- **major — D2's formatting level must be validated against the app that
  motivates it.**
  The draft calls countdown text "the All Aboard hot path" — but the app's
  hero countdown is not a host-formattable string today:
  `formatCountdownMinutes` returns a **number** (`data.ts:879–881`) composed
  into app-controlled typography (`app.contract:386` — template string,
  `size=72`, `tabular-nums`), and the trip screen's `boardingCall` branches
  on a `departed` flag (Diary 0008:1635–1641). A `countdown(timestampMs,
  style)` node kind with a fixed style vocabulary misses its only stated
  target unless the vocabulary includes "bare minutes as number" and the
  logic branch stays in dataflow via `now(granularity)`.
  **Resolve by:** enumerating the motivating app's actual time-text usages
  (hero minutes; clock times; feed-freshness "Xs ago"; boarding call) and
  checking each against the proposed styles — or resolving the draft's own
  open question toward host-interpolated text. Cheap to do; should happen
  before the design freezes.

- **minor — D3 and D5 should share one comparator.** D5's "N% value-equal"
  is D3's skip predicate run in report mode. Implemented separately, the dev
  report can disagree with prod behavior. Say in the design that there is one
  comparator with two consumers.

- **minor — No "Alternatives considered" section.** LLP 0005's shape for an
  RFC others will re-litigate. Three paragraphs would do: (a) fine-grained
  signals into the view (Solid-style — no object-identity problem by
  construction; why not this?), (b) userland memo stdlib + documentation only
  (the do-least option), (c) always-value-compare at the signal layer
  (rejected where and why). The draft's answers are implicit in Motivation;
  make them explicit.

- **minor — Citation: "the Contract authoring model (LLP 0027…)".** LLP 0027
  is the All Aboard demo *plan*; the authoring-surface document is LLP 0020.
  Cite LLP 0020 (or both).

- **minor — No acceptance criteria.** The RFC's own D5 supplies the metric.
  Example gate: with D1–D3 landed and the quantization mitigation reverted,
  All Aboard shows zero non-countdown prop applies per tick in the D5 report,
  and LLP 0029 G15 closes. Per-item criteria would make `Implemented`
  testable (LLP 0010 posture).

## Suggestions

- **Compile-time cache-buster lint (cheap, and catches the convention
  statically).** `themePalette(_tick?)` (`data.ts:208`) and
  `getSelectedStation(…, _tick?)` (`data.ts:420`) declare-and-ignore their
  tick parameter — an argument whose only effect is forcing recomputation.
  "Derive argument never read" is statically detectable today, needs no
  runtime, and would have flagged every instance of the nowMs convention in
  this app. It is the static complement to D5 and could ship even earlier.
- **Type the `appGlue` escape hatch.** A declared name + type + default in
  the `.contract` keeps app glue compiler-visible; a stringly-keyed
  `publishHostState("name", value)` quietly recreates the discoverability
  problem D1 exists to kill.
- **One line separating D2's `now(granularity)` from the data tier's time.**
  LLP 0051's `RuntimeNow`/ctx-time is a determinism-scoped server clock; D2's
  is a client UI clock. Different clocks, different rules, deliberately not
  unified — say so to preempt confusion.
- **Make derive-level attribution a D5 requirement, not a nicety.** The
  draft's example already attributes equal-but-fresh props to `themePalette`
  / `boardTrains`; that attribution is the actionable part and should be in
  the design's acceptance shape.

## Open questions (beyond the draft's)

- Do all `now("minute")` consumers tick on one shared, wall-clock-aligned
  timer, so co-visible countdowns flip in the same frame?
- D1 initial-value *timing* (concern 3): sync-at-mount vs. async-with-interim
  — which, and is the interim value observable by derives?
- Should D5 report recompute count and re-fire count as separate columns, so
  allocation churn (D4 memo hit, new object discarded) stays visible even
  when propagation is suppressed?

## Recommended next step

Revise in place and stay `Draft`: add the cost-model table, the D4
list-derives decision, the D1 delivery-semantics subsection, and the D2
usage-validation pass; fold the minors as edits. Reconcile with the
concurrent GPT review, then this reviewer sees no obstacle to the author
accepting. The author decides.

---

## Post-reconciliation addendum (2026-07-11, same session)

Written after reading the concurrent GPT-5 (Codex gpt-5.6-sol, ultra) review;
the review above is unchanged.

The GPT review's blocking finding is correct, and I verified it directly
against the pinned sources before this note: the native element path already
value-diffs canonical props and style (`renderer/src/host-ops.ts` —
`propsChanged = !propsEqual(oldCanonicalProps, newCanonicalProps)`,
`collectChangedStyleKeys`, all encoding gated on the changed flags;
`props/normalize.ts:850–864` is a shallow value compare; dispatch only on
`enc.getOpCount() > 0`), and the DOM mirror's reference gate is explicitly
plain-web-only ("When a real host is present … installation is a no-op",
`dom-mirror.ts:15–19`). The native equality hole is raw text:
`updateTextContent` (`host-ops.ts:3731–3745`) re-emits without comparing
against the previous string, driven by Contract text-binding effects that
re-run on any dependency fire (`contract/src/runtime/view.ts:1944–1950`).

Two corrections to my review above follow:

- My major #1 (recompute vs. apply conflation) stands but **understated** the
  problem: on native, the draft's element-props mechanism is not merely
  overstated — it is contradicted by the pinned sources. The "on every host"
  sentence and D3's native scope need rewriting, not rewording. Credit to the
  GPT review for catching what I did not: I verified that the DOM mirror's
  reference gate exists but did not check whether the native path shared it.
- My Strengths #1/#4 cited `dataflow-inspector.ts:191` as "the D5 bit already
  exists per write." That line is action-scoped bookkeeping —
  `recordContractStateWrite` returns unless an action is active
  (`:183–197`) — and observes no derives, host ops, or commits. D5's seam and
  size need the GPT review's split (cheap counters first, provenance-joined
  attribution later); my "bounded work" phrasing was too sunny.

The two reviews independently agree on the other load-bearing points
(D4-shallow cannot memoize `boardTrains`; D1's semantics are unspecified and
its "existing capability manifest" is the wrong manifest; D2's "only reason
nowMs exists" overclaims; acceptance criteria and alternatives are missing).
The revision recommendation above still applies, with the per-host mechanism
rewrite added at the top of the list.

---

# Round 2 re-review (2026-07-11, post-rewrite draft)

**Reviewer family:** Claude
**Provider / runtime:** claude-code fresh-context subagent (Claude Fable 5,
general-purpose agent), orchestrated by a session that authored neither the
original draft nor the round-1 rewrite
**Date:** 2026-07-11
**Redacted:** No — full local repository access; `.agent-local-secrets.md`
was not read.
**Method:** Fresh-context sub-agent review of the revised working-tree draft
(the post-round-1 rewrite, before any round-2 edits). Verification-driven
against the pinned `@exact/renderer` / `@exact/contract` 0.1.2 sources, the
All Aboard app sources, LLP 0029/0021/0034/0020/0027/0016/0051, and
Diary 0008, plus a round-1 resolution check against both round-1 artifacts.
Run concurrently with, and independent of, the Codex round-2 re-review
(not read before this review was written). Cross-repo Exact-side facts
(viewport capability shipped under Exact LLP 0292; LLP 0293 is the
motivating slides diary) were verified by the orchestrating session in the
Exact repository and supplied to the reviewer as stated facts. The
orchestrating session independently re-verified this review's decisive
factual catches before relying on them in revision.
**Verdict:** SATISFIED — remaining items are author's-discretion nits.

## Overall Assessment

The rewrite did what the round-1 reviews asked, and — more importantly — it did it accurately. I re-verified every load-bearing mechanism claim against the pinned sources, and the corrected fact base holds: native element props/style are value-diffed before encoding (`propsEqual` / `collectChangedStyleKeys`, host-ops.ts:3525–3528; dispatch gated on `enc.getOpCount() > 0`, host-ops.ts:3819–3821), the native hole is exactly raw text (`updateTextContent` assigns `instance.text = newText` then emits with no equality check, host-ops.ts:3731–3746, driven per-binding by view-runtime effects, view.ts:1946–1951; the kernel-remeasure cost is attested in-repo by the code comment "the kernel remeasures on every text set (ENG-23161)", host-ops.ts:3619–3621), the DOM mirror's gate is props-reference-based and plain-web-only (dom-mirror.ts:1460–1464, 15–19), and — the cell round 1 never checked — DOM-mirror raw text really is string-compared before `nodeValue` writes (`appliedText.get(textNode) !== textNode.text`, dom-mirror.ts:1271, 1451–1453), so the D3 table's "largely protected" is correct. The D1 precedent claims also verify: the `viewport` capability is per-root (host-capabilities.ts:5), signal-backed with batched writes (:368–377), owner-disposed (:379), hydration-replayed (ENG-22563, :342–346, 366–382), and fed by one refcounted host listener (:299–327). The D5 correction is right (`recordContractStateWrite` bails unless an action is recording, dataflow-inspector.ts:189), and provenance carries component/line/expression (provenance.ts:57–68, 43). The app-side inventory verifies almost entirely: exactly 28 top-level derives with 20 taking `nowMs` (app.contract:123–155), quantization at :171, ticker at :222–223, `boardTrains`' fresh nested rows (data.ts:598–610), palette singletons (:205–210), `feedSourceBadge` fresh objects (:1061–1078), `setSafeAreaInsets` with genuinely no caller anywhere (only its definition, data.ts:293) while `safeAreaInsets()` polls the host global (:308–318), and the `routeCache` promise mutating outside the graph (:951–954).

What remains are four minor factual errors in the newly added tables and citations — a wrong "Read by" cell, three soft cells in the temporal inventory, and two citations that don't hold up (Exact LLP 0293 for the kernel-fed line; Snapback LLP 0020 for the UI authoring idiom). None is load-bearing for any design decision. The proposal itself is good: the cost model is honest, the sequencing is measurement-first, ownership respects LLP 0021's boundary, and the acceptance gates are testable shapes. This is now an acceptable RFC pending pinpoint edits.

## Round-1 Resolution Check

**GPT-5 review:**

- **Blocking — "props-reference on every host" contradicted by native path; UI-thread claim unsourced → RESOLVED.** Summary/Motivation now split the mechanism per host and match the sources I checked (native value-diff at host-ops.ts:3525–3528, raw-text emit at :3731–3746, mirror gate at dom-mirror.ts:1464). D3 is reframed as completing existing value dirtiness (two holes: mirror element state, raw text) rather than introducing native prop comparison. The kernel-thread claim is explicitly downgraded to an architecture assertion with Phase 0 trace confirmation required (Motivation final bullet; "Kernel-side confirmation" open question).
- **Major — D5 cited the wrong `changed` computation; profiler underestimated → RESOLVED.** D5 now states the correction verbatim and accurately (action-scoped bookkeeping; verified dataflow-inspector.ts:183–197), splits Phase 0 counters from the Phase 1 provenance-joined profiler, and re-estimates M ("the draft underestimated it").
- **Major — D1 assumed the wrong manifest and conflated state models → RESOLVED.** D1 now builds on the viewport capability seam (verified end-to-end above), explicitly disclaims `capability.manifest.json` (verified: `"artifactKind": "capabilityManifest"`, cron/liveSubscriptions — backend capabilities), and carries the requested classification (ambient / permissioned sensor / provider connection per LLP 0034's axis (0034:81) / persisted preference / typed appGlue). Negotiation surface remains a declared open question, which is legitimate.
- **Major — D2 overstated formatting-level removal; no clock contract → RESOLVED** (with new minor table wobbles, below). The temporal inventory concedes the point ("The temporal inventory says otherwise"), keeps signal-level `now(granularity)`, and the "One clock authority" paragraph covers frozen-clock determinism (verified LLP 0027:422, 594, 709–723), G13 timezone debt (0029:62, :367), resume behavior, and observability requirements.
- **Major — D4 shallow default cannot memoize `boardTrains` → RESOLVED.** D4 now leads with the falsification (verified: fresh arrays of fresh spread objects, data.ts:598–610), ships opt-in `memo(comparator)` with a documented value domain, and adopts keyed structural sharing for list shapes.
- **Major — inventory incomplete (sixth seam; safe-area setter; `getSelectedStation` example) → RESOLVED.** Six-seam table includes `setRouteEstimateInvoker`+`routeCache` (verified data.ts:147–160, 951–954), qualifies `setSafeAreaInsets` correctly (no caller found repo-wide), and `getSelectedStation` no longer appears as a fresh-object example (replaced by `feedSourceBadge`, verified fresh at data.ts:1061–1078). One new error in this table (the `setMapsApp` "Read by" cell, below).
- **Major — ownership, rollout, acceptance gates missing → RESOLVED.** The Ownership section takes GPT's recast option explicitly (Snapback evidence + consumer requirements; normative designs land as Exact LLPs), matching LLP 0021's boundary text ("does not own: Contract language syntax, compiler semantics, or renderer internals... should record the dependency", 0021 "It does not own" section). Acceptance gates exist for D3/D1/D2/D5 with Phase 0 fixing the numbers; the "638... 96.7%" figure is now labeled illustrative.
- **Minor — G15 registration partial; metadata missing `Revised` → RESOLVED on registration** (G15 in the 0029 gap table at :64, body :414–449 with the corrected mechanism, sequencing entry 6 at :467–471; G9 refreshed off deleted `store.mjs` at :302–309; `Revised` header present in both docs). **PARTIAL on the authoring-authority citation** — see Concerns: the doc now cites LLP 0020, which does not support the claim.

**Claude review:**

- **Major #1 — recompute/apply conflation; D3 overstated on the DOM mirror (addendum: native scope needs rewriting) → RESOLVED.** The cost-model table is exactly the requested four-costs-×-removed-by shape; D3 now says plainly "What D3 does not do: make an idle tick free" and "D1/D2 are therefore not demoted to 'optimizations' — on the DOM mirror they are what keeps an idle app idle." The native rewrite is done and source-accurate.
- **Major #2 — D4 shallow vs `boardTrains` → RESOLVED** (as above; the revision chose the keyed-structural-sharing branch and documents the identity contract independent of adoption).
- **Major #3 — D1 delivery semantics unspecified (5 sub-questions) → RESOLVED.** The "Delivery semantics" paragraph answers all five: ordinary signal writes in the existing commit machinery with the `Object.is` skip; batched ≤ 1 commit/frame with correlated values in one batch (no tearing); initial value sync-where-possible with a typed pending arm; refcounted owner-disposed subscription; ordered with user actions. Initial-value timing is additionally kept as an open question for per-host detail. (One phrasing wobble on refcount scope — see Concerns.)
- **Major #4 — D2 formatting level vs the actual app (hero is a number + `departed` branch) → RESOLVED.** The deadline-returning temporal binding explicitly covers "bare minutes-as-number... with a `departed` logic branch — a fixed style vocabulary would have missed the RFC's own motivating case"; verified against the hero (`formatCountdownMinutes(...)` returns a number, data.ts:879–881, rendered `size=72` tabular-nums at app.contract:386) and the trip screen's `tripCall.departed` branch (app.contract:718–722).
- **Minors — all RESOLVED:** one comparator, two consumers (stated in D3); Alternatives section added (three requested items); acceptance criteria added (the D5 gate mirrors the suggested revert-quantization shape); the LLP 0027-as-authoring-model miscitation was swapped per the round-1 advice — but to LLP 0020, which is also wrong (see Concerns; round 1's own advice was faulty here). The review's suggestions (cache-buster lint, typed `appGlue`, LLP 0051 clock separation, derive-level attribution as a requirement) and open questions (shared minute timer, initial-value timing, separate recompute/re-fire columns) were all adopted or registered as open questions.

## Strengths

1. **The corrected mechanism is now verifiably true, per layer.** Every row of the D3 equality-landscape table checks out against the pinned sources, including the one round 1 never verified: DOM-mirror raw text is string-compared before writing (`appliedText.get(textNode) !== textNode.text`, dom-mirror.ts:1451–1453). The native raw-text hole is real and precisely described (host-ops.ts:3731–3746; view.ts:1946–1951), and the ENG-23161 remeasure cost is corroborated by the renderer's own comment (host-ops.ts:3619–3621).
2. **D1 stands on a real, shipped precedent rather than an imagined manifest.** Every property the delivery-semantics paragraph promises is demonstrated by the `viewport` capability today: batched signal writes inside `batch()` (host-capabilities.ts:370–377), owner disposal (:379), one refcounted host listener (:311–326), hydration replay (:342–346, 380–382), per-root instantiation (:5). "Build on the existing seam, not beside it" is the right call and is grounded.
3. **The cost model kills the draft's central conflation cleanly.** The four-cost table plus "Empty patch is not free tick" makes D3's role (host-boundary guarantee) and D1/D2/D4's role (app quiescence) impossible to confuse — exactly the round-1 ask, and consistent with the diary's residual-suspect note ("the every-5s pass still re-derives everything", diaries/0008:1654–1657).
4. **The inventories convert anecdotes into scope.** The six-seam table (five of six columns verified correct against main.ts:154/175, :203–232, :374/387, native.ts:64, data.ts:85, 147–160, 176, 293, 308–318, 330) is what makes D1's classification credible — and the classification correctly ejects the maps preference from D1's scope and defers backend state to LLP 0034's connection axis (0034:81).
5. **Ownership and registration are reconciled.** LLP 0029's working tree now carries G15 in the table (:64), body (:414–449, with the same corrected mechanism), and sequencing (:467–471); the subsumption claims (G9 + G14's binding half; layout half stays with Exact/Contract layout) match 0029's own G14 text ("surface bleeds, content insets", :408–409). LLP 0021's boundary is quoted accurately.
6. **Honest epistemics throughout:** the kernel-thread assertion is flagged as unverified from pinned sources; the old "638 nodes" number is labeled illustrative; the Revised header and Status section record exactly what the review round falsified.

## Concerns

- **minor — Six-seam table: `setMapsApp` "Read by: directionsLabel" is wrong.** `directionsLabel` (data.ts:916–918) reads only `effectiveEtaMode(station, mode)` — never the `mapsApp` module state. The actual readers are `mapsAppLabel` (data.ts:94–98, rendered as `mapsAppLabel(nowMs)` at app.contract:664 — incidentally a *view-expression-level* cache-buster) and the directions-URL glue (`getMapsApp`/`directionsUrl`, directions.ts:25, 65). Classification and invalidation columns are right. **Resolve:** change the cell to `mapsAppLabel` (+ directions glue).
- **minor — D2 temporal inventory: three cells overstate what the app actually does.** (1) Feed freshness is not "Xs ago" at "seconds" cadence: `feedFreshness` renders "Updated a few seconds ago" for the entire first minute, then per-minute "Updated Xm ago" (data.ts:998–1006) — its output changes at minute cadence. (2) Station-art rollover is epoch-day UTC midnight, not "service day" (data.ts:445–456, comment: "flips to the next scene at midnight UTC"). (3) "Service-day / schedule rollover" has no implementation in the model — the schedule is synthetic hour-slot patterns with no weekday/weekend or service-day calendar (model.mjs:375–397; my grep found no day-of-week logic) — so as a row in a table framed as "All Aboard's time dependencies, with their real cadences" it inventories the domain, not the app. None of this changes D2's two-piece conclusion (carried by the verified countdown/expiry/interpolation rows — data.ts:529–536, model.mjs:457–484). **Resolve:** correct the cadence cell to "minute" for freshness, "UTC day (service-day correctness is G13 debt)" for station art, and mark the service-day row as domain/aspirational or drop it.
- **minor — "Exact LLP 0293" is the wrong home for the kernel-fed capability line (cited twice: D1 and Ownership).** Per Exact-side verification supplied to this review, the viewport capability shipped under Exact LLP 0292 (the Host Input Capabilities Decision), whose line 117 tracks "native viewport wiring" as the follow-on; Exact LLP 0293 is the slides build diary that motivated it. The doc's citation follows a stale comment in the pinned source (host-capabilities.ts:340 "tracked in LLP 0293") — but the same file's later comment says "Native wiring is the tracked follow-on (LLP 0292)" (host-capabilities.ts:362). The Ownership sentence "the kernel-fed capability line is already Exact LLP 0293" makes a diary the normative owner, which weakens the very point it is making. **Resolve:** cite Exact LLP 0292 as the owner in both places (optionally keep 0293 as the motivating diary).
- **minor — "LLP 0020's authoring surface" does not support the paved-road claim.** Snapback LLP 0020 is the *data-tier* core authoring surface (manifest packages, `ctx.db` handlers, read-set capture, realtime — see its Summary); it says nothing about pure helpers returning objects called from view expressions. Round 1 (Claude) told the author to cite 0020, and that advice was itself wrong — the GPT round's version ("cite the relevant Exact authoring authority — or soften") was the correct instruction. The idiom claim is true in practice (demonstrated throughout LLP 0027, Diary 0008, and the app itself), so only the citation needs fixing. **Resolve:** drop the 0020 cite; either cite the Exact-side Contract authoring authority or rest the claim on "practiced throughout LLP 0027 and Diary 0008," which verification supports.
- **minor — D1's refcount phrasing mismatches its own precedent, and the difference matters for permissioned sensors.** The doc promises "one refcounted host subscription per capability **per root**"; the viewport pattern it cites keeps ONE process-wide host listener refcounted across all consumers, with per-root capability instances subscribing into it (host-capabilities.ts:299–327 — the window listener is added once and removed when the set empties). For viewport the distinction is cosmetic; for geolocation, N roots ⇒ N `watchPosition` sessions is a real cost/permission-UX difference from one shared watch. **Resolve:** one sentence choosing (and I'd match the precedent: shared refcounted host watch, per-root signal fan-out) or explicitly deferring per-capability.

## Suggestions

- **Guard the D3 text-skip against a specific implementation trap:** `updateTextContent` currently assigns `instance.text = newText` *before* emitting (host-ops.ts:3732); a comparison added after that assignment would always be equal and would skip every text update. The skip must compare before the assignment. Worth one sentence in D3 so the Exact-side implementer inherits the trap warning. (The suspense-hidden path already demonstrates skip-in-`updateTextContent` is architecturally safe, and `unhideTextInstance` restores via `setTextContent` directly, so the unhide path survives an equality skip — host-ops.ts:3736–3740, 3717–3726.)
- **Correct the record the RFC supersedes.** Diary 0008 (:1671–1686, "what lands in the patch is decided by REFERENCE, not value... regardless of where JS ran") and the app-code comment (data.ts:197–204) still carry the falsified native mechanism; both are cited by this RFC and by `@ref LLP 0052` annotations. A one-line correction pointer in each (→ LLP 0052's per-host table) prevents the next reader from re-learning the wrong fact from the incident record.
- **Extend the D5 lint's stated scope to view-expression cache-busters.** `text mapsAppLabel(nowMs)` (app.contract:664) is the same convention at the view edge; the helper-signature lint catches it via `mapsAppLabel(_tick?)` (data.ts:94), but saying "helper parameters *and* time-typed arguments to non-time-branching calls in view expressions" makes the acceptance gate ("no derive takes a time parameter it does not branch on") cover the app's actual usage.
- **Name the cross-capability coalescing requirement as a conformance check.** "A rotation changing insets and viewport [delivered] in one batch" spans two capabilities with different host feeds; that is a per-host conformance test in the LLP 0034 posture (named checks), not an automatic property of per-frame batching. One line in D1 or the acceptance gates.
- **Add a D4 gate.** The gates cover D3/D1/D2/D5; a D4 shape like "`boardTrains` under `memoRows(key)` keeps row references stable across a value-equal recompute, observed as zero downstream re-fires in the D5 counters" would make the set complete.
- **Metadata:** add LLP 0016 and LLP 0051 to Related (both are load-bearing citations in Motivation/Alternatives and D2/Non-goals). Note also that in this repo `llp/0005` is the Contract/Exact/React integration explainer, not the review process — the Related entry and "LLP 0005 loop" reference are following an established repo convention, but a parenthetical would spare a literal reader; Snapback 0005's open questions (capability-artifact split) are in fact relevant to D1's negotiation-surface question and could be cited there deliberately.

## Open Questions

Beyond the doc's own (which are the right ones — comparator domain, D1 negotiation surface and initial-value timing, D2 shape and timer alignment, kernel trace, D5 columns, Exact LLP mapping):

- For permissioned sensors, is the host subscription shared-and-refcounted process-wide (the viewport pattern) or per-root? (Concern 5 — the answer changes GPS/permission behavior for multi-root hosts.)
- Does `publishHostState` (the `appGlue` write side) run through the same batching/equality machinery as host-written bindings, and what — beyond declaration — discourages routing high-frequency app data through it (the event-bus failure mode the doc itself names)?
- When D1 lands and the `nowMs` parameters disappear from glue derives, what invalidates a derive reading `routeCache` when the estimate promise resolves? The classification labels it "async query results" — does that migrate to a `query`-like binding, an `appGlue` publish on promise completion, or D2's clock? The table marks the seam but the migration target is the one cell of the classification left implicit.
- Should Phase 0's counters also record DOM-mirror traversal cost (the `ensureDom` walk still visits every node on reference-missed subtrees even when D3 skips the writes), so the web residual after D3 is attributable?

## Recommended Next Step

Apply the pinpoint corrections in place (four table/citation cells: `directionsLabel`→`mapsAppLabel`; the three temporal-inventory cells; 0293→0292 twice; drop/replace the LLP 0020 cite) plus the refcount-scope sentence, and fold the suggestions at author's discretion. No third independent review round is needed for these — they touch no design decision. Then the author can move the document out of Draft per LLP 0005 (the author decides), and start Phase 0, which is correctly sequenced first and will retire the two remaining asserted-not-measured claims (kernel thread; cascade magnitude).

## Verdict

SATISFIED — remaining items are author's-discretion nits. Every round-1 blocking and major concern is genuinely resolved and re-verified against the pinned sources; the issues this round found are minor, pinpoint factual corrections (two table cells, two citations, one phrasing) that do not bear on any of the five design decisions or the sequencing.

---

# Round 3 re-review (2026-07-11, post-round-2-revision draft)

**Reviewer family:** Claude
**Provider / runtime:** claude-code fresh-context subagent (Claude Fable 5,
general-purpose agent), orchestrated by the session that applied the round-2
revision (the reviewer itself is a fresh context and did not author any
revision)
**Date:** 2026-07-11
**Redacted:** No — full local repository access; `.agent-local-secrets.md`
was not read.
**Method:** Fresh-context sub-agent review of the round-2-revised
working-tree draft, with a round-2 resolution check against both prior
artifacts and verification of the revision's new claims against the pinned
`@exact/renderer` / `@exact/contract` 0.1.2 sources, the All Aboard app, and
the three companion edits (Diary 0008 erratum, `data.ts` comment, LLP 0029
G15). Run concurrently with, and independent of, the Codex round-3
re-review. Cross-repo Exact-side facts (LLP 0292 vs 0293) supplied by the
orchestrator as previously verified. The orchestrating session independently
re-verified this review's decisive factual catches (the hidden-reads
paragraph's two errors; the contract-meta declaration facts) before relying
on them in revision.
**Verdict:** SATISFIED — remaining items are author's-discretion nits.

## Overall Assessment

The round-2 revision does what it says it did. I re-verified every load-bearing claim in the newly written surfaces against the pinned `@exact/renderer` / `@exact/contract` 0.1.2 sources (paths below under `demos/all-aboard/surfaces/contract/node_modules/@exact/`), the All Aboard app, and the companion documents, without reading either prior review's verdict-bearing sections until my own source checks were done on each claim. The results: D1's value-delivery and subscription paragraphs now describe exactly the shipped viewport mechanism (`width`/`height` signals behind a getter facade whose identity never changes, host-capabilities.ts:368–391; one shared lazily-installed listener that installs with the first subscriber and uninstalls with the last, :299–327; owner disposal, :379); the batching paragraph's "what exists today" matches `batch()`'s synchronous outermost-exit flush (signals.ts:538–549) and correctly labels the cross-capability transaction as new work; the corrected six-seam table's maps row matches the glue (boot restore `installDirections` → `setMapsApp`, directions.ts:62–68; Settings via `cycleMapsApp` in a DOM click handler, :136–148; readers `mapsAppLabel` at data.ts:94–98 rendered `mapsAppLabel(nowMs)` at app.contract:664, plus `getMapsApp` glue at directions.ts:39–43, :131); every corrected D2 temporal cell matches the app (freshness minute-buckets, data.ts:1007–1009; station art epoch-day UTC, :452–458; no service-day calendar, model.mjs:375–396; stale deadline `nowMs - fetchedAt <= staleAfterMs`, data.ts:1073–1075; route TTL on an independent `Date.now()`, :941–956; `formatCountdownMinutes` = `Math.ceil((targetMs - nowMs) / 60000)`, model.mjs:505–507; departure grace filter, data.ts:535); and D5's honesty note matches the runtime (derives are unlabeled `ownedComputed`s, instance.ts:472–479, with generic `computed:N` meta, signals.ts:213–224, while the compiler demonstrably holds names and spans — `errorLocus('derive "…"', derive.span)` at instance.ts:474 — and `reactiveChurn` per-node counters exist, signals.ts:49–65, :964–977). The three companion edits are all real and accurate: the diary erratum is appended, dated, self-declared append-only, and correct (diaries/0008:1705–1737, original entry untouched at :1671–1686); the `data.ts` `@ref LLP 0052` comment now tells the corrected per-host story (:194–207); 0029's G15 body and sequencing carry the corrected mechanism and the deadline-model D2 line (0029:414–452, :470–474).

What I found beyond that is small but real: the round-2 revision introduced three new factual defects, all minor and none touching a design decision. Two cluster in the new hidden-reads paragraph — `feedSourceBadge` is *not* declared in `data.contract-meta.ts` (the paragraph says all three named helpers are), and the claim that "D5's declare-and-ignore lint flags exactly the helpers that need this surgery" is false for all three helpers the paragraph itself names. The third is the new cost-model cell's "the walk visits touched subtrees": the DOM mirror's walk visits the *entire* synced root tree on every commit (reconcileChildren is called unconditionally at dom-mirror.ts:1489; sync runs per commit at host-ops.ts:3833–3838), which is what round-2 Codex correctly said and the revision softened into an inaccuracy. These are pinpoint edits of the same shape the round-2 Claude leg's minors were — table/paragraph corrections, not design problems.

## Round-2 Resolution Check

**Codex round-2:**

- **Major 1 — D1 recreates the identity problem for structured host values: RESOLVED.** "Value delivery and equality" (RFC:287–298) requires per-capability canonicalization at the write boundary, scalar field signals behind a stable facade — verified as literally the shipped viewport shape (signals at host-capabilities.ts:368–369, getter facade :384–391) — plus a declared equality relation for record values applied before writing, with the exact conformance shape the review asked for ("delivering the same value N times produces no signal writes after the first — per capability, per host"), repeated as a named behavioral check in the D1 gate (RFC:630–632).
- **Major 2 — frame batching / no-tearing lacked a mechanism; subscription model misdescribed: RESOLVED.** "Batching, ordering, and atomicity" (RFC:300–309) separates what exists (one `batch()` per host event flushing synchronously at outermost exit — verified signals.ts:538–549 and the viewport `applySize` at host-capabilities.ts:370–377) from what is new work (the cross-capability root-scoped transaction, gated by a named per-host conformance check), states an ordering rule, and explicitly does not promise frame coalescing (kept as an open question, RFC:675–677). "Subscription lifecycle" (RFC:316–326) is now the two-level model matching the precedent: per-root owner-disposed instances over one shared refcounted physical subscription, with "N roots must mean one `watchPosition` session" called out as load-bearing.
- **Major 3 — six-seam inventory factually wrong, hidden reads, no migration targets: RESOLVED, with two new pinpoint defects in the added paragraph (Concern 1).** The maps row now matches the glue end-to-end (verified above); the scheme cell names `themePalette` via `isDark()` (data.ts:212) plus hidden reads in `serviceTint` (:893) and `feedSourceBadge` (:1057); the backend cell names `backendStatusNote` (:341) plus the hidden read in `feedFreshness` (:1006); a "Migrates to" column exists for all six seams, including the previously implicit route-cache answer (resource seam, TTL to D2's clock authority); and the hidden-reads paragraph (RFC:196–204) states the substantive requirement — explicit dependencies before the tick can be deleted. The two defects are in that paragraph's supporting facts, not its requirement.
- **Major 4 — D2's "real cadences" were not the app's; wall-minute semantics wrong: RESOLVED.** Every row I checked now matches the shipped code (citations in the assessment above); the service-day row is replaced by an honest domain-debt parenthetical (RFC:368–371); deadline-driven invalidation is the shared primitive with `now(granularity)` explicitly demoted to periodic-deadline sugar and the up-to-~59-s-late failure of a wall-aligned timer stated (RFC:373–387); "One clock authority, with defined semantics" (RFC:403–421) turns the previously undefined behaviors into five enumerated rules (jumps, resume catch-up, hydration release, frozen-clock determinism, owner-scoped disposal including the route-TTL migration).
- **Major 5 — cited provenance cannot name upstream derives: RESOLVED.** Phase 1 (RFC:539–559) now states the limitation exactly as the runtime has it (terminal bindings only; unlabeled `ownedComputed` with `computed:N` ids — verified instance.ts:472–479, signals.ts:213–224), grounds "the compiler already holds the ingredients" in the `errorLocus` wrapping (verified :474–476), scopes Phase 1's substrate as compiler-authored labels plus a causal ID, defines "top source" as the first changed derive on the causal chain with allocation churn separate, and rebases Phase 0 on the existing churn counters (verified signals.ts:49–65, :964–977) with the M re-estimate.
- **Minor — D4 composition unstated, no gate: RESOLVED.** The bottom-up sharing rule (rows → arrays → outer record, RFC:497–506) answers the composition question, states what still runs vs what stops, and the D4 gate (RFC:639–642) is the requested unchanged-board plus one-row-changed pair, observed in the D5 counters.
- **Minor — D3 web cost / DOM-observable snapshot / topology qualifier: PARTIAL.** All three asks were adopted — the cost-model row exists (RFC:236), the DOM-observable snapshot domain is defined with the wider-than-native enumeration (RFC:441–448), and the D3 gate requires unchanged topology and child order with the traversal residual explicitly measured-not-gated (RFC:621–626) — but the added row's "visits touched subtrees" misdescribes the traversal it was added to document (Concern 2).
- **Minor — cascade magnitude overstated: RESOLVED.** The Summary now says "20 of the app's 28 top-level derives take the clock directly; Phase 0 measures the true fan-out" (RFC:50–52) — I recounted the derive block (app.contract:123–155): 28 derives, exactly 20 taking `nowMs` directly. Remaining "every reader"/"every dependent" phrasings are scoped to dependents of fresh-returning derives, which is mechanically true (signals.ts:706–709).
- **Minor — citations and corpus reconciliation: RESOLVED.** Exact LLP 0292 is now the cited owner in D1, Ownership, and Related (RFC:41, :260–263, :585), with 0293 mentioned only to explain the stale pinned-source comment — matching the orchestrator-verified Exact-side facts and the pinned file itself (stale "LLP 0293" at host-capabilities.ts:340, correct "(LLP 0292)" at :362). The LLP 0020 cite is gone; the idiom claim now rests on the declared-pure boundary "mirroring the Exact-side caltrain corpus this app was copied from" — which data.contract-meta.ts:2 literally states — plus LLP 0027 and Diary 0008. The diary erratum and `data.ts` comment corrections exist and are accurate (verified above), satisfying the LLP 0016 append-only posture.

**Claude round-2:**

- **Minor — maps "Read by: directionsLabel" cell: RESOLVED.** The cell now reads `mapsAppLabel` (with the view-expression cache-buster note) plus the directions-URL glue via `getMapsApp` — all verified (data.ts:94–98, app.contract:664, directions.ts:39–43).
- **Minor — three temporal cells: RESOLVED.** Freshness → minute; station art → UTC epoch day with G13 debt noted; service-day row → honest "no service-day calendar exists" parenthetical (RFC:359–371; verified against data.ts:1007–1009, :452–458, model.mjs:375–396).
- **Minor — 0293→0292 twice: RESOLVED** (see citations bullet above).
- **Minor — LLP 0020 cite: RESOLVED** (see citations bullet above).
- **Minor — refcount phrasing (per-root vs shared physical subscription): RESOLVED.** The doc now matches the precedent exactly — shared refcounted physical subscription, per-root fan-out — and elevates the geolocation consequence (one permission prompt, one radio) to a stated requirement (RFC:316–323).
- **Suggestions — all six adopted, verified:** compare-before-assign trap note in D3 (RFC:455–459; the trap is real — `instance.text = newText` at host-ops.ts:3732 precedes the emit at :3745); unhide-path safety note (RFC:459–461; `unhideTextInstance` re-emits directly, host-ops.ts:3717–3726, suspense skip at :3738–3740); view-expression lint scope (RFC:561–565); cross-capability conformance check (RFC:305–307, :630–632); D4 gate (RFC:639–642); Related metadata now carries LLP 0016, LLP 0051, the LLP 0005 parenthetical distinguishing this repo's 0005 from the process guide, and Exact LLP 0292 (RFC:37–41).
- **Open questions — addressed:** subscription sharing resolved in text (shared, refcounted); `publishHostState` runs through the same canonicalization/equality/batching machinery with the classification routing high-frequency data away from `appGlue` (RFC:335–342); the route-cache migration target is now an explicit table cell (resource seam, not `appGlue`); Phase 0's counter list includes mirror-traversal visits (RFC:529–530).

## Strengths

1. **The new text is verifiably accurate where it matters most.** Every mechanism claim added in the round-2 revision that a design decision rests on — the viewport facade shape, the batch-flush semantics, the two-level subscription model, the deadline math (`Math.ceil((targetMs - nowMs) / 60000)`, model.mjs:505–507), the D5 labeling gap and its compiler-held ingredients — checks out against the pinned sources at the cited granularity. After two rounds of falsified mechanism claims, this revision's fact base holds.
2. **Honest epistemics as a structural habit.** The batching paragraph's "what exists today" vs "what is new work, not an assumed property" split, the frame-coalescing non-promise routed to Phase 0 measurement, the kernel-thread assertion still flagged as trace-pending, and the "these are the code's cadences, not the domain's" framing on the temporal table are exactly the discipline the round-1/round-2 failures called for.
3. **The deadline-driven D2 is now the strongest section.** Grounding target-relative invalidation in three verified in-app deadlines (countdown flips, departure grace, feed staleness) and demoting `now(granularity)` to sugar resolves the wall-alignment question correctly rather than by fiat; the five clock-authority rules convert G13-adjacent debt into testable behavior.
4. **Companion errata done right.** The diary erratum corrects the record without rewriting it (append-only, per LLP 0016), quotes the exact falsified sentences, and states what stands; the `data.ts` comment now teaches the next reader the corrected per-host mechanism at the exact site of the mitigation; G15 and the RFC agree cell-for-cell.
5. **The acceptance-gate set is now complete and behavioral.** All five D-items have gates; D1's are per-host named checks in the LLP 0034 posture (equal-fresh-record no-propagation; correlated-capability single commit); D4's is observable in the D5 counters; D3's carries the topology qualifier and explicitly excludes the traversal residual it cannot deliver.

## Concerns

- **minor — The hidden-reads paragraph contains two factual errors about its own three named helpers.** (1) It claims `serviceTint`, `feedSourceBadge`, and `feedFreshness` are "helpers that `data.contract-meta.ts` declares `pure({ depends: 'args' })`" (RFC:197–199) — `serviceTint` (data.contract-meta.ts:35) and `feedFreshness` (:46) are, but `feedSourceBadge` appears nowhere in that file (41 `pure()` entries; it is `use`d undeclared, app.contract:101). (2) "D5's declare-and-ignore lint flags exactly the helpers that need this surgery, so the two land together" (RFC:203–204) is false for all three named helpers: `serviceTint` takes no tick parameter at all (data.ts:890; called with only a service argument at app.contract:390, :451, :480, :709 — its scheme pickup rides transitively on clock-fed composite re-fires, so "the tick argument is what papers over the inaccuracy" is also imprecise for it), while `feedSourceBadge` and `feedFreshness` genuinely read their `nowMs` (data.ts:1075, :1007) and are therefore not declare-and-ignore cases. The lint catches a *different* set of hidden-read helpers — `themePalette(_tick?)` (:211), `mapsAppLabel(_tick?)` (:94), `backendStatusNote(_tick?)` (:340) — and misses precisely the three the paragraph names. The migration requirement itself (explicit dependencies) is stated correctly and the inventory names the helpers, so no design decision changes — but the coupling sentence would mislead a migration executor into treating the lint as the surgery enumerator. **Resolve:** correct the declaration claim (two of three declared; `feedSourceBadge` undeclared — itself evidence for the "grow a contract-meta declaration" option), and replace "flags exactly the helpers that need this surgery" with an honest split: the lint catches the declare-and-ignore class; hidden reads inside genuinely-time-branching or tick-free helpers need the inventory (or a purity-conformance check — see Suggestions).
- **minor — The cost-model's mirror row understates the traversal it was added to document.** "the walk visits touched subtrees and allocates per-parent bookkeeping even when D3 skips every write" (RFC:236) — in the pinned mirror, `ensureDom` calls `reconcileChildren` unconditionally, outside the props-reference fast path (dom-mirror.ts:1482–1489), `reconcileChildren` maps *every* child through `ensureDom` and allocates the per-parent `desired` array and `desiredSet` (:1521–1522), and `sync(root)` reconciles from the root down after every commit (:1547–1552; invoked per commit at host-ops.ts:3833–3838). The walk therefore visits the entire synced root tree per commit, not touched subtrees — "touched subtrees" describes the dirty-subtree propagation round-2 Codex *suggested as future work*, not what exists. The row's conclusion (this cost is D1/D2/D4's to remove) survives and is in fact strengthened. **Resolve:** one-cell edit — "the walk visits every node of the synced root and allocates per-parent bookkeeping even when D3 skips every write."
- **minor — Phase 0's effort label is internally inconsistent.** Sequencing says "Phase 0 instrumentation (S)" (RFC:569), but D5's own Phase 0 text says "The JS half is S, not M … The native layout/thread trace is the M half" (RFC:533–536) — and that trace is load-bearing (it answers the kernel-thread open question). **Resolve:** label it "(S JS half; M native trace)" in Sequencing, or move the trace explicitly out of the "measurement first" gate.

## Suggestions

- **Name the check that actually covers the named hidden readers.** The statically detectable smell for `serviceTint`/`feedSourceBadge`/`feedFreshness` is not an ignored parameter but a module-state read inside a helper declared `pure({ depends: 'args' })` — a purity-conformance lint (or runtime dev assertion) distinct from the declare-and-ignore lint. One sentence in D5's static complement would make the "the two land together" claim true instead of wrong, and it also covers the undeclared-helper hole (`feedSourceBadge`, `backendStatusNote` are `use`d without any contract-meta declaration).
- **Pin down whether a fully value-equal pass still commits under D3.** Today the mirror sync is tied to the commit tail (host-ops.ts:3828–3838); whether a D3-skips-everything pass still constitutes a commit (and thus a full-tree walk) determines how much of the traversal residual Phase 0 should expect to see. Worth a clause in the D3 section or the Phase 0 counter list.
- **Consider noting in the inventory that two of the six seams' readers are undeclared helpers.** The table's credibility comes from being checkable; flagging `feedSourceBadge`/`backendStatusNote` as undeclared-at-the-meta-boundary makes the "grow a contract-meta declaration for helper→binding dependencies" migration option concrete.

## Open Questions

- Should the D5 static complement include the purity-conformance check above as a named deliverable, given the declare-and-ignore lint provably cannot see the three helpers the hidden-reads paragraph names?
- When D1 deletes the scheme/backend seams, what re-fires the view-expression calls of tick-free helpers like `serviceTint(d.service)` — does the migration rewrite them to take the binding's value as an argument (the paragraph's option (a)), and does the D2 gate's "no derive or view expression takes a time parameter it does not branch on" need a sibling clause for helpers that read *host bindings* implicitly?
- Does the mirror-sync-per-commit coupling mean the D3 web gate ("zero DOM mutations") should also assert an upper bound on traversal visits for the value-equal commit, once Phase 0 fixes the numbers?

## Recommended Next Step

Apply the three pinpoint corrections in place (the hidden-reads paragraph's two sentences; the cost-model cell; the Phase 0 effort label) — they touch no design decision, gate shape, or sequencing choice, and need no further cross-family round. Then the author can move the document out of Draft per the LLP process (the author decides) and start Phase 0, which remains correctly sequenced first and will retire the two still-asserted claims (kernel thread; true cascade magnitude).

## Verdict

SATISFIED — remaining items are author's-discretion nits. All five round-2 Codex majors and both rounds' minors are genuinely resolved and re-verified against the pinned sources and the app; the three defects this round found are pinpoint factual corrections in supporting prose (two sentences and one table cell) that do not bear on any of the five design decisions, the gates, or the sequencing.

---

# Round 4 re-review (2026-07-11, post-round-3-revision draft)

**Reviewer family:** Claude
**Provider / runtime:** claude-code fresh-context subagent (Claude Fable 5,
general-purpose agent), orchestrated by the session that applied the round-2
and round-3 revisions (the reviewer itself is a fresh context and did not
author any revision)
**Date:** 2026-07-11
**Redacted:** No — full local repository access; `.agent-local-secrets.md`
was not read.
**Method:** Focused fresh-context sub-agent re-review of the
round-3-revised working-tree draft, with a round-3 resolution check against
both prior artifacts and independent verification of the revision's new
claims — including an independent enumeration of every module-state reader
of `colorScheme`, `deviceLocationSource`, `backendState`, and `mapsApp` in
the app sources, and a use-vs-declared diff against the complete
`data.contract-meta.ts`. Run concurrently with, and independent of, the
Codex round-4 re-review.
**Verdict:** SATISFIED — remaining items are author's-discretion nits.

## Overall Assessment

The round-3 revision genuinely resolves the round-3 concerns, and I verified its new claims against the code rather than taking the document's word. The centerpiece — the four-class hidden-reads audit — is correct in every class assignment I checked: the five `isDark()` callers are exactly the five helpers the scheme row and audit name (data.ts:214 `themePalette`, :388 `locationIndicatorColor`, :655 `delayColor`, :895 `serviceTint`, :1059 `feedSourceBadge`); the three `deviceLocationSource` readers are exactly `locationSource`/`locationHint`/`locationIndicatorColor` (data.ts:363, :374, :387); the two `backendState` readers are exactly `backendStatusNote`/`feedFreshness` (data.ts:343, :1008); `serviceTint(service)` and `delayColor(departure)` have no time parameter (data.ts:892, :653) and their call sites take arguments from clock-fed composites (app.contract:390/:451/:480/:709, :393), so the "stale after clock deletion, invisible to any parameter lint" claim is mechanically right; `feedFreshness` and `feedSourceBadge` genuinely use `nowMs` (data.ts:1009, :1077) while also reading backend state and scheme (:1008, :1059); and `feedSourceBadge`/`backendStatusNote` are `use`d (app.contract:101–102) with no entry anywhere in the complete 41-entry `data.contract-meta.ts` (verified by reading the whole file, lines 9–49, and a use-vs-declared diff). The distinct-helper count is ten, as the body says (RFC:215). The two-check enforcement (declare-and-ignore lint plus the purity-conformance check, RFC:242–245, named as the second D5 static deliverable at RFC:630–635) plus the frozen-clock flip backstop in the D1 gate (RFC:705–707) close the staleness hole that made round-3 Codex NOT SATISFIED. All eight Codex precision minors and all three Claude prose defects are fixed, and the fixes verify against the pinned sources: `batch()` applies writes immediately and flushes at outermost exit (signals.ts:538–550); the shared viewport listener fans out to per-root subscribers that each batch their own writes (host-capabilities.ts:307–327, :370–379), so "at most one effect flush per root per host event" is exact; the mirror walk really does visit every node of the synced root per commit (`reconcileChildren` unconditional at dom-mirror.ts:1489, per-parent `desired`/`desiredSet` allocations at :1521–1522, root-down `sync` at :1547–1552, invoked per commit at host-ops.ts:3833–3838); the compare-after-assign trap and unhide re-emit are real (host-ops.ts:3732/:3745, :3717–3726); the fresh-at-exact-equality staleness boundary is in the code (`nowMs - fetchedAt <= staleAfterMs`, data.ts:1077); and the narrowed palette comment is on disk (data.ts:206–209). What I found beyond that is small: the Revised header miscounts the audit it summarizes ("nine helpers" vs the body's ten), and the audit's exhaustiveness framing quietly stops at four module-state kinds while the location seam's *value* side has five more declared-pure helpers reading `deviceLocation` inside their bodies — mislocated by the inventory cell "getUserLocation() in derives," which names a call site that does not exist. Neither touches a design decision, a gate, or the sequencing.

## Round-3 Resolution Check

**Codex round-3 major — hidden-reader inventory incomplete; lint provably blind to tick-free and time-branching readers: RESOLVED.** Every specific omission Codex named is now present and correct: the scheme row names `serviceTint`, `delayColor`, `locationIndicatorColor`, `feedSourceBadge` as hidden readers (RFC:202; verified as the complete `isDark()` caller set); the location row names the three source readers (RFC:204; verified complete against `deviceLocationSource`); class (d) states `feedSourceBadge` and `backendStatusNote` are undeclared (RFC:234–236; verified against the whole meta file); the lint-coverage gap is now stated outright ("No parameter lint can see them," RFC:230, and "really use their `nowMs`… Not declare-and-ignore cases," RFC:231–233). Each of Codex's four prescribed remedies landed: the audit (RFC:214–237, exhaustive within its four state kinds — my greps found no additional readers of `colorScheme`, `deviceLocationSource`, `backendState`, or `mapsApp`), corrected metadata facts (RFC:234–237), the helper→binding dependency declaration option plus global-read purity analysis (RFC:239–245, formalized at RFC:630–635), and the frozen-clock scheme/location/backend flip tests (RFC:705–707). Residue documented under Concerns: the audit's scope framing and one inherited table-cell inaccuracy, both prose-level.

**Codex round-3 minors:**

1. *D1 blurs existing vs proposed; "one commit per host event": RESOLVED.* Now "at most one effect flush per root per host event… not one global commit" (RFC:347–349), with the write-immediate/flush-deferred `batch()` semantics stated exactly as implemented (signals.ts:538–550), and the requested staging rule for publications arriving during an action's batch (RFC:350–353). One placement nit remains (Suggestions).
2. *Three D2 precision edges: RESOLVED.* Fresh-at-exact-equality/flips-strictly-after in the live→stale cell (RFC:416; matches data.ts:1077); function-vs-sampling cadence in the interpolation cell (RFC:417; the 5 s bucket matches the quantized ticker, RFC:252); host-timezone changes in the clock-labels cell (RFC:414); the boundary convention (RFC:440–443) and the timezone-generation input (RFC:466–469) both added, internally consistent (a deadline names the first instant the predicate may differ, so inclusive predicates flip on the strictly-after evaluation).
3. *D3 traversal understated; one-sided gate: RESOLVED.* Cost-model cell now "visits every node of the synced root per commit" (RFC:281; verified above); the D3 gate is two-sided with exactly the two requested cases — changed text → exactly one op, hidden-then-unhide → re-emit — and states that compare-after-assign cannot pass (RFC:694–698).
4. *D4 changed-row gate overpromises: RESOLVED.* Narrowed to "only that row's bindings *among the keyed rows*," with the outer record's necessary identity change and D3-bounded outer-field observers stated (RFC:717–721), plus the field-level-signals alternative as a new open question (RFC:764–766). The narrowing is consistent with the bottom-up sharing rule (RFC:560–568).
5. *Absolute cascade wording outside the Summary: RESOLVED.* The mitigation bullet now says "recomputes the clock-fed derives and re-fires the effects whose dependency versions advanced" (RFC:254–256); the cost-model intro says "the clock-fed derives still recompute and their downstream effects still re-fire wherever a fresh composite advanced a version" (RFC:270–272). Remaining "every reader/dependent" phrasings (RFC:74–75, :143) are scoped to dependents of a fresh-returning derive, which is mechanically true.
6. *`appGlue` example contradicts the classification: RESOLVED.* The example is now explicitly the read-only projection of LLP 0034's lifecycle axis — "the glue publishes what the adapter reports; the app does not re-own the lifecycle" (RFC:382–386) — consistent with the backend row's migration cell (RFC:206) and the "exactly one of the six seams through `appGlue` at most" routing (RFC:395–396). Codex offered two acceptable fixes; the revision took the projection option.
7. *D5 gate lacks attribution test; example miscredits themePalette with text ops: RESOLVED.* The example now reads "638 host-update attempts… themePalette (312 attribute attempts), boardTrains (183 text attempts)" (RFC:617–619), and the D5 gate gained the derive→binding diamond fixture requiring both the terminal binding and the first-changed upstream derive under fan-in (RFC:725–727).
8. *Palette companion comment overclaims: RESOLVED.* The comment now ends "Stable identity per scheme stops the THEME-DRIVEN share of both at the source… clock-fed bindings that don't read the palette still re-fire until the LLP 0052 framework work lands" (data.ts:206–209).

**Claude round-3 concerns:**

1. *Hidden-reads paragraph's two factual errors (feedSourceBadge declared; "lint flags exactly the helpers"): RESOLVED.* The declaration claim is inverted into class (d) (RFC:234–236, correct), and the lint claim is replaced by the honest split — lint for class (a) only, purity-conformance check for the rest (RFC:242–245).
2. *Mirror cost-model cell "touched subtrees": RESOLVED.* Now "visits every node of the synced root per commit" (RFC:281), which I re-verified against dom-mirror.ts:1489/:1521–1522/:1547–1552 and host-ops.ts:3833–3838.
3. *Phase 0 effort label inconsistency: RESOLVED.* Sequencing now reads "Phase 0 instrumentation (S JS counters; M native trace)" (RFC:638), matching D5's own S/M split.

**Claude round-3 suggestions:** (1) purity-conformance check named as a deliverable — ADOPTED (RFC:630–635); (2) whether a fully value-equal pass still constitutes a commit — ADOPTED, routed to the Phase 0 traversal residual (RFC:511–513); (3) flag the undeclared readers — ADOPTED in the audit paragraph directly under the inventory (RFC:234–236) rather than in the table cells; substance delivered.

## Strengths

1. **The audit is verifiably correct where the round-3 major demanded it.** Within its four state kinds it is genuinely exhaustive — I independently enumerated every module-state read of `colorScheme`, `deviceLocationSource`, `backendState`, and `mapsApp` in data.ts and found exactly the ten helpers, in exactly the classes assigned. After a round in which this paragraph was the document's weakest surface, it is now its best-evidenced one.
2. **Enforcement now matches the failure taxonomy.** The two-check split (parameter lint for declare-and-ignore; purity-conformance for tick-free, time-branching, and undeclared readers) plus the frozen-clock flip backstop is layered so that no single class of hidden reader can slip through to the stale-UI outcome the round-3 major feared — and the D1 gate's requirement that the seam table *deletes* means the module state the hidden readers consult ceases to exist, a hard compile-level backstop behind the behavioral one.
3. **Precision commitments are stated as conventions, not vibes.** The deadline boundary convention (RFC:440–443), the timezone-generation input for deadline-less formatters (RFC:466–469), and the per-root-flush phrasing (RFC:347–349) each turn a round-3 nitpick into a testable rule, and each one I could ground in the pinned sources checks out.
4. **The gates got adversarial.** The two-sided D3 gate is explicitly designed so the one implementation bug the document itself warns about (compare-after-assign, real at host-ops.ts:3732) cannot pass; the D4 gate now promises only what the described mechanism can deliver; the D5 attribution gate tests the report's hardest case (fan-in) rather than its easiest.

## Concerns

- **minor — The Revised header miscounts its own audit: "nine helpers in four classes" vs. the body's ten.** RFC:9–10 says "the hidden-reads audit made exhaustive and honest — nine helpers in four classes"; the audit itself says "ten helpers read scheme, location source, backend state, or the maps preference" (RFC:215), and the classes enumerate 6 + 2 + 2 = ten distinct helpers (class (d)'s two both appear in earlier classes). Ten is correct against the code. Introduced by this revision; one-word fix in the header.
- **minor — The audit's exhaustiveness framing stops at four state kinds, and the location row's value-side cell names a call site that does not exist.** The inventory says the location seam is "Read by: `getUserLocation()` in derives" (RFC:204), but `getUserLocation` appears in zero derives — app.contract never references it; its only callers are inside five other data.ts helpers, all declared `pure({ depends: 'args' })` in contract-meta: `getSelectedStation` (data.ts:426), `searchStations` (:434), `effectiveEtaMode` (:908), `walkBikeSummary` (:972, reaching `walkBikeLine`), and `distanceLabel` (:994). Those are hidden readers of the location seam's *value* in precisely the audit's sense — declared-pure helpers reading `deviceLocation` module state inside their bodies, invalidated today only by the tick (`derive station = getSelectedStation(stationId, nowMs)`, app.contract:123; `derive walkBike = walkBikeLine(station, etaMode, nowMs)`, :147) — yet the ten-helper enumeration excludes them via the phrase "location source," and the header calls the audit "exhaustive." Similarly, class (d)'s "undeclared helpers" names two, but eleven `use`d helpers have no contract-meta entry (my diff: backendStatusNote, emptyDelayRows, feedProblem, feedSourceBadge, locationIconSvg, refreshIconSvg, safeAreaInsets, settingsIconSvg, stationArt, stopClockLabel, ticketIconSvg); among the nine others, `safeAreaInsets` (data.ts:313–323) is a state-reading, fresh-record-per-call, ignored-tick helper for one of the six seams. This does not reopen the round-3 major: the purity-conformance check (dev-mode form) catches these reads, the D1 gate's seam-deletion requirement makes leaving them unmigrated a compile error, and the frozen-clock location flip exercises their derives — the *mechanism* is sound; the *enumeration prose* overstates its completeness. **Resolve:** correct the location cell ("read inside `getSelectedStation`/`searchStations`/the walk-bike helpers, which derives call"), add one scoping sentence to the audit (the ten cover the four module-state kinds with presentation-helper hidden readers; the location seam's value side and `safeAreaInsets` have their own internal readers, caught by the same purity check and forced out by seam deletion), and either scope class (d) "of the ten" explicitly or note `safeAreaInsets` as the third state-reading undeclared helper.

## Suggestions

- **Label the staging rule as a D1 rule, not shipped behavior.** The "Ordering:" sentence (RFC:350–353) sits inside the paragraph that opens "What exists today, stated precisely" (RFC:344), but it governs host-binding publications and `publishHostState` — surfaces D1 proposes. No publication queue exists in the pinned runtime (a nested `batch()` applies writes immediately, signals.ts:538–550). A two-word tag ("Ordering (a D1 rule):") keeps the exists/proposed boundary the round-2/3 reviews fought for.
- **Harmonize the purity-check's two definitions.** The hidden-reads note says "undeclared module/host reads inside a *declared-pure* helper" (RFC:243–245) while claiming coverage of "the other three classes" — including class (d), whose helpers have no declaration; the D5 version's "declared (or defaulted) `pure({ depends: 'args' })`" (RFC:632) is the phrasing that actually covers undeclared helpers. Copy "(or defaulted)" into the note.
- **Consider stating in D5 that the purity-conformance check must see *transitive* reads** (or that its dev-mode dynamic form is the one that does): the location-value readers reach module state two calls deep (`walkBikeLine` → `walkBikeSummary` → `getUserLocation`), which a shallow static body-scan would miss.

## Open Questions

- When the location seam migrates, do `getSelectedStation`/`searchStations`/the walk-bike helpers take the location binding's value as a parameter (the audit's option (a)), or does contract-meta grow `depends: ['args', 'host.geolocation']` for them? The audit's machinery answers this for scheme/backend readers; the location-value population should be named somewhere so the same machinery is visibly applied to it.
- Is the eleven-helper undeclared-`use` population (mostly stateless SVG/format helpers) intended to be legal indefinitely, or does the purity-conformance check's "defaulted" arm effectively make declarations mandatory-by-consequence? Worth one sentence when the Exact-side D5 LLP is filed.

## Recommended Next Step

Apply the two Concerns as in-place edits (one word in the header; one table cell plus one scoping sentence in the audit) and optionally the three Suggestions — none touches a design decision, gate, or the sequencing, so no further cross-family review round is needed on their account. Then proceed as the document already plans: author's-discretion status transition and Phase 0 instrumentation first, which will retire the two remaining asserted-not-measured claims (kernel-thread apply cost; true cascade fan-out).

## Verdict

SATISFIED — remaining items are author's-discretion nits. The round-3 major is resolved with a verifiably correct audit and an enforcement design that closes the stale-reader hole through three independent layers, all eight Codex minors and all three Claude defects are fixed and verified against the pinned sources, and the two defects this round found (a header miscount and an over-scoped exhaustiveness framing around an inherited table cell) are pinpoint prose corrections that no design decision, gate, or sequencing choice depends on.
