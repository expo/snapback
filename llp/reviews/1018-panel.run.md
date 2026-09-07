# LLP 1018 panel — run record

**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Date:** 2026-09-06 (round one dispatched 19:0xZ local; round two 19:2xZ local), 2026-09-07 (revision and implementation).
**Subject:** `llp/1018-structural-moves-to-surpass-convex.research.md`, drafted by Astra (gpt-6-astra) earlier the same day.
**Panel:** Astra (gpt-6-astra, xhigh), Claude Fable 5.1, Grok 4.6 (xhigh), Muse Spark 1.3 (xhigh; ultra unavailable), Gemini 3.8 Flash (high). One record per reviewer: `1018-panel.<model>.md`.
**Protocol:** round one blind and independent (all four external models launched in parallel as detached processes; the orchestrator wrote its own position before reading any); round two cross-response on two contested designs. The orchestrator then decided direction (LLP 1018 §9), revised the document, and implemented the first slices (LLP 1018 §10): the client lane itself, the cap-metering and Quarry-hygiene lanes via codex gpt-5.6-sol at xhigh.
**Not done:** no panelist reviewed the implementation diffs in this record; implementation review is recorded separately when the lanes land.

## Round 1 brief (verbatim)

```
# Panel brief — LLP 1018 "Structural moves to surpass Convex in Clique" (round 1)

You are one of five panelists convened by Charlie Cheever (the author/owner of
this repository) to pressure-test a Research LLP before its direction is acted
on. The panel: Astra (gpt-6-astra, who drafted the document), Claude Fable 5.1
(orchestrating this panel), Grok 4.6, Muse 1.3, and Gemini 3.8 Flash. Each of
you writes an independent position first; in round 2 you will see the others'
positions and may respond.

Repository: `/Users/ccheever/projects/snapback` (you are in it, or it is your
workspace). Today is 2026-09-06.

**The document under review:**
`llp/1018-structural-moves-to-surpass-convex.research.md` (uncommitted, in
the working tree). Read it in full first.

## What the author wants from you

High-level, directional input on the *approach*: is this the right set of
structural moves, in the right order, framed against the right measure, to
make Snapback 2 beat Convex on the Clique social-messenger benchmark? Do NOT
nitpick wording, formatting, or citation style. Correcting a factual mistake
(a wrong claim about what exists, a misread ticket, a wrong number) IS
welcome — mark it clearly as a correction.

The orchestrator will then revise the document and immediately start
implementing whatever the panel is directionally confident in. So your most
valuable output is: what should be built first, and what should NOT be built.

## Required reading (time-box it; the document is the subject)

1. `llp/1018-structural-moves-to-surpass-convex.research.md` — the subject.
2. `rules/RULES.md` and `rules/NOT-DOING.md` — binding constraints on
   Snapback 2 (budgets, "delete don't deprecate", the three bars, what is
   deliberately not built). A move that violates these needs an explicit trade.
3. `llp/1000-snapback2.explainer.md` — orientation root; what exists.
4. `llp/1012-local-first-v1.spec.md` §3 (the model on one page), §5–§8
   (eviction, drain, outbox, receipts/validators) — the client model the
   document's move one wants "completed".
5. The evidence the document cites, at least:
   - `benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-008-interim-holistic/score.md`
     (the per-category scores; the Snapback and Convex sections)
   - `issues/20260906-snapback2-second-browser-tab-cannot-share-the-offline-carrier.md`
   - `issues/closed/20260906-snapback2-clock-query-delivery-identity.md`
   - `issues/20260906-snapback2-cap-metering-makes-multi-row-inserts-uncertifiable-at-large-caps.md`
   - `issues/20260906-snapback2-quarry-operation-table-name-collision.md`
   - `issues/20260906-snapback2-rebuilt-survivor-uniqueness.md`
   - `benchmarks/briefs/social-messenger.md` (the Clique brief; skim the
     milestones and the scoring section)
6. Skim the actual client so your opinion about move one is grounded:
   `snapback2/packages/snapback2/src/` — especially `client.ts`,
   `client-offline.ts`, `offline.ts`, `drain.ts`, `live.ts`,
   `react-core.tsx`, and `store/range-store.ts`, `store/outbox.ts`; and the
   guide page `snapback2/packages/snapback2/guide/offline.md`.
7. Optional context: `llp/1001-query-engine.spec.md` (engine), `llp/1017`
   (caps/fan-out), `llp/1011` (Quarry ergonomics, §0 on deferred `fn`),
   `llp/1016` (administrative plane), `llp/1015` (control plane).

## Questions to answer (all of them, briefly)

1. **Thesis and measure.** The document's architectural measure is
   "application-owned infrastructure removed" (corrective caches, custom
   indexers, subscription coordinators, resume anchors, recovery scripts).
   Is that the right target for beating Convex on Clique? Is there a better or
   additional measure? Is the thesis (primitives are competitive; the
   composition/plumbing is the gap) actually supported by the evidence?
2. **The four moves.** Client coherence; efficient execution and certification
   that agree; Quarry owns semantics; whole-application evolution. For each:
   keep / change / drop, and why. Is a structural move missing — something the
   document is blind to (the React hook surface, the wire, the twin, the
   diagnostics/dev loop score of 65 vs 87, the "queries and live" gap of 65 vs
   87, documentation/guide shape, or anything else)?
3. **Ordering and the first slice.** Agree with client coherence → certified
   composition → Quarry simplification → evolution? Independent of the
   ordering: what is the single highest-leverage slice that could be
   implemented in roughly one to three days of focused work and would be
   visible to a fresh builder in the next Clique run? Be concrete about what
   it removes from the builder's plate.
4. **Move one's decomposition.** The document proposes "one transactional
   ownership boundary for row versions, coverage, answers, outbox settlement,
   and invalidation", delivery identity for clock-dependent reevaluation, a
   platform-owned browser-tab policy, and shared subscriptions. Is that the
   right primitive set? Would you decompose the client differently (for
   example: one versioned log with a single reducer; a leader tab owning the
   carrier with followers as thin mirrors; query composition instead of
   subscription dedup)? Where does the current code already have the right
   shape and where does it fight itself?
5. **Biggest risk.** Where would the plan as written most likely burn effort
   without moving the Clique outcome? What would you cut or defer?
6. **Corrections.** Any factual errors in the document.

## Output

Write at most ~1,500 words of markdown with exactly these sections:

```
## Verdict on the thesis
## The four moves (keep / change / drop / add)
## Ordering and the first slice
## Move one: decomposition
## Biggest risk and what to cut
## Corrections
## Summary for the author (one paragraph)
```

Rules: this is a read-only review. Do not modify, create, or delete any file
in the repository. Do not run builds or tests. Cite files by path when a claim
depends on code. Say "I did not check" rather than guessing about something
you did not read. Your final message is your review; make it self-contained.
```

