Fresh blind SNAPSHOT-ONLY semantic review. Do not use tools or run builds. Return READY if no MATERIAL safety/design defect, otherwise MATERIAL with exact repair. The authority/view/extraction/backfill implementation remains unchanged from dual-READY R10. This revision completes the proof's callback boundaries: initial v2 adoption checks predecessor ids BEFORE its callback; forward adoption checks surviving ids and all non-excluded values, plus absence of all declared deletions, BEFORE its callback and checks them again afterward. Rollback checks predecessor-id visibility and prior deletion absence BEFORE the v1 callback and checks them again afterward (allowing only newly declared visible-row deletions). A callback cannot conceal adoption loss/corruption or delete a resurrected row again before conservation is observed. The first v1 callback populates the initial application state. New rows are allowed; v1-born ids remain required forward. Deliberate deletions must start visible, have empty field lists, and remain absent on every subsequent measured boundary. Duplicate/ambiguous declarations refuse. Generic recipe claims storage conservation across cycles, not business-policy coverage; app callbacks own authenticated semantic assertions, including intended initial v2 value transformations. SDK deploy/rollback return after the new release is live; data/sql inspect complete active populations without writes. Review the exact recipe and complete amendment for remaining masking, resurrection or false-refusal issues.


One final completeness fix: the pre-forward snapshot now also requires EVERY id in the post-v1-callback `older` map, before any forward callback can repair it. This includes newly inserted v1-client ids absent from the prior v2 `current` map. Existing post-forward older→forward check stays. Only initial predecessor ids are required on rollback; newly v2-native rows may lack a v1 view. Please review this exact updated snapshot.


R15 repair: canonical table mappings are immutable per selected release; all renames resolve simultaneously against the prior ordinary map, never through the map being built. Source-content cache prevents repeated rename application after forward re-registration. A view uses its already measured logical target plus registration-parent identities for additional current tables. New tables reusing moved names get distinct identities. Distinct retained populations cannot collapse. The recipe deploys exactly two authored versions, then switches between them; it is not a general migration-history importer. Review remaining MATERIAL issues; do not ask for generalization outside that scope.


R16 final completeness change: ids first observed new after a frozen-v1 callback are tracked as v1-born, and join the required predecessor ids on all later rollback boundaries. This prevents the v2-native-row exception from excusing temporary hiding of rows actually inserted by the v1 client. Explicit cumulative deletions still exclude only those declared ids. The second-cycle-before-callback loss now has a negative observation-fault test. No release/authority semantics changed.


R17 repair for Codex R16: complete-current views are identified by retaining every registration-parent table header (name AND renamed-from). They use parent identities, preserving both moved B and a fresh A reusing its predecessor name. Selective alpha-adapted views instead match exact predecessor headers, then exact parent headers for additions; a name alone cannot choose lineage. Both identity and declaration maps are cached per release. Unmeasured lineage refuses; duplicate canonical identities refuse. Generator alpha adaptation restores predecessor table headers and refuses name captures; complete-current/guarded paths retain parent headers, so these are the actual two generated forms. Regression covers full-current view with moved/reused names and identical ids, both cycles and forward re-registration, plus selective predecessor view and swaps. R16 Muse was READY; the exact final snapshot follows.

