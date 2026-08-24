# Mandatory authority/subject correlation — enumeration-bound design, revision 3

Status: Revised proposed design — requires fresh independent review; no implementation or
capability claim
Date: 2026-08-23
Revised: 2026-08-24 (revision 3 — factory enumeration makes ownership/entitlement verification
the primary control; consuming products preserve a verified association but do not create one)
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Related: LLP 0058, LLP 0059, LLP 0283 F-1, LLP 0290, LLP 0293, LLP 0298,
  issues/20260823-uncorrelated-authority-axes-are-systemic-153-sites.md,
  issues/20260823-two-landed-fences-do-not-correlate-the-authority-axes.md,
  issues/20260823-origin-bound-commit-capsule-design.md,
  issues/20260824-authority-validated-subject-supplied-separately.md,
  issues/20260824-correlation-design-review-synthesis.md,
  issues/20260824-sealed-plan-protocol-already-exists-and-is-already-broken.md,
  issues/20260824-wide-predicate-sweep-inverse-variant-confirmed.md,
  issues/20260824-authority-minting-factory-inventory.md,
  issues/20260824-uncorrelated-staging-entry-point-inventory.md

## Decision

Reject revision 2's universal sealed, consuming operation product as the primary security
control. The product can preserve a relationship only after some factory has established it.
It cannot prove that a sanctioned factory checked the relationship in the first place.

The primary control is now **factory-local ownership or entitlement verification over an
enumerated factory population**. The secondary control is **row-scoped association preservation
through an enumerated staging/consumer population**:

```text
presented authority or proof + requested subject and exact operation
  -> enumerated factory performs the ownership/entitlement predicate
  -> factory derives the canonical subject and exact operation scope
  -> optional opaque carrier preserves that checked association
  -> enumerated staging/consumer rows cannot replace either side
  -> final liveness fence is acquired for that same association
  -> durable effect or returned authority
```

This is deliberately not one generic `AuthorizedEffect<K>` imposed on 326 current factory rows.
The 95 checked-in `OWNERSHIP-CHECKED` factory/direct-construction rows are prior art for the
load-bearing control. The 134 checked-in `LIVENESS-ONLY` rows show that subject-specific checks
must be repaired row by row. A consuming carrier remains appropriate where work crosses a
stage/commit, async, database, or crate boundary, but sealing that carrier or its consumer is
transport hardening, not authorization.

The corrected scope is:

> An authority is validated, the subject it acts on is supplied independently, and nothing
> structurally ties them together.

“Acts on” includes both directions:

- the output is a durable row, object/file write, receipt, queue/trigger state, publication, or
  another LLP 0298 durable effect; and
- the output is itself an authority, permit, credential, ticket, plan, fence, reservation,
  projection, or other value later trusted as authority.

It also includes sites with no reservation or guard at all. A plain identifier string captured
in a closure or plan is a subject axis. An admission lease is liveness, not subject ownership.

## Evidence and claim vocabulary

This revision reasons from the checked-in inventory rows and inspected bodies, not from names or
doc comments. The `LocalSnapback::execute_auth_plan` comment is the cautionary example: its claim
about preventing adapter-supplied closures is true, while the security property is still false
because sanctioned factory F053 captures a caller-selected session.

The following terms are exact:

- **VERIFIED CODE FACT** — the cited body was inspected at this branch's starting commit,
  `87e274fe0`.
- **ENUMERATED ROW FACT** — the cited row exists in one of the two checked-in inventories. Its
  classification is evidence about that row only.
- **PREDICATE-VERIFIED** — the named factory body checks the named ownership/entitlement relation,
  and a named mutation or negative test makes that check load-bearing. This is an empirical code
  claim, not a type-theoretic impossibility claim.
- **STRUCTURALLY IMPOSSIBLE THROUGH ROWS {...}** — named compile-fail fixtures establish that safe
  callers cannot express the stated substitution through those exact post-factory APIs. This
  says nothing about the factory predicate's semantic sufficiency.
- **NO CONSTRUCTION FOUND** — an adversarial attempt did not produce a violation. This never
  means impossible.
- **DETECTION BOUND** — a registry, source scan, test, or review can detect a future violation but
  cannot make a new spelling, FFI path, unsafe fabrication, or unrecognized storage mechanism
  impossible.

No phase may shorten one of those labels to `SAFE`, `CLOSED`, `PROPERTY TRUE`, or an unqualified
repository-wide claim.

## Review disposition

Revision 1 is rejected. Revision 2 closes the previously known late-assembly, function-scope,
pending/guard, caller-terminal, and service-deadline attacks on paper, but B4 proves that its
primary mechanism already exists and is already defeated. Revision 3 keeps only the part the
evidence supports: a carrier may preserve an association after a correct factory check.

The coherent head and tail of Grok's revision-1 review were incorporated into revision 2 and
remain relevant. Grok's middle was corrupted and is **unread, not cleared**. This document does
not represent that review as fully incorporated, and Phase 5 requires a replacement review or an
explicit author waiver.

## The two enumerations are normative — and currently disagree with the requested receipts

