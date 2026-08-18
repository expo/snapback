# LLP 0129 Phase-1 IR-evaluator sizing spike

Date: 2026-08-03  
Status: evidence spike; not a capability claim  
Scope: LLP 0129 Phase 1 sizing half only  
Decision owner: Charlie Cheever, Track A lane  
Gate presentation due: 2026-08-10

## Recommendation

**Sizing half: GO. Combined Phase-1 evidence gate: NO-GO today.**

Candidate A is technically and economically credible for the Kanban common
path. The exact mutation subset is small, the shipped browser-side evaluator
already implements it, and a throwaway admission/materialization/ledger wrapper
ran all five Kanban operations without a Node-only dependency. The measured
used-entry closure is **23,368 minified / 8,547 gzip / 7,625 Brotli bytes**.
Measured additively beside the landed materialization-store closure, it adds
**19,913 / 6,846 / 5,856 bytes** respectively. The orchestration wrapper itself
accounts for **7,205 minified module-own bytes** in the isolated used entry.

That is a GO to continue Candidate A and present the sizing evidence. It is not
a GO to call the combined sizing-plus-D5 gate passed, ship `Parity`, or advance
the phase. The existing JS D5 runner executes 32/37 cases, but it is an overlay
prediction runner rather than the complete D5 replay contract: five multi-table
cases skip, no case carries a ctx-answer ledger, six cases still use `$ANY_*`
placeholders, and whole-plan return values, changed counts, output ledgers, and
most rejection codes are not cross-runtime exact. In addition, the landed store
retains opaque post-projection fragments, while the spike necessarily supplies
a generated coverage/read-requirement sidecar that does not exist yet.

This split recommendation matches LLP 0129's own boundary: the named Phase-1
gate is sizing plus D5 (`llp/0129-local-first-program.plan.md:621`), but OQ8
keeps advancement author-presented and records the unshipped read-admission,
identity, receipt, and presentation mechanisms
(`llp/0129-local-first-program.plan.md:1732`).

## Evidence method and limits

The throwaway witness lives under
`tests/acceptance/fixtures/write-lane/spike/phase1-ir-evaluator.2026-08-03/`.
It is not exported, registered, or referenced by a package. Its README states
that boundary (`README.md:3`). The browser bundle profiles use the LLP 0145
method: esbuild 0.28.1, browser/ESM/ES2022, minification and tree shaking,
gzip level 9, and Brotli quality 11 (`measure.mjs:37`;
`measurement.v1.json:5`).

The prototype is intentionally only a sizing skeleton:

- it imports the shipped JS IR/value evaluator, canonical-client-value
  validator, and landed answer classifier (`browser-evaluator.mjs:7`);
- it returns only private in-memory layer descriptions and never calls a store
  mutator (`browser-evaluator.mjs:359`);
- its fixture uses real serde-shaped `MutationPlan` values, but they are hand
  written spike data, not generated application artifacts
  (`kanban-fixture.mjs:1`);
- the fixture's record passes the landed `prepareMaterializationRecordV1`
  validator (`browser-evaluator.spike.mjs:22`), but no proof is minted in this
  spike. `answerFacts` and decoded `rows` stand in for a successful, fenced
  `readRenderable` result. This sizes the evaluator seam; it does not claim to
  reproduce the store's proof machinery;
- `coverage` and `localReadRequirements` are spike sidecars. They demonstrate
  the shape codegen must emit; they are not fields in
  `MaterializationRecordV1`.

No Rust build or host D5 run was performed: this assignment is the sizing half,
and a clean checkout requires the separate Ibex bootstrap before Cargo. The
existing committed Rust runner is cited below as the comparison target.

## 1. Exact Kanban IR subset

### Real grammar

The authoritative grammar is `MutationPlan { steps, return_value }`
(`crates/snapback/src/manifest.rs:6845`). Its complete current step set is:

`AllocateSequence`, `Insert`, `Patch`, `Delete`, `Get`, `Guard`,
`AssertCurrentRelation`, `Let`, `DeleteWhere`, `InsertEach`, and
`AssertSourceChanged` (`crates/snapback/src/manifest.rs:6862`). Returns are `Literal`,
`Binding`, `Document`, `ChangedCount`, or `Expr` (`crates/snapback/src/manifest.rs:6944`).
The closed expression grammar begins at `crates/snapback/src/manifest.rs:6958`; binary and
unary operators are enumerated at `crates/snapback/src/manifest.rs:7176` and
`crates/snapback/src/manifest.rs:7193`.

The current latency-Kanban fixture establishes the indexed presentation shape:
the board is ordered by `(columnKey, rank)` using `by_column_rank`
(`demos/zero-bakeoff/apps/latency-kanban/snapback/functions.mjs:13`), and its
shipped `moveCard` logic is point `get`, locked/revision guards, point patch of
`columnKey`/`rank`/`revision`, then point get
(`demos/zero-bakeoff/apps/latency-kanban/snapback/functions.mjs:56`). The broader
gate nevertheless requires create, edit, assign, archive, and reorder
(`llp/0155-local-sync-product-direction.rfc.md:869`;
`llp/0138-zero-replicache-bakeoff.plan.md:152`).

### Required subset

| Workload operation | Mutation steps | Value/return forms | Indexed-set consequence |
| --- | --- | --- | --- |
| create | `Insert cards` | `Arg`, `Literal`; implicit insert id consumed from the ctx-answer ledger; return `Binding(cardId)` | Insert the predicted row into every admitted demanded result whose filter accepts its projected fields, then order by `(columnKey, rank)` |
| edit | `Get` → locked `Guard` → revision `Guard` → `Patch` | `Arg`, `Binding`, `Field`, unary `Not`, binary `Eq`/`Add`, `Literal`; return `Document` | Re-filter/reorder demanded results if an edited field participates in their transform |
| assign | same guarded point patch | same forms; patch `assigneeId` and `revision` | Re-filter only for assignee-scoped demanded results; board order is unchanged |
| archive | same guarded point patch | same forms; patch `archived` and `revision` | Remove/add in archive-filtered demanded results; board behavior depends on its declared filter |
| reorder | same guarded point patch | same forms; patch `columnKey`, `rank`, `revision` | Remove from the old indexed position and insert at the new position under `(columnKey, rank)` |

The spike fixture is the executable enumeration: create at
`kanban-fixture.mjs:52`, the common guarded patch at
`kanban-fixture.mjs:35`, and the four field-specific operations at
`kanban-fixture.mjs:76`. The test witnesses the five row effects and the
indexed reorder at `browser-evaluator.spike.mjs:41` and
`browser-evaluator.spike.mjs:52`.

**Important negative finding:** Kanban does not need mutation steps
`DeleteWhere` or `InsertEach`. LLP 0051 added those for clear-and-replace feed
workloads (`llp/0051-language-neutral-data-tier.rfc.md:385`), not for rank-key
Kanban. “Indexed-set” here is a point patch to the indexed key followed by
deterministic re-evaluation of demanded result sets. The exact local mutation
effect ceiling is therefore only **`Insert`, `Get`, `Guard`, `Patch`**; even
`Let` is unnecessary. The prototype closes on precisely those four
(`browser-evaluator.mjs:27`).

## 2. Browser evaluator cost and boundary

### Measured size

All numbers below come from the retained receipt at
`measurement.v1.json:22`.

| Profile | Minified | Gzip | Brotli | Interpretation |
| --- | ---: | ---: | ---: | --- |
| shipped derived-overlay, all exports | 12,223 | 4,633 | 4,154 | reusable shipped IR/value machinery |
| shipped canonical-client-value, all exports | 4,484 | 1,951 | 1,758 | reusable envelope/value admission |
| shipped answer-classes, all exports | 2,569 | 1,082 | 944 | reusable landed local-answer classification |
| spike evaluator, used entry | 23,368 | 8,547 | 7,625 | isolated Candidate-A Kanban closure |
| landed materialization store, direct all-exports entry | 65,413 | 18,574 | 16,518 | direct-module baseline in the same measurement run |
| landed store + spike used entry | 85,326 | 25,420 | 22,374 | additive combined closure |
| **increment over that landed-store entry** | **19,913** | **6,846** | **5,856** | realistic upper bound beside the store; canonical code deduplicates |

