You are grok-4.6. In this benchmark run, three sessions of your own model family each built the same production-shaped app, Clique (a social messenger), alone and timed, once on each of three backends: Snapback 4 (`snapback4@0.4.12` / `snapback4-expo@0.4.12`, authored in Quarry), Convex (`convex@1.45.0`), and Supabase (`@supabase/supabase-js@2.112.4` against a hosted project). Your job now is to **score each backend out of 100**, holistically and by category, from the evidence those three sessions left behind.

## Read these, and only these

The brief: `/home/ccheever/clique-cmp-20261003-0412/instrument/social-messenger.md` (skim for the milestone shape; you are scoring backends, not the app).

Your three lanes, each with `diary.md` (per-milestone build experience), `essay.md` (the closing comparison), `run-log.md` (timestamped events, attributions), `final-report.md` (status, results, correction loops, gaps), and `run-record.json` where present:

- `/home/ccheever/clique-cmp-20261003-0412/lanes/grok-snapback4/`
- `/home/ccheever/clique-cmp-20261003-0412/lanes/grok-convex/`
- `/home/ccheever/clique-cmp-20261003-0412/lanes/grok-supabase/`

Read the narrative files in full. You may open the lanes' source files to check a specific claim. Do **not** open any other lane under `/home/ccheever/clique-cmp-20261003-0412/lanes/` (other model families' lanes, or `attempt1/`), any `grading/` directory, and never open or print `provider-secrets.env`. This is a read-only task: run nothing, write nothing, change nothing.

## How to score

- **100** = ideal for this brief: every milestone expressible directly, no workaround, nothing to prove twice. **75** = good, occasional friction. **50** = usable with substantial workarounds or missing pieces. **25** = fought the build at every step. **0** = unusable for this brief.
- Score the backend **as experienced on this brief through its published surface**, not its reputation or what you know it can do elsewhere. Evidence in the lane files decides; when a lane lost time to its own mistakes or to the environment (attributions `agent-error`, `environment`, `ambiguous` in `run-log.md`), do not charge the backend for it. Charge the backend for `*-defect` attributions, platform gaps, missing capabilities, and documentation that misled.
- Where the milestone outcomes differ between backends, weigh **why** they differ: a lane that self-downgraded milestones because the platform refused a product-preserving design is a backend finding; a lane that ran out of time on client-side test plumbing is only partly one.
- Be consistent across the three backends: the same kind of friction gets the same kind of penalty. The **overall** score is your holistic judgement, not an average of the categories.

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

Your final message must be exactly one fenced JSON block (```json … ```) and nothing else, shaped:

```json
{
  "scorer": {"family": "grok", "model": "grok-4.6", "basis": "own three lanes' narrative files"},
  "backends": {
    "snapback4": {
      "overall": {"score": 0, "note": "..."},
      "setup_and_docs": {"score": 0, "note": "..."},
      "data_modeling": {"score": 0, "note": "..."},
      "authorization": {"score": 0, "note": "..."},
      "queries_and_live": {"score": 0, "note": "..."},
      "writes_and_transactions": {"score": 0, "note": "..."},
      "offline_sync": {"score": 0, "note": "..."},
      "media_assets": {"score": 0, "note": "..."},
      "background_work": {"score": 0, "note": "..."},
      "client_integration": {"score": 0, "note": "..."},
      "diagnostics_dev_loop": {"score": 0, "note": "..."},
      "scale_and_limits": {"score": 0, "note": "..."},
      "operations": {"score": 0, "note": "..."},
      "verdict": "one sentence",
      "would_use_again_for": "one sentence"
    },
    "convex": { "...same keys..." : 0 },
    "supabase": { "...same keys..." : 0 }
  },
  "cross_backend_notes": ["up to five sentences on what most separated the three"]
}
```

Scores are integers 0–100. Every category must be present for every backend. Notes cite the lane evidence (a milestone, a diagnostic, a run-log attribution), not general knowledge.
