# Track B landing: reconcile against the landed LLP 0185 fork work

**Status:** Open
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
