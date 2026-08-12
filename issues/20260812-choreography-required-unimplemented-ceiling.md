# Frozen choreography ships required-but-unimplemented checks; m2/m3 green is structurally unreachable

- **Status:** Open
- **Date:** 2026-08-12
- **Systems:** benchmarks (social-messenger instrument)
- **Found by:** P2 pilot (first flag); confirmed by all 14 lanes of the
  2026-08-12 seven-model sweep
  (`benchmarks/records/2026-08-12-social-messenger-model-sweep.md`)

`benchmarks/tools/social-messenger/choreography/` hard-codes four
required assertions per segment in m2 (image/video post delivery,
follow-unfollow projection, feed author avatar) and m3 (dm-live-avatar,
receipt transitions, group aggregate receipt, member removal) as
`implemented:false, required:true`. `aggregateChoreography()` fail-closes
on `requiredUnimplemented > 0`, so no lane can ever emit `green:true`
for m2/m3 regardless of the app. Every sweep lane recorded this honestly
but with divergent labels ("functionally green" vs "capability-failure"),
which the grader phase cannot score consistently.

**Fix before the P5 scored wave** (this was already the P2 pilot's
"harness defect to fix before scored waves"):

1. Implement the eight missing checks (they are ordinary Playwright
   observations against contract test IDs), or demote them to
   `required:false` with a recorded rationale per check.
2. Pin one recording convention for instrument-caused non-green in the
   run-record schema so lanes stop inventing labels.

Also fold in the sweep's related instrument notes: pin the reduced-run
milestone DAG wording (two lanes proceeded to M3 declaring it
independent of M2), and disambiguate follow-projection assertions for
posts entering Following via the viewer's own repost (sol's finding).
