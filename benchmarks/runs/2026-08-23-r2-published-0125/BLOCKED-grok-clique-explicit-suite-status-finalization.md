# R2 `grok-clique-explicit` blocked by suite-status finalization refusal

Date: 2026-08-24  
Host: `Mac.lan` (`mac-mini-durand`)  
Disposition: **cell consumed after M1–M3; remaining campaign continues**

`grok-clique-explicit` passed a fresh load admission and ran exactly once
through the registered lane controller and production native-CLI driver. The
single Grok 4.6 session reached green terminal boundaries for M1, M2, and M3.
The controller then failed closed while loading the final metering manifest:

```text
social-messenger lane controller finalization failure:
stage=metering-manifest-load source="none" streamLine=none eventOrdinal=none eventType="unparseable" cause="suite-status m1.pass changed after choreography refusal-check time" rawPayloadExcerpt="null"
```

The controller exited 2. Per the campaign ruling, this finalization failure is
recorded and the consumed cell is not rerun.

## Admission

The launch-authorizing samples were all below the inclusive 10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | `2026-08-24T21:52:54.549Z` | 2.6167 | 1.8989 | 1.9331 |
| 2 | `2026-08-24T21:53:54.551Z` | 1.8896 | 1.8228 | 1.8999 |
| 3 | `2026-08-24T21:54:54.553Z` | 1.6943 | 1.7520 | 1.8647 |

The complete admission artifact is retained at
`admissions/grok-clique-explicit.json` with SHA-256
`387b38dd1226218953cb956324e227ccea8394cf2c1709287ecbd64b97b7f5b9`.
It binds campaign HEAD `3af64c8e83710a7e2db77c4e5050e2b534ba9ff6`,
the digest-verified `social-messenger@0.3.3-m8` v5 materialization, and the
registered controller/driver and Grok 4.6 harness.

## Terminal and finalization evidence

The retained `terminal-boundaries.json` reports:

| Milestone | Status | First green / terminal UTC |
| --- | --- | --- |
| M1 | green | `2026-08-24T23:11:36.733Z` |
| M2 | green | `2026-08-24T23:40:07.614Z` |
| M3 | green | `2026-08-24T23:57:56.378Z` |

The three `events/cell-milestones.jsonl` entries likewise retained M1–M3 as
green. At finalization, however, `suite-status.json` contained M1 and M2 as
`pass: false` with null receipts and only M3 as `pass: true`. The metering
manifest had already hash-bound that changed suite-status file. The controller
therefore rejected the inconsistency rather than composing an invalid record.

The private attempt remains at:

```text
/Users/ccheever/bench-matrix-20260823-r2/cells/grok-clique-explicit
```

Key retained source digests are:

| Retained source | SHA-256 |
| --- | --- |
| `attempt-failure.json` | `8ed30dd8dc5843032f54620c699c76113344ebec09ad7f0dba642ee92f249c8d` |
| `events/harness.stdout.jsonl` | `480e9274807327df65e3e3d026d3b756da8f4544def5bfc7851e98259dca43a3` |
| `events/harness.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `events/lane-controller-observations.jsonl` | `44562a252f775814be11872cd90bba9d1fcd1323aaa478655666a6bd4ec76c86` |
| `events/cell-milestones.jsonl` | `95efe9513b22aa61ea79b27f604e39cee7512557123f6d796e9a3c8afef84c09` |
| `record-base.json` | `b47517d9e805e39e6f50d4270f35139325e23c395e9e2c73844e72839f533001` |
| `suite-status.json` | `8799d1d5cf3557301331f16703a0030cd57ce4d3cb965a2301fbaa7de71ada82` |
| `terminal-boundaries.json` | `87e0940d633d8922ed196c6015f5d9c1a5318b1bd9e769d7680dfaf0238eff86` |
| `metering-manifest.json` | `63bc5f3c49912a5cd3e97b8dcd9ae6a9bc8b861f661d83ee9dd6ca4423771c82` |
| `run-log.md` | `7fb195ded1c4251ecbb2b0203460150c5a8adb1b784c01de1acb1eb614e0e9b0` |
| `diary.md` | `6180be650aa94ccfc42ce50d0c9c9e00f2530455e51f059ecfe08b6f7925ae9a` |
| `essay.md` | `5241a8ed5acee61ed8faaa174f0ce9f4948e1a77a063da97f748d4b8cc214876` |
| `final-report.md` | `d4ef8fdea029442d49eaccd6b0f4dfea47ea34344084121b42097ea7fed3e342` |

The retained native stream has 12,215 lines, the controller observation stream
has 257 lines, and the milestone stream has three lines. `metering.json` and
`record.json` do not exist, so there is no record to validate or publish and no
replacement record was fabricated.

## Retained-evidence re-finalization refusal (2026-08-24)

After the receipt-identity repair in `f489b8e28`, the registered no-launch
finalizer was invoked with `--publish`. It refused before lock acquisition or
any derived/private/publication write:

```text
stage=unclassified source="none" streamLine=none eventOrdinal=none eventType="unknown" cause="R2_FINALIZE_REFUSAL: private evidence is not the exact registered one-attempt capsule" rawPayloadExcerpt="<not event-scoped>"
```

The exact mismatch is that this attempt is a v5 capsule but the registered
finalizer requires the live configuration and execution closure to equal the
admitted bytes:

| Binding | Admitted v5 | Live v6 |
| --- | --- | --- |
| `harness-config.json` SHA-256 | `af6ef2c74ad53988d979200505b682dbac9590d4f356a71d68c03ca19aea579b` | `be2e55b504560d8113b80c549312cf4683655f3011c681cbe4be33a900ed8299` |
| instrument manifest SHA-256 | `13d5fe72dfdf5f401b1e81452f1668af071fb83093cdb92aed1941db61ddff3d` | `2f87099eb13640f632ee76483c6c414f03f8671174c7ac52098c858292d540ae` |
| production driver SHA-256 | `de0163b2a5621e70cec038089ed2b3abeca3ec82e85904c9faa286c124e81135` | `61931aeca07f67b569127d75ae256b5cce372ce335dbde4530f8934303f10559` |
| metering source-closure SHA-256 | `b8b56bc3f29cf689b7401f58eec4c77583a52c66bb2ec638b055bad552363c9e` | `c1e875f6c992da33a79c26ec686de78b8daa58aab1f63f96e7ab72d142a6d5b4` |

`instrumentMigrations[2]` records that v5-to-v6 transition for live campaign
configuration, but `r2-finalize-existing.mjs` has no registered cross-version
retained-attempt migration and intentionally rejects this identity change.
Rewriting the capsule to v6 would destroy its admitted provenance, so no record
was forced. `metering.json`, `record.json`, `publication-manifest.json`, and
`publication-transaction.json` remain absent; scorecard eligibility cannot be
assigned without a validator-clean record.

## Closure

The controller and Grok process closed. No listener remains on the registered
42080–42099 port range, and the exclusive campaign lock was released. No
product, harness, controller, driver, validator, or instrument code was
modified.
