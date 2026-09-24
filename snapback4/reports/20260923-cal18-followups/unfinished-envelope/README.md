# Stopped delivered-app fixture

`digest_cal18.rs.txt` is the final **unsuccessful** draft after the three trials
documented in [the scale record](../scale.md). It is evidence, not a registered
test or a supported implementation. Its comment about seeding normal writes
was disproved by trial 3: both `Engine::load` and `Engine::seed_at` reject
timeline-mapped source import. No digest, whole-domain comparison or marker
measurement ran in this draft.

The temporary `Runner::metered()` accessor used here returned the existing
meter's `used` value. It was removed rather than keeping production surface for
an unfinished harness. Paths in this draft refer to its former simulator test
location. Resuming requires an author decision after the bounded stop and a
fixture that writes mapped profiles/posts/follows through authored operations.
Do not treat the draft's assertions as observed behavior.
