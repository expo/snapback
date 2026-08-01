# Diary 0044: A3 collaborative issue and planning board — improvement-sweep arm

**Application:** A3 collaborative issue and planning board (LLP 0137 contract `a3-issue-board.v1`)
**Arm:** snapback-web, external consumer, public `@expo/snapback-*` 0.1.7 closure
**Date:** 2026-08-01
**Builder:** Claude (Fable 5), third diaried sweep arm after A2 and A1
**Capsule:** `demos/improvement-sweep/arms/a3-snapback-web/run-capsule.json`
**Result:** 12 pass / 0 GAP / 0 fail / 0 Stop, expectedChecks=12 enforced (one explicit in-check nonclaim: org-wide member search, finding f2)

## 2026-08-01 — the arm

### Setup and posture

Clean external directory in the session scratchpad, npm-installed 0.1.7
closure (13 packages, ~5s), `snapback new board-app --template react`, the
frozen neutral-web shell merged in with only the board view wired live.
Sessions mode for the same reason as the prior arms: dev mode's
client-asserted `userId` would make every negative check vacuous. Runtime
binary byte-identical to the A1/A2 publication (sha256 6c5c9567…). Zero
posture breaks; three assistance events (prior-arm persona/custody recipes
cited to a2-f6/a1-f9; one packaged-bytes read for the undocumented range
vocabulary; the evolution probe suite), each converted into program records.
Budget actuals: ~10 orientation minutes + ~34 build minutes to the green
12/12, ~78 tool calls through final verification against the 8h/400 deep
ceilings.

### The seed/membership knot, and the invite pattern that untied it

The first genuinely A3-shaped design problem: a production-shaped seed wants
the organization, issues, comments, and activity as literal fixture rows, but
membership seats reference server-minted principals that do not exist at
seed time, and `bootstrap()` creates its own resource row — it cannot seat
anyone on a *seeded* organization. The scoped-roles guide's own recommended
pattern (app-data invitations plus a self-addressed insert) turned out to be
exactly right: the fixture seeds `orgInvites` rows carrying role + code, the
membership declares `{ op: 'insert', by: ['none'], target: 'self' }`, and
`redeemInvite` is the only mutation that exercises it, gated on an unconsumed
invite. Personas earn owner/member/guest seats in one mutation each; the
outsider's guessed code refuses. This composed beautifully — and it also
surfaced the sweep's cleanest capability gap when I tried to make the seed
own membership directly: naming `orgMembers` with an EMPTY array refuses
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`, and unnamed tables are not
reset targets, so the receipted reset restores every data row while all
authority survives (finding f1). Cleanup had to choreograph self-removal per
persona before the reset — it works and the evidence is airtight, but a
fixture that cannot own authority state makes deterministic acceptance loops
harder than they should be.

### What felt easy or genuinely good

- **The relational core is simply there.** Ten tables, three-level
  composition (org → team/project → issue → labels/comments/activity), unique
  indexes for identifiers, pageKeys, and comment idempotency keys — authored
  in one sitting, one codegen iteration, and the whole 24-operation catalog
  loaded first try. The issueDetail one-snapshot composition (six bounded
  reads + per-edge label gets + exact aggregates) is the shape Linear-like
  detail panes want, and `results.records` with nested `v.object`/`v.array`
  typed it precisely.
- **Sequence counters with zero ceremony.** ISS-151 came from a plain
  read-modify-write on the org row inside `createIssue`; serialized commit
  order makes it correct without a counter service. The 0135 shape, shipped.
- **Settlement receipts everywhere.** Every mutation returns
  `{version, changed_count, result, receipt:{mutationId, outcome,
  affectedTables, snapshotVersion}}`. The A3-08 conflict evidence — exactly
  one commit per revision — fell out of the envelopes.
- **Compare-and-move worked exactly as designed.** Two actors from revision
  1: one commit wins, the stale mover refuses deterministically, the rebase
  is an explicit second commit, both moves are activity rows. No silent
  merge, no lost update, and the second client converges live.
- **The optimistic surface is honest.** A declared projection over the
  provider-owned column store, visible 51ms before settlement, retired only
  by the matching authoritative delivery. You cannot accidentally count the
  overlay as authority; `isAuthoritative` makes retirement explicit.
- **Owner-partition search is transactionally live.** `assignIssue` commit →
  the row is immediately searchable in the assignee's partition, with
  deterministic scores and highlights. Compare frozen Firebase (diary 0029):
  no native search at all.
- **Cursor custody.** The generated keyset pages refused a malformed cursor
  and Bob presenting Alice's cursor with the same byte-uniform
  `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`. Pagination abuse is a refused
  surface, not an app bug.
- **4.7-second full suite.** Fresh seed install, four personas, a live schema
  evolution, a jsdom React render, two receipted destructive resets — 4.7s
  wall. The dev lifecycle (ready descriptor, `snapback.dev.v1` events,
  stdin-close stop) keeps making acceptance suites that own their servers
  trivially cheap.

### What felt bad, hard, or surprising

- **Schema evolution was the arm's one real detour (~15 minutes, three probe
  scripts), and it found the sweep's worst defect so far.** The natural
  workflow — stop dev, regenerate the evolved schema, start again — refuses
  on a sessions database with `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, and
  the CLI wraps that in `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH` telling
  you to reinstall the runtime (finding f4: wrong subsystem, wrong recovery;
  an external consumer would loop on package reinstalls). The path that DOES
  work — the dev supervisor's live watch reload — is sub-second and lovely
  (same seed identity, byte-equal counts, sessions uninterrupted)… unless any
  live subscriber is attached, in which case the reload lands
  `generated-but-not-loaded` with `SNAPBACK_AUTH_MODE_PENDING` and app-data
  admission NEVER reopens — not even after the subscriber disposes; and since
  restart also refuses on the evolved artifacts, the only recovery is
  restoring the old sources (finding f5, the headline). A collaborative
  board's steady state is "clients connected"; the standard template is vite
  + a browser tab. Today that means: every schema edit with the app open
  wedges the dev server. The suite works around it by disposing every
  provider and handle before evolving. None of this is in the guide
  (finding f6, guide-gap).
