**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.144.1 (model gpt-5.6-sol,
reasoning effort ultra, read-only sandbox)
**Date:** 2026-07-11
**Redacted:** No — reviewed the local repository (the draft LLP, related LLPs,
diaries, demo sources, and the pinned `@exact/renderer` / `@exact/contract`
sources); instructed not to read `.agent-local-secrets.md`; no secrets were
present in the reviewed material.
**Method:** cli-runner — non-interactive `codex exec` with the LLP 0005
standard review prompt plus instructions to verify the draft's factual claims
against the repository. Full repository read access. This Codex session did
not author LLP 0052. Run concurrently with, and independent of, the Claude
fresh-session review. The blocking finding (native canonical props are already
value-diffed; the native equality hole is raw-text re-emits) was independently
re-verified against the pinned sources by the orchestrating session before
being relied on in revision. Review of the working-tree draft as of
2026-07-11, before any revision.

# Review: LLP 0052 — Contract update economy and reactive host state

## Overall assessment

This is a worthwhile proposal aimed at a real framework problem, but it is not ready for acceptance. The clock/cache-buster pattern and both userland mitigations are well supported. However, the central cross-host diagnosis is materially wrong: ENG-23260’s props-reference fast path governs the plain-web DOM mirror, while native element props are already value-diffed before encoding. Native has a different equality hole—redundant raw-text operations.

That distinction is blocking because it changes D3’s scope, weakens the claimed iPhone root cause, and invalidates D5’s proposed instrumentation seam. I recommend revision, not rejection: preserve the layered strategy, rebuild it on a host-by-host fact base, and add measured acceptance criteria.

For brevity, pinned `renderer/...` and `contract/...` paths below are under `demos/all-aboard/surfaces/contract/node_modules/@exact/`.

## Strengths

- The mitigation evidence is concrete. The ticker still runs every second but writes a five-second bucket (`demos/all-aboard/surfaces/contract/app.contract:170-171,222-223`), and `signal.set` really skips `Object.is`-equal writes (`contract/src/runtime/signals.ts:579-614`). “Four of five” is reasonable steady-state shorthand.

- The palette mitigation is implemented exactly as described: two module singletons are created once and returned by scheme (`demos/all-aboard/surfaces/contract/data.ts:205-210`). More precisely, stable identity first prevents the computed’s version from advancing and lets downstream effects skip (`contract/src/runtime/signals.ts:693-710,786-845`); the DOM-mirror benefit follows from that.

- The device-glue problem is real. All five named setters exist: `setMapsApp`, `setDeviceLocation`, `setColorScheme`, `setSafeAreaInsets`, and `setBackendState` (`data.ts:85-87,151-154,176-178,293-302,330-332`). Their reads are deliberately tied to `nowMs`, and 20 of the 28 top-level derives directly mention that clock (`app.contract:123-155`).

- D1 targets legitimate registered gaps. LLP 0029 G9 accurately asks for a geolocation binding (`llp/0029-all-aboard-gap-closure.plan.md:299-315`), and G14 accurately describes the safe-area problem (`:377-407`). LLP 0052 correctly limits its safe-area claim to the “binding half”; full-bleed layout still needs the separate “surface bleeds, content insets” behavior described by G14.

- The defense-in-depth structure is good: remove unnecessary invalidations, provide a patch-boundary safety net, then improve memoization and observability. D4 also wisely offers opt-in `memo` semantics before proposing a default change.

## Concerns

1. **blocking** — The “props-reference-based on every host” diagnosis is contradicted by the pinned native path.

   The DOM mirror does use the quoted reference gate and fully reapplies an element when `originalProps` changes (`renderer/src/dom-mirror.ts:1458-1484`; full attribute/style reset at `:798-820`). But that mirror explicitly serves plain web and does not install when a real protocol host owns pixels (`:15-19,1250-1259`).

   Native element updates already compare canonical style leaves and canonical props by value (`renderer/src/host-ops.ts:433-489,3522-3529`; `renderer/src/props/normalize.ts:843-863`), encode only changed branches (`host-ops.ts:3576-3623`), and dispatch only nonempty buffers (`:3815-3821`). Thus fresh-but-canonically-equal element props do not produce the native element-prop patch asserted in LLP 0052’s Summary, Incident, and D3 (`llp/0052-contract-update-economy-and-host-state.rfc.md:16-18,59-67,149-159`).

   Native does have a separate problem: every rerun of a dynamic Contract text binding calls `updateTextContent` (`contract/src/runtime/view.ts:1944-1950`), which emits even when the string is unchanged (`renderer/src/host-ops.ts:3731-3745`; `renderer/src/protocol/encoder.ts:471-473`). I could not verify the further claim that the native kernel applies these batches on the UI thread because that UIKit/AppKit implementation is not present in the pinned sources reviewed here.

   Resolve by: Rewrite the incident as three distinct facts—broad reactive recomputation, DOM element reapplication, and native redundant text operations—and measure each. Reframe D3 as completing existing value dirtiness for DOM-lowered element state and raw `TextNode` content, not introducing native canonical-prop comparison from scratch. Retain the UI-thread claim only with a source from the native host or a trace.

2. **major** — D5 cites the wrong `changed` computation and substantially underestimates the profiler.

   The cited `changed = !Object.is(before, after)` exists, but it belongs to action-write contract bookkeeping (`contract/src/runtime/dataflow-inspector.ts:40-59,183-197`). It returns unless an action is active and observes neither derives, host-prop attempts, DOM application, protocol operations, nor commit equality. It can even report `false` for an in-place mutation followed by `touch()`.

   Existing renderer telemetry exposes commit count and actual `changedViews` (`renderer/src/inspector-runtime.ts:390-434`), but equal native element attempts are absent from it, redundant native text writes look changed, and DOM application happens after `notifyCommit`. Nothing currently supplies the proposed derive-level “top offender” attribution.

   Resolve by: Split D5 into a small counter phase and a later attribution phase. Instrument attempted host updates, normalized no-ops, same-text writes, DOM `applyProps` calls, protocol operations/bytes, and layout requests. Then join those records to existing Contract provenance, which already carries component, source line, expression, and recipe-call information (`contract/src/runtime/provenance.ts:27-54,343-378`). Re-estimate the full profiler above S.

