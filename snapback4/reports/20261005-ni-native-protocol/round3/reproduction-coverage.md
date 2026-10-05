# Round 3 reproduction coverage

The baseline probe uses `fb830d2c2e`'s production driver, validator and backend
with the new test fixtures and a freshly frozen scratch inventory. It does not
claim to be a qualified baseline run. Logs and full source are archived.

| Review reproduction | Regression/control | Round-2 behavior |
| --- | --- | --- |
| Astra High 1: pre-reopen cache load | `pre-reopen-viewonce-load`; `test_collect_guards_before_reopen_and_after_reconnection` | Rebound packet accepted; guard test fails |
| Whole cold process after reconnection | `online-viewonce-load`; same collect test with `cut=False` | Rebound packet accepted |
| Grok Medium 1: crop elsewhere | `elsewhere-viewonce-pixels`; live `elsewhere-viewonce` | Rebound packet accepted |
| Grok Medium 2: brightness/contrast | `bright-viewonce-pixels`, `contrast-viewonce-pixels`; live `bright-viewonce` | Rebound packets accepted |
| Astra Medium 3: stale M8 restart | `stale-restart-capture`, `missing-restart-screen`; `ExportedM8` | Replayed warm capture and missing cold screen accepted |
| Astra Medium 4: +1.5 s denial | `test_delayed_refusal_within_bound`; live `delayed-refusal` | Driver fails `viewonce-refusal-missing` |
| Grok Medium 3: scroll without screen event | `test_scroll_without_new_screen_event`, `test_export_accepts_scroll_without_new_screen`; live `scroll-no-screen` | Driver/export reject `search-post-scroll-screen-missing` |
| Astra Medium 2: foreign asset reference | Both `AssetScopeRegressions` HTTP tests | Foreign/missing send accepted; legacy history discloses consumption |
| Astra test gap: remove exported M8 block | `test_m8_a17_verification_rejects_replaced_restart_tree` | New test detects deletion of the complete block with `ValueError not raised`; prior 47-test gap no longer survives |

A further whole-process regression,
`test_run_drains_load_written_during_process_termination`, writes a real journal
load while the mocked termination command runs. The final driver drains that
sealed journal and revokes `m6-a04`; the round-2 driver misses the event.

The archived round-2 honest screenshot scores **0.395068** correlation and remains
absent. Relocation scores **1.0**, +30 brightness **0.998021**, +60 brightness
**0.992213**, and contrast `0.6x + 45` **1.0**, all above the stale cutoff 0.95.
The prime's strict absolute error is **0.199** against its fixture (cutoff <20).
These probes use the real Pillow/OpenCV implementation and the retained pixels.

The live stale-restart control performs an ordinary successful M8 capture, then
replays its warm capture and removes the cold pending screen witness before the
real candidate export validator runs. It retains the actual restart capture and
original observations under separate names. Pixel controls alter the real
reference UI without emitting a viewer ID or load observation, so pixel rejection
must establish their failure. The pre-reopen control uses an actual native image
callback on a cold restored process, before the reopen action.
