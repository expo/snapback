# Round-2 continuation audit — 2026-10-05

Initial audit before resuming qualification. Read the entire round-2 brief and
both round-1 reviews; compare the five existing commits after `16fde56b53`.
“Done” below means implemented with a corresponding regression in the existing
source. Final-source live qualification and closeout were still incomplete.

| Brief item | Initial state | Existing implementation and evidence |
| --- | --- | --- |
| 1. View-once confidentiality | Done | `driver/evidence.py`: `viewonce_frame`, `viewonce_pixels`, `viewonce_refusal`, `no_viewonce_reload`, and `recompute_assertions` bind both crops to the prime native frame and fixture hash, bind refusal to the attempted reopen, and reject loads through reconnect by sequence or receive time. `driver/run.py` keeps a sticky guard and drains again after backend readiness. `test_round2.py` runs rebound pixel/frame/refusal/async/buffered-load controls, a sticky-failure regression, and a backend-start buffered-load regression. Commits `04c8c1ce9a`, `6515382918`. |
| 2. Undecodable video | Done | `driver/video.py`, `video.swift`, and `video_timing.py` independently decode retained H.264 samples and check track, codec, duration, sample counts and endpoint coverage. `verify_directory` calls the decoder; missing decoding raises an unmeasured error. Tests use real `valid.mp4` and `held.mp4` fixtures, reject empty boxes and invented timing/counts, and cover an unavailable decoder. Commits `04c8c1ce9a`, `48a5a5fba9`, `ed30bced26`. The last commit's terminal-recording transition had not yet completed a live matrix. |
| 3. Native receipt corroboration | Done | `recompute_assertions` independently applies native `pending(..., 'read')`, server `oracle_valid(..., 'read')`, `receipt_window_valid`, and `read_screen_valid` to `m6-a05` as well as the other read assertions. The final native capture and server sample must lie within the window. Rebound controls reject sent native ticks, sent committed screens and late snapshots. The earlier-read positive and newer-sent negative preserve valid retained state. Commits `04c8c1ce9a`, `152f7c182b`. |
| 4. Search retries | Done | `search_destination` uses unique polling captures and publishes `cold-search.json` only after `conversation_valid` succeeds, retaining that capture's timestamp. `snapshot_time` selects the final matching capture. `test_successful_last_search_capture` and the driver search regression cover a later successful poll and absence of the final filename before success. Commit `04c8c1ce9a`. |
| 5. Scrolled-off target | Done | After matching `sm-conversation`, `search_destination` calls `locate` before capture and requires a committed screen after any recorded scroll. `test_newest_first_search_scrolls_then_publishes_only_successful_capture` starts with a non-hittable row; `missing-post-scroll-screen` rejects rebound evidence. The earlier live newest-first positive passed under `152f7c182b`; final-source qualification remains to run. Commit `04c8c1ce9a`. |
| 6. Bob's delay | Done | `driver/bob-wait.mjs` polls conversation, principal and exact bodies within the declared ten-second bound; `bob.mjs` uses it. `tests/bob.test.mjs` covers a 1.5-second render, wrong principal and an exceeded bound. Reference controls `delayed-bob` and `late-bob` respectively passed and failed under the earlier source. Commit `04c8c1ce9a`. |
| 7. Reference backend scope | Done | `reference/server.mjs` stores consumption on each asset and increments `convo.counter`. The real HTTP regression in `test_backend.py` checks Eve's independent consumption/order and a second Alice asset. Commit `04c8c1ce9a`. |
| 8. Reconnection coverage | Done | `test_reconnect_executes_flush_duplicate_window_bob_and_all_receipts` invokes the actual method for M6/M8 and checks restart, offline-cut removal, duplicate sample span, Bob, server evidence and receipts. Replacing the method with a no-op fails both subtests. A second test covers a reload during backend startup. Commits `04c8c1ce9a`, `6515382918`. |

## Remaining at handoff

- Re-run all instrument tests against `ed30bced26` and complete its 19-cell
  simulator matrix. The mini retained 36 completed earlier attempts, including
  an endpoint-uncovered failure under `48a5a5fba9`; none carried `ed30bced26`.
- Run final rebound artifact controls and exported validation, without rebinding
  earlier attempts to the new source.
- Verify the modified qualification pins against committed source and the built
  runner. Finish the report, small verdicts, complete archive index and cleanup.
  The untracked draft journal's completion claims were prospective at handoff.

Scope: the unscored native instrument and diagnostic reference only. Governing
constraints are [LLP 0201.000 §§3–7](../../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md#3-minimal-fixture-and-observation-hook):
passive observations, independently corroborated evidence, explicit simulator
custody, honest unmeasured outcomes, immutable older series, and a separate
two-app/two-backend gate before scored use. No new design decision or engine
change is needed. Hand-off: affected-scope document reconciliation at closeout.

## Continuation finding

The first final-source M6 passed. M8 completed its behavior checks but was
unmeasured at export (`video-decoded-sample-count-mismatch`). Its video contained
1,344 samples and seven repeated presentation timestamps. AVFoundation's
presentation-order decoder emitted 1,337 images; FFmpeg emitted all 1,344.
Item 2 therefore needed a further decoder correction discovered by qualification.
The Mac checker now reads compressed samples in decode order and synchronously
decodes each with VideoToolbox, preserving the strict count and endpoint checks.
A ten-sample fixture with one repeated timestamp reproduces the old nine-image
output and verifies all ten images under the corrected checker. The original
live failure remains unchanged in the archive; the full matrix uses a new pin.

## Final disposition

All eight items are done. The additional item-2 decoder correction is committed
as `66763bd858`; all 47 Python tests pass on Linux and the mini, and all 19 final
live cells have their expected outcomes. The 37 rebound controls also have their
expected outcomes. The completed [report](../REPORT.md#round-2--remaining-false-passes-and-false-failures)
and [checks](./checks.json) bind the final qualification and archive closeout.