3. **major** — D1 assumes an unverified manifest and conflates several different state models.

   I could not locate an existing manifest that declares which host bindings each host implements. The generated `capability.manifest.json` describes Snapback backend/target capabilities (`demos/all-aboard/snapback/generated/capability.manifest.json:1-90`), while LLP 0005 leaves the capability-artifact split open (`llp/0005-contract-exact-react-integration.explainer.md:346-350`).

   Exact already has a more relevant mechanism: per-root, owner-disposed, signal-backed Contract capabilities. `viewport` is the direct precedent (`contract/src/runtime/host-capabilities.ts:329-393`), with compiler descriptors in `contract/src/runtime/index.contract-meta.ts:1-12`. D1 should explicitly build on or replace that mechanism.

   It also groups unlike values together: scheme and insets are ambient host inputs; geolocation is a permissioned asynchronous sensor; maps choice is persisted app preference; backend state is an adapter connection axis; arbitrary `appGlue("name")` risks becoming an untyped global event bus. LLP 0034 already gives backend connectivity its own lifecycle (`llp/0034-contract-source-seam-provider-side.rfc.md:134-190`).

   Resolve by: Add a migration/ownership table separating ambient platform signals, permissioned resources, provider connection state, app preferences, and app-defined typed capabilities. Define initial values, permission/error/unavailable states, subscription and disposal, HMR, hydration, equality, multi-root behavior, test overrides, and per-host conformance. State clearly whether host negotiation requires a new manifest.

4. **major** — D2 overstates what formatting-level time removes and lacks a deterministic clock contract.

   “After D1, countdown text is the only reason `nowMs` exists” (`llp/0052...:142-143`) is false. Time also drives departure expiry and board selection (`data.ts:529-556,578-615`), station-art rollover (`:451-455`), freshness (`:998-1006`), boarding state, and continuous trip position (`demos/all-aboard/snapback/shared/model.mjs:451,457-480`; rendered at `app.contract:728-735`). Formatting-level countdowns are useful, but signal-level time remains necessary.

   A host-owned timer also needs parity with Contract’s structured tree, accessibility, layout, hydration, and deterministic tests. LLP 0027 explicitly requires frozen-clock determinism (`llp/0027-all-aboard-caltrain-demo.plan.md:591-603,705-723`), while G13 still records timezone/DST debt.

   Resolve by: Inventory every temporal use and its minimum cadence, then define one injectable clock authority covering wall-clock jumps, timezone, foreground/background behavior, disposal, hydration, inspection, accessibility, layout, and tests. Narrow the formatting-level claim to the high-frequency presentation work it actually removes.

5. **major** — D4’s proposed shallow default does not memoize the motivating composite result.

   `boardTrains` returns a new top-level object containing fresh arrays and row objects (`data.ts:578-615`). Shallow comparison at the derive-result boundary therefore fails even when all scalar leaves are equal. The Open Questions claim that shallow equality catches the observed “row objects” (`llp/0052...:208-211`) does not match the actual nested board value.

   More generally, default shallow comparison changes observable identity semantics for arbitrary imported JavaScript values and needs rules for mutable nested objects, arrays, custom prototypes, `NaN`/`-0`, comparator errors, memory retention, and `touch()`.

   Resolve by: Start with explicit `memo(comparator)` semantics, test comparators against `boardTrains` and the other real shapes, and specify the eligible immutable/value domain. Consider keyed structural sharing for row collections rather than increasingly deep generic comparison.

6. **major** — The external-state inventory is incomplete, so D1/D2 do not yet justify deleting the cache-buster.

   The five named setters exist, but they are not exhaustive. `setRouteEstimateInvoker` is a sixth exported module-state setter (`data.ts:147-160`); its promise later mutates `routeCache` outside the reactive graph (`:935-963`), and `walkBikeLine(..., nowMs)` eventually discovers the result (`app.contract:147`). That seam is application/query state, not host state. `setSafeAreaInsets`, conversely, has no call site I could locate; shipped native behavior polls `globalThis.exact.safeAreaInsets` directly (`data.ts:308-317`).

   One fresh-object example is also wrong: `getSelectedStation` returns records from the module-level station collection, not fresh objects (`data.ts:420-422`; `demos/all-aboard/snapback/shared/model.mjs:238-254`). Historical source verifies that `themePalette` was fresh before mitigation; `boardTrains` remains a valid example.

   Resolve by: Replace the five-item count with a complete table of external writes, reads, owner, current invalidation path, desired migration, and cadence. Include route-result adoption, qualify the safe-area setter, and replace `getSelectedStation` with an actual fresh producer such as `safeAreaInsets`, `searchStations`, or `feedSourceBadge`.

7. **major** — Cross-repository ownership, rollout, and acceptance gates are missing.

   D1–D5 span Contract grammar/runtime, web mirror, native protocol/host behavior, signals, and devtools—mostly Exact-owned systems. LLP 0021 explicitly excludes Contract language and renderer internals and requires Exact work to remain an explicit dependency (`llp/0021-contract-exact-integration-hardening.plan.md:87-96`). LLP 0034 demonstrates the needed rigor with a Snapback/Exact/demo ownership table and named conformance checks (`llp/0034...:308-355`).

   The RFC also supplies no measured baseline, compatibility plan, rollback, or quantitative gates. Diary 0008 establishes observed jank and a plausible mechanism (`diaries/0008-all-aboard.diary.md:1643-1657,1671-1686`), but it does not measure applied nodes, protocol operations/bytes, layout requests, UI-thread duration, or dropped frames. The D5 numbers are illustrative.

   Resolve by: Either recast LLP 0052 as Snapback evidence and consumer requirements with normative Exact follow-ups, or add an explicit D1–D5 ownership/landing matrix. Add web/native conformance and performance gates, including a pre-mitigation/current comparison and production-overhead requirements.

8. **minor** — The LLP registration and metadata are only partially reconciled.

   G9 and G14 exist, and G15 has a body (`llp/0029...:409-436`), so “registered as G15” is not fabricated. But the actual gap-register table stops at G14 (`:48-64`), proposed sequencing omits G14/G15 (`:438-453`), and G9 still says geolocation writes into deleted `store.mjs` (`:301-304`). LLP 0052’s metadata also omits the standard `Revised` field (`llp/0052...:3-8`).

   Resolve by: Add G15 to the table and sequencing, refresh G9’s evidence to the current `data.ts` module-state path, and complete the metadata header. Also cite the relevant Exact authoring authority—or soften “recommended idiom”—for the claim that object-returning view helpers are the normative paved road.

