# Close the LLP 0264 Phase 1b write-posture migration corpus

**Opened:** 2026-08-16
**Owner:** LLP 0264 Phase 1b
**Systems:** Security/authorization, Code generation, Demo corpus, Generated artifacts
**Source:** LLP 0264 Phase 1a full registered-corpus preflight

## Problem

LLP 0234 G1 landed before LLP 0264 Phase 1. G1 declared every registered
table, so LLP 0264's planned `legacy-undeclared` relief class was empty when
owner-write enforcement first ran. Thirty of 34 registered generation jobs
still have a write model that needs closure: an ordinary generic write against
a declared non-owner read policy, an owner write that must conform to host
stamping, a specialized authority write that needs an exact generated roster
surface, or a genuinely open/delegated write that needs a sibling extension of
the shared policy IR.

Phase 1a keeps the corpus green with
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` and an honest
`writePolicyChecks[].genericWriteDisposition: migration-pending` fact for the
declared-non-owner class. This is a migration gap, not permission, enforcement,
or a capability claim. Owner enforcement, authority-table generic-write
refusals, omission/removal refusals, and the opaque owner-form gate remain
hard.

## Registered jobs in the closure

The Phase-1 preflight's 30 failing job identities were:

1. `demos/todo/snapback`
2. `demos/latency-kanban/snapback`
3. `demos/messaging-snapback/snapback`
4. `demos/triage-graph/snapback`
5. `demos/fleet-observatory-move1/snapback`
6. `demos/zero-bakeoff/apps/contention-calendar/snapback`
7. `demos/all-aboard/snapback`
8. `demos/all-aboard/tests/egress-probe`
9. `demos/competitive-checkpoint/snapback`
10. `demos/campfire/snapback`
11. `demos/chirp/snapback`
12. `demos/graffiti/snapback`
13. `demos/pointing-room/snapback`
14. `demos/rbac/snapback`
15. `demos/shindig/snapback`
16. `demos/partiful-matrix/snapback`
17. `demos/signal-desk/snapback`
18. `demos/catalog-lens/snapback`
19. `demos/dispatch-board/snapback`
20. `demos/pulse-monitor/snapback`
21. `demos/public-dashboard/snapback`
22. `demos/browser-local-first/snapback`
23. `demos/browser-local-first/snapback-sessions`
24. `demos/access-desk/snapback`
25. `demos/team-chat/snapback`
26. `demos/party-wall/snapback`
27. `demos/file-drop/snapback`
28. `packages/snapback-cli/fixtures/comparator/app/snapback`
29. `packages/snapback-react/fixtures/conversation/app/snapback`
30. `packages/snapback-cli/fixtures/push-seam/app/snapback`

The two `todo-v2` target jobs, `cursors-web`, and `card-game` were the four
green controls and retain their owner-enforcement facts unchanged.

## Closure condition

For every job above, inventory every declared write and bind it to exactly one
implemented model:

- an owner-policy generic write using host stamping, immutable ownership, and
  authoritative old-row checks;
- a declaration-owned generated roster/authority operation; or
- an accepted, implemented, independently qualified sibling extension of the
  LLP 0264 policy IR.

The campfire/graffiti class of genuinely open writes cannot be “fixed” by
treating public read as public write. It depends on the IR-extension option,
including an explicit write authority and its runtime/egress proof. Related
read-policy expressiveness residuals are tracked in
`issues/20260816-g1-policy-ir-expressiveness-residuals.md`.

Team Chat's recipient inbox is another IR-extension dependency: Phase 1a keeps
its owner policy intact, limits the non-claiming kernel to a sender-owned
delivery, and removes cross-owner moderator cleanup. Restoring recipient
fan-out or cleanup must model that authority explicitly; it may not bypass the
owner slice or widen the read policy merely to clear the corpus.

Phase 1b lands only after a new write-migration corpus closure receipt binds
all 34 registered jobs, reports zero `migration-pending` rows, and passes the
scoped qualification battery. That receipt is analogous to G1's closure shape
but independent from it. Do not edit or repurpose the retained G1 closure
receipt.