## Normative amendment

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
external effects and implicit maintained/sequence/referential writes reachable
from that operation refuse this reduction; unrelated schema features do not.
Probed populations with inherited lifetime, expiry or recorded fields also refuse
this reduction until their full dependency closure is modeled. Leading requirements
are compiled independently as read predicates on fresh, private, empty-shape
proof tables in the same source module. This reuses the existing bounded,
hygienic expression-bodied audience-helper expansion, including typed viewer/
literal arguments and nested helpers. Helpers with effects, mutable/free caller
locals or borrowed focal rows do not expand; the compiled rule must still pass
the stable fragment and full dependency/write-set comparison above. Proof tables
never enter retained source or a store. No printed current policy is reparsed or
required to exist in the historical schema. Rules depending on row images, negative probes, references or mutable
locals cannot supply it. Other operations, jobs or external writers cannot
interleave within this atomic mutation; their presence alone is not a blocker.
Finite campaigns never supply proof.
A known object patch is the compiled syntactic fixed-key object, resolved only
through uniquely bound immutable IR constants, with no spread,
computed key or dynamic base. If it omits a field it is not a write to that field;
all other patch forms remain conservative. Insert defaults count; explicit null placement on insert follows the engine's null-write exemption. Updates/upserts can replace a nonnull value with null
and still count as protected writes. Upserts must satisfy both arms.
Freeze admission considers writes replacing existing values (update/upsert and
implicit writers); ordinary insert-only placement cannot violate a freeze.
Transition-bound guards and missing freezes on those writes need an authored guarded bridge;
there is no guessed implication. Selection refuses with operation, column and
rule before those old writes become live. Implicit set-null writes are included,
following transitive cascade roots, even without a direct child update; protected
historical engine-owned writers refuse when their effects are unmodeled. Native
writers have unknown write sets and need retained equivalent column authority or
an authored guarded bridge; an empty native IR body is never a no-write proof. Equal
executable redeploy must pass this historical admission even when it needs new
view registration and therefore a new ordinary registration parent. Read-only/unrelated writes remain
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
checks authored business assertions. Initial v2 adoption checks predecessor ids
before its callback; forward adoption checks required ids and non-excluded
values before its callback and checks them again afterward. Every row present
after the v1 callback, including newly inserted v1-client ids absent from the
prior v2 snapshot, is required before and after the forward callback. A callback cannot
repair migration loss/corruption before conservation is observed. An explicitly declared v1 deletion is a
distinct exception: the id must be visible immediately before the v1 callback,
absent after it, and remain absent on forward and before/after every later v1
callback. A later callback cannot conceal rollback resurrection by deleting the
row again. This cannot
excuse a row already hidden by rollback. Deletions use an empty field list;
duplicate/ambiguous change declarations refuse. Other ids/fields remain checked.
New rows are allowed, not fabricated as v1 preimages. Short
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

### REL readiness record — 2026-10-24

Round 10 received READY from Muse `muse-spark-1.3-contributor` (high, helper
Meta fallback) and a fresh Codex `gpt-6.1-sol` (high) on the same immutable
snapshot brief, which embeds this normative revision and the complete authority
gate, probe comparison and release caller. Both reviewed the supplied snapshot
without tools. Verbatim replies, earlier material findings, common briefs and
SHA-256/model/command provenance are retained under
[`llp/reviews/rel-wave27/`](./reviews/rel-wave27/r10-provenance.json).
Rounds 7–9 also received both READY before the final independent helper-guard compilation refinement.
Earlier rounds 5–6 inspected the changing working tree and carry no exact code
revision claim. Round 4 qualified the initial amendment before replay-driven
extension of source authority admission.

The reviews drove freeze-population checks, truthful view identity, stable
leading guards, complete probe identity, immutable patch resolution, implicit
set-null/native writer admission, equal-source registration admission,
child/source audience direction and immutable-copy custody, paused destructive
old deletes, retained-output ownership and field-specific proof allowances.
These are static readiness verdicts; they claim neither a complete platform
qualification nor publication.

The default two-version proof resolves table renames simultaneously against an
immutable predecessor identity map. It caches identities per selected release
and complete authored source, so swaps, chains, name reuse and forward
re-registration do not conflate populations or apply a rename twice. Generated
views retaining all registration-parent table headers reuse parent identities,
including a new table reusing a predecessor name. Selective alpha-adapted views
use exact predecessor headers, then exact parent headers for additions; matching
names alone never establishes lineage. Distinct active tables must retain distinct canonical identities.

Rows first observed as new during a frozen-v1 callback join the predecessor-id
set on subsequent rollbacks; tolerating v2-native rows never excuses hiding a
row actually inserted by the old client. Declared deletions remain excluded.

## Exact generated recipe