## Suggestions

- Add a host/pipeline fact table to the RFC:

  | Layer | Current equality behavior | Actual missing protection |
  |---|---|---|
  | Contract state/computed | `Object.is` | Composite derives return fresh values |
  | Plain-web element mirror | `originalProps` reference | Compare lowered DOM-relevant state |
  | Plain-web raw text | String-value cache | Largely already protected |
  | Native element props/style | Canonical value diff | Largely already protected |
  | Native raw text | Unconditional emit | Skip identical text |

- Make “Phase 0” an instrumented reproduction before D5’s productized profiler: reactive recomputes/effects, host-update attempts, DOM applications, protocol ops/bytes, layout requests, and frame timing on web and iPhone.

- State D3’s invariant as “host-observable-equivalent state emits no redundant host operations,” not “nothing visibly changed.” Accessibility, event, semantic, and structural changes may be nonvisual but still require patches.

- Consider a nonstandard temporal primitive that returns both the formatted value and its next invalidation deadline. A scheduler could update only that binding when its output can change, preserving Contract-tree/test visibility without a special host-mutated label.

- Keep derive memoization an optimization, not the primary correctness-of-performance guarantee. The renderer boundary should remain safe even when imported helpers return fresh values.

## Open questions

- What do traces show separately for web DOM application, native raw-text operations, native layout, and UI-thread time before and after the two mitigations?

- Which D1 values are true host inputs, which are permissioned resources, which belong to the existing provider connection axis, and which are ordinary app/persisted state?

- What exact value domain and equality relation can D3 and D4 safely promise across styles, arrays, nested records, events, mutable values, and raw text?

- How will host-owned temporal text remain observable to the Exact inspector, accessibility tree, hydration path, deterministic test clock, and layout engine?

- Is LLP 0052 a Snapback requirements/evidence RFC or the normative Exact implementation design? Which repository and owner lands each deliverable?

- What measurable threshold makes each item successful: zero DOM mutations for an equal commit, zero native operations for equal text/props, bounded profiler overhead, or another target?

## Recommended next step

I propose that the author revise while keeping the document in Draft: first add the per-host measurements and correct the incident/D3/D5 fact base; then complete the external-state inventory, clock semantics, ownership matrix, and acceptance gates. After that revision, split or link the Exact-owned normative work as appropriate and request another independent review before proposing acceptance.

---

# Round 2 re-review (2026-07-11, post-rewrite draft)

**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.144.1 (model gpt-5.6-sol,
reasoning effort ultra, read-only sandbox; session
019f50eb-6619-73f0-a746-949db05671bc)
**Date:** 2026-07-11
**Redacted:** No — full repository read access; instructed not to read
`.agent-local-secrets.md`.
**Method:** cli-runner — non-interactive `codex exec` re-review of the
revised working-tree draft (the post-round-1 rewrite, before any round-2
edits), with the LLP 0005 standard prompt plus round-1 resolution-check and
claim-verification instructions. Run concurrently with, and independent of,
the Claude round-2 re-review. Cross-repo Exact-side facts (viewport
capability shipped under Exact LLP 0292; LLP 0293 is the motivating slides
diary) were verified by the orchestrating session in the Exact repository
and supplied as stated facts. The orchestrating session independently
re-verified this review's decisive factual catches (viewport facade and
subscription model, `batch()` semantics, the maps-row facts,
`feedFreshness`/`stationArt`/model.mjs cadences, `data.contract-meta.ts`
purity declarations, provenance labeling, LLP 0020 scope, and the
diary/code-comment claims) against the pinned sources before relying on
them in revision.
**Verdict:** NOT SATISFIED — another revision round needed.

## Overall Assessment

LLP 0052 is directionally strong, and the round-1 blocking error is genuinely fixed: the revised host-by-host diagnosis now matches the pinned renderer. The layered strategy—remove false invalidations, protect the render boundary, stabilize derived values, then measure—is a good idea.

It is not ready for acceptance. The rewrite introduced or exposed major gaps in D1’s equality and delivery semantics, the external-state migration, D2’s supposedly factual temporal inventory, and D5’s derive attribution. These are fixable without abandoning the proposal, but they require another revision.

## Round-1 Resolution Check

- **Claude major — recompute cost versus patch-apply cost: resolved.** The new cost model distinguishes derive/effect work from host apply, and D3 now explicitly says it does not make an idle tick free (LLP 0052:178–193, 345–347). A new DOM-mirror traversal omission remains below.

- **Claude major — shallow D4 cannot memoize `boardTrains`: resolved as stated.** The revision explicitly rejects shallow-by-default, accurately describes `boardTrains`’ nested fresh values, and assigns list values to keyed structural sharing (LLP 0052:349–372; data.ts:578–615). The exact composite API still needs refinement.

- **Claude major — D1 delivery semantics unspecified: partial.** The revision states desired batching, atomicity, ordering, initial-state, and disposal behavior (LLP 0052:234–247), but the existing runtime provides neither frame coalescing nor cross-capability transactions, and “ordered with” does not define the order.

- **Claude major — D2 fixed formatting shape misses the numeric hero/departed branch: resolved.** The deadline-returning temporal binding explicitly supports bare numeric minutes and leaves `departed` in logic (LLP 0052:287–299).

- **GPT blocking — native element props were misdiagnosed: resolved.** Native canonical props/style are value-diffed and encoding is gated (host-ops.ts:3522–3623); only non-empty batches dispatch (:3819–3821). Raw text remains unconditional (:3731–3745).

- **GPT major — D5 cited the wrong seam and underestimated the profiler: partial.** The action-scoped bookkeeping is correctly disclaimed, and Phase 0/Phase 1 are sensibly split (LLP 0052:379–412). However, existing provenance cannot produce the promised upstream-derive attribution.

- **GPT major — D1 used the wrong manifest and conflated state models: partial.** D1 now builds on the relevant viewport capability and classifies ambient inputs, sensors, provider state, and preferences (LLP 0052:206–232). Async query results still lack a target migration, and `appGlue` risks becoming the catch-all the classification was meant to prevent.