### Authority factories

The checked-in `issues/20260824-authority-minting-factory-inventory.md` names function factories
F001–F312 and direct construction surfaces C001–C014. Its own class totals are:

| Population | OWNERSHIP-CHECKED | LIVENESS-ONLY | NO-SUBJECT | UNCLEAR | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Function factories F001–F312 | 92 | 123 | 94 | 3 | 312 |
| Direct construction C001–C014 | 3 | 11 | 0 | 0 | 14 |
| Checked-in combined population | 95 | 134 | 94 | 3 | 326 |

The commissioning receipt says 98/137/97/6 and “312 function factories + 14 direct-construction
surfaces.” Those four class figures total 338, not 326. The checked-in file names only three
`UNCLEAR` rows: F208, F256, and F266. There are no row identities for the other three requested
`UNCLEAR` factories. This design does not invent them or silently absorb them into another class.

Until the factory inventory is reconciled, its exact F/C row identities are the addressable
baseline and the conflicting aggregate receipts permit no population-wide claim. Phase 0 must
either add the missing rows or correct the receipt with a reviewed derivation diff.

### Staging and consumption

The checked-in `issues/20260824-uncorrelated-staging-entry-point-inventory.md` has no stable row-ID
column. Its classified table rows are currently 157 `MOVE`, 40 `DELETE`, 50 `KEEP`, and zero
`UNCLEAR`—247 classified rows. Two additional bold classification words occur in prose, which is
why a raw label count yields 158/41/50. The commissioning receipt says 279 rows with
159/41/57/1; those category figures total 258, and the requested `UNCLEAR` row has no checked-in
identity. Production-root reachability lists may explain some population difference, but this
revision does not infer a mapping the inventory does not state.

Phase 0 must assign stable staging IDs, decide whether reachability roots are rows or edges, and
reconcile both totals. Until then, the exact first-column location plus normalized signature is a
row's temporary identity. The missing requested `UNCLEAR` staging row is unresolved and blocks
the final claim; it is not treated as `KEEP`.

Counts are never completion criteria. Exact row identities and a derivation receipt are.

## Enumerated factory dispositions at the checked-in baseline

The full lists below make the design's current claims independent of prose characterizations such
as “private owner,” “not a leaf server factory,” or “well-written constructor.” They snapshot the
checked-in inventory; Phase 0 binds the implementation registry to a commit and derivation digest.

### `OWNERSHIP-CHECKED` candidates — exact rows only

The only permitted baseline claim is: **the inventory reports a subject-specific check for these
95 rows**. It is not a claim that downstream consumers preserve the relationship or that each
predicate is semantically sufficient:

F003, F008, F026, F027, F028, F029, F030, F031, F033, F034, F038, F039, F042,
F045, F046, F047, F048, F049, F057, F058, F059, F060, F064, F065, F066, F074,
F076, F083, F085, F086, F087, F088, F090, F092, F093, F098, F103, F147, F148,
F152, F153, F154, F163, F168, F174, F176, F177, F178, F179, F180, F181, F184,
F186, F192, F193, F194, F195, F196, F197, F198, F199, F209, F214, F217, F218,
F219, F230, F234, F235, F239, F247, F254, F255, F261, F267, F268, F269, F271,
F274, F289, F290, F291, F292, F293, F295, F296, F300, F303, F307, F308, F309,
F310, C008, C010, C011.

F003's exact lease MAC/expectation comparison, F098's ticket-to-session comparisons,
F147/F148's exact function ID **and kind** scope selection, F152–F154's bearer-derived session
binding, F174's code/client/redirect/PKCE verification, F214's consumed bearer preparation, and
F261's exact app-graph/lease check are examples to reuse. They are not a license to classify a
similar-looking factory without inspecting its body.

### `LIVENESS-ONLY` defect population — exact rows only

These 134 rows have no permitted ownership/correlation claim. Each must be deleted, lose the
subject axis, or become PREDICATE-VERIFIED for its exact subject and entitlement before Phase 5:

F001, F002, F005, F006, F011, F014, F019, F020, F022, F032, F037, F043, F044,
F053, F054, F055, F056, F061, F062, F063, F067, F068, F069, F070, F073, F075,
F078, F081, F082, F084, F089, F091, F094, F095, F096, F097, F100, F101, F102,
F112, F113, F115, F117, F118, F119, F120, F121, F122, F126, F127, F128, F129,
F133, F143, F144, F145, F146, F149, F150, F157, F160, F161, F162, F170, F171,
F172, F173, F175, F182, F183, F185, F187, F188, F189, F190, F191, F202, F203,
F204, F205, F210, F211, F212, F213, F215, F220, F224, F227, F232, F233, F236,
F237, F238, F240, F242, F243, F244, F257, F258, F259, F260, F264, F265, F270,
F272, F273, F279, F280, F281, F282, F283, F284, F285, F286, F287, F288, F297,
F298, F299, F302, F305, F306, F312, C001, C002, C003, C004, C005, C006, C007,
C009, C012, C013, C014.

