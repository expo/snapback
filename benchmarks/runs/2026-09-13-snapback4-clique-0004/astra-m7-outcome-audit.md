# Astra M7 outcome audit

Observed 2026-09-14 after the recorded M7 process exited. Scope: the frozen M7 brief, assertion manifest, choreography contract, and received Astra M7 files. This is a static evidence audit. It does not re-run the app or act as a second independent grader.

## Verdict

The received files support a **builder-reported functional green** for the six suite-required assertions and two choreography assertions. Both retained suite/choreography pairs are green and hash-linked, the final eight-persona pre/post files are byte-identical, the final regression pass covers M1–M6 and M8, and the driver exited 0 within the four-hour cap.

The result has one material packet/orchestration qualification. The frozen brief says the pre-M7 snapshot is exported before the M7 session starts, while the supplied frozen M7 prompt directs the fresh M7 agent to start and seed the backend, then export the snapshot “before changing anything.” The builder followed the supplied prompt; this timing deviation comes from the packet's conflicting instructions, not from builder noncompliance. The driver started at epoch `1789372719`; `pre-snapshot/manifest.json` records `1789372876758` ms, about 158 seconds later. The run log places snapshot completion before the first recorded schema-change/compiler attempt, which supports before/after data preservation, but the baseline lacks the brief's pre-session custody.

## Packet method and `m7-a08`

The packet's declared order is continuous builders, holistic scores, independent grades, grade summary, then the three fresh M7 sessions. `scripts/run_phase.py` requires a completed independent grade, `grading/DONE`, holistic score, and all-lane grade summary before M7 starts. It has no post-M7 grader stage or post-M7 grading output path, and its duplicate-start guard prevents silently rerunning an existing phase receipt. The grade prompt is rendered to classify M7 from the pre-evolution artifact as not-run or conditional. Therefore the original packet plans one independent baseline grade before M7 and no second independent grade afterward.

The frozen assertion manifest nevertheless assigns `m7-a08` to `grader`, and both the brief and M7 prompt say a grader compares the snapshots. The same M7 prompt directs the fresh M7 agent to create the pre-snapshot, preserve it through the migration, compare against it, and report the comparison. Retained M7 reports follow that operational path: the September 5 Snapback 2 Grok record calls `m7-a08` a local comparison, and the September 12 Snapback 4 Astra record explicitly says that no independent grader result is claimed. Under the packet as actually specified and run, the expected evidence for `m7-a08` is the fresh M7 agent's local pre/post comparison; its manifest-assigned independent grader execution remains absent.

This audit therefore retains the builder-reported green while labeling M7 independently ungraded, `m7-a08` builder-evidenced rather than grader-executed, and snapshot custody pre-change rather than pre-session. It did not rerun M7, add an ad hoc grade, or steer the lane. Applying the same frozen procedure to the remaining lanes preserves the packet's comparison method without silently changing the protocol.

## Frozen contract and assertion coverage

The frozen brief requires polls, changeable idempotent votes, an offline vote, backfilled and maintained visible-message counts, pre-existing-data preservation, and regressions for previously-green milestones. The assertion manifest assigns six IDs to the suite (`m7-a01`, `m7-a03`, `m7-a04`, `m7-a06`, `m7-a07`, `m7-a09`), two to choreography (`m7-a02`, `m7-a05`), and the snapshot comparison `m7-a08` to the grader.

`coverage-m7.json` maps exactly the six suite-required IDs, and `suite-m7.json` reports all six passing. Its evidence covers poll bounds and group-only creation, vote replacement and late duplicate replay, initial backfill values, maintained text/media/poll counts, tombstone and expiry behavior, settings display, and the seven regression-suite receipts. The final suite SHA-256 is `3f7bffa4fde1649a9b6242a9afcc17dd80b0cf10eeff37c6dd46f3174bd7f98a`; coverage SHA-256 is `f873b5638440d8f2112dab8a3451b3b8e032532fd6f8204dbb14b09b4edc9540`.

The earlier passing suite is retained as `suite-m7-attempt1.json`, SHA-256 `5e7e817e6fbadc625efaa619d8ee24833a903a9c21abf4b6f95e3a5cc7bda616`. A later caption-bound correction led to the final suite rather than silently replacing the first evidence.

## Choreography and linkage

Two complete M7-only choreography streams are retained. Each has two passing assertion records and a green segment summary:

