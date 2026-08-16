# Raw-dev activation: transcript catalog commits outside the atomic cut; reopen does not consume the generation record

**Status:** Closed
**Date:** 2026-08-10
**Systems:** Storage kernel, Generation activation
**Source:** LLP 0225 super-refine round 2, gpt-5 family review
(`llp/reviews/0225-core-modularization.gpt-5.md`), verified against code.

Two code-level findings against LLP 0199/0225's atomic-transition and
recovery contracts:

1. **Split cut.** In raw-dev activation, `commit_function_generation` commits
   first and `activate_stream_transcript_manifest` then opens and commits a
   *separate* SQLite transaction (`src/generation_activation.rs:92`,
   `src/storage/stream_transcripts.rs:151`); failure of the second returns
   before the in-memory successor installs, so a generation record, pins, and
   enrollments can be durable while transcript capability activation failed.
   The complete-pair lane already performs this activation inside its
   composite transaction (`src/storage/auth_mode.rs:1357`). Fix direction:
   fold transcript catalog activation into `CommitFunctionGeneration` to
   match; if it provably cannot share the transaction, record it as a §3
   exception with recovery, retry, and injected-failure tests.
2. **Reopen inertness.** `LocalSnapback::from_database` initializes
   `FunctionManifest::default()` / `functions_loaded = false` and does not
   consume `FunctionGenerationRecord` (`src/local.rs:19887,19950`); the
   record accessor is dead-code-allowed and the reopen proof operates on
   `LocalDatabase` directly (`src/storage/tests.rs:3332`). The
   record-as-recovery-authority contract needs either verified artifact
   reload against the record on open (with a full `LocalSnapback::open`
   test) or a documented inert-until-reload contract. LLP 0225 (d) states
   the contract and points here.

Owner: storage-migration-kernel / generation-activation-coordinator slices
(LLP 0225 §4 worklist).

## Resolution — 2026-08-15

Both findings are discharged.

1. `commit_function_generation` now activates the stream-transcript catalog
   inside its immediate transaction, with the schema `ask_manifest()` and
   function-manifest union preserved. The coordinator no longer performs a
   post-commit activation or synthesizes an `AwaitingReload` fence for that
   now-unreachable split outcome. A malformed-catalog injection proves that
   transcript DDL, projection pins, sequence enrollment, and the generation
   record roll back together; repair plus retry commits exactly generation
   high-water 1. Exact reopen rehydration validates the catalog before
   resolving its pre-existing fence, so legacy split state cannot be silently
   admitted.
2. Revision (p) of LLP 0225 already discharged reopen inertness with the
   file-backed `LocalSnapback` inert-until-verified-reload acceptance suite.

Closed at base lineage `245f23518a49e54c10a8c3bf3ef5906b38acf4f8` by
LLP 0225 revision (u).
