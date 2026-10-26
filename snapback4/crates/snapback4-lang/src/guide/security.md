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

Run `snapback4 check` → `snapback4 test` → `snapback4 audit`. A passing default
check prints its verdict and language-enforcement summary; pending gates stay
visible. Use `snapback4 check --review` for advisory decisions and notes;
`--verbose` retains every reason.
Answer the rule questions from the product specification before editing intent.
The restating advisory names each admitted role and its row conditions: for
example, a coach branch with no assignment check asks whether coaches should
see other coaches' athletes. For every role, answer which rows, which columns,
and which status/consent conditions the spec permits. Include derived values
and downloads: hiding a diagnosis but exposing its category can reveal it.
Write that answer as independent read intent; repair a rule that admits more.
A matching or weaker assertion may still be the right simple owner policy:
keep confirmed intent. The advisory never refuses it or changes its verdict.
Review `snapback/generated/security-invariants.q.draft`: each role gets a row
question and a question for every column, including roles absent from the rule.
No candidate is accepted automatically. Use table-read intent for a shared row audience; add
column-read intent for distinct privacy boundaries. Assess every role and field
without automatically creating one assertion per question. For each role, identify
a positive grant from the spec or a necessary described workflow before retaining
access to another person's private data. Confirm intentionally shared fields
explicitly; an omitted denial is not a product grant.
Run check, test and audit again after confirming intent;
a refutation means fix the enforcement or the independently verified spec,
without widening intent just to make the result green.

Test synthesizes two users per discovered role/seat and related ownership rows
without fixture files, including password-only apps. These private in-memory
fixtures never open dev doors. Every failure labels its initial fixture origin:
`generated-fixture-trace` means an authored observation from a validated generated
initial state, not proof that app operations created that state. Author-supplied
fixtures retain `authored-fixture-trace`. Both fail acceptance on actual observed
violations; seed-only/synthetic table probes remain non-failing supplemental evidence.
Fixture-free tests report that no authored business cases ran. Finite passing
campaigns never prove security. Check bounds concrete exploration to 512 call/world
reservations; its default verdict never depends on elapsed time. Work exhaustion
stays unproved and points to the full test.
Explicit `--review`, `--verbose`, JSON and `--ack-security` also search
generated question witnesses with a separate deterministic 8192-work budget.
A separate fixed 3072-work current-source search obtains gate evidence in every
check mode and deploy. Without an admitted trace the question stays advice.
The opt-in search cannot turn advisory guesses into authored refutations;
exhausted questions retain an explicit unavailable witness.
`audit --json` retains all column audiences, grant writers, exclusions and uncovered
role/row/effect exposures. Audit returns the permission map with bounded check
evidence; run `test` for the full generated campaign. `audit --all` shows every
reason, without increasing the search. Declaring one effect does not cover the others.

## Reference

`invariant table.column read only P` protects a column value, derived values and value-dependent counts/existence/refusals. Mutation results, implicit final writes and explicit returned row objects are observers too. A query projection alone is not privacy: use column read rules to protect every operation. An authored projection excluding the column does not by itself disclose that value; filtering, ordering or copying it can. Audit JSON includes `column_audiences` (effective row rule plus private-owner gate). Unknown derived and opaque paths remain unproved.