The official LLP 0166 public-subpath receipt is 65,581 / 18,798 / 16,611
bytes (`llp/0166-local-persistent-store.spec.md:1735`). The direct-module
baseline above is slightly smaller because it bypasses the public-subpath
entry wrapper; deltas are therefore calculated only between profiles produced
by this same run.

The isolated used entry's module attribution is 11,394 bytes of shipped
`derived-overlay.mjs`, 7,205 bytes of spike admission/orchestration, 3,647
bytes of canonical values, and 1,055 bytes of answer classification
(`measurement.v1.json:112`). Browser bundling itself is a useful feasibility
check: the closure builds under `platform: browser` with no polyfill or Node
builtin (`measure.mjs:37`).

### Dependency surface

1. **IR/value semantics.** Reuse `derived-overlay.mjs`. It already mirrors the
   Rust evaluator (`packages/snapback-contract/derived-overlay.mjs:19`),
   implements the relevant steps (`packages/snapback-contract/derived-overlay.mjs:614`),
   and turns a local evaluation failure into “no overlay” rather than a write
   (`packages/snapback-contract/derived-overlay.mjs:693`). The server remains
   the authoritative transactional executor (`crates/snapback/src/storage.rs:4270`) and
   validates the plan before steps run (`crates/snapback/src/storage.rs:4338`).
2. **Canonical values.** Args and ledger envelopes need the finite
   `CanonicalClientValueV1` grammar and ceilings
   (`packages/snapback-client/canonical-client-value.mjs:7` and `:106`). The
   shipped overlay also has transport-value normalization of its own
   (`packages/snapback-contract/derived-overlay.mjs:61`). A production design
   must preserve the distinction: handler transport normalization and client
   identity-envelope admission are not automatically one grammar.
3. **Ctx-answer ledger.** The browser consumes ordered `ids` and frozen `now`,
   enforcing version, count, id alphabet, timestamp, exhaustion, and exact
   consumption (`browser-evaluator.mjs:128`). This mirrors the server ledger
   shape/limits (`crates/snapback/src/manifest.rs:7633`) and exact-consumption errors
   (`crates/snapback/src/storage.rs:18097`). The result is explicitly a
   `labeled-client-claim`, never authority (`browser-evaluator.mjs:169`). Reads
   are not ledgered (`crates/snapback/src/manifest.rs:7633`).
4. **Materialization answer and admission.** The browser needs a successfully
   fenced `readRenderable` result, the QMK answer class, generated exact field
   coverage, and the operation's generated point-read requirements. The landed
   QMK classifier returns `authoritative` only for complete/renderable
   current-or-retained state (`packages/snapback-client/answer-classes.mjs:30`).
5. **Comparators and projection.** IR expression ordering is already pinned in
   the shipped evaluator. Indexed Kanban presentation additionally needs the
   generated filter/order transform, including scalar domains, null placement,
   direction, and stable final tie-break. The spike includes only the ASCII/
   integer Kanban skeleton (`browser-evaluator.mjs:276`). It is sufficient for
   the measured fixture, not a cross-runtime comparator claim.
6. **Private layer/rebase seam.** The evaluator must output address- and
   query-instance-bound private layers, never mutate base fragments
   (`browser-evaluator.mjs:359`). Sequential rebase, settlement splice, and
   React publication are deliberately outside this sizing skeleton.

### Closed local/server boundary

