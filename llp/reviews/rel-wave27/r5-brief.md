Review the normative §21 amendment and release_bridge.rs exact_write_authority implementation for MATERIAL safety/custody/design defects. Return READY if none, otherwise MATERIAL with concrete repair. Do not edit files or run builds. This is a fresh blind review. The wave-27 full-store replay found source selection falsely refused already-protected dispatcher/planner operations. The revised gate admits closed Boolean containment and stable dominating viewer/literal positive-existence requires over fully expanded IR writes; branches/loops participate in the write set. Scope changes, emits and unknown implicit writes still refuse. Read code if useful; focus on proof soundness and remaining false refusals. Security-owned code is unchanged.

Normative section:

## 21. Wave-27 release semantics (REL)

Implementer: Codex for Charlie Cheever, 2026-10-24. Commission: wave-27
fix list 10b #1, #2, #3, #5, #7 and #8. This amendment supersedes the narrower
input adapter and extraction type equality restrictions in §20 only as stated
below. Retention, transactional validation, lifetime custody and current policy
admission remain in force. No publication, version bump or push is authorized.

### Registration and guarded source

A new column write audience or frozen column alone does not register a view.
Structural domain widening, actual old-row hiding/misrepresentation and the
existing unchanged-data/intent executable repair protection determine need.
Historical source selection (including an equal-source forward deploy) checks
column write/freeze authority against both the active source AND latest ordinary
source (both must pass), so an intervening old selection cannot erase that boundary. This is a
closed static admission gate under command locking and activation CAS. It aligns
declared table/column identities and complete probe-index meaning. Every old
insert/update/upsert that can supply a protected column must retain the policy,
or a conjunctive table guard must contain the exact compiled current policy as a
conjunct after identity/probe alignment (deny implies every policy, allow needs
no guard). Closed Boolean containment additionally admits each branch of an old
OR only when it admits the new policy, an old conjunct when it admits the policy,
a new OR when one branch is admitted, and a new AND only when every branch is
admitted. These are structural sufficient conditions, never sampled implication.
A dominating leading `require` may supply that same containment when its compiled
policy uses only viewer/literal equality or positive existence with viewer/literal
keys and equalities (and AND/OR). Every dependency must be disjoint from the
operation's complete expanded IR write set. Conditional/loop writes participate
in that set; they do not themselves change the viewer. JobAs/JobQuery/emitted
external effects and implicit maintained/sequence/referential writes refuse this
reduction. Rules depending on row images, negative probes, references or mutable
locals cannot supply it. Other operations, jobs or external writers cannot
interleave within this atomic mutation; their presence alone is not a blocker.
Finite campaigns never supply proof.
A known object patch is the compiled syntactic fixed-key object with no spread,
computed key or dynamic base. If it omits a field it is not a write to that field;
all other patch forms remain conservative. Insert defaults count. Upserts must satisfy both arms.
Transition-bound guards and missing freezes need an authored guarded bridge;
there is no guessed implication. Selection refuses with operation, column and
rule before those old writes become live. Read-only/unrelated writes remain
selectable. New ordinary source may deliberately change policy through the
normal deployment review. Historical selection never dynamically rewrites its
immutable executable or grants an acknowledgment bypass. `check` compiles needed views against an explicitly selected deployment
store as well as the normal saved-client baseline, without registering them or
mutating immutable source. Production deploy repeats compilation and writer
validation. A source-only check with no predecessor cannot qualify a production
transition and says so in the guide.

Typed table alpha conversion edits only nominal type and table-reference AST
slots. For-loop table domains are adapted only without an argument/local shadow
in that lexical scope; named values/shapes stay untouched. The compiler resolves
explicit Read/Write AST slots as tables and Name/ShapeUse slots as values/shapes,
so unchanged argument/local/shape slots cannot capture a rewritten typed read.
The complete adapted closure recompiles; unsupported resolution still refuses. Argument/local/shape spelling equal to a table name is safe when those
slots remain unchanged. Table mappings stay injective, every destination must
reparse nominally, and conflicting/unsupported source spans refuse. Column write
and frozen predicates participate in exactly the same transport and compiled
current-authority comparison as read predicates. Business literals never change.