`invariant table.read only P` protects read intent; insert, update and delete
name authority. `invariant table.column write only P` covers writes to a
column (insert, inserted insert-if-absent, update and both upsert arms).
A null creation or the declared `false` approval default is initialization, not an approval write. An explicit literal equal to the column's declared default also initializes authored `write only` intent at that insert source; caller-supplied values, later edits, positive approval/role defaults and structural `write <-` rules retain authority checks. Mandatory creation presence needs whole-row insert/write or always intent; non-null/non-default creation still requires P. Tests judge each executed write in a committed mutation, including intermediate writes. `invariant table.column update only P` checks
only edits, retaining old-and-next-image semantics; use it when creation is permitted
to a different role (for example counter staff creating a ticket price). `invariant table always P` states row integrity.
An update policy over `.field` constrains **both old and next images**.
A policy saying status must not be override therefore also restricts editing
a row that was already override, even when changing it away from that status.
For the role authority of one named mutation, use operation-specific intent
(`invariant table.operation only P`) instead. An operator `provision` result excludes only its own executed roster write from authored read intent; later queries and other results remain checked. General next-image-only and
cross-operation transition assertions still need a separate reduction.
Predicates use the existing rule vocabulary: `.field`, `viewer`, `exists`,
comparisons, `and`, `or`, `not`. For a role write use the complete roster probe,
for example `invariant members.role write only exists roles[viewer, role = 'owner']`
in a schema declaring those tables. A declaration never grants authority. Whole-row read intent also protects logical
existence: when occupancy totals are intentionally public but roster identities
are private, declare column read intent for those identities instead. Include
a service seat explicitly when the spec permits it; seats are ordinary checked
viewers, never implicitly exempt.

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
Text `min..max` counts visible Unicode scalar values (excluding whitespace, zero-width and format
characters, and Unicode 17 default-ignorable characters) toward the minimum;
the maximum counts all characters. Stored text is not trimmed or rewritten.
`trim` returns empty for invisible-only text. Other values keep ordinary
whitespace edge trimming and their format/presentation controls, including emoji.
Legacy format-only values remain readable; repair them through an authorized
mutation before writing that row again. If adoption rejects an invalid default
or old row, repair it with the previous binary before upgrading. Collect actual
replacement consent or evidence; the upgrade never invents it.
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

N_INVARIANT_RESTATES_RULE identifies matching enforcement or a weaker copy made
from the same predicates. Its per-branch questions name admitted roles, row
relationships and lifecycle conditions. Read the original requirement and answer
those questions before editing: a simple confirmed policy may be correct.
The advisory comparison never adds proof assumptions or changes a verdict.

### N_ROLE_WIDE_READ

N_ROLE_WIDE_READ names a role-wide table branch or a grouped set of columns
with the same role audience. It asks whether the spec permits that audience on
other owners' rows and every value of the named state/category columns. Those
values are evidence to review, not an inferred lifecycle policy. Use a
board/projection table for shared fields, or narrow row/column rules to the
confirmed relationship and state conditions. Declare private-column intent separately.

`test` uses generation when fixtures are absent or contain no rows, including
an empty starter fixtures directory. Populated authored fixtures stay selected;
seeded read and integrity violations fail under that explicit starting-state
assumption. Generated payloads run authored creation mutations, preserving
requires, immutable copies and recipient-role checks; declined populations are
coverage gaps. A recorded role change or relationship transfer is shown in the
counterexample history; a stale starting snapshot is not such a history.

A completed `test` records concrete refutations under
`snapback/generated/security-test.json`. The next `check` reports matching
failures even when its short campaign cannot rediscover them. Exact source,
fixture bytes and CLI identity bind the record; edits invalidate it. No cached
passing result proves security. Every escalation gate stays visible in short
output; advisory escalation notes require `check --review`. Rule-changing deploy previews print exposure counts and demand a test
for the selected source/fixtures when a matching full finite campaign is absent.

### N_SELF_CLAIMED_RELATIONSHIP

N_SELF_CLAIMED_RELATIONSHIP means a caller can write their own principal into a relationship that another table's
raw read rule trusts. The note names the mutation, relationship column and
reader rule. Require an invitation or approval by the resource owner before
assigning that relationship; a caller's role alone does not establish parenthood
or membership. Confirm intentional open enrollment against the spec.

### N_CALLER_TIME

N_CALLER_TIME means a caller-supplied time reaches a field used by a deadline comparison with the
server clock. The note follows aliases and helper writes and names the field
and mutation. Use server `now` for the event time, or require an explicit
server-relative bound before the write when the spec allows historical input.
Staging clock and schedule diagnostics are owned by DX5; see `guide time`.