| Capability or grammar form | Spike disposition | Reason |
| --- | --- | --- |
| `AllocateSequence` | `server-only` | reads and advances server-owned sequence state |
| `AssertCurrentRelation` | `server-only` | transaction-local current-parent/incarnation assertion |
| `AssertSourceChanged` | `server-only` | inspects provisional authoritative transaction changes |
| `MembershipExists` | `server-only` | authoritative storage semi-join; the grammar itself says it cannot run in the pure evaluator (`crates/snapback/src/manifest.rs:7031`) |
| `AuthUserId`, `AuthKind`, `AuthActorKind`, `AuthActivityActorKind`, `AuthActorUserId`, `AuthGrantId`, `ClientMutationDigest`, `AuthIsDelegated` | `server-only` in this Candidate-A class | D1 says principal/authority is not a ledger answer (`llp/0051-language-neutral-data-tier.rfc.md:261`), and Move 3 forbids ambient auth authority (`llp/0155-local-sync-product-direction.rfc.md:856`). `AuthUserId` could become an admitted labeled input only after an owner pins its provenance; the sizing gate does not assume that decision. |
| required point row or required projected field not available from an authoritative materialization | `server-only` | missing is unhydrated, not absent |
| non-authoritative/unknown retained source, cross-authority merge, or contradictory occurrences | `server-only` | no locally authoritative workspace can be assembled |
| `Delete`, `DeleteWhere`, `InsertEach`, `Let`, or another table under the Kanban effect class | `refused` | these may be executable in a broader IR tier, but they exceed this generated effect ceiling; declaration and actual plan disagree |
| schema/artifact/execution-identity mismatch | `refused` or owner-required quarantine before evaluation | “close enough” execution is prohibited; this skeleton does not implement the fence |
| network, filesystem, secrets, arbitrary timers, actions, arbitrary JS, or ambient authority | build/admission `refused` | none is in the generated closed mutation operation; Move 3 forbids these browser powers (`llp/0155-local-sync-product-direction.rfc.md:858`) |
| durable writes, authorization, constraints, OCC, commit, authoritative id/time, receipt, settlement | server-authority-only; local output remains prediction | both tiers may evaluate the IR, but only the server owns these effects (`llp/0155-local-sync-product-direction.rfc.md:805`) |

The prototype implements the closed plan classification at
`browser-evaluator.mjs:96`; tests witness a server-only host step and a refused
over-ceiling step at `browser-evaluator.spike.mjs:97`.

## 3. Local-read admission against the landed store

The landed store's record is an opaque-fragment record, not a normalized source
row table (`llp/0157-composition-algebra-and-completeness.spec.md:1395`). Its
memberships name page-result occurrences and explicitly are not canonical
source-row identity (`llp/0157-composition-algebra-and-completeness.spec.md:1450`).
`readRenderable` returns bytes only after the exact fence and witness/lease/
completeness checks (`llp/0157-composition-algebra-and-completeness.spec.md:1495`).
LLP 0166 also forbids inferring absence from rows not held
(`llp/0166-local-persistent-store.spec.md:1028`).

Therefore “satisfiable from a demanded materialization” means all of:

1. the exact demanded address and `queryInstanceId` are current;
2. the landed answer is QMK `authoritative` (freshness may be `current` or
   valid `retained`), never merely `labeled-retained` or `unknown`;
3. the result contract exposes every field named by the generated read
   requirement;
4. the decoded occurrence positively contains the requested `_id`, or the
   proof scope is complete enough to prove absence; and
5. any workspace union stays inside one authority partition and has no
   contradictory duplicate occurrence.

The spike admission implementation is at `browser-evaluator.mjs:194` and
`browser-evaluator.mjs:216`; its same-authority ephemeral merge is at
`browser-evaluator.mjs:253`.

