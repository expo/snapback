# QS round 1 — failure ledger

## Full suite (single invocation)

Exact summary: `== 1 failure(s) in 1290 s`, group `client tests`.
Two leaf failures; **ours 2, baseline 0, environmental 0**. Client pool:
5,457 passed / 2 failed / 10 skipped / 0 cancelled. Every other stage passed.

- bounded Following wasm: untaken online-only card branches remain answerable when held
- bounded Following native: untaken online-only card branches remain answerable when held

Both expected `E_QUERY_RETRY` for an executed online-only held branch but got
the intended `E_QUERY_HELD`. After the full run ended, changed only these
expectations and strengthened them with the exact retryable flag. Exact
untaken null/false answers, completeness and zero server requests remain.
`following-final.log`: 2/2. The full run remains failed evidence; no rerun.
`full-suite-failures.json` provides the same per-case classification.

## Preparatory checks

No preparatory unexpected failure is claimed as baseline or environmental.
Every unexpected preparatory failure below is ours; each has a passing later
check. Expected round 0 failures are explicitly marked as causal reproductions.

## `baseline-regressions.log`

First harness run: eight terminal cases hit the independent watchdog because the later fresh query replaced the saved timer callback. Ours (fixture); corrected by capturing the first callback. The other ten failures are intended round 0 reproductions.

- wasm: restore refusal wins a blocked query deadline
- wasm: partition refusal wins a blocked query deadline
- wasm: impossible held count refuses in one evaluation and never contacts the server
- process: restore refusal wins a blocked query deadline
- process: partition refusal wins a blocked query deadline
- process: impossible held count refuses in one evaluation and never contacts the server
- app-wasm: restore refusal wins a blocked query deadline
- app-wasm: partition refusal wins a blocked query deadline
- app-wasm: impossible held count refuses in one evaluation and never contacts the server
- app-process: restore refusal wins a blocked query deadline
- app-process: partition refusal wins a blocked query deadline
- app-process: impossible held count refuses in one evaluation and never contacts the server
- mock: a retired one-shot rereads instead of returning the old value
- mock: genuine publication exhaustion uses the shared retryable refusal
- mock: closed and signed-out clients preserve terminal refusals
- mock: a throwing evaluator settles with the shared client refusal
- guide: stale one-shot continuations refuse and retain the first-page recovery
- guide: server-needing decorations remain separate

## `baseline-regressions-corrected.log`

Intentional round 0 reproductions: all 18 fail for the reviewed contract defects, including both documentation checks. These are positive causal evidence, not final implementation failures.

- wasm: restore refusal wins a blocked query deadline
- wasm: partition refusal wins a blocked query deadline
- wasm: impossible held count refuses in one evaluation and never contacts the server
- process: restore refusal wins a blocked query deadline
- process: partition refusal wins a blocked query deadline
- process: impossible held count refuses in one evaluation and never contacts the server
- app-wasm: restore refusal wins a blocked query deadline
- app-wasm: partition refusal wins a blocked query deadline
- app-wasm: impossible held count refuses in one evaluation and never contacts the server
- app-process: restore refusal wins a blocked query deadline
- app-process: partition refusal wins a blocked query deadline
- app-process: impossible held count refuses in one evaluation and never contacts the server
- mock: a retired one-shot rereads instead of returning the old value
- mock: genuine publication exhaustion uses the shared retryable refusal
- mock: closed and signed-out clients preserve terminal refusals
- mock: a throwing evaluator settles with the shared client refusal
- guide: stale one-shot continuations refuse and retain the first-page recovery
- guide: server-needing decorations remain separate

## `round0-expanded-regressions.log`

Intentional round 0 runtime replay: 24 fail, 16 pass. The complete list below identifies every failing case. Current-source documentation checks pass in this replay; their old-text failures are above.

