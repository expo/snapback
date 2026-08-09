# social-messenger P1 choreography: segment green structurally unreachable

Found by all three P2 pilot lanes (record:
benchmarks/records/2026-08-09-social-messenger-p2-pilot.md, F2).

Every choreography segment carries implemented:false stub checks, and
the segment-level green flag requires all checks — so no lane can ever
earn a harness green, and M6 additionally requires an
`ios-simulator-m6` external receipt that has no driver (simulator.md
defers it to P2, but nothing ships it). The pilot graded under a
documented "pilot interpretation" (suite + implemented checks); scored
waves cannot.

Fix before P3 freeze:
1. Implement the stubbed checks for m1/m4/m5 (profile-edit live, media
   message, reactions, edit/delete tombstone, chat customization,
   disappearing, view-once) — the pilot lanes' Playwright suites prove
   every one is automatable in the two-context pattern.
2. Ship the simulator segment driver (xcrun simctl per simulator.md)
   or re-scope M6 green to web + a separately recorded simulator
   artifact.
3. Green semantics: segment green = all implemented checks pass AND
   no assertion required for the milestone remains unimplemented.
