# LLP 0234: Visibility override governance

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Security/authorization, Background work, Code generation, Generated artifacts, Testing, LLP governance
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-12
**Revised:** 2026-08-15 (distinguish LLP 0231 D7 call-local handler reads from governed invocation overrides)
**Related:** LLP 0000, LLP 0011, LLP 0053, LLP 0056, LLP 0070, LLP 0170, LLP 0172, LLP 0173, LLP 0189, LLP 0225, LLP 0230, LLP 0231

## Summary

**Recommendation: a production override is a time-bounded, content-approved
exception to one table policy, admitted from a remotely prior record and
ratcheted as an exact set — never a string that the widening change can add for
itself. A fixture override is non-expiring only behind a production activation
fence.**

LLP 0231 made the table the visibility-policy locus. It defines every
non-conjunctive read as an override and fixes the minimum declaration shape:
schema-level, never inline in a query; named scope and justification; projected
for review; and backed by an acceptance test. It then fails every override
closed until this sibling decides authority, separation, expiry, and ratchet
(`llp/0231-entity-and-permissioning-recommendation.rfc.md:199`,
`llp/0231-entity-and-permissioning-recommendation.rfc.md:210`). This RFC keeps
that shape and extends it with six required facts:

1. a stable override id and one closed, data-layer-enforced scope;
2. an accountable implementation owner and authority mode;
3. a content-bound approval record from an authorized approval owner;
4. a production or fixture lifecycle class;
5. an absolute expiry for production authority; and
6. an exact-set ratchet entry.

An author may propose an override. Proposal is not waiver authority. In this
repository the default approval authority is Charlie Cheever, the author and
ratifier. He may delegate a bounded path or subsystem to a durable approval
owner through a committed author ruling. Agents may author proposals, perform
reviews, and record an already-issued ruling; an ephemeral agent name is not
approval authority. This matches the repository that exists: AI agents are the
first-class builders (`llp/0000-snapback.explainer.md:425`), while the durable
cross-cutting decisions are author rulings.

Approval and widening land in two **remote-observed** steps. First, an
authorized owner pushes an immutable approval record and its resolvable ruling
and review artifacts. Only after the remote contains that closed record may a
second push add the declaration and exact-set baseline entry. Codegen checks
only that the current tree contains a matching, internally consistent approval;
the pre-push gate alone compares against every updated remote ref's merge-base
and refuses same-push self-approval. Two commits in one push therefore fail.
Reviews bind the proposed content digest, not a quiet `main`, following LLP
0189's content-not-HEAD rule
(`llp/0189-verification-cadence-and-claim-gating.decision.md:181`).

