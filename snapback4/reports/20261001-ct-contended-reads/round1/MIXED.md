# Real-clock mixed load

Each cell observes 125 seconds, then drains for four seconds under the same load. Delays and runtimes below are milliseconds. Schedule lists include every observed boundary in chronological order (including adjacent preparation/drain boundaries); raw summaries retain the timestamps and explicitly expected observation boundaries. Reclamation and requeue have approximately 50 ms polling uncertainty plus observer scheduling. Expiry max excludes the final drain's coarsely observed deletions, which remain in the raw samples. These are observations, not product guarantees.

| Design | Busy | Schedule firing delays | Job elapsed | Expiry max | Lease recovery max | Backlog max | Reads |
|---|---:|---|---|---:|---:|---:|---:|
| Before CT | 0 | 92, 323 | 0, 0 | 1110 | 4659 | 34 | 210,890 |
| Before CT | 48 | 732, 206, 189 | 1, 0, 1 | 1082 | 3967 | 34 | 246,738 |
| Before CT | 96 | 910, 860 | 4, 0 | 1087 | 4722 | 34 | 56,207 |
| Before CT | 144 | 179, 759 | 0, 1 | 1098 | 5066 | 34 | 53,083 |
| Demoted | 0 | 270, 16 | 1, 1 | 1070 | 4872 | 34 | 197,308 |
| Demoted | 48 | 78, 427, 795 | 2, 2, 1 | 1084 | 3683 | 34 | 263,835 |
| Demoted | 96 | 877, 387 | 1, 0 | 1126 | 4883 | 34 | 165,023 |
| Demoted | 144 | 110, 716 | 1, 1 | 1121 | 4931 | 34 | 173,794 |
| Restored maintenance | 0 | 1005, 972 | 1, 4 | 1094 | 5227 | 34 | 184,150 |
| Restored maintenance | 48 | 407, 22 | 1, 1 | 1130 | 4307 | 34 | 275,470 |
| Restored maintenance | 96 | 788, 643, 1054 | 0, 3, 1 | 1136 | 5169 | 34 | 173,376 |
| Restored maintenance | 144 | 180, 563 | 0, 1 | 1113 | 4575 | 34 | 183,527 |

All twelve cells deliver 507 normal/probe effects and durably reject the one deliberately late effect with E_EFFECT_DEADLINE. In these first matrices, the slow effect was emitted before the lease-extension clock advance, which could trigger its deadline. Separate deadline-only controls (see REPORT.md) supply the real-clock evidence; the corrected harness emits it afterwards. Each has 106 retries (100 injected first-attempt failures and six abandoned leases), no lease heartbeat/change within an attempt, and one exact 1,000 ms development-clock extension before observation. All expected schedule boundaries finish once; all expiring rows and abandoned leases clear.

`mixed-after` is the demoted candidate, not the final product. The final candidate restores maintenance to its original Linux priority and Darwin default. Exact observed maxima still vary with sweep phase, observer delay and shared-host scheduling; restoration is a policy rollback, not evidence that every timing quantile is nonregressing. Before/demoted runs overlap some exploratory compilation/tests; this lane's full suite starts after these matrices. A process snapshot during qualification also found lane-bg running its Rust suite on the shared host, overlapping the restored comparison. No other lane was stopped.
