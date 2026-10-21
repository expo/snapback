# snapback4: Postgres activation does not re-verify ledger shape after a clean open

**Opened:** 2026-10-21 · **Area:** `snapback4-core/src/engine/postgres/release.rs` (`activate_release`), `activation.rs` (`publish_backend`) · **Severity:** low (needs catalog DDL by the store's owner after a successful open)

The shared ledger verifier (`engine/postgres/ledger_schema.rs`) runs at open and attach, so a `_backend` trigger present at open is refused. `activate_release` writes `_backend`, `_generations` and `_meta` without re-running it. A `BEFORE UPDATE ... RETURN OLD` trigger installed by another session *after* a clean open makes activation of release 2 return `Ok(2)` while `_backend` keeps generation 1; after the trigger is dropped, reopening at release 2 runs release 1's program at generation 1 (reproduced by the P1-RL fix-round verification review, Grok, 2026-10-21, schema `sb4_eval_grok_trig_act`).

Fix direction: run `verify_core` (or the relevant subset) inside the activation transaction before the `_backend` write, under the head fence, and/or check the `_backend` update's row image (`RETURNING generation`) equals what was written. Witness: install the trigger between open and activation; activation must refuse with `SNAPBACK_ACTIVATION_SCHEMA`.
