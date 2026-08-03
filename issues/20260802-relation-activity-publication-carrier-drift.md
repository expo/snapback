# Relation/activity local publication carrier digest drifted on main

**Status:** Open
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