An ambient operator, system, maintenance, or management root does not automatically move a row
out of this set. If policy intends that root to choose subjects, the row must enforce the exact
entitlement and operation scope. “Ambient by design” without an executable entitlement predicate
is still LIVENESS-ONLY.

### `NO-SUBJECT` rows — exact rows and a narrow claim

The only permitted claim for these 94 rows is **NO-SUBJECT-INTRODUCED-AT-THIS-ROW**:

F004, F007, F009, F010, F012, F013, F015, F016, F017, F018, F021, F023, F024,
F025, F035, F036, F040, F041, F050, F051, F052, F071, F072, F077, F079, F080,
F099, F104, F105, F106, F107, F108, F109, F110, F111, F114, F116, F123, F124,
F125, F130, F131, F132, F134, F135, F136, F137, F138, F139, F140, F141, F142,
F151, F155, F156, F158, F159, F164, F165, F166, F167, F169, F200, F201, F206,
F207, F216, F221, F222, F223, F225, F226, F228, F229, F231, F241, F245, F246,
F248, F249, F250, F251, F252, F253, F262, F263, F275, F276, F277, F278, F294,
F301, F304, F311.

`NO-SUBJECT` is not a safe class. F004 (`AuthProvider::admit`) names no subject, but F053 can use
the resulting admission to name any live session. F155 produces an anonymous stream publication
with no principal subject, but F127 can attach it to a separately prepared session authority.
Each later join has its own row and must be audited.

### `UNCLEAR` rows

The checked-in rows are F208, F256, and F266:

- F208 and F256 are the engine/kernel halves of push-send reservation. Immediate user audience
  appears checked; the System/Deferred/other audience matrix has not been exhaustively traced.
- F266 is the bounded commit capsule. F261 and F262 correlate destination authority and
  reservation, but caller-constructible operation identity and separately supplied uncertainty
  retention leave semantic subject correlation unproved.
- The other three `UNCLEAR` factories named only by the commissioning count have no checked-in row
  identity. Phase 0 must name them before work or claims can proceed.

Every `UNCLEAR` row stays in scope. It may become `OWNERSHIP-CHECKED`, `NO-SUBJECT`, or
`LIVENESS-ONLY` only after the inventory records the inspected predicate and exact evidence. It
cannot be accepted by absence of a constructed attack.

## Staging `KEEP` is an enumerated candidate set, not a safe class

The staging inventory currently marks the following 50 temporary row keys `KEEP`:

- `crates/snapback-server/src/server/commit_capsule.rs:206`
- `crates/snapback-server/src/server/commit_capsule.rs:78`
- `crates/snapback-server/src/server/commit_capsule.rs:100`
- `crates/snapback-server/src/server/commit_capsule.rs:705`
- `crates/snapback-server/src/server.rs:29193`
- `crates/snapback-server/src/server.rs:29409`
- `crates/snapback-server/src/server.rs:29450`
- `engine.rs:4517`
- `engine.rs:28483`
- `engine.rs:28583`
- `crates/snapback-server/src/server.rs:4394`
- `crates/snapback-server/src/server.rs:18179`
- `engine.rs:5069`
- `engine.rs:5094`
- `engine.rs:5107`
- `engine.rs:5127`
- `engine.rs:5173`
- `engine.rs:5183`
- `engine.rs:5237`
- `engine.rs:5250`
- `engine.rs:5328`
- `engine.rs:5341`
- `engine.rs:5865`
- `engine.rs:5908`
- `engine.rs:6391`
- `engine.rs:6443`
- `engine.rs:6456`
- `engine.rs:6479`
- `engine.rs:6511`
- `engine.rs:6523`
- `engine.rs:6696`
- `engine.rs:6723`
- `engine.rs:7141`
- `engine.rs:7219`
- `engine.rs:7292`
- `engine.rs:11338`
- `engine.rs:16533`
- `engine.rs:16546`
- `engine.rs:16674`
- `engine.rs:16696`
- `engine.rs:16725`
- `engine.rs:16747`
- `engine.rs:16839`
- `engine.rs:16894`
- `engine.rs:18124`
- `engine.rs:18149`
- `engine.rs:21770`
- `engine.rs:24618`
- `engine.rs:24933`
- `engine.rs:25016`

The permitted baseline claim is only: **the inventoried signature/body at each listed location
does not itself expose the specific independently selectable staging pair the inventory tests**.
This is not an end-to-end claim. A `KEEP` row fed by F053, F143, F175, another LIVENESS-ONLY
factory, or a free C-construction surface remains vulnerable upstream. Conversely, a correct
factory does not make a later `MOVE` or `DELETE` row acceptable.

All `MOVE` and `DELETE` staging rows remain work. Because the file lacks stable IDs, each landing
must name the exact temporary location/signature keys it changes; after Phase 0 it must name their
assigned stable IDs. The missing requested `UNCLEAR` row blocks the final claim until named and
resolved.

## Verified adversarial breaks and their row-level consequences

### B4 — the sealed consuming protocol already exists and is already defeated

