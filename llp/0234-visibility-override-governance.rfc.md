# LLP 0234: Visibility override governance

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Security/authorization, Background work, Code generation, Generated artifacts, Testing, LLP governance
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-12
**Revised:** 2026-08-15 (round-6 targeted delta-review response)
**Related:** LLP 0000, LLP 0011, LLP 0053, LLP 0056, LLP 0070, LLP 0170, LLP 0172, LLP 0173, LLP 0189, LLP 0225, LLP 0230, LLP 0231

## Summary

**Recommendation: a production override is a time-bounded, content-approved
exception to one table policy, consumed only after its approval has reached a
named integration ref in an earlier remote update, a protected observer has
signed that exact approval-only event, and the receipt is ratcheted as an exact
set — never a string that the widening change can add for itself. A fixture
override is non-expiring only behind a digest-bound production activation
fence.**

LLP 0231 made the table the visibility-policy locus. It defines every
non-conjunctive read as an override and fixes the minimum declaration shape:
schema-level, never inline in a query; named scope and justification; projected
for review; and backed by an acceptance test. It then fails every override
closed until this sibling decides authority, separation, expiry, and ratchet
(LLP 0231#d1--the-table-is-the-policy-locus-queries-refine). This RFC keeps
that shape and extends it with seven required facts:

1. a stable override id and one closed, data-layer-enforced scope;
2. an accountable implementation owner and one of three authority modes;
3. a content-bound approval record from an authorized approval owner;
4. a signed, content-bound separation receipt from the protected observer;
5. a production lifecycle or an exact fixture-profile identity and digest;
6. an absolute expiry for production authority; and
7. an exact-set ratchet and quarantine identity.

An author may propose an override. Proposal is not waiver authority. In this
repository the default approval authority is Charlie Cheever, the author and
ratifier. He may delegate a bounded path or subsystem to a durable approval
owner through a committed author ruling. Agents may author proposals, perform
reviews, and record an already-issued ruling; an ephemeral agent name is not
approval authority. This matches the repository that exists: AI agents are the
first-class builders (LLP 0000#design-principles-and-non-obvious-constraints), while the durable
cross-cutting decisions are author rulings.

Approval and widening are ordered through a **protected remote observation**,
not merely two authored files or two local commits. First, an authorized owner
pushes an immutable approval record and its resolvable ruling and review
artifacts. An externally custodied push observer then evaluates that exact
approval-only event, appends its verdict to a remote ledger, and a separate
least-privilege publisher commits a signed, content-bound separation receipt.
Only a later update may add the declaration and exact-set baseline entry, and
that widening closure must reference the receipt already present at its remote
predecessor. Codegen verifies the committed receipt without Git. Activation
also consumes the protected observer's green verdict for the exact source OID,
the exact deployment identity derived from that OID, and its latest
quarantine-ledger checkpoint. A skipped hook can therefore land inert source,
but it cannot make self-approved authority live before remote observation.

The tracked synchronous governance check remains useful fast feedback and is
outside LLP 0232's deferred frozen-record class. The protected observer, its
event input, signing key, ledger, and publisher configuration may not be
modified by the push it judges; this repository's ordinary in-tree workflow
files do not satisfy that custody. If the provider profile cannot supply the
required protected event and publisher, no receipt or green activation verdict
exists and widening stays unusable. The honest residual moves to compromise or
misconfiguration of that remote control plane, including an organization
administrator or signing identity that can forge or suppress observations.
D3 defines the external ledger, refusal, quarantine, reconciliation, and key-
revocation controls instead of calling the mechanism human separation.
Reviews bind the proposed content digest, not a quiet `main`, following LLP
0189's content-not-HEAD rule (LLP 0189#D-6).

Every **production** grant is valid for at most 90 days and is not valid before
its `issuedOn` instant. The receipt-bound protected-observer approval event
bounds authored time;
generation, activation, and reads use trusted host time rather than caller
input. They warn throughout the final 30 days. Before issuance they fail with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID`; at expiry they fail with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED`. A declared fixture grant is
non-expiring only because its bundle is machine-fenced from production
activation and carries no real principals or real user data. Custom production
renewal requires a new, remotely predecessor-landed approval and signed
separation receipt; a closed pattern
renews once at pattern level rather than once per instance. Any widening is a
new grant.

The ratchet also covers ordinary table-policy widening. A restricted table may
not be changed to `public-read`—or to any broader or incomparable ordinary
policy—in the same push that invents its transition approval. New
`public-read` tables are governed too. Deleting an expired override and making
the whole table public is therefore a refused widening, not an escape hatch.

The authority modes do not collapse:

- `principal` is a named principal-carrying operation whose host-composed
  admission condition is ordinary policy but whose alternate table scope is a
  governed override;
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
(`packages/snapback-codegen/index.mjs`, diagnostic anchor
`SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT`); the manifest's closed table-policy
union `TableVisibilityV1` has no override variant (`src/manifest.rs`). This Draft becomes an
implementation authority only after acceptance and a separately verified
implementation.

## Evidence and current boundary

### What ships

- Table visibility authoring accepts `public-read`, `owner`, `membership`, and
  a bounded `any-of`; its declarations are closed and typed
  (`packages/snapback-codegen/define.mjs`, table-visibility normalizer and
  `any-of` constructor symbol anchors).
- A table with no declaration currently emits
  `SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` as a warning. Its remediations are
  non-machine-applicable and require approval
  (`packages/snapback-codegen/index.mjs`, diagnostic-code anchor). D2's fail
  phase has not shipped.
- Search indexes already refuse omitted visibility with
  `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED` and name an explicit
  `public-read` repair (`packages/snapback-codegen/define.mjs`, diagnostic-code
  anchor). This is the
  shipped end-state precedent, not evidence that table overrides exist.
- The Rust manifest carries the table policy and documents that arbitrary
  handler reads remain outside the bounded implementation slice
  (`src/manifest.rs`, `TableVisibilityV1` symbol anchor).
- Relational, bounded-children, and snapshot-batch plan classes currently emit
  `SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE` when a restricted table
  policy is not composed. That warning is a live widening route, not a harmless
  migration note; G1 requires the separate composition lane's fail-closed flip
  to have landed before closure.
- The current one-off jobs slice runs callees under the same system authority
  as cron; `revalidatePrincipal` and `capturedGrant` remain on its honest-gaps
  list (LLP 0070#what-the-slice-deliberately-does-not-implement-honest-gaps).

The charter-mandated search found no visibility-override declaration or grant
carrier in `packages/snapback-codegen/` or `src/manifest.rs`. The only
`override` field in the searched manifest file was the unrelated
`local_loopback_test_override` (`src/manifest.rs`, symbol anchor). This is a scoped negative inventory, not
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
(`scripts/check-module-ownership.mjs`, `enforceMonotonicBaseline` symbol
anchor). Its adversarial record confirms that
same-tree laundering and manual baseline growth are refused
(`issues/closed/20260810-ownership-gate-analyzer-gaps.md:168`).

This RFC reuses the exact-set predecessor comparison, machine record, named
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
- projected in D6's severable review surface and folded into LLP 0173 when it
  lands; and
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

That distinction leaves a real residual. A named principal-carrying handler
can obtain the same rows as a broad alternate policy by adding an elevated read
and weakening its preceding application check. LLP 0234 does not approve,
expire, or ratchet that call-local authority; LLP 0231 D7 and ordinary code
review remain its control. The census is therefore defined over the closed host
channel, not over a promise to recover JavaScript behavior: the only execution
path is `db.elevated.get|getMany|uniqueMany|query`, and the host refuses any of
those operations unless the current named operation's generated capability
entry admits that read form. HostPlans and direct/generated plans cannot carry
the capability at all.

Handler forms have different, explicit classification rules:

- **Inline JavaScript** is statically classifiable only when every elevated use
  is a direct `ctx.db.elevated.<literal-read-form>(...)` call. Codegen records
  its exact stable source-span id and statically named tables; a dynamic table
  argument records `tables: opaque`. Syntactically visible aliasing,
  destructuring, passing the elevated object or one of its methods, a computed
  read-form property, or a helper-mediated use refuses generation with
  `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE`. That static diagnostic reaches
  only forms the scanner can see. A scanner-invisible alias such as
  `const c = ctx; c.db.elevated.get(...)` yields no admitted capability, and
  its eventual host call refuses before storage access with
  `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`.
- **Module-form JavaScript** is conservatively represented, not statically
  searched. An operation that may elevate must declare its admitted read forms
  and either a closed table set or `tables: opaque` in module metadata. D6
  emits one `siteEvidence: opaque-module` capability row per admitted form,
  with module path and digest but no invented source span. An undeclared host
  call or a call outside the declared form/table ceiling is refused by the host
  before storage access with `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`.
  A module needing no elevation declares none and the same host refusal makes
  absence from the census meaningful.

D6's baseline is thus an exact set of admitted operation × read-form host-call
channels. It is an exact static site census only for the restricted inline
form; opaque module entries conservatively cover every possible source site.
The projection is visibility, not a claim that an application check is
sufficient or that opaque JavaScript has been analyzed.

The D7 fence is over trusted **root invocation provenance**, not merely the
currently executing handler kind. An action, cron, job, `system`, or
`capturedGrant` ancestry may not move an elevated read into a nested mutation.
The host carries that provenance through every nested call and refuses all D7
read forms before storage access. The verified current hole and its separate
runtime repair are tracked by
[`issues/20260815-elevated-read-nested-mutation-provenance.md`](../issues/20260815-elevated-read-nested-mutation-provenance.md);
G0 cannot close without the ticket's nested-provenance refusal fixtures.

This RFC **extends** that pinned shape. Every override additionally declares:

- `owner`: the accountable implementation owner;
- `authority`: `principal`, `system`, or `capturedGrant`, plus the exact
  entrypoint or issuance profile on which it may activate; `principal` also
  carries a closed, host-composed principal admission policy;
- `lifecycleClass`: `production` or `fixture`;
- `expiresOn`: the absolute last valid UTC date for `production`, and absent
  for `fixture`;
- `fixtureProfile`: for `fixture`, the stable profile id, canonical profile
  record digest, target-class ceiling, synthetic-principal class, and data
  classification; absent for `production`;
- `approval`: the content-bound approval-record id; and
- `approvalSeparationReceipt`: the protected observer's signed receipt for the
  approval-only landing event; and
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
authority mode match. A `principal` override additionally activates only after
the host composes and satisfies its closed admission policy against the current
principal and current membership/resource facts. This is the governed spelling
for principal-carrying moderation, admin, and aggregate reads enumerated by LLP
0231 D1. It does not turn an opaque handler `if` into authority and it does not
replace D7's call-local spelling. A function callable by a user and by cron
therefore uses the principal or ordinary policy for the user call and a
`system` override only for the system invocation. Binding only the function
name would let a client-visible call borrow scheduled authority.

Principal non-admission is a refusal, not an empty result and not fallback to
ordinary table policy. Before handler execution or storage access, a missing
principal, wrong role, wrong membership, or wrong resource audience returns the
same `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_PRINCIPAL_NOT_ADMITTED` disposition.
The public message does not reveal which predicate, role, membership, resource,
or override id failed; protected operator telemetry may retain that internal
reason. Authentication alone is never a substitute for the declared role or
membership predicate.

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

Delegated authority has its own predecessor ratchet. The committed
`generated/visibility-override-owner-baseline.json` is an exact normalized map
of delegated approval owners, governed paths/patterns, and delegation-closure
digests, plus append-only retired-delegation provenance for approvals already
consumed. Only an active predecessor entry may issue a new approval; codegen may
use an exact retired entry only to validate already-consumed historical
closure. A map addition or path/pattern widening must carry the exact author
ruling and closure in the delegation update. More importantly, when a later
update first admits an approval record from that delegate, both admission
comparators validate the approver against the **predecessor** owner map and
require the complete delegation closure unchanged there. Co-landing a
delegation and its dependent approval is refused with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_DELEGATION_NOT_PRIOR`. The successful
sequence is delegation update, approval update, widening update. Narrowing or
removal remains monotone but cannot invalidate already-consumed historical
closure provenance.

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
unchanged constructor version plus its protected-observer separation receipt**,
with a fresh pattern acceptance receipt;
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

### D3 — widening requires a remotely prior, artifact-closed approval receipt

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
authorityAdmissionPolicy
authorityAdmissionPolicyDigest
authorityAdmissionMembershipAudienceClosure
authorityAdmissionMembershipAudienceClosureDigest
fixtureProfileId
fixtureProfileDigest
fixtureTargetClassCeiling
fixturePrincipalClass
fixtureDataClassification
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

The four principal-admission fields are present only for `authority.mode:
principal`; the approval record carries the complete canonical policy and
resolved membership-audience closure beside their digests so review never has
to reverse a digest. The five fixture fields are present only for
`lifecycleClass: fixture`; all are absent for production. `schemaVersion`
versions the approval-file shape. `scopeDigestVersion` versions
the canonical policy serialization independently, and `digestAlgorithm` is
explicit (`sha256` in v1). `scopeDigest` covers approval identity (override id,
or pattern id and constructor version), lifecycle class, authority mode and
entrypoint/issuance profile, the complete principal admission policy and its
resolved membership-audience closure when applicable, operations and tables,
read kinds, row scopes,
the canonical audience-declaration closure used by every membership predicate,
production expiry or the complete fixture-profile identity/digest/classification
tuple, acceptance identity, and justification digest. It contains no absolute
path and no repository HEAD. A
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

There are four validation/admission loci, backed by a protected remote event
ledger, and they have different jobs:

1. **Codegen is history-independent but receipt-dependent.** It checks the
   current source tree for a matching approval record, validates its digest,
   owner-map membership, and artifact closure, and verifies the protected
   observer's signature on the referenced separation receipt. The receipt is a
   committed closure member at:

   ```text
   snapback/visibility-governance-separation-receipts/
     <eventId>.<approvalId>.<scopeDigest>.json
   ```

   It binds provider profile and event id, governed ref, event-input digest,
   true `before`/`after` OIDs, observed time, approval kind/id/scope digest,
   complete approval-closure digest, predecessor owner-map/delegation digest,
   comparator/schema versions, and `approvalOnly: true`. A missing approval
   still uses `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED`; a missing,
   forged, mismatched, quarantined, or untrusted receipt uses
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED` and writes no
   outputs. Ordinary-policy growth uses the parallel
   `SNAPBACK_TABLE_VISIBILITY_POLICY_REMOTE_SEPARATION_REQUIRED`. Codegen does
   not inspect Git history; the signed receipt makes shallow clones and
   exported sources re-prove the remote observation.

   Codegen's receipt-signature trust root is the committed
   `snapback/visibility-governance-observer-keys.json` registry, which binds
   observer public keys and their digests to key epochs. Where target custody
   is reachable, codegen cross-checks the selected epoch and key digest against
   the target-owned pin. In an exported tree with no such target channel, a
   tree-supplied registry makes this signature check integrity and accident
   detection, not a forgery fence: activation still verifies through its
   externally pinned observer key epoch, and a tree-authored replacement key
   cannot make authority live.
2. **The tracked pre-push hook runs a synchronous governance-admission class.**
   This fast-feedback class is deliberately not a frozen-record/drift gate: it
   never defers to LLP 0232's backstop and refuses the
   `SNAPBACK_DRIFT_GATES_BYPASS` spelling. When invoked, it compares the
   advertised predecessor snapshot with each pushed governed-ref tip. The
   matching approval, closure, and signed separation receipt must all exist
   unchanged in that predecessor. If any first appears in the widening update,
   the push refuses with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL`.
3. **A protected remote observer is the separation and quarantine authority.**
   It receives the authenticated provider event, retains its immutable event
   input outside the repository, checks out the named OIDs, and runs the same
   D2/D3/D5 comparators. It emits a separation receipt only for an event that
   introduces the exact approval closure while introducing no governed
   authority growth that consumes it. A separate least-privilege publisher may
   append only signed receipts, quarantine verdicts, and their source
   projections; the approval author cannot precompute the observer signature.
   Receipt publication is its own remote update, so the minimum custom-grant
   sequence is approval closure, publisher receipt, then widening.

   For every governed-ref update the observer also appends a signed
   `governedUpdateVerdict` to the external event ledger. Before emitting green,
   the observer checks out the exact `after` OID and either derives the staged
   artifacts itself or verifies an attestation from a separately custodied
   builder whose configuration and signing key the judged push cannot alter.
   That derivation produces the exact `DeploymentIdentity` — `schemaHash`,
   `functionBundleHash`, and `generationInputsHash` — plus
   `visibilityAuthorizationProgramDigest` whenever the visibility-
   authorization program is staged separately. `generationInputsHash` covers
   the complete canonical governance-input closure consumed by generation;
   the separate program digest, when present, covers the canonical program and
   every governance baseline or other authorization-program input it consumes.
   The builder attestation, when used, names the `after` OID, toolchain and
   generator versions, all applicable identity fields, and its protected key
   epoch. The observer verifies that attestation and copies its digest and
   exact identity fields into the signed verdict rather than trusting
   deployment-request fields.

   A green verdict therefore binds the exact `after` OID, derived deployment
   identity, comparator/input and build-tool versions, event-input digest, and
   current quarantine-ledger head. A red verdict binds the exact ref and OIDs,
   approval/transition ids, comparator inputs, and normalized violation
   signature; it publishes a failed check, requests one P1 filesystem ticket
   through the source-ticket publisher, and appends the quarantine verdict
   described below. This per-event class is not LLP 0232's two-hour frozen-
   record backstop.
4. **Bundle activation consumes the remote result.** The host verifies the
   committed separation receipt for every active widening, obtains through
   target-owned configuration a green `governedUpdateVerdict` for the bundle's
   exact source OID, and verifies that verdict through the externally pinned
   observer key epoch. It recomputes `schemaHash`, `functionBundleHash`,
   `generationInputsHash`, and any separate
   `visibilityAuthorizationProgramDigest` from the staged artifacts and their
   governance inputs, and deep-matches every field against the identity inside
   that verdict. It then verifies the latest signed quarantine-ledger
   checkpoint before atomic activation. A schema, function bundle, governance
   baseline, or other authorization-program input from any identity other than
   the judged OID therefore cannot borrow its green verdict. An identity
   mismatch refuses before activation with
   `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH`.
   Missing custody or a source OID with no green verdict refuses with
   `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE`; a red,
   stale, rolled-back, or intersecting quarantine set refuses with
   `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION`. A bundle or request
   field cannot provide the source OID, verdict, key epoch, checkpoint, or
   expected identity. The host retains their digests beside the activated
   authorization program. Thus a skipped hook may land source, but it cannot
   make newly widened authority live while the audit is pending or red, and a
   benign judged commit cannot authorize different staged artifacts.

Two commits in one ref update fail the cooperative check and receive no
separation receipt because neither approval is remotely prior. An approval-only
update followed by the publisher's receipt-only update and then a widening
update succeeds. The governed ref set is explicit configuration and contains
`refs/heads/main` at minimum. Feature/topic refs are exempt because their
eventual integration-ref update is compared against that ref's own predecessor;
they carry no separation or activation verdict meanwhile.

The remote input contract has two provider profiles. If a provider supplies an
authenticated **atomic push envelope**, it must retain under one event id every
ref command's ref name and true old/new OIDs; all governed commands are compared
as one event, while each existing ref still uses its own old OID as predecessor.
No such cross-ref envelope is verified for this repository's current GitHub
push-event seam, so G0 uses the fail-closed profile instead: existing governed
refs are evaluated from their own authenticated `before`/`after` events, and a
new governed ref may be created only by the protected single-ref creation
service. Before creation, the governed-ref configuration and a signed anchor
witness naming the anchor ref and exact anchor OID must already be committed on
the anchor. The creation service binds the null `before`, new `after`, anchor
witness, and merge-base in a creation verdict. Direct creation, creation in a
multi-ref push, a missing/stale witness, or no merge-base receives no green
creation/activation verdict. Deletion activates nothing and is recorded without
a widening receipt. A future atomic-envelope provider may replace this profile
only after the real provider-contract fixtures pass.

The observer's trigger, event subscription, verifier binary/configuration,
signing key, append-only event/quarantine ledgers, and publisher permissions
must live outside the audited tree or behind provider protection the audited
push cannot alter. Editing or deleting `.github/workflows/*` in the violating
push therefore cannot suppress its evaluation. An ordinary in-repository
workflow alone is non-compliant. If the provider cannot offer authenticated
events plus this external custody, G0 leaves visibility overrides and ordinary-
policy widening activation disabled; unavailability is refusal, not a weaker
audit mode. An independent scheduled reconciler mirrors provider delivery into
the external ledger and checks ref tips for missing green verdicts, while target
config pins the observer key epoch, the separately custodied builder key epoch
when that profile is used, the codegen-registry key digest, and latest
quarantine head. Those controls bound accidental event loss and key rotation.
They do not defeat a provider or organization administrator, observer/builder
operator, or signing-key compromise able to forge the protected attestations
and ledgers; that privileged-control-plane compromise is the honest residual
and triggers key revocation plus activation freeze.

When a violation lands, the affected override, delegated approval, policy
transition, or governance record is **quarantined, not retroactively
approved**. Each protected verdict is committed unchanged at
`snapback/visibility-governance-quarantine/<quarantineId>.json` and appended to
the exact-set chain in
`generated/visibility-governance-quarantine-ledger.json`. A verdict binds the
external ledger event/signature, ref, `before`/`after` OIDs, authority kind and
governed-record id, offending ledger head where applicable, violation signature,
predecessor quarantine head, and successor exact-set digest. Quarantine ids and
the governed record ids they name are permanently retired: for an ordinary-
policy violation this is the offending transition/head id, never the table id,
so the same table can continue through a clean successor. Deletion, rebinding,
set shrinkage, old-head rollback, or old-id reuse is invalid. Codegen verifies
the complete signed chain in exported trees; both admission comparators enforce
append-only exact-set growth; activation compares the committed head with the
target's latest protected checkpoint.

Remediation never deletes ledger history. Stop publication/deployment of the
`after` OID and revoke or replace any already active affected bundle. Remove an
active bad override declaration and its active override-baseline entry while
retaining its quarantined id and approval history. For a bad ordinary-policy
head, append a `quarantined-reversal` transition that names the quarantine
verdict and bad head, retains both, and installs a clean successor. Codegen must
prove that successor equal to or narrower than the last non-quarantined policy;
the transition cannot reference an approval or confer authority. Narrow or
retire a bad delegation while retaining consumed provenance. Any later desired
widening uses a fresh, never-quarantined id, a fresh approval event and signed
separation receipt, and a later widening update. The ordinary skipped-hook
case therefore has a source-review/remediation interval but no new-authority
activation interval. An already-active authority quarantined only after later
discovery retains an explicit interval until revocation; the ticket is urgent
authorization work.

The three pointer fields are repository-relative paths to committed artifacts,
not descriptive strings. The review artifact embeds a machine-readable
`reviewRecord` covering the exact digest, acceptance design, and the
ordinary-policy/`revalidatePrincipal` alternative. The approval ruling embeds a
`rulingRecord` covering the exact digest, approver, owner-map digest, lifecycle,
and issue/expiry facts. A non-default approver's author ruling embeds the exact
`delegationRecord` carried by the owner map; for the default author the pointer
and record are both `null`. Codegen and both admission comparators resolve each non-null path,
parse the embedded record, and require JSON deep equality with the corresponding
record repeated in the approval file. Codegen refuses missing, malformed, or
unequal artifacts without asking whether Git tracks them. Both admission
comparators additionally require every closure member to be tracked and
unchanged at the predecessor. Any locus fails its applicable defect with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID`. This mirrors the shipped
module-ownership gate's exact attributed-record comparison
(`scripts/check-module-ownership.mjs`, `attributedRecordMatches` symbol anchor): inventing a plausible ruling string
is no longer enough; the closed committed artifacts must agree.

A canonicalization or digest-algorithm change increments
`scopeDigestVersion`. It may re-key a **proven pre-existing** approval without a
new grant only through a committed re-key record naming the old and new
versions/digests, the tool change, the predecessor approval, and substantive
provenance. The admission comparator runs both retained canonicalizers over the predecessor
declaration and admits the re-key only when their normalized authority is
structurally equal and no authored fact changed. This carries forward LLP
0225's re-key-with-provenance rule
(`llp/0225-core-modularization.decision.md:202`). A serializer change the gate
cannot prove equivalent, any policy/lifecycle/acceptance change, or any change
to `justificationDigest` requires a fresh remotely prior approval and signed
separation receipt. The re-key
record may land with the mechanical migration because its executable equality
proof shows it grants no new authority.

Current-tree validation gives deterministic content binding and referential
integrity; the signed receipt makes prior remote observation a generation and
activation input. The local hook supplies fast refusal, while a skipped-hook
push can land only inert widened source until the protected observer issues a
green exact-source, exact-deployment-identity verdict. Neither the receipt nor
the event ledger proves that two minds operated the keyboard. The same agent
may prepare both ordered updates, forge `requestedBy`, or ask the legitimate
approval owner to record a bad ruling; Git authorship and repository prose are
not secure identities. If Charlie authors and approves the same widening
through the required remote sequence, no repository machine can constrain the
repository's sovereign author. Authenticated human approval identity remains
OQ1, separate from the decided authenticated machine observation.

This is still materially stronger than a same-change waiver. LLP 0170 names the
defect precisely: a free-text waiver beside the failing operation is cheaper
than understanding the policy and can be added by the change that creates the
hole (`llp/0170-authorization-obligation-feasibility.research.md:119`).

**Failure prevented:** same-update self-approval becoming live authority,
borrowing a benign OID's verdict for different staged artifacts, dangling or
inconsistent ruling pointers, quarantine rollback, and approval drift after
reviewed content changes. A bypassed update may land source but has no
activation verdict; remote-custody compromise and human-identity limits are
stated rather than overclaimed.

### D4 — production authority expires; fixtures cannot become production

The default and maximum production grant lifetime is 90 days. `issuedOn` is a
UTC instant and a not-before boundary, not merely authored metadata.
`expiresOn` is mandatory for `lifecycleClass: production`, is generated from
neither wall clock nor omission, and is forbidden on a fixture record. An
approval owner may choose a shorter production lifetime; this RFC provides no
longer-grant exception.

The signed separation receipt for the protected-observer approval-only event
supplies trusted `admittedAt` time.
V1's fixed positive clock-skew allowance is five minutes: `issuedOn` may not be
later than `admittedAt + 5 minutes`, and the expiry boundary may be no later
than both `issuedOn + 90 days` and `admittedAt + 90 days`. Backdating only
shortens usable authority. The protected observer refuses a separation receipt
for an approval record that violates either bound with
`SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID`. Generation repeats
the authored interval checks and refuses if trusted generator time is before
`issuedOn`; activation and every override-backed read compare trusted host time
to both boundaries. Caller time, bundle arguments, and JavaScript time are never
inputs.

Before `issuedOn`, all three use:

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID
table visibility override <id> is not valid before <instant>
```

A record dated in 2099 is therefore unusable now even if the cooperative and
server admission checks were both evaded; an ordinary evasion is additionally
reported against the push event's trusted time.

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
path. Its declaration, scope digest, approval, active baseline, bundle, and
projection all carry the stable fixture-profile id, canonical profile-record
digest, target-class ceiling, synthetic-principal class, and data
classification. Codegen stamps its bundle `fixtureOnly` with that complete
tuple. The host accepts the bundle only when target-owned startup configuration
attests the same tuple against the committed app registration. A request,
handler, bundle field by itself, or caller argument cannot select the profile.
The host refuses every production, hosted, mismatched, or undeclared profile
before loading data:

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY
table visibility override <id> is fixture-only and cannot activate in profile
<profile>
```

Fixture grants remain content-approved, artifact-closed, acceptance-tested, and
ratcheted, but they do not expire or read wall-clock time. Changing or rebinding
the app registration, profile id/digest, target ceiling, credential/principal
class, data classification, or `lifecycleClass` is broader or incomparable
growth and requires a new production grant; no byte-identical override baseline
can hide the change. A demo wired to real credentials, imported user data, or a
production-capable deployment is production for this rule even if its directory
is named `demos/`.

For local ergonomics, plain `snapback serve` may select a built-in
`repository-local-fixture` host profile only when the app is repository-
registered and its committed record declares synthetic principals and
fixture-owned data. Otherwise local serve is undeclared and refuses a
fixture-only bundle. Every hosted/production target must obtain its profile from
its target configuration seam and can never default to fixture. The committed
required-demo and packaged-consumer corpus admits **fixture overrides only**;
`lifecycleClass: production` is a G1 corpus error. Thus the two-hour
regenerate-and-compare backstop does not manufacture quarterly reds from the
synthetic corpus, while a real production grant still fails closed on schedule.

Custom production renewal is not an edit to `issuedOn`. It is a new immutable
approval record referencing the previous grant, with a recently passing
acceptance receipt and a fresh justification of continued need, pushed before
the renewal change and followed by its protected-observer receipt update. An
unchanged approved pattern follows D2's one-renewal-per-
pattern rule; derived instances consume that remotely prior pattern renewal
without individual approvals. Equal or narrower authority is a renewal. Adding
a table, operation, entrypoint, authority mode, role, disjunction arm, row
population, or fixture-to-production reach is a new grant. Extending production
time is authority growth and cannot be approved in the renewal's own push.

**Failure prevented:** a temporary production escape becoming permanent,
synthetic fixtures generating recurring main reds, or a fixture declaration
becoming a production back door.

### D5 — exact ratchets cover overrides and ordinary-policy widening

Codegen emits and the consumer commits the active baselines plus append-only
ordinary-policy transition and governance-quarantine ledgers:

```text
generated/visibility-override-baseline.json
generated/table-visibility-policy-baseline.json
generated/table-visibility-policy-transition-ledger.json
generated/visibility-governance-quarantine-ledger.json
generated/elevated-read-site-baseline.json
```

The first contains one canonical entry per active override:

```text
id
scopeDigestVersion
scopeDigest
lifecycleClass
authorityMode
authorityAdmissionPolicy
authorityAdmissionPolicyDigest
authorityAdmissionMembershipAudienceClosure
authorityAdmissionMembershipAudienceClosureDigest
operations[]
tables[]
rowScopeDigests[]
audienceDeclarationClosureDigests[]
owner
approvalRecord
approvalClosureDigest
serverSeparationReceipt
serverSeparationReceiptDigest
fixtureProfileId
fixtureProfileDigest
fixtureTargetClassCeiling
fixturePrincipalClass
fixtureDataClassification
expiresOn
acceptanceId
```

Entries and all set-valued fields are sorted. The baseline binds to the same
generation inputs as the schema/functions pair. A count is explicitly
insufficient: replacing one narrow override with one global override preserves
the count while widening authority.

For each governed integration-ref update, both D3 admission comparators compare
the pushed exact set to the D3 predecessor snapshot with one implementation. It admits removal, earlier
production expiry, fewer operations/tables, and structurally narrower row
predicates. It treats a new id, later expiry, fixture-to-production change, new
authority mode or entrypoint, more operations/tables, or a broader/incomparable
predicate, principal-admission widening, audience-declaration widening, or any
fixture-profile rebind/classification/ceiling change as growth. Growth is valid
only when every new ceiling has a matching approval closure **and its protected-
observer separation receipt** already present unchanged at that predecessor.
The
declaration and baseline may then land together because authority was admitted
in the earlier push.

```text
SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH
table visibility override baseline adds or widens: <canonical scopes>; each
scope needs a matching remotely prior content-bound approval and signed
separation receipt; counts are not authority
```

The second baseline contains every table's normalized ordinary visibility
policy, policy digest, and immutable admission-provenance head. Normalization
does not stop at the table expression. For every referenced membership
declaration it includes the stable declaration id, membership and resource
tables, principal/resource/role field bindings, `resourceField`, and the
effective closed role vocabulary when `roles` is omitted. The normalized
declaration closure and digest are shared with override row scopes. Editing a
referenced declaration so a table or override admits a broader or incomparable
audience is therefore policy/override growth even when the local policy text is
byte-identical.

The structural partial order uses the same closed policy IR: fewer admitted
principals/rows is narrower, `public-read` is the maximum, and anything the
comparator cannot prove narrower or equal is incomparable. A broader or
incomparable transition—including restricted to `public-read`—requires an
immutable transition approval at:

```text
snapback/table-visibility-policy-approvals/
  <table>.<transitionDigest>.json
```

The transition digest binds table id, the complete prior normalized policy body
(or `null` for a new table), the complete proposed normalized policy body,
their digests, justification, acceptance identity, the resolved normalized
audience-declaration closures, owner-map digest, and the approval/review/
delegation records. The D3 history split, artifact-deep-equality, and signed-
separation-receipt rules apply unchanged. Codegen checks that the current tree
carries the matching transition closure and protected-observer receipt; both
admission comparators check that both were already present at the relevant
predecessor. A new restricted table is not widening because it exposes no
predecessor data to a broader audience. A new `public-read` table is growth and
needs the prior transition approval and receipt.

```text
SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH
table visibility policy adds or widens public authority: <canonical changes>;
push each content-bound transition approval, obtain its signed separation
receipt, then push the policy change
```

Each table-policy baseline entry points at one ledger head. Every ledger node
has an authored `admissionKind` from `g1-migration`, `new-restricted`,
`approved-transition`, `narrowing`, or `quarantined-reversal`, but the label is
never trusted. The node retains:

```text
tableId
predecessorHeadId
predecessorHeadDigest
predecessorNormalizedPolicyBody
predecessorPolicyDigest
successorNormalizedPolicyBody
successorPolicyDigest
admissionKind
approvalPath
approvalClosureDigest
serverSeparationReceipt
serverSeparationReceiptDigest
quarantineVerdict
```

The normalized policy body includes the full canonical policy IR and every
resolved membership-audience declaration body, not only references or digests.
Only a G1 root or new-table root has a null predecessor body. The append-only
ledger forms a per-table digest chain and retains every superseded head.
Codegen, without Git, walks to the root, recomputes both body digests at every
edge, and reruns the structural partial-order comparator. `narrowing` is valid
only when the successor is provably equal to or narrower than the predecessor;
broader or incomparable successors require `approved-transition` plus the exact
approval closure and signed separation receipt. `new-restricted` must prove a
restricted successor with no predecessor. A `quarantined-reversal` must name
the protected verdict and bad predecessor head and prove its successor equal to
or narrower than the last non-quarantined policy; it cannot carry an approval
or confer authority. Any mismatch between the authored label and recomputed
classification fails
`SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID`.

This makes a narrowing self-proving in an exported tree: current codegen never
trusts an author's `narrowing` string or Git history. Removing, replacing, or
rebinding any historical body, head, transition closure, or separation receipt
while leaving the current policy equal fails the same diagnostic. Both
admission comparators separately enforce append-only ledger growth and govern
historical removal or rebind; exported-tree codegen validates the retained
chain but cannot prove the Git append event.

Transition ledger nodes and every transition approval/review/ruling/delegation
closure they reference remain indefinitely at their original committed paths.
They may be marked consumed or retired but may not move to an archive, be
re-pointed, or be garbage-collected; a future retention change is a new
versioned migration with its own author ruling, not an implementation choice.

Ordinary-policy transition approvals do not expire: they authorize a durable
policy-program decision rather than temporary alternate authority. They do make
that decision remotely observed, receipt-bound, content-bound, artifact-closed,
and auditable.
Consequently, deleting an override while changing its table from restricted to
`public-read` is still a policy growth event and cannot be an expiry repair
without a separately approved first push.

During G1 only, the initial policy baseline may record policies that predate the
gate. Its migration closure receipt binds the exact source revision, lists each
`public-read` table individually, carries the approval owner's ruling, and is
reviewed before G2. It cannot freeze an override or a policy edit introduced
after that cut. After activation, no ordinary-policy growth is grandfathered.

Codegen validates that every current-tree baseline, ledger head, declaration,
closure, separation receipt, quarantine verdict, and quarantine exact-set head
agrees without consulting Git. The quarantine ledger has one signed,
content-addressed node per D3 verdict and never shrinks; its canonical exact set
contains every retired authority id and offending policy head. Both admission
comparators reject deletion, mutation, rebinding, rollback, or reuse, while
activation pins the latest remote checkpoint so reverting the source tree to a
pre-quarantine head cannot revive authority. The repository-mode
`--update-baseline` and synchronous admission path accept explicit predecessor
snapshots and run the growth comparators before writing or pushing, like the
shipped module-ownership checker's update command. A stale baseline, an entry
without a live declaration, a declaration absent from its baseline, or a
policy-equal state whose transition body or closure disappeared fails;
baselines are
review and ratchet records, not alternate runtime authority. A bypassed updater
can still land source, but D3 withholds the exact-source, exact-deployment-
identity green activation verdict and appends quarantine.

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
consumer-committed review evidence (LLP 0173#1-artifact-and-custody), but it is
Status Review and unbuilt. G0 therefore owns a minimal severable artifact:

```text
generated/visibility-authorization-review.json
```

It has the same deterministic consumer-committed custody rules and four
top-level fact arrays: `visibilityOverrides[]`, `tablePolicyTransitions[]`,
`quarantines[]`, and `elevatedReadSites[]`. It is emitted and checked whether or
not the rest of LLP 0173 exists. When LLP 0173 lands, codegen folds these exact normalized arrays
into `generated/authorization-review.json` without retiring the severable input
until a versioned migration proves byte-equivalent custody. No enforcement,
expiry, activation, approval, or ratchet locus reads either projection; delay
or redesign of LLP 0173 degrades one-page review convenience, not soundness.

Every `visibilityOverrides[]` entry renders:

- the D5 baseline facts;
- full normalized row scope rather than only its digest;
- for `principal`, the full canonical admission policy and resolved membership-
  audience closure beside both digests;
- lifecycle class and the complete fixture-profile id/digest/ceiling/principal/
  data binding or production issued/not-before/expiry facts;
- approval owner, resolved ruling/review/delegation artifacts, issue date, and
  renewal or re-key ancestry, plus the signed separation-receipt identity and
  digest;
- whether the operation is HostPlan or opaque JavaScript;
- `breadth: all` for every `allRows: true`; and
- the acceptance test id, path, and last retained result digest.

`tablePolicyTransitions[]` includes every current table's provenance head and
every retained ledger node, including narrowings and quarantined reversals. It
renders the complete predecessor/successor normalized policy bodies and
membership-audience closures, their digests, authored and recomputed
classification, ledger ancestry, signed separation receipt where required,
and closed artifact bindings. A `public-read` transition cannot disappear into
an override-only review page, and a reviewer can inspect why codegen re-proved
a narrowing.

`quarantines[]` is the exact sorted permanent set from D3/D5, with verdict,
event, ref/OIDs, authority/head identity, violation signature, external-ledger
signature, and chain ancestry. It never renders an “unquarantined” operation;
there is no such transition.

`elevatedReadSites[]` is an exact, sorted census of admitted closed host-call
channels, keyed by operation and read form (`get`, `getMany`, `uniqueMany`, or
`query`). Restricted inline handlers additionally carry `siteEvidence:
static-inline`, repository-relative source path, exact stable source-span id,
and the static table set or `tables: opaque`. Module-form handlers carry
`siteEvidence: opaque-module`, module path/digest, the declared form, and the
declared table ceiling or `tables: opaque`; they carry no invented span and
remain visible even when no static call can be found. The parallel
`generated/elevated-read-site-baseline.json` contains the same exact capability
ids and digests. Added, removed, or moved static-inline calls and any changed
module capability are review diffs. This is not an approval ratchet: the
residual remains LLP 0231 D7 application authority under ordinary code review.

The projection never labels an override `safe`. LLP 0173 already bars human
rendering from inventing `safe`, `widening`, `reviewed`, or `waived` verdicts
(LLP 0173#4-human-rendering). This sibling adds facts
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

## Authority taxonomy

LLP 0070 defines the modes exactly as follows
(LLP 0070#authorization-and-isolation):

> `system`: a generated application service authority with explicit data and
> secret grants.

> `revalidatePrincipal`: the current principal must still pass a named policy
> before each attempt.

> `capturedGrant`: a narrow, expiring, server-issued job grant names the allowed
> operation and resources without carrying credentials.

It also makes `revalidatePrincipal` the fail-closed default, requires an
explicit declaration and conformance tests for `system`, and forbids serialized
client tokens in payloads (LLP 0070#authorization-and-isolation). The three
scheduled modes have different authority lifetimes and therefore different
governance. They sit beside this RFC's direct `principal` override mode rather
than exhausting the override population.

### `principal` — a governed principal-carrying alternate scope

Moderation, admin views, and cross-cutting aggregates are part of LLP 0231 D1's
override population even when they execute synchronously. Their governed
spelling is `authority.mode: principal`: one named query or mutation, a closed
host-composed admission policy over the current principal and current
membership/resource facts, and one alternate row scope. The admission policy
is ordinary authority; the alternate table scope is the approved exception.

This is deliberately not `ctx.db.elevated`. A `principal` override applies the
approved scope to every covered read in the named invocation and appears in the
expiry and ratchet surfaces. D7 is selected at one trusted handler call site
after application-owned checks and retains the residual D1/D6 state. Nor does a
principal override mean “authenticated”: the admission predicate must name the
actual role/membership/resource condition, and the host—not opaque JavaScript—
must compose it. Its approval, active baseline, and D6 projection repeat the
complete canonical admission policy and resolved membership-audience closure
beside their digests. If that policy is not satisfied, the operation refuses
before handler/storage access with the one non-disclosing D1 diagnostic; it
does not return an empty set or retry under ordinary visibility.

A delayed `revalidatePrincipal` operation that needs only ordinary visibility
uses no override. If it needs the same moderator/global scope, it may reference
a `principal` override only after current-principal revalidation and only when
the named scheduled entrypoint is part of the approved activation facts.

**Failure prevented:** forcing a moderator-wide read into global ordinary table
policy, D7 opacity, or a fake scheduled wrapper merely because the caller has a
principal.

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
on every attempt (LLP 0070#authorization-and-isolation). That is the
ordinary table-policy contract at a later time. Scheduling does not turn it
into a waiver.

If a `revalidatePrincipal` action also needs a moderation or aggregate view
broader than its principal's table policy, that **separate widening** is a
`principal` override governed here. The scheduled mode itself remains ordinary.

**Failure prevented:** flooding the override census with delayed operations
that have a current principal, which would hide the genuinely principal-free
population and destroy review signal.

### `capturedGrant` — a governed override subtype

This RFC decides the LLP 0231 OQ6 branch: `capturedGrant` is a governed override
subtype.

LLP 0070 gives it unusually strong runtime properties: issuer, audience, exact
operation/resources, not-before/expiry, generation, revocation identity, and an
attempt-time revocation check (LLP 0070#authorization-and-isolation).
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
group scheduled modes and show only `system` and `capturedGrant` in the
scheduled override group; `principal` appears in its own group and in the same
exact ratchet.

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
`createJob` mutation requires an `orgMembers` role, inserts the job, and
transactionally enqueues `followUpSweep` with `orgId` and a stable idempotency
key (`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs`,
`createJob` symbol anchor).
The callee invokes `recordFollowUp`, whose membership check runs only if a user
exists; the system path therefore skips it and reads `followUpRuns` and
`activity` without a principal
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs`,
`recordFollowUp` and `followUpSweep` symbol anchors).
Both tables carry `orgId` in the schema
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/schema.mjs`,
`activity` and `followUpRuns` table declaration anchors).

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
  fixtureProfile: {
    id: 'a6-repository-local-fixture-v1',
    digest: '<canonical-profile-record-digest>',
    targetClassCeiling: 'repository-local',
    principalClass: 'synthetic',
    dataClassification: 'fixture-owned',
  },
  approval:
    'snapback/visibility-override-approvals/' +
    'a6-follow-up-system-read-v1.<scopeDigestVersion>.<scopeDigest>.json',
  approvalSeparationReceipt:
    'snapback/visibility-governance-separation-receipts/' +
    '<eventId>.a6-follow-up-system-read-v1.<scopeDigest>.json',
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
the content-bound approval closure in its own push. The protected observer then
notarizes that event and its publisher commits the signed separation receipt.
Only a later push may add the declaration and baseline entry. The A6 app is repository-registered with
synthetic identities and fixture-owned data, so its bundle is `fixtureOnly` and
cannot activate in a production profile. At runtime the host composes
`orgId == arg('orgId')` into both reads even though the JavaScript handler's
first query is keyed by `runKey`. The test proves the foreign collision neither
deduplicates the intended run nor contributes to its activity count.

A direct fixture-user call to `recordFollowUp` does not match the `system` entrypoint
and must pass ordinary membership visibility. An anonymous call matches
neither. Deleting the approval, changing `activity` to `allRows: true`, adding
another table, or invoking through another action changes the digest and fails
the predecessor admission comparators.

The example grants **read authority only**. Its inserts remain unresolved until
the write/egress sibling specifies two-sided write checks. The current source's
conditional `if (ctx.auth && ctx.auth.userId)` is evidence of the motivating
shape, not a pattern this RFC blesses.

### Recurring maintenance is the broader sibling

The same A6 arm has a real cron action. `maintenanceStep` states that scheduler
execution uses system authority while direct human use requires a dispatcher,
then scans organizations and jobs
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs`,
`maintenanceStep` symbol anchor).
`maintenanceCron` targets the wrapper every second in the acceptance rig
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs`,
`maintenanceCron` symbol anchor).
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

Implement the owner map and delegated-approver predecessor ratchet; versioned
approval, transition, quarantine, and fixture-profile schemas; artifact
resolution/deep comparison; all active baselines, the self-proving append-only
transition ledger, and the append-only quarantine exact-set ledger; trusted-
time not-before/expiry; fixture-profile activation fencing; and the minimal
severable D6 projection. Codegen implements history-independent current-tree
approval, signed separation-receipt, closure, ledger, quarantine, and elevated-
capability checks. The tracked hook runs the synchronous never-deferred
governance-admission class for named integration refs.

G0 must also provision the D3 protected remote control plane: externally
custodied event input and verifier configuration, append-only signed event and
quarantine ledgers, separate receipt/ticket publishers, the codegen observer-key
registry and target cross-check, observer and optional builder key-epoch and
revocation handling, exact-source green verdicts containing the deployment
identity derived from the judged OID, target-owned verdict/checkpoint delivery,
host recomputation and deep-match, and the independent missing-event
reconciler. For the current GitHub provider profile it implements the
precommitted notarized anchor witness and protected single-ref creation service;
it may use atomic multi-ref envelopes only after provider-contract evidence
proves their custody. Same-push edits to in-tree workflow files cannot disable
the observer. If that external custody is unavailable, override and ordinary-
policy widening generation/activation stay off with the named remote-custody
refusal. Existing implicit-table warnings remain warnings.

G0 also requires system, principal, captured-grant, and fixture-profile
acceptance fixtures. The root-provenance fix tracked in
[`issues/20260815-elevated-read-nested-mutation-provenance.md`](../issues/20260815-elevated-read-nested-mutation-provenance.md)
must have landed: a system action/cron calling a mutation that uses each D7
elevated read form is refused before storage, while a direct caller-backed named
query/mutation remains admitted. Restricted inline handlers refuse every
syntactically visible alias/destructure/computed/helper escape at generation;
scanner-invisible aliases reach the closed host-call refusal with no admitted
capability. Module handlers exercise declared and undeclared opaque capabilities
through the same channel. No override is generatable or activatable until
current-tree validation, the local
comparator, the protected observer/publishers, and host receipt/verdict/
quarantine consumption pass G0. This phase does not depend on the rest of LLP
0173.

G0 implementation record (2026-08-16):

- [x] Added versioned, content-bound override, approval, owner-map, fixture,
  transition-ledger, quarantine-ledger, observer-key, receipt, and verdict
  schemas; exact-set baselines; and history-independent validation/refusal.
- [x] Added the synchronous never-deferred governed-ref comparator and the
  protected observer/reconciler implementation. The GitHub profile uses the
  specified signed-anchor plus protected-single-ref fallback and fails closed
  when externally custodied configuration, keys, ledgers, or publishers are
  absent; organization-side provisioning remains an operational deployment
  prerequisite rather than an in-tree claim.
- [x] Added target-owned activation checks for signed green verdicts,
  recomputed deployment identity, externally pinned key epochs, trusted
  not-before/expiry, quarantine checkpoints, and exact fixture-profile fences.
- [x] Filled the LLP 0173 `authorization-review.json` reserved visibility
  sections through a standalone emitter, including conservative elevated-read
  census facts, without introducing an enforcement dependency on LLP 0173.
- [x] Added fixture-only system, principal, captured-grant, fixture-profile,
  pattern, transition, quarantine, comparator, provider-envelope, and
  verdict/bundle-swap governance-corpus coverage. Production override records
  remain generated only in temporary test trees.
- [ ] End-to-end alternate-scope execution fixtures for principal admission,
  system invocation, and captured-grant subsets remain to be connected to the
  storage read path. This substrate admits no such runtime authority yet, so
  the missing positive path is fail-closed rather than an exposure.
- [ ] The transitive root-provenance/runtime host-call fixture named above is
  pending the separately assigned D7 lane. G0 carries and validates the closed
  elevated-read capability manifest, but this lane deliberately does not edit
  the elevated dispatch sites in `src/runtime.rs`.

### Phase G1 — migration closure

Declare ordinary visibility on every required table. For each no-principal
read, choose among:

1. `revalidatePrincipal`, with no override;
2. restructuring onto a job-owned/derived table or a public-by-design table;
3. a closed generated system pattern; or
4. an explicitly approved `system` or `capturedGrant` override.

A principal-free read of an explicitly `public-read` table needs no override;
making an existing table public remains D5 growth. Principal-carrying
cross-cutting reads separately choose ordinary/refined policy, a governed
`principal` override, or the visible call-local D7 residual.

Required demos and package-consumer fixtures must have zero implicit tables,
zero unapproved overrides, **zero production overrides**, zero fixture overrides
lacking a valid digest-bound fixture-only activation fence, and zero restricted
tables reachable through a read surface that does not compose the table policy.
The latter requires the active relational/bounded/snapshot composition lane's
`SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE` fail-closed flip to have
landed; it is a closure dependency, not new implementation owned by this RFC.
The initial ordinary-policy baseline, transition-ledger roots, and public-table
migration closure receipt land here. G1 is a corpus closure, not a date guess.

### Phase G2 — D2 enforcing closure

Only after G1 may omitted table visibility change from warning to generation
failure. The same release must preserve the search precedent's named repair and
must never tell a principal-free path to use `public-read` merely to get green.
Every relational root/joined read, bounded parent/child read, and snapshot-batch
node class must compose the restricted table policy or refuse generation with
`SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE`; a surface-specific
`public-read` declaration can never outrank the table policy without a governed
override. G2 verifies that the separate composition flip is present rather than
reimplementing it.
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
revocation semantics. D1 represents the synchronous population explicitly as
`principal` overrides, reconciling this alternative with LLP 0231 D1 instead of
leaving it as an unspellable counterexample. Authors otherwise would route
ordinary operations through cron to obtain authority, destroying both latency
and review signal.

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
(`demos/improvement-sweep/arms/a6-snapback-web/evidence/app/snapback/functions.mjs`,
`recordFollowUp` and `maintenanceStep` symbol anchors).

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
remote predecessor, bind the exact later content, and carry the protected
observer's separately published receipt.

### S5 — every scheduled action is an override

**Why it looks safe:** over-classifying appears conservative.

**Why it is a trap:** `revalidatePrincipal` has a current principal and should
exercise the ordinary policy. Filling the waiver page with ordinary delayed
reads hides the system and captured-grant paths where exceptional authority
actually exists.

## Costs, stated plainly

- **A custom production override takes at least three remotely ordered
  updates.** The approval closure lands first; the protected publisher commits
  its signed separation receipt second; declaration and baseline consumption
  land third. Two local commits in one update are deliberately insufficient.
  Content digests prevent unrelated movement on `main` from invalidating the
  decision, but observer/publisher latency and availability are now authority
  availability. A skipped local hook may land inert source; it no longer creates
  a new-authority exposure interval.
- **The protected remote control plane is real infrastructure.** Event input,
  verifier configuration, signing keys, append-only ledgers, receipt/ticket
  publishers, an observer or separately custodied deterministic builder that
  derives deployment identity from the judged OID, a missing-event reconciler,
  target verdict/checkpoint delivery, and key rotation/revocation all need
  operation outside the audited tree. Codegen additionally needs the committed
  observer-key registry and an honest distinction between its tree-only check
  and activation's externally pinned forgery fence. The current provider
  profile also needs a protected single-ref creation service. If any required
  custody is unavailable, generation or activation refuses; an in-repository
  workflow cannot be substituted for it.
- **The default approval owner is one human.** Delegation and closed generated
  patterns reduce the queue; an unchanged production pattern renews once per
  pattern, but custom production grants still queue individually. A new
  delegation costs four ordered updates before authority is live: delegation,
  dependent approval, observer receipt, widening.
- **Every production override can stop working at expiry.** The final-30-day
  warning and 90-day lifetime reduce surprise. They do not remove the outage
  risk, which is the price of an expiry that means something. Fixture relief
  avoids scheduled demo churn only by adding a hard activation boundary that
  itself needs target-profile conformance tests.
- **Fixture profiles need host plumbing on every target.** The host—not caller
  input—must attest app registration, target ceiling, principal class, and data
  class. Repository-registered synthetic apps receive a local-dev default;
  unregistered apps and every hosted target must configure the profile
  explicitly. That lookup and its negative tests are part of G0/G1 cost.
- **Ordinary-policy widening is governed too.** Changing a restricted table to
  `public-read`, any other broader/incomparable transition, or adding a new
  public table now takes a prior transition approval. This closes the expiry
  escape but adds ceremony outside the override files.
- **The corpus gains multiple governance surfaces:** owner map and baseline,
  immutable approval and signed separation closures, re-key provenance,
  override and ordinary-policy baselines, append-only self-proving transition
  and quarantine ledgers, fixture profiles, an elevated-capability baseline,
  and the severable visibility review projection. They need schemas, signature
  and drift checks, packaged-consumer coverage, and documentation even if LLP
  0173 stays unbuilt. Transition bodies and their complete closures remain in
  the committed tree indefinitely; this is permanent repository growth.
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
- **JavaScript stays opaque.** The host can enforce the declared row scope and
  closed elevated-call capability, but review cannot prove what the handler
  derives from visible rows. Restricted inline elevation syntax rejects alias
  and helper idioms; module form pays with conservative `opaque-module`
  capability rows. Tests remain evidence, not noninterference proof.
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
   alternate scope. Root invocation provenance is carried transitively: a
   system action/cron/job invoking a nested mutation that uses each of `get`,
   `getMany`, `uniqueMany`, and `query` is refused before storage access, while
   a direct caller-backed named query/mutation fixture remains admitted. This is
   the required regression closure for
   [`issues/20260815-elevated-read-nested-mutation-provenance.md`](../issues/20260815-elevated-read-nested-mutation-provenance.md).
   Inline fixtures refuse syntactically visible aliasing, destructuring,
   computed read-form access, and helper escape with
   `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE` while admitting only direct
   literal calls. A scanner-invisible `const c = ctx` alias followed by
   `c.db.elevated.get(...)` produces no admitted capability and its runtime
   host call refuses before storage with
   `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`. Module-form fixtures project
   declared forms as `opaque-module`; undeclared or over-ceiling host calls use
   the same refusal. HostPlan/direct plans cannot declare or call elevation.
2. A schema override without a matching approval record fails generation with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED` and writes no outputs. The
   test runs in an exported tree with no `.git` directory and gets the same
   result. A matching approval without its valid signed separation receipt
   instead fails exported-tree generation with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED`. The
   exported-tree signature fixture uses the committed observer-key registry as
   codegen's trust root; a target-connected fixture deep-matches that registry's
   selected epoch and key digest to the target-owned pin. A fixture that
   replaces both a receipt and its tree-supplied key may satisfy only that
   explicitly limited tree-only integrity check; activation must reject it
   against the external pin.
3. Codegen succeeds when the current tree contains a valid matching approval
   closure, regardless of whether it arrived in the same local commit. When the
   tracked hook is invoked, the synchronous governance-admission class rejects
   **two commits in one update** with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL`; it neither defers nor
   accepts `SNAPBACK_DRIFT_GATES_BYPASS`. Approval-only update, protected
   receipt-publisher update, then widening update succeeds against the
   advertised predecessor. Two commits in one push and an authored fake receipt
   fail.
4. A protected-observer fixture supplies authenticated real event inputs and
   OIDs and reaches the same comparator verdict. Hookless and `--no-verify`
   same-update widening fixtures may move the test ref but receive no separation
   or exact-source, exact-deployment-identity green activation verdict;
   generation or activation refuses, and the observer retains a red event,
   failed check, normalized P1 ticket request, and quarantine verdict. A fixed
   signed green OID/verdict plus its positive staged-artifact fixture activates.
   Keeping that OID and verdict fixed while swapping, one at a time, the staged
   schema, function bundle, governance baseline, or any other authorization-
   program input changes the recomputed deployment identity and refuses before
   activation with
   `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH`. A
   violating push that also deletes or edits every in-tree audit workflow is
   still observed because trigger/config/key/ledger custody is external.
   Provider event loss yields no green verdict and the reconciler reports it;
   observer/builder/signing-key compromise remains the named residual.
5. Existing `refs/heads/main`, exempt topic refs, deletion, and existing-ref
   multi-ref updates exercise D3's exact ref rules. Atomic-envelope fixtures
   bind all old/new commands under one authenticated event id. The current-
   provider fallback precommits a signed anchor-OID witness, admits a new
   governed ref only through the protected single-ref creation service, and
   refuses direct or multi-ref creation, stale/missing anchor witness, and no
   merge-base. The approval-on-anchor plus widening-on-new-ref laundering case
   receives no receipt/green verdict. A topic ref carries no verdict until its
   later integration-ref update.
6. Codegen refuses a missing artifact path or any deep inequality among
   `reviewRecord`, `rulingRecord`, `delegationRecord`, their pointed-to records,
   and the owner map. Both admission comparators additionally refuse an
   untracked or predecessor-absent closure member. All use
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID`. An unauthorized owner
   or fabricated pattern derivation also fails closed and names the required
   ruling.
7. A delegation plus dependent approval in one update fails with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_DELEGATION_NOT_PRIOR`. A delegation
   update containing its author ruling, then a dependent approval update, then
   the protected receipt-publisher update, then a widening update succeeds;
   owner-path widening and owner-map baseline tampering have same-push negative
   fixtures.
8. Changing `schemaVersion` does not silently change digest semantics. A
   `scopeDigestVersion`/algorithm migration succeeds without new approval only
   for a predecessor declaration that both retained canonicalizers prove
   authority-equivalent and a re-key artifact records with provenance. A prose
   justification edit, semantic change, or unprovable migration needs a fresh
   remotely prior approval and signed separation receipt.
9. The exact-set override baseline rejects a new id, later expiry, fixture-to-
   production change, new mode/entrypoint/table/operation, broader predicate,
   principal-admission widening, membership-audience widening, fixture-profile
   rebind/classification/ceiling change, or incomparable predicate with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH`. Removing or structurally
   narrowing succeeds. A one-for-one narrow-to-global swap fails. The
   principal entry, approval record, baseline, and projection carry the same
   full canonical admission policy and resolved membership-audience closure
   beside their digests.
10. The ordinary-policy baseline rejects restricted-to-`public-read`, every
   other broader/incomparable transition, and a new `public-read` table with
   `SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH` unless its transition
   closure and protected-observer receipt were pushed first. Changing a referenced membership declaration's
   resource table/field or effective role vocabulary to broaden an otherwise
   byte-identical policy also fails. Deleting an expired override while making
   its table public fails; a structurally narrower ordinary policy passes.
11. Every table baseline has an admission-provenance head whose digest-chain
   ledger validates without Git. Every node retains complete canonical
   predecessor and successor policy bodies plus resolved audience closures;
   exported-tree codegen recomputes their digests and proves every authored
   `narrowing` label. A false narrowing, deleted/mutated body, missing closure or
   separation receipt, or historical removal/rebind fails with
   `SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID`. Transition bodies and
   closures remain at their original paths across retirement. Quarantine
   fixtures reject verdict/ledger deletion, mutation, rebinding, rollback, and
   old-id reuse in codegen, both comparators, and activation. A successful bad-
   policy-head → signed quarantine → `quarantined-reversal` → fresh-id approval/
   receipt → later reapproval chain retains the bad head and proves the reversal
   confers no authority.
12. Production generation and activation warn throughout the final 30-day
   window. A future-dated `issuedOn`, the five-minute skew boundaries, and both
   90-day caps are exercised against trusted generator, separation-receipt, and host
   clocks. Before issuance all loci refuse with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID`; at expiry they fail, and
   an already-active override read refuses before storage access with
   `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED`.
13. Regenerating an unchanged fixture tree before and after a simulated 90-day
    boundary produces byte-identical artifacts and no expiry red. Its bundle
    fails before data load in a production/hosted profile with
    `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY`. Same-update mutations of
    app registration, hosted/production reach, real-credential/principal class,
    data classification, profile id/digest, or target ceiling are ratchet
    growth even when override source text is unchanged. The repository-local
    default admits only an exact registered synthetic app.
14. A custom production renewal requires one new remotely prior approval, its
    protected-observer separation receipt, and a recent passing acceptance
    receipt. Equal/narrower renewal and widening are classified differently;
    the latter is a new grant.
15. An unchanged approved production pattern renews through one remotely prior
    pattern approval, its signed separation receipt, and a fresh pattern
    acceptance receipt. Multiple deriving instances may
    consume it without per-instance approvals, expire no later than the pattern,
    and fail if any parameter ceases to be a structural subset.
16. The severable `generated/visibility-authorization-review.json` and baselines
    deterministically list every override, signed separation receipt, ordinary-
    policy transition/body/provenance head, quarantine, complete fixture
    binding, full principal admission policy/audience closure, and exact D7
    admitted host-call capability. Direct inline sites carry exact spans;
    module-form capabilities carry `opaque-module` rather than invented sites.
    They build with LLP 0173 absent, contain no enforcement dependency, and
    label neither authority nor handler evidence safe. Folding into a later LLP
    0173 artifact preserves the normalized facts.
17. A `principal` moderator/admin fixture cannot activate on authentication
    alone, succeeds only under its host-composed role/membership admission
    policy and named operation, sees only its alternate approved scope, and
    appears in the override ratchet and projection. Missing authentication,
    wrong role, wrong membership, and wrong resource audience all refuse before
    handler/storage access with the same non-disclosing
    `SNAPBACK_TABLE_VISIBILITY_OVERRIDE_PRINCIPAL_NOT_ADMITTED`; none produces
    an empty result or ordinary-policy fallback. A golden fixture places an
    authentication-only policy beside the required moderator-role policy and
    proves their approval/projection canonical bodies and digests differ.
18. A `system` cron/job fixture sees no caller-keyed row without its approved
    override; it sees only the declared host-composed scope with the grant; a
    direct user call to the same function still evaluates ordinary policy.
19. A `revalidatePrincipal` fixture succeeds through the ordinary table policy
    with no override entry, then fails after current membership revocation.
20. A `capturedGrant` fixture appears as one governed issuance-profile override;
    each runtime grant is a subset, carries LLP 0070's issuer/audience/resource/
    expiry/revocation facts, and cannot outlive a production schema waiver or
    escape a fixture profile.
21. The A6 follow-up fixture uses two organizations and colliding convenience
    keys to prove the system job is org-bounded. Removing the `orgId` scope,
    changing it to `allRows`, or adding an entrypoint changes the digest and
    requires a new approval; its fixture-only bundle cannot activate as
    production.
22. Seeds that only insert need no read override; a seed/reset/import fixture
    that reads a caller-keyed table sees nothing until it declares a governed
    system scope.
23. Relational root and joined reads, bounded parent and child reads, and both
    snapshot-batch node classes have negative fixtures proving a surface-level
    `public-read` declaration cannot outrank a restricted table policy. Each
    class composes the table policy or refuses with
    `SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE`.
24. D2's missing-table-policy failure cannot be promoted until the required demo
    and packaged-consumer corpus has zero implicit policies, zero production or
    unapproved overrides, zero invalid fixture fences, and zero uncomposed
    restricted read surfaces; the initial policy baseline/ledger has an
    approved public-table closure receipt. The retained receipt names the first
    G1 and G2 closures.
25. The complete proof says which target profiles enforce execution-time
    production expiry, fixture activation fencing, override scope, exact-source
    green remote verdicts, OID-derived deployment-identity recomputation and
    deep-match, externally pinned key epochs, and latest quarantine checkpoints.
    A target missing any applicable enforcement cannot claim generatable or
    activatable visibility overrides. The negative family holds one green
    OID/verdict fixed and swaps each of schema, function bundle, governance
    baseline, and authorization-program input; every target refuses each swap
    before activation. With the protected observer unavailable, the fixture
    proves both override and ordinary-policy widening refuse rather than falling
    back to in-tree audit or local attestations.

## Open questions

1. **Authenticated human approval identity.** D3 now decides authenticated
   machine observation: the protected remote observer signs content-bound
   separation receipts, activation consumes its exact-source and exact-
   deployment-identity verdict plus latest quarantine checkpoint, and absent
   custody refuses. That proves an event and its derived deployable artifacts
   were observed; it does not prove `approvedBy` was written by a different
   person or agent. Should human approvals eventually require signed commits, a
   protected environment action, or another authenticated maintainer ceremony?
   No such human-identity mechanism is verified here.
2. **Where should removed override-approval history live?** Immutable override
   approval files may remain in place marked consumed/retired or move to a
   tombstone directory. Git history alone preserves them but is a worse review
   surface. Either choice must keep retired records from granting live
   authority. This question does not cover ordinary-policy transition bodies or
   closures, quarantine verdicts, or their ledgers: D3/D5 retain those at their
   original committed paths indefinitely.
3. **Which generated system patterns deserve pattern-level approval?** The
   membership expiry sweep is a candidate. Seed/reset and arbitrary maintenance
   are not assumed eligible. Each candidate needs a closed parameter proof and
   author ruling before it bypasses per-instance approval. Renewal semantics
   are decided in D2; eligibility is the remaining question.
4. **Captured-grant implementation grammar.** This RFC decides that it is an
   override subtype. LLP 0070 is still Status Review and its shipped first slice
   omits `capturedGrant`; exact issuance-policy IR, maximum default TTL, and
   target support remain with that subsystem. Until they land, captured-grant
   visibility overrides fail generation.
5. **Cross-repository consumers.** History-independent codegen works wherever
   the approval closure and verifiable signed separation receipt are present.
   Activation does not: a consumer without a D3-equivalent protected observer,
   exact-source green verdict carrying the OID-derived deployment identity,
   host recomputation/deep-match, and current quarantine checkpoint must refuse.
   Packaging needs an exported signed closure plus a target-owned path to those
   remote facts before claiming support; a synchronous local comparator or in-
   repository workflow is insufficient.

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
- 2026-08-15 — round-3 dual-family review response. Every finding was accepted
  and revised as follows:

  | Reviewer | Finding | Class | Disposition |
  | --- | ---: | --- | --- |
  | gpt-5 | 1 | MATERIAL | Revised at D3, G0, Costs, Acceptance 3–5: synchronous non-deferred cooperative check plus server-observed per-push audit; bypass exposure and remediation are explicit. |
  | gpt-5 | 2 | MATERIAL | Revised at D1, G0, Acceptance 1: D7 is fenced by transitive root provenance; the confirmed ticket is linked and all nested elevated-read forms are required fixtures. |
  | gpt-5 | 3 | MATERIAL | Revised at Evidence, G1, G2, Acceptance 23–24: G1 waits for zero uncomposed restricted surfaces and G2 requires compose-or-refuse for every named plan class. |
  | gpt-5 | 4 | MATERIAL | Revised at D2, D3, Acceptance 7: delegated approvers have a predecessor ratchet and delegation → approval → widening fixtures. |
  | gpt-5 | 5 | MATERIAL | Revised at D1, D3–D6, G0/G1, Acceptance 9/13/16: the complete fixture-profile identity/digest/classification tuple is bound everywhere and mutation-tested. |
  | gpt-5 | 6 | MATERIAL | Revised at Summary, D4, Acceptance 12: `issuedOn` is not-before, trusted server/host time is bounded with five-minute skew, and future-dated records refuse. |
  | gpt-5 | 7 | MATERIAL | Revised at D3/D5/D6, Acceptance 10–11/16: membership audience facts enter normalization and an append-only provenance ledger makes current-tree closure validation history-independent. |
  | claude | 1 | MATERIAL | Revised at Summary, D3, G0, Costs, Acceptance 3–5: removed the unenforceable guarantee, added true push-event OID audit, and defined landed-violation quarantine/remediation. |
  | claude | 2 | MATERIAL | Revised at D3 and Acceptance 5: enforcement is scoped to named integration refs and new-ref/anchor/no-merge-base/multi-ref behavior is defined. |
  | claude | 3 | MATERIAL | Revised at D1, Authority taxonomy, A4, Acceptance 17: added governed `principal` authority and reconciled LLP 0231 D1's synchronous population. |
  | claude | 4 | MATERIAL | Revised at D1/D6 and Acceptance 16: the severable projection and exact baseline enumerate D7 elevated-read sites while preserving the call-local residual honestly. |
  | claude | 5 | MATERIAL | Revised at D3/D5 and Acceptance 9–10: policy and override digests bind referenced membership-declaration audience semantics. |
  | claude | 6 | MATERIAL | Revised at D6/G0 and Acceptance 16: G0 owns a minimal standalone projection; LLP 0173 affects review convenience, not enforcement soundness. |
  | claude | 7 | MINOR | Revised at Evidence, the governance analogue, and the A6 example: stale implementation line citations use diagnostic/symbol anchors where practical. |
  | claude | 8 | MINOR | Revised at G1: choice 2 now means job-owned/derived or public-by-design restructuring, and explicit public tables need no override. |
  | claude | 9 | MINOR | Revised at D4, G1, Costs, Acceptance 13: target-owned attestation, a repository-local synthetic default, hosted refusal, and profile-plumbing cost are explicit. |
  | claude | 10 | MINOR | Revised at D4/G1 and Acceptance 24: the committed corpus admits fixture overrides only and G1 enforces zero production overrides. |

- 2026-08-15 — round-4 dual-family delta response. Every open delta item was
  accepted and revised as follows:

  | Review source | Finding | Class | Disposition |
  | --- | --- | --- | --- |
  | gpt-5 r2, held round-1 1 | Activation did not consume separation verdict | MATERIAL | Revised Summary, D3, G0, Costs, Acceptance 2–5/25: the protected observer emits a signed content-bound separation receipt after the approval-only event; a separate publisher commits it; codegen and activation consume it; activation additionally requires a green verdict for the exact source OID and latest quarantine checkpoint. A skipped hook can land only inert source. |
  | gpt-5 r2, held round-1 7 | Ledger trusted authored narrowing labels | MATERIAL | Revised D5/D6, Acceptance 10–11/16: every transition node retains complete canonical predecessor and successor normalized policy bodies plus resolved audience closures; exported-tree codegen recomputes digests and the partial-order classification. Transition closures remain at fixed paths indefinitely. |
  | gpt-5 r2 held claude round-1 4; claude r2 new 1 | Elevated census was not exact over opaque JavaScript | MATERIAL | Revised D1/D6/G0, Costs, Acceptance 1/16: exactness is over the closed host-call capability channel. Restricted inline direct calls get exact spans and aliases/helpers refuse; module form is explicitly declared and conservatively projected as `opaque-module`, with undeclared host calls refused. |
  | gpt-5 r2 new 1; claude r2 new 5 | Quarantine was deletable and contradicted append-only policy history | MATERIAL | Revised D3/D5/D6/G0, Costs, Acceptance 11/16/25: signed quarantine verdicts form an append-only exact-set ledger consumed by codegen, both comparators, and activation. Deletion/rebinding/rollback/old-id reuse refuse; `quarantined-reversal` retains the bad head, installs only a proved-clean successor, and cannot confer authority. |
  | gpt-5 r2 new 2 | New-ref and multi-ref auditor input custody was unavailable | MATERIAL | Revised D3/G0, Acceptance 5: an authenticated atomic-envelope profile binds all ref commands. Because the current GitHub seam has no verified envelope, the active fallback precommits a notarized anchor OID and permits new governed refs only through a protected single-ref creation service; direct/multi-ref creation refuses. |
  | claude r2 new 2 | Audited push could alter its own auditor | MATERIAL | Revised Summary/D3/G0/Costs, Acceptance 4/25: event input, trigger/config, keys, ledgers, and publisher custody are external to the audited tree. In-tree workflow edits cannot suppress evaluation; unavailable custody produces no receipt or activation verdict. Privileged provider/control-plane compromise remains explicit and triggers key revocation plus activation freeze. |
  | claude r2 minor 3 | Principal non-admission behavior unspecified | MINOR | Revised D1/Authority taxonomy, Acceptance 17: every non-admission refuses before handler/storage access with one non-disclosing stable code; there is no empty-result or ordinary-policy fallback. |
  | claude r2 minor 4 | Transition closure retention open-ended | MINOR | Revised D5, Costs, OQ2, Acceptance 11: transition bodies and complete closures remain at their original committed paths indefinitely; archive movement is not an implementation option. |
  | gpt-5 r2 minor 1 | Principal admission policy was digest-only in review | MINOR | Revised D3/D5/D6, Acceptance 9/16–17: approval, baseline, and projection render the complete canonical principal admission policy and resolved membership-audience closure beside their digests; authentication-only and moderator-role fixtures differ visibly. |

- 2026-08-15 — Status Draft → Accepted, author-directed (Class R
  row-authorization completion program, sequence step 3). Acceptance follows
  dual-family same-revision convergence: four review rounds (two full, one
  delta, one confirming), eight artifacts under `llp/reviews/0234-*`, both
  families VERDICT: READY on the round-6 revision. Thirteen distinct MATERIAL
  findings were resolved across rounds, including the redesigned push-boundary
  separation (receipt-consuming activation with deployment-identity-bound
  signed verdicts), the transitive D7 provenance fence (tracked as
  `issues/20260815-elevated-read-nested-mutation-provenance.md`), append-only
  quarantine, and the alias-proof elevated-read census. G0 implementation may
  begin; LLP 0231 D2 phase 2 remains blocked until G1 closes.
- 2026-08-15 — round-6 targeted response to the round-5 delta reviews. The
  single MATERIAL finding and both MINOR wording completions were accepted and
  revised as follows:

  | Review source | Finding | Class | Disposition |
  | --- | --- | --- | --- |
  | gpt-5 r3 finding 1 | Green verdict did not bind the staged authorization artifacts | MATERIAL | Revised Summary, D3, D5, G0, Costs, Acceptance 4/25, OQ1/OQ5, and Status: the observer or a separately custodied builder derives the exact `DeploymentIdentity` and any separate visibility-authorization program digest from the judged `after` OID; the signed green verdict carries those fields; the host recomputes and deep-matches them before activation. A fixed-verdict negative family swaps schema, function bundle, governance baseline, and authorization-program input one at a time and refuses every mismatch. |
  | claude r3 finding 1 | Scanner-invisible inline alias diagnostic was understated | MINOR | Revised D1, G0, and Acceptance 1: syntactically visible escapes fail codegen with `SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE`; a scanner-invisible alias receives no capability and fails at the host before storage with `SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED`. |
  | claude r3 finding 2 | Codegen receipt-signature trust root was unnamed | MINOR | Revised D3, G0, Costs, and Acceptance 2: codegen trusts the committed observer-key registry and cross-checks its selected epoch/key digest against target custody when reachable; tree-only verification is explicitly integrity/accident detection, while activation's externally pinned epoch remains the forgery fence. |

## Status

Accepted (2026-08-15, author-directed after dual-family same-revision READY
convergence; see the revision history). Acceptance authorizes G0
implementation but still authorizes no current override. LLP 0231's
fail-closed ruling remains in force until G0's authority, four-locus validation/admission, protected
observer and publisher custody, signed separation receipts, exact-source
and exact-deployment-identity activation verdicts, host identity recomputation,
self-proving transition and quarantine-ledger integrity, delegated-approver
ratchet, fixture fence, trusted-time production lifetime, D7 root-provenance
and closed host-capability refusals, all ratchets, severable projection, and
runtime-scope acceptance corpus are implemented. D2 phase 2 remains blocked
until G1 closes the required migration and uncomposed-read-surface corpus.
