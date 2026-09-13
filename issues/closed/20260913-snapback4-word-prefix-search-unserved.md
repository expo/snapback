# Snapback 4: word-prefix indexes are parsed and refused; Clique search cannot run

Status: Closed
Priority: P2
Date: 2026-09-13
Systems: schema validate, interpreter scans, package README
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: LLP 3000 §2 (keep the word-prefix index), bakeoff hub gate (“first offline thread **and search**”), README “Not in this release”

## Problem and reproduction

`by tokens(body)` / `WordPrefixes` parse. `core::validate` issues “word-prefix indexes are not in this slice”. A scan with `IndexKeyExpr::WordPrefix` is `RuntimeError::Schema`. The corpus skips those cases. The chat schema has no search query.

The bakeoff protocol’s hub acquisition gate is “full durable content plus first offline thread and search.” The package README already names this as out of release. Unlike `effect`/`emit` (which compile and silently no-op), search at least diagnoses — but the Clique brief still cannot be completed on this substrate without it.

## Implementation locations

- [snapback4/crates/snapback4-core/src/schema.rs](../../snapback4/crates/snapback4-core/src/schema.rs)
- [snapback4/crates/snapback4-core/src/engine/read.rs](../../snapback4/crates/snapback4-core/src/engine/read.rs)
- [snapback4/packages/snapback4/README.md](../../snapback4/packages/snapback4/README.md) §8

## Suggestion

Either implement prefix scans over synced rows on the device (the kept Snapback 2 form), or record an explicit bakeoff exclusion so the hub gate is not scored as if search existed.

## Resolution — 2026-09-13

Word-prefix indexing and search landed before this repair in
`1f5b8a6acf8364719ca2a80f07d6c258265dbe7d`: the binder selects `words(..)`
indexes for `matching`, the core store writes prefix entries, and the shared
Rust interpreter filters additional terms. The TypeScript twin cited here was
subsequently retired. The device regression in
[device.rs](../../snapback4/crates/snapback4-device/tests/device.rs) executes a
prefix search over synced rows on both SQLite and memory hosts and returns a
local page. The existing Clique search scenario remains covered; all 17 device
tests pass. Additional evidence: `b19a89631`.