### N_INSERT_WRITE_INTENT

N_INSERT_WRITE_INTENT names creation paths that supply a column without an
edit operation's restriction. Confirm whether creation is deliberately broader;
otherwise guard insert and both upsert arms and declare column write intent.

### N_COLUMN_RESULT_EXPOSURE

N_COLUMN_RESULT_EXPOSURE names columns omitted by query projections or guarded
by column rules that another result/refusal may observe. Review that operation's
intended audience; this is advice, not proof of a leak.

Rule-changing deploy and deploy --check lead with outstanding FIX/REVIEW items
and the last test result, timestamp and age. Stale evidence is labeled explicitly.
Deploy --strict refuses reachable refutations; unproved intent and advice still
need review. A matching completed finite campaign is evidence, never proof.

### E_SECURITY_REVIEW

E_SECURITY_REVIEW means strict rule-changing deployment refused because reachable
security intent is refuted. Repair enforcement to match independent intent and
rerun test for the selected source and fixtures. Unproved notes and synthetic-only
observations do not cause this refusal.

### E_SESSION

E_SESSION means a supplied client session is malformed. Pass the complete Session
returned by guest, login, signup or your service, including principal, kind, token
and positive integer expiresAt milliseconds; the online token option accepts a bare
bearer. Constructors refuse before transport, storage, device or timer work.
Shape validation grants no authority; the server still decides session validity.

## Individual security review

Default check prints a verdict and the language-enforcement summary. Pending
gates always print; advisory decisions and notes require `check --review` (or
--verbose/JSON). A gate blocks; an advisory does not. The verdict counts pending
advisories and points to --review. A decision with a concrete campaign witness
shows the admitted operation, caller, arguments, old/new row and inferred
candidate. An upsert's existing-row arm is an **edit**. Opaque text, JSON and
asset values in these generated witnesses are redacted. A finite witness is
behavior to judge against the specification, never a proof of safety.
Approval gates also require a coupled activation flag positively checked on the
exact row before recording approval. Unresolved applicability is advice; a trace
refuting an unconditional guess does not establish that the approval applies.
SEC10 gates require current concrete campaign evidence; unsupported or exhausted
questions stay advisory. Initial versus edit audience differences remain advice
because the broader initial path can be intentional; a projected edit guard
cannot reintroduce that same guess as a derived production FIX. Backfill equations are
advice unless independently authored as enduring intent.
Read the note, compare it with the specification, then use
`check --ack-security ID --reason 'specification rationale'` with its current ID
from check --review or `securityReviews[].id` in check --json. Repeat
`--ack-security ID` or pass comma-separated IDs to record several decisions
with the same reason atomically; an unknown/stale member writes none. Audience
family commands retain old member decisions when a new member appears; the new
member remains pending. Historical family commands select only their original,
still-current members. Bulk --ack-notes cannot clear these gates.
Commit snapback/security-reviews.json when the decision should travel with source.
Comments, line shifts and independent declarations preserve decisions. Changed
rule/column dependencies require advisory review again. A witnessed decision is
re-asked only when its canonical witness changes; a pending question shows the
new witness, never an old rationale. A witnessed reason must reference its witness
digest and explicitly permit its actual operation/caller with the printed
`permit OPERATION as CALLER` phrase; creation answers state `audience:` and intended
roles, while other answers state `intended effect:` and specification rationale.
The printed command gives the exact required form. Filler such as “one decision”
is refused atomically. The record never grants authority or proves safety. Audit retains the full
notes and dispositions. JSON names each decision's exact-column/rule or conservative
declaration/writer binding scope. Advisories accept individual decisions and stay
non-failing; the grouped table questionnaire has no separate review ID.
Declared refutations still fail and cannot be acknowledged.
Deploy --strict retains its refutation gate; run check in acceptance before deploy.

