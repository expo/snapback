# Security invariants

State privacy intent separately from enforcement. Check reports proved, refuted
with a replayed counterexample, or unproved with a reason; passing finite tests
are not proofs.

```quarry
table privateNotes:
  patient: principal
  body: text 1..2000
  sealed: bool default false
  read <- .patient = viewer and .sealed = false
  insert <- .patient = viewer and .sealed = false
  online only
-- Spec: a patient may see only their own note; sealing may narrow availability.
-- Removing an accidental broad branch from the rule must not change this intent.
invariant privateNotes.read only .patient = viewer
invariant privateNotes.body read only .patient = viewer
invariant privateNotes.insert only .patient = viewer
query privateNote(note: privateNotes):
  return privateNotes[note]
mutation writePrivateNote(body: text 1..2000):
  return insert privateNotes { patient: viewer, body }
```

Run `snapback4 check` → `snapback4 test` → `snapback4 audit`. Check reports
invariant counts and five actionable notes; `--verbose` retains every reason.
A mirror invariant cannot catch a wrong rule: the advisory asks
for the spec's audience, resource relationship and lifecycle condition instead.
A legitimate simple owner policy can be equivalent; the advisory never refuses it.
Review `snapback/generated/security-invariants.q.draft`: it offers unconfirmed
per-role/per-column alternatives and questions, never auto-accepted policy.

Test synthesizes two users per discovered role/seat and related ownership rows
without fixture files, including password-only apps. These private in-memory
fixtures never open dev doors. Every failure labels its initial fixture origin:
`generated-fixture-trace` means an authored observation from a validated generated
initial state, not proof that app operations created that state. Author-supplied
fixtures retain `authored-fixture-trace`. Both fail acceptance on actual observed
violations; seed-only/synthetic table probes remain non-failing supplemental evidence.
Fixture-free tests report that no authored business cases ran. Finite passing
campaigns never prove security. Check bounds concrete exploration to 512 call/world
reservations and 1500 ms; exhaustion stays unproved and points to the full test.
`audit --json` retains all column audiences, grant writers, exclusions and uncovered
role/row/effect exposures. Declaring one effect does not cover the others.

## Reference

`invariant table.column read only P` protects a column value, derived values and value-dependent counts/existence/refusals. An authored projection excluding the column does not by itself disclose that value; filtering, ordering or copying it can. Audit JSON includes `column_audiences` (effective row rule plus private-owner gate). Unknown derived and opaque paths remain unproved.

`invariant table.read only P` protects read intent; insert, update and delete
name authority. `invariant table.column write only P` covers writes to a
column (both insert and update). `invariant table.column update only P` checks
only edits, retaining old-and-next-image semantics; use it when creation is permitted
to a different role (for example counter staff creating a ticket price). `invariant table always P` states row integrity.
An update policy over `.field` constrains **both old and next images**.
A policy saying status must not be override therefore also restricts editing
a row that was already override, even when changing it away from that status.
For the role authority of one named mutation, use operation-specific intent
(`invariant table.operation only P`) instead. General next-image-only and
cross-operation transition assertions still need a separate reduction.
Predicates use the existing rule vocabulary: `.field`, `viewer`, `exists`,
comparisons, `and`, `or`, `not`. For a role write use the complete roster probe,
for example `invariant members.role write only exists roles[viewer, role = 'owner']`
in a schema declaring those tables. A declaration never grants authority.

The implemented proof fragment exhaustively checks independent three-valued
rule predicates. A failed implication is unproved until an engine replay
establishes a counterexample. A schema-valid seeded snapshot is not a claim
that an application operation sequence reaches that state. Required-column
non-null assertions have a separate validation theorem. Read/count/sum/existence obligations are reported separately. A maintained aggregate with bare privacy keys can prove its contributor audience; a broader aggregate can yield a paired present/absent counterexample. Exact server `not before`/`expire at` bounds can prove a temporal read component independently of physical sweeps. General transitions and unsupported expressions remain unproved.
Read-through captures/live parents, complex derived aggregates, raw rule probes,
owned-field update bypasses, cascade/set-null and opaque jobs/workers need
separate reductions. An unresolved path blocks the whole declaration's proof.

