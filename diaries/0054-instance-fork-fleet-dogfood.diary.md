# Diary 0054: Fork-per-worktree fleet dogfood

**Date:** 2026-08-03
**App:** `demos/todo`
**Stack:** Snapback local SQLite/Ibex, `snapback fork`, two agent-style worktrees

## What I exercised

I used the new F0b surface against a live Todo parent at application version 1.
Two independent `fork create --from <ready-file>` calls produced simultaneous
derived servers on OS-assigned ports. Both retained logical `appId: todo`, but
session B loaded a changed handler bundle from a second worktree: session A
reported bundle `sha256:98a807867729cfcb`, while session B reported
`sha256:7b460f647c41b760`.

Each session wrote a different todo through the generated `createTodo`
function. Reading as session A's user returned the row only from session A;
session B and the live parent returned no row, and the parent remained at
version 1 while each fork advanced independently to version 2. `fork diff`
then emitted one app-row post-image for each fork, with the fork point, observed
head, table count, and explicit omissions. `fork drop` removed one exact
directory. A post-fix lifecycle probe ran `fork reap --now-ms <expiresAtMs>`
at the exact expiry boundary and removed a third dedicated probe fork's exact
directory and registry row; session B had already been dropped explicitly.

The dated facts are retained in
`tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json`. The automated
F0b test covers finite expiry, default secret scrubbing, explicit config-secret
copy, registry lifecycle, app-row-only diffing, exact deletion, and injected-
clock expiry; the existing F0a corpus continues to own custody, credentials,
crash cuts, and fail-loud deny-all egress.

## What felt good

The workflow removed the shared-database and fixed-port coordination entirely.
The useful unit became one worktree plus one ready file: each agent could load
its own generated functions into a copy of realistic parent state without
changing source identity or hand-editing seed data. The ready-file result made
the next CLI call mechanical, and finite TTL plus exact-target drop/reap kept
the disposable posture visible.

The diff receipt was small enough to review directly. It did not imply a
database-wide semantic diff: it named committed app-row journal entries after
the fork point and listed assets, auth, egress payloads, privileged/raw SQL,
sidecars, and telemetry as omissions. That was more useful than a raw SQLite
file comparison for answering “what did this agent session write?”

Compared with React plus Convex preview deployments or a manually seeded
Supabase branch, this local flow preserved the parent's real application rows
and booted the changed Snapback handler bundle in one operation. Snapback's
extra runtime ownership also made inert cron/jobs/assets and deny-all egress
part of the result, rather than conventions the demo author had to remember.

## What felt hard

The first real run found three lifecycle bugs that isolated unit setup had not
made visible. A readiness descriptor can retain its bind-time `local-app`
identity after a manifest is loaded, so fork creation now reads the persisted
schema identity from the snapshot. A child inherited the invoking launcher's
session and died when the short CLI exited, so fork servers now start in a new
Unix session. Finally, health became unreachable just before process teardown
finished; reaping immediately could race a final telemetry write and see a
non-empty directory. Stop now waits for the exact PID to exit before deletion.
The post-fix live reap reproduced the expiry boundary successfully.

Using a ready file for a generic host operation also did not discover the
database-named admin-token sibling after the parent was provisioned. F0b now
validates and reads the exact token path declared by the fork's readiness
descriptor for its own manifest loads. The broader ready-file convenience is
tracked separately in
`issues/20260803-ready-file-admin-token-discovery.md`; widening this change was
not required to make fork creation correct.

There was no intent-indexed guide page for “give this worktree an isolated copy
of my local app.” The code could be found only by reading LLP 0158 and CLI help.
`issues/20260803-guide-gap-instance-forks.md` tracks F1's page, capability-index
GAP row, and acceptance-harness option. The fork does not advertise a target
capability in this landing.

## Comparison with LLP 0081 rehearsal

The fork is additive rather than duplicate. LLP 0081 rehearsal is a controlled
migration proof: it binds an approved production-plan digest, backup identity,
restore epoch, target profile/capabilities, expected-versus-actual proof, and a
receipt that production admission consumes. That remains the right mechanism
for deciding whether an exact migration plan may run against production.

The fork served a different residual workflow. It booted two whole local app
instances from current live state, allowed each worktree to load a different
function bundle, accepted arbitrary multi-step demo interaction, and produced a
review-oriented app-row receipt without pretending to authorize production
apply. It was faster and less ceremonial for iterative demo development, but
its receipt is deliberately weaker and cannot replace LLP 0081's migration
rehearsal evidence.

## Verdict

LLP 0158 graduation criteria 1 and 2 are met. The named fleet consumer used F0
in a real simultaneous, function-divergent demo workflow, and the comparison
shows concrete whole-app development value beyond restore-derived migration
rehearsal. Criterion 3 was already met by the green F0a corpus. This records the
empirical result without changing LLP 0158's author-controlled Draft status or
advertising a capability early.

## Verification

- Existing F0a `instance_fork` corpus: green.
- F0b managed-lifecycle and CLI parsing tests: green.
- Two live derived servers from one live parent: green.
- Same-`appId`, different function bundles: green.
- Independent mutation/query and one-row diff receipts: green.
- Exact drop and deterministic reap at `expiresAtMs`: green after the teardown
  race fix.
