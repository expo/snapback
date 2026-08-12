# guide-gap: CI=1 Metro watch-inert advisory fires only on the supervised path

- **Status:** Open
- **Date:** 2026-08-12
- **Systems:** cli, guide
- **Found by:** two sweep lanes (fable5, sonnet5) —
  `benchmarks/records/2026-08-12-social-messenger-model-sweep.md` §4

The `SNAPBACK_EXPO_METRO_WATCH_INERT` condition (Metro started with
`CI=1` serves stale bundles because the watcher is inert) is documented
and the supervised dev loop warns about it — but agents who start Metro
themselves (outside `snapback dev --expo`) get no advisory and lose
real time to stale-bundle confusion (two independent lanes, ~30 min
each).

Options (either closes this):

1. Detect and warn from the CLI wherever we can see the environment
   (e.g., `snapback dev` printing a loud note when `CI` is set even for
   client-command paths), and/or
2. Add the trap to the skill's top-traps list and the getting-started
   authoring-loop page in the unsupervised spelling ("if you launch
   Metro yourself, do not inherit CI=1"), so agents meet it before
   Metro does.
