# Independent scale-replay report (astra-006-scale)

Exploratory uncalibrated verification of frozen Astra-medium Clique on published snapback2@0.0.6. No formal O3/O5 or weighted-total claim. No preregistered holdouts. Failures were not rewritten as passes.

Private owner: `127.0.0.1:49103`. Frozen archive claim `c64b7b1e82a5f4588dfe7f0f07110ad149c0c7c3e0764424be678160f2f75b61`.

## Workload

| item | value |
| --- | --- |
| starter + scale settled | 87 + 167157 = **167244** |
| failed receipts | **0** |
| replay-summary | pass, `disposition=completed` |
| live receipts sha256 | `53f035a3828115dc702a1f5d40fd557b144364ca17ea340e755984356717e6e0` |
| scale.log sha256 | `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9` (match) |

Immutable receipt copies: `independent/receipts/scale-replay-settled-at-{10pct,death-63760,50pct,100pct}.jsonl`.

## Process / retry

Original adapter PID **95503** was the `node scripts/replay-adapter.mjs` process itself (no child). Backend relation: wrapper **74231** → binary **74249** on 49103, generation `0d1036d3…`.

Previous Grok session `01a07614-5721-7052-ba29-836575282532` last-active `2026-09-06T10:07:46.721965Z` coincided with last receipt `10:07:45.729Z` and backend log `exited:signal`. No crash report. Classified **environment/tooling**, instrument retry-once.

Death-boundary snapshot (receipt 63760, scale action 63673, next index 63761) is under `independent/checkpoints/death-63760/`. The 10% dbcopy was not touched.

Retry-once (same `.snapback`, no wipe, no digest/windows reinstall, same generation): backend wrapper **6906** / binary **6910**; resume adapter **14210** rebuilt actorMap by logging in 1008 already-registered principals and appended the original receipts file from index 63761.

## Clocks

Checkpoint waits excluded from replay apply time; raw times retained.

| segment | seconds |
| --- | ---: |
| attempt-1 apply excluding 10% wait | 1075.666 |
| 10% checkpoint wait | 122.064 |
| environmental death gap (not replay) | 742.757 |
| resume login (actorMap rebuild) | 21.373 |
| attempt-2 apply excluding 50% wait | 1724.470 |
| 50% checkpoint wait | 146.814 |
| **replay apply excluding checkpoint waits** | **2800.136** |
| 10% / 50% / 100% verifier wall ms | 30530.6 / 61440.3 / 97305.8 |

100% probes ran after workload completion.

## Checkpoint invariants

Starter chats `d-alice-bob` and `g-starter` were checked as **Alice** (member). The 10% raw `namedSpotEntities.pass=false` (queried as non-member u0001) is preserved.

| checkpoint | settled | per-entity | O5 fixtures | spots (Alice) | sampled chats | envelope |
| --- | ---: | --- | --- | --- | --- | --- |
| 10% | 24864 | pass | pass | raw fail / Alice pass | pass | reached after Alice reconciliation |
| 50% | 88144 | pass | pass | pass | pass | reached |
| 100% | 167244 | pass | pass | pass | pass | reached |

100% per-entity counts matched the frozen combined manifest exactly (1008 users/profiles, 50228 posts, 100015 messages, 5921 follows, 1002 conversations).

## Performance diagnostics (not calibrated O5)

Published following-feed rule: u0500 p95 ≤ 3× u0005. **Failed at every checkpoint; not adjusted to pass.** First 10% ratio **10.3039** preserved.

| checkpoint | follow 500/5 ratio | 3× rule | deep-page 50/1 | celebrity read | u0500 cold inbox |
| --- | ---: | --- | ---: | ---: | --- |
| 10% | **10.3039** | fail | 0.652 pass | 0.832 pass | 64.6 ms / 100 conv pass |
| 50% | **7.0508** | fail | 0.901 pass | 1.000 pass | 70.3 ms / 100 conv pass |
| 100% | **8.3581** | fail | 1.052 pass | 1.098 pass | 72.6 ms / 100 conv pass |

100% p95 ms: following u0500 139.53, u0005 16.69, u0901 18.32; search u0500 31.51 / u0005 11.71; receipts g0001 14.75; insights 3.35; trending 9.33; history page1 33.12 / page50 34.82.

## Dataset sizes (sqlite / wal bytes)

- 10%: 1_444_577_280 / 5_718_592
- death 63760: 4_184_805_376 / 6_118_232
- 50%: 6_271_455_232 / 4_775_112
- 100%: 12_323_409_920 / 6_250_072

## Qualification limits

Exploratory wave: no precommitted rotated holdout set, no completed calibration. No invented formal O3/O5/weighted score. Another independent profiling worker may read the immutable 10% dbcopy; this report does not consume its findings.

## Artifacts

- `scale-report.json`
- `independent/action-trace.sanitized.json` (credentials redacted; HMAC publisher not used — no key file)
- `independent/launch-metadata.json`, `independent/state.json`
- `independent/checkpoints/10%/`, `50%/`, `100%/`, `death-63760/`
- `app/evidence/scale-replay-settled.jsonl`, `app/evidence/replay-summary.json`