**VERIFIED CODE FACT.** `AuthProvider::admit` is public and only acquires shared maintenance
(`crates/snapback-auth/src/auth/provider.rs:3080-3085`). It is F004, correctly classified
`NO-SUBJECT`.

**VERIFIED CODE FACT.** `AuthAdmission::record_authenticated_use_plan` is public and captures a
caller-supplied `session_id` and generation in a sealed closure
(`provider.rs:3383-3394`). The closure's durable leaf proves only that the selected session is
live/current. This is F053, `LIVENESS-ONLY`.

**VERIFIED CODE FACT.** `LocalSnapback::execute_auth_plan` publicly executes any sanctioned sealed
`AuthDatabasePlan` against the private database
(`crates/snapback-engine/src/local/engine.rs:6749-6756`). The trait is genuinely sealed. F001 is
the crate-visible closure-plan factory used by F053. Sealing prevents an external implementation;
it does not authenticate the subject captured by a sanctioned factory.

**Required row disposition.** F053 must derive the session from a verified bearer/exact
predecessor or verify a caller's exact session ownership in the plan's protected transaction.
F001 cannot verify an arbitrary closure and therefore cannot remain as the current production-
reachable `pub(crate)` factory. That exact row is deleted; a private implementation detail may
remain only behind individually enumerated, subject-specific factories, and the factory detector
must flag every new use. F004 may remain only with its narrow no-subject claim.
`execute_auth_plan`'s seal is defense in depth and earns no ownership claim.

### B5 — the inverse direction returns authority for an independent subject

**VERIFIED CODE FACT.** F175,
`LocalSnapback::resolve_retained_effect_service_authority`, uses `management` only to acquire
`management.effect_guard(...)`, then sends caller-selected actor/credential/grant/token/effective
user facts to the database, registers their service witness, and returns a live
`ResolvedServiceAuthority` (`crates/snapback-engine/src/local/engine.rs:5194-5234`). The database
checks that B's rows are live, not that management authority A owns or may reanimate B.

**Required row disposition.** F175 must load an exact pending-effect/durable-work record owned or
actionable by the presented management authority and derive the retained service tuple from that
record, or enforce an equivalent exact entitlement over the tuple before returning authority.
The output carrier must preserve that verified association. A successful row-liveness lookup is
not ownership, and a returned authority is in scope even if no later write occurs in this call.

### B6 — an admission lease cannot be the correlation identity

**VERIFIED CODE FACT.** `AdmissionLease` derives `Clone`, and every clone shares one
`Arc<LeaseToken>` (`crates/snapback-auth/src/auth/admission.rs:816-820`). F143
`prepare_admitted_authority` accepts that lease independently from a publicly constructible
`ResolvedAppAuthority`; F144 performs only admission/mode/source-class checks before joining them
(`crates/snapback-sync/src/auth/invocation.rs:2714-2765`). C005 makes the resolved enum directly
constructible. One cloned lease can therefore prepare multiple subjects.

**Required row disposition.** F143, F144, and C005 cannot use lease equality, pointer equality,
transition generation, or admission epoch as subject correlation. General loose pairing is
deleted or replaced by an owner-minted carrier containing a subject established by a factory
predicate. The admission lease remains inside that carrier solely for liveness.

**VERIFIED CODE FACT.** F147/F148 select service scope using both function ID and `FunctionKind`
(`invocation.rs:3029-3032`) and store both in `PreparedInvocation` (`:2949-2956`). These rows are
`OWNERSHIP-CHECKED` prior art. Any post-check association identity for a function operation is
minted after F147/F148 and includes both ID and kind. An origin minted at root preparation, or an
identity containing only function ID, is insufficient.

### Earlier late-assembly break — still closed only by exact row work

The earlier fix does not regress, but it is now stated as a row set rather than a description of
“final authority assembly”:

- F126 joins rehearsal binding and authority.
- F127 joins a separately produced publication to an authority; F155 is the no-subject anonymous
  publication producer involved in the verified substitution.
- F128 joins a service publication; F111/F113/C006 are the registry/register/witness construction
  chain involved in the verified service variant.
- F129 and F133 attach attribution and stream incarnation.
- F143–F146 construct admitted authority from independent liveness and subject inputs.
- F149/F150 create durable descriptors from independently supplied stream incarnation.
- F157 and F160 rebuild session/bearer authority from caller-selected subject facts; F161/F162
  separately mint room/preflight authority from caller-selected room-impact subjects.
- F210–F215 are engine assembly rows; F214 is currently `OWNERSHIP-CHECKED`, F210–F213/F215 are
  not, and F216's no-subject result does not prove its upstream resolution.
- C001–C006 and C012 are freely constructible subject/authority/witness/descriptor carriers used
  by this cohort.

No “mint origin last” claim is available for that cohort today. The row-level remedy is to reuse
the exact bearer/database-check shape of F152–F154 and F214 where applicable, delete loose joins,
and mint any private association token only after the row's exact predicate and complete
publication/rehearsal/service/function scope are fixed. Compile-fail tests may then prove that the
named replacement joins cannot be expressed; they do not prove the predicates inside the
replacement factories.

