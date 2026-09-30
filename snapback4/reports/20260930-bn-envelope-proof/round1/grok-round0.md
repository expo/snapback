I'll review lane BN round 0 against the four claims and the failure modes you listed, without changing the branch or pushing anything. First I'll read the review skill and the report so the checks stay tied to the actual diff.The report and helper are in place. Next I’ll trace restart verification, the zero-download check, and the witness CLI against the receipts.**READY WITH CHANGES.** The proof command does what round 0 claims. The 12 receipts match the reported medians, and the restart and zero-download gates actually reject the failures they are supposed to reject. The report still needs to name where the 42 seconds go: native process-device ingestion, not the server.

This checkout has no `snapback4` binary and no SDK `dist`, so the integration tests and the 12 acquisitions were not re-run. The checks below are against the committed source, the four `acquire.json` receipts, `host.json`, and HV's heavy-acquisition report. Pure gates were mutation-tested in a scratch copy of `witness-acquire.js`.

## Claims

**1. Confirmed.** `snapback4 witness acquire` parses `--as`, `--token`, `--url`, `--query`, `--args`, `--restart`, `--runs`, `--timeout`, `--artifacts`, and `--json`. Each run opens a fresh temp directory through `processDevice` (a `snapback4 device` subprocess on a new SQLite file). It times the SDK acquired flag and the first complete local query, then records residency and a native-only coverage scan (per-group row counts, history, acquisition boundaries). The receipt is created with `wx`, so a second run into the same directory fails with `EEXIST`.

With `--restart`, the client is closed (the device process is killed and waited on), reopened with every HTTP call thrown, and checked **before** reconnect. `verifyRetained` compares acquired flag, store id, generation, watermark, the SHA-256 of the coverage scan, and each table's row and payload-byte counts. Only then does it call `client.sync()` and require at least one reconnect `/sync` with status 200 and `events.length === 0`.

A scratch copy that dropped the shape comparison accepted a wiped `notes` row count. The original `verifyRetained` throws `E_WITNESS_RECEIPT: cold restart coverage differs`. All 12 receipts have equal acquired, offline, and reconnected digests. Heavy coverage is 4,014 table/group pairs and 105,034 rows: 1,000 each for `conversations`, `members`, `messages`, and `unread`.

I did not find a path where wiping synced rows still matches both the scan and residency. Residency counts `r` (triggers, or a rebuild when `data_version` changes). The scan counts those rows again. Both are compared before sync can repair them. Limits, and they match the guide: same-length body edits are invisible; empty target groups with no rows and no stored coverage facts are not counted; this is not a row-body hash.

**2. Confirmed, with the wrong performance story.** All 12 runs have `passed: true`, `retained: true`, and `downloadedRows: 0`. Medians from the receipts, not only `measurements.json`:

| Condition | Acquisition | Cold restart | Server-Timing sum |
| --- | ---: | ---: | ---: |
| 96 CPUs, 1,000 memberships | 42.081 s (40.892–60.976) | 0.270 s | 2.563 s |
| 10 CPUs + 8 burners, 1,000 | 49.048 s (43.742–62.762) | 0.394 s | 3.188 s |

`host.json` load1 ranges are 6.32–71.48 unconfined (96 CPUs, 0 burners) and 38.77–102.01 loaded (10 CPUs, 8 burners). The 100-membership account is 11,612 rows and 413 groups, as reported.

**3. Confirmed.** `guide bounds` says "Prove the envelope's heaviest account", includes the shell recipe, the one-line receipt excerpt, and HV's 18.609 s / 19.522 s figures. Aliases `envelope`, `heaviest`, `1000`, `cold start`, `cold restart`, and `acquire` resolve to that card, and `definitions.rs` asserts those strings. Those HV numbers are the "after acquisition" column in `snapback4/reports/20260929-hv-heavy-acquisition/REPORT.md`, not the 0.441 s first inbox. The attached proof is HV's 1,000-membership account. It has 1,000 conversation rows and **0 `follows` rows** (5 `followingEdges`). The report correctly does not claim a follow count. The guide's "500 follows" is the envelope to aim at, not a result of this fixture.

