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

## Implementation decision (2026-08-10)

Choose fix 2's re-scope alternative: M6 authoring green is the web
queue/flush segment plus the coverage-valid suite; `ios-simulator-m6`
is a separately recorded native/O4 artifact, visible in the segment
receipt but not required for web green.

Reason: P1 froze the `simctl` process outline but no cross-lane app-side
event protocol. A generic wrapper therefore cannot know mechanically
when the cold-offline assertions have completed, when a lane-specific
backend should restart, or whether the observed UI corresponds to the
required server state. Shipping launch/record/hash plumbing alone would
manufacture a driver-shaped artifact without proving the behavior. The
existing `simulator.md` artifact contract is preserved for lane-native
drivers, and the harness accepts and records their status separately.

The P2 hardening also changes unsupported checks from false failures to
explicit `skipped` receipts with non-empty reasons and a `required`
bit. Segment choreography passes only when every implemented check
passes and `requiredUnimplemented` is zero.

## Resolution (2026-08-10)

Resolved in the worktree by choreography `0.2.0-p2`:

- M1 profile/session/logout, M4 media/reaction/edit/delete, and M5
  customization/view-once/search/disappearing checks now perform real browser
  observations using the pilot's isolated-context patterns.
- Receipt schema and aggregation distinguish `passed`, `failed`, and explicit
  `skipped` checks. Optional skips remain visible; required skips and every
  implemented failure block choreography green.
- M6 web green no longer requires a nonexistent generic simulator driver. The
  lane-native simulator contract and status remain separately recorded native
  evidence with `requiredForGreen:false`.
- `self-test.mjs` starts a local calibration app, executes M1 through two real
  browser contexts, schema-validates the receipts (including the skipped-state
  shape), and checks aggregation edge cases. On the available macOS fleet it
  passed with all three M1 assertions and an honest segment green.

Verification: choreography syntax/help and dependency checks; UI-kit
TypeScript; JSON parsing and receipt-schema validation; `./ref-check --verbose`;
`git diff --check`; and the end-to-end browser self-test all pass. The inventory
checker's unrelated base-commit `messaging-snapback` catalog-description drift
is already fixed on `origin/main` by `1bacb90fa`.
