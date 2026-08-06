# Track B landing: reconcile against the landed LLP 0185 fork work

**Status:** Closed 2026-08-06
**Opened:** 2026-08-06
**Systems:** Storage, Testing
**Related:** LLP 0158, LLP 0164, LLP 0185;
`issues/20260803-agent-safe-storage-acceptance-tail.md`

For whoever lands `llp-ship/trackb-acceptance-20260804/*` (in flight as of
2026-08-06, `integration-r5` 159 ahead): LLP 0185 Phases 0–5 landed on main
2026-08-05/06 and touched surfaces that branch also carries. Reconcile,
don't clobber:

1. **Asset-table custody flipped.** `src/instance_fork.rs` `TABLE_CUSTODY`
   now marks durable asset tables `Copy` (with a same-cut digest-verified
   blob copy in `copy_fork_private_assets`), attempts/work-ledger `Scrub`.
   Any Track B expectation that asset-bearing sources refuse with
   `SNAPBACK_FORK_CUSTODY_REFUSED` is stale on main.
2. **Near-duplicate test.** Track B's
   `derived_fork_keeps_its_pinned_copy_when_parent_writes_after_publication`
   overlaps main's
   `parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`
   (broader). Keep one or both, but expect a merge conflict in the same
   region.
3. **New fork surface on main** the branch predates: `fork renew`,
   resource limits (`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` now real),
   per-fork cleanup locks, `--retain-base` + `fork diff --net`
   (`snapback.fork-net-diff.v1`), and six new classified
   `SNAPBACK_FORK_*` codes in `src/server.rs`'s s5-d10 inventory.
4. **`scrub_copied_authority_for_in_app_branch`** (Track B's addition to
   `instance_fork.rs`) has no counterpart on main — bring it over intact,
   but re-run the fork unit suite (33 tests) after merging.

**Landing-discipline ruling (2026-08-06):** see the author ruling recorded
in `issues/20260803-0163-public-operation-identity-carrier.md` — a
dual-READY cut may land first and run its performance leg immediately
after landing; activation stays gated on the performance result.

Close when the Track B integration lands green against these points.

## Resolution — 2026-08-06

The Track B integration landed on main while this ticket was open:
`llp-ship/trackb-acceptance-20260804/integration-r5` (`fd751aac5`) is now an
ancestor of main, and the post-landing performance leg ran against landed
commit `a0852be190d7` (recorded in
`issues/20260803-agent-safe-storage-acceptance-tail.md`). All four
reconciliation points verified on main at `6e158169b`:

1. **Asset-table custody:** main's `TABLE_CUSTODY` Copy rules and
   `copy_fork_private_assets` (`src/instance_fork.rs:2915`) are intact; no
   stale `SNAPBACK_FORK_CUSTODY_REFUSED` expectation for asset-bearing
   sources survives.
2. **Near-duplicate test:** both fixtures were deliberately kept at their two
   levels — `derived_fork_keeps_its_pinned_copy_when_parent_writes_after_publication`
   (`src/instance_fork.rs:3582`) and
   `parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`
   (`src/instance_fork.rs:3636`, plus the live-server leg in
   `tests/instance_fork_cli_v1.rs`).
3. **Newer fork surface preserved:** `fork renew`, resource limits
   (`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED` in `src/instance_fork.rs` and
   `src/server.rs`), per-fork cleanup locks, `--retain-base` +
   `fork diff --net` (`snapback.fork-net-diff.v1`), and the s5-d10
   diagnostic-code inventory are all present on main.
4. **`scrub_copied_authority_for_in_app_branch`** is on main
   (`src/instance_fork.rs:1132`) and wired into promotion
   (`src/fork_promotion.rs:1112`).

Post-landing verification 2026-08-06: `instance_fork::tests` 34/34 and
`fork_promotion::tests` 37/37 green on main at `6e158169b` (the suite grew
past the 33 tests this ticket anticipated).