- **App semantics have no refusal vocabulary.** My documented conflict
  refusal ("stale move…") surfaces as generic `SNAPBACK_HANDLER_FAILED`; the
  reconciliation branch keys on message prose (finding f3). The host's own
  coded refusals are exemplary — application authors deserve the same tool.
- **The board's primary list cannot use the safe pagination path.** Generated
  keyset pages accept only principal-owner partitions; the org/team-scoped
  list — THE board shape — hand-rolls its cursor over a bounded indexed read
  because the ctx.db chain also lacks a strict-gt verb (a2-f5 cited; the
  resource-partition generator gap filed as f7, which is precisely the LLP
  0110/0131 bounded-children shape not yet exposed on 0.1.7).
- **Docs papercuts.** The declarative range vocabulary is undocumented — the
  queries page shows only `eq`, and `gte('field', arg(...))` refuses with
  "Gte expects a value expression"; the working `gteFilter`/`lteFilter` forms
  came from reading packaged define.mjs bytes (assistance event). Membership
  entry onto a seeded resource likewise required assembling three guide pages
  plus experiment.
- **Small suite-authoring traps of my own making, honestly:** two fixture
  collisions (a title containing "pagination" polluting a partition-honesty
  negative; an expected count missing a just-created row) — both mine, both
  caught by exact-count assertions, which is the point of authoritative
  expected sets.

### Comparison against the frozen lineage (diary 0029, LLP 0102 Linear arm)

The frozen Firebase arm recorded LINEAR-09 search as an honest GAP (external
provider required), leaned on transaction-retry idioms for sequence
allocation, and its migration leg predates any startup-pin concept. This arm
beats that baseline on search (native, partitioned, transactional — though
org-wide membership search remains f2), on settlement evidence, on conflict
determinism, and on suite loop speed; it loses to the *Convex* reference
shape on three counts that are now filed capabilities: membership-scoped
search (Convex composes search with function auth by construction),
resource-partition pagination (`.paginate` over any index inside a gated
function), and — most importantly — schema evolution with connected clients,
which Convex treats as the normal case and 0.1.7 currently wedges on
(f5). The differentiator watch below is what must not regress while those
gaps close.

### Differentiator watch (protect while fixing)

Recorded in full in the capsule: transactional sequence allocation;
settlement receipts; declared-projection optimistic honesty; AEAD cursor
custody; transactionally-live owner-partition search; sub-second live
evolution when unencumbered; the 4.7s full-suite loop; uniform
non-disclosing denials across read/subscribe/write/cursor surfaces.

### Would I choose Snapback for this app today?

For the collaborative board's core loop — yes, and more confidently than I
expected: the relational modeling, role gating, conflict determinism,
optimistic lifecycle, and live fan-out are all first-class and fast, and
nothing in the data tier fought the Linear shape. Two things would stop a
production adoption this week: the evolution wedge under connected clients
(f5 — a board team edits schema daily with the app open) and org-wide member
search (f2 — a board without cross-assignee search is a demo). Both have
clean Snapback-native fix shapes already designed for (0110/0131/0135
lineage); when f5 lands this is the best-fitting backend I have run this
contract against.

### Findings filed

`0137-a3-f1` membership not seedable / cleanup cannot retire authority;
`0137-a3-f2` search visibility cannot express membership; `0137-a3-f3` no
structured app refusal codes; `0137-a3-f4` restart-evolution refusal
misattributed; `0137-a3-f5` live subscriber wedges watch reload (headline);
`0137-a3-f6` guide-gap: sessions schema evolution path; `0137-a3-f7` keyset
pages owner-partition only. Cited, not re-filed: a2-f4 (no admin kick),
a2-f5 (no chain keyset verbs), a2-f6/a1-f9 (persona/custody recipes),
a1-f7 (membership filter-vs-deny split). Tickets:
`issues/20260801-0137-a3-*.md`; finding JSONs beside the capsule.

### Mechanics notes

Port discipline: the suite guard-blocks 4288/4289 during the runtime's port
scan and asserts never-4420; the arm's server ran on 4290. Three short-lived
repro probes lacked the guard and one transiently adopted the then-free 4288
(no prior-arm server was running; no listener remained — recorded here and
in the capsule rather than silently). jsdom render of the app's real
BoardView module worked first try once `navigator` was installed via
defineProperty (node 24 makes the global getter-only).
