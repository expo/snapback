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