Optional arguments and optional columns are valid, including deliberate loosening.
A required child media column validates an existing attachment; it does not require
a child row. Guarded optional attachments need no acknowledgment. When independent
parent integrity intent requires a child, require evidence before creating that
parent. Without such intent, a conditional child is an advisory spec question. Reasons use text 1..N when nonempty justification is required; optional
money and constant payment/approval flags need independent specification review.
Transition advice asks whether a generic setter can bypass a stricter decision or
whether eligibility checked at creation must be rechecked at approval. Different
duration windows on one column may be deliberate: confirm them against the spec.
Role-wide write questions ask whether a global role may write every resource.
Model the owner of this particular wall; see `guide rule-recipes --section "Wall ownership"`.

Test explores directed status/eligibility histories up to twelve mutations with a
separate finite successor bound. Check keeps its shared deterministic 512-work limit.
Frontier, argument, signature and attempt cuts remain coverage gaps. Synthetic
observations are REVIEW, while actual admitted histories from validated generated
fixtures retain their generated-fixture-trace origin and can fail acceptance.

### N_RETAINED_ROLE_GRANT

N_RETAINED_ROLE_GRANT: A recipient role required when storing a grant is mutable and missing from a reader branch that trusts that grant, including column payload readers. Recheck current role or revoke derived grants. A current replay witness needs an individual disposition; without one this remains an advisory authority question.

### N_OPTIONAL_UPLOAD_CREATE

N_OPTIONAL_UPLOAD_CREATE: An optional upload argument can be omitted in a direct nullable-media write or a skipped child that independent intent requires. When independent intent requires a child, either require the upload before parent creation or always create the child with deliberately optional media; skipping the child on a null upload violates that presence intent. Optional media columns and guarded optional attachments do not require acknowledgment; a required child column alone does not require a child row. Type-required media is already validated at each executed write. A direct non-null assertion also enforces media at that write; neither requires a skipped child row. Unknown helper returns and nullable expression alternatives remain advisory/test coverage, without an inferred argument-omission gate. A parent-omission gate needs a direct straight-line parent insert whose prefix does not inspect the upload argument; helper or conditional parent prefixes require independent integrity tests. Without a current admitted trace this remains advice; an authored mandatory-presence refutation still blocks and cannot be acknowledged away.

### N_CREATION_REASON

N_CREATION_REASON: Creating a row accepts a reason argument without a positive non-whitespace minimum. Compare the justification requirement with the spec; use text 1..N when required. This name-based question is advisory.

### N_CREATION_MONEY

N_CREATION_MONEY: Creating a row accepts omitted money. Model and require the amount when the spec requires a fee or payment; confirm intentional optional amounts against the spec. This name-based question is advisory.

### N_CONSTANT_APPROVAL

N_CONSTANT_APPROVAL: Creation stores a constant true approval/payment flag. A true constant does not verify payment or approval; record the required amount/evidence and the independently authorized decision. This name-based question is advisory.

### N_TRANSITION_BYPASS

N_TRANSITION_BYPASS: A generic enum setter reaches a state also reached by a stricter decision mutation. Apply the decision authority to every path reaching that state; write independent transition intent and run test.

### N_STALE_CREATION_CHECK

N_STALE_CREATION_CHECK: A creator checks a mutable eligibility column that a later literal-state transition does not recheck. One question groups the created table, dependency and decision sites; immutable ownership reads and non-state payload edits are excluded. Decide whether eligibility must remain current and write independent intent; test create, eligibility change, approval. Any literal enum destination distinct from its default creation state can raise this question, including filled; no approval-word list determines eligibility. True approval flags also qualify.

### N_DURATION_BOUNDS

N_DURATION_BOUNDS: Operations apply different server-relative duration bounds to one column. Compare the windows with the specification and make them consistent or document deliberate differences.

### N_ROLE_WIDE_WRITE