- **GPT major — D2 lacked a complete temporal inventory and deterministic clock contract: partial.** An inventory and injectable-clock requirement were added, but several rows are factually wrong or missing, and wall jumps, resume, timezone changes, and logic-deadline lateness remain requirements rather than defined semantics.

- **GPT major — shallow D4 default changes identity semantics and misses `boardTrains`: resolved as stated.** The revision starts opt-in, names the eligible domain, and chooses keyed sharing rather than a silent default (LLP 0052:354–377).

- **GPT major — external-state inventory incomplete: partial.** The sixth route-result seam and safe-area qualification were added, but the table contains incorrect read/write facts and still lacks a desired migration per seam.

- **GPT major — cross-repository ownership, rollout, and gates missing: partial.** The RFC is now clearly Snapback evidence/requirements with Exact-owned normative follow-ups (LLP 0052:423–434), and initial gates exist. D4 has no gate, D1’s behavioral promises are not gated, and compatibility/rollback remain absent.

## Strengths

- The corrected equality table is accurate. DOM raw text really is string-cached before `nodeValue` mutation (dom-mirror.ts:1270–1271, 1442–1454); the mirror is plain-web-only (:15–19).

- The app facts central to the incident check out: exactly 20 of 28 top-level derives directly mention `nowMs` (app.contract:123–155); the ticker writes a five-second bucket (:170–171); palette values are module singletons (data.ts:194–210).

- D4’s keyed-sharing idea fits the runtime: keyed `each` rows own item signals, and reusing a row object lets `Object.is` suppress that row’s effects (view.ts:2230–2249, 2310–2318).

- D5 is more honest about measurement. The runtime already exposes global and per-node recompute/effect churn (signals.ts:49–65, 964–977), giving Phase 0 a useful starting point.

- The ownership boundary is correctly grounded in LLP 0021 (LLP 0021:87–96). G9, G14, and G15 now appear in LLP 0029’s table, bodies, and sequencing (LLP 0029:48–64, 467–471).

## Concerns

- **Major — D1 recreates the identity problem for structured host values.** The proposed `insets` and geolocation values are records (LLP 0052:200–204), yet delivery promises only the normal `Object.is` skip (:234–238). `signal.set` skips only the identical reference (signals.ts:591–614). Fresh-but-equal inset, coordinate, or tagged-state records would therefore restart the cascade. The viewport precedent avoids this with a stable facade over scalar signals (host-capabilities.ts:366–390). Resolve by defining per-capability equality/canonicalization or stable field signals, with an equal-fresh-record conformance test.

- **Major — D1’s frame batching and no-tearing promises lack a mechanism.** Current `batch()` flushes synchronously at the end of each call (signals.ts:538–548); viewport batches width and height for one resize callback only (host-capabilities.ts:370–379). Multiple capability events in one frame are not transacted. Also, viewport uses one shared underlying window listener with per-root subscribers—not a separate refcounted physical subscription per root (:267–326). Resolve with a root-scoped staging/transaction API, an explicit host-versus-action ordering rule, and a two-level acquisition model: per-root capability state over appropriately shared physical subscriptions.

- **Major — the six-seam inventory is still factually incomplete and does not justify deleting the clock.** The maps row is wrong: `setMapsApp` restores persisted state at boot and Settings calls `cycleMapsApp` (directions.ts:62–68, 134–147); `mapsAppLabel`, not `directionsLabel`, reads it (data.ts:81–98, 913–918). Scheme is also read by `serviceTint`, `feedSourceBadge`, and other helpers, while backend state is read by `feedFreshness` (data.ts:887–890, 998–1006, 1053–1078). Those helpers are declared pure/argument-dependent (data.contract-meta.ts:1–46), so merely declaring a host binding will not make their hidden reads reactive. Route completion/TTL has no proposed reactive-resource migration. Resolve with exhaustive readers, desired target, owner, equality, clock/deadline, and migration columns for every seam; require explicit helper dependencies before deleting `nowMs`.

- **Major — D2’s “real cadences” are not the app’s real cadences.** `feedFreshness` never renders “Xs ago”: it stays constant for the first 60 seconds and then changes in whole minutes (data.ts:998–1006). The inventory omits the feed-live/stale deadline (:1042–1078) and the route-cache TTL, which uses an independent `Date.now()` (:935–963). Station art flips at UTC epoch midnight, not a service-day boundary (:445–455); the synthetic schedule has a rolling hourly horizon and no distinct daily service-day rollover (model.mjs:375–402). Finally, countdown and departure-expiry transitions are target-relative; a shared wall-minute timer can be almost 60 seconds late when predicted times carry seconds (model.mjs:505–507, data.ts:529–535). Resolve with a corrected inventory and deadline semantics for logic as well as presentation, including timezone, wall jumps, resume catch-up, hydration, and disposal.

- **Major — D5’s cited provenance cannot name upstream derives.** Existing provenance is keyed by rendered host nodes and records terminal attr/text expressions (provenance.ts:65–79, 343–399). Derives are instantiated as unlabeled `ownedComputed` values (instance.ts:472–479), and reactive nodes receive generic `computed:N` labels (signals.ts:213–224). A `theme.ink` or `d.trainNumber` terminal expression cannot be joined into “top source: themePalette/boardTrains” from that data. Resolve by labeling signals/computeds/effects with compiler loci and carrying binding/causal-chain IDs into host-update attempts; define whether attribution means terminal binding, first changed derive, or allocated fanout.

- **Minor — D4 does not say how keyed sharing composes across the actual board record, and it has no acceptance gate.** Recycled rows suppress row effects, but `boardTrains` still returns a fresh outer record, `before`/`rest` arrays, and hero fields. The outer derive and collection reconciliation can still run. Specify whether `memoRows` also preserves array/outer identity, state which costs remain, and add unchanged-board plus one-row-changed gates.

- **Minor — D3’s web cost and acceptance domain are incomplete.** Even with equal props, the mirror recursively traverses the entire tree and allocates per-parent desired arrays/sets (dom-mirror.ts:1489–1544). Zero DOM mutations is therefore not zero mirror work. Moreover, `applyProps` consumes original props and DOM-only lowered/input/image/SVG state, not just native canonical props (:798–870). Add mirror traversal/snapshot cost to the table, define the complete DOM-observable snapshot, and require unchanged topology/order in the D3 gate.