| Stream | Live tally attempts | Offline attempts | Linked suite SHA | Link verified |
|---|---:|---:|---|---|
| `choreography-attempt1.jsonl` | 3/3 pass | 1/1 pass | `5e7e817e…616` | yes, matches `suite-m7-attempt1.json` |
| `choreography.jsonl` | 3/3 pass | 1/1 pass | `3f7bffa4…98a` | yes, matches `suite-m7.json` |

Each run retains Alice option A, Alice option B, and Bob option A as the three live attempts, followed by Bob's alternate option through the offline path. The notes and observation sidecars record every settlement wait; the live tallies use best-of-three while retaining all three attempts. The final stream SHA-256 is `dcac36114b00c2b9bd28170f7b99a4e95b30a7de1c6f5ff88fa8d908ec947466`; its observation sidecar is `631fea814030ab0d4f45f5ca16cba83e8fd7a60da2eedc9acf4168e7b6011c1d`.

## Migration and preservation

The baseline manifest lists the required M6 fields: identity, conversation, sender, server time, sequence, type, text/caption, media, edit/tombstone state, reply target, reactions, and caller-specific receipt. Direct byte comparison confirms exact pre/post equality for all eight files:

| Persona | Messages | Accessible asset hashes | Shared pre/post SHA-256 |
|---|---:|---:|---|
| Alice | 15 | 18 | `ee28f0588e90fc5c2d1a3d3c90dc0d08ba48c14fda333801c026dcdba6adbe0c` |
| Bob | 15 | 18 | `cdd660c716654e3ea7972d933149e093f457c7dae319f7852d3bb49eb01a55af` |
| Carol | 9 | 18 | `28ec8c4209aaab3fa5785f936b81f3ebbfaa3963fcf1d873aa1a6a9b5e5be656` |
| Dave | 0 | 18 | `4d84be80b56b455d063aa532ef83185b66a82e80e0aad4bd2497cd0438d578a4` |
| Erin | 0 | 18 | `e9acb48f6ef053281af51f8a54a657bfabd78c313db29e105d6a61c5fb6d5ab6` |
| Frank | 0 | 18 | `45bd7ae7aa2a05adfb540855f033726d2e4d58647d5dc4bc579fcac6274b303f` |
| Grace | 0 | 18 | `8ce3dfadfed0d969a3b75918dfcc1cf85e7f18f5761018f7c47db0ec0bf6167f` |
| Henry | 0 | 18 | `37599db7a16956c092b72a5f849e7558d9913f2d56f135eb3352576174ab030d` |

The comparison proves preservation of 39 persona-visible message records, public profiles/posts, and the 18 accessible asset byte hashes recorded for every persona. The starter messages contain no populated message media or reactions, and their receipt values are only `sent`/null. Those message-level preservation cases are therefore field-presence checks rather than populated migration examples; populated post/avatar assets supply the old-asset byte evidence. The final M7 suite separately exercises new media counts after migration.

`migration-verification.json` reports that no visible-message-count structure existed before M7 and verifies initial counts of 6 for the Alice/Bob DM and 9 for the starter group for every persona who can read them. Its SHA-256 is `0c42eda1c70dd1e9c3a1ebbe81240d306543de6a9847fb33ab22dc31ef127f13`; `snapshot-comparison.json` is `f0e21936c88290860eb6f995cc8284c10012bf5c8dd07eaa83703619e7a2dea4`.

## Previously-green regressions

The first retained pass runs M1–M5 green, then records two setup failures: M6 returns `E_AUTH` because its inherited replay cache refers to another database; M8 cannot connect to its required isolated aging server on port 49304. The failure receipts are preserved as `suite-m6-attempt1.json` (`55a2ce26c9835c036f8da26248a2f28a6c279ae104f27f84b0539b87efc3d985`) and `suite-m8-attempt1.json` (`e2658ca6ca2e9afc53a3644e0c6d7c75717bdb806ec969c9e65b6cf7a5bb7671`). `regression-first-attempt.json` is `1f599e01c97f98a6f9017e7a3227ee2ece767fbdff0389b653ace30e7a8dd5fc`.

The recorded corrections archive the stale M6 cache and start the M8 aging fixture; both are fixture/environment repairs. The final `regression-results.json` reports exit 0 and pass for all seven suites, M1–M6 and M8, and is SHA-256 `0999b9f073feae19918c162e8312bf3f8805ef62fba02237db369eb038b69e57`. The run repeats all seven once more inside the final M7 suite and records them green. The initial `regression-first-attempt.json` still names generic receipt paths that were later overwritten by final receipts; the separately named `*-attempt1.json` files are the durable failure evidence. Suite-source identity against the pre-M7 lane is outside this audit and belongs to the separate source-delta record.