Guarded views retain the current execution closure. An incompatible old write
export (new required argument, removed input, narrowed domain or merged wire
position) may be paused with E_OP, including a same-name current write. The
view removes that export and reports its operation and incompatible argument;
it does not revive an old body, make a required choice optional, supply an
invented default, or mark a removed data-bearing input deprecated. Other names
of the same authored endpoint are considered independently. Required old
queries still need compatible current endpoints; refusal identifies their real
source site and argument. Removed required/defaulted fields need a truthful
reverse projection or an authored bridge. Every refusal identifies the concrete
site and relevant table/column/argument/rule instead of an empty :0:0 site.

### Selection and identity

Every successful human deploy/rollback, including unchanged deploy, prints one
stdout `live:` line. JSON reports `live` with selected `release`, logical ordinary `source`, numeric selected `view` (null for original source),
logical `target`, and Boolean `exact`. A view also names its registration
`parent`; source/target are the predecessor and release/view the actual compiled
source. Ordinary source has no view and all source/target/release ids agree. `releases --json` exposes the same object. Previews identify the candidate
separately and never claim a move. An equal forward deploy matches ordinary
releases only: it selects that ordinary id under the normal restoration/CAS
validation rather than leaving an equal-content view selected. A genuinely
changed desired registry may still require a new registration parent.

A default view writes with its immutable compiled guarded workflow and current
registered authority. Complete-current views retain current programs/defaults;
selective predecessor views retain old programs with carried guards and reused
current endpoints as recorded in their change checklist. Existing registered
selective views remain valid under that narrower disclosed promise. Identity
output names the registration parent, never claims a view runs every program of
that parent, and directs inspection to the actual compiled source. Exact
selection requests immutable original source, subject to current safety gates.
Foresight distinguishes exact-source risks from a registered view that covers
them and names that view. Legacy redeploy advice applies only to parents lacking
a view manifest; a modern refusal names the actual migration/repair instead.

### Extraction and migration cycles

Forward extraction accepts an identical authoritative source type or required
to optional widening of that identical type; no bounds, MIME, once, nominal or
cardinality conversion is implied. Reverse validates the actual child value
against the selected parent domain; null cannot be invented for a required
parent. A receipt-owned, validly anchored child whose asset cell is absent/null may be
refilled only with the current parent cell. A nonnull source must have the live
ledger home on that parent and matching existing bytes before transfer; no
historical receipt value is used to recover a cleared/released upload. A null
source moves no bytes and remains null. This ledger-home proof distinguishes a
reversal-moved value from a child clear whose released asset has no parent home.
A distinct nonnull child asset still conflicts. Transfer verifies the live ledger home and bytes inside the same adoption writer transaction as transfer, under command locking and CAS; failure rolls back homes, cells and receipts together. It never recreates deleted/pruned child history.

Every non-each extraction that replaces a predecessor cell prepares a
current-workflow view, including empty deployments: independent future children
cannot truthfully fit one old cell. Its current schema may omit that extracted
parent field while retaining the entire child population; old query/result
changes are disclosed, no child is chosen, and no parent row is hidden.
Inherited read-through admits an identical or structurally stricter parent rule.
Source/child payload policies compare under explicitly copied immutable scalar
identities. The inclusion direction is CHILD audience ⊆ SOURCE audience, never its inverse.
The closed subset rule admits equality, child deny, source allow, and Boolean
conjunction/union inclusion only: every child-disjunction arm must fit the
source; every source-conjunction arm must cover the child; a child-conjunction
may narrow via any covering conjunct, and a source-disjunction may cover via
any covering arm. All other cases refuse. Different atoms are never equated. Row-field
transport requires immutable scalar copies in BOTH source and child. Unmapped
source fields cannot accidentally match same-spelled child fields. Probe index
meaning and read policy must remain the source context. A source payload gate must be covered by the child row rule, inherited parent
rule or an identical/structurally stricter child column gate after that identity
transport; otherwise refusal names source, destination and the missing read rule.
No gate is silently discarded and no semantic policy implication is inferred. A parent with multiple independent children has no automatic single
asset representation. `rollback --check --bridge DIR` always writes a usable
current-source bridge plus a repair checklist naming the parent/reference and
mapped fields: keep the current population visible, choose a truthful old
representation through an authorized mutation, preview exact rollback, and only
then select it. No arbitrary child is selected, discarded or hidden.

