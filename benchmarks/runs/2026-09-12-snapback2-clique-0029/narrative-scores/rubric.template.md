You are {MODEL}, scoring one fresh Clique diagnostic cell built on published snapback2@0.0.29. Score the backend experience out of 100, holistically and by category, using only the supplied brief and this cell's continuous-builder and fresh-M7 narratives. This is one uncontrolled diagnostic observation, not a comparative or efficiency claim. No earlier score or another cell's findings are supplied.

## Permitted evidence

Read the supplied contents in full. Inputs are the frozen brief; the continuous builder's diary.md, essay.md, run-log.md, final-report.md and run-record.json where present; and fresh M7's m7/diary.md, m7/essay-paragraphs.md, m7/run-log.md and m7/final-report.md where present. Missing files remain explicitly missing. Independent grader outputs, other cells, prior runs, implementation plans and source-review findings are excluded. Builder attributions are observations to assess, not independently proven causal facts.

All permitted contents will be supplied verbatim inline with a per-file hash record after the two source phases finish. Call no tools, inspect no other source, write no files, and infer no missing evidence. Scores describe only the supplied evidence; they are separate from the independently graded assertions and any native/cap/custody qualification.

## How to score

- **100** = ideal for this brief: every milestone expressible directly, no workaround, nothing to prove twice. **75** = good, occasional friction. **50** = usable with substantial workarounds or missing pieces. **25** = fought the build at every step. **0** = unusable for this brief.
- Score the backend **as experienced on this brief through its published surface**, not its reputation or what you know it can do elsewhere. Evidence in the lane files decides; when a lane lost time to its own mistakes or to the environment (attributions `agent-error`, `environment`, `ambiguous` in `run-log.md`), do not charge the backend for it. Charge the backend for `*-defect` attributions, platform gaps, missing capabilities, and documentation that misled.
- When assessing milestone outcomes, weigh **why** they occurred: a lane that self-downgraded milestones because the platform refused a product-preserving design is a backend finding; a lane that ran out of time on client-side test plumbing is only partly one.
- Apply the fixed anchors consistently: the same kind of friction gets the same kind of penalty. The **overall** score is your holistic judgement, not an average of the categories.

## Categories (score each, 0–100, with a note of at most 40 words citing the evidence)

1. `setup_and_docs` — getting started, documentation quality and discoverability, README/guide accuracy.
2. `data_modeling` — authoring the schema and the server-side program: the language's ergonomics, expressiveness, learning cost.
3. `authorization` — expressing who can read and write what, and how naturally the product's membership boundaries map onto it.
4. `queries_and_live` — reads, pagination, feeds, and live updates / realtime in the client.
5. `writes_and_transactions` — mutations, atomicity, idempotency, retries.
6. `offline_sync` — offline writes, outbox, replay, conflict handling, durability across restarts.
7. `media_assets` — uploads, storage, media typing, per-recipient and view-once delivery.
8. `background_work` — effects, scheduled work, row timers, jobs/backfills, the push seam.
9. `client_integration` — the React/Expo web and native arms: hooks, auth lifecycle, reconnect, subscriptions, the paved template.
10. `diagnostics_dev_loop` — quality of error messages, check/test/trace tooling, how fast a wrong program became a right one.
11. `scale_and_limits` — behaviour under the brief's envelope (500 follows, 1,000 conversations, the scale replay), bounds and ceilings, performance.
12. `operations` — seeding, reset, migrations, recovery from bad state, observability of the running backend.
13. `overall` — holistic.

## Output

Return exactly one fenced JSON block and nothing else:

```json
{
  "scorer": {
    "family": "{WAVE}",
    "model": "{MODEL}",
    "basis": "this cell continuous-builder and fresh-M7 narrative files; independent grade excluded"
  },
  "backends": {
    "snapback2": {
      "overall": {
        "score": 0,
        "note": "..."
      },
      "setup_and_docs": {
        "score": 0,
        "note": "..."
      },
      "data_modeling": {
        "score": 0,
        "note": "..."
      },
      "authorization": {
        "score": 0,
        "note": "..."
      },
      "queries_and_live": {
        "score": 0,
        "note": "..."
      },
      "writes_and_transactions": {
        "score": 0,
        "note": "..."
      },
      "offline_sync": {
        "score": 0,
        "note": "..."
      },
      "media_assets": {
        "score": 0,
        "note": "..."
      },
      "background_work": {
        "score": 0,
        "note": "..."
      },
      "client_integration": {
        "score": 0,
        "note": "..."
      },
      "diagnostics_dev_loop": {
        "score": 0,
        "note": "..."
      },
      "scale_and_limits": {
        "score": 0,
        "note": "..."
      },
      "operations": {
        "score": 0,
        "note": "..."
      },
      "verdict": "one sentence",
      "would_use_again_for": "one sentence"
    }
  },
  "notes": [
    "up to five sentences on what most helped and most hurt Snapback 2 in this run"
  ]
}
```

Scores are integers 0–100. Every category must be present. Each note is at most 40 words and cites the supplied lane evidence. The overall score is holistic, not a category average.