Every **production** grant lasts 90 days by default. Generation and activation
warn throughout the final 30 days. At expiry, generation, activation, and an
override-backed read fail with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED`. A declared fixture grant is
non-expiring only because its bundle is machine-fenced from production
activation and carries no real principals or real user data. Custom production
renewal requires a new, remotely predecessor-landed approval; a closed pattern
renews once at pattern level rather than once per instance. Any widening is a
new grant.

The ratchet also covers ordinary table-policy widening. A restricted table may
not be changed to `public-read`—or to any broader or incomparable ordinary
policy—in the same push that invents its transition approval. New
`public-read` tables are governed too. Deleting an expired override and making
the whole table public is therefore a refused widening, not an escape hatch.

The scheduled modes do not collapse:

- `system` is principal-free and therefore needs a governed override whenever
  it reads outside a table's ordinary policy;
- `revalidatePrincipal` evaluates that ordinary policy against the current
  principal and is not an override merely because execution is delayed; and
- `capturedGrant` is a governed override subtype, not silent first-class
  authority. Its runtime grant is narrower and shorter-lived than the schema
  waiver, but it still authorizes outside the caller-keyed table policy.

This discharges LLP 0231 OQ6's design prerequisite. It does **not** make
overrides generatable today. The present table surface warns on omission and
states in code that the fail phase is blocked on override governance
(`packages/snapback-codegen/index.mjs:2507`,
`packages/snapback-codegen/index.mjs:2513`); the manifest's closed table-policy
union has no override variant (`src/manifest.rs:1256`). This Draft becomes an
implementation authority only after acceptance and a separately verified
implementation.

## Evidence and current boundary

### What ships

- Table visibility authoring accepts `public-read`, `owner`, `membership`, and
  a bounded `any-of`; its declarations are closed and typed
  (`packages/snapback-codegen/define.mjs:1277`,
  `packages/snapback-codegen/define.mjs:1294`).
- A table with no declaration currently emits
  `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` as a warning. Its remediations are
  non-machine-applicable and require approval
  (`packages/snapback-codegen/index.mjs:2510`,
  `packages/snapback-codegen/index.mjs:2534`). D2's fail phase has not shipped.
- Search indexes already refuse omitted visibility with
  `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED` and name an explicit
  `public-read` repair (`packages/snapback-codegen/define.mjs:897`). This is the
  shipped end-state precedent, not evidence that table overrides exist.
- The Rust manifest carries the table policy and documents that arbitrary
  handler reads remain outside the bounded implementation slice
  (`src/manifest.rs:1218`).
- The current one-off jobs slice runs callees under the same system authority
  as cron; `revalidatePrincipal` and `capturedGrant` remain on its honest-gaps
  list (`llp/0070-durable-background-work.rfc.md:409`).

The charter-mandated search found no visibility-override declaration or grant
carrier in `packages/snapback-codegen/` or `src/manifest.rs`. The only
`override` field in the searched manifest file was an unrelated local-loopback
test field (`src/manifest.rs:13136`). This is a scoped negative inventory, not
a claim about files outside that search.

### What the prior-art survey does not contain

LLP 0230 surveys data-layer enforcement and explicitly leaves the recommendation
to LLP 0231 (`llp/0230-data-layer-authorization-prior-art.research.md:28`). A
mechanical search of that document found no `waiver`, `exception`, `approval`,
or `governance` entry, and its open questions cover enforcement rather than
exception administration (`llp/0230-data-layer-authorization-prior-art.research.md:371`).
It supplies **no prior art for waiver governance**. This RFC therefore cites no
external waiver-governance system. Its closest verified analogue is the
repository's own LLP 0225 ownership ratchet.

### The closest shipped governance analogue

LLP 0225 freezes pre-existing forbidden edges without blessing them, compares
an exact committed baseline with a predecessor, and permits genuinely new
coupling only through a time-bounded machine record with a named inversion
owner and deadline (`llp/0225-core-modularization.decision.md:195`,
`llp/0225-core-modularization.decision.md:202`). The shipped checker refuses
silent baseline growth, requires a matching worklist record, and checks expiry
before it writes an updated baseline
(`scripts/check-module-ownership.mjs:875`,
`scripts/check-module-ownership.mjs:901`). Its adversarial record confirms that
same-tree laundering and manual baseline growth are refused
(`issues/closed/20260810-ownership-gate-analyzer-gaps.md:168`).

This RFC reuses the exact-set merge-base comparison, machine record, named
owner, production deadline, typed-refusal shape, provenance-bound re-keying,
and exact comparison between attributed records and their committed source
artifacts. It does not reuse LLP 0225's softer expired-waiver behavior: a
forbidden module edge is engineering debt, while an expired production
visibility exception is live read authority. Production visibility expiry
fails closed at execution.

## Decision

### D1 — an override is an alternate, invocation-bound table policy

LLP 0231's definition remains binding. An override is:

- declared at schema level and never inline in a query or `ctx.db` call;
- named by a stable id;
- limited to named functions or generated operations, named tables, read
  operations, an authority mode, and a declared row scope;
- justified in prose;
- projected in LLP 0173's authorization-review surface; and
- backed by an acceptance test demonstrating its intended breadth.

LLP 0231 D7's `ctx.db.elevated` is deliberately not this object. It is a
call-local Class-R read authority available only inside trusted named query and
mutation code, visibly selected at the read call after application-owned
authorization logic. It cannot be activated by an action, direct/generated
plan, schedule, function declaration, schema rule, or caller argument; it
cannot widen writes, masking, egress, assets, bounds, or capture/OCC. It carries
no alternate row-scope program and grants no invocation-wide authority.
Scheduled/no-principal work and any reusable alternate policy remain governed
overrides under this RFC. Treating D7 as a schema override would force every
ordinary server-side authorization check through remote approval custody;
treating governed overrides as D7 would erase their lifecycle and approval
controls. The two authorities therefore remain distinct.

This RFC **extends** that pinned shape. Every override additionally declares:

- `owner`: the accountable implementation owner;
- `authority`: `system` or `capturedGrant`, plus the exact entrypoint or
  issuance profile on which it may activate;
- `lifecycleClass`: `production` or `fixture`;
- `expiresOn`: the absolute last valid UTC date for `production`, and absent
  for `fixture`;
- `approval`: the content-bound approval-record id; and
- `acceptance`: a stable test id and repository-relative test path.

The row scope uses the same closed, composable policy IR as table visibility.
It may name a conjunction, the already-admitted bounded disjunction, or an
explicit `allRows: true`. A conjunction inside the alternate override scope is
not an LLP 0231 refinement: a refinement is ANDed with the ordinary table
policy, while this conjunction replaces that policy for one invocation-bound
path. The host composes the alternate scope into every covered read. An opaque
JavaScript handler may choose which covered read to perform, but it does not get
rows outside the host-applied override scope. If a future scope cannot be
composed at the data layer, generation refuses it; an acceptance test does not
turn opaque handler code into enforcement. LLP 0170 is explicit that JavaScript
`reads` is dependency evidence, not result provenance
(`llp/0170-authorization-obligation-feasibility.research.md:18`).

`allRows: true` is valid because moderation, aggregates, and global maintenance
sometimes really do span every row. It is always projected as `breadth: all`
and cannot be derived by omission. Treating omission as all rows would recreate
the fail-open default D2 removes.

The override activates only when **both** the named operation and the declared
authority mode match. A function callable by a user and by cron therefore uses
the ordinary table policy for the user call and the override only for the
`system` invocation. Binding only the function name would let a client-visible
call borrow scheduled authority.

This RFC governs reads. LLP 0231 D6 places read and write policy at one table
locus, but the write and egress sibling still owns insert/update/delete and
return/copy semantics (`llp/0231-entity-and-permissioning-recommendation.rfc.md:385`).
An override declaration may list writes only as non-authoritative review facts;
it grants no write authority under this RFC.

Nor does an override mint a role or move membership into a credential.
Memberships remain ordinary app data in a system-recognized shape
(`llp/0056-scoped-roles-and-memberships.rfc.md:127`). LLP 0011's eventual write
contract is two-sided — insert checks the new row, update checks old and merged
rows, and delete checks the old row (`llp/0011-auth-and-permissions.rfc.md:190`).
LLP 0056 explicitly does not yet claim that general contract
(`llp/0056-scoped-roles-and-memberships.rfc.md:851`), so this read-governance
RFC cannot smuggle it in through a system label.

**Failure prevented:** an inline or function-wide escape silently becoming a
general bypass for every caller, every row, or both.

### D2 — proposal authority and grant authority are different

Any schema author may propose an override. Only the approval owner for that
path and scope may grant it.

The repository carries a committed, codeowners-style authority map:

```text
snapback/visibility-override-owners.json
```

Each entry binds a repository path or generated-pattern id to:

- one stable implementation-owner id;
- one stable approval-owner id; and
- the author-ruling reference that created the delegation.

In this repository the fallback approval owner is
`author:charlie-cheever`. A narrower owner may be delegated only by a committed
Charlie Cheever author ruling. The delegation itself must land before any grant
that relies on it. An owner-map edit may narrow or remove a delegation in an
ordinary change; adding an owner or widening its governed paths requires a new
author ruling.

The implementation owner and approval owner are distinct roles even when this
small repository has only one human ratifier. Agents are expected proposal and
review authors; they are not durable grant principals merely because they can
write `Claude`, `Codex`, or a task name into JSON. A service identity may become
an approval owner only if an author ruling binds it to an authenticated
repository mechanism. No such agent approval identity is verified here.

A closed generated pattern may carry one pattern-level approval instead of a
human ruling for every instance only when all of these are true:

1. the constructor fixes the authority mode, target class, policy grammar, and
   maximum row scope;
2. instance parameters can only narrow that scope;
3. each instance still has its own id, production expiry or fixture binding,
   projection row, ratchet entry, and acceptance test; and
4. a constructor-version change that can widen authority is a new grant.

A production pattern approval carries the same maximum 90-day lifetime as a
custom production approval. Each instance references the pattern approval and
expires no later than it. Renewal is **one new remotely prior approval for the
unchanged constructor version**, with a fresh pattern acceptance receipt;
every instance that still derives as a structural subset may consume that
renewal in the later widening push without its own approval. An instance whose
parameters no longer derive, or a constructor change that can widen, leaves the
pattern lane and needs a new grant. Fixture patterns do not renew because their
non-expiring authority cannot activate outside the fixture profile.

The membership expiry sweep is the kind of generated surface that could qualify.
An arbitrary `systemRead(tableName)` constructor cannot: accepting a table name
is authority creation, not derivation.

**Failure prevented:** the repository pretending that an ephemeral reviewer
string or a reusable free-form helper is waiver authority.

### D3 — widening requires a remotely prior, artifact-closed approval

Approval is a separate, immutable file:

```text
snapback/visibility-override-approvals/
  <approvalId>.<scopeDigestVersion>.<scopeDigest>.json
