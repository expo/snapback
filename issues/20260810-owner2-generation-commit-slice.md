# Owner-#2 slice claim: factor the generation-commit kernel primitive, narrow the coordinator's LocalDatabase surface

**Opened:** 2026-08-10
**Lane claim:** CLAIMED 2026-08-10 by the 0199/0225 execution session (this
ticket is the claim; first-claim-wins per the 2026-08-10 ownership-gate
arbitration precedent). Scope below; coordinate here before overlapping.

**Governing record:** LLP 0225 §4 item 1 (kernel typed-operation slices) +
§3.1 (the kernel owns the only commit primitive; callers receive typed
operations, not a wide `LocalDatabase` surface).

## Scope

One boundary, one landing:

1. Extract the composite generation-commit primitive family from
   `src/storage.rs` into a dedicated kernel module
   `src/storage/generation_commit.rs` (owner: `storage-migration-kernel`):
   `CommitFunctionGeneration`, `FunctionGenerationRecord`,
   `commit_function_generation`, `function_generation_record`,
   `install_committed_sequence_declarations`, and their private
   sequence-predecessor helper.
2. Introduce the narrow typed kernel surface the activation coordinator
   composes — `GenerationCommitOps<'_>` — exposing exactly the operations
   owner #1 uses (composite commit, classified same-mode deployment commit,
   committed sequence install, stream-transcript manifest activation,
   stale-projection materialization, schema read). Delete
   `LocalSnapback::generation_database_mut` (the wide `&mut LocalDatabase`
   accessor) and convert `src/generation_activation.rs` to the typed surface.
3. Manifest: assign the new module to `storage-migration-kernel`
   (routine assignment-at-landing; no direction change, no baseline growth
   expected — relocated edges are kernel-internal or kernel→leaf).

Explicitly NOT in scope (other lanes / later slices): the ownership-gate
analyzer hardening (claimed, owngate-20260810); worklist items 1–3 edge
inversions in code this slice does not touch; the `*_in_tx` jobs relocation;
owner #5 / the asset-prepare follow-up.

## Resolution

(pending)
