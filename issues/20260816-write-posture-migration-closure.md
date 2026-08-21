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

## Author sitting 2026-08-16: the sibling extension is designed

The IR-extension dependency above is now owned by
[LLP 0274](../llp/0274-explicit-write-authority-postures.spec.md), authored
from a dedicated author sitting and refined through a five-round dual-family
(Codex + Grok, xhigh, mutually blind) review loop to a converged READY on the
same revision (artifacts under `llp/reviews/0274-*`). Rulings recorded there:

- Three explicit table-locus postures extend the shared LLP 0264 IR:
  `open-write`, `authenticated-write`, and `membership-write` (the author
  expanded scope to resolve 0264 OQ2 for ordinary target tables in-sitting).
- Demo bindings: campfire/chirp/messaging non-view-once → `open-write`;
  graffiti → `authenticated-write` (append-only insert); team-chat
  `messages`/`roomParticipants` → `membership-write`. The deliveries
  read-marker restructure ruling stands; direct fan-out over owner-read is
  now expressible but remains a separately governed product decision.
- Messaging view-once restructures its `grants` JSON map into grantee-owned
  grant rows (no map-keyed read vocabulary), per the same sitting.
- Ordinary owner-bindable jobs migrate incrementally without waiting for the
  sibling; the Phase 1b flip stays gated on the full corpus-closure receipt,
  which now recognizes the three explicit postures.

Closure of this ticket tracks LLP 0274's acceptance, implementation, and
independent qualification plus the per-job migrations; the sitting converted
the blocking design question into scheduled work.

## 2026-08-21 Phase 1D advisory-output resolution

The repeated-advisory presentation problem is resolved without weakening the
migration evidence. Both successful human codegen output and the packaged
`snapback generate` command now group
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` findings by semantic repair
class and report one `declare-explicit-write-authority` advisory with the
affected-table and finding counts. For example, Campfire's three findings over
two tables render as one migration block rather than three identical warnings.

Per-operation and per-table facts remain independently reachable in `--json`
diagnostics and in
`generated/authorization-review.json#writePolicyChecks`. The summary itself
also carries deterministic affected-table and affected-operation lists, so the
grouping is a human-output projection rather than a loss of evidence.

Focused qualification passed:

- `node packages/snapback-codegen/write-policy.test.mjs` (27/27);
- `node packages/snapback-codegen/review-surface.test.mjs`;
- `node packages/snapback-codegen/auth-artifacts.test.mjs`; and
- `node packages/snapback-cli/generate-check.test.mjs`, covering both human
  CLI printers plus retained per-finding JSON/review evidence; and
- `node packages/snapback-codegen/index.mjs demos/campfire/snapback --check`,
  including a manual `--json` check that retained all three detailed findings.

This closes only the migration-advisory grouping aspect. The ticket remains
open for the 34-job posture migration and closure receipt described above.