```

It contains:

```text
schemaVersion
scopeDigestVersion
digestAlgorithm
approvalKind
id
scopeDigest
patternId
constructorVersion
constructorDigest
lifecycleClass
requestedBy
approvedBy
ownerMapDigest
issuedOn
expiresOn
justificationDigest
acceptanceId
acceptancePath
reviewArtifact
reviewRecord
approvalRuling
rulingRecord
delegationRuling
delegationRecord
```

`schemaVersion` versions the approval-file shape. `scopeDigestVersion` versions
the canonical policy serialization independently, and `digestAlgorithm` is
explicit (`sha256` in v1). `scopeDigest` covers approval identity (override id,
or pattern id and constructor version), lifecycle class, authority mode and
entrypoint/issuance profile, operations and tables, read kinds, row scopes,
production expiry (or the fixture sentinel), acceptance identity, and
justification digest. It contains no absolute path and no repository HEAD. A
reviewer can therefore approve proposed content while `main` moves, without
leaving canonicalization changes implicit.

The schema is discriminated by `approvalKind`. A `custom` record's `id` and
`scopeDigest` match one override exactly and its pattern fields are absent. A
`pattern` record instead binds a stable `patternId`, `constructorVersion`,
`constructorDigest`, maximum normalized authority, lifecycle class, and
production expiry. Each derived instance retains its own id and scope digest in
the D5 baseline plus a machine-readable derivation record. Its `approval`
pointer names the pattern record, and “matching” means the generator proves the
instance is a structural subset of that ceiling and expires no later—not that
the instance digest equals the pattern digest. Pattern renewal replaces the
ceiling approval once as D2 specifies; it never fabricates per-instance custom
records.

There are two enforcement loci, and they have different jobs:

1. **Codegen is history-independent.** It checks the current source tree for a
   matching approval record, validates its digest and owner-map membership, and
   validates the artifact closure below. A missing or mismatched record refuses
   generation and writes no outputs:

   ```text
   SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED
   override <id> adds or widens <scope>; add a matching content-bound approval
   record before generating
   ```

   Codegen does not inspect Git history. This keeps shallow clones and exported
   sources deterministic.
2. **The repository pre-push gate enforces separation.** For every remote ref
   being updated, it computes the pushed tip's merge-base with the remote's
   advertised old object and runs the same widening comparator as D5. The
   matching approval and all artifacts it binds must exist unchanged in that
   merge-base snapshot. If they first appear anywhere in the pushed commit
   range, the push refuses:

   ```text
   SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL
   override <id> approval is not present at remote merge-base <oid>; push the
   approval closure first, then push the widening
   ```

Two commits in one push fail because neither commit is present at the remote
merge-base. A first push containing only the approval closure followed by a
second push consuming it succeeds. “Predecessor” means this merge-base rule
everywhere in this RFC; it never means merely an earlier local commit.

The three pointer fields are repository-relative paths to committed artifacts,
not descriptive strings. The review artifact embeds a machine-readable
`reviewRecord` covering the exact digest, acceptance design, and the
ordinary-policy/`revalidatePrincipal` alternative. The approval ruling embeds a
`rulingRecord` covering the exact digest, approver, owner-map digest, lifecycle,
and issue/expiry facts. A non-default approver's author ruling embeds the exact
`delegationRecord` carried by the owner map; for the default author the pointer
and record are both `null`. Codegen and the push gate resolve each non-null path,
parse the embedded record, and require JSON deep equality with the corresponding
record repeated in the approval file. Codegen refuses missing, malformed, or
unequal artifacts without asking whether Git tracks them. Pre-push additionally
requires every closure member to be tracked and unchanged at the remote
merge-base. Either locus fails its applicable defect with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID`. This mirrors the shipped
module-ownership gate's exact attributed-record comparison
(`scripts/check-module-ownership.mjs:871`): inventing a plausible ruling string
is no longer enough; the closed committed artifacts must agree.

A canonicalization or digest-algorithm change increments
`scopeDigestVersion`. It may re-key a **proven pre-existing** approval without a
new grant only through a committed re-key record naming the old and new
versions/digests, the tool change, the predecessor approval, and substantive
provenance. The gate runs both retained canonicalizers over the merge-base
declaration and admits the re-key only when their normalized authority is
structurally equal and no authored fact changed. This carries forward LLP
0225's re-key-with-provenance rule
(`llp/0225-core-modularization.decision.md:202`). A serializer change the gate
cannot prove equivalent, any policy/lifecycle/acceptance change, or any change
to `justificationDigest` requires a fresh remotely prior approval. The re-key
record may land with the mechanical migration because its executable equality
proof shows it grants no new authority.

This mechanism guarantees **remote-observed record separation**, content
binding, and referential integrity. It does **not** prove that two minds operated
the keyboard. The same agent could prepare both pushes, forge `requestedBy`, or
fabricate mutually consistent artifacts; Git authorship and repository prose
are not secure identities. If Charlie authors and approves the same widening
across two pushes, no in-repository machine can constrain the repository's
sovereign author. Cryptographically authenticated approvals remain OQ1.

This is still materially stronger than a same-change waiver. LLP 0170 names the
defect precisely: a free-text waiver beside the failing operation is cheaper
than understanding the policy and can be added by the change that creates the
hole (`llp/0170-authorization-obligation-feasibility.research.md:119`).

**Failure prevented:** same-push self-approval, dangling or inconsistent ruling
pointers, and approval drift after reviewed content changes; the remaining
human-identity limit is stated rather than overclaimed.

### D4 — production authority expires; fixtures cannot become production

The default and maximum production grant lifetime is 90 days from `issuedOn`.
`expiresOn` is mandatory for `lifecycleClass: production`, is generated from
neither wall clock nor omission, and is forbidden on a fixture record. An
approval owner may choose a shorter production lifetime. A longer grant
requires an explicit Charlie Cheever author ruling naming the exceptional
duration and why a closed generated policy is not the right abstraction.

Generation and activation emit
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING` throughout the final 30-day
window, starting at 00:00:00 UTC 30 calendar days before `expiresOn` and ending
when the grant expires. The diagnostic names the override, owner, expiry,
renewal command, and affected functions/tables. The warning is advisory;
production authority stops at the boundary.

At 00:00:00 UTC after the last valid `expiresOn` date:

- generation fails and writes no outputs;
- activation of a bundle carrying the expired grant fails; and
- an already-active override-backed read refuses before storage access.

All use the same stable code and message:

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED
table visibility override <id> expired on <date>; remove it or push a
separately approved renewal before using its authority
```