Server delivery authorizes against the current server snapshot. A disconnected
device can retain an earlier snapshot until it receives a revocation; even
`until-revoked` cannot know a later server role. Synced current-role intent is
therefore unproved for device access. Retained history follows its leave policy.
These reports exclude physical timing and resource/meter side channels and
explicitly exclude the trusted system-principal boundary. Service seats remain
inside the ordinary-viewer check; there is no implicit seat exemption.

## Current roles and derived grants

A membership or assignment created while a user is an inspector can survive
their demotion. Conjoin the **current reader's role** with the assignment
branch, or revoke every derived grant transactionally whenever the role changes.
A grant writer's role does not establish the recipient's current authority.
With independent current-role intent, grant-lifetime advice points at this pattern; the argument-grant advice identifies
arguments written into reader-grant columns: validate the chosen principal's
role and relationship, even when the caller is privileged.
Global admin authority must come from a trusted operator or existing admin;
a group-creation `created` probe must remain scoped to that group everywhere.
`N_PRIVILEGE_ESCALATION` identifies role assignments trusted by later rules without independent delegation. Open enrollment may be intentional: compare each note with the specification. See `guide staging` for operator first-admin setup and `guide sharing` for parent authority.

## Required evidence and deadlines

If the spec requires a photo, use a required `image <=5000000` column or
`[image <=5000000] 1..4`; `?` permits omission and `[image] <=4` permits zero.
Uploads are verified media and asset reads inherit row and private-field rules.
Optional-evidence advice asks the builder to check intentional optionality.
Text `min..max` counts non-whitespace Unicode characters toward the minimum;
the maximum counts all characters. Stored text is not trimmed or rewritten.
A sweep changes state eventually: compare the deadline with server `now` in
the mutation too if writes must stop exactly at that instant.

## Existence observations

A lookup that says NOT_FOUND on absence followed by a denial saying FORBIDDEN
can reveal existence to callers admitted by a broader read rule. Use the same
code **and message** for hidden/absent/denied cases when existence is private,
or tighten the table read rule. Program `exists` is caller-filtered; probes
inside table rules inspect raw rows and can disclose predicates indirectly.
Inspect both paths in `audit`; a payload-only read check is insufficient.

## When an observer remains unproved

The report names the edge that lacks a reduction. Preserve the specification
while changing its enforcement; weakening an invariant to match a leaking
rule does not repair privacy.

- Maintained counts/sums: retain privacy fields as ordinary bare group keys
  and protect the aggregate with the same audience predicate. Recorded
  reference paths, calendar keys, derived values, private columns and temporal
  contributors need their own reduction; their names are not source fields.
- Owner fields: declare column-write intent too. `written by` authorizes
  patches even when the ordinary update rule denies. To prove a particular
  mutation's role authority, use a dominating current-role requirement and
  operation-specific intent over a role table the mutation cannot change.
  This does not prove every owner-field or old/next-image path.
- Raw rule probes: inspect the observing table and its writers. A protected
  target's read rule does not protect predicates probed from another rule.
  Apply the intended audience at that observer, or remove the raw dependency;
  the report retains the unsupported edge until it can establish implication.
- Cascade/set-null: automatic child changes bypass child write rules. An
  explicit authorized child mutation with `restrict` removes that automatic
  writer, but parent refusal/existence and transitive references remain
  separate observations. Read-through/live-parent authority requires a separate reduction.
- Jobs/native workers/actions: the audit names the trusted or opaque writer.
  An ordinary mutation with stable role requirements can prove that mutation's
  authority; arbitrary native/worker output cannot acquire a proof from a
  caller's role or a passing finite test.
