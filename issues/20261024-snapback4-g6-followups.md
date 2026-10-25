# Snapback 4 G6 follow-ups: settings parsing, mixed writers, default posture, write-mix misses

**Status:** Open
**Opened:** 2026-10-24
**Area:** `crates/snapback4/src/store_config.rs`, `engine/postgres/read_grant.rs`, `engine/revision_cache.rs`
**Related:** LLP 3000.009.001.000.002 §4.1–§4.5, §6 G6; `snapback4/reports/20261024-g6/REPORT.md`

From the G6 blind review (Sol APPROVE WITH NITS, Grok APPROVE) and the G6 report.

1. **Resolved — non-UTF-8 setting (Sol, Low; FF2 2026-10-24).** `store_config.rs` (~203) treats
   `VarError::NotUnicode` for `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS` as unset and
   starts on G5 instead of refusing startup. Fails safe; handle `NotPresent`
   separately and refuse other errors.
2. **Writers that ignore the grant.** Nothing forces an old binary or a direct
   SQL writer to honor `_read_grant`; e.g. a session deleted by SQL leaves
   cached authority reusable until the next local publication. The deploy
   guide's all-writers requirement is the only guard. Consider a durable
   grant-aware marker that pre-G6 writers refuse, and a doctor check.
3. **Resolved — default posture (FF3 panel disposition, 2026-10-25).** G6
   stays opt-in via `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`;
   `ha=none` alone is insufficient. Serve/doctor expose the tier and safe-use
   conditions (single owner, every writer grant-aware, declared database-clock
   bound, no VM pause/migration longer than the lease). Revisit default-on only
   after (1) the roughly one-second G6 stall is explained, (2) G5-versus-G6
   write cost is measured, (3) a durable marker makes pre-G6 binaries refuse a
   grant-enabled store, and (4) Snapback witnesses the clock contract rather
   than assuming it. LLP 3000.009.001.000.002 §4.2/§6 and the deploy guide record
   the decision. These four prerequisites remain future work.
4. **Write-mix false misses.** Revision equality misses every entry after
   any commit: a 1 % write stream gives 92.3 % misses and 5.1k reads/s.
   Cross-revision promotion with footprints (§4.1) is the designed remedy.


## FF2 resolution of item 1 — 2026-10-24

Startup distinguishes `VarError::NotPresent` from `NotUnicode` for
`SNAPBACK4_READ_GRANT_CLOCK_BOUNDS`. Only absence selects the default;
non-UTF-8 returns E_STORE_CONFIG naming the setting, and the failed startup's
owner releases its claim through the existing cleanup path. The deploy guide
records the refusal. `postgres_non_utf8_read_grant_setting_refuses_startup`
executes actual StoreConfig acquisition in a child with non-UTF-8 environment
bytes; it fails 0/1 before the fix because startup accepts the value. Initial
fixture setup/TCP-profile errors are excluded from that evidence; the qualified
negative uses the production-supported Unix socket. The PG runner includes
this test with the existing startup-cleanup witness.

Items **2 and 4 remain open**; item 3 is resolved above. This ticket stays in
`issues/` for the remaining engineering work and default-on prerequisites.
