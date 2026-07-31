# Move 4 first slice: live-search design pass in LLP 0073's frame + React/query-group rerun arm prep

**Status:** Open
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