Backfill/down receipts distinguish current native output from its projected old
view on every cycle. Reversing again verifies the physical value against the
previously accepted view before reusing retained native output, so a projection
must not become a new authored value merely because a second cycle occurs.
Actual changes to old dependencies still recompute or refuse competing authored
values. Definition names keep their immutable meaning; repairs name the order:
select/deploy a bridge preserving current values, apply authorized repairs, add a
new transformation name for new meaning, preview, then select the destination.
Reference rename may change deletion policy in the same release provided its
nominal target, nullability, full type bounds, lifetime bindings and capture shape remain exactly identical (these define unchanged lifetime ownership); widening remains a separate migration; activation applies the
selected policy to subsequent deletes, never recapturing a reference lifetime.
`alias TABLE.COLUMN 'old' = 'new'` is an injective enum spelling declaration:
old is predecessor-only, new a current variant, and neither side can merge.
It lowers to normal immutable named backfill/down receipts, with current and
historical enum domains and no separate value codec. Wire arguments retain
their declared domain; a data-bearing old input needs an explicit consuming
compatibility endpoint. Arbitrary enum merges remain explicit transformations.

### Artifacts and proof

Saved versions capture a complete generated TypeScript module unit, including
its package marker. Source-selecting deploy uses private codegen and leaves the
working generated unit untouched. Extra deploy/rollback/release positionals
refuse before filesystem/store work. Human deploy prints the concrete refusal
before REVIEW notes. Day-two starter proof compares persisted rows by id across
two rollback/forward cycles; it excludes writes intentionally performed through
the v1 client and permits v2-native rows without fabricated v1 preimages.
Changed guide/starter fences execute against a packed package. Qualification
records affected tests, short language/store differential runs, all 50 copied
wave-27 stores and all 50 copied wave-25 stores against 0.4.40 and this build.
Read-only originals and credentials never enter artifacts. Mac is skipped.

### Review clarifications

Enforcing-key weakening, including changed compiled key meaning, remains an
explicit empty-population registration trigger in §20.1. Default domain joins
use nullable-if-either-nullable and the union cardinality interval; only an
explicit null-hiding acknowledgment retains a required joined domain. Optional
arguments use their authored literal default first, otherwise language null.
Backfill/down names are rejected on normalized definition/digest mismatch across
all retained history, including gaps and prune; repair wording states the ordered
bridge/authorized-write/new-name/preview sequence rather than suggesting name
reuse. Same-release reopen runs no alternate runtime: cold/preview/restart use
this runtime's format-9+ custody laws directly; the explicit protocol feature
fences the other process on hot requests. No foreign manifest is borrowed across
active-source contexts, regardless of chronology.

A reference policy change is an intentional authored behavioral change under
ordinary delete admission and cascade budgeting. In a generated current-source
view, predecessor delete exports that now reach a newly cascading/set-null edge
are paused with E_OP, including transitive cascade roots. The source view keeps
the current deletion policy, but never reuses an old delete name to destroy
children that old source would retain/refuse. This applies regardless of current
population or one-to-one/many shape; ordinary compilation still proves the full
cascade product bound. A compatible current delete wrapper may preserve the old
refusal. Exact source retains its original policy. Restrict/cascade behavior is
tested both ways. It does not recapture any parent lifetime.

Writer-time population checking includes conditional freezes separately from
grants: any freeze depending on a hidden population conservatively refuses,
including trusted system writes. Compiler-expanded helpers/transitive references participate in this same dependency closure; unknown dependencies refuse. Positive existence cannot disable a freeze
merely because its predicate IR stayed equal.

The starter excludes only explicitly enumerated fields (including named expected
derived changes) of deliberate v1 writes from unchanged-value assertions; it
checks the other fields, still requires those ids on forward and separately
checks authored business assertions. New rows are allowed, not fabricated as v1 preimages. Short
verification means difftest run-lean plus 2,000 ordinary generated cases.
Mac is skipped by the commission; no Darwin qualification is claimed. Existing
private native/worker source custody stays in force. Saved generated siblings
are evidence for the selected unit; known API/server/package artifacts regenerate
from the selected bound and never from a different working schema.

The backfill cycle repair gives current active successor receipts ownership of
their output cells; inactive receipts retain history without competing for that
ownership. An entering transform may consume another inactive receipt's accepted
reversed view, but its computed output must equal any retained authored native
output for that cell. Disagreement still refuses with both values and the ordered
repair path. This prevents a new transform name from laundering a discarded edit.
No predecessor/view image is promoted to authored native output merely because
another release cycle occurred.

Equal-source deploy continues §20.1's private desired-registry comparison: targets,
executable digests AND hiding reasons must match before identity reuse/collapse.
Missing or changed entries create a newly validated registration parent. The
`live:` line reports the resulting actual selection, not a digest-based guess.

