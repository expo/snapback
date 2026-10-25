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
3. **Default posture.** Zero-flight reuse is opt-in via declared clock
   bounds. Decide whether single-owner `ha=none` deployments default to
   conservative bounds (author decision pending).
4. **Write-mix false misses.** Revision equality misses every entry after
   any commit: a 1 % write stream gives 92.3 % misses and 5.1k reads/s.
   Cross-revision promotion with footprints (§4.1) is the designed remedy.

5. **Store-port ratchet (REL affected audit, 2026-10-24).** The current
   `store_port_ratchet` reports production accesses above the port in
   `engine/command.rs` (1) and `engine/revision_cache.rs` (4), violating
   LLP 3000.009.001.000 §3.2. These files match origin/main; REL does not
   modify them. Move the driver access/typing behind the admitted port,
   or review any lexical false positive explicitly; do not silently raise
   the zero-production-access allowlist. Reproduce from `snapback4` with
   `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --test store_port_ratchet`.

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

Items **2–6 remain open**, with their original scope and author decision pending
where noted. This ticket stays in `issues/` for those items.

6. **Codec census (REL affected audit, 2026-10-25).** The
   `wasm-codec-census.test.mjs` mutation-receipt exclusion test counts eighteen
   serde sites in `engine/revision_cache_tests.rs` and
   `engine/revision_cache_grant_tests.rs` as production, alongside the one
   admitted site in `engine/mutation.rs`. These source files match the merged
   main. Teach the census to prove the existing `cfg(test)` module exclusions;
   retain the single-production-site assertion rather than increasing it to 19.

## Integration 25 resolution of test census items 5 and 6 — 2026-10-25

Item 5's five production sites are lexical false positives: each names the
engine's `super::postgres` adapter module, rather than the external driver
crate. The scanner now distinguishes those explicit local paths, with negative
controls retaining external/absolute driver and actual query calls. Production
allowances remain unchanged. Test-only counts are regenerated for the new G6
fixtures and integration observers.

Item 6 now follows literal `#[path]` declarations and their excluded children
from a proved cfg(test) parent. Removing the gate exposes the sibling again;
its regression and the original single-production-codec assertion pass.
Items 2–4 retain their existing open scope.
