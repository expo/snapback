# R2 `grok-clique-familiar` blocked by suite-status finalization refusal

Date: 2026-08-24  
Host: `Mac.lan` (`mac-mini-durand`)  
Disposition: **cell consumed after M1–M3; remaining campaign continues**

`grok-clique-familiar` passed a fresh load admission and ran exactly once
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
| 1 | `2026-08-25T00:02:54.684Z` | 2.8037 | 1.7021 | 1.5283 |
| 2 | `2026-08-25T00:03:54.687Z` | 2.1816 | 1.7109 | 1.5400 |
| 3 | `2026-08-25T00:04:54.691Z` | 2.0356 | 1.7427 | 1.5610 |

The complete admission artifact is retained at
`admissions/grok-clique-familiar.json` with SHA-256
`a7f6fe8527ce82a86b30187762622f4ed873b38e3462913e9e6457703d4ae4ed`.
It binds campaign HEAD `b4973620259830cce3bc9278a999e069a2a59ac5`,
the digest-verified `social-messenger@0.3.3-m8` v5 materialization, and the
registered controller/driver and Grok 4.6 harness.

## Terminal and finalization evidence

The retained `terminal-boundaries.json` reports:

| Milestone | Status | First green / terminal UTC |
| --- | --- | --- |
| M1 | green | `2026-08-25T00:59:24.875Z` |
| M2 | green | `2026-08-25T01:10:49.153Z` |
| M3 | green | `2026-08-25T01:24:24.573Z` |

The three `events/cell-milestones.jsonl` entries likewise retained M1–M3 as
green. At finalization, however, `suite-status.json` contained M1 and M2 as
`pass: false` with null receipts and only M3 as `pass: true`. The controller
therefore refused the inconsistent final source graph rather than composing an
invalid record.

The private attempt remains at:

```text
/Users/ccheever/bench-matrix-20260823-r2/cells/grok-clique-familiar
```

Key retained source digests are:

| Retained source | SHA-256 |
| --- | --- |
| `attempt-failure.json` | `5805e82571997078b60d519939abb0ca8da87d7c986acbbb92dc25ab88fd6099` |
| `events/harness.stdout.jsonl` | `d362ea79c48d25cf8c1a0d136133800e409366f0ec89b0ab4a8993efa0c58757` |
| `events/harness.stderr.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `events/lane-controller-observations.jsonl` | `c510124168e90188a8b6604cd890da64ecc5e2a2a84986def8bc86b2e66b8dab` |
| `events/cell-milestones.jsonl` | `74eda8231ba5c9a5d6c07594cc9ebfa71cd85ab059c288887eb03e14fb0cacc6` |
| `record-base.json` | `880e8b036d108a251aa49538933be4f68f3dc4dc49f106e13282f7680e51d3d2` |
| `suite-status.json` | `39aa45efcbb93ec752fc8af320bb7d45e57800f02e83094a88c478c7d44f0af3` |
| `terminal-boundaries.json` | `7dcdfa620e880abfdfe4262b6a4273061d87a08a6657cb4fca8032d276247d79` |
| `metering-manifest.json` | `1dec15c223448f524aa6f411eb412a389bee272d21d8aef8acee0440b670e41a` |
| `run-log.md` | `501114f17e5d1896df8d1aca05d76dac462680c92ecc9e183847b7de6c875e31` |
| `diary.md` | `681969ef0e7dcaedefbe21b12dd2658415e3e47f6960710b390f2d93e943bcd5` |
| `essay.md` | `3f6f7da219afb19d4d1a9d0a9301fc8f02c96a893063531b567679369ef96bfc` |
| `final-report.md` | `7c7a26a7750bf81d709449b2aae44d7b7ef51faeeec7e11a371877d32ee217ca` |

The retained native stream has 10,291 lines, the controller observation stream
has 210 lines, and the milestone stream has three lines. `metering.json` and
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
| `harness-config.json` SHA-256 | `cd168cf770b2da6134d680d95959646a57eae332e0672382b2a2fcb2436dca0d` | `be2e55b504560d8113b80c549312cf4683655f3011c681cbe4be33a900ed8299` |
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
42100–42119 port range, and the exclusive campaign lock was released. No
product, harness, controller, driver, validator, or instrument code was
modified.