N_ROLE_WIDE_WRITE: A global role plus viewer attribution does not identify the owner of this resource. Ask whether any role member may write any row; model the target-to-owner relationship and guard it. See the Wall ownership rule recipe.

### E_SECURITY_NOTES

E_SECURITY_NOTES: the individual disposition file is malformed, cannot be written, or sources changed while recording a review. Inspect snapback/security-reviews.json and run check --json for current IDs. Use the printed current-witness answer form for witnessed decisions, including its permitted operation/caller and intended audience/effect; unwitnessed advice accepts a nonempty specification rationale. Neither bulk acknowledgment nor this file can clear an authored refutation.

### N_CREATE_EDIT_ASYMMETRY

N_CREATE_EDIT_ASYMMETRY: An argument-supplied column has a specific change guard on edit that creation does not imply. The question names that column, editor and guard, rather than a table-wide permission. Confirm creation authority against the specification; enforce the change guard at creation when required and test independent column write intent with non-null input. Exact changed-field comparisons in a stable single-write editor are supported. Target keys must be fixed inputs/IDs, and the editor cannot change its authority dependencies. Mixed conditions, changed branch aliases, mutable selectors, multiple target writes and early-return equivalents remain outside this heuristic, with generic insert inventory retained when applicable. Absence of advice is not a safety proof.

### N_PRIVATE_CREATE_EDIT_ASYMMETRY

N_PRIVATE_CREATE_EDIT_ASYMMETRY: A caller can initialize a private column without its change guard and outside its column read audience. This question ranks above ordinary asymmetry because the caller supplies private agency data it cannot read. Confirm who may supply this field at creation; enforce the guard when required and test independent column write intent with a non-null value. Read privacy alone does not define write authority; the question is advisory.

### N_EVIDENCE_REMOVAL

N_EVIDENCE_REMOVAL: Delete, detachment or explicit clearing can remove parent-linked media evidence. The question names removing operations and the parent reference, grouping the evidence columns. Required child fields alone do not require a surviving child; confirm last-child retention against the specification. Guard deletion or detachment transactionally, replace evidence or retire the parent, then declare independent parent integrity intent and run test. Ordinary non-null photo replacement is not removal; optional attachments without required creation linkage or independent integrity intent are excluded. This question is advisory.

### N_TABLE_QUESTIONNAIRE

N_TABLE_QUESTIONNAIRE: Role-wide access and restating invariants share one table questionnaire. Answer from the specification; JSON retains every underlying note and individual decision ID. The grouped line is advisory and has no separate ID. This is a specification question, never a proof or a new gate.

### N_APPROVAL_NOT_ENFORCED

N_APPROVAL_NOT_ENFORCED: An approval flag, timestamp, or separately authorized parent-linked approval table is recorded, and a plausible modeled act does not require it. A current admitted trace makes this an individual review gate; without one it remains advice. Add the matching approval requirement before its governed effect; if the approval is an informational record, record that specification decision with `check --ack-security ID --reason '<spec rationale>'`. A query returning the approval is not a transition guard. Edit/version timestamps such as `authorizationRouteUpdatedAt` are ordinary metadata, including when checked as data. Use a distinct approval-event field such as `approvedAt` or independent intent when the domain needs an approval marker.

### N_EDIT_AFTER_APPROVAL

N_APPROVAL_INFORMATIONAL: No operation models the approved act. This advisory calls it an informational record and offers the individual acknowledgment as the default next step. It does not block deployment. Adding the governed effect can create a new approval question.

N_INSERT_TABLE_AUTHORITY: A table-only edit restriction remains advisory. Confirm the declared table insert and edit audiences against the specification; this note does not establish a distinct mutation require.

