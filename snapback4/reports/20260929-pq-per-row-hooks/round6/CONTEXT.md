# PQ round 6 context

Applied `llp-orient` to local presence evaluation/publication, remembered-answer
ordering and per-request cancellation listeners. Read the round 0–5 prompts
and reports, both complete round-5 reviews, Snapback 4's command sheet,
NOT-DOING, journal, rules, current client/reads cards and the governing corpus.

Governing documents: LLP 3000 §4 (fence; root in `current/`), LLP 2000.000 §7
(partition authority), LLP 3000.016 §2.2 (local publication), LLP 3000.018 §3.2
(background presence and remembered ordering), LLP 3000.019 §3.3 (deadline
ownership), LLP 3000.023 §§3 and 7 (retention and bounded work; in `current/`),
and LLP 3000.029 §0 (LV remains shelved). There is no Snapback 4 entry in
`foundation/`; this survey stays inside the Snapback 4 fence.

Active constraints and rationale:

- LLP 3000.023 §7: queued invalidations already apply the policy; a stable
  revalidating/loading object is not evidence that no later change occurred.
- LLP 3000.018 §3.2: background reads use the existing one-shot evaluation
  path, and an overtaken refresh cannot replace the observation.
- LLP 3000.023 §§3.1–3.4: episode timing, policy distinctions and immediate
  row expiry/scope reset stay intact.
- LLP 3000.023 §7: selective memory deletion fences earlier tickets even
  when a later-arriving body carries a higher sequence.
- LLP 3000 §4 and `rules/RULES.md`: retain the existing budgets and source
  ceiling; no additional gate or runtime bootstrap.

Updated the existing LLP 3000.023 §7 to state the background-watch generation
checks. The client card's public behavior remains accurate. No unresolved
design question or skill hand-off. Grok's separate full-clear and one-shot
query observations remain outside this explicitly narrow round; no new claim
is made for those paths.

Initial and pre-suite fetches both found `origin/main` at `b7d05baff`, already
an ancestor of this branch. No merge was necessary. No tool installation.