- **Minor — the rewrite still overstates cascade magnitude.** “Every derive” and “every downstream effect” (LLP 0052:29–31) are not established: only 20/28 derives read `nowMs` directly, and stable computed results prevent version advancement and let effects skip (signals.ts:693–710, 786–796). Say “20 direct derives plus downstream dependents whose values changed identity” until Phase 0 supplies counts.

- **Minor — citations and the surrounding corpus need reconciliation.** The native viewport follow-on is Exact LLP 0292, not 0293, at both RFC citations (LLP 0052:206–210, 423–431). LLP 0020 does not establish the claimed Contract helper idiom; it delegates Contract tooling to LLP 0021 (LLP 0020:64–86). Diary 0008 and the app’s existing `@ref LLP 0052` comment still state the falsified cross-host reference-dirtiness story (Diary 0008:1671–1686, data.ts:194–204); LLP 0016 requires a dated diary erratum rather than rewriting history (LLP 0016:400–407).

## Suggestions

- Model D1 as a root-scoped `HostStateSnapshot` transaction: stable field cells, capability-specific equality, and one atomic publication for related values such as viewport plus insets.

- Generalize D2 around `nextChangeAt`/`invalidateAt(deadline)` for logic and presentation. `now("minute")` can then be sugar for a periodic deadline policy rather than the only scheduling primitive.

- Reuse the existing reactive churn/graph APIs for Phase 0, and split the estimate into JS counters (likely S) versus native layout/thread tracing (likely M).

- Give compiler-authored names and loci to every signal, derive, collection effect, and text/prop effect. Preserve a causal ID through the host boundary so D5 can show both terminal binding and upstream source.

- Consider a normalized DOM snapshot plus dirty-subtree propagation. That would make D3’s equality relation explicit and avoid full-tree mirror traversal when only one subtree is involved.

## Open Questions

- What equality relation is promised for each structured host binding, and who canonicalizes values?
- What exact transaction orders host publications against actions, timers, and multiple roots?
- Where do maps preference, backend lifecycle, route results, route TTL, and feed-liveness each migrate?
- What are the clock’s rules for target-relative deadlines, timezone changes, wall-clock jumps, background/resume, and hydration release?
- What does D5 count as an offender: terminal binding, upstream derive, allocation source, or all causal hops?
- Does D4 preserve row identity only, or array and outer-result identity as well?
- What do Phase 0 traces show for mirror traversal, native same-text operations, layout requests, and frame time before and after each mitigation?

## Recommended Next Step

Revise in place and remain `Draft`. First correct the external and temporal inventories; then specify D1 equality/transaction semantics and D5’s attribution substrate; finally add D1/D4/D3 conformance gates, compatibility/rollback notes, and the diary/code/LLP citation errata. After that, run another round-2-equivalent cross-family review because these are newly rewritten surfaces, not editorial cleanup.

## Verdict

NOT SATISFIED — another revision round is needed. The original blocking host-mechanism error is resolved, but major implementation and factual gaps remain in D1, D2, the six-seam migration, and D5 attribution.

---

# Round 3 re-review (2026-07-11, post-round-2-revision draft)

**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.144.1 (model gpt-5.6-sol,
reasoning effort ultra, read-only sandbox; session
019f510c-0a4f-7fb1-866b-1c31f4432c80 — an initial launch of this round hung
on an unclosed stdin pipe and was killed before producing any output; this
session is the effective run)
**Date:** 2026-07-11
**Redacted:** No — full repository read access; instructed not to read
`.agent-local-secrets.md`.
**Method:** cli-runner — non-interactive `codex exec` re-review of the
round-2-revised working-tree draft, with a round-2 resolution check against
both prior artifacts and claim-verification instructions for the revision's
new surfaces and the three companion edits. Run concurrently with, and
independent of, the Claude round-3 re-review. The remaining major's decisive
facts (the additional hidden readers `delayColor` /
`locationIndicatorColor` / `locationHint`; `feedSourceBadge` and
`backendStatusNote` absent from `data.contract-meta.ts`; the lint-coverage
gap) were independently re-verified by the orchestrating session against
the app sources before being relied on in revision.
**Verdict:** NOT SATISFIED — another revision round needed (one remaining
major: the hidden-reader inventory and its enforcement mechanism).

## Overall Assessment

LLP 0052 is substantially stronger: the corrected per-host diagnosis, D1 canonicalization, D2 deadline model, D3 renderer facts, D5 provenance substrate, ownership boundaries, and companion errata all verify.

One major round-2 issue remains. The external-state reader inventory is still incomplete, and the proposed declare-and-ignore lint cannot detect several hidden dependencies it claims to catch. Removing `nowMs` under the current plan can therefore leave scheme, location, and backend-dependent UI stale.

## Round-2 Resolution Check

- **Codex major 1 — structured host-value identity: resolved.** LLP 0052:286–297 now requires stable scalar facades, capability-specific record equality, and equal-fresh-record conformance. This matches viewport’s scalar signals and stable getter facade in host-capabilities.ts:368.

- **Codex major 2 — batching, ordering, and subscriptions: resolved, with minor precision defects.** LLP 0052:299–325 distinguishes today’s event-local `batch()` from new correlated-capability transactions, rejects a frame-coalescing promise, and accurately describes shared physical subscription plus per-root fan-out. “One commit per host event” should say per root, and publication staging relative to actions remains slightly underspecified.

- **Codex major 3 — six-seam inventory, hidden reads, and migration targets: partial; still major.** Maps and migration targets are corrected, but the reader inventory and lint claim at LLP 0052:183–204 remain false/incomplete. Details are under Concerns.

- **Codex major 4 — temporal inventory and deadline semantics: resolved.** LLP 0052:356–425 now correctly covers minute-bucket freshness, UTC epoch-day art, absence of a service-day calendar, feed staleness, route TTL, target-relative deadlines, and clock jump/resume/hydration/disposal rules. A few boundary and timezone qualifications remain minor.

- **Codex major 5 — upstream-derive provenance: resolved.** LLP 0052:525–559 accurately distinguishes terminal node provenance from generic computed IDs and makes compiler-authored labels plus causal IDs new Phase-1 work. Existing churn counters and unlabeled derives verify in signals.ts:213 and instance.ts:472.