Execution checks trusted host time, never caller input. An already-running
deployment therefore cannot keep an override alive forever by avoiding
generation. The refusal may stop a maintenance job; it must not fall back to
`allRows`, `public-read`, or an ordinary policy with guessed semantics. D5's
ordinary-policy ratchet separately prevents an author from deleting the
expired override and widening the whole table to escape this refusal.

A fixture override is for a repository-registered demo or acceptance app with
synthetic principals, fixture-owned data, and no production-capable activation
path. Codegen stamps its bundle `fixtureOnly` and binds the stamp to the app's
committed fixture-profile record. The host accepts that bundle only in the
matching isolated fixture profile and refuses it in every production, hosted,
or undeclared profile before loading data:

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY
table visibility override <id> is fixture-only and cannot activate in profile
<profile>
```

Fixture grants remain content-approved, artifact-closed, acceptance-tested, and
ratcheted, but they do not expire or read wall-clock time. Changing the app
registration, target profile, data/principal class, or `lifecycleClass` so the
grant could leave the fixture boundary is incomparable growth and requires a
new production grant. A demo wired to real credentials, imported user data, or
a production-capable deployment is production for this rule even if its
directory is named `demos/`. Thus the two-hour regenerate-and-compare backstop
does not manufacture quarterly reds from the synthetic demo corpus, while a
real production grant still fails closed on schedule.

Custom production renewal is not an edit to `issuedOn`. It is a new immutable
approval record referencing the previous grant, with a recently passing
acceptance receipt and a fresh justification of continued need, pushed before
the renewal change. An unchanged approved pattern follows D2's one-renewal-per-
pattern rule; derived instances consume that remotely prior pattern renewal
without individual approvals. Equal or narrower authority is a renewal. Adding
a table, operation, entrypoint, authority mode, role, disjunction arm, row
population, or fixture-to-production reach is a new grant. Extending production
time is authority growth and cannot be approved in the renewal's own push.

**Failure prevented:** a temporary production escape becoming permanent,
synthetic fixtures generating recurring main reds, or a fixture declaration
becoming a production back door.

### D5 — exact ratchets cover overrides and ordinary-policy widening

Codegen emits and the consumer commits two deterministic records:

```text
generated/visibility-override-baseline.json
generated/table-visibility-policy-baseline.json
```

The first contains one canonical entry per active override:

```text
id
scopeDigestVersion
scopeDigest
lifecycleClass
authorityMode
operations[]
tables[]
rowScopeDigests[]
owner
approvalRecord
approvalClosureDigest
expiresOn
acceptanceId
```

Entries and all set-valued fields are sorted. The baseline binds to the same
generation inputs as the schema/functions pair. A count is explicitly
insufficient: replacing one narrow override with one global override preserves
the count while widening authority.

For each updated remote ref, the pre-push gate compares the pushed exact set to
the D3 merge-base snapshot with one comparator. It admits removal, earlier
production expiry, fewer operations/tables, and structurally narrower row
predicates. It treats a new id, later expiry, fixture-to-production change, new
authority mode or entrypoint, more operations/tables, or a broader/incomparable
predicate as growth. Growth is valid only when every new ceiling has a matching
approval closure already present unchanged at that remote merge-base. The
declaration and baseline may then land together because authority was admitted
in the earlier push.

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH
table visibility override baseline adds or widens: <canonical scopes>; each
scope needs a matching remotely prior content-bound approval; counts are not
authority
```

The second baseline contains every table's normalized ordinary visibility
policy and policy digest. Its structural partial order uses the same closed
policy IR: fewer admitted principals/rows is narrower, `public-read` is the
maximum, and anything the comparator cannot prove narrower or equal is
incomparable. A broader or incomparable transition—including restricted to
`public-read`—requires an immutable transition approval at:

```text
snapback/table-visibility-policy-approvals/
  <table>.<transitionDigest>.json
```

The transition digest binds table id, prior policy digest (or `null` for a new
table), proposed normalized policy and digest, justification, acceptance
identity, owner-map digest, and the approval/review/delegation records. The D3
history split and artifact-deep-equality rules apply unchanged. Codegen checks
that the current tree carries the matching transition closure; pre-push checks
that it was already present at every relevant remote merge-base. A new
restricted table is not widening because it exposes no predecessor data to a
broader audience. A new `public-read` table is growth and needs the prior
transition approval.

```text
SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH
table visibility policy adds or widens public authority: <canonical changes>;
push each content-bound transition approval before pushing the policy change
```

Ordinary-policy transition approvals do not expire: they authorize a durable
policy-program decision rather than temporary alternate authority. They do make
that decision remote-separated, content-bound, artifact-closed, and auditable.
Consequently, deleting an override while changing its table from restricted to
`public-read` is still a policy growth event and cannot be an expiry repair
without a separately approved first push.

During G1 only, the initial policy baseline may record policies that predate the
gate. Its migration closure receipt binds the exact source revision, lists each
`public-read` table individually, carries the approval owner's ruling, and is
reviewed before G2. It cannot freeze an override or a policy edit introduced
after that cut. After activation, no ordinary-policy growth is grandfathered.

Codegen validates that both current-tree baselines exactly match current
declarations without consulting Git. The repository-mode `--update-baseline`
and pre-push path accept explicit remote merge-base snapshots and run the growth
comparators before writing or pushing, like the shipped module-ownership
checker does (`scripts/check-module-ownership.mjs:1073`). Neither updater can
launder same-push growth. A stale baseline, an entry without a live declaration,
or a declaration absent from its baseline fails; baselines are review and
ratchet records, not alternate runtime authority.

Removing an override deletes its active baseline entry in the same change.
Approval files remain immutable historical evidence or move to an archive under
repository policy; they do not keep authority alive after the declaration and
active baseline entry disappear.

Adding, renewing, narrowing, or removing visibility authority is
authorization-metadata activation, not an ordinary data write. The complete
successor bundle stages and validates before atomic activation, which fires LLP
0053's enumerated event 2
(`llp/0053-authorization-invalidation.rfc.md:448`). Existing live results never
keep the predecessor authority program merely because the diff was
governance-only.

**Failure prevented:** population swaps, same-push baseline laundering,
grandfathered exceptions accumulating, and expired overrides being replaced by
broader ordinary table policy without prior authority.

### D6 — projection and acceptance are load-bearing, but not proof theater