- wasm: a terminal change-stream refusal wins a blocked query deadline
- wasm: restore refusal wins a blocked query deadline
- wasm: partition refusal wins a blocked query deadline
- wasm: impossible held count refuses in one evaluation and never contacts the server
- process: a terminal change-stream refusal wins a blocked query deadline
- process: restore refusal wins a blocked query deadline
- process: partition refusal wins a blocked query deadline
- process: impossible held count refuses in one evaluation and never contacts the server
- app-wasm: a terminal change-stream refusal wins a blocked query deadline
- app-wasm: restore refusal wins a blocked query deadline
- app-wasm: partition refusal wins a blocked query deadline
- app-wasm: impossible held count refuses in one evaluation and never contacts the server
- app-process: a terminal change-stream refusal wins a blocked query deadline
- app-process: restore refusal wins a blocked query deadline
- app-process: partition refusal wins a blocked query deadline
- app-process: impossible held count refuses in one evaluation and never contacts the server
- facade: restore wins the transport deadline
- facade: restore wins the authority deadline
- facade: reset wins the transport deadline
- facade: reset wins the authority deadline
- mock: a retired one-shot rereads instead of returning the old value
- mock: genuine publication exhaustion uses the shared retryable refusal
- mock: closed and signed-out clients preserve terminal refusals
- mock: a throwing evaluator settles with the shared client refusal

## `regressions-expanded.log`

Ours (fixture): static imports loaded app-client before the scheduling hook. Moved those imports after the hook installation; no product correction was needed.

- app-online: viewer scope change wins a blocked authority deadline
- app-wasm: viewer scope change wins a blocked authority deadline
- app-process: viewer scope change wins a blocked authority deadline

## `affected-core.log`

Ours (fixture): the new Alice session expired within the local 24-hour refresh window, and the fixture refresh endpoint returned Bob. Give the Alice fixture ten days and route its test bearer to the Alice persona. The real old-view query refusal was correct; the new-view assertion exposed the fixture.

- app-wasm: viewer scope change wins a blocked authority deadline
- app-process: viewer scope change wins a blocked authority deadline

## `scope-final.log`

Ours (fixture): same Alice refresh-window mistake; intermediate rerun retained here.

- app-wasm: viewer scope change wins a blocked authority deadline
- app-process: viewer scope change wins a blocked authority deadline

## `viewer-diagnostic.log`

Ours (fixture): diagnostic of that same mistake, preserving the successful issued Alice session and restoring app state before correction.

- app-wasm: viewer scope change wins a blocked authority deadline

## `guide.log`

Ours (docs/editing): exact native smoke phrase, required lead paragraph, aggregate word cap, moved-fact text, and bounded E_QUERY_HELD excerpt. Repaired text and matched the changed fact; no limits were raised or tests weakened.

- client::native_smoke_is_the_milestone_path_with_honest_limits
- every_card_introduces_the_feature_before_examples_and_reference_details
- familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block
- familiar::every_moved_fact_has_its_why_or_details_home
- w9b_every_code_has_bounded_card_context_and_a_full_card_command

## `guide-final.log`

Ours (docs/editing): intermediate guide attempt still exceeded the aggregate/excerpt bounds and had an incorrectly separated lead paragraph. Corrected while preserving the compiling examples and moved facts.

- every_card_introduces_the_feature_before_examples_and_reference_details
- familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block
- familiar::every_moved_fact_has_its_why_or_details_home
- w9b_every_code_has_bounded_card_context_and_a_full_card_command

## `guide-complete.log`

Ours (docs/editing): the E_QUERY_HELD excerpt fit its default context but exceeded its bound with the longer offline-interactions context. Shortened the new explanation; all contexts now pass.

- familiar::every_moved_fact_has_its_why_or_details_home

## Final affected evidence

`affected-final.log`: 452/452; `changes-terminal.log`: 4/4;
`guide-pass.log` and final `guide-final-pass.log`: 106/106. `review-regressions-pass.log` separately records
36/36 new cases before the four change-stream cases were added.