- Schedules: use a stored `not before`/`expire at` lifetime for exact read
  boundaries, or compare server `now` in the write itself. A scheduled status
  update leaves the old status visible between deadline and sweep.

Default `test` challenges pure-schema applications through a private production
`serve`: unauthenticated calls, forged persona headers and development doors.
The host uses no pre-existing developer credentials or development mode. Applications needing
native/worker artifacts are explicitly not covered by that schema-only host.
Focused fixtures also enable short ordered mutation histories followed by
ordinary reads; traces record actual calls and current policy evaluation.
Named personas/service seats and enum argument combinations are enumerated
within reported limits. Asset challenges use real foreign-upload and verified
non-image ledgers; video arguments and unvisited histories remain named. Complete fixture stores preserve image/file ledgers, captures, read-through deadlines, maintained views and expiry. Histories include fixture principals and reference-row candidates, under a reported work cap. Neither
these finite campaigns nor an offline device's retained snapshot establishes
current-server revocation at a disconnected access.

### E_SECURITY_TARGET

E_SECURITY_TARGET means the invariant target does not name a declared table, column or effect. Correct the target name; inspect `audit` and the policy before changing a rule.

### N_SECURITY_INTENT

N_SECURITY_INTENT means access rules lack independent declared intent. Declare policy from the spec; inspect `audit` and the policy before changing a rule.

### N_BROAD_READ

N_BROAD_READ identifies universal or roster-wide readership; its message states the exact condition. Confirm the intended audience; inspect `audit` and the policy before changing a rule.

### N_GRANT_OUTLIVES_ROLE

N_GRANT_OUTLIVES_ROLE means a stored grant may survive a later role change. Recheck the current reader role; inspect `audit` and the policy before changing a rule.

### N_ARGUMENT_GRANT

N_ARGUMENT_GRANT means an argument becomes a reader-grant column. Validate the recipient role and relationship; inspect `audit` and the policy before changing a rule.

### N_OPTIONAL_EVIDENCE

N_OPTIONAL_EVIDENCE means optional media permits omitted evidence. Declare required media when the spec requires it; inspect `audit` and the policy before changing a rule.

### N_SWEEP_ONLY_DEADLINE

N_SWEEP_ONLY_DEADLINE means sweeps leave time between a deadline and cleanup. Enforce the deadline in the mutation; inspect `audit` and the policy before changing a rule.

### N_EXISTENCE_ORACLE

N_EXISTENCE_ORACLE means absence and later denial can reveal different outcomes. Unify the code and message when existence is private; inspect `audit` and the policy before changing a rule.

The isolated production HTTP campaign also signs in, refreshes the session,
logs out all sessions and retries both retired credentials against query,
mutation, schema, changes, sync, probe and refresh doors. It reports missing coverage
when ordinary identity or complete deployed worker artifacts are unavailable.
This checks server admission; a disconnected device can still retain old bytes.

### N_PRIVILEGE_ESCALATION

N_PRIVILEGE_ESCALATION identifies self-signup roles or role-grant operations that can confer authority trusted by other rules. Restrict assignment to authorized delegation; provision the first administrator with `guide staging`.

Identity rate refusals return HTTP `Retry-After` (seconds) and
`denied.retryAfterMs` (milliseconds), conservatively covering the 60-second
window. Wait that interval before retrying identity requests.

REL5 owns release transitions/old-client compatibility; MIG owns backfills and
staging clock control for day-two qualification.

### N_INVARIANT_RESTATES_RULE

N_INVARIANT_RESTATES_RULE means intent and the effective rule admit the same cases
in the bounded predicate kernel. Check the original requirement before rewriting; an equivalent policy
may be correct, but cannot detect a mistake copied into both declarations.

### N_ROLE_WIDE_READ

N_ROLE_WIDE_READ means a role-wide branch gated by a row value exposes every column
on matching rows.
Use a board/projection table for a public rating; declare intent for the private
notes, principals, images and files separately.