**4. Confirmed for logs and receipts.** Bad flags, `--runs 0`, a `file:` URL, a URL with credentials, and a principal without a token throw `E_INPUT` and do not echo the token. Unknown personas, a mismatched bearer, and an unreachable server are separate `E_AUTH` / `E_WITNESS_BACKEND` paths in the helper and in `witness-acquire.test.mjs`; those were not executed here. Receipts have no `token`, `authorization`, or `bearer` fields. `u0001.log` and `server.log` do not contain a bearer. The token is still a process argument (`--token`), so it is visible in the process list during the run. That is outside the claim as written.

The zero-download figure is not a mis-count. The same parser that recorded **105,034 put events** on the way in recorded **one** reconnect `/sync` per run, with `events: 0`, `putRows: 0`, `snapshot: false`, and `headerMs` of 2–5 ms. Watermarks stayed 419402. Reverting `s.events !== 0` makes a 105,034-event reconnect pass that gate. `downloadedRows: 0` is then a constant, which is safe only because that gate already rejected any event.

## Findings

**1. The report should name a device-side ingestion defect. High.** Heavy acquisition is 12 `/sync` calls: 11 snapshot pages of about 6k–10k puts and one empty catch-up. Server-Timing `total` for those calls sums to about 2.55 s, and time-to-headers is about 2.58 s. About **39.5 s of the 42.1 s is after the headers**. HV, on the same account and the same host class, spent 2.51 s producing the pages and about 16 s on the client (wasm apply 8.4 s, strict persistence 4.6 s, body plus decode under 0.5 s). Server time matches. Native process-device ingestion is about 2.4× the wasm client's post-header cost, and per-row cost is worse at 105k rows (~0.37 ms) than at 11k (~0.07 ms). Payload bytes are 40,664,541 against 375,209,984 SQLite page bytes.

The report prints 42.081 s next to 2.563 s and says native is slower than web, then spends the caveat on first-inbox definitions (0.441 s vs a clock that includes acquisition). Those inbox clocks really are different. The acquisition clocks are not. The extra ~24 s versus wasm, and the ~39 s after headers, is process-device apply (JSON to the `snapback4 device` subprocess, then SQLite), not Server-Timing and not this harness's extra `response.clone().json()` (HV's own body read plus decode was ~0.5 s). Say that in `REPORT.md`. Otherwise the next calibration will treat 42 s as the cost of the account or of the server.

**2. `witness acquire` does not speak the witness error surface. Medium.** Bad acquire flags are `E_INPUT`. `guide` defines `E_INPUT` as a typed value or an HTTP body bound, and `E_WITNESS_INPUT` as invalid witness arguments. `witness ios` uses `E_WITNESS_INPUT`. `snapback4 witness` with no subcommand still prints only the ios recipe (`witness.rs` around the `Options::parse` error), even though `snapback4 --help` lists `acquire`. Refusals are readable. `guide why E_INPUT` will explain the wrong failure.

**3. The receipt note over-associates this run with Expo. Low.** `device` is `native-process`, and the report disclaims iOS UI, phones, and web. The note on every receipt says "SQLite, same module as Expo". That crate is what Expo links in-process via the xcframework. This proof is a Node subprocess speaking one JSON line per call. Quoting the note alone makes a process-device timing look like an Expo or iOS result. The 42 s versus wasm is exactly the hosting difference.

**4. The cold-restart sentence attributes the full retention proof to the inbox timer. Low.** `restart.firstLocalMs` stops when `chat.inbox` returns. The 105k-row coverage scan runs after that. The report says scans follow the timed answer. The operator line does not: "cold restart retained 4,014 table/groups in 0.270 s". 0.270 s is reopen plus one local query on a warm page cache, not a re-read of the partition.

## Not found

Restart does not pass a wiped or partial synced store: offline `verifyRetained` runs before reconnect, and it includes both the coverage digest and residency row/byte counts. Zero downloaded rows is an event count on the reconnect `/sync` body, and these bodies were empty catch-ups, not snapshots with the rows hiding in another field. Tokens are absent from receipts and the saved logs. The full-suite log does end with `== 1 failure(s) in 1341 s`, on the liveness-probe body that omitted `viewer`.
