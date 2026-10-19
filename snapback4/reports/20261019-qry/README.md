# QRY wave-18 evidence

Workstream target: 0.4.35; package version deliberately remains 0.4.34.

- `survey-before.json.gz`: 200 unchanged schemas from waves 15 (100), 16 (50), 18 (50); all compile.
- `survey-after-initial.json.gz`, `survey-initial-comparison.json`: first implementation, before guard/helper precision fixes. Twelve added optional-lookup notes in seven apps, no changed exits or diagnostics.
- `survey.py`: read-only check survey; compiles only owned temporary copies, with per-command bounds and cleanup.
- `difftest-run.json`: 20,000 cases, 1,220,035 comparisons, no findings.
- `difftest-devices.json`: seeds 0–999, 27,922 comparisons, no findings.
- `difftest-lean.json`: 20,000 cases, 56,917 comparisons, same four known signatures (130 findings), no new signature.

Final corpus, full crate, packed-consumer, Mac and root-check receipts are appended after qualification. Root WORKSTREAM-REPORT.md is the delivery index. The inherited Integration 18 report is preserved here separately.
