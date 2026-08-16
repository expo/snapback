# LLP 0225 slice: repoint the rqs re-export consumers at the contract leaf

**Opened:** 2026-08-11 · **Status:** CLOSED 2026-08-11 — landed with this
ticket · **Area:** core modularization / ownership ratchet (LLP 0225 §2, §4
continuing item 2 — "contract leaf completion"; LLP 0199 worklist item 2
residue)

## Outcome

**16 frozen forbidden edges removed, none added — 365 → 349.** Zero waivers,
zero `ownership.manifest.json` edits. Every removed fingerprint is a
`… → src/rqs.rs (sync-realtime-engine)` edge from the table below; the
matching `→ src/rqs_contract.rs` leaf edge already existed in the baseline for
each one.

Characterization envelope, all green:

- `cargo test --lib {storage,auth,server}` with `RUST_MIN_STACK=33554432`:
  failure **name sets byte-identical** to the merge-base, and identical pass
  counts (438/0, 689/2, 286/3 — the 5 failures are pre-existing main reds).
- Cross-language digest parity, which pins the moved bytes on both arms:
  `cargo test --test rqs_digest_parity_v0` 5/0 and
  `node --test packages/snapback-client/rqs-digest-parity.test.mjs` 6/0.
- `./ref-check --verbose` clean; ownership gate PASS with 0 new allowed
  edges, 0 stale baseline, and only the 2 pre-existing inherited-outstanding
  jobs edges.

## The finding

`src/rqs_contract.rs` is the leaf that worklist item 2 created, and `jcs`,
`sha256_identity`, and `MintRefusal` **already live there** — `src/rqs.rs`
only re-exports them:

```rust
pub use crate::rqs_contract::{MintRefusal, jcs, sha256_identity};
```

The ownership analyzer records **both** edges for a re-exported symbol: the
written module path (`→ src/rqs.rs`, sync-realtime-engine) and the resolved
re-export target (`→ src/rqs_contract.rs`, the leaf). Every consumer below
therefore already carries the allowed leaf edge *and* a forbidden upward edge
to the sync engine that buys nothing — the dependency is on the leaf, exactly
as `rqs_contract.rs`'s own module doc says ("kernel and contract callers depend
directly on this leaf").

Sixteen frozen forbidden edges are held open by that written-path indirection:

| owner | module | rqs symbols used |
| --- | --- | --- |
| shared-contract-types-leaf | `src/api_envelope.rs` | `jcs` |
| shared-contract-types-leaf | `src/manifest.rs` | `jcs`, `sha256_identity`, `DigestKind` |
| generation-activation-coordinator | `src/bundle.rs` | `jcs` |
| generation-activation-coordinator | `src/completeness.rs` | `jcs` |
| generation-activation-coordinator | `src/deploy.rs` | `jcs` |
| generation-activation-coordinator | `src/seed_identity.rs` | `jcs` |
| background-services | `src/ask.rs` | `jcs` |
| background-services | `src/assets_cut.rs` | `jcs` |
| storage-migration-kernel | `src/migration.rs` | `jcs` |
| storage-migration-kernel | `src/operation_ledger.rs` | `jcs` |
| storage-migration-kernel | `src/proof_checkpoint.rs` | `jcs` |
| storage-migration-kernel | `src/storage.rs` | `jcs` |
| storage-migration-kernel | `src/storage/migration_executor.rs` | `jcs`, `sha256_identity`, `ContentDigest*`, `MintRefusal` |
| storage-migration-kernel | `src/storage/migration_scan.rs` | `ContentDigest*` |
| storage-migration-kernel | `src/storage/projection_rebuild.rs` | `jcs`, `sha256_identity`, `projection_row_digest`, `seq1_digest` |
| storage-migration-kernel | `src/store_state.rs` | `RESUME_KEYRING_FILE_NAME` |

## The slice

Two tiers, one landing:

1. **Repoint** (zero code motion): every written `crate::rqs::{jcs,
   sha256_identity, MintRefusal}` inside the crate becomes
   `crate::rqs_contract::…`. `src/rqs.rs` keeps its `pub use` for the public
   surface. This alone clears eleven of the sixteen.
