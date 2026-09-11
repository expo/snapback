# snapback2: `reset` does not clear the template's static seed rows, and `dev`/`reset` have no `--help`

**Status:** Open — reset/help/fixture handles resolved; parallel fresh-instance guide recipe remains

**Date:** 2026-09-07 · **Area:** snapback2 CLI / chat template · **Source:** Clique full run, muse-snapback2 lane (diary M1), grok-snapback2 (M1: dev seed personas occupy fixture handles)

- `snapback2 reset` did not clear the chat template's static seed rows; only deleting
  `store.sqlite` gave a fresh store. The builder called the dev/reset lifecycle "undiscovered
  (no --help; reset's actual effect unclear)" and there is "no documented fresh-instance story"
  (it used separate project directories for the scale replay).
- The template's dev personas occupy handles the fixture pack uses (`alice`), blocking real
  signup until renamed (grok M1).
- `snapback2 reset` semantics matter more than they look: the owner is the unit of isolation, the
  asset staging ceiling is per owner, and a reset that leaves rows behind makes "fresh" ambiguous.

## Proposed

1. `reset` clears everything the owner holds, including template seeds and staged assets, or
   documents exactly what it keeps; `--help` on every verb.
2. A fresh-instance recipe on the guide's dev-loop page (second project directory, or a
   `--store` flag) for scale replays and parallel proofs.
3. Namespace the template's dev personas so they cannot collide with an app's real handles.

## Reconciliation — 2026-09-11

**Priority:** P3 (remaining guide gap).

LLP 1021 §6 chose explicit dual semantics: `reset` clears application state and
reapplies the seed while reporting seed row/persona counts; `reset --empty` skips the
seed and remains empty after restart. `verbs.rs` now provides help for both lifecycle
verbs, and the chat fixtures use `alice_dev` / `bob_dev`, leaving `alice` available to
a real signup. The operator, testing, and persona guides document those choices.

Fresh BLACK verification at `15c134d056` (all exit 0):

```text
cargo test -p snapback2 --test owner reset_reports_seed_and_empty_survives_restart_with_schedules -- --nocapture
# 1 passed; 100 filtered out; 5.18s
cargo test -p snapback2 --test guide help_is_successful_without_a_project_or_compiler_and_has_no_side_effects -- --exact --nocapture
# 1 passed; 13 filtered out; 1.70s
cargo test -p snapback2 --test owner seeded_chat_leaves_alice_for_a_real_signup_and_charlie_without_a_profile -- --nocapture
# 1 passed; 100 filtered out; 2.73s
```

The separate bug where a reset refusal can remove physical staging bytes before later
seed validation is tracked in `20260906-snapback2-asset-custody-gc-follow-up.md` and is
not part of the resolved lifecycle-surface work.

Review correction: this ticket remains open only for proposed item 2. The testing
card documents an isolated owner per journey run, but the guide does not yet give
the requested separate-project/instance recipe for parallel app/scale replays.
`reset --empty` is not that recipe. Add the guide recipe using the supported
isolation mechanism; no new `--store` flag or reset semantics are commissioned here.