```javascript
// npm run day2:proof
// Saved sources belong outside snapback/, where every .q file compiles together.
// Add your business assertions at each release transition.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, rollback, startServe, testSource, cli, cleanup } from "snapback4/proof";
const args = process.argv.slice(2);
// npm appends caller arguments after the script's default pair.
const supplied = args.length > 3 && args[0] === "versions/v1" && args[1] === "versions/v2" ? args.slice(2) : args;
const [v1, v2, destination] = supplied;
if ((supplied.length !== 2 && supplied.length !== 3) || !v1 || !v2) throw Error("usage: npm run day2:proof -- versions/v1 versions/v2 [./deploy]");
async function snapshot(path) {
  if (!(await stat(path)).isDirectory()) return [[path, await readFile(path, "utf8")]];
  const files = await readdir(path);
  return (await Promise.all(files.sort().map(name => snapshot(join(path, name))))).flat();
}
const before = await Promise.all([snapshot(v1), snapshot(v2)]);
async function assertBusiness({ url, release }) {
  // BUSINESS_ASSERTION_BEGIN: add authenticated business and refusal assertions.
  // Return [{ id:"table/id", fields:["changedField"] }, ...] for writes by the frozen v1
  // client at a rollback stage. Include derived fields expected to change on forward; other values stay checked.
  // An intentional delete returns {id:"table/id", fields:[], deleted:true};
  // the row must exist before this callback and remain absent after forward.
  // The default below proves storage conservation only, not business policy.
  return [];
  // BUSINESS_ASSERTION_END
}
async function checked(args) {
  const result = await cli(args); assert.equal(result.code, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}
// A release's renames resolve simultaneously against its immutable predecessor.
// Cache authored sources too: returning forward may register that same source anew.
const identitiesByRelease = new Map(), identitiesBySource = new Map(), declarationsByRelease = new Map();
let lastOrdinaryIdentity;
function tableIdentities(status, declarations, sourceKey) {
  if (identitiesByRelease.has(status.release)) return identitiesByRelease.get(status.release);
  let identity;
  if (status.live.exact === false) {
    const target = identitiesByRelease.get(status.live.source);
    const parent = identitiesByRelease.get(status.live.parent);
    assert.ok(target && parent, "view must name previously measured target and parent releases");
    const viewHeaders = new Map(declarations);
    const parentHeaders = declarationsByRelease.get(status.live.parent);
    const targetHeaders = declarationsByRelease.get(status.live.source);
    const matches = (headers, name, from) => headers.has(name) && headers.get(name) === from;
    // Complete-current views retain their parent's names, even when an old name
    // was reused for a new table. Alpha-adapted selective views carry the
    // predecessor headers instead; matching names alone cannot prove lineage.
    const completeCurrent = [...parentHeaders].every(([name,from]) => matches(viewHeaders,name,from));
    identity = new Map(declarations.map(([name,from]) => {
      const useParent = matches(parentHeaders,name,from) && (completeCurrent || !matches(targetHeaders,name,from));
      const origin = useParent ? parent.get(name) : matches(targetHeaders,name,from) ? target.get(name) : undefined;
      assert.ok(origin, `${name}: generated view has no measured table lineage`);
      return [name,origin];
    }));
  } else if (identitiesBySource.has(sourceKey)) identity = identitiesBySource.get(sourceKey);
  else {
    const predecessor = lastOrdinaryIdentity;
    const moved = new Set(declarations.filter(([,from]) => from).map(([,from]) => from));
    identity = new Map(declarations.map(([name,from]) => [name,
      !predecessor ? name : from ? predecessor.get(from) ?? `${name}@${status.release}` :
      !moved.has(name) && predecessor.has(name) ? predecessor.get(name) : `${name}@${status.release}`]));
    identitiesBySource.set(sourceKey, identity);
    lastOrdinaryIdentity = identity;
  }
  assert.equal(new Set(identity.values()).size, identity.size, "distinct retained tables must have distinct identities");
  identitiesByRelease.set(status.release, identity);
  declarationsByRelease.set(status.release, new Map(declarations));
  return identity;
}
async function snapshotAll() {
  const status = await checked(["releases", directory, "--json"]);
  const source = join(directory, "releases", String(status.release), "snapback");
  const files = (await readdir(source)).filter(file => file.endsWith(".q")).sort();
  const texts = await Promise.all(files.map(async file => [file, await readFile(join(source, file), "utf8")]));
  const declarations = texts.flatMap(([,text]) => [...text.matchAll(/^table (\w+)(?: renamed from (\w+))?:/gm)].map(match => [match[1], match[2]]));
  const tableIdentity = tableIdentities(status, declarations, JSON.stringify(texts));
  const tables = declarations.map(([name]) => name);
  const rows = new Map();
  for (const table of tables) {
    const count = await checked(["sql", `SELECT COUNT(*) FROM "${table}"`, "--release", directory, "--json"]);
    const page = await checked(["data", table, "--release", directory, "--limit", String(count.rows[0][0] + 1), "--json"]);
    assert.equal(page.more, false, `${table}: incomplete snapshot`);
    for (const row of page.rows) rows.set(`${tableIdentity.get(table) ?? table}/${row.id}`, row);
  }
  return rows;
}
function compareMoves(before, after, { required = before.keys(), ignore = new Map(), values = false } = {}) {
  for (const id of required) {
    assert.ok(after.has(id), `${id}: missing persisted row`);
    if (values) {
      const prior = { ...before.get(id) }, next = { ...after.get(id) };
      for (const field of ignore.get(id) ?? []) { delete prior[field]; delete next[field]; }
      assert.deepEqual(next, prior, `${id}: changed during release cycle`);
    }
  }
}
// An explicit deployment is retained for inspection. Only our temporary
// deployment is removed; existing deployment directories are refused.
const temporary = destination === undefined;
const directory = destination ?? await mkdtemp(join(tmpdir(), "snapback4-day2-"));
if (!temporary) {
  try { await stat(directory); throw Error(`day2:proof destination already exists: ${directory}; choose a fresh deployment`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
let serve;
try {
  await testSource(v1, { fixtureOnly: true });
  await testSource(v2, { fixtureOnly: true });
  await deploy(directory, v1);
  serve = await startServe(directory);
  await assertBusiness({ url: serve.url, release: "v1" });
  const oldRows = await snapshotAll();
  await deploy(directory, v2);
  compareMoves(oldRows, await snapshotAll()); // measure adoption before a callback can repair it
  await assertBusiness({ url: serve.url, release: "v2" });
  let current = await snapshotAll();
  compareMoves(oldRows, current); // compare ids, never array order
  const deletedByV1 = new Set(), bornInV1 = new Set();
  for (let cycle = 0; cycle < 2; cycle++) {
    await rollback(directory, 1);
    const beforeV1Writes = await snapshotAll();
    for (const id of deletedByV1) assert.ok(!beforeV1Writes.has(id), `${id}: a deliberate v1 delete resurrected on rollback`);
    compareMoves(current, beforeV1Writes, { required: [...oldRows.keys(), ...bornInV1].filter(id => !deletedByV1.has(id)) });
    const writes = await assertBusiness({ url: serve.url, release: "rollback-v1" });
    assert.ok(Array.isArray(writes) && writes.every(write => typeof write.id === "string" && Array.isArray(write.fields) && write.fields.every(field => typeof field === "string") && (write.deleted === undefined || typeof write.deleted === "boolean") && (!write.deleted || write.fields.length === 0)), "return explicit field changes or deletions from the v1 callback");
    assert.equal(new Set(writes.map(write => write.id)).size, writes.length, "one change declaration per id");
    const changedByV1 = new Map(writes.filter(write => !write.deleted).map(write => [write.id, write.fields]));
    const older = await snapshotAll();
    for (const id of deletedByV1) assert.ok(!older.has(id), `${id}: a previously deleted row reappeared during the v1 callback`);
    for (const write of writes.filter(write => write.deleted)) {
      assert.ok(beforeV1Writes.has(write.id), `${write.id}: a declared delete must start from a visible row`);
      assert.ok(!older.has(write.id), `${write.id}: declared delete did not remove the row`);
      deletedByV1.add(write.id);
    }
    for (const id of older.keys()) if (!current.has(id)) bornInV1.add(id);
    compareMoves(current, older, { required: [...oldRows.keys(), ...bornInV1].filter(id => !deletedByV1.has(id)) }); // v2-native rows may lack a v1 view
    await rollback(directory, "latest");
    const beforeForwardCallback = await snapshotAll();
    compareMoves(older, beforeForwardCallback); // includes newly inserted v1-client rows
    compareMoves(current, beforeForwardCallback, { required: [...current.keys()].filter(id => !deletedByV1.has(id)), ignore: changedByV1, values: true });
    for (const id of deletedByV1) assert.ok(!beforeForwardCallback.has(id), `${id}: a deliberate v1 delete resurrected on forward`);
    await assertBusiness({ url: serve.url, release: "forward-v2" });
    const forward = await snapshotAll();
    compareMoves(current, forward, { required: [...current.keys()].filter(id => !deletedByV1.has(id)), ignore: changedByV1, values: true });
    for (const id of deletedByV1) assert.ok(!forward.has(id), `${id}: a deliberate v1 delete resurrected`);
    compareMoves(older, forward); // includes new v1-client rows
    current = forward;
  }
  const history = await cli(["releases", directory, "--json"]);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(await Promise.all([snapshot(v1), snapshot(v2)]), before);
  console.log("day2:proof passed: persisted ids and values across two rollback/forward cycles; sources unchanged (add business assertions for policy coverage)");
} finally { await cleanup(() => serve?.stop(), () => temporary && rm(directory, { recursive: true, force: true })); }

```
