# Muse score output provenance preflight

Date: 2026-09-13

This was a structural, read-only audit. It did not inspect private reasoning or draft bodies and did not launch a benchmark phase.

## Finding

`scripts/aggregate_scores.py` (SHA-256 `c46a9011ecc7f06f199849636685d8a3eb6335d38143bb3956807a75aeba0a3b`) cannot currently prove that a Muse score came from Muse's final public answer. When `raw.out` has no directly visible fence, lines 39-47 recursively visit every string in every JSONL event. Lines 48-54 then select the last valid-looking Snapback 4 object without checking its event type.

That search includes the user prompt copied into both `turn.input.user.payload.prompt` and `run.lifecycle.started.payload.prompt`. The current `prompts/muse-snapback4.score.md` (SHA-256 `3212708fcad52a63009870e8aff426f9bf0d602795315b86dc712c8dc12ea652`) contains a fenced object for `snapback4` with the expected Muse family/model and values that pass all current category validation. If the terminal answer is missing a valid fence, the aggregator can therefore accept the prompt example and report success.

## Public terminal envelope

The local `muse exec --help` documents only that `--json` emits machine-readable JSONL; it does not document the event schema. The retained prior Muse scorer output `/Users/ccheever/clique-full-20260905/scores/muse/raw.out` (SHA-256 `08e898d096fd037a267139e5df0c29dbd3f5b49550bf6f7d7f8bf04c52e0b6e3`) supplies an unambiguous public-answer envelope at final sequence 785:

- `record_type`: `event`
- `durability`: `durable`
- `payload_type`: `run.terminal.completed`
- `payload.kind`: `run_terminal`
- `payload.terminal`: `completed`
- `payload.reason`: `null`
- `payload.text`: the complete public final answer

The same stream carries the prompt fence at sequences 4 and 5 and only a 15-byte opening fence fragment in the ephemeral `run.output.delta` at sequence 366. The complete answer fence is in the terminal event's `payload.text`.

## Verification rule for the later Muse score

After the lifecycle end record reports exit code zero, parse Muse `raw.out` as JSONL and require exactly one durable completed terminal event for the run. Extract fenced score JSON only from that event's `payload.text`; require its run stream to match the session's linked run and retain the existing scorer identity and category checks. Do not fall back to prompt, tool-result, lifecycle-status, output-delta, or arbitrary nested strings. A missing or invalid terminal score should fail aggregation rather than selecting another event.

## External final-answer capture

The frozen aggregator and runner remain unchanged. After the Muse score process exits successfully, the external helper `/tmp/sb4-36-capture-muse-score-final.py` (SHA-256 `695d4a4c86289fba0115153bff14c1a8ab0d3f21f8707af1ec3cac537df5d04c`) validates the linked run and its unique successful final terminal event, validates the complete 13-entry public score, and retains `payload.text` verbatim as `scores/muse/FINAL.md` with `FINAL.provenance.json`. Aggregation may run only after this validation succeeds. An invalid final answer stops this path; it never falls back to another event or repairs a score.

Validation receipts (external, no benchmark outputs written during preparation):
- `/tmp/sb4-36-capture-muse-score-final-prior-dryrun.log`: SHA-256 `5f6b51f32dcb678337112b6e18d4e09fb50749d3eb24d799705b278591395a64`.
- `/tmp/sb4-36-capture-muse-score-final-prompt-only.log`: SHA-256 `96202f3b3c4f871d461795e67e2db130bb9df9fe65ae54a77da639c12bed8a6c`.
- `/tmp/sb4-36-capture-muse-score-final-valid.log`: SHA-256 `a4583ebd220ea188941b5d5e962e2712b5d42419a4bb782099b6a1a93804dc5b`.
- `/tmp/sb4-36-capture-muse-score-final-malformed.log`: SHA-256 `7437345fdc32733cefecc1e1f2270477e61703978fdfb2138a6006662011eca8`.
- `/tmp/sb4-36-capture-muse-score-validation.log`: SHA-256 `115f7a53f81d7068fdd0315b44c19a81f6e0f5fd8194386dd1ac323917601c7a`.
