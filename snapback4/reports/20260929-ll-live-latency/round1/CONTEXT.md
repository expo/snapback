# LL round 1 orientation

Scope: `local-reads.ts`, `local.ts`, pending-cut observation tests. Read the
round-0 prompt and report, both reviews (Astra in full), fenced AGENTS/RULES,
NOT-DOING and journal; loaded `llp-orient`. The current `client`, `reads` and
`sync` cards and local evaluator supply the paved routing behavior.

Governing LLPs: 3000 (root, current); 2000.000 §7 (partition publication);
3000.023 §10 (current, change episodes/cuts/queue); 3000.016 §2.2 (local first,
held/server fallback and checkpoints); 3000.019 §3.3/§3.5 (answer and media
retention); 3000.007 §18.2 (identity and committed heads). None is in foundation.

Constraints: LLP 3000.023#10 keeps the pending-cut fence even after an accepted
whole-server answer. LLP 3000.016#2.2 forbids server fallback for held queries,
not queries whose previous route happened to be local. Terminal refusals must
reach the same checkpoint/publication path. LLP 3000.019#3.5 retains the
round-0 full media authorization dependencies. No contract, cap or retention
limit change; no publication/push.

Decision: restrict early parking to current held declarations; register all
acquired pending-cut watches for publication resumption. Resolve refusals before
parking by bypassing the shortcut, preserving normal refusal publication.
Measure the resulting extra local work instead of adding an unproved routing
certificate. Update LLP 3000.023 §10 and measured guide figures in place.

Risks: ordinary evaluations and their backoff cost work again; changing logical
time in a local-only branch must preserve whole-server fallback. Test that
transition and a terminal refusal after parking on process and wasm. Existing
causal tests still freeze elapsed timers and require sync-driven publication.
Hand-off: none.
