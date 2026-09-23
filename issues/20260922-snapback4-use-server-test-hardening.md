# Snapback 4: use-server follow-up test hardening

**Status:** Open
**Date:** 2026-09-22
**Scope:** Snapback 4 tests and docs for the `use server` gate (LLP 3000.009.000). This is test and wording polish; there is no known product defect.
**Source:** Grok 4.7 xhigh delta review of the use-server fix round (`f80700e4e7`, landed as `a2bba67c6`). Astra xhigh found that fix round READY with no findings. Grok judged the gate's code correct (packets 1 and 2 READY) and asked for the hardening below.

The gate landed in `2b686cfef` and `a2bba67c6`. The items that remain:

1. **`tests/server_opt_in.rs`, the seated job schedule.**
   - The opted-in compile keeps the same `E_SCHEDULE` (code, message, site,
     guide, and a rewrite that is not `use server`) and drops the schedule.
   - The effect and the job survive.
   - The unseated program plus `use server` compiles with `server == true`,
     and its schema is identical to the no-directive program.
2. **The same file, the `E_OIDC_*` loop.** Materialize the filtered codes and
   assert they equal the explicit ten-code set, so an empty filter cannot pass
   vacuously.
3. **`tests/guide.rs`, the language card.**
   - Pin `action_specs` exactly, and each schedule's target, instead of a
     length.
   - Name the queued action if the engine reports it.
   - Fix the stale comment about `everyNight`.
   - Compare route keys as a set.
4. **`periphery.test.mjs`, `assertCoreTree`.**
   - Recurse only through real directories, and skip dependency and build
     trees.
   - Do not ban the bare substring `invite`.
   - Check every `.q` file for `use server`, `action`, `route` and
     action-naming schedules, while allowing job schedules.
5. **`generated-effect-opt-in.test.mjs`.**
   - The mismatch mode returns a well-formed digest that differs.
   - Assert that no completion or failure occurs, and allow the park
     protocol's release or nack.
   - Assert that the refusal is present, rather than that it is the only
     error after `stop.abort()`.
6. **Docs.**
   - The README's "(no directive)" label also covers action-naming schedules,
     which do need the directive; qualify it, and name those schedules on the
     server row.
   - The services card writes the day clamp as "1 to 3650", and links the
     exact `SERVER.md` heading.