### Earlier function/effect and open-pending break — staging remains a separate axis

F147/F148 fix function selection only. They do not make a later pending value and final guard
correlated. The staging inventory still names these exact watch/capsule rows:

- `crates/snapback-engine/src/local/engine.rs:24960`
- `crates/snapback-kernel/src/storage/watches.rs:685`
- `crates/snapback-kernel/src/storage/watches.rs:322`
- `crates/snapback-server/src/server/commit_capsule.rs:181`
- `crates/snapback-server/src/server/commit_capsule.rs:630`
- `crates/snapback-server/src/server/commit_capsule.rs:760`

The first five remain `MOVE`; the wrapper at `:760` also remains `MOVE` in the staging inventory
and F266 remains `UNCLEAR` in the factory inventory. F261/F262 and staging rows
`commit_capsule.rs:78`, `:100`, and `:206` are useful exact prior art but cannot justify F266 or
the open `PendingCommit` consumer.

The remedy remains consuming association preservation: staging accepts the checked carrier, the
pending state retains its private association identity, and final commit consumes that state.
Every independently accepting pending/guard/callback sibling named by the staging inventory is
moved or deleted. The identity is factory-minted after the predicate and exact operation scope;
it is not a root origin or admission lease.

### Earlier reservation-free and direct-write breaks remain in scope

F190/F191 are the grant/bulk-grant terminal planners that validate admission while accepting
owner and grant/actor identifiers independently. Their staging rows at `engine.rs:5940` and
`:5969`, along with their separate acquire/write rows, remain `MOVE`. A per-site fix may derive the
owner from the caller authority or perform an owner-keyed lookup and return one exact terminal
carrier. The fix is complete for those rows only when the inventory reclassifies F190/F191 and the
linked staging rows no longer permit a split.

The service-deadline rows `engine.rs:7626`, `:7634`, and `:7643` remain `MOVE` in the staging
inventory. They prove that the eight generic `before_commit()` cuts are not the population. The
remedy must preserve the exact terminal observation/plan through the direct durable write; a
generic product census limited to those eight cuts cannot claim completion.

## Required control model

### 1. Verify ownership or entitlement at every subject-bearing factory

For every F/C row that introduces, selects, joins, or returns a subject-bearing authority value,
the row-specific verifier must establish one of these exact relationships before the minted value
is honored:

1. **Possession-derived subject:** a bearer, password, recovery code, delivery proof, PKCE
   verifier, MAC, or other exact opaque proof selects the subject; the caller cannot name a
   different subject beside it.
2. **Authority-owned subject:** the subject is derived from the presented authority, or a durable
   lookup is keyed by both the authority-derived owner and caller selector.
3. **Exact predecessor/work ownership:** the subject comes from a durable row/ticket/work claim
   whose opaque identity, generation, database binding, and owner/entitlement are verified.
4. **Explicit ambient entitlement:** a real operator/internal/system root is authenticated and the
   executable policy authorizes that exact root, subject tuple, purpose, and operation scope.

A liveness/admission/epoch/mode check, a successful lookup of the selected subject, value-shape
validation, database binding alone, private fields, a sealed trait, a doc comment, or current
caller discipline satisfies none of these relationships.

When an authority-increasing durable write is involved, LLP 0293's stronger rule still applies:
the durable or cryptographic predecessor is re-read at the protected resolution/transaction cut;
an earlier in-memory carrier is not evidence for the write. LLP 0293 is Review, so this design
uses its verified-subject/purpose invariant as a constraint, not as an implementation claim.

### 2. Preserve the checked association only where a boundary requires it

After a factory predicate succeeds, a row may return an exact opaque carrier. The carrier contains
or commits to:

- database/owner identity when relevant;
- authority class;
- canonical subject tuple;
- purpose and exact operation scope;
- function ID **and kind** for a function operation;
- durable predecessor/generation or opaque work identity;
- required publication, session, service, and rehearsal state; and
- a private association identity minted after all of the above are fixed.

The carrier is not a universal authority root and is not accepted as evidence for a new
authority-increasing write. It is scoped to one named factory row and named consumers. It need not
be introduced where an existing exact proof is already consumed in one function.

Non-`Clone`, private fields, no serde/conversions, and a consuming API can make post-factory
substitution structurally impossible through named safe-Rust surfaces. They do not make a missing
or incorrect factory predicate impossible. B4 is the permanent counterexample.

### 3. Close each enumerated staging/consumer row

For a staging row that crosses a boundary, the checked carrier—not a fresh authority, subject,
reservation, plan, ticket, guard, or callback—is the only authority-bearing input. Staging returns
a state carrying the same private association. Commit consumes it and accepts no independently
selectable security input.

If borrowing requires internal halves, both halves carry the same private association and can be
rejoined only inside one owner module. Compile-fail evidence must target the exact staging row.
A generic `PendingCommit`, generic `BeforeCommit -> G`, `G = ()`, raw
`AdmissionEffectGuard`, optional reservation, or independently supplied terminal gate remains a
split unless its exact row proves otherwise.