## Native scope and elapsed time

The final native artifact is Hermes bytecode version 98, 2,794,166 bytes, SHA-256 `7095e4ca67db544231ae9a0a2a457c7d6d8159d5cccb9df7c60d0a9b122ebb4`. The evidence is an iOS export/build artifact. No simulator launch, offline native execution, or native runtime assertion is claimed, and M7's frozen assertions contain no native-artifact executor.

The external lifecycle receipt is the controlling wall clock: start `2026-09-14T07:58:39Z`, end `2026-09-14T08:21:04Z`, `1,345.403` seconds, exit 0. The builder's internal report records 1,304 seconds from its own later start through report close, excluding 41.403 seconds of wrapper/session overhead. The external wall remains within the 14,400-second cap.

The prior Snapback 4 Astra M7 artifact on package 0.1.0 was a builder-reported capability failure after 1,386 seconds because M1 regression failed; polls, counts, migration, and choreography had passed. The current 0.2.6 builder phase is 40.597 seconds shorter by the external current wall and reports all seven regression suites green. This is contextual: product versions differ, the prior wall has integer report-clock precision, and neither M7 outcome received a second independent grade. The retained instrument inventory says the September 12 and current instruments are byte-identical.

## Evidence identities

| Evidence | SHA-256 |
|---|---|
| `instrument/social-messenger.md` | `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6` |
| `instrument/schema/social-messenger/assertions.json` | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| `instrument/CONTRACT.md` | `ecb7b0a706703c271f67be81d1899414bfb50c79f85d5b03a585c76ca02085be` |
| `instrument/choreography/README.md` | `c724e6b432ee8d2420f1e64b91f7412f2406671f9ad1e888dd28af6df5dc7847` |
| `instrument/choreography/receipts-format.md` | `1c247f0d7dc0edc84f2138bde37b1be39c01b3d3fe1247da1fbc0efef3e32b4d` |
| Packet `README.md` | `192cb9705e171289b96829a3930ae43132a23a6bf24138003625ff5a6ee4a0b4` |
| `scripts/run_phase.py` | `a3b3658347f61ee57b9cf13a557fafe4edb9baf385fa59d29e620a1802247b69` |
| `scripts/render.py` | `68219e35995a1c19cc1ecae7374c08f6b83b8396c8eb23ca9a49bb7892d964b1` |
| `prompts/grade.template.md` | `2021a6292d3f4b9a4313d5daf1af27fbe129f6a0978334a21c9de8e619adb88a` |
| `prompts/m7.template.md` | `af72982e03b62771e774d98c0b2e6c5eb0fad8baaed1ccb97e4905311405f712` |
| `instrument/ENVIRONMENT.md` | `3901fe5eed52bc8d9f4cbeea91d9ae26772ab6221f42ae900e81c0a64ccfba34` |
| `prompts/astra-snapback4.m7.md` | `5e5e88b47953d956101646a5c1ea69a0108b0d734b374ea0a997df1de2df0883` |
| `logs/astra-snapback4.m7.start.json` | `bfae707f3eac09b7e22c6d5dd68e91059230efcebecc29b9d0ed02764fff2ae2` |
| `logs/astra-snapback4.m7.end.json` | `8200eaed3e5b64b91c6ccaf241a5df8ff6a2ae34686645c9dd9a895f8de33e79` |
| `m7/pre-snapshot/manifest.json` | `ae6069d9622043ea00ae69acf5f4f05441f9d23a4e9f3b633834c9c339090259` |
| `m7/post-snapshot/manifest.json` | `b1295d63f9015e88690b20ea7def0e6f499125229e6513e05850c8587f6267a3` |
| `m7/final-report.json` | `afd9d85c57d63bad492747d838b93e30bfdd197a8faf17cb866bc7ecd662d5c0` |
| Prior `m7-astra-snapback4.md` | `c74b7853cdb4483290d3d589bfbff43499d679ec6fae20257e20358c6dd7e739` |
| Prior `m7-grok-snapback2.md` | `c4aaf4df9214bc6391c214e440a013e2b0dc844408f76f6a204aeec7adb11799` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0004/prior-results.json` | `68902e4a760fa7ffd2b32a37d0399955db5d5e6ec5240d9fcf737f238423f2ae` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0004/instrument-comparison.json` | `8b0aaab1e96aa4643ad1a9cc8fa73e38452e7c43704093a9df0043851a54ba06` |