| Operation | Exact semantic read | Satisfiable locally | Otherwise |
| --- | --- | --- | --- |
| create | none; one implicit id answer and args only | `ready` when the ledger is exact. Each demanded output materialization still needs an admitted post-projection transform to show the new row. | invalid/exhausted/unused ledger → `refused`; a demanded result whose filter/order cannot be evaluated gets no fabricated layer |
| edit | `Get cards[id]` with `_id, locked, revision, title` | complete board/page containing the row → `ready`; authoritative positive row from an incomplete but explicitly admitted result → `predictable-with-partial-input` | no positive row and no complete absence proof → `server-only`; complete absence may predict `CARD_NOT_FOUND` with no layer, while server settlement still wins |
| assign | `Get cards[id]` with `_id, locked, revision, assigneeId` | same positive-point rule | same server-only rule |
| archive | `Get cards[id]` with `_id, locked, revision, archived` | same positive-point rule | same server-only rule |
| reorder | `Get cards[id]` with `_id, locked, revision, columnKey, rank` | complete board materialization is sufficient. For per-column results, the positive source row may support conservative mutation evaluation, but both old and target demanded results must be independently transformable before both layers can paint. | missing target materialization, unknown target answer, omitted key field, cross-authority union, or ambiguous duplicate → `server-only` for the unavailable prediction; never infer target absence |

The feasibility test covers complete positive reads, partial-positive admission,
unavailable partial input, locked-card prediction suppression, exact ledger
consumption, and all five operations (`browser-evaluator.spike.mjs:41` through
`:123`).

### Landed-store gap exposed by the spike

The actual `MaterializationRecordV1` fields end at identities, product/
authority state, opaque fragments, occurrence memberships, subscription, and
layer/outbox/settlement references
(`packages/snapback-client/materialization-store.mjs:369`). It does **not**
contain source table, projected-field coverage, filter/order transform, or a
proof that a page occurrence is a canonical `cards[id]` row. LLP 0166's landed
evaluation model is deliberately a separate transform over established
post-projection results, not re-execution of the source relational plan
(`llp/0166-local-persistent-store.spec.md:1398`).

So the browser evaluator can ride the landed store, but only after codegen/
registration supplies an identity-bound sidecar mapping each demanded result
contract to the operation's local-read requirements and presentation transform.
The spike's `coverage` object (`kanban-fixture.mjs:144`) is evidence for the
size and algorithm, not evidence that this missing admission artifact has
landed. This is precisely owner-ledger row 2, not something the sizing spike may
silently declare solved (`llp/0129-local-first-program.plan.md:765`).

## 4. D5 corpus reuse and missing cross-runtime pins

### What runs today

The committed corpus has **37 cases** and declares profile, corpus, and ledger
version 1 (`tests/conformance/data-tier/corpus.manifest.json:1`). The committed
browser-side replay test loads every case as data
(`packages/snapback-contract/derived-overlay.test.mjs:26`) and, on this checkout,
reported:

```text
derived-overlay.test.mjs: all assertions passed
(22 corpus cases predicted, 10 rejections aborted, 5 skipped)
```

Thus the shipped JS evaluator executes **32/37 = 86.5%** of the existing cases
as-is: 22 accepted and 10 rejected. The five skips are all multi-table schemas:
four all-aboard cases and `reject-insert-each-non-array`. The skip is explicit
at `packages/snapback-contract/derived-overlay.test.mjs:71`.

That number describes reuse of the **underlying shipped JS evaluator**. Zero of
37 cases can be fed literally to the spike admission wrapper because D5 cases
do not yet carry the generated effect class, local-read requirements,
materialization address/fence/answer, coverage transform, or exact ctx ledger.
Those should become a thin D5/local-admission envelope rather than a fork of the
37 semantic cases.

### Why 86.5% is not the D5 gate

- The corpus schema promises plan/rows/result/changed-count/error data
  (`tests/conformance/data-tier/README.md:25`), and the Rust runner checks the
  exact host result, changed count, and all expected tables
  (`crates/snapback/tests/data_tier_corpus_v0.rs:194`).
- The JS runner checks predicted rows or expression-only results. For most
  rejection plans it requires only unchanged rows; it compares the exact typed
  code only for expression-only rejection cases
  (`packages/snapback-contract/derived-overlay.test.mjs:99`). It exposes no
  whole-plan return or changed count.
- No case currently has `ctxLedger`/`ctx_ledger`. Six cases contain `$ANY_ID`
  or `$ANY_NOW`; the README still calls those a staging bridge
  (`tests/conformance/data-tier/README.md:55`) even though the manifest declares
  ledger version 1.
