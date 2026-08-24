# Retained delegated-lane fixture provenance

`real-claude-tree-parent.jsonl` and `real-claude-tree-descendant.jsonl` are
usage-only extracts from the retained 2026-08-12 Claude social-messenger lane
identified by native session `ac574163-220b-4778-abc3-87de28c2c4f0`. The
descendant source is native agent `af165d69f7468e749`.

Only native identity, completion timestamp, and usage counters are retained;
prompts, responses, tool arguments, and transcript content are omitted. The
descendant extract contains the final streamed update for each of its 12
unique messages and totals 21,496 native output tokens, matching the retained
private source inspected during the adversarial metrology review.

`real-codex-tree-parent.jsonl` and `real-codex-tree-subagent.jsonl` are
usage-only extracts from the retained 2026-08-21 Codex rollout pair whose
native parent is `01a0245d-2323-7890-a982-00ab78bad604` and whose independent
`thread_source: "subagent"` rollout is
`01a024a3-90b2-7503-bbc7-b034b0522e98`. Each extract retains its native
session metadata and the first three contiguous `token_count` records only.
Prompts, responses, tool arguments, and transcript content are omitted. The
fixture demonstrates that parent and subagent cumulative counters are
independent and that every cumulative delta matches `last_token_usage`.

`real-codex-0149-zero-delta.jsonl` is a usage-only prefix from the immutable
2026-08-24 R2 cell-1 rollout retained at
`/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-explicit/events/codex-rollout.jsonl`.
It contains a minimized `session_meta` carrying native session identity and
`cli_version: "0.149.0"`, followed by every `token_count.info` record needed to
validate the cumulative chain through native ordinal 710. Prompts, responses,
tool calls, and unrelated session metadata are omitted. The last JSONL line is
the exact retained ordinal-710 event bytes, including its native envelope; its
line SHA-256 is
`144d9413f662621e63bdd63f622b0da791d31c30ef63befe53b2f604a7489254`.
That event repeats the prior cumulative snapshot unchanged while carrying zero
component counters and the contradictory advisory
`last_token_usage.total_tokens: 15283`. No credentials or application content
are copied into the fixture. Adapter `codex-rollout-jsonl.v3` retains this as a
fail-closed regression: the zero cumulative delta cannot checksum the nonzero
aggregate, so the parser names ordinal 710 and refuses to invent or discard
usage.

`real-opus-shorthand-lane-observation.jsonl` is the exact first event from the
retained Opus Clique explicit M1 suite-observation sidecar at
`/Users/ccheever/bench-matrix-20260823-r2/instrument/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/receipts/m1-suite.observations.jsonl`.
Its line SHA-256 is
`7c5b666682bf340461c84e34767763dba1baf55165c83c5ecbd46be23a4784d3`.
The older sidecar wrote the cell-local suffix `opus-clique-explicit`; the
versioned observation admission canonicalizes that suffix to the manifest's
full lane identity and still refuses every unrelated value.