LLP 0173 proposes `generated/authorization-review.json` as deterministic,
consumer-committed review evidence (`llp/0173-authorization-review-projection.rfc.md:43`).
Extend its top level with `visibilityOverrides[]`. Every entry renders:

- the D5 baseline facts;
- full normalized row scope rather than only its digest;
- lifecycle class and fixture-profile binding or production days remaining;
- approval owner, resolved ruling/review/delegation artifacts, issue date, and
  renewal or re-key ancestry;
- whether the operation is HostPlan or opaque JavaScript;
- `breadth: all` for every `allRows: true`; and
- the acceptance test id, path, and last retained result digest.

The same projection renders `tablePolicyTransitions[]`, including every
approved ordinary-policy widening, its before/after normalized policies, and
its closed artifact bindings. A `public-read` transition cannot disappear into
an override-only review page.

The projection never labels an override `safe`. LLP 0173 already bars human
rendering from inventing `safe`, `widening`, `reviewed`, or `waived` verdicts
(`llp/0173-authorization-review-projection.rfc.md:119`). This sibling adds facts
and a comparator with scoped approval; it does not turn review output into
runtime enforcement.

Every override acceptance test must exercise:

1. the intended authority mode succeeds;
2. the same operation under ordinary user authority still evaluates the table
   policy;
3. an anonymous or wrong-user call cannot activate the override;
4. an out-of-scope row with a deliberately colliding convenience key remains
   invisible and cannot affect output;
5. each covered table and operation is necessary — deleting one from the
   grant makes the expected path fail; and
6. production expiry refuses before storage access, or fixture activation
   refuses outside the bound fixture profile.

For JavaScript, the projection says `handlerEvidence: opaque`. The host-applied
row scope is enforcement; the test is evidence about intended breadth and
operation wiring. A passing finite test does not prove arbitrary handler
noninterference, just as LLP 0170 warns that an author assertion is not proof
(`llp/0170-authorization-obligation-feasibility.research.md:71`).

**Failure prevented:** a green test or attractive projection being promoted
into a false static proof, and a system-only grant leaking into user calls.

## Scheduled-authority taxonomy

LLP 0070 defines the modes exactly as follows
(`llp/0070-durable-background-work.rfc.md:731`):

> `system`: a generated application service authority with explicit data and
> secret grants.

> `revalidatePrincipal`: the current principal must still pass a named policy
> before each attempt.

> `capturedGrant`: a narrow, expiring, server-issued job grant names the allowed
> operation and resources without carrying credentials.

It also makes `revalidatePrincipal` the fail-closed default, requires an
explicit declaration and conformance tests for `system`, and forbids serialized
client tokens in payloads (`llp/0070-durable-background-work.rfc.md:745`). The
three modes have different authority lifetimes and therefore different
governance.

### `system` — a genuine no-principal override

`system` is intrinsically principal-free. A caller-keyed owner or membership
policy has no principal to evaluate, so a system action sees no rows unless it
has an override. Its override is bound to the system entrypoint and exact data
scope. A direct call to the same function never inherits it.

`system` is not a magic synonym for `allRows`. A partition-local maintenance
job should use a host-composed resource predicate. A truly global sweep must
write `allRows: true`, appear as breadth-all in the projection, and carry an
acceptance fixture with multiple principals/tenants.

**Failure prevented:** every cron, seed, or maintenance function acquiring an
ambient database superuser because it has no principal.

### `revalidatePrincipal` — ordinary policy, not an override

`revalidatePrincipal` retains the credential-free subject and complete
invalidation dependencies, then evaluates current authority and resource facts
on every attempt (`llp/0070-durable-background-work.rfc.md:749`). That is the
ordinary table-policy contract at a later time. Scheduling does not turn it
into a waiver.

If a `revalidatePrincipal` action also needs a moderation or aggregate view
broader than its principal's table policy, that **separate widening** is an
override governed here. The scheduled mode itself remains ordinary.

**Failure prevented:** flooding the override census with delayed operations
that have a current principal, which would hide the genuinely principal-free
population and destroy review signal.

### `capturedGrant` — a governed override subtype

This RFC decides the LLP 0231 OQ6 branch: `capturedGrant` is a governed override
subtype.

LLP 0070 gives it unusually strong runtime properties: issuer, audience, exact
operation/resources, not-before/expiry, generation, revocation identity, and an
attempt-time revocation check (`llp/0070-durable-background-work.rfc.md:753`).
Those facts make each job grant narrow and revocable. They do not make it an
ordinary caller-keyed table-policy evaluation. When the current principal is
absent, the grant authorizes outside that policy, which LLP 0231 defines as an
override.

The schema override authorizes the **issuance profile**, not each job instance.
It declares the maximum operation/resource grammar and maximum runtime grant
TTL. Each job grant must be a subset and remain visible in job audit. Under a
production issuance profile it expires no later than the schema waiver; under
a fixture profile it retains LLP 0070's bounded runtime TTL and cannot leave
the fixture activation fence. The runtime grant's expiry does not replace the
production 90-day governance expiry; one bounds a job instance, the other
forces periodic review of production issuance authority.

The rejected alternative was first-class captured-grant authority outside the
override census. It is attractive because LLP 0070 already makes grants narrow.
It would nevertheless create a second way around the table locus and let an
issuer-policy change widen data access without changing the D5 override
projection. A future RFC may add a captured-grant predicate *inside the ordinary
table policy IR*. If it does, policies that explicitly admit such a predicate
would no longer be overrides. This RFC does not invent that grammar.

**Failure prevented:** a capability issuer becoming an unprojected second
authorization system simply because its tokens are well-scoped.

### Why collapsing the modes destroys signal

Suppose a review page shows 40 “scheduled overrides.” If 35 revalidate a live
principal, four are bounded captured-grant issuance profiles, and one is a
global system sweep, the single dangerous ambient no-principal path is buried
in noise. Conversely, treating all 40 as system authority would falsely claim
35 principal-backed operations need broad service access. The projection must
group by mode and show only `system` and `capturedGrant` in the override ratchet.

## The driving case: no-principal work

No-principal paths include cron, one-off `runAfter`-class jobs, seeds that read
existing data, reset/import transforms, and maintenance sweeps. They are not
bugs. They are why override governance is a prerequisite for LLP 0231 D2 rather
than a post-migration refinement.

Seed and reset authority do not receive an implicit exception. A literal seed
that only inserts needs no read override. A seed, import, or reset transform
that reads caller-keyed tables declares either a closed generated-system
pattern or a `system` override. The failure prevented is a “trusted bootstrap”
label turning every restore path into a permanent policy bypass.

### Worked repository example: the A6 follow-up job

