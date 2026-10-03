# Client-contract evidence ledger

Date: 2026-10-03. Research snapshot at `e15de2e49a084f75c0878ca19fdeb15dd4e7a7a3`.

Source lines are 1-based physical lines. Quotes are exact substrings, not normalized prose. A = availability; B = custody without prediction; R = receipt/history composition; F = fixed per-author follow history; L = authorized subscription and interaction lifetimes. “—” means no narrow cost citation was selected, never that the builder paid zero cost. The main denominator is Astra #16–#29. Older calibrations are a separately reported sensitivity sample.

Q/C/O/D abbreviate `queries_and_live`, `client_integration`, `offline_sync`, `data_modeling`. A category is attached only where the scorer discusses that cost; uncited narrative findings have no fabricated score penalty. Δ is score minus the category mean; ε is score minus its fitted trend. For #16–#29 both use that 14-run series; earlier rows use the complete 29-run Astra sensitivity series. Grok rows show raw scores only: the comparative and single-backend instruments are different, so no pooled two-point trend is presented.

## Calibration 1

Score source: [benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/holistic-score.md](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/holistic-score.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “This trades bounded acquisition for full conversation history and remains a scale risk.” — [diary.md:8](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/diary.md) | — (narrative evidence only) |
| R | “The horizon/retention interaction made that promise harder to use safely than the guide suggested.” — [diary.md:8](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/diary.md) | — (narrative evidence only) |
| B | “Live presence inside send fought prediction: `why` named the precise server-only read, and moving that decision into a service-only Quarry query at notification dispatch restored prediction.” — [diary.md:18](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/diary.md) | — (narrative evidence only) |

No category note was directly attributed to these selected narrow costs.

## Calibration 2

Score source: [benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.12/astra/holistic-score.md](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.12/astra/holistic-score.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| B | “The offline queue still existed, but the user had no predicted message bubble to see.” — [essay.md:9](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.12/astra/essay.md) | — (narrative evidence only) |
| R | “The receipt helper's early return was the isolating difference.” — [essay.md:13](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.12/astra/essay.md) | — (narrative evidence only) |

No category note was directly attributed to these selected narrow costs.

## Calibration 3

Score source: [benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.16/astra/FINAL.md](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.16/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “local query completeness is an extra concept to understand.” — [lane-diary.md:9](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.16/astra/lane-diary.md) | Q 91; +5.93; +7.72 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2–M5 delivered live feeds, pagination, reactions and indexed offline search. Final-report records page50/page1 at 0.983 and Following500/Following5 at 1.034. Essay identifies explicit replica completeness and additional feed projections as the main modeling costs.”

## Calibration 4

Score source: [benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19/astra/FINAL.md](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “Completeness horizons require deliberate modeling;” — [FINAL.md:36](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19/astra/FINAL.md) | O 92; -0.28; +0.36 |
| B | “The online ranked side effect also means a like can queue without predicting a local row.” — [lane-essay.md:35](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19/astra/lane-essay.md) | O 92; -0.28; +0.36 |

Scorer wording for the attributed categories:
- **offline_sync**: “diary.md M6/M8 and final-report.md establish ordered offline flush, two-device convergence, cached search and queued-write durability across process restart. Completeness horizons require deliberate modeling; Trending likes queue without prediction. Native lifecycle execution remains unmeasured.”

## Calibration 5

Score source: [benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.21/astra/FINAL.md](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.21/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “it adds partition-completeness decisions that matter for offline reads.” — [lane-diary.md:7](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.21/astra/lane-diary.md) | O 90; -2.28; -1.70 |

Scorer wording for the attributed categories:
- **offline_sync**: “M5/M8 diary and final report describe cache purge, shared search, durable queue restart, and multi-device convergence. Essay identifies explicit projection-completeness modeling as the learning cost. The horizon-guard regression is agent-attributed; simulator behavior remains unproven.”

## Calibration 6

Score source: [benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22/astra/FINAL.md](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “Quarry still required learning: row references, optional fields, principal types and page completeness are real distinctions, and JavaScript habits did not always translate.” — [lane-essay.md:9](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22/astra/lane-essay.md) | Q 91; +5.93; +7.27 |
| B | “Integrating the recipe made profile saves queue without prediction; that is acceptable for this milestone but a visible tradeoff.” — [lane-diary.md:15](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22/astra/lane-diary.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **queries_and_live**: “Paginated feeds/history, live counts, typing and receipts passed M2/M3; M5 reused one indexed search family online and offline (diary.md). Explicit page completeness and feed merging added concepts the author had to understand (essay.md).”

## Calibration 7

Score source: [benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23/astra/FINAL.md](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “complete UI search relies on acquired data” — [FINAL.md:28](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23/astra/FINAL.md) | Q 82; -3.07; -1.88 |
| B | “Some operations therefore queued without a predicted row.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23/astra/lane-essay.md) | O 91; -1.28; -0.81 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3 paging and live messaging worked; M5 reused device indexes offline. Final-report.md documents N_WIDE_MERGE and N_NEVER_COMPLETE server-search limitations, while complete UI search relies on acquired data and feeds require substantial bounded read models.”
- **offline_sync**: “Essay.md and M6/M8 report package-owned durable queues, browser-process restart survival, cached history/media/search, ordered replay, and multi-device convergence. No second application queue was needed; native execution remains unproven, and some writes queue without prediction.”

## Calibration 8

Score source: [benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.24/astra/FINAL.md](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.24/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “The author must learn which operations preserve completeness, which reads can predict, and where a page is only a page rather than a complete set.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.24/astra/lane-essay.md) | Q 78; -7.07; -6.03 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3/M8 demonstrated paginated feeds and live convergence. However, final-report.md records N_WIDE_MERGE for 1,000-chat search, incomplete meter cuts, and a UI limited to held-message search; unrestricted sync also raises cost concerns.”

## Calibration 9

Score source: [benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/astra/FINAL.md](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “The details about held search, acquisition, session rotation, cache revocation, presence grace and schedule admission affected real implementation decisions.” — [lane-essay.md:17](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/astra/lane-essay.md) | Q 86; +0.93; +1.82 |

Scorer wording for the attributed categories:
- **queries_and_live**: “diary.md M1–M5 reports live updates, paginated feeds/history, and indexed offline search. final-report.md describes membership-batched online global search and held UI results with incompleteness labels; essay.md identifies acquisition and limited join flexibility as tradeoffs.”

## Calibration 10

Score source: [benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/FINAL.md](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “The server API remains bounded and reports incompleteness rather than disguising a partial scan as exhaustive.” — [lane-essay.md:15](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/lane-essay.md) | — (narrative evidence only) |
| B | “My responsibility was to show a truthful pending state even when a write could be queued without a predicted row.” — [lane-essay.md:21](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/lane-essay.md) | O 92; -0.28; +0.01 |
| R | “The distinction between retained history and current authorization was nevertheless real work; a retained message is not permission to keep downloading revoked media.” — [lane-essay.md:13](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/lane-essay.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **offline_sync**: “M6/M8 Node-replica proofs preserved history, viewed media, search, and queued writes across restart, then delivered once in order. SDK replay worked; documented queued-without-row outcomes required application view metadata. Native simulator behavior remained unproven.”

## Calibration 11

Score source: [benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27/astra/FINAL.md](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “the local query card adds meaningful completeness/freshness obligations.” — [lane-diary.md:23](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27/astra/lane-diary.md) | Q 83; -2.07; -1.47 |

Scorer wording for the attributed categories:
- **queries_and_live**: “Diary M2/M3 records working paginated feeds and live messaging. The feed recipe required substantial serving structures; M5 search required complete local acquisition or a two-cursor server walk, with explicit completeness obligations.”

## Calibration 12

Score source: [benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/astra/FINAL.md](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A first revocation proof mistakenly accepted an empty loading screen as evidence of deletion; waiting for a loaded conversation fixed the test and demonstrated that learned revocation persists across the next offline reload.” — [lane-diary.md:27](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/astra/lane-diary.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:

## Calibration 13

Score source: [benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.29/astra/FINAL.md](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.29/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “I recorded that as a platform gap and made the UI disclose incompleteness rather than imply an exhaustive result.” — [lane-essay.md:29](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.29/astra/lane-essay.md) | Q 78; -7.07; -6.77 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3 live feeds, pagination and receipts passed; shared offline search worked. At scale, u09 exhausted 32 first-term words, returning complete=false without continuation (run-log.md, snapback4-defect). This materially limits the requested exhaustive, paginated search.”

## Calibration 14

Score source: [benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.30/astra/FINAL.md](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.30/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “The more consequential learning concerned completeness.” — [lane-essay.md:21](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.30/astra/lane-essay.md) | Q 85; -0.07; +0.08 |
| B | “I still had to make operations eligible to predict, and sometimes a write deliberately queued without a predicted row.” — [lane-essay.md:9](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.30/astra/lane-essay.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2 feeds paginated correctly, M3 messaging updated live, and M5 search worked offline. Completeness diagnostics clarified query scope, but Following required a substantial recipe and broad public replication; exact trending needed additional modeling (diary.md, essay.md).”

## Calibration 15

Score source: [benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/astra/FINAL.md](../../../benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “the local store is a first-class choice but has explicit acquisition semantics to handle.” — [lane-diary.md:2](../../../benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/astra/lane-diary.md) | C 90; +2.52; +2.52 |
| B | “The compiler sometimes told me that a query was incomplete or that a mutation would queue without a predicted row.” — [lane-essay.md:13](../../../benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/astra/lane-essay.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **client_integration**: “M1/M6/M8 used published React/local and Expo arms for sessions, live state, and reconnect with little queue code. Acquisition and prediction semantics required care. Router and Metro corrections are excluded as agent/environment issues (diary.md; essay.md; run-log.md).”

## Calibration 16

Score source: [benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/FINAL.md](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “the tradeoff is having to understand the platform's exact held/complete/pending vocabulary.” — [lane-diary.md:15](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/lane-diary.md) | C 85; -0.57; -1.23 |
| R | “The difficult question was retained history versus current membership, and the published retain policy handled that directly.” — [lane-diary.md:9](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/lane-diary.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **client_integration**: “M1/M6 diary entries report built-in sessions and straightforward headless subscriptions; Hermes exports cover every attempted milestone. run-log.md reproduces a malformed nullable-array generated type requiring a workaround. essay.md notes explicit acquisition and pending-state integration responsibilities.”

## Calibration 17

Score source: [benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/astra/FINAL.md](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “Typed rules still require careful thought about how query completeness interacts with membership scoping.” — [lane-diary.md:6](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/astra/lane-diary.md) | Q 89; +2.29; +1.00 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2–M5 demonstrated live feeds, messaging, pagination, and indexed search. Held-query semantics, broad Following merges, and continuation metadata demanded attention. The run log attributes discarded Trending metadata and excessive typing writes to application mistakes.”

## Calibration 18

Score source: [benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/astra/FINAL.md](../../../benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| R | “The tricky work was deciding receipt semantics and when a client counts as having fetched versus viewed content, not writing a transport.” — [lane-diary.md:15](../../../benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/astra/lane-diary.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:

## Calibration 19

Score source: [benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/FINAL.md](../../../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “Treating that snapshot as an empty list hid the conversation the choreography needed.” — [lane-essay.md:19](../../../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/lane-essay.md) | Q 90; +3.29; +2.47 |
| R | “Receipt aggregation still required explicit rows and a helper, but the schema made recipient authority visible.” — [lane-diary.md:8](../../../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/lane-diary.md) | D 90; +2.50; +3.31 |
| L | “I replaced the paging adapter with explicit subscriptions and preserved a known page during this unresolved state, while continuing to accept denied reads and authoritative empty pages.” — [lane-essay.md:19](../../../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/lane-essay.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3/M5 delivered paginated feeds, live messaging, and replica search; M8 demonstrated same-account convergence. Completeness required explicit client handling; ambiguous nullable-observation failures are not charged as backend defects (diary.md; final-report.md corrections).”
- **data_modeling**: “Shared Quarry declarations unified server and replica logic; maintained counts and day buckets were concise. Recipient receipts required explicit rows/helpers, and prediction/completeness introduced learning overhead (diary.md M3/M8; essay.md).”

## Calibration 20

Score source: [benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/FINAL.md](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A restored session is not a fully acquired partition.” — [lane-essay.md:15](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/lane-essay.md) | C 83; -2.57; -2.82 |
| R | “API history deliberately separates richer server receipt/reaction reads from retained device history.” — [lane-diary.md:18](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/lane-diary.md) | — (narrative evidence only) |
| F | “The published Following model backfills the newest 1,000 live events of a newly followed author.” — [lane-final-report.md:109](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/lane-final-report.md) | Q 82; -4.71; -5.30 |
| L | “My initial screen-wide acquisition gate made that cost the user's entire startup experience.” — [lane-essay.md:19](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/lane-essay.md) | C 83; -2.57; -2.82 |

Scorer wording for the attributed categories:
- **client_integration**: “M1–M8 delivered React/Expo web behavior and every Hermes export. essay.md identifies acquisition, admission and online fallback as demanding integration boundaries; M8 needed readiness UX. Native runtime was untested; Metro mistakes are not charged to Snapback.”
- **queries_and_live**: “M2/M5/M8 delivered live joins, pagination, indexed offline search and maintained Insights. final-report.md documents Following’s 1,000-event backfill limit and full-source-sync requirement; E_TIMELINE_SHAPE rejected bounded acquisition.”

## Calibration 21

Score source: [benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/FINAL.md](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “a thread sorted on a different index from its sync horizon produced transient loading, exposing bad UI lifetimes.” — [lane-diary.md:23](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/lane-diary.md) | Q 88; +1.29; +0.94 |
| B | “A durable pending-intent view, keyed by the SDK’s write ID, made the UI honest about an accepted local queue entry even when there was no predicted row.” — [lane-essay.md:15](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/lane-essay.md) | O 91; -1.14; -1.25 |
| R | “Retained messages needed a shape that did not consult inaccessible live receipt state after removal; that small conditional made the retention choreography pass.” — [lane-diary.md:10](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/lane-diary.md) | — (narrative evidence only) |
| L | “I initially treated temporary lack of data as a reason to tear down routes and rows.” — [lane-essay.md:13](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/lane-essay.md) | C 86; +0.43; +0.28 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M5 live feeds, pagination and search passed. essay.md documents explicit query/sync ordering requirements; final-report.md retains an offline coverage limitation for expiry-aware unread aggregates, addressed by separating conversation identity from optional totals.”
- **offline_sync**: “M6/M8 browser proofs demonstrated cold history/media, durable queued writes, ordered reconnect and multi-device convergence. The SDK handled dispatch and recovery; final-report.md records unavailable unread badges after cold reload, while essay.md describes additional pending-intent presentation.”
- **client_integration**: “src/client.ts compactly wires web/native devices and session stores. essay.md describes substantial explicit acquisition, prediction and settlement handling, including durable intent presentation. Web choreography passed throughout; native evidence consists of Hermes exports, not runtime interaction.”

## Calibration 22

Score source: [benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/FINAL.md](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A loading account query could remount settings.” — [lane-diary.md:19](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/lane-diary.md) | C 87; +1.43; +1.38 |
| B | “The client returned an explicit pending receipt explaining that local data did not justify a prediction.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/lane-essay.md) | O 88; -4.14; -4.18 |
| R | “Splitting the content query from live receipt state restored the intended behavior.” — [lane-essay.md:17](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/lane-essay.md) | — (narrative evidence only) |
| L | “A loading account query could remount settings.” — [lane-diary.md:19](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/lane-diary.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **client_integration**: “Generated hooks, session restoration, the offline web shell, and Expo Hermes exports supported the build. Completeness and pending states needed explicit UI handling. React lifecycle mistakes are excluded; native runtime behavior remains unproven (diary.md; final-report.md).”
- **offline_sync**: “M6/M8 demonstrated cold-offline history/search/media, durable ordered queues, and same-account convergence. Some intents required durable presentation metadata because prediction was unavailable; the SDK remained the sole transport queue. Native simulator behavior is unproven (diary.md; final-report.md).”

## Calibration 23

Score source: [benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/FINAL.md](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “treating local answer completeness and pending custody as first-class UI states.” — [lane-essay.md:27](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/lane-essay.md) | Q 85; -1.71; -1.60 |
| B | “However, an admitted write did not always produce a predicted message row.” — [lane-essay.md:15](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/lane-essay.md) | O 91; -1.14; -1.11 |
| R | “Delivery acknowledgements, for example, required bounded progress and explicit treatment of expired ordinal holes.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/lane-essay.md) | — (narrative evidence only) |
| L | “Receipt changes and query replacement could briefly withdraw an answer, causing a composer, media viewer, or action menu to lose state if it lived under the affected row.” — [lane-essay.md:17](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/lane-essay.md) | C 82; -3.57; -3.52 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2 feeds/pagination, M3 typing/receipts, and M8 aggregates/convergence passed (diary.md). Scoped search also worked offline; its initial wrong query was agent-error. Answer completeness and replacement required explicit handling (essay.md).”
- **offline_sync**: “M6/M8 demonstrated cold browser history/search, ordered replay, process-restart durability, and multi-device convergence without a hand-built queue (diary.md; final-report.md). Pending custody differs from prediction; native restart behavior remains unverified.”
- **client_integration**: “Public hooks and generated APIs delivered web behavior and seven Hermes exports (final-report.md). The answer lifecycle required stable interaction owners and bounded display continuity (essay.md); agent mistakes are excluded, and native runtime was not exercised.”

## Calibration 24

Score source: [benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/FINAL.md](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “the backend's explicit local coverage and revalidation states made those mistakes more visible and demanded more careful ownership than a simple request-response screen.” — [lane-essay.md:21](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/lane-essay.md) | Q 85; -1.71; -1.36 |
| B | “Once I treated those as separate states, the UI could show honest pending rows even when an online-only effect prevented prediction.” — [lane-essay.md:15](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/lane-essay.md) | — (narrative evidence only) |
| R | “The published receipt recipe saved design effort, but an index prefix and an equivalent-looking filter had different local coverage consequences.” — [lane-essay.md:23](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/lane-essay.md) | — (narrative evidence only) |
| L | “I initially let transient query loading unmount a conversation route and its composer.” — [lane-essay.md:21](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/lane-essay.md) | C 85; -0.57; -0.42 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3 delivered feeds, pagination and live receipts. M5/M6 required explicit server-versus-held search and complete interaction summaries for offline answers. essay.md documents substantial coverage reasoning; run-log's agent mistakes and ambiguous timing misses are not backend defects.”
- **client_integration**: “M1–M8 integrated Expo web, persistent sessions and Hermes exports. essay.md describes explicit ownership across replica reads, transient media and online typing. Route/composer mistakes are excluded; native runtime behavior remains unproven in final-report.md.”

## Calibration 25

Score source: [benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/FINAL.md](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A list can contain useful held data without proving a complete answer.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/lane-essay.md) | Q 88; +1.29; +1.87 |
| B | “A write can be durably queued without producing a local row.” — [lane-essay.md:11](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/lane-essay.md) | O 94; +1.86; +2.03 |
| R | “The price is understanding distinctions between held data, server queries, decoration queries, and pending predictions.” — [lane-diary.md:27](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/lane-diary.md) | — (narrative evidence only) |
| L | “Most friction was in client lifetimes: transient reads unmounted rows, video ownership and reaction pickers lived too low, and an old mutation completion could close a newly opened picker.” — [lane-diary.md:35](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/lane-diary.md) | C 85; -0.57; -0.32 |

Scorer wording for the attributed categories:
- **queries_and_live**: “diary.md M2–M5 reports paginated feeds, live reactions, typing, receipts, and shared server/device prefix search. essay.md explains that held data and complete answers require distinct UI handling; final-report.md records a failed search mid-curve measurement.”
- **offline_sync**: “diary.md M6/M8 reports durable custody, ordered replay, and multi-device convergence. final-report.md confirms browser cold-offline restart preserved two queued writes and flushed them exactly once in order. Partial coverage and writes without predicted rows require explicit presentation.”
- **client_integration**: “diary.md M1/M6 reports working auth and Expo replicas; final-report.md records every Hermes export and a clean token-client demo. essay.md identifies substantial hook, coverage, and custody learning. Native runtime remains unproven; application lifecycle mistakes are not charged.”

## Calibration 26

Score source: [benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/FINAL.md](../../../benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A missing local row could mean absence, incomplete acquisition, a history boundary, a pending write, or an unavailable server fact.” — [lane-essay.md:7](../../../benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/lane-essay.md) | Q 85; -1.71; -0.90 |
| R | “the receipt protocol is more elaborate but supplies local delivery semantics;” — [lane-diary.md:9](../../../benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/lane-diary.md) | — (narrative evidence only) |
| L | “The application needed stable ownership of drafts and routes, while displayed protected rows needed to follow the SDK's read lifecycle.” — [lane-essay.md:7](../../../benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/lane-essay.md) | C 85; -0.57; -0.22 |

Scorer wording for the attributed categories:
- **queries_and_live**: “M2/M3/M5 delivered live feeds, pagination and indexed offline search (diary.md). essay.md describes demanding read-completeness and publication semantics; M8 used materialized Following. The execution model adds integration complexity, without treating ambiguous transient failures as backend defects.”
- **client_integration**: “diary.md credits the Expo starter with auth, presence, media ownership and custody recipes; every milestone exported to Hermes. essay.md describes substantial read-lifecycle integration discipline. Route, hydration and Metro mistakes are agent errors; native execution was not demonstrated.”

## Calibration 27

Score source: [benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/FINAL.md](../../../benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A partial search result was not proof that no other result existed.” — [lane-essay.md:17](../../../benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/lane-essay.md) | Q 86; -0.71; +0.33 |
| R | “I wanted a simpler built-in message receipt model, but the published manual ordinal recipe was sufficient.” — [lane-diary.md:18](../../../benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/lane-diary.md) | D 87; -0.50; -1.54 |
| L | “Raw history still needed an independent lifetime from receipt and reaction decorations.” — [lane-essay.md:19](../../../benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/lane-essay.md) | C 86; +0.43; +0.88 |

Scorer wording for the attributed categories:
- **queries_and_live**: “diary.md M2/M5 reports live paginated feeds and offline search, with asynchronous Following acquisition, server-read decorations, and explicit partial coverage. essay.md identifies replica answer lifetimes as an integration cost; logged React mistakes are excluded.”
- **data_modeling**: “essay.md describes concise unified schema, rules, synchronization, and maintained aggregates, offset by learning Quarry expressions, indexes, and prediction constraints. M3 receipts required explicit ordinals, delivered runs, read positions, and membership accounting.”
- **client_integration**: “diary.md M1/M6 and run-log.md document persistent sessions, generated hooks, pending writes, and the published native template; every milestone exported Hermes. Replica loading/withdrawal and subscription ownership demand care; agent-attributed lifecycle bugs are not backend defects.”

## Calibration 28

Score source: [benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/FINAL.md](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A retained answer could remain useful while revalidating, yet still be withdrawn when its authority or deadline changed.” — [lane-essay.md:15](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/lane-essay.md) | Q 82; -4.71; -3.43 |
| B | “An operation could be admitted durably without producing a predicted row.” — [lane-essay.md:15](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/lane-essay.md) | O 91; -1.14; -0.76 |
| R | “Returning bare message hits enabled the documented current-and-retained search behavior; adding presentation joins too early changed the planner's guarantees.” — [lane-essay.md:11](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/lane-essay.md) | D 88; +0.50; -0.77 |
| L | “Deferring those until search input exists yielded six passing navigation cycles and a full M8 choreography pass.” — [lane-diary.md:29](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/lane-diary.md) | C 85; -0.57; -0.02 |

Scorer wording for the attributed categories:
- **queries_and_live**: “Feeds, pagination and live updates passed, but M2 acquisition/history contracts and M5 bare-row search requirements made query shape consequential (diary.md). The documented one-second authority-withdrawal boundary added client handling obligations (essay.md); ambiguous convergence failures are not treated as defects.”
- **offline_sync**: “M6/M8 demonstrated ordered offline flush, cross-device convergence and durable browser restart recovery (diary.md; final-report.md). Pending custody without predicted rows required explicit outbox presentation (essay.md). Hermes exports establish builds; native simulator behavior remains untested.”
- **data_modeling**: “Ownership, uniqueness, expiry and maintained aggregates mapped compactly into Quarry (diary.md M1–M8). Manual receipt ordinals, read/write phases and query-shape-sensitive coverage required additional language-specific reasoning (essay.md); syntax and day-arithmetic mistakes are not backend defects.”
- **client_integration**: “Auth/session wiring, the published React client, token-only HTTP access and seven Hermes exports worked (diary.md; final-report.md). Custody, authority and transient-handle states required deliberate integration (essay.md). Application route/viewer mistakes are excluded; native runtime remains untested.”

## Calibration 29

Score source: [snapback4/reports/20261003-cx-client-contract/cal29/scores-FINAL.md](cal29/scores-FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “A query could be loading, partial, stale, or locally answerable under a particular coverage horizon.” — [essay.md:9](cal29/essay.md) | Q 88; +1.29; +2.80 |
| B | “That required a visible pending fallback based on the SDK's pending arguments.” — [essay.md:15](cal29/essay.md) | O 92; -0.14; +0.31 |
| R | “the receipt family's mapping vocabulary takes study and query decorations need deliberate separation from retained history.” — [diary.md:9](cal29/diary.md) | D 92; +4.50; +3.00 |
| F | “The guide also states its 1,000-event per-author history window, which remains a candid scaling limitation beyond this fixture's author histories.” — [diary.md:6](cal29/diary.md) | Q 88; +1.29; +2.80 |
| L | “I changed the history presentation to retain only message IDs and ordinal order while each message rendered through its own current authorized subscription.” — [essay.md:17](cal29/essay.md) | C 87; +1.43; +2.09 |

Scorer wording for the attributed categories:
- **queries_and_live**: “Diary M2/M3/M8 reports live feeds, paginated history, receipts, and maintained aggregates working. Essay describes loading, partial, stale, and coverage-dependent reads requiring deliberate handling; M2 documents the 1,000-event per-author feed-history window.”
- **offline_sync**: “Diary M6/M8 and final-report.md record cold history/media/search, durable pending sends across reload, ordered replay, and dual-device convergence. Essay explains that durable custody can lack prediction, requiring pending UI and explicit coverage handling.”
- **data_modeling**: “Essay describes one coherent language for schema, policies, synchronization, assets, and scheduling. Diary M2/M8 credits maintained feeds and aggregates; M3 identifies receipt-mapping vocabulary and retained-history composition as meaningful learning costs.”
- **client_integration**: “M1–M8 used React/Expo integration and produced Hermes exports. Essay identifies intrinsic work around availability states, pending fallback, and authorized subscription lifetimes; M6 needed API normalization. Native runtime remains unverified, not demonstrated defective.”

## Calibration G47

Score source: [benchmarks/runs/2026-09-28-clique-cmp-0.4.7/scores-grok.json](../../../benchmarks/runs/2026-09-28-clique-cmp-0.4.7/scores-grok.json).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “whenever `myProfile` flickered to `loading`, which reset `/conversation/{handle}` back to `/`.” — [diary.md:41](../../../benchmarks/runs/2026-09-28-clique-cmp-0.4.7/grok-snapback4/diary.md) | C 64 |
| B | “Online-only likes/follows/typing still forced pending glyphs plus src/intent-store rather than predicted mutations.” — [scores-grok.json:37](../../../benchmarks/runs/2026-09-28-clique-cmp-0.4.7/scores-grok.json) | O 80 |
| R | “That is less code and more rigid: extra members in the fixture roster block the aggregate.” — [diary.md:47](../../../benchmarks/runs/2026-09-28-clique-cmp-0.4.7/grok-snapback4/diary.md) | — (narrative evidence only) |
| L | “ChatRail per-row useQuery overload later failed M3 choreo.” — [scores-grok.json:29](../../../benchmarks/runs/2026-09-28-clique-cmp-0.4.7/scores-grok.json) | Q 78 |

Scorer wording for the attributed categories:
- **client_integration**: “snapback4-expo generated api.ts, useQuery, and useAuth. Refetch {loading:true} unmounted EnsureProfile and Expo Slot (diary M3). Guide says keep the signed-in tree; the hooks still make returning null easy.”
- **offline_sync**: “Engine sync, held search, waitSeconds: 0 custody, and pending rows are first-class (M6 suite). Online-only likes/follows/typing still forced pending glyphs plus src/intent-store rather than predicted mutations.”
- **queries_and_live**: “view following and generated useQuery greened M1–M2 live. Compiler notes N_EPHEMERAL_SERVER (typing), N_SYNC_ORDER (search), N_NEVER_COMPLETE (groupNamed). ChatRail per-row useQuery overload later failed M3 choreo.”

## Calibration G28

Score source: [benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/FINAL.md](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/FINAL.md).

| Cost | Verbatim evidence and file | Cited score; Δ; ε |
|---|---|---|
| A | “Query horizons fight the brief’s offline search.” — [lane-essay.md:21](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/lane-essay.md) | Q 72 |
| B | “`setFollow` with `online only` follows is `predicts: never`.” — [lane-essay.md:19](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/lane-essay.md) | Q 72 |
| R | “Both are true; the screen must hold the last page.” — [lane-essay.md:25](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/lane-essay.md) | — (narrative evidence only) |
| L | “a handful of replica-lifetime issues (hold last history, await upload, freeze the DM id, don’t render Insights zeros while loading).” — [lane-essay.md:33](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/lane-essay.md) | — (narrative evidence only) |

Scorer wording for the attributed categories:
- **queries_and_live**: “Own-key likes and `ephemeral 4s` typing went live on two clients; M2 Following needed own-key follows and planned `home` after `view following` failed, and `messageReceipts` is messages-only so `receipt()` walks `membersOf`.”

## Independent grader evidence

These are assertion results, not the holistic scores above. No assertion failure is converted into a category-point deduction. Reports may include fixture errors and unfinished native proof; `calibrationPassed` is preserved as a report field, not reinterpreted as product qualification. Narrative cause attribution stays with the scorer; for example, Grok G28’s suggestion to hold a last page is an observed builder interpretation, not a safe current recipe.

| Calibration | Report | Assertion-result counts | Defect records | Grader calibrationPassed |
|---|---|---|---|---|
| 1 | [grader-report.json](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9/astra/grading/grader-report.json) | fail: 7, not-run: 9, pass: 85 | 4 | False |
| 2 | [grader-report.json](../../../benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.12/astra/grading/grader-report.json) | not-run: 16, pass: 85 | 6 | False |
| 3 | [grader-report.json](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.16/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 9 | False |
| 4 | [grader-report.json](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 6 | False |
| 5 | [grader-report.json](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.21/astra/grader-report.json) | not-run: 16, pass: 85 | 6 | False |
| 6 | [grader-report.json](../../../benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22/astra/grader-report.json) | fail: 7, not-run: 9, pass: 85 | 6 | False |
| 7 | [grader-report.json](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23/astra/grader-report.json) | not-run: 13, pass: 88 | 6 | False |
| 8 | [grader-report.json](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.24/astra/grader-report.json) | not-run: 16, pass: 85 | 5 | False |
| 9 | [grader-report.json](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/astra/grader-report.json) | not-run: 16, pass: 85 | 4 | False |
| 10 | [grader-report.json](../../../benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/grader-report.json) | not-run: 16, pass: 85 | 5 | False |
| 11 | [grader-report.json](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 10 | False |
| 12 | [grader-report.json](../../../benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 2 | False |
| 13 | [grader-report.json](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.29/astra/grader-report.json) | fail: 7, not-run: 9, pass: 85 | 9 | False |
| 14 | [grader-report.json](../../../benchmarks/runs/2026-09-18-snapback4-clique-astra-0.2.30/astra/grader-report.json) | not-run: 16, pass: 85 | 4 | False |
| 15 | [grader-report.json](../../../benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 5 | False |
| 16 | [grader-report.json](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.32/astra/grader-report.json) | not-run: 13, pass: 88 | 4 | False |
| 17 | [grader-report.json](../../../benchmarks/runs/2026-09-22-snapback4-clique-astra-0.2.33/astra/grader-report.json) | not-run: 16, pass: 85 | 3 | False |
| 18 | [grader-report.json](../../../benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/astra/grader-report.json) | not-run: 16, pass: 85 | 5 | False |
| 19 | [grader-report.json](../../../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/grader-report.json) | not-run: 16, pass: 85 | 5 | False |
| 20 | [grader-report.json](../../../benchmarks/runs/2026-09-25-snapback4-clique-astra-0.4.1/astra/grader-report.json) | fail: 7, not-run: 9, pass: 85 | 10 | False |
| 21 | [grader-report.json](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.2/astra/grader-report.json) | not-run: 16, pass: 85 | 4 | False |
| 22 | [grader-report.json](../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/grader-report.json) | not-run: 16, pass: 85 | 5 | False |
| 23 | [grader-report.json](../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/grader-report.json) | not-applicable: 1, not-run: 15, pass: 85 | 6 | False |
| 24 | [grader-report.json](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.6/astra/grader-report.json) | not-run: 16, pass: 85 | 6 | False |
| 25 | [grader-report.json](../../../benchmarks/runs/2026-09-28-snapback4-clique-astra-0.4.7/astra/grader-report.json) | fail: 7, not-run: 9, pass: 85 | 5 | False |
| 26 | [grader-report.json](../../../benchmarks/runs/2026-09-29-snapback4-clique-astra-0.4.8/astra/grader-report.json) | fail: 1, not-run: 16, pass: 84 | 4 | False |
| 27 | [grader-report.json](../../../benchmarks/runs/2026-09-30-snapback4-clique-astra-0.4.9/astra/grader-report.json) | not-run: 16, pass: 85 | 6 | False |
| 28 | [grader-report.json](../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/grader-report.json) | fail: 1, not-run: 13, pass: 87 | 4 | False |
| 29 | cal29-bundle/grading/grader-report.json (external; hash in measurements) | not-run: 16, pass: 85 | 5 | False |
| G28 | [grader-report.json](../../../benchmarks/runs/2026-10-01-snapback4-clique-grok-0.4.10/grok/grader-report.json) | fail: 4, not-run: 17, pass: 80 | 17 | False |

G47's repository record has no independent `grader-report.json`; its builder final report and comparative holistic score are retained, but no assertion-count row is invented for it.

## Code specimens and counting rule

The following are actual builder source excerpts, not proposed APIs. Physical source lines include comments and blanks when a whole block is selected; fragments on a minified line count as one physical line, never as the whole file. Byte counts are UTF-8 for the selected excerpt, excluding its final newline. Overlapping source lines are not additive. No formatting-derived LOC is presented as measured LOC. The estimates in the LLP are replacement estimates, not measurements from an implemented helper.

Calibration #29 source was read over SSH from the recorded M1 host, `/Users/ccheever/clique-sb4-20261001-astra-cal29/lanes/astra-snapback4`; its diary, essay and schema match the supplied bundle byte-for-byte. G47 was read from `/home/ccheever/clique-cmp-20260928-047/lanes/grok-snapback4`. Only selected excerpts are retained here. Full-file SHA-256 and precise line/column spans in `measurements.json` bind the measured bytes. Starter scaffolding (notably `intents.ts` and `useOnceMedia.ts`) is excluded from builder-code savings. G47’s copied/adapted receipt recipe is counted as integration burden, not original invention.

### A1

Cal29 availability branches on the search widget. This older spelling does not test cut/next/pending; current `existence` is stronger. `src/search.tsx:2–2`; **1 physical lines, 1 nonblank, 123 bytes**.

```tsx
loading={'loading'in page.read} emptyText={'data'in page.read&&page.read.complete?'No results':'Results may be incomplete'}
```

### A2

G47 stable profile gate, after its reported remount correction. Shell identity is retained, not a protected profile image; this is evidence, not endorsement of this gate for authorization. `src/AuthGate.tsx:16–22`; **7 physical lines, 7 nonblank, 281 bytes**.

```tsx
function EnsureProfile({ children }: { children: React.ReactNode }) {
  const profile = useQuery(api.myProfile, {});
  const ready = useRef(false);
  if ("data" in profile) ready.current = true;
  if ("loading" in profile && !ready.current) return null;
  return <>{children}</>;
}
```

### B1

Cal29 SDK custody subscription. `src/chat.tsx:25–25`; **1 physical lines, 1 nonblank, 42 bytes**.

```tsx
 const pending=usePendingWrites(api.send);
```

### B2

Cal29 fallback filters by conversation, suppresses a visible predicted duplicate by application message id, and projects text from arguments. It covers text send only, not sendMedia. `src/chat.tsx:37–37`; **1 physical lines, 1 nonblank, 238 bytes**.

```tsx
{pending.filter(w=>w.args.conversation===id&&!page.items.some(m=>m.id===w.args.id)).map(w=><View key={w.id} testID="sm-convo-bubble"><MessageBubble testID="sm-bubble-body" isMine text={w.args.text} receiptPending receipt="sent"/></View>)}
```

### B3

Cal29 last pending set-state intent overrides the displayed like/repost value. No row is fabricated in the replica. `src/social.tsx:19–19`; **1 physical lines, 1 nonblank, 281 bytes**.

```tsx
 const pendingLikes=usePendingWrites(api.setLike).filter(w=>w.args.postId===card?.id),pendingReposts=usePendingWrites(api.setRepost).filter(w=>w.args.postId===card?.id);const liked=pendingLikes.at(-1)?.args.set??card?.liked,reposted=pendingReposts.at(-1)?.args.set??card?.reposted;
```

### R1

Cal29 receipt-family mapping clause. `snapback/schema.q:165–171`; **7 physical lines, 7 nonblank, 282 bytes**.

```quarry
  receipts chat by .conversation, .ordinal from .sender to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
    runs runs
    operations receipt, delivered, seen, receiptMember, progress, compactReceipts
```

### R2

Cal29 separates bare retained history from live receipt decoration. `snapback/schema.q:214–217`; **4 physical lines, 4 nonblank, 311 bytes**.

```quarry
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }
```

### R3

G47 adapts the published recipe: scoped progress memory, confirmed ordinals, visibility and seen dispatch. Imports excluded. The acquired gate is historical; a new helper must use current evidence, not copy it blindly. `src/useReceipts.ts:5–41`; **37 physical lines, 35 nonblank, 1742 bytes**.

```tsx
type Viewed = { through: number; sent: number };
const views = new WeakMap<object, Map<string, Viewed>>();

function viewOf(client: object, viewer: string | null, conversation: string): Viewed {
  const scopes = views.get(client) ?? new Map<string, Viewed>();
  views.set(client, scopes);
  const key = JSON.stringify([viewer, conversation]);
  const viewed = scopes.get(key) ?? { through: 0, sent: 0 };
  scopes.set(key, viewed);
  return viewed;
}

export function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const viewer = useViewer();
  const acquired = useAcquired();
  const page = usePage(api.history, { conversation });
  const membership = useQuery(api.receiptMember, { conversation });
  const member = "data" in membership ? membership.data : null;
  const viewed = useMemo(() => viewOf(client, viewer, conversation), [client, viewer, conversation]);
  const settled = page.items.filter((m) => !m.pending).map((m) => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : 0;
  const shown = member && !member.pending ? Math.max(member.seenOrdinal, member.joinedOrdinal) : null;
  useEffect(() => {
    if (!acquired) return;
    if (visible && newest > viewed.through) viewed.through = newest;
    const through = viewed.through;
    if (through === 0 || (shown !== null && through <= shown) || viewed.sent === through) return;
    viewed.sent = through;
    void client.mutate(api.seen, { conversation, through }).then((write) => {
      if (write.state === "failed" && write.why.code === "E_ADMISSION" && viewed.sent === through) {
        viewed.sent = 0;
      }
    });
  }, [acquired, client, conversation, viewed, visible, shown, newest, membership]);
  return page;
}
```

### R4

Cal29 compressed newest-confirmed ordinal and seen reporting. Foreground lifecycle is supplied separately by line 28. `src/chat.tsx:31–32`; **2 physical lines, 2 nonblank, 371 bytes**.

```tsx
 const newest=Math.max(0,...page.items.filter(x=>!x.pending).map(x=>x.ordinal));
 useEffect(()=>{if(foreground&&newest>seen.current&&'data'in membership&&membership.data&&newest>membership.data.seenOrdinal){seen.current=newest;void client.mutate(api.seen,{conversation:id,through:newest}).then(r=>{if(r.state==='failed')seen.current=0})}},[newest,foreground,membership]);
```

### F1

Cal29 accepts materialized Following and its window. There is no custom all-history workaround. `snapback/schema.q:79–82`; **4 physical lines, 4 nonblank, 257 bytes**.

```quarry
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
```

### F2

Cal29 pages the bounded-history feed. Six setup/query lines across F1/F2; zero lines remove the history limit. `snapback/schema.q:92–93`; **2 physical lines, 2 nonblank, 145 bytes**.

```quarry
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
```

### L1

Cal29 preserves message identity/order across list withdrawal, not message bodies. As written, the identity list is unbounded; do not turn this into an SDK cache verbatim. `src/chat.tsx:26–26`; **1 physical lines, 1 nonblank, 304 bytes**.

```tsx
 const historyKeys=useRef<{id:string,ordinal:number}[]>([]);for(const m of page.items){if(!historyKeys.current.some(k=>k.id===m.id))historyKeys.current.push({id:m.id,ordinal:m.ordinal});else historyKeys.current.find(k=>k.id===m.id)!.ordinal=m.ordinal}historyKeys.current.sort((a,b)=>a.ordinal-b.ordinal);
```

### L2

Cal29 gives each preserved identity a current authorized row observation. This may add one query per identity; source reading is not a scale qualification. `src/chat.tsx:39–39`; **1 physical lines, 1 nonblank, 180 bytes**.

```tsx
function StableMessage({id,children}:{id:string,children:(m:any)=>React.ReactNode}){const r=useQuery(api.quotedMessage,{id});return 'data'in r&&r.data?<>{children(r.data)}</>:null}
```

### L3

Cal29 foreground observer lifecycle and typing cleanup. The new receipt hook would still require truthful app visibility. `src/chat.tsx:28–28`; **1 physical lines, 1 nonblank, 370 bytes**.

```tsx
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>F(s==='active'));const visibility=()=>F(document.visibilityState==='visible');if(Platform.OS==='web')document.addEventListener('visibilitychange',visibility);return()=>{sub.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',visibility);void stop.run({conversation:id})}},[id]);
```