- The JS runner set-matches rows without ordering
  (`packages/snapback-contract/derived-overlay.test.mjs:53`). That is correct
  for mutation table contents but does not pin Kanban's indexed visible order.

### Minimum additions for cross-runtime pinning

1. Add exact v1 `ctxLedger` to every case that consumes implicit insert ids,
   `RuntimeId`, or `RuntimeNow`; replace `$ANY_*` with exact values. Add exact
   exhaustion, unused-id/overrun, invalid-id, version, and timestamp cases.
2. Give the JS runner a multi-table ephemeral workspace so all five skipped
   cases execute atomically, without turning it into a persistent browser DB.
3. Return a structured JS execution outcome and compare exact `result`,
   `changedCount`, rows for every table, output-ledger consumption, and exact
   whole-plan rejection code against the Rust runner.
4. Add browser refusal rows for the grammar added after the original D5 set:
   `AllocateSequence`, `AssertCurrentRelation`, `AssertSourceChanged`, all
   authority projections, and `MembershipExists`; distinguish `server-only`
   from effect-ceiling `refused`.
5. Add an additive local-admission envelope/corpus over the same plans: exact
   effect class, read requirements, materialization identity/fence/answer/
   coverage, and expected one of `ready`,
   `predictable-with-partial-input`, `server-only`, `refused`.
6. Pin the Kanban result-transform comparator separately: filters, integer and
   string order, nulls, equal-key final tie-break, move between demanded column
   results, and 20 sequential replays. D5's unordered mutation rows cannot
   establish visible indexed-set parity by themselves.
7. Produce one gate receipt binding the exact corpus manifest hash, browser
   bundle hash, server revision/profile, and both runner outputs. A partial
   evaluator must retain a partial capability class, as D5 already requires
   (`llp/0051-language-neutral-data-tier.rfc.md:719`).

## Honest unknowns and non-findings

- Only `moveCard` exists in the current shipped Kanban fixture, and it is a JS
  mutation. The other four spike plans are plausible real-grammar witnesses,
  not evidence that codegen currently emits those exact artifacts.
- The measured wrapper does not implement full strict `MutationPlan` schema/
  bounds validation, schema-era fencing, operation/content hashes, or execution
  identity. It assumes generated validated input after its small effect-class
  check.
- The store test validates a real record shape but does not generate a signed
  completeness proof. Actual row bytes must arrive only through fenced
  `readRenderable`; the sidecar rows are a sizing stand-in.
- The comparator handles the fixture's integers and ASCII strings. SQLite/
  query-transform parity for nulls, Unicode, ties, and hidden stable keys is
  unmeasured.
- The bundle result is a closure measurement, not an application delta. The
  additive landed-store pair is the best current estimate; a future registered
  public entry may tree-shake differently.
- No 500-card timing, 20-rapid-move, concurrent-rebase, reload, React paint,
  independent-observer, or receipt/settlement test was performed. Those are the
  Kanban exit presentation, not this sizing spike.
- OQ8's store/presentation slice is landed, but local execution, partial-read
  admission, schema/identity fencing, receipt projection, and browser React
  integration remain outside this artifact. This report does not close any
  owner-ledger row.

## Verification record

Commands executed as the retained verification for this report:

```text
node tests/acceptance/fixtures/write-lane/spike/phase1-ir-evaluator.2026-08-03/browser-evaluator.spike.mjs
node tests/acceptance/fixtures/write-lane/spike/phase1-ir-evaluator.2026-08-03/measure.mjs
node packages/snapback-contract/derived-overlay.test.mjs
./ref-check --verbose
```

Observed outputs:

```text
phase1 IR evaluator sizing spike: all assertions passed
derived-overlay.test.mjs: all assertions passed (22 corpus cases predicted, 10 rejections aborted, 5 skipped)
phase1 sizing measurement receipt: exact rerun match
ref-check: ok — 167 LLP docs, 3096 refs in 6963 files, 0 errors, 0 unchecked
git diff --check: clean
```

No files under `llp/`, package exports, capability manifests, generated
registries, or shipping source paths were modified. No commit was made.
