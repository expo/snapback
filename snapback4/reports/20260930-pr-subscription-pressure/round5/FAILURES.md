# Failure ledger — PR round 5

The single full suite exits 1: `== 1 failure(s) in 1349 s`. Its two failing
tests are ours and corrected by the final quiet-poll guard. Expected
historical failures below are controls, not hidden retries of the full suite.
All logs are retained. No runtime assertion was weakened to obtain a pass.

## Development and setup

| Failure | Classification | Disposition / evidence |
| --- | --- | --- |
| Initial historical-SDK copy/build and test launch used the wrong working directory | Ours, setup | `control-build-setup-error.log`, `control-run-setup-error.log`; corrected paths before the genuine round-4 control. |
| First history enumeration had no SDK source files because git paths were relative to the wrong directory | Ours, setup | Its six failures are retained as `merged-control.log`, not claimed as round-4 evidence. Helper now uses repository-relative inventory and checks for local.ts. Genuine round-4 and main controls ran afterward. |
| Additional mistargeted build/social shell redirections and missing-file navigation probes | Ours, setup | Failed before starting those commands; corrected working directories. No successful qualification is claimed for an unstarted command. |
| Process commit-then-throw regression initially failed to deliver its commit callback | Ours, fixture | `affected.log`, test `process: ownerless server memory is retired by commit-then-throw`; adapter now explicitly reports commitment before throwing. Final case passes and fails on round 4. |
| Client guide omitted proven-permanent held-refusal wording | Ours, merge/doc | `affected.log`, `guide: the client contract names only proven permanent held refusals`; restored main's contract. |
| Old `apply: remembered dependencies with footprint []` expectation | Ours, intentional rule change | `affected-final.log`; changed apply memory expectations to unconditional retirement. Two existing real-device tests now require online reauthorization before offline reuse. Final complete per-row file passes. |
| Initial merged wasm 598,401 gzip exceeded 597,247 cap | Ours, integration | `wasm-build.log`; exact +1,154 ratchet with reason, no Rust feature dropped and no slack. Full-suite wasm stage passes. |
| Initial qualification snapshot ENOBUFS | Ours, setup | Large report inventory exceeded execFileSync default buffer. Excluded reports at git pathspec and increased buffer. Valid manifest captured during early suite prelude, explicitly not before launch. |
| Inherited QS/QX raw-log trailing whitespace | Baseline | `inherited-whitespace.log` lists every site; preserved origin/main artifacts. Final round-5 source whitespace checked separately. |
| Optional machine-fleet inventory absent at ~/Dropbox/APIKeys/MACHINE_FLEET.md | Environmental, setup | Used existing 96-CPU Linux lane; no required test skipped. |

Whole-guide development failures, all **ours** while compacting the merged card:

- `guide.log`: `client::client_aliases_keep_typing_on_ephemeral`, `every_card_introduces_the_feature_before_examples_and_reference_details`, `definitions::w11_every_registered_code_quotes_its_definition`.
- `guide-final.log`: `client::client_aliases_keep_typing_on_ephemeral`, `every_card_introduces_the_feature_before_examples_and_reference_details`.
- `guide-complete.log`: `definitions::every_card_separates_headings_from_prose`.

Restored the required introduction/blank line, durable/ephemeral separation,
E_QUERY_UNHELD definition, and heading separation. Final whole guide is 107/107.
SDK affected runs progress from 709/711 (the two fixture/doc failures above),
to corrected 304/304, to 800/801 (obsolete apply expectation), to final 364/364.
Earlier focused pass logs are retained but do not supersede final qualification.
Rust unused-import warnings are inherited warnings, not test failures.

## Expected controls: inherited authorization defects

Entries below use the **baseline/inherited** SDK on current real devices/server.
The quiet-poll preservation failure is an intentional change of conservative
behavior, not an inherited authorization defect; the other cases detect the
authorization/evidence gaps. No infrastructure failure is counted as a
behavioral regression. Final round-4 control is 27 tests, 22 fail, five pass:

- a known quiet poll preserves detached and pending authority without another counter
- apply publication: one authority revision retires detached and pending answers
- scope cut: one authority revision retires detached and pending answers
- partition refusal: one authority revision retires detached and pending answers
- every terminal refusal advances authority, even when the same refusal repeats without owners
- empty advancing evidence is unknown; quiet empty and known disjoint footprints preserve memory
- wasm: terminal partition refusal retires in-flight first answer at response
- wasm: terminal partition refusal retires in-flight first answer at approval
- process: terminal partition refusal retires in-flight first answer at response
- process: terminal partition refusal retires in-flight first answer at approval
- wasm: ownerless server memory is retired by publication
- wasm: ownerless server memory is retired by commit-then-throw
- wasm: ownerless server memory is retired by recovery-after-lost-ack
- wasm: ownerless server memory is retired by housekeeping-footprint
- wasm: ownerless server memory is retired by nonempty-footprint
- wasm: ownerless server memory is retired by empty-notification
- process: ownerless server memory is retired by publication
- process: ownerless server memory is retired by commit-then-throw
- process: ownerless server memory is retired by recovery-after-lost-ack
- process: ownerless server memory is retired by housekeeping-footprint
- process: ownerless server memory is retired by nonempty-footprint
- process: ownerless server memory is retired by empty-notification

Current-main original six controls: six fail, zero pass:

- wasm: terminal partition refusal retires in-flight first answer at response
- wasm: terminal partition refusal retires in-flight first answer at approval
- process: terminal partition refusal retires in-flight first answer at response
- process: terminal partition refusal retires in-flight first answer at approval
- wasm: ownerless server memory is retired by publication
- process: ownerless server memory is retired by publication

Earlier controls are retained at `round4-control.log`,
`round4-control-expanded.log` and `round4-control-final.log`; these are smaller
subsets during development. `merged-control.log` contains the original six
failures on the merged pre-fix SDK. None is a final-product failing test.
Exploratory social measurements pass but are superseded by
`social-conservative.json`; the final social harness passes four cases.

## One full-suite invocation

Exact summary: `== 1 failure(s) in 1349 s`, exit 1. Failed stage: client tests.
5,718 cases: 5,706 pass, two fail, ten existing skips; zero cancellations.
Both failures are **ours**, not baseline or environmental:

| Full-run test | Symptom / diagnosis | Resolution |
| --- | --- | --- |
| `process: app screen and history after leave, remount and offline/online reopen` (`ordinary-history.test.mjs:235`) | Inbox expected `[]`, got no data. Isolated final-SDK run also catches a retained history read failing with `E_QUERY_RETRY`. | Quiet no-change polls repeatedly advanced authority; four bounded attempts exhausted. Known empty nonadvancing polls now leave the shared revision unchanged. |
| `unread badge uses server fallback online and keeps its bound after cold offline reopen` (`unread-range.test.mjs:176`) | Online badge expected 6, got no data; diagnostic shows `E_QUERY_RETRY`. | Same one-line quiet-poll guard. No assertion, retry count or timeout changed. |

`full-failures-base.log`: both pass on merged pre-fix SDK. `full-failures-fixed.log`:
both fail on the first round-5 SDK. `full-failures-quiet-control.log`: both pass
with only the early return in an isolated SDK copy. `control-loader.mjs` redirects
SDK imports and adds result diagnostics without editing original test files.
Final complete ordinary-history/unread-range files pass within the 440-case
follow-up, alongside all 27 new regressions and prior pressure/one-shot checks.
All other full stages pass: Rust 4,438/33 existing ignores, wrappers 9/9, serial
models 79/79. The inherited 60-second total budget is exceeded. Product inputs
are unchanged across the full run. The guard was applied **after** completion;
the failed full result is preserved and no full rerun was made.

## Post-suite follow-up

- **Ours, new unit fixture:** `quiet-final-affected.log` passes 439/440. The new
  quiet-poll positive unit expected the unnormalized source read; ReadObservation
  adds `existence`. It now asserts identity with the saved normalized snapshot,
  protecting every field. `quiet-final-authority.log` passes all nine unit cases.
  No further product change. All 440 unique cases are therefore verified.
- **Ours, command setup:** the 440-case command named a nonexistent delivery
  boundary test path; Node ignored it. No delivery qualification is claimed from
  that argument. The actual `delivery-fault-matrix.test.mjs` runs separately in
  `delivery-final.log`.
- The new unit's final historical control is `round4-final-authority.log` (six
  fail, three pass); the final 18 real-device controls are unchanged from
  `round4-final-controls.log`. Five unit failures are authority/memory controls;
  the sixth proves the deliberate quiet-poll preservation change.
- Final social, pressure, LL, guide and hash checks are reported in REPORT.md.
  No failing product case is left as a follow-up ticket.