Final liveness acquisition remains last, after fallible policy/database/rehearsal/publication
checks and immediately before the durable cut. That is LLP 0058/0059 ordering, not subject proof.
No correlation identity is derived from the admission lease.

### 4. Direct construction surfaces are part of the producer population

C001–C014 cannot be dismissed as “just data types.” For C001–C007, C009, and C012–C014, either
construction becomes unavailable to the caller class or every honoring factory re-verifies the
complete subject/proof relation before returning authority or committing an effect. C008, C010,
and C011 remain only because their consumers verify the MAC/registry relationship; free
construction itself provides no power.

### 5. Detectors ratchet the enumerations; they do not prove semantic checks

The factory detector covers factory-like names, authority-shaped return types, conversions/direct
construction, sealed protocols, and later consumers. The staging detector covers authority plus
independent subject signatures, plans/tickets/pending carriers, direct durable effects, returned
authorities, generic final callbacks, and raw guards. LLP 0298 auxiliary effects remain explicitly
enumerated against all four accepted criteria.

Those searches cannot prove that a predicate is sufficient, that a renamed helper is in scope,
or that an FFI/unsafe/dynamic-storage path is absent. Required body review, predicate mutation,
negative runtime tests, compile-fail fixtures, and independent adversarial review carry that
residual.

Three rules cannot be expressed as a current row set: that each row's semantic predicate is
sufficient, that the derivations found every relevant source spelling, and that future code will
continue to fit either inventory schema. Predicate mutations/foreign-subject tests detect the
first; redundant factory/staging/storage derivations detect the second; and the registry ratchet
plus independent source review detect the third. None is upgraded to structural impossibility.

## Relationship to parallel per-site ownership fixes

The parallel per-site work is the primary remediation, not a temporary patch this design
supersedes.

- This design **runs beside** those fixes by defining their row-addressed acceptance evidence and
  the downstream staging rules that keep a correct predicate from being separated later.
- The final claim **depends on** every affected factory row being deleted, reclassified with
  evidence, or proved no-subject. It does not assume this design lands first.
- If a correct ownership/entitlement fix lands first, Phase 0/1 re-derives the inventory and
  credits that exact row. No product rewrite is repeated merely to conform to an architectural
  aesthetic.
- A per-site factory fix does not subsume a linked staging `MOVE`/`DELETE` row. Conversely, a
  carrier migration does not subsume its factory predicate.
- Existing F003/F098/F147/F148/F152–F154/F174/F214-style checks should be reused where they match
  the exact subject/purpose. New abstractions are justified only for repeated transport and
  final-cut choreography after verification.

Given the checked-in 134 LIVENESS-ONLY rows, per-site checks are better than a single universal
product architecture. The universal product would still need 134 correct constructors and would
add another powerful shared protocol whose factories could repeat B4. Row-specific predicates
plus narrowly scoped carriers minimize the amount of code trusted for each authority relationship.

## Migration phases and the exact claim permitted after each

Every claim is bound to an integrated commit, inventory derivation digest, and explicit row set.
No phase borrows a later phase's property.

### Phase 0 — reconcile and freeze both row-addressable registries

Re-run both inventory derivations on the implementation base. Reconcile 326 versus 338 authority
surfaces and 247/258/279 staging figures. Name all six requested factory `UNCLEAR` rows and the
one requested staging `UNCLEAR` row, or correct the receipts with reviewed evidence. Assign stable
IDs to every staging row and distinguish semantic rows from reachability edges.

**Permitted claim:**

> `INVENTORIES-ADDRESSABLE@<digest>`: every surface found by the declared factory and staging
> derivations at `<commit>` has one stable row identity, one production-reachability record, and
> one explicit unresolved/disposition state.

**Why true then:** the checker's output and checked-in rows have a one-to-one key/digest mapping,
and arithmetic totals are generated from those keys rather than copied from prose.

**Not permitted:** semantic completeness, factory correctness, staging closure, route closure,
structural impossibility, or either durable/returned-authority property. New spellings and detector
blind spots remain a DETECTION BOUND.

### Phase 1 — repair factories row by row

Process LIVENESS-ONLY and direct-construction rows in any order, including fixes that landed before
this design. Resolve UNCLEAR rows rather than treating them as safe. Re-audit each retained
OWNERSHIP-CHECKED row against its exact code and add a predicate mutation/negative test.

Every landing receipt names the exact F/C IDs, authority/proof input, subject tuple, operation
scope, predicate location, negative test, mutation, and resulting classification.

**Permitted claim per landing:**

> `PREDICATE-VERIFIED {F/C row IDs} @ <commit>`: at the named rows, the named authority/proof owns
> or is entitled to the named subject and purpose before the returned value can be honored.

**Why true then:** the row bodies perform the recorded derivation/check, success and foreign-
subject negatives exercise the exact path, and removing or widening the predicate makes the named
mutation test fail.

**Not permitted:** structural impossibility, correctness of another row, downstream association
preservation, or a population-wide claim. Semantic sufficiency remains review/test evidence, not a
type theorem.

### Phase 2 — preserve verified associations across named boundaries

