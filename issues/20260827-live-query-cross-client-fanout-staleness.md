# Live-query cross-client fanout staleness: committed writes may not wake other clients' subscribed hooks (clique-matrix lead)

**Status:** Open
**Opened:** 2026-08-27
**Systems:** Realtime, Subscriptions, Auth custody
**Source:** Clique benchmark matrix (published Snapback 0.1.29), sol-snapback-explicit + sol-snapback-familiar lanes
**New-vs-regression:** NOT a regression. Most likely an ARTIFACT of the shared-custody
headless test setup, with one residual (pre-existing, already-known) JS-live-query matcher
question a clean 2-partition repro must isolate. (See "Classification" below.)

## Symptom

Strong, long-running model lanes reported that a committed write does not reliably
wake *other* clients' already-subscribed live-query hooks — "cross-client live-query
fanout staleness." It was the dominant Snapback friction of the matrix and forced
every messaging feature onto polling.

Concrete reports (quoted from lane diaries/essays):
- `sol-snapback-familiar` (essay, tagged `snapback-defect`): "an Alice message settled
  and appeared after a fresh query, but remained absent from Bob's already-open live
  hook… cross-client fanout remained stale." Worked around with 250–400 ms polling +
  "online-only document refresh"; hit `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT` after
  nonce-churn workarounds.
- `sol-snapback-explicit` (M4, tagged `snapback-defect`): "Nested reaction reads
  committed correctly but did not wake the active JS live query, and even a dedicated
  reaction query did not deliver insert/patch changes." Workaround: refresh a bounded
  reaction projection every 400 ms.

Both profiles hit it. Builders repeatedly asked for a **causal diagnostic** — a single
trace connecting hook → authority generation → mutation commit → invalidation
publication → subscriber revision — and none exists.

## Two competing hypotheses (must disambiguate before calling it a fanout defect)

1. **Genuine fanout defect** in the invalidation-publication → subscriber-revision path:
   a committed mutation's invalidation does not reach an already-open subscription on a
   different client.
2. **Artifact of the headless multi-persona test setup.** The lanes ran multiple headless
   clients that (per the same diaries, problem F) **shared the default durable auth
   partition**, so "the second client restored the first principal"
   (`SNAPBACK_OUTBOX_IDENTITY_MISMATCH` / `_NOT_WRITER` / `AUTH_STALE_RESULT`). Two
   clients sharing one durable custody partition could collapse or steal each other's
   subscriptions, and the `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT` seen after nonce-churn
   workarounds points the same way. Under this hypothesis the "staleness" is a
   test-harness custody artifact, not a core fanout regression.

## Classification — REVISED 2026-08-28 (LLP 0317 r2 F2/O14; supersedes the 2026-08-27 verdict below)

**Revised verdict: the shared-custody artifact is real but is *not* established as the
dominant cause. Three of the four reported shapes lie outside the mechanism entirely and
remain open and unexplained.**

The 2026-08-27 investigation (retained verbatim below, and its evidence 1–4 still stands)
concluded that hypothesis 2 was dominant. Two independent model families reviewing LLP 0317
found that conclusion over-generalized from a Node-only mechanism to browser evidence. The
decisive fact: `warnImplicitDefaultPartitionReuse` in
`packages/snapback-client/app-client.mjs` returns unless
`typeof globalThis.process?.versions?.node === 'string'` — durable-custody partition reuse
is a Node/headless phenomenon and **cannot occur between two Playwright browser contexts**.

**Four shapes, only one of which the artifact explains:**

| # | Shape | Evidence | Covered by shared partition? |
|---|---|---|---|
| a | Headless personas restoring one principal; outbox identity/writer refusals | `sol-snapback-explicit` `1787853600`→`1787853610` | **Yes** — real, and repaired |
| b | A settled mutation absent from the **same** client's live hook for 3 s, present after a fresh query | `sol-snapback-familiar` `1787857038`, recorded by `manual-playwright` | **No** — one client |
| c | Cross-client staleness under two Playwright contexts *while the same-client projection updated* | `sol-snapback-familiar` `1787857472` | **No** — browser contexts |
| d | An unscoped `allMessages` live query "went silent" on a 179-row thread | `grok-snapback-explicit` M3 | **No** — bound-related, one client |

`sol-snapback-explicit` M5 supplies the sharpest discriminator to test first: "nested or
custom live-query dependencies remained stale while direct row queries converged."

**Required repro (this is lane L1 of LLP 0317.000, and it is the highest-value lane in that
program).** Two partitions **and** two browser contexts, plus a direct-row-query control
against a nested/child-row dependency, plus an over-bound query. Per LLP 0317.000 P1, a
"not reproducible" verdict requires ≥10 consecutive passing runs on the reported platform and
shape; anything less is `inconclusive`.

