# Muse M7 snapshot replacement — provisional custody audit

Observed 2026-09-14 while Muse M7 remained active. Scope is limited to the immutable observer captures `muse-m7-presnapshot-prefix`, `muse-m7-first-migration-prefix`, and `muse-m7-replacement-snapshot-prefix`. No canonical Muse lane, raw CLI stream, implementation source, or other live input was read. This note makes no final M7 or assertion verdict and performs no repair, test, probe, rerun, or steering.

## Custody sequence

| Capture | Captured epoch | Captured payload | Capture receipt SHA-256 |
|---|---:|---|---|
| Original pre-snapshot prefix | `1789376570.0824919` | run log plus eight persona JSON files and snapshot manifest | `c13907bf2588699a4436a6a9039eb631ab048919172dbe73875cb38567236de1` |
| First-migration prefix | `1789376762.7354171` | run log plus the then-current eight persona JSON files and snapshot manifest | `985a14600090fd9841505f4601a9e1a8d8e37e4bd1cdd8eb640862088bd50afa` |
| Replacement-snapshot prefix | `1789376877.5612931` | run log plus the replacement eight persona JSON files and snapshot manifest | `942d1ca4f9bde3f8d00cf347685797b3ecaa1724ab86b9a7657be062bdc76b48` |

The original run-log prefix records the initial snapshot completed at epoch `1789376501`. Its snapshot manifest records export time `1789376469144` ms and is SHA-256 `9f2061832810e0c9f87f4d73f4ecbee5c33e0524d6871977323f175e9f0104da`.

The first-migration run-log prefix adds a claimed first comparison at `1789376692`: `checked=48`, `diffs=0`. The same entry announces that a probe poll left residue in the starter group and chooses a store wipe and fresh reseed. It then records the restarted backend at `1789376731`. The snapshot manifest captured in this prefix has export time `1789376740002` ms, after that restart, and SHA-256 `9c3255b78410b2b236aed481fd0a31edfb388617ea19367ada4904ff306d4d99`.

The first-migration and replacement captures contain byte-identical copies of all ten captured payload files, including the run log. Their capture receipts differ because their capture times and roles differ. Thus the first-migration capture already holds the replacement snapshot; it does not freeze the original pre-snapshot or first comparison's post-migration payload.

## Original-to-replacement differences

All eight persona JSON files and the snapshot manifest differ between the original and replacement captures. The run log also differs because the later copy adds the schema, comparison, wipe, and restart events. File byte lengths remain the same for every persona JSON and the manifest.

The two persona sets have identical structure and row cardinality:

| Measure | Original | Replacement |
|---|---:|---:|
| Persona files | 8 | 8 |
| Persona-visible chat projections | 5 | 5 |
| Persona-visible message projections | 39 | 39 |
| Unique message IDs | 15 | 15 |
| Asset projections | 9 | 9 |
| Unique asset IDs | 3 | 3 |
| Direct profile-avatar references | 8 | 8 |
| Populated message-media references | 0 | 0 |

An ordinal structural comparison found no array-length changes, scalar-type changes, or ordinary schema-key additions/removals. The asset dictionaries changed their identity-derived keys, which accounts for nine removed and nine added projected map keys.

The changed scalar classes across the eight persona projections are:

- Identity and reference fields: 143 `id`, 83 `principal`, 39 `authorId`, and 15 `createdBy` occurrences changed. These are projection occurrences, so repeated embedded identities count repeatedly. Membership/profile IDs, principals, author references, and profile-avatar IDs were regenerated. Stable fixture chat IDs and all 15 unique message IDs remained unchanged.
- Time fields: 54 `at`, 23 `joinedAt`, and eight persona-level `exportedAt` occurrences changed. The replacement manifest has its own later `exportedAt` and eight replacement persona-file digests.
- Counts and rows: all list lengths and the observed `count` values stayed unchanged. The chat/message/asset projection totals in the table above are identical.
- Content and state: message bodies, captions, kinds, edit/expiry/tombstone/reply state, profile text, chat metadata, roles, and asset status did not change in the structural comparison.
- Media references and bytes: all eight direct profile-avatar IDs changed, as did their repeated embedded references. The nine projected asset map entries moved to replacement IDs, representing three unique asset IDs. Their byte-length, SHA-256, and status multisets are exactly equal across the original and replacement captures. No starter message has a populated photo, view-once photo, clip, or poster reference, so message-media preservation is structurally empty in this corpus.

The complete per-file hashes are embedded in the three capture receipts. Representative custody hashes are:

| Payload | Original SHA-256 | First-migration / replacement SHA-256 |
|---|---|---|
| `run-log.md` | `5dd2a3a50240524fd9057849d4a39d456aa191dd0b815942398a8d48c6fb5865` | `c9640d8a1f2253351b9df1981a538cca2820a9de75b41896c2d8658f4682cc48` |
| `pre-snapshot/manifest.json` | `9f2061832810e0c9f87f4d73f4ecbee5c33e0524d6871977323f175e9f0104da` | `9c3255b78410b2b236aed481fd0a31edfb388617ea19367ada4904ff306d4d99` |

## What the captures establish

The original pre-snapshot capture preserves the initial baseline before the recorded schema check and comparison. The later run-log copy records a first migration comparison of 48 checks with zero differences. That is contemporaneous narrative evidence that the original comparison completed before the wipe decision.

The immutable artifacts do not retain the post-migration persona payloads or comparison result behind that 48-check claim. By the time the first-migration observer capture ran, the pre-snapshot path had already been replaced after the wipe/reseed. Consequently, the original-to-first-migration comparison cannot be independently recomputed from these captures.

The replacement capture establishes a stable second baseline: its ten payload files are byte-identical to the earlier first-migration capture taken after restart. A later comparison against that replacement can show that the reseeded replacement state survived subsequent changes. It cannot by itself prove that the original state survived the first migration, because the reference side changed after the probe residue and store reset.

Any final M7 assessment must keep those claims separate: the captured first-comparison log line is evidence about the original migration, while the replacement bytes govern only comparisons begun after the reset. This provisional note does not inspect or anticipate later Muse outputs.