- **Codex minor — D4 composition and gate: partial.** Bottom-up all-equal sharing is coherent at LLP 0052:494–506, but the one-row-changed gate overpromises.

- **Codex minor — D3 traversal, DOM snapshot, and topology: partial.** The DOM-observable snapshot and unchanged-topology gate are present, but LLP 0052:236 says “touched subtrees”; the current mirror walks the complete mounted root.

- **Codex minor — cascade magnitude: partial.** The Summary is appropriately softened, but LLP 0052:210–214 and LLP 0052:227–229 still say every derive/effect runs.

- **Codex minor — citations and corpus reconciliation: resolved for the RFC and diary.** Exact LLP 0292 is now correctly cited, the LLP 0020 authoring claim is gone, and Diary 0008 has an accurate append-only erratum. The palette companion comment retains one smaller overclaim.

- **Claude minor — maps row: resolved.** Boot restore, Settings mutation, `mapsAppLabel`, and directions-URL reads all match directions.ts:62, data.ts:94, and `app.contract:664`.

- **Claude minor — three temporal cells: resolved.** Freshness, UTC art rollover, and absence of a service-day calendar are now accurate.

- **Claude minor — Exact LLP 0292/0293: resolved.** Both normative citations use 0292, while the stale 0293 source comment is explicitly explained.

- **Claude minor — LLP 0020 citation: resolved.** The RFC now rests the authoring-idiom claim on demonstrated practice rather than that unrelated data-tier LLP.

- **Claude minor — refcount scope: resolved.** The two-level lifecycle at LLP 0052:316–322 matches the viewport implementation.

- **Claude suggestion — compare-before-assign and unhide: resolved.** LLP 0052:453–461 accurately captures both paths in host-ops.ts:3717.

- **Claude suggestion — diary and palette-comment correction: partial.** The diary erratum is accurate and append-only. The palette comment corrects the host split but overstates what palette identity alone suppresses.

- **Claude suggestion — view-expression lint scope: adopted textually, functionally insufficient.** View expressions are included at LLP 0052:560–565, but unused-parameter analysis cannot detect the remaining hidden reads.

- **Claude suggestion — cross-capability conformance: resolved.** The correlated-publication transaction and named gate appear in D1 and its acceptance criterion.

- **Claude suggestion — D4 gate: adopted but partially incorrect.** The all-equal half is sound; the one-row-changed half needs narrowing.

- **Claude suggestion — Related metadata: resolved.** LLP 0016, LLP 0051, the repo-LLP-0005 clarification, and Exact LLP 0292 are present and relevant.

## Strengths

- The host-by-host incident diagnosis now matches every pinned renderer path checked.
- D1 is grounded in a real shipped capability rather than an imagined manifest.
- D2’s deadline-first model fits the actual countdown, expiry, staleness, and TTL shapes much better than periodic wall-minute invalidation.
- D5 is unusually honest about what exists versus what must be built.
- Ownership and rollback are clear, and LLP 0029 G15 is consistent with the RFC.
- Diary 0008’s correction follows the append-only rule.
- `./ref-check --verbose` completed with zero errors.

## Concerns

- **Major — the hidden-reader migration remains unsound.** LLP 0052:185–203 omits scheme reads in `locationIndicatorColor` and `delayColor` (data.ts:384, data.ts:651), plus direct geolocation-source reads in `locationHint` and `locationIndicatorColor`. It also says `feedSourceBadge` is declared `pure({depends:'args'})`, but that helper is absent from the complete data.contract-meta.ts registry. Most importantly, the proposed unused-parameter lint cannot catch `serviceTint` or `delayColor` because they have no tick parameter, nor `feedFreshness` or `feedSourceBadge` because they genuinely use `nowMs`. Resolve with an exhaustive transitive reader audit, corrected metadata facts, explicit helper-to-binding dependency declarations or global-read purity analysis, and frozen-clock conformance tests that independently change scheme, location, and backend state.

- **Minor — D1 blurs existing behavior and proposed staging.** LLP 0052:299–304 calls the viewport pattern “one commit per host event,” but one shared resize callback fans out into separate per-root batches. `batch()` also mutates signals immediately and merely defers its synchronous effect flush. State that publications are staged until an active action batch exits, and qualify the precedent as at most one flush per root per event.

- **Minor — three D2 precision edges remain.** Feed state remains fresh at exact equality (`now - fetchedAt <= staleAfterMs`), so its transition is strictly after the named deadline; trip interpolation is continuous but currently sampled by five-second clock buckets; and fixed timestamp labels can change when the host timezone changes despite the table saying they change only with data. Define the boundary convention, distinguish function cadence from sampling cadence, and make timezone an explicit temporal dependency.

- **Minor — D3 understates residual traversal and has a one-sided gate.** The mirror recursively visits the whole root and allocates per-parent arrays/sets, not only “touched subtrees.” The equal-input gate could also pass the exact compare-after-assignment bug by suppressing changed text too. Add changed-text → one update and hidden-update → unhide restoration cases.

- **Minor — D4’s changed-row gate exceeds the proposed mechanism.** A changed row produces a changed outer `board` computed, advancing its single version and waking direct `board.*` observers; keyed row signals only suppress unchanged row-item bindings. Change LLP 0052:639–642 to “only that row among keyed row bindings,” while accounting for outer reconciliation, or propose field-level signals.

- **Minor — absolute cascade wording survives outside the Summary.** “Every derive” and “every effect” conflicts with the verified 20/28 direct derives and version-based effect skips. Use “clock-fed derives and downstream effects whose dependency versions advance.”

- **Minor — the `appGlue` example contradicts D1’s classification.** LLP 0052:327–340 uses `backend = appGlue(...)`, while the table and D1 classification say backend lifecycle remains LLP 0034-owned. Use a platform-quirk example or explicitly model a read-only LLP 0034 projection.

- **Minor — D5’s acceptance gate does not test attribution.** It checks no-op rate and overhead but never proves that a known derive-to-terminal fixture reports both labels or that “first changed derive” works under fan-in. Its illustrative “text ops” example also names `themePalette`, which drives theme attributes rather than text content. Add a causal-attribution fixture and change the example to host-update attempts or a genuine text-producing source.

