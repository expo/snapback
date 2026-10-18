# Security invariants

State privacy intent separately from enforcement. Check reports proved, refuted
with a replayed counterexample, or unproved with a reason; passing finite tests
are not proofs.

```quarry
table privateNotes:
  patient: principal
  body: text 1..2000
  read <- .patient = viewer
  insert <- .patient = viewer
  online only
invariant privateNotes.read only .patient = viewer
invariant privateNotes.insert only .patient = viewer
query privateNote(note: privateNotes):
  return privateNotes[note]
mutation writePrivateNote(body: text 1..2000):
  return insert privateNotes { patient: viewer, body }
```

Run `snapback4 check`, `snapback4 audit` (or `check --audit`), then
`snapback4 test`. `audit --json` lists conditional row predicates, operations,
columns, inherited grants and grant writers. `check` names broad signed-in
reads and missing intent. The test command runs isolated schema-derived
challenges automatically and fails on replayed policy violations. Coverage
that needs a live HTTP server, fixture assets, operation sequences or a device
is named as not covered; zero violations alone does not qualify an app secure.

## Reference

`invariant table.read only P` protects read intent; insert, update and delete
name authority. `invariant table.column write only P` covers writes to a
column (both insert and update). `invariant table always P` states row integrity.
Predicates use the existing rule vocabulary: `.field`, `viewer`, `exists`,
comparisons, `and`, `or`, `not`. For a role write use the complete roster probe,
for example `invariant members.role write only exists roles[viewer, role = 'owner']`
in a schema declaring those tables. A declaration never grants authority.

The implemented proof fragment exhaustively checks independent three-valued
rule predicates. A failed implication is unproved until an engine replay
establishes a counterexample. A schema-valid seeded snapshot is not a claim
that an application operation sequence reaches that state. Required-column
non-null assertions have a separate validation theorem. General counts,
transitions, time and unsupported expressions stay explicitly unproved.
Read-through captures/live parents, derived aggregates, raw rule probes,
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
The grant-lifetime advice points at this pattern; the argument-grant advice identifies
arguments written into reader-grant columns: validate the chosen principal's
role and relationship, even when the caller is privileged.
Global admin authority must come from a trusted operator or existing admin;
a group-creation `created` probe must remain scoped to that group everywhere.
See `guide deploy` for first-admin setup and `guide sharing` for parent authority.

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
