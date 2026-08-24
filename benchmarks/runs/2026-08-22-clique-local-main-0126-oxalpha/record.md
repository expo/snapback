# Run record — Clique local-main 0.1.26 ox-alpha on pi

**Status: CALIBRATION — unpublished current-source evidence, not
claim-eligible, different model+harness than every prior Clique record.**
Both requested profiles reached M1–M3 green on their final shipped trees.

## Results

| Lane | Outcome | Wall (agent-active) | Output tokens | Tool uses | Correction loops |
|---|---|---|---:|---:|---:|
| oxalpha-clique-r2 (explicit) | M1–M3 green (7/7, 22/22, 7/7 + choreography) | ≈8.8 h span incl. infrastructure kill + resume | 396,294 | 1,439 | 5 notable (report-listed) |
| oxalpha-clique-familiar | M1–M3 green (7/7, 22/22, 7/7 + choreography receipts) | ≈3.4 h agent span + 130 s finish nudge | 187,777 | 716 | 7+ (report-listed) |

Metering channel (`tokens.source`): pi coding-agent JSONL event stream,
cumulative per-message usage from `message_end` assistant events
(`input_tokens` excludes cache reads; `cached_input` is reported separately by
the provider). Tool uses counted from `tool_execution_end`. Walls are spans
between launcher meta epochs minus disclosed idle/resume gaps; they are not
comparable to Codex-harness walls from other records.

## Harness reliability events (environment-attributed, disclosed)

This run surfaced a failure mode no prior Clique record has: **ox-alpha's
text-only turns terminate a headless pi session**, and OpenRouter delivered at
least one **0-token empty completion** that ended attempt 1 of the explicit
lane mid-M1 with exit 0. Handling policy (fixed, logged nudges on the same
session — harness behavior, not human steering):

- explicit attempt 1: aborted by empty completion at ~30 min; retained as
  `logs/oxalpha-clique-r2.jsonl` history; superseded by r2.
- r2: main session was killed mid-choreography by an orchestrator cleanup
  mistake during staging recovery (my `pkill`, not the model); resumed same
  session with one logged nudge, completed everything.
- familiar: stopped text-only after essay.md but before final-report.md;
  finished via a 130-second logged finish nudge.

## Findings and run-environment observations

1. **The unqualified dry-run closure refused scaffolded `single_table_v1`
   queries.**
   Both lanes, both profiles: template `liveFeed`/`olderFeedPage` /
   homeFeed-style queries classify as authority-independent
   `single_table_v1` plan queries, which closure 0.1.26 refuses under dev
   (`SNAPBACK_CAPABILITY_UNSUPPORTED`) because default dry-run staging did not
   supply `bin/packaged-store-qualification.receipt.json`. That artifact was
   not a publish-qualified closure; the real-publication path requires the
   receipt. Both lanes worked around the calibration setup by making queries
   authenticated and membership-scoped. The existing open
   `issues/20260807-qualified-staging-missing-store-receipts.md` owns qualified
   staging and its pending flip evidence; this run does not create a duplicate.
2. **`.order()` inside an admitted JS query handler poisoned result serving.**
   Every field then refused with `SNAPBACK_UNKNOWN_FIELD`; the lane used a
   JS-side sort as a workaround. Current source and Guide support server-side
   `.order()`, so the candidate behavior is filed for packed-current
   revalidation in `issues/20260823-js-query-order-poisons-result-serving.md`.
3. **Password floor mismatch (candidate-pin observation):** the lane saw a
   12-byte floor despite declaring `minimumLength: 8`. Current `main` tests the
   configured eight-byte floor; re-reproduce before treating this as open.
4. **Live hooks reject one-shot Query-kind references (intended boundary).**
   Count-style queries had to become LiveQueries; the current React Guide
   documents that `useSnapbackQuery` accepts a `LiveQueryRef`.
5. **Supervisor-minted demo session expired after a candidate-pin backend
   restart** and `SNAPBACK_AUTH_SESSION_EXPIRED` hard-failed client boot.
   Current LLP 0295 successor/cold-reattach evidence preserves durable
   sessions, so no current defect is asserted without re-reproduction.
6. **A dev-only empty LogBox toast intercepted all pointer events.** This was
   an Explicit lane-local app/harness observation that required two-client
   testing; its Snapback attribution was not independently established.
7. **Port budget (pre-fix observation):** after resume, the r2 backend re-bound
   outside its declared 48040–48059 range (56472/56473) and Metro auxiliaries
   stayed outside it. The fixed-origin lifecycle ticket is now closed.

Agent-error loops were ordinary and well-attributed by both lanes: codegen
dialect refusals (take ceiling, `.then` in handlers, asset access policy),
three-arg `ctx.db.patch/delete` dialect, required-field slips, quote unwrap.
Familiar's verdict on dialect cliffs ("cost hours when hit blind") matches
`0104-sol-high-clique-explicit-local-main`,
`0105-sol-high-clique-familiar-local-main`, and
`0112-sol-high-clique-local-main-0125`.

## Comparison notes

Not comparable across models or harnesses (single N, first ox-alpha/pi run),
but the shape matches recent records: the strict authored→generated→admitted→
evidenced chain reads as reassurance once learned, and the recurring costs are
the dev-supervisor lifecycle, capability/packaging surprises, and dialect
cliffs — not query authoring. ox-alpha needed no Snapback source inspection in
either lane beyond staged package files, per prompt rule.

## Evidence pointers

Raw lanes, JSONL event streams, prompts, session files, receipts, reports, and
essays retained outside git at `~/clique-oxalpha-20260822/` on the Durand host
(`100.85.133.74`). Build experience consolidated in
`diaries/0110-oxalpha-clique-local-main-0126.diary.md`.

## Current-main reconciliation — 2026-08-23

The candidate pin `261e595ad` is evidence about that unpublished closure, not
today's `main`. Finding 1 came from intentionally unqualified default dry-run
staging and routes to the existing qualified-staging owner. Current source
contradicts or supersedes findings 3, 4, 5, and 7; finding 6 remains
app/harness-local and unverified. Only finding 2 remains newly open for current
packed revalidation of a supported verb.