- **Minor — the palette companion comment overclaims.** data.ts:194–207 correctly distinguishes web element reapplication from native raw-text emission, but “stable identity per scheme stops both” implies palette stabilization stops unrelated clock-fed text bindings. Narrow it to theme-driven downstream work.

## Suggestions

- Extend contract metadata to express dependencies such as `depends: ['args', 'host.colorScheme']`, then make undeclared host/module reads a compiler or dev-mode diagnostic.
- Generate capability equality, shared acquisition, and transaction plumbing from the host-binding declaration so every adapter does not independently implement canonicalization.
- Add a timezone-generation signal to the temporal authority; absolute-time formatters can depend on it without subscribing to advancing `now`.
- Give D3 both negative and positive conformance fixtures, and D5 a small causal diamond/fan-in fixture.
- Consider dirty-subtree propagation alongside the DOM-observable snapshot so D3 eventually bounds traversal as well as mutations.

## Open Questions

- Is `feedSourceBadge` intentionally permitted without a contract-meta descriptor, and if so, what dependency semantics does it receive?
- What stages a synchronous `publishHostState` call made while a Contract action batch is active?
- How are incompatible multi-root geolocation options negotiated while retaining one physical watch where possible?
- Is D4’s intended changed-row guarantee limited to keyed row bindings, or does the design require field-granular outer records?
- Which temporal objects are re-evaluated on timezone change when they have no scheduled deadline?

## Recommended Next Step

Revise in place and remain `Draft`. First repair the hidden-dependency inventory and enforcement mechanism, since that is the remaining major. Then apply the narrower batching, D2, D3/D4 gate, example, and companion-comment corrections and request a focused round-4 re-review. The author decides the eventual status transition.

## Verdict

NOT SATISFIED — another revision round is needed. Most round-2 architecture concerns are genuinely resolved, but the incomplete hidden-reader inventory and ineffective claimed lint can still leave migrated UI stale after the clock cache-buster is removed.

---

# Round 4 re-review (2026-07-11, post-round-3-revision draft)

**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.144.1 (model gpt-5.6-sol,
reasoning effort ultra, read-only sandbox; session
019f511f-2b59-7b63-9418-05af08b63cb2)
**Date:** 2026-07-11
**Redacted:** No — full repository read access; instructed not to read
`.agent-local-secrets.md`.
**Method:** cli-runner — non-interactive `codex exec` focused re-review of
the round-3-revised working-tree draft, with a round-3 resolution check
against both prior artifacts and claim-verification instructions for the
revision's changes. Run concurrently with, and independent of, the Claude
round-4 re-review. The one new mechanism claim this review relies on (a
fully value-equal pass still commits and walks today: settled effect flush →
`onFlush` hooks → per-root `commitBatch` → `__exactDomMirror.sync`) was
independently re-verified by the orchestrating session against
`signals.ts:511`, `mount.ts:218`, and `host-ops.ts:3828–3838` before being
relied on in revision.
**Verdict:** SATISFIED — remaining items are author's-discretion nits.

## Overall Assessment

LLP 0052 is now sound enough to satisfy this review. The round-3 hidden-reader major is genuinely resolved: the revised inventory is complete, the lint’s limits are acknowledged, a second enforcement mechanism is proposed, and the frozen-clock gate prevents the demonstrated stale-UI failure.

The proposal is a good idea with a credible plan: D1/D2 remove false invalidations, D3 protects the host boundary, D4 cuts propagation, and D5 measures both. I found no blocking or major concern and no newly introduced architectural error. Several minor precision defects should still be corrected.

## Round-3 Resolution Check

**Codex round 3**

| Finding | Result | Evidence |
|---|---|---|
| Major — incomplete hidden-reader inventory and ineffective lint | **Resolved** | The RFC now inventories ten unique helpers in three behavioral classes, with two additionally undeclared (LLP 0052:212). The code confirms all ten: `mapsAppLabel` (data.ts:94), `themePalette` (:213), the three location readers (:362–388), `delayColor` (:653), `serviceTint` (:892), `feedFreshness` (:1003), and `feedSourceBadge` (:1047). The complete 41-entry registry omits `feedSourceBadge` and `backendStatusNote` (data.contract-meta.ts:8). Explicit migration, two checks, and the frozen-clock backstop appear at LLP 0052:237, :623, and :700. |
| Minor — D1 per-root flush and action ordering | **Partial** | The requested per-root wording and staging rule are present (LLP 0052:344). Immediate writes and outermost-exit flushing verify (signals.ts:538); shared callback fan-out verifies (host-capabilities.ts:313). Publication staging, however, is proposed behavior, not something the pinned runtime currently implements. |
| Minor — D2 equality, interpolation, timezone | **Partial** | Continuous-function versus 5-second sampling and timezone generation are correctly added (LLP 0052:410, :464). The new deadline-boundary wording remains internally inconsistent, detailed below. |
| Minor — D3 traversal and two-sided text gate | **Resolved** | The gate now requires changed text → exactly one op and hidden update → restoration on unhide (LLP 0052:691). This matches the compare-after-assign trap and direct unhide emit in host-ops.ts:3717. |
| Minor — D4 changed-row overclaim | **Resolved** | The gate is narrowed to keyed-row bindings and explicitly allows outer-field observers to re-fire (LLP 0052:715); field granularity remains an honest open question. |
| Minor — absolute cascade wording | **Resolved** | Both sites now say clock-fed derives and effects whose dependency versions advanced (LLP 0052:252, :268). |
| Minor — `appGlue` contradicts lifecycle ownership | **Resolved** | The backend example is explicitly a read-only projection of LLP 0034’s lifecycle axis, not app ownership (LLP 0052:377). |
| Minor — D5 example and attribution gate | **Resolved** | The report correctly attributes `themePalette` to attribute attempts and `boardTrains` to text attempts (LLP 0052:616); the fan-in attribution fixture is gated at LLP 0052:722. |
| Minor — palette comment overclaim | **Resolved** | The companion comment now says “THEME-DRIVEN share” and explicitly excludes unrelated clock-fed bindings (data.ts:194). |

**Claude round 3**

