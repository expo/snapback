# Probe fixture comparison

Calibration #26 was measured on the M1 Max; AQ uses the copied retained SQ
store on eb1000. Both users have 100 conversations, 500 Following edges and
500 messages. Their declarations and public rows differ. This table comes
from the supplied JSON data and a before-variant Worker sample; it is not a
claim that the Mac measurement was repeated.

| Table | Calibration #26 rows | Retained SQ rows | #26 logical row bytes | SQ logical row bytes |
|---|---:|---:|---:|---:|
| `$ownKeys:likes` | 3 | — | 678 | — |
| `$ownKeys:reposts` | 1 | — | 224 | — |
| `conversations` | 100 | 100 | 44200 | 37400 |
| `followingEdges` | 500 | 500 | 120500 | 120500 |
| `followingFeed` | 1054 | 1000 | 457510 | 434679 |
| `followingWork` | 63 | 63 | 28998 | 28917 |
| `likes` | 2000 | 1000 | 468000 | 234000 |
| `members` | 248 | 248 | 64384 | 64384 |
| `messages` | 500 | 500 | 205676 | 205676 |
| `posts` | 1000 | 1000 | 449114 | 404000 |
| `profiles` | 1008 | 1008 | 487857 | 487857 |
| `reactions` | 2000 | 2000 | 558500 | 558500 |
| `replyCounts` | — | 1956 | — | 254224 |
| `repostCounts` | — | 988 | — | 126464 |
| `reposts` | 1000 | 1000 | 297000 | 297000 |
| `runs` | 3 | 1 | 631 | 212 |
| `unread` | 248 | 248 | 48758 | 48758 |

`—` means absent from that residency report. Zero-row entries common to both
are omitted. These are the residency API's per-table logical row-byte values,
not network bytes, IndexedDB file size or a wasm heap accounting.

Total table rows: **9,728 calibration / 11,612 retained**. The exact calibration
input is retained as `evidence/calibration26-scale-full-browser.json.gz`;
the before/after witness retains each complete residency report.