**L1 results so far (2026-08-28/29).** The harness (`demos/_kit/tests/live-query-invalidation-e2e.mjs`)
ran ×10 per shape on `expo-build-450b` (Linux x86_64) against a clean, exact-current binary
after `8b332808f` fixed a bug that had prevented shapes (a)–(c) from running at all. Shapes
(a), (b), (c) and the exact-179 case each delivered on the still-attached original
subscription 10/10 (30–144 ms after settlement, distinct principals and partitions). What
did reproduce, 10/10 on both platforms, is a different mechanism from fanout: past the
1,024-row implicit ceiling the reevaluation is refused with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` and the server delivers that as an anonymous
quarantine that blanks the subscription — owned by
`issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`. Because (b) and
(c) were reported from real browser contexts, they stay `inconclusive` until the browser arm
runs (`issues/20260829-o14-real-browser-arm-harness.md`). Record:
`issues/closed/20260829-l1-live-query-invalidation-linux-verdict.md`.

**Blast radius of the earlier verdict.** It was also asserted as settled in
`diaries/0114-clique-published-0129-matrix.diary.md` and
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md` §6, where it justified
discounting the familiar lanes' O2/B3/B4 realtime scores. Both are corrected in the same
landing and that discount is now provisional: if L1 confirms an invalidation defect, those
scores must be restated.

---

## Original classification (2026-08-27) — retained verbatim; evidence 1–4 still stands, the dominance verdict does not

Verdict: **hypothesis 2 (test-harness artifact) is the dominant cause; not a clean
regression.** One residual, pre-existing JS-live-query matcher question remains that only a
2-partition repro can isolate. Evidence:

1. **Core cross-client fanout works and is CI-covered.** `guide/realtime/live-queries.md`
   ships a CI-verified "realtime update reaches a second client" snippet
   (`demos/todo/tests/acceptance/headless.mjs`). `demos/_kit/tests/live-delta-e2e.mjs`
   asserts a real `live_delta` (not a replace) reaches a second socket client.
   `demos/messaging-snapback/tests/acceptance/headless.mjs` runs FOUR independent principals
   with independent stores and passes membership-gated cross-principal live delivery — the
   clean separate-partition case, green in CI.
2. **Last-known-good is recent and in the same lane.** Diaries 0093/0094 (2026-08-18,
   published 0.1.24): cross-client invalidation "consistently sub-second." Diary 0104
   (2026-08-20/21), the *same* sol-Clique-explicit lane: two-client live updates working
   (838/986/1437 ms) — and it documents the exact gotcha: "Headless acceptance personas
   shared the default durable auth partition until each client received an explicit
   `storagePartition`."
3. **No regressing commit.** ~3 weeks of `crates/snapback-{sync,engine,server}` history: the
   only delta-path change is `ce9f2f564` (2026-08-26, projection-scoped delta patches + a
   `SNAPBACK_GRAPH_EXEC_DISABLED` replace-fallback kill switch) — it changes which *fields*
   serialize, not *whether* a subscription wakes, and ships regression tests. Nothing stops a
   committed write from waking a different client's open hook.
4. **The cited codes are custody-collision codes.** `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`
   is a per-`connection_id` cap of 64 (`MAX_LIVE_SUBSCRIPTIONS_PER_CONNECTION`,
   `crates/snapback-engine/src/local/engine.rs:197`) — nonce-churn workarounds that leak
   subscriptions on one multiplexed connection exhaust it. Durable auth custody is keyed by
   `(app identity, storagePartition)`, default `'default'`; `guide/clients/headless.md` +
   `guide/recipes/multi-persona-clients.md` warn that multi-persona harnesses MUST assign a
   distinct `storagePartition` per persona or "every client may restore the same principal"
   (`SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE`). The report's own
   `SNAPBACK_OUTBOX_IDENTITY_MISMATCH` / `_NOT_WRITER` / `AUTH_STALE_RESULT` are exactly those
   collision codes — so "Bob" was likely restoring Alice's durable principal and his
   subscription was not a genuinely independent second-principal one.

**Corroborating precedent:** `issues/20260820-familiar-live-subscription-contention.md`
already classified a similar matrix "fanout" report as a documented LLP 0200 §2.5 composition
bound, not a defect. These lanes have a track record of attributing harness/composition
effects to "fanout defects."

**Residual (do not dismiss):** sol-snapback-explicit's M4 report ("nested reaction reads
committed but did not wake the active JS live query") overlaps an **already-open,
un-root-caused** guide item — `guide/realtime/live-queries.md` notes "Clique still observed a
blank" on `postById`/`repliesForPost` around a JS `writePost`, faithful wire trace still open.
So a narrow genuine defect on the **JS live-query matching-insert** path cannot be excluded
from diaries alone — but it would be **pre-existing and already known, not a new regression.**

**Bottom line:** not new, not a regression; the headline "stale fanout" is the shared-custody
harness artifact. Keep this ticket open only to run the 2-partition repro below and settle the
residual JS-live-query matcher question (fold into the existing guide open item if confirmed).

## Verification plan (clean repro to isolate a genuine defect)

Minimal 2-client repro on published 0.1.29 with **separate durable auth partitions**
(eliminate the custody-sharing confound): client A subscribes a live query; client B
commits a write to a row A's query matches; assert A's hook updates without a manual
refresh and without polling. Compare against the guide live-query CI snippet and the
last-known-good coterie demo. If A's hook updates cleanly with separate partitions, the
matrix symptom is the custody artifact (hypothesis 2) and the real ticket is the
shared-partition subscription collapse; if it stays stale, it is a genuine fanout defect
(hypothesis 1).

## Also requested by builders

A causal diagnostic/receipt tracing a live update end to end (hook → authority-gen →
mutation-commit → invalidation-publication → subscriber-revision). Its absence is why
lanes could not self-diagnose whether they were hitting hypothesis 1 or 2.

## Owner

Realtime/subscriptions. Graduate to Linear (Exact project, Snapback label) if the clean
repro confirms a core fanout defect.
