- M3 root causes: convo aggregate slice(-20) took oldest msgs; Dave fixture pollution; retained-history freeze; member-mutate apply lag (retry+nudge)

## 2026-09-14 — M5/M3 diagnosis + final sweep
- M5 search red was stale-store pollution: 520-row DM pushed sm0001 out of the sync window. Wiped + `seed --segment m3` (canonical 6-row DM) fixed it.
- M3 cutoff red was a lost-write race: settings mutations died with the page on instant navigation. Added `settingsMutate` (lib/helpers.tsx) — keepalive write-through + device fallback — wired for memberRemove + setDisappearing. M3 deterministic green.
- Disappearing purge: server `expire at` verified firing (TTL probe row purged); UI applies (repro); but frozen production 24h TTL vs 45s instrument wait makes the letter of the probe unsatisfiable — outcome is snapshot-timing-sensitive. Documented as gap.
- Final canonical sweep (fresh store): suites 7/7 green, choreo m1,m2,m3,m4,m5,m6,m8 all green (receipts-all5.jsonl). dist-web + dist-ios rebuilt clean (debug stripped).