For exact Phase-1 rows whose results cross staging, async, database, or crate boundaries, add or
reuse a narrow carrier minted after the verified predicate and complete operation scope. Delete
loose subject/authority joins for those same named paths. B4's F001/F004/F053 chain, B5's F175,
B6's F143/F144/C005, the late-assembly cohort, and F190/F191 are mandatory early slices.

Every landing receipt names both its factory IDs and all producer/consumer/staging IDs it exposes.

**Permitted claim per landing:**

> `ASSOCIATION-PRESERVED {factory IDs -> consumer/staging IDs} @ <commit>`: after the named factory
> predicate succeeds, safe callers through the named replacement APIs cannot replace the subject,
> purpose, exact function `(id, kind)`, predecessor, or required publication/fence association.

**Why true then:** the association is minted only after the named predicate, private fields and
consuming transitions preserve it, the old loose joins are absent for the named rows, and exact
compile-fail substitutions fail at the recorded spans.

**Not permitted:** that the factory predicate is logically infallible, that an unlisted consumer
does not exist, or that another factory/staging row is closed.

### Phase 3 — execute the complete staging `MOVE`/`DELETE` ledger

For each stable staging ID, migrate the complete vertical slice. A `MOVE` replacement and every
alternate `DELETE` sibling reaching the same effect land together. Re-audit the 50 current `KEEP`
keys named above after stable IDs exist; their exact factory provenance must also be
PREDICATE-VERIFIED or NO-SUBJECT at that point. Resolve the requested missing `UNCLEAR` row.

**Permitted claim per landing:**

> `STAGING-CLOSED {staging row IDs} FROM {factory row IDs} @ <commit>`: the named staging and
> durable-consumer paths preserve the named verified association, and the named legacy split
> signatures are absent.

**Why true then:** each named stage/commit consumes one association-preserving state, all alternate
named raw/generic/direct siblings for that effect are deleted, and B/A, F1/F2, replay, and
double-use compile/runtime attacks fail for those exact rows.

**Not permitted:** “all staging,” “all guarded writes,” “all 279,” or the repository property until
the exact reconciled registry has no unresolved legacy row.

### Phase 4 — close the enumerated population and auxiliary boundary

Require all reconciled factory rows to be PREDICATE-VERIFIED, narrowly NO-SUBJECT with honoring
consumers audited, or deleted. Require every staging row to have a final disposition and evidence.
Require every returned authority and every LLP 0298 durable effect found by the registered search
to point to its exact factory and consumer row. Enumerate every auxiliary exclusion against all
four LLP 0298 criteria. Run the complete adversarial mutation matrix.

**Permitted claim:**

> `ENUMERATED-ROWS-RESOLVED@<digest>`: every exact row in the two reconciled registries has the
> recorded final disposition and required row-local evidence; no present row remains
> `LIVENESS-ONLY`, `MOVE`, or `UNCLEAR`, and every row whose final disposition is `DELETE` is absent
> from the integrated production surface.

**Why true then:** the registry checker compares exact keys and signatures, all dispositions have
evidence references, re-derivation adds no unregistered candidate inside the declared boundary,
and the staging/auxiliary checks are green.

**Not permitted:** that detector completeness or semantic predicate sufficiency is structurally
impossible to violate. This phase is still a DETECTION BOUND.

### Phase 5 — scoped claim gate; not currently supportable

Phase 5 additionally requires:

1. Phase 0's counts and missing `UNCLEAR` identities are reconciled.
2. Every Phase 1–4 receipt binds the exact integrated code, tests, inventory rows, and derivation
   digest.
3. B4, B5, B6, anonymous/session publication substitution, service-witness construction,
   rehearsal substitution, F1/F2 function-kind substitution, grant/bulk-grant foreign owner,
   open pending/capsule, service-deadline, raw-guard, no-reservation, and returned-authority
   mutations are green.
4. The LLP 0298 auxiliary-effect registry is complete at the declared detector boundary.
5. Grok's corrupted middle is re-requested or explicitly waived by the author.
6. A fresh independent adversarial review examines factory predicates and downstream transport as
   separate questions and finds no material construction path.

**Permitted claim before all six conditions:** none beyond exact earlier-phase row claims.

**Permitted claim after all six conditions:**

> At `<commit>` and within the reconciled production-Rust, feature, storage, and caller-class
> boundaries named by inventory digest `<digest>`, every enumerated subject-bearing factory checks
> the presented authority/proof's ownership or exact entitlement before its result is honored,
> and every enumerated downstream staging/consumer path preserves that checked association through
> its durable effect or returned authority. The named safe-Rust post-factory substitution attacks
> are structurally impossible through the enumerated replacement APIs; the named semantic
> predicate mutations and adversarial executions found no passing foreign-subject construction.

**Why true then:** exact row evidence establishes each predicate; exact type/compile-fail evidence
establishes post-factory non-substitutability for each carrier path; exact runtime mutations cover
the durable and inverse returned-authority outcomes; and re-derivation/review found no unregistered
surface within the declared boundary.