N_INSERT_WRITE_INTENT: A mutation requires stricter authority to edit caller-controlled columns than an insert requires to create them. This individual gating question asks whether that asymmetry is deliberate. One matching `invariant T.c update only P` answers the named column; a column `write <- P` enforces its authority at creation too. An individual acknowledgment records the deliberate asymmetry for a grouped question. A table-only edit restriction remains advisory as N_INSERT_TABLE_AUTHORITY.

N_EDIT_AFTER_APPROVAL: A checked value or media artifact can change without a positive creation-state restriction. Decide whether approval must be renewed after edits or replacements; declare column update intent. To freeze approved evidence use `immutable photo when .approved = true` from the complete rule recipe. This is a specification question, never a proof or a new gate.

### N_CHILD_EVIDENCE_PRESENCE

N_CHILD_EVIDENCE_PRESENCE: A separately created media child is not required by a parent transition. Required child fields do not require a child row. Declare parent integrity intent with the specification's draft-state exceptions. This is a specification question, never a proof or a new gate.

### N_TIME_TRANSITION

N_TIME_TRANSITION: A missed, overdue or expired state is written without a server-clock comparison. Confirm the relevant deadline against the specification and test both sides of its boundary. This is a specification question, never a proof or a new gate.

### N_GUARD_NOT_CONSUMED

N_GUARD_NOT_CONSUMED: A transition checks a related state or Boolean without consuming it. Decide whether the guard represents one-use authorization and test repeat transitions. This is a specification question, never a proof or a new gate.

### N_CALENDAR_DURATION

N_CALENDAR_DURATION: A 365-day multiple may differ from a calendar anniversary. Decide fixed elapsed days versus a calendar date and test leap-year boundaries. This is a specification question, never a proof or a new gate.

### N_DEPENDENT_WINDOW

N_DEPENDENT_WINDOW: A written deadline is bounded against now without consulting a dependent stored deadline. Confirm the window base and enforce the actual resource deadline when required. This is a specification question, never a proof or a new gate.

## Structural column protection

See `guide rule-recipes` for column protection and deploy refusals. Derived policies
accept individual decisions; authored refutations require repair. Concrete tests
retain unknown results and coverage gaps.

### N_DERIVED_WRITE_AUTHORITY

N_DERIVED_WRITE_AUTHORITY identifies an inferred candidate from authored change
guards or approval data. Enforce the candidate or record its individual specification
decision; only concrete replayed violations of sufficiently precise contracts
refuse deploy, never a failed abstract implication. Backfill-derived label
formulas remain advice: a migration initializer does not establish the column’s
ongoing meaning when a setter intentionally chooses other values.

A derived approval/edit violation requires approval to survive the edit. Clearing approval in that edit invalidates it; this is not a derived FIX. Authored `immutable c when P` still uses its stricter old-image constraint.

### N_PRESENCE_LOOSENING

N_PRESENCE_LOOSENING identifies a required-to-optional column change. Declare
presence intent or an individual specification decision. Successful check advances
a local generated baseline; production compares the selected release independently.
A fresh checkout has no invented predecessor. Deliberately optional evidence can
state `invariant evidence always .photo = null or .photo != null`.


### N_TEXT_EVIDENCE

N_TEXT_EVIDENCE: A text column names photo, scan, sketch or image evidence.
Use an image column and image argument for verified uploads; require presence
at the governed boundary when the specification requires evidence. Intentional
text references may remain text. This question is advisory.

### N_MEDIA_PRIVATE_FIELDS

N_MEDIA_PRIVATE_FIELDS: Media has the whole-row audience beside narrower
private fields. Decide whether the scan carries those fields. Apply the private
audience with image read <- P, or declare independent media read intent and test
the broader audience. This question is advisory.

### N_BLANK_TEXT_GUARD

N_BLANK_TEXT_GUARD: An empty-string justification guard admits whitespace from
a minimum-zero input. Require trim(value) != '' for the same justification,
or use text 1..N on every supplied justification. Without a concrete current
campaign witness this is advisory; repair the named input or declare the intended
whitespace-sensitive comparison explicitly.