2. **Complete the leaf**: move the remaining *pure* digest/canonicalization
   primitives — the `ContentDigest*` family with its `ResumableSha256` /
   frame helpers and `CONTENT_DIGEST_*` domains, `seq1_digest`,
   `projection_row_digest`, `row_hash`, `leaf`, `MsetState`, `DigestKind`,
   `args_hash`, `query_artifact_hash`, and `RESUME_KEYRING_FILE_NAME` — down
   to `src/rqs_contract.rs`, re-exported from `rqs.rs`. Each is a pure
   function over `serde_json::Value` and `sha2`/`serde`/`base64`; none
   touches crate-internal non-leaf state. This clears the remaining five.

Charter grounds (LLP 0225 §1): RFC 8785 canonicalization, content-digest
framing, and identity hashes are byte-exact **language-neutral wire/value
contracts** shared with the JS arm (`packages/snapback-client/rqs.mjs`,
parity corpus `tests/fixtures/rqs-parity-v1.json`) — the leaf's charter
verbatim. What stays in `src/rqs.rs` is the resumable-query *engine*: the
token envelope, MAC transcript, keyring custody, and cursor mint/verify, all
of which need `crate::auth::crypto`.

## Destination pre-check (LLP 0225 §2 monotonic-baseline rule)

`src/rqs_contract.rs` is already leaf-owned and every unassigned consumer
(`src/local.rs`, `src/local/tests.rs`) **already** carries an edge to it, so
no `unassigned → leaf` edge is created. No `ownership.manifest.json`
assignment, direction, or `allowedDependencies` change is required, and the
slice takes **no waiver**: it only removes frozen forbidden fingerprints and
adds allowed downward edges.

No file is renamed or created, so §6's co-migration obligations are not
triggered; no proof selector, drift gate, or source-reading generator is
keyed to a path this slice moves.

## What actually moved

Tier 1 repointed the written paths for `jcs` / `sha256_identity` /
`MintRefusal`. Tier 2 moved the pure digest/canonicalization primitives down —
the `ContentDigest*` family with `ResumableSha256`, `digest_frame`, and the
`CONTENT_DIGEST_*` domains; `row_hash`, `leaf`, `row_wire_id`, `MsetState`,
`seq1_digest`, `DigestKind`, `args_hash`, `query_artifact_hash`,
`projection_row_digest`; their shared `sha256_tagged` / `hex` helpers and tag
constants; and `RESUME_KEYRING_FILE_NAME`. `src/rqs.rs` re-exports all of it.

`src/rqs_contract.rs` now contains **zero `crate::` references** — it is
genuinely dependency-free within the crate, which is what the leaf charter
asks for.

What deliberately stayed in `src/rqs.rs`, because each needs
`crate::auth::crypto` or a non-leaf dependency: the token envelope, MAC
transcript, keyring custody, the relational / standard-pattern cursor mint and
verify families, and the `content_digest_artifact()` /
`relational_result_encoding_artifact()` schema-artifact generators (which now
consume the moved leaf types). That residue is the resumable-query *engine* —
the thing the sync owner should own.

## Two edges that did not clear, and why

`src/local.rs`, `src/local/tests.rs`, `src/instance_fork.rs`,
`src/schema_export.rs`, and `src/storage/tests.rs` keep their `→ src/rqs.rs`
edges: each also imports engine symbols (`ResumeKeyring`, `mint_token_wire`,
`decode_and_verify`, the cursor families, `relational_result_encoding_v1`,
`relational_result_encoding_artifact`) that correctly stay in the sync engine.
Those clear when the engine's consumers are drained, not by a shape move.

## Resolution — 2026-08-15 (backlog sweep)

This ticket already recorded **CLOSED 2026-08-11** in its body (365 → 349
frozen edges; consumers repointed at `src/rqs_contract.rs`) but was never
moved out of the open directory. Remaining `→ rqs.rs` edges are
engine-symbol consumers, which this slice explicitly left behind. Close the
still-open copy.
