# R2 `grok-coterie-explicit` blocked by suite-status finalization refusal

Date: 2026-08-24  
Host: `Mac.lan` (`mac-mini-durand`)  
Disposition: **cell consumed after M1–M3; remaining campaign continues**

`grok-coterie-explicit` passed a fresh load admission and ran exactly once
through the registered lane controller and production native-CLI driver. Its
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
| 1 | `2026-08-25T01:29:23.892Z` | 1.6826 | 1.5669 | 1.7021 |
| 2 | `2026-08-25T01:30:23.894Z` | 1.4902 | 1.5352 | 1.6787 |
| 3 | `2026-08-25T01:31:23.897Z` | 1.4775 | 1.5127 | 1.6587 |

The complete admission artifact is retained at
`admissions/grok-coterie-explicit.json` with SHA-256
`99bd53666593db832ef46fd563bb27a4cf66c55184eb1f4839546dd19fe40e87`.
It binds campaign HEAD `bd9452cc9e658d983006e541d0d18b2f898fa245`,
the digest-verified `social-messenger@0.3.3-m8` v5 materialization, and the
registered controller/driver and Grok 4.6 harness.

## Terminal and finalization evidence

The retained `terminal-boundaries.json` reports:

| Milestone | Status | First green / terminal UTC |
| --- | --- | --- |
| M1 | green | `2026-08-25T02:58:17.127Z` |
| M2 | green | `2026-08-25T03:41:12.972Z` |
| M3 | green | `2026-08-25T03:45:31.823Z` |

The three `events/cell-milestones.jsonl` entries likewise retained M1–M3 as
green. At finalization, however, `suite-status.json` contained M1 and M2 as
`pass: false` with null receipts and only M3 as `pass: true`. The controller
therefore refused the inconsistent final source graph rather than composing an
invalid record.

The private attempt remains at:

```text
/Users/ccheever/bench-matrix-20260823-r2/cells/grok-coterie-explicit
```

Key retained source digests are:

| Retained source | SHA-256 |
| --- | --- |
| `attempt-failure.json` | `1146939a81427f7b913ec8aed0878f37c00ea53ad5c8c000fec06b79a6633473` |
| `events/harness.stdout.jsonl` | `f53e825c3c299a6695ab3974fa7bb193f87d6a199d9288616c4607c4dc31a094` |
| `events/harness.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `events/lane-controller-observations.jsonl` | `1d3659ee7275ab73556e022a47b755fde3bf075ef37d354f5be8dde5cd897475` |
| `events/cell-milestones.jsonl` | `760c4fb6a7edc64e1af11088899ba01aebc05daa851bc728600ec19a659e3cc2` |
| `record-base.json` | `7debc6b2148aa0a8fed1360f481781168f18757c31acd9dbb49f2bfd2ac19b1c` |
| `suite-status.json` | `39aa45efcbb93ec752fc8af320bb7d45e57800f02e83094a88c478c7d44f0af3` |
| `terminal-boundaries.json` | `ec710f46dba448b91e44fcf5332e686d0bc713b1f7f23731f82fd43eb53af7ba` |
| `metering-manifest.json` | `950f4b14a76a7a6d83b1d3a814bd74d7c59fca61a386b5b09e41db4643e87275` |
| `run-log.md` | `af053dc6e0e67743b1ea7dc8aa0848c52097e7b1739fdddb5191738d956ef616` |
| `diary.md` | `45d27e91d05d592a68479c5ce928c4da544272d99132f880d8ed6ed75d2c6db9` |
| `essay.md` | `344cbda482f67b0e3c19a5c6a7751b53fc2d4eb67199a58dcf3983b7bac8974e` |
| `final-report.md` | `c632d0766a0444c58fe24c646ad5e20fc795911d3b3760fad93bf539cce55ffe` |

The retained native stream has 14,747 lines, the controller observation stream
has 292 lines, and the milestone stream has three lines. `metering.json` and
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
| `harness-config.json` SHA-256 | `137fe49522a41f627c681947b5f064f542c010858fccf9bb47c5f0b839cab010` | `be2e55b504560d8113b80c549312cf4683655f3011c681cbe4be33a900ed8299` |
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
42120–42139 port range, and the exclusive campaign lock was released. No
product, harness, controller, driver, validator, or instrument code was
modified.
