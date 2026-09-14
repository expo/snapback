# Muse M7 choreography — provisional custody audit

Observed 2026-09-14 while Muse M7 remained active. Scope is limited to the immutable observer captures `muse-m7-first-choreography-prefix` and `muse-m7-first-green-choreography-prefix`, plus the previously written snapshot-custody qualification by hash. No canonical Muse lane, raw CLI stream, private reasoning, implementation source, or repository input was read. This note records provisional evidence and makes no final M7 or assertion verdict.

## Capture integrity

| Capture | Captured epoch | Receipt SHA-256 | Qualification carried by capture |
|---|---:|---|---|
| First observed choreography | `1789381937.009585` | `07eab8b30f5a4a6c0db90b3c9631c35968d46109c41265cb938d8a7ae1734ae8` | Passive prefix; not an atomic lane snapshot or independent grade |
| First observed green choreography | `1789382336.3728929` | `bb487d67ee8ce8dffdf32358b4d1ef3fa56eb7fc94657ef9b6f9e144969d9ee1` | Passive prefix; not an atomic lane snapshot or independent grade |

Every copied file matches the hash recorded in its capture manifest:

| Payload | First choreography SHA-256 | First green SHA-256 |
|---|---|---|
| `choreo-receipts.jsonl` | `2293e4ef45c52dc24eb06a1658ca537864b2907596e1af78002df4c49736784a` | `03f53e49d10685f98eb7a8f5d5fd84d2679122b49107a7d0a57bf101010e6220` |
| `choreo-receipts.jsonl.observations.jsonl` | `db2557bc2963900e15aca333c7a4ba074b4c8b2242f67e1a19c0ffed58959ace` | `1b7066055e9e3116dbfddd5175e6a1653b29c082ed1af332e8c01a5de320f2f0` |
| `suite-status.json` | `629b34ef344aaa7c9dd4cb5465eb25d8440387125777fd44ac276c9d88a089f0` | same |
| `accept-m7.log` | `e649e519fac247dd54b69e6bb2f1a156417274a58cb91cdee02f8c26230981e4` | same |
| `run-log.md` | `6b3aad4402ae8c622d2d8a4ec75312744555d721b8215f49b77df7d010976e5f` | `b4ecc46f419394f9527048fc7b47ddc53ef56bcccccc8b6291cae3bc677718cd` |

Both suite-status copies report M7 pass and point to `accept-m7.log`. Both acceptance-log copies are byte-identical and record `TALLY total=31 pass=31 fail=0`. Each choreography segment summary links that exact suite artifact as `sha256:e649e519fac247dd54b69e6bb2f1a156417274a58cb91cdee02f8c26230981e4`.

## First choreography result

The first receipt retains every configured attempt:

| Assertion | Attempt | Result | Duration | Settlement wait | Visible metric / failure |
|---|---:|---|---:|---:|---|
| `m7-a02-live-poll-tallies` | 1 | pass | 615.0 ms | 497.0 ms | 272.9 ms |
| `m7-a02-live-poll-tallies` | 2 | pass | 606.7 ms | 497.1 ms | 259.2 ms |
| `m7-a02-live-poll-tallies` | 3 | pass | 659.7 ms | 564.0 ms | 310.4 ms |
| `m7-a05-offline-vote-reconciles` | 1 | fail | 10,451.2 ms | 10,317.2 ms | pending vote not observable within 10,000 ms |

The live-tally assertion passes best-of-three with all three attempts green and attempt 2 selected. The offline assertion's sole attempt is classified `application`; the segment summary records one pass, one failure, `green: false`, `nonGreenCause: choreography-failed`, and segment `outcomeClass: application`. The observation sidecar agrees with all four settlement waits and retains the browser-assertion-wait block claim.

## First green choreography result

The later receipt also retains all four attempts:

| Assertion | Attempt | Result | Duration | Settlement wait | Visible metric / failure |
|---|---:|---|---:|---:|---|
| `m7-a02-live-poll-tallies` | 1 | pass | 568.2 ms | 466.1 ms | 249.6 ms |
| `m7-a02-live-poll-tallies` | 2 | pass | 616.2 ms | 498.4 ms | 256.1 ms |
| `m7-a02-live-poll-tallies` | 3 | fail | 10,384.8 ms | 10,285.6 ms | other-client tally not observable within 10,000 ms; `application` |
| `m7-a05-offline-vote-reconciles` | 1 | pass | 1,696.5 ms | 1,579.7 ms | pending clears after reconciliation |

The live-tally assertion passes under its best-of-three rule because attempts 1 and 2 pass; attempt 1 is selected and the failed third attempt remains retained. The offline assertion passes its sole attempt. The segment summary records 2/2 required assertions passed, browser and choreography pass, and `green: true`. The observation sidecar agrees with all waits and block claims.

The green receipt is therefore a best-of-three green, not an all-attempts green. The first red remains material custody evidence: it shows the earlier offline-pending failure rather than being overwritten by the later receipt.

## Suite/source timing qualification

The captured acceptance log predates both choreography receipts. Its capture metadata gives source mtime `1789381752.3665204`; suite status is `1789381756.0438685`. The first and green choreography receipt mtimes are `1789381870.0225892` and `1789382299.0411913`, respectively.

Between those receipts, the later captured run log records two correction loops: an offline-pending miss followed by `optimistic-intent+reconnect-retry` at `1789381970`, and a device-pending signal correction followed by `device-mine-pending-drives-busy` at `1789382284`. It then records the green choreography at `1789382315`. Those are source-change claims after the 31/31 acceptance artifact was produced. The green segment still links the older unchanged suite hash, and neither immutable capture contains a newer acceptance rerun.

This creates a stale-suite qualification for the provisional green: the choreography result is bound cryptographically to a passing suite artifact, but that suite artifact does not qualify the post-correction source state. Whether those changes alter suite-covered behavior requires later final evidence; this passive audit does not inspect source or run anything.

## Snapshot qualification carried forward

The earlier provisional custody note is `observed-milestones/muse-m7-snapshot-replacement-provisional.md`, SHA-256 `15fa6f624e8c8ca4e92ce9483d5006b1e0c8013468530ca738c13c2c1cb9d275`. It establishes that the first-migration observer capture already held the replacement snapshot after the wipe/reseed, and that all ten captured payloads there are byte-identical to the later replacement capture. The original first-migration claim survives only as a contemporaneous run-log line reporting 48 checks and zero differences; its post-migration comparison inputs were not captured.

The green choreography run log adds another claimed `checked=48 diffs=0` snapshot comparison after choreography. These choreography prefixes do not include its snapshot inputs or result. Any later snapshot comparison against the replacement baseline can establish preservation only from that replacement point; it cannot independently prove survival of the original pre-wipe state through the first migration.

These qualifications must remain attached to any later outcome summary. This note does not anticipate the active session's final files or convert the provisional choreography state into a final M7 verdict.
