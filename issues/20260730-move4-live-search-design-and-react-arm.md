# Move 4 first slice: live-search design pass in LLP 0073's frame + React/query-group rerun arm prep

**Status:** Resolved
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 3
**Severity:** P1
**Systems:** Search, Client integration, Developer experience, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0127, LLP 0115, LLP 0119, LLP 0073, LLP 0112, LLP 0114
**Marker:** parity-moves, move-4

LLP 0127 move 4 ("Liveness is a property of facts, not a fee on functions")
names its first slice as "the live-search design pass in 0073's frame
(cursor decision, budgets, capability id), landed alongside the rerun arm
that consumes the 0114 React surface and a registered 0112 group," and the
closing enumerates both starts as startable today with no author decision.
This is design and measurement prep only — no capability claims. CV-11 is a
genuine design hole (LLP 0073 excludes live search four ways and contains no
reactive design), and 0115 §Sequencing 5 records that the prior rerun method
drove headless clients, so the LLP 0112/0114 React/query-group gains were
structurally invisible to it.

Work items. (1) The live-search design pass: coarse re-execution on
invalidation (LLP 0119 option 4) under search's own capability id, in LLP
0073's frame (owner per 0119 OQ2; 0127 "what lands where"), composing with
the live query and query-group surfaces rather than inventing a parallel
channel. The 0119-named integration blockers — the admission/dispatch seams
(the matcher arm, Replace lane, auth obligations, and bounded
per-page-rechecked executor already exist) — are the work list; the design
proves or refutes option 4's hypothesis that the remainder is composition
rather than invention. Design under per-index subscription/concurrency
budgets, with first-page-only liveness the plausible v1; the design produces
the cursor-semantics and capability-id proposals (0119 OQ1/OQ2) for the
author. Meanwhile `full_text_search_v1` stays non-live and says so — the
`SNAPBACK_FUNCTION_NOT_LIVE` refusal is a pinned contract until a live path
ships. (2) Successor-rerun arm prep per 0115 §Sequencing 5: at least one arm
(Campfire is natural) consuming the 0114 React surface and a registered 0112
group, so the plan's reactive-boundary watch trigger becomes measurable —
0112/0114 measured consumption, measurement prep only. Exit: the design
lands as reviewable text in LLP 0073's frame satisfying CV-11's design
half — the shipped-path-or-dated-decision fork in CV-11's exit ("Either a
shipped live-search path under its own capability id with the same
rank/highlight/cursor contract and an eviction/invalidation evidence story,
or a dated LLP 0073 decision recording why non-live remains the claim") is
set up, not resolved, by this ticket — and the rerun arm exists so
§Sequencing 5's React-surface measurement requirement is satisfiable.

Decision boundary. This ticket does NOT ship live search or change any
capability claim: implementation follows the author's acceptance of the
design's cursor semantics (0119 OQ1) and capability-id shape (0119 OQ2) —
move 4 "decisions forced," not pre-made here. Not included: option 5's
posting-delta precision (a later refinement of the same delivery model);
the mixed-route register-cliff softening (its 0112-amendment-vs-v2-profile
placement is 0119 OQ6); quarantine-flicker remediation (diagnosis precedes
remedy — the blank is the fail-closed proof of revocation, 0119 finding 7);
and any classification-boundary change — the option 1a pre-registration is
watch-gated (0115's watch item; no action until the post-CV-11,
React-measured rerun scores the boundary itself), and its acceptance plus
0127 §Sequencing 7's watch-item amendment are author calls.

## 2026-07-31 — work item (1) DONE: the design pass is LLP 0136

The live-search design pass landed as LLP 0136 ("Live search by
coarse re-execution", Spec), ACCEPTED 2026-07-31 under LLP 0130 SD-4
after a dual-family loop (Fable READY round 2, Codex READY round 3;
commit `6ac46221`). It proves option 4's composition hypothesis in
LLP 0073's frame: coarse re-execution on invalidation under search's
own capability id (`live_full_text_search_v1`), v1 scoped honestly to
non-auth-scoped subscriptions (sessions-mode `owner.v1` refuses at
admission), per-index/per-connection budgets plus a table-scoped
aggregate ceiling (`TableManifest.searchLiveLimits`), cursor
semantics pinned (terminal-page-only absence; atomic client cursor
invalidation on resync), and the wire members routed as dated LLP
0091/0094 amendments behind an offer-gated `liveSearchProtocol`
negotiation. The 0119 OQ1/OQ2 proposals this ticket owed the author
are therefore made and accepted. `full_text_search_v1` stays non-live
with the pinned `SNAPBACK_FUNCTION_NOT_LIVE` refusal until the
implementation ships. Still open here: work item (2), the
successor-rerun arm prep (an arm — Campfire is natural — consuming
the LLP 0114 React surface and a registered LLP 0112 group), plus
implementation per the accepted Spec. LLP 0115's CV-11 board row
records the design half landed.

## 2026-07-31 — work item (2) DONE: the Campfire React query-group arm

The successor-rerun arm prep landed as `demos/campfire`: the Campfire
contract (Diary 0025/0034 — rooms, monotonic sequences, newest-first
exclusive-cursor pagination, reactions, live delivery) rebuilt in-repo
so every product read renders through the LLP 0114 React surface over
a registered LLP 0112 generated group. The route `/rooms/:roomId`
generates a `registerGroupEligible` typed group (children
`liveMessages`/`liveReactions`); the arm component
(`demos/campfire/src/CampfireRoom.mjs`) consumes only
`@expo/snapback-react` (`useSnapbackQueries(preparedGroup)`,
`useSnapbackMutation`, `useSnapbackConnection`) and renders the
registered boot provenance into the tree. The retained acceptance
(`demos/campfire/tests/react-arm.mjs`, receipt
`acceptance/results/react-arm.v1.json`, 7/7 against the checkout's
qualified binary) pins the consumption: preparation omits
`fallbackToLive` so a lost `registered_bundle_boot_v1` capability
fails loudly; the rendered `boot-provenance` node must read
`registered-bundle`; a structural pin refuses the component importing
the headless client; and live mutation deltas must re-render the
tree. LLP 0115 §Sequencing 5's dated satisfaction note records that
the React-surface measurement requirement is now satisfiable. Found
and filed en route:
`issues/20260731-0112-register-eligibility-js-param-seam.md` (codegen
marks `$param`-into-JS-live-query routes eligible; the served
admission refuses them — the arm's group children are declarative for
that reason). Diary 0040 carries the build experience. Measurement
prep only: no capability claims changed, no live-search
implementation, the option 1a pre-registration stays watch-gated.

## Resolution (2026-07-31)

Both work items are done: (1) LLP 0136 (Accepted 2026-07-31, dual-
family loop, `6ac46221`) is the live-search design pass in LLP 0073's
frame; (2) `demos/campfire` is the rerun arm consuming the 0114 React
surface and a registered 0112 group, with acceptance pinning the
consumption. Follow-ons live elsewhere: live-search implementation
follows the accepted LLP 0136; the codegen/server eligibility seam is
`issues/20260731-0112-register-eligibility-js-param-seam.md`. This
file is ready to move to `issues/closed/`.
