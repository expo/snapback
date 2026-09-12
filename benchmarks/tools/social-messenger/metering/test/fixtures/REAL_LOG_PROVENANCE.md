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
component counters and the compaction-housekeeping aggregate
`last_token_usage.total_tokens: 15283`. No credentials or application content
are copied into the fixture. The full retained rollout places it immediately
after `compacted → world_state → turn_context`, and its next charging ordinal
advances consistently. Adapter `codex-rollout-jsonl.v4` therefore retains it
as a non-charging recap regression: no turn is invented and no cumulative
usage is discarded.

`real-codex-r3-compaction-recap.jsonl` is the usage-only prefix through native
ordinal 383 plus the minimized native housekeeping neighbors and byte-exact
ordinal-387 event from the retained R3 attempt at
`/Users/ccheever/bench-r3-20260826/cells/sol-clique-explicit-1/events/codex-rollout.builder.jsonl`.
The complete minimized fixture SHA-256 is
`65af00200ce3e9657250f3b83a28948e12e3d77b57f7e9c0e71a71bbffaaac70`;
the exact ordinal-387 line (rollout line 388) SHA-256 is
`21c1c05b7e06af61408e4744708fa661f2d9eac2688b049dbfb9c38dd31cadd5`.
It preserves `compacted`, `world_state`, `turn_context`, the aggregate-only
recap, and `ContextCompaction` completion without retaining prompts, responses,
tool arguments, or compaction content.

`real-codex-r3-contradictory-token-count.jsonl` is a negative fixture derived
from the first two exact native usage records of that same retained R3 rollout.
The second record changes only `last_token_usage.output_tokens` and its matching
aggregate total by +1, so the last-use object is internally well-formed but
contradicts the real cumulative advance by one token. Its fixture SHA-256 is
`4b3e8be90b1797dde7a60466c8cac37badaa4980a102f595fc0030e5001babc9`.
This deliberate mutation is not presented as a native observation; it proves
that accepting recaps does not weaken the advancing-delta checksum refusal.

`real-opus-shorthand-lane-observation.jsonl` is the exact first event from the
retained Opus Clique explicit M1 suite-observation sidecar at
`/Users/ccheever/bench-matrix-20260823-r2/instrument/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/receipts/m1-suite.observations.jsonl`.
Its line SHA-256 is
`7c5b666682bf340461c84e34767763dba1baf55165c83c5ecbd46be23a4784d3`.
The older sidecar wrote the cell-local suffix `opus-clique-explicit`; the
versioned observation admission canonicalizes that suffix to the manifest's
full lane identity and still refuses every unrelated value.

The three `real-*-familiar-*.jsonl` fixtures are exact single-event bytes from
the retained `sol-clique-familiar` attempt. The Codex fixture is
`real-codex-familiar-compaction-recap.jsonl`, native ordinal 839 (line 840 of
the rollout), whose unchanged cumulative snapshot carries the aggregate-only
recap `last_token_usage.total_tokens: 14133`; its line SHA-256 is
`3d2a694a775989b52854f50e99f6e6caa2251714b206a4b5cf5287ae0a11210f`.
Only that exact line was retained, so its neighbor types are not inferred; the
identical R2 ordinal-710 and R3 ordinal-387 shapes plus the wider real-session
sample establish the reinterpretation.
The transition event is controller sequence 195, timestamped 1 ms before the
later M2 gate-file write; its line SHA-256 is
`df18cf7baf2bd8cba89e10549c32d548b7c823bd04ecc77f6cebe8ec131e4c5c`.
The orphaned correction is controller sequence 291, whose named recovery
episode never received a retained closure event; its line SHA-256 is
`70c7c4eb8fdba926d8776e6b77a9d1405e8e51facef7e0cccaea155d81ff25ea`.
The versioned admission preserves the correction action but downgrades the
incomplete recovery block to an explicit non-claim; it never synthesizes an
episode.

`real-grok-clique-explicit-suite-finalization.json` and
`real-grok-clique-familiar-suite-finalization.json` are minimized projections
from the two consecutive retained 2026-08-24 Grok R2 cells at
`/Users/ccheever/bench-matrix-20260823-r2/cells/`. Each fixture preserves the
exact final `suite-status.json` bytes and SHA-256, the exact M1 suite-receipt
bytes and SHA-256, and the refusal-time suite identity fields from the exact M1
`0.3.3-m8` choreography segment summary. The explicit cell's final status and
suite-receipt SHA-256 values are respectively
`8799d1d5cf3557301331f16703a0030cd57ce4d3cb965a2301fbaa7de71ada82`
and `2d45ee0ea6a496139953aadaeb12b9e2588e6b5918e0892eadaccb0f08a81e2d`;
the familiar cell's are
`39aa45efcbb93ec752fc8af320bb7d45e57800f02e83094a88c478c7d44f0af3`
and `9bc49325837b109d85e636e385610bae745b52204365918a6219517ed84a09b4`.
Application code, prompts, model output, credentials, and unrelated receipt
fields are omitted. In both cells the final aggregate carried unbound false
M1/M2 placeholders, while the retained M1 receipt verdict remained green and
its bytes exactly matched the choreography-captured identity.

`real-grok-coterie-familiar-after-boundary-telemetry.json` retains the exact
M1 boundary and exact sequence-142 `host-load-sample` event from the immutable
2026-08-25 Grok Coterie Familiar attempt. The complete controller stream is
retained at the path recorded in the fixture and hashes to
`9aaba42f715092a66ce84f964c0fb65dd8cfedcc0f991db9fb602508489dfef7`;
the fixture event is the exact JSONL line 142 payload. It is the positive
regression for timer telemetry draining 12.407 seconds after the semantic
authoring terminal.

`real-opus-coterie-familiar-after-boundary-semantic.json` is the minimized
boundary-check projection from the retained 2026-08-24 Opus Coterie Familiar
attempt documented in
`benchmarks/runs/2026-08-23-r2-published-0125/BLOCKED-charlies-macbook-pro-2-opus-coterie-familiar-finalization.md`.
It preserves the exact controller-stream SHA-256, M1 terminal, sequence, time,
and type of the first refused post-terminal semantic action. Fields irrelevant
to the boundary decision are omitted. This fixture remains the negative
regression: semantic model/driver actions after the authoring terminal fail
closed.

`instrument-0.3.6.manifest.json` is the exact frozen instrument manifest from
commit `f40559f37722c79178be664a11f8a6485f1508fd`. Its SHA-256 is
`ee75020c41bb09186dc003e1f2cdf0dedebbb3adc21abfbfeb83addba2e64623`.
The retained-identity regression pairs those bytes with the committed
`0.3.6-m8` setup identity and a test-local hash-bound record base; it does not
reconstruct or alter a historical run directory.
