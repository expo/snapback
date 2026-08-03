# Relation/activity local publication carrier digest drifted on main

**Status:** Resolved (2026-08-03)
**Systems:** Relational queries, Testing, Capability publication
**Related:** LLP 0110, LLP 0134 E6,
`tests/conformance/relation-activity-publication-v1.mjs`

During the 2026-08-02 LLP 0134 implementation landing, the mandatory local
publication suite failed on rebased main (`55971c8b25d34a5f75d920f25debe55458332807`):

```text
AssertionError: src/local.rs drifted from the local publication carrier
actual   sha256:fc8684ed4456303a330f4defb9d4e40191efb3aea7854775fc3481e6ad3ae9fd
expected sha256:1a182572d05a45187695a691c8d27cc581d709e9a74f41ad3800af0ba7654b35
```

This prevents an honest green `bounded_children_v1` + `write_activity_v1`
soak observation and resets/blocks that pair's LLP 0134 E6 window. Determine
whether the `src/local.rs` change preserves LLP 0110; if so, rerun the complete
qualification suite and rotate the source-owned carrier/receipt as one act. If
not, repair the implementation before republishing support. Do not update the
digest alone.

## Resolution (2026-08-03)

On origin/main the carrier pins reconcile; the drift no longer exists. The
carrier was rotated with the mixed-route/carrier landings 46b614efd and
cd572f59c. Re-verified at close time by recomputing digests in a fresh
worktree of origin/main:

- `shasum -a 256 src/local.rs` →
  `3f50ad9d7ba9395f32f0b928d336e62b0d9a0e9b0bba475e429183c58d2ddd6b`,
  matching the `executorSourceSha256` pin in
  `src/local-relation-activity-publication.v1.json`.
- `shasum -a 256 src/storage.rs` →
  `8f9dd3df80217b4f5f0bce26a4256490d784b0bc565e5ef66366769bb4715c96`,
  matching its pin in the same carrier.
- The carrier's own digest,
  `18b738a0fef20f0933957b82c44a023507349d005052ebcf8ec37dda3788b80a`,
  matches the self-digest pin in
  `tests/conformance/relation-activity-publication-v1.mjs`.

One honest caveat: whether the LLP 0134 E6 soak-window reset was
re-bookkept was not verified here. No soak-observation file for the
`bounded_children_v1` + `write_activity_v1` pair exists under
`tests/acceptance/maturity/` (the only soak observation there is
`inline-handler-local-dev-2026-08-03.soak-observation.json`, a different
capability), so the E6 window-reset question remains with the LLP 0134
owner.
