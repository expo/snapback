# Snapback 4: lane DG review nits (worker paths and quoted-message docs)

**Status:** Open
**Date:** 2026-10-04
**Systems:** Snapback 4 guide, worker documentation
**Related:** lane DG (`snapback4/reports/20261004-dg-cal30-doc-gaps/REPORT.md`), LLP 3000.009

Grok's round-0 review of lane DG was READY, with three nits, none blocking:

1. **`guide effects` is slightly looser than the worker reference.** The card
   says `SNAPBACK_PROJECT_DIR` is the initial `process.cwd()` and that
   "relative filesystem paths use that cwd". After a child `chdir`, relative
   paths follow the new directory while the variable stays fixed, as
   `CLIENT-AND-OPERATIONS.md` says. Tighten the card: relative paths follow the
   current cwd, so write through `SNAPBACK_PROJECT_DIR`.
2. **`guide client` points at the recipe in prose.** The line
   `` `guide social`: quoted-message point reads distinguish loading/absence/denial ``
   is not a link or command; consider naming the `QuotedMessage` component.
3. **DG's report cites the wrong line.** Its execution table gives
   `worker_process.rs:49` for the watchdog's process-group lifetime. The group
   is `isolate()` at `worker_process.rs:12` and the spawn in `worker_spawn.rs`.
   The behavior is right, and the citation is only in the report, not the
   published guide.