| Finding | Result | Evidence |
|---|---|---|
| Concern — hidden-reader facts | **Resolved in the body** | The four-category audit and metadata omissions are accurate at LLP 0052:212. Only the revision-header count remains wrong. |
| Concern — mirror visits “touched subtrees” | **Resolved** | The cost model now says every node of the synced root per commit (LLP 0052:281); `reconcileChildren` recursively maps every child (dom-mirror.ts:1489). |
| Concern — Phase 0 effort label | **Resolved** | Sequencing now distinguishes “S JS counters; M native trace” (LLP 0052:636). |
| Suggestion — purity-conformance check | **Partial** | It is now a named D5 deliverable (LLP 0052:623), but transitive reads and missing-descriptor semantics need one more sentence. |
| Suggestion — clarify whether an equal pass commits | **Partial** | The RFC routes the question to Phase 0 (LLP 0052:511), but the pinned runtime already answers “yes after an effect flush”; Phase 0 measures the cost. |
| Suggestion — identify undeclared helpers | **Resolved** | Both helpers are named explicitly at LLP 0052:232. |

## Strengths

- The hidden-reader audit now matches the repository exactly. In particular, `serviceTint(service)` and `delayColor(dep)` have no tick parameter yet call `isDark()`, while `feedFreshness` and `feedSourceBadge` genuinely use `nowMs` while also reading hidden state.
- D1 accurately grounds canonicalization and acquisition in the shipped viewport precedent: scalar signals sit behind a stable facade, one physical listener fans out to per-root capability instances, and each subscriber batches its width/height writes.
- D2’s factual inventory now matches the app: feed freshness uses minute buckets; feed liveness is fresh at exact equality (`nowMs - fetchedAt <= staleAfterMs`, data.ts:1077); trip interpolation is mathematically continuous (model.mjs:457); and clock labels use the host timezone.
- D3’s positive and negative fixtures are well chosen. Current `updateTextContent` assigns before encoding (host-ops.ts:3731), while unhide emits directly, so the revised gate actually distinguishes a correct equality skip from the compare-after-assign bug.
- The D4, D5, sequencing, `appGlue`, mirror-walk, cascade, and companion-comment corrections all agree with their surrounding prose and the checked sources.
- Against LLP 0005’s standard questions: the idea is good, the plan is proportionate and implementable, nothing remaining is wrongheaded, and no design element needs removal. The remaining improvements are boundary definitions and enforcement precision, not a changed direction.

## Concerns

No blocking or major concerns remain.

- **minor — The feed-staleness deadline convention is internally inconsistent.** The table correctly says fresh at equality and stale strictly after (LLP 0052:416), but D2 schedules staleness at `fetchedAt + staleAfterMs` (LLP 0052:430), calls a deadline the first instant the predicate may differ, and evaluates with `now >= deadline` (LLP 0052:441). At an exact wake on that boundary, the actual `<=` predicate is still fresh, and no subsequent wake is specified. The D2 gate nevertheless says staleness fires “at” its deadline (LLP 0052:709). **Resolve by:** define the deadline as the first representable instant after the inclusive boundary, change the predicate convention, or specify rescheduling; test equality and the next clock instant explicitly.

- **minor — D1 presents proposed publication staging as current behavior.** The paragraph begins “What exists today” and then says action-overlapping publications are staged (LLP 0052:344). Current `batch()` mutates signal values immediately and proceeds directly to the outermost effect flush; there is no host-publication queue. The scheduler is also global, so “per root” is a useful conceptual count, not literal scheduler topology. **Resolve by:** label action-relative staging as new D1 work, specify whether staged publications drain before the action’s outer flush or in a following commit, and add an ordering fixture.

- **minor — The value-equal-commit question is already answered for the current runtime.** The RFC says Phase 0 will determine whether a value-equal pass still commits and walks the tree (LLP 0052:511). Today every settled effect flush calls all `onFlush` callbacks (signals.ts:511), each mounted root commits on that callback (mount.ts:218), and every commit invokes mirror sync (host-ops.ts:3828). **Resolve by:** state that current behavior is a full walk after such a flush and that Phase 0 measures its residual cost; if commit suppression is intended, name it as additional scope.

- **minor — Purity enforcement needs exact scope.** All five scheme readers reach module state transitively through private `isDark()` (data.ts:184), so a direct-body scan would miss them. The earlier prose says a declared-pure-helper check covers the undeclared class (LLP 0052:241); D5 later says “declared (or defaulted)” but does not define that default. It also calls both checks “static” while allowing the second to be dev-mode. Finally, the frozen-clock gate flips scheme/location/backend but says “every reader in the inventory,” which includes `mapsAppLabel`. **Resolve by:** require transitive call-graph analysis or dynamic read tracking; make a missing descriptor itself diagnostic or define the default; call the pair “conformance checks” if one may be runtime; and say “every affected reader” or add a maps-preference flip.

- **minor — Revision metadata has two count errors.** The header says “nine helpers” (LLP 0052:8), while the body and code establish ten. The Status says the loop ran “twice” (LLP 0052:781) and then narrates Round 3. **Resolve by:** use “ten helpers in three behavioral classes, with two additionally undeclared,” and change “twice” to “three rounds.”

## Suggestions

- Generate canonicalization, dependency metadata, shared acquisition, and transaction plumbing from each host-binding declaration; this reduces adapter-specific semantic drift.
- Define D5 fan-in attribution deterministically when more than one upstream derive changes in the same causal diamond.
- Treat dirty-subtree propagation as a later mirror optimization. D3 already guarantees zero redundant mutations; subtree dirtiness would also bound the remaining traversal.

## Open Questions

- Do staged host publications join the action’s outermost flush or deliberately produce a following commit?
- What is the clock’s representable resolution, and how are strict-after boundaries encoded?
- Is purity conformance implemented through transitive static analysis, runtime dependency tracking, or both?
- Should multi-root fan-out retain today’s global flush/commit callbacks or gain root-scoped commit scheduling?
- The RFC’s existing comparator-domain, D4 outer-granularity, D1 negotiation, and Exact-LLP ownership questions remain the right implementation-level questions.

## Recommended Next Step

Apply the pinpoint deadline, staging, purity-scope, commit-wording, and metadata corrections while remaining `Draft`; no fifth cross-family round is necessary unless those edits expand D1 or D2 semantics materially. Afterward, the document is ready for the author to decide whether to accept and begin Phase 0. Per the brief, I made no file changes.

## Verdict

SATISFIED — remaining items are author's-discretion nits. The round-3 major is resolved, and the remaining defects are localized precision or metadata corrections rather than design failures.