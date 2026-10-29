# TOK6 replay results

The 3,000-token package-reading bound passes. The dollar and Muse non-regression
targets fail in the preselected whole-session pairs. These results remain in the
record; reduced file reads or calls are not claimed as dollar savings.

Mean dollars per lane, frozen prices 2026-10-28.1:

| Model / phase | Uncached input $ | Cached input $ | Output $ | Total $ | Calls |
|---|---:|---:|---:|---:|---:|
| codex before | 0.143168 | 0.223782 | 0.271663 | 0.638613 | 41.50 |
| codex after | 0.144759 | 0.216278 | 0.299048 | 0.660085 | 38.25 |
| muse before | 0.020031 | 0.020951 | 0.012516 | 0.053498 | 110.50 |
| muse after | 0.023789 | 0.031530 | 0.015953 | 0.071273 | 137.50 |

Codex mean delta is **+$0.021472/lane** (+3.36%), versus the requested
−$0.03/lane. Input cost falls $0.005914 while output cost rises $0.027385.
Three Codex lanes cost less; Short-Term Rental Licenses costs $0.218034 more
and accounts for the aggregate reversal. Its output rises 23,718 → 38,689 tokens.
No causal attribution to the guide change is established by four stochastic pairs.

Muse mean delta is **+$0.017775/lane** (+33.23%); both pairs cost more. Wiring
lookups fall, but that does not establish whole-session non-regression.

| Lane | Before $ | After $ | Delta $ | Calls |
|---|---:|---:|---:|---:|
| codex 1 | 0.635735 | 0.619432 | -0.016302 | 44 → 36 |
| codex 2 | 0.644829 | 0.548194 | -0.096635 | 40 → 32 |
| codex 5 | 0.569671 | 0.787705 | +0.218034 | 40 → 40 |
| codex 39 | 0.704219 | 0.685008 | -0.019211 | 42 → 45 |
| muse 18 | 0.055787 | 0.078400 | +0.022613 | 114 → 149 |
| muse 19 | 0.051208 | 0.064145 | +0.012937 | 107 → 126 |

Mean observed reading commands (wiring turns can contain multiple commands):

| Model / phase | Reference files | Full cats | package-reference | Wiring commands | Wiring turns | generated/api.ts reads |
|---|---:|---:|---:|---:|---:|---:|
| codex before | 0.25 | 0.25 | 0.75 | 4.00 | 2.25 | 0.75 |
| codex after | 0.00 | 0.00 | 0.00 | 4.00 | 3.00 | 0.25 |
| muse before | 2.00 | 0.00 | 0.00 | 3.50 | 2.50 | 1.50 |
| muse after | 0.00 | 0.00 | 0.00 | 2.50 | 2.00 | 0.50 |

The installed-package census drops from 123,816 to **2,444 tokens beyond README**
(listing included). The after tarball has README.md as its sole Markdown file.
All 12 sessions exit 0 and produce REPORT.md. Their counters and 815 individually
priced requests reconcile with the harness price function. Codex also reconciles
against terminal counters; one duplicate native usage event is explicitly skipped.

See [METHOD.md](METHOD.md), [summary.json](evidence/summary.json), compressed
per-call measurements and provenance under evidence/. Whole-session application
scores were not measured. The performance targets remain unmet; another paired
study is needed before claiming cost improvement. No selected lane is excluded.