## Round 2 brief (verbatim)

```
# Panel brief — LLP 1018, round 2 (cross-response; short)

You reviewed `llp/1018-structural-moves-to-surpass-convex.research.md` in
round 1. All five round-1 positions are now available, verbatim:

- Astra (gpt-6-astra, the document's drafter): `PANEL/r1/astra/final.md`
- Claude Fable 5.1 (orchestrator): `PANEL/r1/claude/final.md`
- Grok 4.6: `PANEL/r1/grok/log.txt` (the review follows the narration lines)
- Muse 1.3: `PANEL/r1/muse/log.txt`
- Gemini 3.8 Flash: `PANEL/r1/gemini/log.txt`

where `PANEL` = `/private/tmp/claude-501/-Users-ccheever-projects-snapback/25ca68be-0513-4617-8581-ae0cfe590270/scratchpad/panel`.
Read all five. Repository: `/Users/ccheever/projects/snapback`.

## The orchestrator's provisional decision (so you can attack it)

Convergent across the panel and adopted: keep the thesis; add a second
countable measure (contracts the builder had to derive from behavior /
Snapback-attributed correction loops); move one stays first but is rewritten
to name what is actually missing above the already-transactional store (a
per-`(op,args,drain)` shared, refcounted query entry that `subscribe`, the
drain and `useQuery` all read from; `mounted` refcounted; resume membership
not tied to hook lifetime; publish the landed clock repair); move two's first
slice is cap metering; move three is narrowed to emitter hygiene plus
source-located diagnostics with the typed IR cut; move four becomes tickets
plus an evidence-led M7 run; a "discoverability" move is added.

Two design points are being implemented now and are where I want your fire:

**(a) Browser-tab policy.** I intend the *minimal* policy: a second tab whose
partition lock is held runs as an **online-only follower** (no held answers,
no outbox; offline writes refuse honestly) and **waits on the Web Lock**; when
the leader tab closes, the follower acquires the lock, opens the partition,
resumes, and drains the queue the leader left. No BroadcastChannel mirroring,
no command forwarding, no second copy of retained state. Rationale: it deletes
the builder's per-tab-database hack and gives durable queue recovery at
one-flag cost and zero bytes; forwarding writes to the leader is deferred as a
ticket. Grok argued not to build any of this now; Gemini and Astra argued for
leader plus thin followers. Attack the minimal policy: what breaks (account
transitions while waiting, leader crash vs close, StrictMode double-create,
the follower's `useOutbox`/`useMutation` readiness semantics), and is
"online-only until takeover" an honest product behavior or a trap?

**(b) Cap metering.** Per-distinct-key charging does NOT fix the benchmark
case (49 inserts under `cap 1000 by principal` are 49 distinct keys). The
honest fix LLP 1017 §2.4 already names: when the schema declares
`maintain <t> = count <table> by <the same by columns>`, the engine's cap
probe reads that maintained row (one examined row, exact) instead of scanning
up to N, and the certificate reserves 1 per call instead of N; the `check`
refusal for an over-budget cap reserve gets a rewrite that suggests exactly
that `maintain` line. Twin does the same from a held count row, falling back
to today's scan/partial behavior when the row is not held. Attack this: is
the maintained count exact at probe time inside the transaction (ordering of
the maintained write vs the constraint check)? Does requiring a `maintain`
declaration violate "one declaration supplying several guarantees" badly
enough to justify an engine-owned hidden count instead? Any successor or
rebuild hazard?

## Output (≤ 700 words, markdown)

```
## (a) Tab policy — verdict and the sharpest objection
## (b) Cap metering — verdict and the sharpest objection
## One thing in another panelist's position that is wrong and matters
## Anything that should change my direction (or "nothing")
```

Read-only: do not modify any file. Cite file paths for code claims. Say
"I did not check" rather than guess.
```