### Approval contracts and text evidence

An approval required on one effect derives a candidate for sibling effects and
reference-linked continuations. Approved Bool, Enum and Principal inputs are
included in approve/edit replay. Parent/child stage and repeat-create candidates
retain their inferred origin. Resource branch conditions retain their scope as conditional prerequisites. A caller-only condition that cannot map to that resource remains uncovered; store the condition on the resource or declare explicit operation intent and rerun `check` then `test`. Status prerequisites are checked immediately before entering the selected destination; the same update may consume its approval. Unrelated edits and same-status writes do not repeat that effect. Parent completion checks all matching child stages at commit, so a mutation may finish its children atomically; partial or unrelated child updates do not satisfy it. Only an actual replayed violation refuses production;
an intentional alternative path takes one individual candidate decision. Run
`test`, repair the named effect or record its exact `check --ack-security` ID.

N_TEXT_EVIDENCE asks whether photo/scan/sketch text should instead be a verified
`image` column and image argument. Presence remains a separate specification
decision. N_MEDIA_PRIVATE_FIELDS asks whether media carries the private fields
beside it; apply the corresponding column audience with `image read <- P`.

`text 1..N` counts visible characters for its minimum, excluding whitespace,
zero-width/format and Unicode 17 default-ignorable characters. Optional
minimum-zero text permits whitespace. N_BLANK_TEXT_GUARD asks about
reason/consent/assessment empty-string checks on such inputs; it stays advisory
without a concrete current witness. Require
`trim(value) != ''` for the same justification or use positive text minimums on
all supplied values. A deliberate whitespace-sensitive comparison can be
individually acknowledged. Existing stores are not rewritten; these semantics
already apply on ordinary writes and argument validation.

Default `check` and production deploy explore fixed work budgets. Elapsed time
is telemetry and cannot change a completed campaign verdict. Finite work cuts
remain explicit coverage gaps; a passing finite campaign is never proof.


### Enforce the recorded decision

This complete example uses the same nonblank guard on a minimum-zero input,
a positive minimum on another input, an approval requirement at the effect,
and a media audience independent of the row's broader audience.

```quarry
use personas clerk
table docs:
  owner: principal
  approved: bool default false
  status: enum('draft','done') default 'draft'
  reason: text <=30 ?
  scan: image <=10000 ? read <- .owner = viewer
  read <- allow
  insert <- .owner = viewer
  update <- viewer = 'dev:clerk'
  online only
mutation create():
  return insert docs {owner:viewer}
mutation approve(doc: docs,value: text <=30):
  require trim(value) != '' else EMPTY_REASON
  update docs[doc] {approved:true,reason:value}
mutation finish(doc: docs):
  d = docs[doc] ! else NOT_FOUND
  require d.approved else NO_APPROVAL
  update docs[doc] {status:'done'}
query required(value: text 1..30):
  return value
```

Run create, pass its returned id to approve with a nonblank value, then finish.
Production role authority belongs in the table and operation policies for the
application's real identities; this local example isolates the decision guard.
The scan is deliberately optional and readable only by its owner.


Current-input backfills plus generic setters ask an advisory label-consistency
question. A migration formula does not establish the column’s ongoing meaning;
intentional setters may choose other values. If the formula is enduring intent,
declare it independently as an invariant and test it. Predecessor migrations,
self-input backfills and constant fills do not establish such intent.

Co-created participant charges with stable typed identities and an authored
refund path derive participant-conservation candidates. A committed participant
removal must retain a matching full refund or be refused. Refunds may be written
before or after the delete in the same transaction. Partial refunds or another
participant's refund do not satisfy this candidate. A deliberate no-refund
removal takes one individual security decision. Unsupported or mutable ledger
shapes remain coverage gaps; finite exploration never proves conservation.
Derived effects run before general observers on each generated fixture; bounded
production replay retains explicit coverage for paths it did not explore.
