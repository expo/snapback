# Snapback 4: timeline tests still assert superseded diagnostic wording

Status: Open
Date: 2026-09-27
Owner: Snapback 4 timeline/guide lane

The lane SS round-3 full suite, based on merged main `09e55ad98`, fails two
unchanged timeline tests because the diagnostic rewrite landed without the
matching assertion updates:

- `snapback4::timeline::lifecycle::activation_refuses_each_populated_event_or_edge_table`,
  `crates/snapback4/tests/timeline/lifecycle.rs:32`: expects `planned view`.
  `check_activation` now says `Use the planned query from guide feeds`.
- `snapback4::timeline_adoption::redefinition_refuses_atomically_and_delivery_keeps_running`,
  `crates/snapback4/tests/timeline_adoption.rs:203`: expects `event identities`
  and `planned view`. `check_activation` now describes `repost identities`,
  `original event ids are post ids` and `planned home query in guide feeds`.

Both still receive their expected refusal codes (`E_TIMELINE_ACTIVATE` and
`E_TIMELINE_REDEFINE`). SS has no diff in these tests or in
`crates/snapback4-core/src/engine/timeline/activation.rs`. The mismatch is
present in `git show 09e55ad98:<path>`; the three diagnostic strings changed
between `2c333f30b` and `09e55ad98`. This is deterministic text drift, not a
scale timeout or a change to index bytes.

Reproduce from `snapback4/`:

```sh
cargo test -p snapback4 --test timeline lifecycle::activation_refuses_each_populated_event_or_edge_table
cargo test -p snapback4 --test timeline_adoption redefinition_refuses_atomically_and_delivery_keeps_running
```

Update the wording assertions to the corrected guide/diagnostics while
retaining the refusal codes, named table/view and exact state/generation/
sequence/continued-delivery assertions. Do not restore the inaccurate
`planned view` advice merely to satisfy a stale test.

Evidence: [SS round-3 report](../snapback4/reports/20260927-ss-sync-scale/ROUND3.md)
and its full-suite log. No timeline behavior or assertion was changed by SS.