The improvement-sweep A6 arm is a real `runAfter`-class example. Its
`createJob` mutation requires an `orgMembers` role
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:484`),
inserts the job, and transactionally enqueues `followUpSweep` with `orgId` and a
stable idempotency key
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:498`,
`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:522`).
The callee invokes `recordFollowUp`, whose membership check runs only if a user
exists; the system path therefore skips it and reads `followUpRuns` and
`activity` without a principal
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:873`,
`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:898`).
Both tables carry `orgId` in the schema
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/schema.mjs:103`,
`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/schema.mjs:173`).

Under LLP 0231, those tables receive ordinary membership visibility by
`orgId`. The user-originating mutation still evaluates that policy. The later
job has no principal, so its read needs a system override. The proposed
authoring spelling below is normative for this RFC but **not shipped syntax**:

```js
import {
  arg,
  defineSchema,
  defineVisibilityOverride,
  eq,
} from '@expo/snapback-codegen/define';

export const a6FollowUpSystemRead = defineVisibilityOverride({
  id: 'a6-follow-up-system-read-v1',
  owner: 'demo:a6-operations-ledger',
  authority: {
    mode: 'system',
    entrypoint: 'followUpSweep',
    calls: ['recordFollowUp'],
  },
  reads: {
    followUpRuns: eq('orgId', arg('orgId')),
    activity: eq('orgId', arg('orgId')),
  },
  justification:
    'The durable follow-up records one receipt and activity row for the org ' +
    'authorized when createJob enqueued the job.',
  lifecycleClass: 'fixture',
  approval:
    'snapback/visibility-override-approvals/' +
    'a6-follow-up-system-read-v1.<scopeDigestVersion>.<scopeDigest>.json',
  acceptance: {
    id: 'a6-follow-up-system-read-is-org-bounded',
    path:
      'demos/improvement-sweep/arms/a6-snapback-web/evidence/app/' +
      'acceptance.a6.mjs',
  },
});

export default defineSchema(tables, {
  auth: { mode: 'sessions' },
  visibilityOverrides: [a6FollowUpSystemRead],
});
```

The author first runs a proposal command that prints the canonical scope and
digest. The approval owner reviews a fixture with two organizations, including
a foreign row that deliberately shares the same `runKey` and `jobId`, and lands
the content-bound approval closure in its own push. Only a later push may add
the declaration and baseline entry. The A6 app is repository-registered with
synthetic identities and fixture-owned data, so its bundle is `fixtureOnly` and
cannot activate in a production profile. At runtime the host composes
`orgId == arg('orgId')` into both reads even though the JavaScript handler's
first query is keyed by `runKey`. The test proves the foreign collision neither
deduplicates the intended run nor contributes to its activity count.

A direct fixture-user call to `recordFollowUp` does not match the `system` entrypoint
and must pass ordinary membership visibility. An anonymous call matches
neither. Deleting the approval, changing `activity` to `allRows: true`, adding
another table, or invoking through another action changes the digest and fails
the remote merge-base gate.

The example grants **read authority only**. Its inserts remain unresolved until
the write/egress sibling specifies two-sided write checks. The current source's
conditional `if (ctx.auth && ctx.auth.userId)` is evidence of the motivating
shape, not a pattern this RFC blesses.

### Recurring maintenance is the broader sibling

The same A6 arm has a real cron action. `maintenanceStep` states that scheduler
execution uses system authority while direct human use requires a dispatcher,
then scans organizations and jobs
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:778`,
`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:794`).
`maintenanceCron` targets the wrapper every second in the acceptance rig
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:860`).
If its intended product semantics are a global sweep, its system override must
say `allRows: true` and test multiple organizations. If it is intended to be
partitioned, the handler and declaration need a resource argument. Governance
does not guess between those materially different scopes.

## Migration and activation sequence

The sequence follows LLP 0172's warning-then-error precedent: its Phase W emits
one stable diagnostic and Phase E writes no outputs
(`llp/0172-explicit-function-authorization.rfc.md:89`). It also preserves the
honest caveat that LLP 0172's own enforcement phase has not shipped
(`llp/0231-entity-and-permissioning-recommendation.rfc.md:239`).

### Phase G0 — governance substrate

Implement the owner map; versioned approval and transition schemas; artifact
resolution/deep comparison; both exact-set baselines; fixture-profile activation
fence; production expiry; projection entries; and system-mode acceptance
fixtures. Codegen implements only current-tree approval/integrity checks. The
repository pre-push gate implements remote merge-base separation and both
growth comparators. Existing implicit-table warnings remain warnings. No
override is generatable until both loci pass the G0 acceptance conditions.

### Phase G1 — migration closure

Declare ordinary visibility on every required table. For each no-principal
read, choose among:

1. `revalidatePrincipal`, with no override;
2. a narrower ordinary/generated table policy;
3. a closed generated system pattern; or
4. an explicitly approved `system` or `capturedGrant` override.

Required demos and package-consumer fixtures must have zero implicit tables,
zero unapproved overrides, zero expired production overrides, and zero fixture
overrides lacking a valid fixture-only activation fence. The initial ordinary-
policy baseline and its public-table migration closure receipt land here. G1 is
a corpus closure, not a date guess.

### Phase G2 — D2 enforcing closure

Only after G1 may omitted table visibility change from warning to generation
failure. The same release must preserve the search precedent's named repair and
must never tell a principal-free path to use `public-read` merely to get green.
The ordinary-policy widening ratchet is active before that repair can be
suggested, so an author cannot replace an override with broader table policy.
An override is accepted only through G0 governance; no temporary bypass flag
ships with G2.

**Failure prevented:** D2 either stranding legitimate cron/jobs/seeds or being
delayed indefinitely because the migration has no legitimate no-principal
answer.

## Alternatives worth considering

### A1 — no governance; overrides are ordinary code review

The schema declaration and test are visible, so ordinary review could approve
them like any other change.

Against: the same change can add the bypass and the sentence that says it is
fine. There is no expiry, no accepted-set comparison, and no way to distinguish
a new hole from one already reviewed. This is the exact free-text-waiver failure
LLP 0170 rejects. Code review remains necessary but is not authority.

### A2 — capability or token authority for every override

Issue an unforgeable, resource-bound capability for each broad read. This has a
strong runtime story and is close to LLP 0070's `capturedGrant`.

Against as the general model: system cron and global maintenance often have no
principal or enqueue event from which to mint a truthful user-derived token;
capability issuance becomes a second policy system; and a well-scoped token is
still invisible unless D5 projects the issuance authority. Adopted narrowly as
the governed `capturedGrant` subtype, rejected as a replacement for governance.

### A3 — one human approval for every override instance

