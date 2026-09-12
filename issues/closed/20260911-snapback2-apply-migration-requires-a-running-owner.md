# Snapback 2 `dev --apply-migration` requires an already-running owner

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/owner.rs` (`DevOptions::run`), `watch.rs` (pasted `applyCommand`)
**Source:** Snapback 2 codebase review 2026-09-11; Clique `E_OWNER_NOT_RUNNING` on the documented repair
**Related:** LLP 1020 A6; closed `20260906-snapback2-guide-gaps-from-the-clique-run.md` items 15–16 (help + pasted command, **not** this start/apply sequencing)

## Symptom

`snapback2 dev --apply-migration <file>` is the repair the watcher pastes on `E_SUCCESSOR_DESTRUCTIVE`. `DevOptions::run` handles that flag **before** `probe_owner` / `foreground` / `detach`: it reads the JSON and `return`s `control_command(..., "POST", "/control/migrate", ...)`. `require_owner` / `control_command` refuse `E_OWNER_NOT_RUNNING` when nothing is listening.

The flag sits on the start verb but never starts an owner. If the owner that wrote `.snapback/migration-<gen>.json` has exited, the documented sequence cannot apply the plan. Starting a new owner recompiles current sources and may write a different plan. This is not a silent drop — it is a stuck destructive repair.

Closed guide-gap work made the pasted command discoverable. It did not make the command start an owner.

## Evidence

```75:92:snapback2/crates/snapback2/src/owner.rs
    if let Some(path) = &options.apply_migration {
        let value: Json = match fs::read(path) ...
        };
        return control_command(&root, "POST", "/control/migrate", value, options.json);
    }
    match probe_owner(&root) {
```

## Proposed

Preferred: if no owner is active, start one (same path as bare `snapback2 dev`), wait until `/control/status` is ready, then POST `/control/migrate`. `--stop`/`--status` stay control-only.

Minimum if start-then-apply is too much for one landing: when `probe_owner` is `Missing`, refuse with a rewrite that names the two-step sequence (`snapback2 dev` then `snapback2 dev --apply-migration <file>`) instead of a generic `E_OWNER_NOT_RUNNING`. Also change the watcher’s `applyCommand` paste to that two-step form. This is strictly worse UX than start-then-apply.

Sketch for the preferred path (structure, not a drop-in):

```rust
    if let Some(path) = &options.apply_migration {
        let value = read_migration_file(path, options.json)?;
        match probe_owner(&root) {
            OwnerProbe::Active(_) => {
                return control_command(&root, "POST", "/control/migrate", value, options.json);
            }
            OwnerProbe::Missing | OwnerProbe::Running(_) => {
                // fall through to start, then POST migrate once Active
                options.apply_after_start = Some(value);
            }
        }
    }
```

Thread `apply_after_start` through `foreground` / detach ready: after the server is bound and the owner file is written, POST `/control/migrate` on the loopback secret. A migrate refusal must not leave a running owner on a generation the operator did not accept — either exit the owner or leave it on the prior generation and print the refusal. Prior generation is the safer default.

## Acceptance

- With no owner running and a saved `.snapback/migration-<gen>.json` that still matches the store, `snapback2 dev --apply-migration <file>` applies the plan (preferred) **or** refuses with a rewrite that names a working two-step sequence (minimum).
- The owner-migration test that currently assumes a running owner still passes.
- A new test: stop the owner, keep the migration file, run the pasted command; it must not be a dead `E_OWNER_NOT_RUNNING` with no next step.

## Resolution (2026-09-12)

The saved command now starts a stopped owner and applies its reviewed migration before readiness. Saved plans bind the originating and successor generations. Startup certifies the saved project, requires it to match current authored sources, and recomputes the destructive delta against the installed store. Mismatches refuse before mutation. Drops, additive backfill, and generation metadata commit atomically; failures roll back. An active owner retains the existing control path. Older plans without an originating generation refuse with instructions to regenerate a bound plan.

Validation: integrated core successor suite passed 21 tests, including wrong-store and wrong-plan rejection plus rollback after a later backfill failure. Integrated owner checks passed 11/11 in 32.46s, including `saved_migration_starts_a_stopped_owner_and_refuses_mismatched_sources`, `chat_owner_wire_sse_channels_and_successors`, and the successful hot-apply coverage. The CLI test saves a plan, stops the owner, refuses changed sources, restores the reviewed sources, and starts/applies successfully.