The final sentence intentionally says “found no” for semantic attacks and “structurally
impossible” only for named post-factory safe-Rust substitutions. Future edits, unsafe memory
fabrication, unrecognized FFI/dynamic storage, detector blind spots, and the semantic completeness
of a new predicate remain detection/review residuals. No stronger global impossibility claim is
authorized.

## Required evidence matrix

### Factory-predicate attacks

For every subject-bearing factory row:

1. A positive control uses the exact owner/proof and produces a non-empty authority/effect witness.
2. A foreign subject with the same live epoch/generation is refused.
3. A same-ID/different-kind function scope is refused where functions are involved.
4. A stale/revoked/wrong-database/wrong-generation predecessor is refused as applicable.
5. Removing the owner/entitlement comparison turns the negative red.
6. The test observes the exact factory and honoring consumer, not a route precheck.

B4 additionally mutates F053's session ownership while keeping F001's seal intact. B5 observes
that F175 returns no live service authority for the foreign tuple. B6 uses two clones of one
`AdmissionLease` against two resolved subjects and must fail at the factory association, not at an
unrelated later route rule.

### Association-preservation attacks

For every carrier boundary, fixtures attempt to:

1. construct the carrier from authority A and subject B;
2. pair a verified B product with A's lease, publication, service witness, rehearsal binding,
   terminal gate, pending transaction, uncertainty retention, or final guard;
3. extract/replace/clone/serialize/reconstruct the association identity;
4. use function F1's ID with F2's kind, or F1 `(id, kind)` with F2's staged state;
5. reuse consumed unstaged/staged state;
6. implement or invoke a raw pending/proof/callback sibling; and
7. commit through a direct storage path around the carrier.

Compile failure supports only the named API closure. Owner-module runtime tests deliberately
construct internal mismatches and require refusal/rollback plus no durable or returned-authority
witness.

### Final liveness and durable-cut attacks

For each applicable staging row, instrumentation proves zero final admission guards before arm,
one exact guard immediately before the durable cut, retention through that cut, and drop before
post-commit publication. Mutations acquire early/twice, use another controller, restore post-arm
fallible work, restore `FnOnce() -> Result<G>`/`()`, or drop the guard before commit.

This evidence is about liveness ordering. It does not substitute for the factory predicate or
association-preservation evidence.

### Inventory attacks

The registry checker fails on an unregistered:

- authority-shaped factory, sealed-plan factory, conversion, or direct construction surface;
- authority validation plus independent subject/selector/plan/ticket parameter;
- output authority derived from an independently supplied subject;
- generic callback/proof/pending carrier, raw guard, optional reservation, or public authority
  join;
- durable SQLite/object-store/filesystem/receipt/queue/trigger/publication cut; or
- auxiliary-effect classification lacking all four LLP 0298 criteria.

The shortest gate-preserving violation remains a new spelling or unrecognized FFI/storage path.
The registry is a ratchet and addressable work list, not a proof by itself.

## Relationship to governing LLPs

This design does not supersede LLP 0283 F-1. Factory correlation does not close public raw SQLite,
caller-claimable universal roots, self-implementable/callback authority factories, or forgeable
membership provenance. F-1 remains open.

LLP 0058/0059 still govern admission, publication, ticket, drain, and final-cut ordering. Those
fences answer whether already-authorized work remains live; they do not answer who owns the
subject. Admission-lease equality is expressly non-authoritative for correlation.

LLP 0290 remains database-bound participant prior art. Its exact database/registry/generation
checks prevent A-database/B-participant substitution, but database binding alone does not prove a
principal owns a subject.

LLP 0293 states the stronger invariant for authority-increasing writes and returned authorities:
the protected resolution cut derives subject, class, purpose, predecessors, and time. Its own
§8.2–8.3 correctly says source gates cannot prove semantic verifier sufficiency. Because LLP 0293
is still Review, this document does not claim its proposed chokepoint is implemented or
authoritative.

LLP 0298's durable-effect boundary is unchanged. Publications, object/file writes, queues,
receipts, and trigger state remain in scope. An effect is auxiliary only when its exact enumerated
row satisfies all four accepted criteria. An unclassified or unclear effect stays in scope.

## Stop rules

Stop and return to design review when:

1. a factory cannot state its authority/proof-to-subject entitlement as an executable predicate;
2. an ambient root would need “trusted by convention” or a caller-supplied `verified` fact;
3. a carrier must be minted before the factory predicate or before exact function ID and kind are
   fixed;
4. a proposed correlation identity is the admission lease, its `LeaseToken`, epoch, generation,
   or another clonable liveness value;
5. an implementation preserves a sealed consumer but leaves a sanctioned LIVENESS-ONLY factory;
6. a staging migration leaves an alternate raw/generic/direct sibling for the same effect;
7. a requested `UNCLEAR` row still lacks an identity or evidence;
8. a count cannot be regenerated from exact row keys; or
9. a claim would need “we could not construct a violation” to mean “impossible.”

If a row cannot be expressed as one of the two inventory row types, say so and extend the detector
and registry before implementation. Prose characterizations of good factories or trustworthy
modules are not a fallback.