Require Charlie Cheever to approve every app instance, including every generated
membership expiry sweep.

This is safe in authority terms and implementable at today's scale, but it
creates a permanent human queue in an agent-authored repository. The decision
instead permits author-delegated approval owners and closed, versioned generated
patterns whose instance parameters only narrow. Custom or breadth-all overrides
still reach a real approval owner; no fictional security team is assumed.

### A4 — every override is a `system` scheduled function

Make the scheduled service boundary the only escape hatch.

Against: moderation, admin views, and aggregates may be synchronous; a
`revalidatePrincipal` job is not an override; and a captured grant has different
revocation semantics. Authors would route ordinary operations through cron to
obtain authority, destroying both latency and review signal.

### A5 — captured grants are ordinary first-class authority

Teach storage to accept any valid LLP 0070 captured grant outside the override
ratchet.

Against: no ordinary table-policy grammar currently admits that authority, and
the issuer profile could widen without an override diff. Rejected until a
future RFC deliberately adds a captured-grant predicate to the shared policy IR.

## Sirens — attractive and wrong

### S1 — `if (ctx.auth.userId) check; otherwise system`

**Why it looks safe:** users are checked, and the only other expected caller is
cron. The A6 follow-up and maintenance handlers contain this shape today
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:879`,
`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs:798`).

**Why it is a trap:** absence of a user says nothing about *which* principal-free
entrypoint invoked the function. Anonymous, admin, seed, replay, test, and future
authority classes can collapse into the same branch. Authority must match a
host-attested mode and entrypoint; handler conditionals are opaque evidence.

### S2 — a count-only ratchet

**Why it looks safe:** “override count did not increase” is easy to compute and
easy to put in CI.

**Why it is a trap:** replacing one owner-scoped exception with one global
`allRows` exception keeps the count at one. Authority is a partially ordered
set of scopes, not a number.

### S3 — expiry warns forever to protect availability

**Why it looks safe:** a maintenance outage may be more visible than an old
waiver, so keep running and page the owner.

**Why it is a trap:** the first ignored warning converts the stated expiry into
fiction. In a fast-moving repository the warning will become ambient noise,
and a temporary hole becomes permanent. Warn early; fail at the boundary.

### S4 — approval and declaration in two files in one commit

**Why it looks safe:** the diff is explicit and a gate can verify that both
files exist.

**Why it is a trap:** file separation is not decision separation. The widening
change still writes its own authority. The approval closure must exist at the
remote merge-base and bind the exact later content.

### S5 — every scheduled action is an override

**Why it looks safe:** over-classifying appears conservative.

**Why it is a trap:** `revalidatePrincipal` has a current principal and should
exercise the ordinary policy. Filling the waiver page with ordinary delayed
reads hides the system and captured-grant paths where exceptional authority
actually exists.

## Costs, stated plainly

- **A custom production override takes two remote-observed pushes.** Approval
  closure lands first; declaration and baseline consumption land second. Two
  local commits in one push are deliberately insufficient. Content digests
  prevent unrelated movement on `main` from invalidating the decision, but the
  coordination cost is real.
- **The default approval owner is one human.** Delegation and closed generated
  patterns reduce the queue; an unchanged production pattern renews once per
  pattern, but custom production grants still queue individually.
- **Every production override can stop working at expiry.** The final-30-day
  warning and 90-day lifetime reduce surprise. They do not remove the outage
  risk, which is the price of an expiry that means something. Fixture relief
  avoids scheduled demo churn only by adding a hard activation boundary that
  itself needs target-profile conformance tests.
- **Ordinary-policy widening is governed too.** Changing a restricted table to
  `public-read`, any other broader/incomparable transition, or adding a new
  public table now takes a prior transition approval. This closes the expiry
  escape but adds ceremony outside the override files.
- **The corpus gains multiple governance surfaces:** owner map, immutable
  approval closures, re-key provenance, override and ordinary-policy baselines,
  policy-transition records, fixture profiles, and the LLP 0173 projection
  extension. They need schemas, drift checks, packaged-consumer coverage, and
  documentation.
- **Justification edits invalidate approval.** Because `justificationDigest`
  is inside `scopeDigest`, even a prose typo fix requires a fresh remotely prior
  approval. That is intentional: the justification is part of what the owner
  reviewed, but the review churn is a real cost.
- **Digest migration retains old canonicalizers.** A provable re-key needs both
  versions long enough to compare the predecessor declaration. Anything the
  migration cannot prove equal falls back to a fresh approval.
- **Scope comparison is real implementation work.** Table/operation set
  inclusion is easy; policy-IR implication is not. V1 must admit only structural
  narrowings it can prove and classify every incomparable change as growth.
- **JavaScript stays opaque.** The host can enforce the declared row scope, but
  review cannot prove what the handler derives from visible rows. Tests remain
  evidence, not noninterference proof.
- **Production captured grants carry two clocks.** The per-job grant expires
  and revokes; the production schema issuance waiver also expires. A fixture
  issuance profile keeps the per-job clock and substitutes the hard fixture
  activation fence for the schema-expiry clock.
- **Migration touches the ugly paths.** Conditional no-user checks, seeds,
  resets, and global sweeps must become explicit. Some will reveal that their
  intended breadth was never decided.
- **This RFC does not unblock writes.** A principal-free job that reads under a
  governed override may still be unable to insert, update, delete, or copy data
  outward until LLP 0231's write/egress sibling lands.

## Acceptance

An implementation satisfies this RFC only when executable evidence proves all
of the following:

1. An override declared inline in a query, handler, or `ctx.db` call is refused;
   only the schema-level carrier is accepted. LLP 0231 D7's explicit
   `ctx.db.elevated` trusted-handler read is not an override and cannot carry an
   alternate scope or activate outside a named query/mutation call site.
2. A schema override without a matching approval record fails generation with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED` and writes no outputs. The
   test runs in an exported tree with no `.git` directory and gets the same
   result.
3. Codegen succeeds when the current tree contains a valid matching approval
   closure, regardless of whether it arrived in the same local commit. Pre-push
   then rejects **two commits in one push** with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL`. Pushing only the closure
   first and consuming it in a second push succeeds against the advertised
   remote merge-base.
4. Codegen refuses a missing artifact path or any deep inequality among
   `reviewRecord`, `rulingRecord`, `delegationRecord`, their pointed-to records,
   and the owner map. Pre-push additionally refuses an untracked or remotely
   absent closure member. Both use
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID`. An unauthorized owner
   or fabricated pattern derivation also fails closed and names the required
   ruling.
5. Changing `schemaVersion` does not silently change digest semantics. A
   `scopeDigestVersion`/algorithm migration succeeds without new approval only
   for a merge-base declaration that both retained canonicalizers prove
   authority-equivalent and a re-key artifact records with provenance. A prose
   justification edit, semantic change, or unprovable migration needs a fresh
   remotely prior approval.
6. The exact-set override baseline rejects a new id, later expiry, fixture-to-
   production change, new mode/entrypoint/table/operation, broader predicate,
   or incomparable predicate with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH`. Removing or structurally
   narrowing succeeds. A one-for-one narrow-to-global swap fails.
7. `--update-baseline` cannot write through same-push growth. Every pushed tip
   and advertised remote old object use the D3 merge-base and the same
   comparator; a multi-ref push must pass for every updated ref.
8. The ordinary-policy baseline rejects restricted-to-`public-read`, every
   other broader/incomparable transition, and a new `public-read` table with
   `SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH` unless its transition
   closure was pushed first. Deleting an expired override while making its
   table public fails this test. A structurally narrower ordinary policy passes.
9. Production generation and activation warn throughout the final 30-day
   window. At expiry they fail, and an already-active override read refuses
   before storage access with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED`.
10. Regenerating an unchanged fixture tree before and after a simulated 90-day
    boundary produces byte-identical artifacts and no expiry red. Its bundle
    fails before data load in a production/hosted profile with
    `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY`; changing it to production
    is ratchet growth.
11. A custom production renewal requires one new remotely prior approval and a
    recent passing acceptance receipt. Equal/narrower renewal and widening are
    classified differently; the latter is a new grant.
12. An unchanged approved production pattern renews through one remotely prior
    pattern approval and fresh pattern receipt. Multiple deriving instances may
    consume it without per-instance approvals, expire no later than the pattern,
    and fail if any parameter ceases to be a structural subset.
13. The authorization projection and baselines deterministically list every
    override and ordinary-policy transition with normalized scope, lifecycle,
    owner, resolved artifact closure, expiry/fixture binding, breadth,
    acceptance, and handler opacity. Neither surface labels authority safe.
14. A `system` cron/job fixture sees no caller-keyed row without its approved
    override; it sees only the declared host-composed scope with the grant; a
    direct user call to the same function still evaluates ordinary policy.
15. A `revalidatePrincipal` fixture succeeds through the ordinary table policy
    with no override entry, then fails after current membership revocation.
16. A `capturedGrant` fixture appears as one governed issuance-profile override;
    each runtime grant is a subset, carries LLP 0070's issuer/audience/resource/
    expiry/revocation facts, and cannot outlive a production schema waiver or
    escape a fixture profile.
17. The A6 follow-up fixture uses two organizations and colliding convenience
    keys to prove the system job is org-bounded. Removing the `orgId` scope,
    changing it to `allRows`, or adding an entrypoint changes the digest and
    requires a new approval; its fixture-only bundle cannot activate as
    production.
18. Seeds that only insert need no read override; a seed/reset/import fixture
    that reads a caller-keyed table sees nothing until it declares a governed
    system scope.
19. D2's missing-table-policy failure cannot be promoted until the required demo
    and packaged-consumer corpus has zero implicit policies, unapproved
    overrides, expired production overrides, or invalid fixture fences, and the
    initial policy baseline has an approved public-table closure receipt. The
    retained receipt names the first G1 and G2 closures.
20. The complete proof says which target profiles enforce execution-time
    production expiry, fixture activation fencing, and override scope. A target
    missing any applicable enforcement cannot claim generatable visibility
    overrides.

## Open questions

1. **Authenticated approval identity.** The repository can prove remote
   merge-base separation, content binding, owner-map membership, pointer
   resolution/deep equality, and exact-set ratchets. It cannot prove that
   `approvedBy` was written by a different person or agent.
   Should approvals eventually require signed commits, a GitHub protected
   environment, or another authenticated maintainer action? No such mechanism
   is verified in this session, so this RFC does not select one.
2. **Where should approval history live after removal?** Immutable files may
   remain in place marked consumed/retired or move to a tombstone directory.
   Git history alone preserves them but is a worse review surface. Either choice
   must keep retired records from granting live authority.
3. **Which generated system patterns deserve pattern-level approval?** The
   membership expiry sweep is a candidate. Seed/reset and arbitrary maintenance
   are not assumed eligible. Each candidate needs a closed parameter proof and
   author ruling before it bypasses per-instance approval. Renewal semantics
   are decided in D2; eligibility is the remaining question.
4. **Captured-grant implementation grammar.** This RFC decides that it is an
   override subtype. LLP 0070 is still Review
   (`llp/0070-durable-background-work.rfc.md:4`) and its shipped first slice
   omits `capturedGrant`; exact issuance-policy IR, maximum default TTL, and
   target support remain with that subsystem. Until they land, captured-grant
   visibility overrides fail generation.
5. **Cross-repository consumers.** History-independent codegen works wherever
   the approval closure is present. Governance does not: a consumer without a
   remote-history gate equivalent to D3 cannot prove prior separation. It needs
   a signed/exported approval bundle or must refuse override activation.
   Packaging must decide that custody before claiming support.

## Revision history

- 2026-08-12 — initial Draft.
- 2026-08-12 — round-2 adversarial review response. M1 splits
  history-independent codegen validation from remote merge-base pre-push
  separation and makes two-commits-one-push fail. M2 adds an exact ratchet and
  remotely prior transition records for ordinary-policy widening, including
  `public-read`. M3 introduces non-expiring but production-fenced fixture grants
  while retaining hard 90-day production expiry. M4 versions digest semantics,
  adds provenance-bound machine-proven re-keying, and names justification-edit
  churn. M5 requires approval pointers to resolve to committed artifacts whose
  machine records deep-match the approval and owner map. M6 makes unchanged
  production patterns renew once per pattern. The same round aligns refusal
  codes under `SNAPBACK_TABLE_VISIBILITY_*`, takes the full final-30-day warning
  window, clarifies alternate conjunctions, adds LLP 0000 to `Related`, and
  cites LLP 0189 for content-bound review validity.
- 2026-08-15 — distinguished LLP 0231 D7 call-local elevated handler reads
  from this RFC's schema-declared, invocation-bound alternate policies. D7 is
  scoped to trusted named query/mutation read calls and cannot serve scheduled,
  action, write, masking, egress, or reusable override authority.

## Status

Draft. This document decides the governance recommendation but authorizes no
current override. LLP 0231's fail-closed ruling remains in force until this RFC
is accepted and G0's authority, two-locus validation, artifact integrity,
fixture fence, production expiry, both ratchets, projection, and runtime-scope
acceptance corpus is implemented. D2 phase 2 remains blocked until G1 closes
the required migration corpus.
