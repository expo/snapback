Review the complete delivery delta against the specified main baseline using only the inline source below. You are an independent reviewer; no other review or benchmark narrative is supplied. Do not use tools, external sources, repository access or the web. Return VERDICT: READY or VERDICT: MATERIAL, then concise concrete findings and nonblocking observations. Distinguish source reasoning from author-reported checks. A hypothetical general improvement is not a material blocker.

Scope: (1) unsupported rule-comparison advice preserves read/channel authorization instead of recommending mutation require as an equivalent; writes retain their existing advice; (2) a missing unique Get under literal Allow can consume already delivered complete grouping coverage, while exact hasAbsence/authorityAbsence and pooled-row fallback guards remain unchanged; (3) final integration reuses existing hasCompleteRange and consolidates primitive equality, ordering and wire-Bytes validation to fund bytes. Pay special attention to ordinary-key preparation equivalence, wrong/removed/truncated proof staying partial, noncanonical surviving rows, queued removal, sameValueZero invalid operands/error order, Bytes validation on both sides, Unicode/type ordering, and semantic differences from helper reuse.

Incoming main includes immutable-ledger, incremental compaction and equal-kind comparison work, already in the comparison baseline. The submitted repair/tests survived that merge unchanged before the small byte consolidation. Compaction still requires exact row/negative proofs; this repair is read completeness only. Scope excludes new certificate axes/custody mechanisms or a runtime-ceiling change.

Author-reported qualification: prior combined source eb681b85a1 passed the complete script (1451 package,1204 native plus compiler/evaluator/doctests). Incoming main separately records its complete script pass. Final candidate: canonical build+self-test pass; evaluator266 shared cases plus27 server-only and existing primitive/indexed controls pass; targeted package206/206 (owner prediction/successor, compaction/store, client-items, outbox, protocol); native merge/index reuse23/23; refs pass. Byte measurements used Node24.18.0/esbuild0.25.9/gzip9/five unchanged roots: actual merged90042; three rounds90026,90008,89993. Final only7 below90000 and above80000 target. Exploration stopped. Earlier complete-run asset timeout and isolated-owner ENOENT remain retained; the latter has an existing issue and unchanged isolated+complete reruns passed. Final production packages are pending. Do not invent completed benchmark results or treat author tests as rerun by you.

Comparison baseline (actual incoming merge parent): a93edb979a5cbe6357f1fc1f95b66f85bd308844
Candidate source commit: d251e00dae743cc214fd70dcebb2fedb7341222e

## Exact source/test delta

```diff
diff --git a/snapback2/packages/compiler/src/quarry-diagnostic-checks.ts b/snapback2/packages/compiler/src/quarry-diagnostic-checks.ts
index af3aca500c..b401900463 100644
--- a/snapback2/packages/compiler/src/quarry-diagnostic-checks.ts
+++ b/snapback2/packages/compiler/src/quarry-diagnostic-checks.ts
@@ -2,7 +2,7 @@ import { deepStrictEqual } from "node:assert";
 import { readdir } from "node:fs/promises";
 import { lowerProject } from "./project";
 import type { FrontendDiagnostic } from "./ir";
-import { assert, occurrences, withProject, type Test } from "./quarry-check-helpers";
+import { assert, compileInline, occurrences, withProject, type Test } from "./quarry-check-helpers";
 
 // @ref LLP 1002#3-the-compiler-worker-and-the-project-json — independent
 // refusals survive frontend recovery; failed bindings do not acquire a type.
@@ -360,6 +360,70 @@ table todos:
 ];
 
 export function registerQuarryDiagnosticChecks(test: Test): void {
+  test("rule comparison advice preserves read authority and distinguishes write preconditions", () => {
+    for (const op of ["<", "<=", ">", ">="]) {
+      for (const effect of ["read", "insert", "update", "delete"]) {
+        const source = `table rows:
+  owner: principal
+  expiresAt: time ?
+  ${effect} <- .owner = viewer and (.expiresAt = null or .expiresAt ${op} now)
+`;
+        const result = compileInline([{ fileName: "snapback/schema.q", source }]);
+        assert(!result.ok, `${effect} ${op} unexpectedly compiled`);
+        assert(result.diagnostics.length === 1, JSON.stringify(result));
+        const diagnostic = result.diagnostics[0]!;
+        assert(diagnostic.code === "E_QUARRY_UNKNOWN" && diagnostic.family === "quarry", JSON.stringify(diagnostic));
+        assert(diagnostic.site.startsWith("snapback/schema.q:4:"), diagnostic.site);
+        assert(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`), diagnostic.message);
+        if (effect === "read") {
+          assert(diagnostic.rewrite.includes("preserve this rule's authorization")
+            && diagnostic.rewrite.includes("not an automatic equivalent rewrite"), diagnostic.rewrite);
+          assert(diagnostic.rewrite.includes("guide rules"), diagnostic.rewrite);
+          assert(!diagnostic.rewrite.includes("move the bounded comparison"), diagnostic.rewrite);
+        } else {
+          assert(diagnostic.rewrite.includes("move the bounded comparison into a mutation require"), diagnostic.rewrite);
+        }
+      }
+    }
+    const supported = compileInline([{ fileName: "snapback/schema.q", source: `table rows:
+  owner: principal
+  value: int
+  read <- .owner = viewer
+  insert <- .owner = viewer
+` }, { fileName: "snapback/rows.q", source: `mutation add(value: int):
+  require value > 0 else POSITIVE_REQUIRED
+  return insert rows { owner: viewer, value }
+` }]);
+    assert(supported.ok, JSON.stringify(supported));
+    assert(supported.project.programs[0]!.body.some(statement => typeof statement === "object" && "Require" in statement),
+      "the supported write comparison lost its mutation precondition");
+  });
+  test("channel comparison advice preserves publish and subscribe authority", () => {
+    for (const op of ["<", "<=", ">", ">="]) {
+      for (const effect of ["publish", "subscribe"]) {
+        const source = `table rows:
+  value: bool
+  public
+
+channel activity(owner: principal, deadline: time):
+  value: { active: bool }
+  publish <- ${effect === "publish" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}
+  subscribe <- ${effect === "subscribe" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}
+  ttl 5s
+`;
+        const result = compileInline([{ fileName: "snapback/schema.q", source }]);
+        assert(!result.ok && result.diagnostics.length === 1, JSON.stringify(result));
+        const diagnostic = result.diagnostics[0]!;
+        assert(diagnostic.code === "E_QUARRY_UNKNOWN" && diagnostic.family === "quarry", JSON.stringify(diagnostic));
+        assert(diagnostic.site.startsWith(`snapback/schema.q:${effect === "publish" ? 7 : 8}:`), diagnostic.site);
+        assert(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`), diagnostic.message);
+        assert(diagnostic.rewrite.includes("preserve this rule's authorization")
+          && diagnostic.rewrite.includes("guide rules")
+          && diagnostic.rewrite.includes("not an automatic equivalent rewrite"), diagnostic.rewrite);
+        assert(!diagnostic.rewrite.includes("move the bounded comparison"), diagnostic.rewrite);
+      }
+    }
+  });
   registerDiagnosticFixChecks(test);
   for (const c of quarryDiagnosticCases) test(`Quarry diagnostic recovery: ${c.name}`, async () => {
     await withProject({ "snapback/schema.q": c.schema ?? diagnosticSchema, "snapback/todos.q": c.source }, async root => {
diff --git a/snapback2/packages/compiler/src/quarry/bound-schema.ts b/snapback2/packages/compiler/src/quarry/bound-schema.ts
index a3b05e3d65..c8ba01b90b 100644
--- a/snapback2/packages/compiler/src/quarry/bound-schema.ts
+++ b/snapback2/packages/compiler/src/quarry/bound-schema.ts
@@ -320,7 +320,12 @@ function bindRuleExpr(expr: Expr, catalog: TableCatalog, context: RuleContext):
     refuse(expr.site, "rules cannot follow point reads or nested field chains; use a direct .field or exists/created probe");
   }
   if (expr.kind === "binary" && ["<", "<=", ">", ">="].includes(expr.op)) {
-    refuse(expr.site, `the platform rule vocabulary has eq/ne but not ${expr.op}; move the bounded comparison into a mutation require`);
+    // @ref LLP 1023.001#read-rule-comparison-diagnostic-follow-up — mutation preconditions do not govern read or channel authority.
+    const writeRule = context.effect === "insert" || context.effect === "update" || context.effect === "delete";
+    const repair = writeRule
+      ? "move the bounded comparison into a mutation require"
+      : "preserve this rule's authorization with supported predicates (guide rules); mutation require is not an automatic equivalent rewrite";
+    refuse(expr.site, `the platform rule vocabulary has eq/ne but not ${expr.op}; ${repair}`);
   }
   refuse(expr.site, `rule expression cannot be represented by the Snapback 2 platform${context.effect ? ` for ${context.effect}` : ""}`);
 }
diff --git a/snapback2/packages/evaluator/src/store.ts b/snapback2/packages/evaluator/src/store.ts
index 11595d09c2..f5d8de0fee 100644
--- a/snapback2/packages/evaluator/src/store.ts
+++ b/snapback2/packages/evaluator/src/store.ts
@@ -139,7 +139,12 @@ export class ClientStore {
   uncoveredSites(trace: Trace, misses: string[] = [], program?: any, search?: SearchExecution): string[] {
     const partial = new Set(misses);
     for (const r of trace.ranges) if (!this.facts.covers(r, prepareRange(this.schema, r, program, search))) partial.add(r.site);
-    for (const a of trace.absences) if (!this.hasAbsence(a.table, a.index, a.key) && this.lookup(a.table, a.index, a.key) === null) partial.add(a.site);
+    // @ref LLP 1012#6-reads-offline — public group exhaustion proves this read's null, not primary/rule authority.
+    for (const a of trace.absences) if (!this.hasAbsence(a.table, a.index, a.key) && this.lookup(a.table, a.index, a.key) === null) {
+      const table = this.schema.tables[a.table];
+      if (table.rules.read !== 'Allow' || !table.indexes[a.index].unique
+        || !this.hasCompleteRange(a.table, a.index, a.key)) partial.add(a.site);
+    }
     return [...partial].sort();
   }
   rangeStop(range: TraceRange, logical: LogicalIndexAtom[]): TraceRange['stop'] { return this.facts.stop(range, logical); }
diff --git a/snapback2/packages/evaluator/src/test-maintained-address.ts b/snapback2/packages/evaluator/src/test-maintained-address.ts
index a568dd3284..519d3106f7 100644
--- a/snapback2/packages/evaluator/src/test-maintained-address.ts
+++ b/snapback2/packages/evaluator/src/test-maintained-address.ts
@@ -256,4 +256,54 @@ assert.throws(() => validateIdentity('a'.repeat(136)),{ code: 'E_INPUT' });
   assert.equal(store.byId('balances',id200),null,'last sum deletion removes target');
   assert.equal(store.byId('counts',id200),null,'last count deletion removes target');
 }
+// @ref LLP 1012#6-reads-offline — readable group exhaustion proves a point result, not primary write authority.
+{
+  const index = (name: string) => ({ components: [{ Column: name }], unique: true });
+  const table = { columns: { id: 'Id', target: 'Principal', value: 'Int' },
+    indexes: { byId: index('id'), byTarget: index('target') },
+    rules: { read: 'Allow', insert: 'Deny', update: 'Deny', delete: 'Deny' }, constraints: [], retain: 'until-revoked' };
+  const schema: any = { tables: { counts: table }, maintains: [], channels: {}, schedules: [], effects: [], auth: { password: false, guests: false } };
+  const schema_hash = sha256(canonicalSchemaJson(schema)), key = { Id: 'alice' };
+  const program: any = { name: 'counts.point', kind: 'Query', args: {}, read_time_granularity_ms: null,
+    body: [{ Return: { Get: { site: 'count', table: 'counts', index: 'byTarget', key: [{ Literal: key }] } } }] };
+  const context: any = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
+  const range: any = { site: 'count', table: 'counts', index: 'byTarget', prefix: [{ Scalar: key }],
+    order: 'Asc', take: 1, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
+    rule_hash: scopedRuleHash(schema,table.rules.read), row_ids: [], stop: 'Exhausted', absence: true, halo: null, n2_suffix: null };
+  const receipt = (ranges: any[], absences: any[] = []): any => ({ schema_hash, rows: [], ranges, absences, verdicts: [] });
+  const replay = (ranges: any[], absences: any[] = []) => new ClientStore(schema,receipt(ranges,absences)).reexecute(program,context);
+  const primary = ['counts','byId',[{ Id: canonicalValues([key]) }]];
+  assert.equal(replay([range],[primary]).state,'fresh','the owner proof pair covers the missing public group');
+  assert.equal(replay([range]).state,'fresh','readable group exhaustion does not need canonical-ID equivalence');
+  assert.equal(replay([],[primary]).state,'partial','primary absence alone does not prove a group empty');
+  for (const [name, change] of [
+    ['truncated', { stop: 'Limit' }], ['another key', { prefix: [{ Scalar: { Id: 'bob' } }] }],
+    ['another index', { index: 'byId' }], ['another rule', { rule_hash: 'f'.repeat(64) }],
+    ['evicted', { evicted_ids: ['lost'] }],
+    ...['after','before','gt','gte','lt','lte'].map(bound => [bound,{ prefix: [], [bound]: bound === 'after' || bound === 'before' ? { Array: [key] } : key }]),
+  ] as [string,any][]) assert.equal(replay([{ ...range,...change }]).state,'partial',name);
+  const store = new ClientStore(schema,receipt([range]));
+  assert.equal(store.hasAbsence('counts','byTarget',[key]),false,'read coverage adds no rule/mutation negative fact');
+  assert.equal(store.authorityAbsence('counts',canonicalValues([key])),false,'group exhaustion adds no primary write authority');
+  store.setReceipt('seed');
+  assert.equal(store.reexecute(program,context).state,'partial','removing the receipt removes its read coverage');
+  const restricted = structuredClone(schema); restricted.tables.counts.rules.read = { Eq: [{ Field: 'target' },'Viewer'] };
+  const restrictedReceipt = { ...receipt([{ ...range,rule_hash: scopedRuleHash(restricted,restricted.tables.counts.rules.read) }]),
+    schema_hash: sha256(canonicalSchemaJson(restricted)) };
+  assert.equal(new ClientStore(restricted,restrictedReceipt).reexecute(program,context).state,'partial','restricted empty range does not acquire absence authority');
+  const guarded = structuredClone(schema);
+  guarded.tables.counts.rules.insert = { Not: { Exists: { table: 'counts', index: 'byTarget', key: [{ Field: 'target' }] } } };
+  const guardedReceipt = { ...receipt([range],[['counts','byId',[{ Id: 'new-row' }]]]), schema_hash: sha256(canonicalSchemaJson(guarded)) };
+  const guardedStore = new ClientStore(guarded,guardedReceipt);
+  const inserted = { Row: { id: { Id: 'new-row' }, target: key, value: { Int: 1 } } };
+  const insert: any = { name: 'guarded.insert', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
+    body: [{ Insert: { table: 'counts', row: { Literal: inserted } } }, { Return: { Literal: 'Null' } }] };
+  const blocked = guardedStore.applyMutation(insert,context);
+  assert.equal(blocked.state,'partial','readable group exhaustion cannot authorize a negative write rule');
+  assert(blocked.partialSites.length > 0,JSON.stringify(blocked));
+  assert.equal(guardedStore.byId('counts','new-row'),null,'unknown write authority leaves no inserted row');
+  const surviving = { table: 'counts', id: 'legacy', row: { Row: { id: { Id: 'legacy' }, target: key, value: { Int: 3 } } } };
+  const legacy = new ClientStore(schema,{ ...receipt([range],[primary]),rows: [surviving] }).reexecute(program,context);
+  assert.equal((wireJson(legacy.execution.result) as any).value,3,'noncanonical surviving group row wins over canonical primary absence');
+}
 console.log('maintained address: exact native held/delivery outputs, targeted Optional/List, absent authority, atomic images and current-schema cursors pass');
diff --git a/snapback2/packages/evaluator/src/test-search-foundation.ts b/snapback2/packages/evaluator/src/test-search-foundation.ts
index 63f8d8b5f2..7d24e1d94e 100644
--- a/snapback2/packages/evaluator/src/test-search-foundation.ts
+++ b/snapback2/packages/evaluator/src/test-search-foundation.ts
@@ -7,6 +7,33 @@ import { SEARCH_CONTRACT, SearchInputError, SearchNormalizer, normalizeSearch, s
 import { decomposition, composition, combining, folding, boundaries, rangeValue } from './unicode-tables';
 import { compareScalarAtoms, decodeIndexAtom, indexKeysEqual, indexKeyStartsWith, prepareIndexAtom,
   wordPrefixWireMax, type IndexComponent, type LogicalIndexAtom } from './search-key';
+import { sameValueZero, totalCompare, valueFromWire } from './value-runtime';
+
+// Collection equality shares text/ID values; index ordering keeps their types.
+for (const [left, right, equal] of [
+  [{ String: 'alice' }, { Id: 'alice' }, true],
+  [{ Id: 'alice' }, { String: 'bob' }, false],
+  [{ Int: 0 }, { Int: -0 }, true],
+  [{ Int: 0 }, { Bool: false }, false],
+  ['Null', { Bool: false }, false],
+] as const) {
+  assert.equal(sameValueZero(left, right), equal);
+  assert.equal(sameValueZero(right, left), equal);
+}
+assert(totalCompare({ String: 'alice' }, { Id: 'alice' }) < 0);
+for (const value of [{ Bytes: '00' }, { Row: {} }, { Array: [] }, { Map: {} }]) {
+  assert.throws(() => sameValueZero(value, { Int: 0 }), { code: 'E_TYPE' });
+  assert.throws(() => sameValueZero({ Int: 0 }, value), { code: 'E_TYPE' });
+}
+assert(totalCompare({ Bytes: '0f' }, { Bytes: '10' }) < 0);
+for (const bytes of ['FF', '0', 42, null]) {
+  const value = { Bytes: bytes } as any;
+  assert.throws(() => totalCompare(value, { Bytes: '00' }), { code: 'E_INPUT' });
+  assert.throws(() => totalCompare({ Bytes: '00' }, value), { code: 'E_INPUT' });
+  assert.throws(() => valueFromWire({ Bytes: { max: 10 } }, value, 'payload', (path, message) => {
+    throw new Error(`${path}: ${message}`);
+  }), /payload: expected canonical Bytes/);
+}
 
 const root = new URL('../../../unicode/17.0.0/', import.meta.url);
 const lines = (name: string) => readFileSync(new URL(name, root), 'utf8').split('\n');
diff --git a/snapback2/packages/evaluator/src/value-runtime.ts b/snapback2/packages/evaluator/src/value-runtime.ts
index 546d4850d7..bf3f6acea4 100644
--- a/snapback2/packages/evaluator/src/value-runtime.ts
+++ b/snapback2/packages/evaluator/src/value-runtime.ts
@@ -138,12 +138,9 @@ export function totalCompare(left: Value, right: Value): number {
   const leftData = (left as any)[leftKind];
   const rightData = (right as any)[rightKind];
   if (leftKind === "Bool" || leftKind === "Int") return comparePrimitive(leftData, rightData);
-  if (leftKind === "String" || leftKind === "Id") return compareCodepoints(leftData, rightData);
-  if (leftKind === "Bytes") {
-    if (!canonicalBytes(leftData) || !canonicalBytes(rightData))
-      fail("E_INPUT", "Bytes is not canonical lowercase base16");
-    return compareCodepoints(leftData, rightData);
-  }
+  if (leftKind === "Bytes" && (!canonicalBytes(leftData) || !canonicalBytes(rightData)))
+    fail("E_INPUT", "Bytes is not canonical lowercase base16");
+  if (leftKind === "String" || leftKind === "Id" || leftKind === "Bytes") return compareCodepoints(leftData, rightData);
   if (leftKind === "Array") return compareArrays(leftData, rightData);
   const leftEntries = Object.keys(leftData).sort(compareCodepoints);
   const rightEntries = Object.keys(rightData).sort(compareCodepoints);
@@ -228,16 +225,13 @@ export function sameValueZero(left: Value, right: Value): boolean {
   // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Keep the client twin on the compiler's primitive collection identity contract.
   const leftKind = kindOf(left);
   const rightKind = kindOf(right);
-  if (["Bytes", "Row", "Array", "Map"].includes(leftKind)) {
-    fail("E_TYPE", `SameValueZero expects primitive operands, got ${leftKind}`);
-  }
-  if (["Bytes", "Row", "Array", "Map"].includes(rightKind)) {
-    fail("E_TYPE", `SameValueZero expects primitive operands, got ${rightKind}`);
+  for (const kind of [leftKind, rightKind]) {
+    if (["Bytes", "Row", "Array", "Map"].includes(kind)) {
+      fail("E_TYPE", `SameValueZero expects primitive operands, got ${kind}`);
+    }
   }
   if ((leftKind === "String" || leftKind === "Id") && (rightKind === "String" || rightKind === "Id")) {
-    const leftText = isVariant(left, "String") ? left.String : (left as { Id: string }).Id;
-    const rightText = isVariant(right, "String") ? right.String : (right as { Id: string }).Id;
-    return leftText === rightText;
+    return asString(left) === asString(right);
   }
   return canonicalValue(left) === canonicalValue(right);
 }
@@ -603,7 +597,7 @@ export function valueFromWire(descriptor: any, value: any, path: string, fail: W
   if (descriptor === "Bool") { if (typeof value !== "boolean") fail(path, "expected boolean"); return { Bool: value as boolean }; }
   if (wireObject(descriptor) && "Bytes" in descriptor) {
     const bytes = wireObject(value) && "Bytes" in value ? value.Bytes : undefined;
-    if (!wireObject(value) || Object.keys(value).length !== 1 || typeof bytes !== "string" || !canonicalBytes(bytes))
+    if (!wireObject(value) || Object.keys(value).length !== 1 || !canonicalBytes(bytes))
       fail(path, "expected canonical Bytes");
     return { Bytes: bytes };
   }
diff --git a/snapback2/packages/snapback2/tests/real-owner-prediction.test.ts b/snapback2/packages/snapback2/tests/real-owner-prediction.test.ts
index c5181f14e6..fd54082b1f 100644
--- a/snapback2/packages/snapback2/tests/real-owner-prediction.test.ts
+++ b/snapback2/packages/snapback2/tests/real-owner-prediction.test.ts
@@ -241,3 +241,118 @@ mutation allocateRef(realms: [realmCounts] <=3):
     else process.env.SNAPBACK_URL = previousUrl;
   }
 });
+
+// @ref LLP 1012#6-reads-offline — consume public exhaustion without mixing an old computed answer with newer row images.
+test("a durable observed row and zero count survives receipt replay, owner changes and cold reopen", async () => {
+  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
+  const { tmpdir } = await import("node:os");
+  const { join } = await import("node:path");
+  const { fileRangeStore } = await import("../dist/test.mjs");
+  const { answerOffline } = await import("../dist/client-observed-test.mjs");
+  const { itemInputs } = await import("../dist/image-runtime.mjs");
+  const directory = await mkdtemp(join(tmpdir(), "snapback-count-composite-"));
+  const fixture = join(directory, "source"), clients: any[] = [], stops: (() => void)[] = [];
+  let local: RealOwnerHarness | undefined;
+  const until = async (check: () => boolean, label: string) => {
+    const end = Date.now() + 5_000;
+    while (!check()) { assert(Date.now() < end, label); await new Promise(resolve => setTimeout(resolve, 10)); }
+  };
+  try {
+    await mkdir(fixture);
+    await writeFile(join(fixture, "schema.q"), `use identity
+table rows:
+  owner: principal
+  label: text <=40
+  public
+  insert <- .owner = viewer
+  update <- .owner = viewer
+  delete <- .owner = viewer
+
+table votes:
+  target: rows
+  owner: principal
+  by byTarget: target
+  public
+  insert <- .owner = viewer
+  update <- deny
+  delete <- .owner = viewer
+
+maintain counts: count votes by target
+  read <- allow
+`);
+    await writeFile(join(fixture, "ops.q"), `query composite(target: rows):
+  return { row: rows[target], count: counts[target] }
+
+query row(target: rows):
+  return rows[target]
+
+mutation create(label: text <=40, positive: bool):
+  row = insert rows { owner: viewer, label }
+  if positive:
+    insert votes { owner: viewer, target: row.id }
+  return row.id
+
+mutation rename(target: rows, label: text <=40):
+  update rows[target] { label }
+  return null
+
+mutation remove(target: rows):
+  delete rows[target]
+  return null
+`);
+    local = await RealOwnerHarness.create({ forceOwned: true, fixture });
+    let token: string | null = null;
+    const tokenStore = { load: () => token, save: (value: string | null) => { token = value; } };
+    const plain = createClient({ url: local.url, tokenStore }); clients.push(plain);
+    await plain.auth.guest();
+    for (const count of [0, 1]) {
+      const made: any = await plain.mutation(api.ops.create, { label: `row ${count}`, positive: count === 1 });
+      assert.equal(made.state, "committed");
+      const target = made.data, refreshed: any[] = [];
+      let client: any = createClient({ url: local.url, tokenStore, offline: { store: fileRangeStore(join(directory, `client-${count}`)) },
+        offlineReadObserver: (_op: unknown, args: any, result: any) => {
+          if (args.target === target) refreshed.push(result);
+        } } as any);
+      clients.push(client); await client.ready; await client.auth.me();
+      const expected: any = await plain.query(api.ops.composite, { target });
+      assert.equal(expected.state, "complete"); assert.equal(expected.data.count, count);
+      const observed = client.observe(api.ops.composite, { target });
+      stops.push(observed.subscribe(() => {}));
+      await until(() => refreshed.length > 0, "the accepted owner receipt reaches local replay");
+      assert.equal(refreshed[0].state, "complete", "the row/count composite must be reconstructible after its receipt commits");
+      // Equal exact replay preserves live server provenance (client-observed.ts);
+      // the receipt-commit observer above proves the local result, not just the first frame.
+      await until(() => observed.getSnapshot().receipt?.state === "complete", "the observed publication remains complete after local replay");
+      assert.equal(observed.getSnapshot().receipt.state, "complete");
+      assert.deepEqual(observed.getSnapshot().data, expected.data);
+      const firstSequence = observed.getSnapshot().receipt.seq;
+      // An unrelated answer changes durable order while the owner sequence stays fixed.
+      await client.query(api.ops.row, { target: "unrelated-missing" });
+      await new Promise(resolve => setTimeout(resolve, 30));
+      assert.equal(observed.getSnapshot().receipt.seq, firstSequence);
+      assert.deepEqual(observed.getSnapshot().data, expected.data);
+      const label = `changed ${count}`;
+      assert.equal((await client.mutation(api.ops.rename, { target, label })).state, "committed");
+      await until(() => refreshed.some(result => result.seq > firstSequence && result.data?.row?.label === label), "new owner row is replayed with its count");
+      await until(() => observed.getSnapshot().data?.row?.label === label, "the observed client publishes the changed owner row");
+      assert.equal(observed.getSnapshot().data.count, count);
+      await client.offline(); client = await client.restart(); clients.push(client);
+      const cold: any = await client.query(api.ops.composite, { target });
+      assert.equal(cold.state, "complete"); assert.equal(cold.live, false);
+      assert.equal(cold.data.row.label, label); assert.equal(cold.data.count, count);
+      const coldObserved = client.observe(api.ops.composite, { target });
+      stops.push(coldObserved.subscribe(() => {}));
+      await until(() => coldObserved.getSnapshot().data?.row?.label === label, "cold observation replays the complete composite");
+      assert.equal((await client.mutation(api.ops.remove, { target })).state, "queued");
+      const overlay: any = await answerOffline(client.offlineRuntime, "ops.composite", { target }, (value: any) => value);
+      assert(itemInputs(overlay)?.entries?.some((entry: any) => entry.predicted), "the removal control has an actual queued overlay");
+      assert.equal(overlay.data?.row ?? null, null, "the held owner answer cannot revive the removed row");
+      await client.close();
+    }
+  } finally {
+    for (const stop of stops) stop();
+    for (const client of clients) await client.close();
+    await local?.close();
+    await rm(directory, { recursive: true, force: true });
+  }
+});
diff --git a/snapback2/packages/snapback2/tests/real-owner-successor.test.ts b/snapback2/packages/snapback2/tests/real-owner-successor.test.ts
index 0b2d68b435..9f4a4565d4 100644
--- a/snapback2/packages/snapback2/tests/real-owner-successor.test.ts
+++ b/snapback2/packages/snapback2/tests/real-owner-successor.test.ts
@@ -639,7 +639,7 @@ test("two clients and cold carrier reopen preserve rows; an enum replay with a l
   }
 });
 
-test("positional reads compile after a regroup, report it in log/status, and absent/hidden receipts do not invent completeness", { timeout: 60000 }, async t => {
+test("positional reads compile after a regroup, report it in log/status, and distinguish public coverage from hidden or unheld groups", { timeout: 60000 }, async t => {
   const { directory, source } = await fixture();
   const previousUrl = process.env.SNAPBACK_URL;
   let owner: RealOwnerHarness | undefined;
@@ -650,6 +650,7 @@ test("positional reads compile after a regroup, report it in log/status, and abs
   const resumeReset = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
   const resumeQuery = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
   let predecessor: string | undefined;
+  const queryReceipts = new Map<string, any>();
   const gatedJson = async (response: Response, gate: typeof onlineQuery) => {
     const value = await response.clone().json();
     if (gate.armed) { gate.armed = false; gate.entered.resolve(value); await gate.release.promise; }
@@ -664,7 +665,11 @@ test("positional reads compile after a regroup, report it in log/status, and abs
           onlineLive.armed = false; onlineLive.entered.resolve(delivery); await onlineLive.release.promise;
         }
       });
-      if (path === "/api/query" && onlineQuery.armed) return gatedJson(response, onlineQuery);
+      if (path === "/api/query") {
+        const envelope = await response.clone().json();
+        if (envelope.receipt) queryReceipts.set(JSON.parse(String(init?.body)).op, envelope);
+        if (onlineQuery.armed) return gatedJson(response, onlineQuery);
+      }
       if (path === "/api/resume" && onlineReset.armed) return gatedJson(response, onlineReset);
       return response;
     };
@@ -743,15 +748,31 @@ test("positional reads compile after a regroup, report it in log/status, and abs
     assert.equal((await resuming.query(api.ops.count, { who: "dev:bob" })).data, 1);
     await resumeSub.until((event: any) => event.live === true && event.state === "complete" && event.data === 0, 8_000);
 
-    for (const [name, who] of [["count", "dev:alice"], ["hidden", "dev:alice"]]) {
+    const unheld = await online.offlineRuntime.evaluate("ops.count", { who: "dev:never-held" });
+    assert.equal(unheld?.state, "partial", "a different unqueried successor group has no coverage");
+    assert.equal(unheld?.reason, "never-held");
+    for (const [name, who] of [["hidden", "dev:alice"], ["count", "dev:alice"]]) {
       const server: any = await online.query(api.ops[name], { who });
       assert.equal(server.data, 0, `${name}: server typed zero: ${JSON.stringify(server)}`);
       await online.online();
       const replay = await online.offlineRuntime.evaluate(`ops.${name}`, { who });
-      t.diagnostic(`${name}: ${JSON.stringify({ server: server.state, replay })}`);
+      const envelope = queryReceipts.get(`ops.${name}`);
+      t.diagnostic(`${name}: ${JSON.stringify({ generation: envelope.generation, receipt: envelope.receipt, server: server.state, replay })}`);
       assert.equal(server.state, "complete", `${name}: the server's typed zero is complete`);
-      assert.equal(replay?.state, "partial", `${name}: receipt-only evaluation cannot mint zero authority`);
-      assert.equal(replay?.reason, "never-held", `${name}: the group was never held, so no false completeness: ${JSON.stringify(replay)}`);
+      assert.equal(envelope.generation, online.offlineRuntime.programGeneration, "coverage belongs to the adopted successor");
+      if (name === "count") {
+        const range = envelope.receipt.ranges.find((range: any) => range.table === "counts");
+        assert.ok(range, "the public Count read carries its independent group coverage");
+        assert.deepEqual({ index: range.index, prefix: range.prefix, rows: range.rowIds, stop: range.stop, absence: range.absence },
+          { index: "byRecipient", prefix: [{ Scalar: who }], rows: [], stop: "Exhausted", absence: true });
+        for (const bound of ["after", "before", "gt", "gte", "lt", "lte"]) assert.equal(range[bound], null);
+        assert.equal(replay?.state, "complete", "the exhausted public successor group covers its zero");
+        assert.equal(replay?.data, 0);
+      } else {
+        assert.deepEqual(envelope.receipt, { ranges: [], absences: [], verdicts: [] }, "hidden zero exposes no absence authority");
+        assert.equal(replay?.state, "partial", "hidden receipt-only evaluation cannot mint zero authority");
+        assert.equal(replay?.reason, "never-held");
+      }
     }
     assert.equal(onlineEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);
     assert.equal(resumeEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);

```

## snapback2/packages/evaluator/src/store.ts

```text
1: import { RowImage } from './row-image';
2: export { immutable } from './row-image';
3: import { ReadableDirectory } from './held-directory';
4: import { canonicalSchemaJson } from './certificate-identity';
5: import { CoverageIndex, prepareRange } from './coverage';
6: import { fail, EvalError } from './errors';
7: import { sha256 } from './hash';
8: import { HeldIndex, components, ordinaryColumns, preparePrefix, scalarAtoms } from './index-store';
9: import type { SearchExecution } from './search-runtime';
10: import { Runner } from './runner';
11: import { asString, field, fieldOrNull, canonicalJson, wireJson, validateInputs } from './value-runtime';
12: import type { LogicalIndexAtom } from './search-key';
13: import type { ClosureReceipt, Context, Execution, LocalExecution, Trace, TraceRange, Value } from './types';
14: 
15: export interface ClientStoreOptions {
16:   readable?: Iterable<string>;
17:   program?: any;
18: }
19: const empty = (): ClosureReceipt => ({ rows: [], ranges: [], absences: [], verdicts: [] });
20: // @ref LLP 1012#indexed-held-search — one row pool/index generation and a bounded mutation journal, shared by all named programs.
21: export class ClientStore {
22:   private tables = new Map<string, Map<string, Value>>();
23:   private indexes = new Map<string, HeldIndex>();
24:   private facts: CoverageIndex;
25:   private readonly readableTables: Set<string>;
26:   private journal?: Map<string, { table: string; id: string; row: Value | null }>;
27:   private readonly schemaHash: string;
28:   private directories = new Map<any, ReadableDirectory>();
29:   constructor(readonly schema: any, receipt: ClosureReceipt = empty(), private readonly options: ClientStoreOptions = {}) {
30:     this.schemaHash = sha256(canonicalSchemaJson(schema));
31:     this.readableTables = new Set(options.readable ?? []);
32:     for (const [table, definition] of Object.entries<any>(schema.tables)) {
33:       this.tables.set(table, new Map());
34:       for (const name of Object.keys(definition.indexes)) this.indexes.set(JSON.stringify([table, name]), new HeldIndex(schema, table, name, components(schema, table, name)));
35:     }
36:     this.facts = new CoverageIndex(schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
37:     for (const record of receipt.rows) {
38:       if (asString(field(record.row,'id')) !== record.id) fail('E_INPUT', 'receipt row identity must match its body');
39:       this.put(record.table, record.row);
40:     }
41:     this.setReceipt('seed', receipt, options.program);
42:   }
43:   readable(table: string): boolean { return this.readableTables.has(table); }
44:   setReceipt(owner: string, receipt?: ClosureReceipt, program?: any, issuedKeys?: Parameters<CoverageIndex['set']>[3], pool?: Set<string>): boolean {
45:     const changed = this.facts.set(owner, this.checkedReceipt(receipt,pool), program, issuedKeys);
46:     this.touchProofs(changed); return changed.length > 0;
47:   }
48:   private checkedReceipt(receipt?: ClosureReceipt, admittedPool?: Set<string>): ClosureReceipt | undefined {
49:     if (receipt) {
50:       const pool = admittedPool ?? new Set(receipt.rows.map(r => JSON.stringify([r.table, r.id])));
51:       for (const r of receipt.ranges) {
52:         for (const id of r.row_ids) if (!pool.has(JSON.stringify([r.table, id])) && !r.evicted_ids?.includes(id))
53:           fail('E_INPUT', 'range member must reference its receipt row pool');
54:       }
55:       for (const r of receipt.ranges) if (r.halo && (r.halo.table !== r.table || !pool.has(JSON.stringify([r.halo.table, r.halo.id]))))
56:         fail('E_INPUT', 'halo must reference the same receipt row pool');
57:       if (receipt.schema_hash !== this.schemaHash) receipt = { ...receipt, absences: [], verdicts: [] };
58:     }
59:     return receipt;
60:   }
61:   // @ref LLP 1012#indexed-held-search — coverage owns proof keys, never a second full receipt row pool.
62:   private touchProofs(changes: Iterable<ReturnType<CoverageIndex['set']>[number]>): void {
63:     for (const changed of changes) if (changed) {
64:       for (const point of changed.absences) {
65:         const [table, index, key] = JSON.parse(point); this.touchAuthority(table, index, key);
66:       }
67:       for (const [key] of changed.verdicts) {
68:         const digest = JSON.parse(key)[1];
69:         for (const d of this.directories.values()) d.touchDigest(digest);
70:       }
71:     }
72:   }
73:   rehydrate(receipt: ClosureReceipt): number {
74:     if (this.journal) fail('E_INPUT', 'nested prediction transaction');
75:     // Validate the entire replacement before touching current rows or authority.
76:     const rows = receipt.rows.map(({ table,id,row }) => {
77:       const value = this.prepareRow(table,row);
78:       if (asString(field(value,'id')) !== id) fail('E_INPUT', 'receipt row identity must match its body');
79:       return { table,id,row: value };
80:     });
81:     const next = new CoverageIndex(this.schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
82:     const changes = next.set('seed',this.checkedReceipt({ ...receipt,rows }),this.options.program);
83:     const old = this.facts, directories = this.directories;
84:     const ids = new Set(rows.map(r => JSON.stringify([r.table,r.id])));
85:     let removed = 0;
86:     this.journal = new Map(); this.facts = next; this.directories = new Map();
87:     try {
88:       for (const [table, held] of this.tables) for (const id of held.keys())
89:         if (!ids.has(JSON.stringify([table,id]))) { this.remove(table,id); removed++; }
90:       for (const r of rows) this.put(r.table,r.row);
91:       for (const r of this.journal.values()) next.changed(r.table,r.id);
92:     } catch (error) {
93:       this.facts = old; this.rollback(); throw error;
94:     } finally { this.directories = directories; }
95:     const touched = this.journal; this.journal = undefined;
96:     // Existing directory objects/indexes survive; all notifications see final facts and rows.
97:     for (const r of touched.values()) this.touchRows(r.table,r.row,this.byId(r.table,r.id));
98:     this.touchProofs(changes); this.touchProofs(old.authorityOwners());
99:     return removed;
100:   }
101:   applyMutation(program: any, context: Context, preview = false, certificate: any = null, predictDelivery = false): LocalExecution {
102:     validateInputs(this.schema, program, context.args);
103:     if (this.journal) fail('E_INPUT', 'nested prediction transaction');
104:     this.journal = new Map();
105:     const runner = new Runner(this, this.schema, context, certificate, undefined, predictDelivery);
106:     let execution: Execution;
107:     try { execution = runner.execute(program); }
108:     catch (error) {
109:       this.rollback();
110:       if (runner.coverageMisses().includes('missing-authority')) return { state: 'partial', partialSites: ['missing-authority'], execution: { result: 'Null', trace: runner.trace, next: null, writes: [] } };
111:       if (error instanceof EvalError) { error.trace = runner.trace; error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses(), program, runner.search); }
112:       throw error;
113:     }
114:     const changed = [...this.journal.values()].map(r => ({ ...r, row: this.byId(r.table, r.id) }));
115:     this.rollback();
116:     const uncoveredSites = this.uncoveredSites(execution.trace, [], program, runner.search);
117:     const partialSites = runner.coverageMisses();
118:     if (partialSites.length) return { state: 'partial', partialSites, execution, uncoveredSites, authorityMisses: runner.authorityMisses() };
119:     if (!preview) for (const r of changed) { if (r.row) this.put(r.table, r.row); else this.remove(r.table, r.id); }
120:     return { state: 'predicted', partialSites: [], execution, uncoveredSites };
121:   }
122:   private rollback(): void {
123:     const journal = this.journal!; this.journal = undefined;
124:     for (const r of journal.values()) { if (r.row) this.put(r.table, r.row); else this.remove(r.table, r.id); }
125:   }
126:   reexecute(program: any, context: Context, certificate: any = null, search?: SearchExecution): LocalExecution {
127:     validateInputs(this.schema, program, context.args);
128:     const runner = new Runner(this, this.schema, context, certificate, search);
129:     let execution: Execution;
130:     try { execution = runner.execute(program); }
131:     catch (error) {
132:       if (error instanceof EvalError) { error.trace = runner.trace; error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses(), program, runner.search); }
133:       throw error;
134:     }
135:     const partialSites = this.uncoveredSites(execution.trace, runner.coverageMisses(), program, runner.search);
136:     if (partialSites.length) execution.next = null;
137:     return { state: partialSites.length ? 'partial' : 'fresh', partialSites, execution };
138:   }
139:   uncoveredSites(trace: Trace, misses: string[] = [], program?: any, search?: SearchExecution): string[] {
140:     const partial = new Set(misses);
141:     for (const r of trace.ranges) if (!this.facts.covers(r, prepareRange(this.schema, r, program, search))) partial.add(r.site);
142:     // @ref LLP 1012#6-reads-offline — public group exhaustion proves this read's null, not primary/rule authority.
143:     for (const a of trace.absences) if (!this.hasAbsence(a.table, a.index, a.key) && this.lookup(a.table, a.index, a.key) === null) {
144:       const table = this.schema.tables[a.table];
145:       if (table.rules.read !== 'Allow' || !table.indexes[a.index].unique
146:         || !this.hasCompleteRange(a.table, a.index, a.key)) partial.add(a.site);
147:     }
148:     return [...partial].sort();
149:   }
150:   rangeStop(range: TraceRange, logical: LogicalIndexAtom[]): TraceRange['stop'] { return this.facts.stop(range, logical); }
151:   rows(table: string): Value[] { return [...(this.tables.get(table)?.values() ?? [])]; }
152:   lookup(table: string, index: string, key: Value[]): Value | null {
153:     const definition = this.schema.tables?.[table]?.indexes?.[index];
154:     if (!definition || key.length !== ordinaryColumns(definition).length) fail('E_TYPE', 'point requires a complete ordinary index key');
155:     const prefix = preparePrefix(this.schema, table, index, scalarAtoms(key), []);
156:     return this.seek(table, index, prefix, null, null, null, 'Asc').next().value ?? null;
157:   }
158:   index(table: string, index: string): HeldIndex {
159:     const held = this.indexes.get(JSON.stringify([table, index]));
160:     if (!held) fail('E_SCHEMA', `missing index ${table}.${index}`);
161:     return held;
162:   }
163:   seek(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null, before: Value | null, range: any, order: 'Asc' | 'Desc'): Generator<Value> {
164:     return this.index(table, index).scan({ prefix, after, before, range, order });
165:   }
166:   scan(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null, before: Value | null, range: any, order: 'Asc' | 'Desc', limit: number): Value[] {
167:     const result: Value[] = [];
168:     if (limit > 0) for (const row of this.seek(table, index, prefix, after, before, range, order)) { result.push(row); if (result.length >= limit) break; }
169:     return result;
170:   }
171:   private prepareRow(table: string, row: Value): RowImage {
172:     return RowImage.prepare(this.schema,table,row,this.schemaHash);
173:   }
174:   put(table: string, row: Value): boolean {
175:     const value = this.prepareRow(table,row);
176:     const id = asString(field(value, 'id')), rows = this.tables.get(table);
177:     if (!rows) fail('E_SCHEMA', `missing table ${table}`);
178:     const old = this.byId(table, id);
179:     if (old === value) return false;
180:     const changed = !RowImage.equal(old,value);
181:     if (!changed) RowImage.keys(value,RowImage.keys(old as RowImage));
182:     this.record(table, id);
183:     for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).putPrepared(id, value, RowImage.keys(value)[name]);
184:     rows.set(id, value);
185:     if (changed) {
186:       if (!this.journal) this.facts.changed(table, id);
187:       this.touchRows(table, old, value);
188:     }
189:     return changed;
190:   }
191:   remove(table: string, id: string): Value | null {
192:     const old = this.byId(table, id); if (!old) return null;
193:     this.record(table, id);
194:     for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).remove(id);
195:     this.tables.get(table)!.delete(id);
196:     if (!this.journal) this.facts.changed(table, id);
197:     this.touchRows(table, old, null);
198:     return old;
199:   }
200:   registerHeld(programs: Record<string, { ir: unknown }>, context: Context): void {
201:     const visit = (value: any): void => {
202:       if (!value || typeof value !== 'object') return;
203:       if (value.held_search) {
204:         const d = value.held_search, lane = value.lanes?.[0];
205:         if (value.lanes.length !== 1 || !lane.source || lane.setup?.length || lane.scan.before !== null || lane.scan.range !== null
206:           || d.table !== lane.scan.table || d.index !== lane.scan.index || d.order !== lane.scan.order
207:           || canonicalJson(d.discovery.scan) !== canonicalJson(lane.source) || d.discovery.binding !== lane.binding
208:           || canonicalJson(d.term) !== canonicalJson(lane.scan.prefix.at(-1)?.WordPrefix)) fail('E_TRACE_SUBSET', 'held search metadata does not match its merge');
209:         const index = this.index(d.table, d.index);
210:         if (index.derived !== d.scope.length || d.suffix.at(-1) !== 'id') fail('E_TRACE_SUBSET', 'invalid held search partition');
211:         this.directories.set(d, new ReadableDirectory(index, d, context.viewer, row => new Runner(this, this.schema, context, null).readAuthority(d.table, row)));
212:       }
213:       for (const child of Object.values(value)) visit(child);
214:     };
215:     for (const operation of Object.values(programs)) visit(operation.ir);
216:   }
217:   missingSearchAuthority(table: string, name: string, logical: LogicalIndexAtom[], context: Context): boolean {
218:     const index = this.index(table, name), derived = logical[index.derived];
219:     if (!derived || !('WordPrefix' in derived) || derived.WordPrefix.empty || this.readable(table)) return false;
220:     // Equality-bound direct searches need only their exact scope, even on the first warm invocation.
221:     const row = index.scopes.get(logical.slice(0, index.derived).map(a => (a as { Scalar: Value }).Scalar))?.values().next().value;
222:     return !!row && new Runner(this, this.schema, { ...context, args: {}, new_ids: [] }, null)
223:       .readAuthority(table, row, index.parts.slice(0, index.derived).map(c => (c as { Column: string }).Column)) === null;
224:   }
225:   heldDirectory(descriptor: any): ReadableDirectory | undefined { return this.directories.get(descriptor); }
226:   private touchAuthority(table: string, index: string, key: Value[]): void {
227:     const dependency = canonicalJson([table, index, key.map(wireJson)]);
228:     for (const d of this.directories.values()) d.touch(dependency);
229:   }
230:   private touchRows(table: string, old: Value | null, next: Value | null): void {
231:     for (const row of [old, next]) if (row) {
232:       for (const [index, definition] of Object.entries<any>(this.schema.tables[table].indexes)) {
233:         if (definition.components.every((c: any) => 'Column' in c)) this.touchAuthority(table, index, ordinaryColumns(definition).map(c => fieldOrNull(row, c)));
234:         for (const d of this.directories.values()) if (d.index.table === table && d.index.name === index) d.refresh(definition.components.slice(0, d.index.derived).map((c: any) => fieldOrNull(row, c.Column)));
235:       }
236:     }
237:   }
238:   private record(table: string, id: string): void {
239:     const key = JSON.stringify([table, id]);
240:     if (this.journal && !this.journal.has(key)) this.journal.set(key, { table, id, row: this.byId(table, id) });
241:   }
242:   byId(table: string, id: string): Value | null { return this.tables.get(table)?.get(id) ?? null; }
243:   verdict(rule: string, digest: string, context: Context): boolean | null { return this.facts.verdict(rule, digest, context.viewer, context.auth_epoch); }
244:   authorityAbsence(table: string, id: string): boolean { return this.hasAbsence(table, 'byId', [{ Id: id }]); }
245:   hasAbsence(table: string, index: string, key: Value[]): boolean { return this.facts.hasAbsence(table, index, key); }
246:   hasCompleteRange(table: string, index: string, key: Value[]): boolean { return this.facts.drained(table, index, scalarAtoms(key)); }
247: }
```

## snapback2/packages/evaluator/src/coverage.ts

```text
1: // @ref LLP 1012#indexed-held-search — receipt identity is normalized meaning; a term never grants its source scope.
2: import { canonicalJson, clone, compareArrays, fieldOrNull, scopedRuleHash, wireJson } from './value-runtime';
3: import { components, logicalKey } from './index-store';
4: import { PreparedRange, rangeSchemaIdentity } from './range-preparation';
5: export { prepareRange } from './range-preparation';
6: import type { IndexAtom, LogicalIndexAtom } from './search-key';
7: import type { ClosureReceipt, ReceiptRange, TraceRange, Value, Verdict } from './types';
8: import { EvalError } from './errors';
9: import { CoverageSpans } from './coverage-spans';
10: 
11: type Range = { value: ReceiptRange; logical: LogicalIndexAtom[]; identity: string; group: string; expected: Map<string, Value[]>; lost: Set<string>; exact: boolean; last?: Value[] | null; extent?: [Value[] | null, Value[] | null] };
12: type Owner = { ranges: Range[]; absences: string[]; verdicts: [string, boolean][] };
13: type Group = { count: number; spans: CoverageSpans; summary: string };
14: const whole = (r: ReceiptRange): boolean => !r.evicted_ids?.length;
15: const boundsKey = (r: ReceiptRange | TraceRange): string => JSON.stringify([r.order, r.take, r.after, r.before, r.gt, r.gte, r.lt, r.lte, r.rule_hash]);
16: const pointKey = (table: string, index: string, key: Value[]): string => JSON.stringify([table, index, key]);
17: const verdictKey = (v: Verdict): string => JSON.stringify([v.rule_hash, v.pinned_inputs_digest, v.principal, v.auth_epoch]);
18: export class CoverageIndex {
19:   private readonly schemaIdentity: string;
20:   private owners = new Map<string, Owner>();
21:   private exact = new Map<string, [pages: number, exhausted: number]>();
22:   private groups = new Map<string, Group>();
23:   private complete = new Map<string, number>();
24:   private patterns = new Map<string, string[][]>();
25:   private absences = new Map<string, Set<string>>();
26:   private verdicts = new Map<string, [number, number]>();
27:   private rowRanges = new Map<string, Set<Range>>();
28:   constructor(private schema: any, private position: (range: ReceiptRange, logical: LogicalIndexAtom[], id: string) => Value[] | null) {
29:     this.schemaIdentity = rangeSchemaIdentity(schema);
30:     for (const [table, definition] of Object.entries<any>(schema.tables)) {
31:       const patterns = new Map<string, string[]>();
32:       for (const index of Object.values<any>(definition.indexes)) {
33:         if (index.components.some((c: any) => !('Column' in c))) continue;
34:         for (let n = 0; n <= index.components.length; n++) {
35:           const names = index.components.slice(0, n).map((c: any) => c.Column);
36:           patterns.set(JSON.stringify(names), names);
37:         }
38:       }
39:       this.patterns.set(table, [...patterns.values()]);
40:     }
41:   }
42:   /** Issuing keys are consumed here: undefined selects the confirmed pool; null withholds the position. */
43:   set(owner: string, receipt: ClosureReceipt | undefined, program?: any,
44:     issuedKeys?: (table: string, index: string, id: string) => Value[] | null | undefined): Array<Pick<Owner, 'absences' | 'verdicts'> | undefined> {
45:     const verdicts = (receipt?.verdicts ?? []).map((v): [string, boolean] => {
46:       if (typeof v.result !== 'boolean') throw new EvalError('E_INPUT', 'verdict result must be boolean');
47:       return [verdictKey(v), v.result];
48:     });
49:     const pool = new Map(receipt?.rows.map(r => [JSON.stringify([r.table, r.id]), r.row]));
50:     // Prepare/validate all new proof before removing the previous owner.
51:     const ranges = (receipt?.ranges ?? []).map(incoming => {
52:       // Retain isolated proof metadata and typed keys, never the caller's row pool.
53:       const { value,prepared } = PreparedRange.tagged(this.schema,incoming,program,this.schemaIdentity);
54:       const logical = prepared.meaning.prefix, prefix = logicalKey(logical);
55:       const identity = JSON.stringify([value.site, value.table, value.index, prefix, boundsKey(value)]);
56:       const group = JSON.stringify([value.table, value.index, value.order, value.rule_hash, prefix]);
57:       const r: Range = { value, logical, identity, group, expected: new Map(), lost: new Set(), exact: false };
58:       const suffix = prepared.suffix, after = prepared.meaning.after, heldSuffix = value.held_suffix;
59:       for (const id of [...value.row_ids, ...(value.halo ? [value.halo.id] : [])]) {
60:         const row = pool.get(JSON.stringify([value.table, id]));
61:         const columns = prepared.columns;
62:         const issued = issuedKeys?.(value.table, value.index, id);
63:         const keys = issued === undefined ? row ? columns.map(c => fieldOrNull(row, (c as { Column: string }).Column)) : null : issued;
64:         if (keys) r.expected.set(id, clone(prepared.position(this.schema,keys)));
65:         else r.lost.add(id);
66:       }
67:       if (whole(value) && !r.lost.size && [value.before, value.gt, value.gte, value.lt, value.lte].every(v => v === null)) {
68:         const suffixOf = (keys: Value[]) => keys.slice(keys.length - suffix.length);
69:         const keys = r.expected.get(value.row_ids.at(-1)!);
70:         const end = heldSuffix ?? (keys && suffix.every(c => 'Column' in c) ? suffixOf(keys) : undefined);
71:         if (value.stop === 'Exhausted' || end) {
72:           r.extent = [after, value.stop === 'Exhausted' ? null : clone(end!)];
73:           r.last = null;
74:           for (const keys of r.expected.values()) {
75:             const position = suffixOf(keys);
76:             if (!r.last || compareArrays(position, r.last) * (value.order === 'Desc' ? -1 : 1) > 0) r.last = clone(position);
77:           }
78:         }
79:       }
80:       for (const id of [...value.row_ids, ...(value.halo ? [value.halo.id] : [])]) this.member(r, id);
81:       return r;
82:     });
83:     const absences = [...new Set((receipt?.absences ?? []).map(([table,index,values]) => {
84:       values.forEach(wireJson); // Authority invalidation must not discover malformed values after publication.
85:       return pointKey(table,index,values);
86:     }))];
87:     const old = this.owners.get(owner);
88:     if (old && receipt && canonicalJson([old.absences,old.verdicts]) === canonicalJson([absences,verdicts])
89:       && old.ranges.length === ranges.length && ranges.every((r,i) => {
90:         const prior = old.ranges[i];
91:         return prior.identity === r.identity && canonicalJson([{ ...prior.value,prefix: logicalKey(prior.logical) }, [...prior.expected], [...prior.lost], prior.extent, prior.last])
92:           === canonicalJson([{ ...r.value,prefix: logicalKey(r.logical) }, [...r.expected], [...r.lost], r.extent, r.last]);
93:       })) {
94:       // Equal proof keeps its indexed owner/counts, but adopts the current immutable parameters.
95:       for (let i = 0; i < ranges.length; i++) { old.ranges[i].value = ranges[i].value; old.ranges[i].logical = ranges[i].logical; }
96:       return [];
97:     }
98:     if (!old && !receipt) return [];
99:     if (old) {
100:       for (const r of old.ranges) this.range(r, -1);
101:       for (const key of old.absences) { const refs = this.absences.get(key)!; refs.delete(owner); if (!refs.size) this.absences.delete(key); }
102:       for (const [key, result] of old.verdicts) this.verdictCount(key, result, -1);
103:       this.owners.delete(owner);
104:     }
105:     if (!receipt) return [old];
106:     const held = { ranges, absences, verdicts };
107:     for (const r of ranges) this.range(r, 1);
108:     for (const key of absences) {
109:       const refs = this.absences.get(key) ?? new Set();
110:       refs.add(owner); this.absences.set(key, refs);
111:     }
112:     for (const [key, result] of verdicts) this.verdictCount(key, result, 1);
113:     this.owners.set(owner, held);
114:     // Reuse the owners' compact identities; immediate directory refresh must see final counts.
115:     return [old, held];
116:   }
117:   authorityOwners(): Iterable<Pick<Owner, 'absences' | 'verdicts'>> { return this.owners.values(); }
118:   private verdictCount(key: string, result: boolean, delta: number): void {
119:     const counts: [number, number] = this.verdicts.get(key) ?? [0, 0]; counts[Number(result)] += delta;
120:     if (counts[0] || counts[1]) this.verdicts.set(key, counts); else this.verdicts.delete(key);
121:   }
122:   private count(map: Map<string, number>, key: string, delta: number): void {
123:     const count = (map.get(key) ?? 0) + delta;
124:     if (count) map.set(key, count); else map.delete(key);
125:   }
126:   private range(r: Range, delta: 1 | -1): void {
127:     let group = this.groups.get(r.group);
128:     if (!group) {
129:       const v = r.value, columns = components(this.schema, v.table, v.index).slice(0, v.prefix.length).map(c => 'Column' in c ? c.Column : '');
130:       group = { count: 0, spans: new CoverageSpans(v.order === 'Desc'), summary: JSON.stringify([v.table, v.rule_hash, columns.some(c => !c) ? v.index : columns, logicalKey(r.logical)]) };
131:       this.groups.set(r.group, group);
132:     }
133:     if (group.spans.complete) this.count(this.complete, group.summary, -1);
134:     if (r.extent) group.spans.change(...r.extent, delta, r.last);
135:     if (group.spans.complete) this.count(this.complete, group.summary, 1);
136:     group.count += delta; if (!group.count) this.groups.delete(r.group);
137:     for (const id of [...r.value.row_ids, ...(r.value.halo ? [r.value.halo.id] : [])]) {
138:       const key = JSON.stringify([r.value.table, id]), refs = this.rowRanges.get(key) ?? new Set();
139:       if (delta > 0) { refs.add(r); this.rowRanges.set(key, refs); }
140:       else { refs.delete(r); if (!refs.size) this.rowRanges.delete(key); }
141:     }
142:     if (delta > 0) this.quality(r);
143:     else if (r.exact) this.exactCount(r, -1);
144:   }
145:   private member(r: Range, id: string): void {
146:     const expected = r.expected.get(id), current = this.position(r.value, r.logical, id);
147:     if (!expected || !current || compareArrays(expected, current)) r.lost.add(id); else r.lost.delete(id);
148:   }
149:   private quality(r: Range): void {
150:     const exact = whole(r.value) && (r.value.stop === 'Exhausted' || r.lost.size <= (r.value.halo ? 1 : 0));
151:     if (exact !== r.exact) this.exactCount(r, exact ? 1 : -1);
152:     r.exact = exact;
153:   }
154:   private exactCount(r: Range, delta: number): void {
155:     const counts: [number, number] = this.exact.get(r.identity) ?? [0, 0];
156:     counts[0] += delta; if (r.value.stop === 'Exhausted') counts[1] += delta;
157:     if (counts[0]) this.exact.set(r.identity, counts); else this.exact.delete(r.identity);
158:   }
159:   changed(table: string, id: string): void {
160:     for (const r of this.rowRanges.get(JSON.stringify([table, id])) ?? []) { this.member(r, id); this.quality(r); }
161:   }
162:   hasAbsence(table: string, index: string, key: Value[]): boolean { return !!this.absences.get(pointKey(table, index, key))?.size; }
163:   verdict(rule: string, digest: string, viewer: string, epoch: number): boolean | null {
164:     const counts = this.verdicts.get(JSON.stringify([rule, digest, viewer, epoch]));
165:     // Updates maintain disagreement; warm reads never traverse retained owners.
166:     return !counts || counts[0] && counts[1] ? null : counts[1] > 0;
167:   }
168:   private exactCounts(range: TraceRange, logical: LogicalIndexAtom[]): [number, number] | undefined {
169:     const identity = JSON.stringify([range.site, range.table, range.index, logicalKey(logical), boundsKey(range)]);
170:     return this.exact.get(identity);
171:   }
172:   // @ref LLP 1001#3-read-and-write-states-no-silent-states — exact page values do not establish exhaustion beyond a retained halo.
173:   stop(range: TraceRange, logical: LogicalIndexAtom[]): TraceRange['stop'] {
174:     const counts = this.exactCounts(range, logical);
175:     return range.stop === 'exhausted' && counts?.[0] && !counts[1]
176:       && !this.drained(range.table, range.index, logical, range.rule_hash) ? 'limit' : range.stop;
177:   }
178:   covers(range: TraceRange, logical: LogicalIndexAtom[]): boolean {
179:     if (this.exactCounts(range, logical)?.[range.stop === 'exhausted' ? 1 : 0]) return true;
180:     return this.drained(range.table, range.index, logical, range.rule_hash);
181:   }
182:   drained(table: string, index: string, prefix: LogicalIndexAtom[], rule = scopedRuleHash(this.schema, this.schema.tables[table].rules.read)): boolean {
183:     const parts = components(this.schema, table, index);
184:     if (this.complete.has(JSON.stringify([table, rule, index, logicalKey(prefix)]))) return true;
185:     for (const columns of this.patterns.get(table) ?? []) {
186:       const values: LogicalIndexAtom[] = [];
187:       for (const column of columns) {
188:         const at = parts.findIndex(c => 'Column' in c && c.Column === column);
189:         if (at < 0 || at >= prefix.length) break;
190:         values.push(prefix[at]);
191:       }
192:       if (values.length === columns.length && this.complete.has(JSON.stringify([table, rule, columns, logicalKey(values)]))) return true;
193:     }
194:     return false;
195:   }
196: }
```

## snapback2/packages/evaluator/src/range-preparation.ts

```text
1: // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — one immutable typed range meaning, with source spelling kept at the boundary.
2: import { canonicalJson, clone, columnDescriptor, valueFromWire, rangeSchemaIdentity, type WireRefusal } from './value-runtime';
3: import { components, indexTuple, preparePrefix, prepareScanBounds } from './index-store';
4: import type { IndexAtom, IndexComponent, LogicalIndexAtom } from './search-key';
5: import type { ReceiptRange, Value } from './types';
6: import { EvalError } from './errors';
7: import { SearchExecution } from './search-runtime';
8: import { immutable } from './row-image';
9: 
10: type ScanSite = { table: string; index: string; bounds: (number | undefined)[]; shape: boolean[]; identity: string };
11: const sites = new WeakMap<object, Map<string, ScanSite>>();
12: const admissions = new WeakMap<object, SearchExecution>();
13: export function scanBounds(program: any): Map<string, ScanSite> {
14:   if (!program || typeof program !== 'object') return new Map();
15:   const cached = sites.get(program); if (cached) return cached;
16:   const result = new Map<string, ScanSite>();
17:   const visit = (value: any): void => {
18:     if (!value || typeof value !== 'object') return;
19:     if (Array.isArray(value.prefix) && typeof value.site === 'string') {
20:       const site = { table: value.table, index: value.index,
21:         bounds: value.prefix.map((p: any) => p.WordPrefix?.source_max),
22:         shape: value.prefix.map((p: any) => Object.hasOwn(p, 'WordPrefix')),
23:         identity: canonicalJson(value) };
24:       const prior = result.get(value.site);
25:       if (prior && prior.identity !== site.identity) throw new EvalError('E_TRACE_SUBSET', 'ambiguous issuing scan site');
26:       result.set(value.site, site);
27:     }
28:     for (const child of Object.values(value)) visit(child);
29:   };
30:   visit(program); sites.set(program, result); return result;
31: }
32: /** A delivered descriptor borrows Q only from its exact issuing scan and derived slot. */
33: export function prepareRange(schema: any, range: Pick<ReceiptRange, 'site' | 'table' | 'index' | 'prefix'>,
34:   program?: any, search?: SearchExecution): LogicalIndexAtom[] {
35:   const site = scanBounds(program).get(range.site);
36:   const derived = range.prefix.some(a => 'WordPrefix' in a);
37:   if (derived && (!site || (site.table !== range.table || site.index !== range.index
38:     || site.shape.length !== range.prefix.length || site.shape.some((word, i) => word !== ('WordPrefix' in range.prefix[i])))))
39:     throw new EvalError('E_INPUT', 'range does not match its trusted issuing scan');
40:   if (!search && program && typeof program === 'object') {
41:     search = admissions.get(program);
42:     if (!search) { search = new SearchExecution(() => {}, 64); admissions.set(program, search); }
43:   }
44:   return preparePrefix(schema, range.table, range.index, range.prefix, site?.bounds ?? [], search?.atom);
45: }
46: 
47: export const preparedDeliveryRanges = Symbol();
48: export const boundNames = ['after','before','gt','gte','lt','lte'] as const;
49: type BoundName = typeof boundNames[number];
50: type Parameters = Pick<ReceiptRange, 'site'|'table'|'index'|'prefix'|'order'|'take'|'rule_hash'|BoundName>;
51: export interface RangeMeaning {
52:   site: string; ruleHash: string; table: string; index: string; prefix: LogicalIndexAtom[]; order: 'Asc'|'Desc';
53:   after: Value[] | null; before: Value[] | null; gt: Value[] | null; gte: Value[] | null; lt: Value[] | null; lte: Value[] | null;
54: }
55: /** Identity only; shape checks remain at their existing field/typed admission phases. */
56: export { rangeSchemaIdentity } from './value-runtime';
57: const issuing = (range: Pick<ReceiptRange,'site'|'table'|'index'|'prefix'>, program?: any): string | undefined =>
58:   range.prefix.some(a => 'WordPrefix' in a) ? scanBounds(program).get(range.site)?.identity : undefined;
59: 
60: /** Contains no membership, row pool, authority, callbacks, or owner backlink. */
61: export class PreparedRange {
62:   private constructor(readonly value: Parameters, readonly meaning: RangeMeaning,
63:     readonly parts: IndexComponent[], readonly columns: IndexComponent[], readonly suffix: IndexComponent[],
64:     private readonly schema: string, private readonly site: string | undefined) { immutable(this); }
65:   static finish(schema: any, value: Parameters, logical: LogicalIndexAtom[], program: any, identity: string): PreparedRange {
66:     const parts = components(schema,value.table,value.index);
67:     const bounds = prepareScanBounds(schema,value.table,parts,{ ...value,
68:       range: Object.fromEntries(boundNames.slice(2).map(name => [name,value[name]])) });
69:     const ownedParts = clone(parts);
70:     value.prefix = value.prefix.map((atom,i) => 'Scalar' in atom ? logical[i] as IndexAtom : atom);
71:     return new PreparedRange(value,{ site: value.site,ruleHash: value.rule_hash,table: value.table,index: value.index,
72:       prefix: logical,order: value.order,gt: null,gte: null,lt: null,lte: null,...bounds },
73:       ownedParts,ownedParts.filter(c => 'Column' in c),ownedParts.slice(value.prefix.length),identity,issuing(value,program));
74:   }
75:   static tagged(schema: any, range: ReceiptRange, program?: any, identity = rangeSchemaIdentity(schema)): { value: ReceiptRange; prepared: PreparedRange } {
76:     const held = RangeReceipt.get(range,false);
77:     if (held && held.matches(schema,program,identity)) { held.held(schema,range.held_suffix); return { value: range,prepared: held }; }
78:     const value = clone(range), logical = prepareRange(schema,value,program);
79:     const fields = Object.fromEntries(['site','table','index','prefix','order','take','rule_hash',...boundNames].map(name => [name,(value as any)[name]])) as Parameters;
80:     const prepared = PreparedRange.finish(schema,fields,logical,program,identity);
81:     prepared.held(schema,value.held_suffix);
82:     return { value: RangeReceipt.own(value,prepared,false) as unknown as ReceiptRange,prepared };
83:   }
84:   matches(_schema: any, program: any, identity: string): boolean {
85:     return this.schema === identity && this.site === issuing(this.value,program)
86:       && (!this.value.prefix.some(a => 'WordPrefix' in a) || this.site !== undefined);
87:   }
88:   held(schema: any, value?: Value[]): void {
89:     if (value !== undefined && !(this.suffix.length === 0 && Array.isArray(value) && !value.length))
90:       indexTuple(schema,this.value.table,this.suffix,{ Array: value });
91:   }
92:   position(schema: any, values: Value[]): Value[] {
93:     return indexTuple(schema,this.value.table,this.columns,{ Array: values })!;
94:   }
95: }
96: 
97: /** Nominal owner leaf: generic JSON persists only its original enumerable fields. */
98: const receiptState = new WeakMap<object,{ prepared: PreparedRange; wire: boolean }>();
99: export class RangeReceipt {
100:   declare private readonly receiptBrand: void;
101:   private constructor(value: object, prepared: PreparedRange, wire: boolean) {
102:     for (const [key,child] of Object.entries(value)) Object.defineProperty(this,key,{ value: child,enumerable: true });
103:     receiptState.set(this,{ prepared,wire });
104:     Object.setPrototypeOf(this,Object.prototype); immutable(this);
105:   }
106:   static is(value: unknown): value is RangeReceipt { return !!value && typeof value === 'object' && receiptState.has(value); }
107:   static get(value: unknown, wire: boolean): PreparedRange | undefined {
108:     if (!value || typeof value !== 'object') return undefined;
109:     const state = receiptState.get(value);
110:     return state?.wire === wire ? state.prepared : undefined;
111:   }
112:   /** The caller owns the copied DTO; the prepared parameter object itself is immutable. */
113:   static own<T extends object>(value: T, prepared: PreparedRange, wire: boolean): T {
114:     return new RangeReceipt(value,prepared,wire) as unknown as T;
115:   }
116:   static change<T extends object>(value: T, changes: Partial<T>): T {
117:     const held = receiptState.get(value);
118:     const allowed = ['rowIds','row_ids','haloId','halo','evictedIds','evicted_ids','heldSuffix','held_suffix'];
119:     if (Object.keys(changes).some(key => !allowed.includes(key))) throw new TypeError('range parameter changes require admission');
120:     const next = { ...value,...clone(changes) };
121:     for (const key of Object.keys(changes)) if ((changes as any)[key] === undefined) delete (next as any)[key];
122:     return held ? new RangeReceipt(next,held.prepared,held.wire) as unknown as T : next;
123:   }
124:   static tagged(range: any, prepared: PreparedRange): ReceiptRange {
125:     const value: ReceiptRange = { ...prepared.value,row_ids: range.rowIds,stop: range.stop,absence: range.absence,
126:       halo: range.haloId === undefined ? null : { table: range.table,id: range.haloId },n2_suffix: null,
127:       ...(range.heldSuffix === undefined ? {} : { held_suffix: range.heldSuffix }),
128:       ...(range.evictedIds === undefined ? {} : { evicted_ids: range.evictedIds }) };
129:     return new RangeReceipt(value,prepared,false) as unknown as ReceiptRange;
130:   }
131: }
132: 
133: export function wireIndexValues(schema: any, table: string, index: string, values: unknown[], offset: number, fail: WireRefusal): Value[] {
134:   const parts = components(schema,table,index);
135:   return values.map((value,at) => {
136:     const part = parts[offset+at], name = part && ('Column' in part ? part.Column : '');
137:     if (name === undefined) fail(`schema.tables.${table}.indexes.${index}`,'has too few columns');
138:     return valueFromWire(columnDescriptor(schema,table,name),value,`${table}.${index}[${offset+at}]`,fail,schema);
139:   });
140: }
141: export function wireBoundary(schema: any, range: { table: string; index: string; prefix: unknown[] }, value: unknown, fail: WireRefusal): Value | null {
142:   if (value === null) return null;
143:   const values = wireIndexValues(schema,range.table,range.index,Array.isArray(value) ? value : [value],range.prefix.length,fail);
144:   return Array.isArray(value) ? { Array: values } : values[0];
145: }
146: /** Field parsing stays outside schema admission; neither path grants an unbound derived Q. */
147: export function wireRangePrefix(schema: any, range: any, program: any, fail: WireRefusal,
148:   atomShape: (value: unknown,path: string) => void): { atoms: IndexAtom[]; logical: LogicalIndexAtom[] } {
149:   const parts = components(schema,range.table,range.index);
150:   const atoms: IndexAtom[] = range.prefix.map((atom: any,i: number) => {
151:     atomShape(atom,'range.prefix');
152:     const part = parts[i];
153:     if (!part) fail('range.prefix','too many components');
154:     if ('Column' in part && 'Scalar' in atom) return { Scalar: valueFromWire(columnDescriptor(schema,range.table,part.Column),atom.Scalar,'range.prefix',fail,schema) };
155:     if ('WordPrefixes' in part && 'WordPrefix' in atom) return clone(atom);
156:     return fail('range.prefix','atom does not match its component');
157:   });
158:   return { atoms,logical: prepareRange(schema,{ ...range,prefix: atoms },program) };
159: }
160: /** All input fields are tagged before full-bound validation, exactly like the public receipt boundary. */
161: export function prepareWireRanges<T extends object>(schema: any, ranges: T[], program: any, fail: WireRefusal,
162:   atomShape: (value: unknown,path: string) => void, missingBounds = false, identity = rangeSchemaIdentity(schema)): T[] {
163:   const drafts = ranges.map((input: any) => {
164:     const held = RangeReceipt.get(input,true);
165:     if (held?.matches(schema,program,identity)) { held.held(schema,input.heldSuffix); return { input,held }; }
166:     const { atoms,logical } = wireRangePrefix(schema,input,program,fail,atomShape);
167:     const value: Parameters = { site: input.site,table: input.table,index: input.index,prefix: atoms,order: input.order,take: input.take,
168:       ...Object.fromEntries(boundNames.map(name => [name,wireBoundary(schema,input,missingBounds ? input[name] ?? null : input[name],fail)])),rule_hash: input.ruleHash } as Parameters;
169:     return { input,value,logical };
170:   });
171:   return drafts.map(draft => {
172:     if (draft.held) return draft.input;
173:     const prepared = PreparedRange.finish(schema,draft.value!,draft.logical!,program,identity);
174:     prepared.held(schema,draft.input.heldSuffix);
175:     return RangeReceipt.own(clone(draft.input),prepared,true);
176:   });
177: }
```

## snapback2/packages/evaluator/src/search-key.ts

```text
1: // Preparatory R2 contracts, not accepted by the current authoring/schema/IR surface.
2: // Wire descriptors carry source spellings; use only the prepared comparison API for key meaning.
3: // @ref LLP 1001#unicode-search-foundation — source descriptors compare by normalized meaning, with independent Q.
4: import type { Value } from './types';
5: import type { Expr } from '../../compiler/src/ir';
6: import { plainObject, totalCompare } from './value-runtime';
7: import { utf8Length } from './hash';
8: import { SEARCH_CONTRACT, type SearchContract, SearchInputError, SearchNormalizer, scalarLength, searchQueryToken } from './unicode';
9: export { SEARCH_CONTRACT, type SearchContract } from './unicode';
10: 
11: export type IndexComponent = { Column: string } | { WordPrefixes: { fields: string[]; contract: SearchContract } };
12: export type IndexKeyExpr<E = Expr> = { Scalar: E } | { WordPrefix: { source: E; contract: SearchContract; source_max: number } };
13: export interface WordPrefix { contract: SearchContract; source: string }
14: export type IndexAtom = { Scalar: Value } | { WordPrefix: WordPrefix };
15: 
16: /** Execution-local only; never persisted in place of the source descriptor. */
17: export class NormalizedWordPrefix {
18:   private constructor(readonly token: string | null) { Object.freeze(this); }
19:   static fromSource(source: string, sourceMax: number, normalizer: SearchNormalizer): NormalizedWordPrefix {
20:     return new NormalizedWordPrefix(searchQueryToken(source, sourceMax, normalizer));
21:   }
22:   get empty(): boolean { return this.token === null; }
23:   /** `word` must already be a token from the pinned normalizer. Empty search matches nothing. */
24:   matchesNormalizedWord(word: string): boolean { return this.token !== null && word.startsWith(this.token); }
25: }
26: export type LogicalIndexAtom = { Scalar: Value } | { WordPrefix: NormalizedWordPrefix };
27: 
28: function exact(value: unknown, keys: string[]): value is Record<string, any> {
29:   if (!plainObject(value)) return false;
30:   const actual = Object.keys(value);
31:   return actual.length === keys.length && keys.every(k => Object.hasOwn(value, k));
32: }
33: function scalar(value: unknown): value is Value {
34:   if (value === 'Null') return true;
35:   if (!plainObject(value)) return false;
36:   for (const tag of ['Bool', 'Int', 'String', 'Id', 'Bytes']) {
37:     if (!exact(value, [tag])) continue;
38:     const data = value[tag];
39:     if (tag === 'Bool') return typeof data === 'boolean';
40:     if (tag === 'Int') return Number.isSafeInteger(data);
41:     if (typeof data !== 'string') return false;
42:     if (tag === 'Bytes') return /^(?:[0-9a-f]{2})*$/.test(data);
43:     scalarLength(data, 0x3fffffff);
44:     return true;
45:   }
46:   return false;
47: }
48: 
49: /** Q is supplied by the issuing certificate, independently of indexed field maxima.
50:  * The downstream slot validator still checks ordinary ColumnType/optionality and index shape. */
51: export function prepareIndexAtom(
52:   component: IndexComponent, atom: unknown, sourceMax?: number, normalizer = new SearchNormalizer(),
53: ): LogicalIndexAtom {
54:   if ('Column' in component && exact(atom, ['Scalar']) && scalar(atom.Scalar)) {
55:     const value = atom.Scalar;
56:     return { Scalar: value === 'Null' ? value : Object.freeze({ ...value }) };
57:   }
58:   if ('WordPrefixes' in component && exact(atom, ['WordPrefix']) && exact(atom.WordPrefix, ['contract', 'source'])) {
59:     const prefix = atom.WordPrefix;
60:     if (prefix.contract !== SEARCH_CONTRACT || prefix.contract !== component.WordPrefixes.contract) throw new SearchInputError('unknown search contract');
61:     if (sourceMax === undefined) throw new SearchInputError('search source bound must come from the issuing operation');
62:     return { WordPrefix: NormalizedWordPrefix.fromSource(prefix.source, sourceMax, normalizer) };
63:   }
64:   throw new SearchInputError('index atom does not match its declared component');
65: }
66: export function decodeIndexAtom(json: string, component: IndexComponent, sourceMax?: number, normalizer = new SearchNormalizer()): { atom: IndexAtom; logical: LogicalIndexAtom } {
67:   if ('WordPrefixes' in component) {
68:     if (sourceMax === undefined) throw new SearchInputError('search source bound must come from the issuing operation');
69:     if (utf8Length(json) > wordPrefixWireMax(sourceMax)) throw new SearchInputError('index atom exceeds its declared byte bound');
70:   }
71:   let atom: unknown;
72:   try { atom = JSON.parse(json); } catch { throw new SearchInputError('invalid index atom descriptor'); }
73:   const logical = prepareIndexAtom(component, atom, sourceMax, normalizer);
74:   const value = atom as IndexAtom;
75:   const canonical = 'WordPrefix' in value ? { WordPrefix: { contract: value.WordPrefix.contract, source: value.WordPrefix.source } } : value;
76:   // Existing cursor convention: decode/re-encode, including duplicate-field refusal.
77:   if (JSON.stringify(canonical) !== json) throw new SearchInputError('index atom is not canonical tagged JSON');
78:   return { atom: canonical, logical };
79: }
80: export function wordPrefixWireMax(sourceMax: number): number {
81:   scalarLength('', sourceMax);
82:   return 4 * sourceMax + 63;
83: }
84: export function indexAtomsEqual(a: LogicalIndexAtom, b: LogicalIndexAtom): boolean {
85:   if ('Scalar' in a && 'Scalar' in b) return totalCompare(a.Scalar, b.Scalar) === 0;
86:   return 'WordPrefix' in a && 'WordPrefix' in b && a.WordPrefix.token === b.WordPrefix.token;
87: }
88: export function indexKeysEqual(a: readonly LogicalIndexAtom[], b: readonly LogicalIndexAtom[]): boolean {
89:   return a.length === b.length && indexKeyStartsWith(a, b);
90: }
91: /** Tuple containment: `ca` does not cover `cat`; every occupied slot compares by whole meaning. */
92: export function indexKeyStartsWith(key: readonly LogicalIndexAtom[], prefix: readonly LogicalIndexAtom[]): boolean {
93:   return key.length >= prefix.length && prefix.every((atom, i) => indexAtomsEqual(key[i], atom));
94: }
95: export function compareScalarAtoms(a: LogicalIndexAtom, b: LogicalIndexAtom): number {
96:   if ('Scalar' in a && 'Scalar' in b) return totalCompare(a.Scalar, b.Scalar);
97:   throw new SearchInputError('word-prefix atoms admit equality only');
98: }
```

## snapback2/packages/evaluator/src/value-runtime.ts

```text
1: import { compareCodepoints } from './hash';
2: export { compareCodepoints } from './hash';
3: import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };
4: import { canonicalRuleJson, canonicalSchemaJson } from "./certificate-identity";
5: import { fail, EvalError } from "./errors";
6: import { sha256, utf8Length } from "./hash";
7: import { cursorSuffix, decodeCursor, decodeCursorFor } from "./cursor";
8: import { scalarLength } from "./unicode";
9: import type { TraceRange, Value } from "./types";
10: import { immutable, RowImage } from "./row-image";
11: 
12: const preparedSchemas = new WeakMap<object,{ hash: string; rules: Map<unknown,string>; rangeHash?: string }>();
13: 
14: // @ref LLP 1012#6-reads-offline — only this isolated, deeply immutable schema
15: // custody may reuse canonical schema/rule bytes across fresh Runner executions.
16: export function prepareSchema(schema: any, expected: string): any {
17:   const owned = immutable(structuredClone(schema));
18:   if (schemaDigest(owned) !== expected) return;
19:   const rules = new Map<unknown,string>();
20:   for (const table of Object.values<any>(owned.tables)) for (const rule of Object.values(table.rules ?? {}))
21:     rules.set(rule,sha256(`[${JSON.stringify(expected)},${canonicalRuleJson(rule)}]`));
22:   return preparedSchemas.set(owned,{ hash: expected,rules }),owned;
23: }
24: 
25: // @ref LLP 1018.008.004#implementation-selection-2026-09-10 — reuse only
26: // validated immutable custody, never a mutable caller's claimed identity.
27: export function schemaDigest(schema: any): string {
28:   return preparedSchemas.get(schema)?.hash ?? sha256(canonicalSchemaJson(schema));
29: }
30: 
31: // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — retain the exact range identity only in existing validated immutable schema custody.
32: export function rangeSchemaIdentity(schema: any): string {
33:   const owned = preparedSchemas.get(schema);
34:   return owned ? owned.rangeHash ??= sha256(canonicalJson(schema)) : sha256(canonicalJson(schema));
35: }
36: 
37: export function canonicalValue(value: Value): string {
38:   if (value === "Null") return '"Null"';
39:   const kind = kindOf(value);
40:   const data = (value as any)[kind];
41:   if (kind === "Bytes" && !canonicalBytes(data)) fail("E_INPUT", "Bytes is not canonical lowercase base16");
42:   if (kind === "Bool" || kind === "Int" || kind === "String" || kind === "Id" || kind === "Bytes") return `{"${kind}":${JSON.stringify(data)}}`;
43:   if (kind === "Array") return `{"Array":${canonicalValues(data)}}`;
44:   const entries = Object.keys(data)
45:     .sort(compareCodepoints)
46:     .map((key) => `${JSON.stringify(key)}:${canonicalValue(data[key])}`)
47:     .join(",");
48:   return `{"${kind}":{${entries}}}`;
49: }
50: 
51: export function canonicalValues(values: Value[]): string {
52:   return `[${values.map(canonicalValue).join(",")}]`;
53: }
54: 
55: export function rangeStops(ranges: TraceRange[]): Record<string, string[]> {
56:   const result: Record<string, string[]> = Object.create(null);
57:   for (const range of ranges) (result[range.site] ??= []).push(range.stop);
58:   return sortObject(result);
59: }
60: 
61: // @ref LLP 1001#2-what-a-commit-records — omitted Optional fields are Null before rules and maintains.
62: export function materializeOptionalFields(schema: any, tableName: string, value: Value): Value {
63:   if (!isVariant(value, "Row")) return clone(value);
64:   const entries: Record<string, Value> = Object.assign(Object.create(null), value.Row);
65:   for (const [name, descriptor] of Object.entries<any>(
66:     schema.tables?.[tableName]?.columns ?? {},
67:   )) {
68:     if (descriptor?.Optional !== undefined && !hasOwn(entries, name)) {
69:       entries[name] = "Null";
70:     }
71:   }
72:   return rowValue(entries);
73: }
74: 
75: export function rowValue(entries: Record<string, Value>): Value {
76:   const sorted: Record<string, Value> = Object.create(null);
77:   for (const key of Object.keys(entries).sort(compareCodepoints)) sorted[key] = clone(entries[key]);
78:   return { Row: sorted };
79: }
80: 
81: export function field(value: Value, name: string): Value {
82:   const object = asObject(value);
83:   if (!hasOwn(object, name)) fail("E_FIELD", `missing field ${name}`);
84:   return object[name];
85: }
86: 
87: export function fieldOrNull(value: Value, name: string): Value {
88:   const object = asObject(value);
89:   return hasOwn(object, name) ? object[name] : "Null";
90: }
91: 
92: export function asObject(value: Value): Record<string, Value> {
93:   if (isVariant(value, "Row")) return value.Row;
94:   if (isVariant(value, "Map")) return value.Map;
95:   fail("E_TYPE", "expected row or map");
96: }
97: 
98: export function asArray(value: Value): Value[] {
99:   if (!isVariant(value, "Array")) fail("E_TYPE", "expected array");
100:   return value.Array;
101: }
102: 
103: export function asString(value: Value): string {
104:   if (isVariant(value, "String")) return value.String;
105:   if (isVariant(value, "Id")) return value.Id;
106:   fail("E_TYPE", "expected string or id");
107: }
108: 
109: export function asInt(value: Value): number {
110:   if (!isVariant(value, "Int")) fail("E_TYPE", "expected int");
111:   return value.Int;
112: }
113: 
114: export function asBool(value: Value): boolean {
115:   if (!isVariant(value, "Bool")) fail("E_TYPE", "expected bool");
116:   return value.Bool;
117: }
118: 
119: export function int(value: number): Value {
120:   return { Int: safeNumber(value) };
121: }
122: 
123: export function safeNumber(value: number): number {
124:   if (!Number.isSafeInteger(value))
125:     fail("E_OVERFLOW", `${value} is outside the i53 value model`);
126:   return value;
127: }
128: 
129: export function totalCompare(left: Value, right: Value): number {
130:   const leftKind = kindOf(left);
131:   const rightKind = kindOf(right);
132:   if (leftKind !== rightKind) {
133:     const order = ["Null", "Bool", "Int", "String", "Id", "Bytes", "Row", "Array", "Map"];
134:     const tag = order.indexOf(leftKind) - order.indexOf(rightKind);
135:     if (tag !== 0) return Math.sign(tag);
136:   }
137:   if (leftKind === "Null") return 0;
138:   const leftData = (left as any)[leftKind];
139:   const rightData = (right as any)[rightKind];
140:   if (leftKind === "Bool" || leftKind === "Int") return comparePrimitive(leftData, rightData);
141:   if (leftKind === "Bytes" && (!canonicalBytes(leftData) || !canonicalBytes(rightData)))
142:     fail("E_INPUT", "Bytes is not canonical lowercase base16");
143:   if (leftKind === "String" || leftKind === "Id" || leftKind === "Bytes") return compareCodepoints(leftData, rightData);
144:   if (leftKind === "Array") return compareArrays(leftData, rightData);
145:   const leftEntries = Object.keys(leftData).sort(compareCodepoints);
146:   const rightEntries = Object.keys(rightData).sort(compareCodepoints);
147:   const length = comparePrimitive(leftEntries.length, rightEntries.length);
148:   if (length) return length;
149:   for (let index = 0; index < leftEntries.length; index += 1) {
150:     const key = compareCodepoints(leftEntries[index], rightEntries[index]);
151:     if (key) return key;
152:     const value = totalCompare(leftData[leftEntries[index]], rightData[rightEntries[index]]);
153:     if (value) return value;
154:   }
155:   return 0;
156: }
157: 
158: export function compareArrays(left: Value[], right: Value[]): number {
159:   const length = Math.min(left.length, right.length);
160:   for (let index = 0; index < length; index += 1) {
161:     const compared = totalCompare(left[index], right[index]);
162:     if (compared) return compared;
163:   }
164:   return comparePrimitive(left.length, right.length);
165: }
166: 
167: export function comparePrimitive(left: number | boolean | string, right: number | boolean | string): number {
168:   return left < right ? -1 : left > right ? 1 : 0;
169: }
170: 
171: export function variant(value: any): [string, any] {
172:   if (typeof value === "string") return [value, null];
173:   const keys = Object.keys(value);
174:   if (keys.length !== 1) fail("E_CORPUS", "invalid externally tagged variant");
175:   return [keys[0], value[keys[0]]];
176: }
177: 
178: /** The wire encoding of an IR value — ids and text as strings, integers as
179:  * numbers, null as null, bytes as `{ Bytes: hex }`, rows and maps as objects,
180:  * arrays as arrays — the form the delivery envelope carries
181:  * (`offline.rs` `value_to_wire_json`). Verdict inputs are digested in it. */
182: export function wireJson(value: Value): unknown {
183:   const [kind, data] = variant(value);
184:   switch (kind) {
185:     case "Null": return null;
186:     case "Bool": case "Int": case "String": case "Id": return data;
187:     case "Bytes": return { Bytes: data };
188:     case "Row": case "Map":
189:       return Object.fromEntries(Object.keys(data).sort(compareCodepoints).map((key) => [key, wireJson(data[key])]));
190:     case "Array": return data.map(wireJson);
191:     default: fail("E_INPUT", `unsupported value kind ${kind}`);
192:   }
193: }
194: 
195: /** The digest a replay trace carries for a point read: SHA-256 over the canonical
196:  * wire row, exactly `snapback2-core`'s `row_digest` (`offline.rs`). */
197: export function rowDigest(row: Value): string {
198:   return sha256(JSON.stringify(wireJson(row)));
199: }
200: 
201: /** `Schema::rule_hash`: the schema hash beside the rule in serde's field order. */
202: export function scopedRuleHash(schema: any, rule: any): string {
203:   return preparedSchemas.get(schema)?.rules.get(rule) ?? sha256(`[${JSON.stringify(schemaDigest(schema))},${canonicalRuleJson(rule)}]`);
204: }
205: 
206: export function kindOf(value: Value): string {
207:   if (value === "Null") return "Null";
208:   const keys = Object.keys(value);
209:   if (keys.length !== 1) fail("E_INPUT", "invalid externally tagged value");
210:   return keys[0];
211: }
212: 
213: export function isVariant<K extends Exclude<ReturnType<typeof kindOf>, "Null">>(
214:   value: Value,
215:   kind: K,
216: ): value is Extract<Value, Record<K, unknown>> {
217:   return value !== "Null" && kindOf(value) === kind;
218: }
219: 
220: export function valuesEqual(left: Value[], right: Value[]): boolean {
221:   return canonicalValues(left) === canonicalValues(right);
222: }
223: 
224: export function sameValueZero(left: Value, right: Value): boolean {
225:   // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Keep the client twin on the compiler's primitive collection identity contract.
226:   const leftKind = kindOf(left);
227:   const rightKind = kindOf(right);
228:   for (const kind of [leftKind, rightKind]) {
229:     if (["Bytes", "Row", "Array", "Map"].includes(kind)) {
230:       fail("E_TYPE", `SameValueZero expects primitive operands, got ${kind}`);
231:     }
232:   }
233:   if ((leftKind === "String" || leftKind === "Id") && (rightKind === "String" || rightKind === "Id")) {
234:     return asString(left) === asString(right);
235:   }
236:   return canonicalValue(left) === canonicalValue(right);
237: }
238: 
239: export function startsWith<T>(values: T[], prefix: T[]): boolean {
240:   return prefix.every((value, index) => values[index] === value);
241: }
242: 
243: export function validHttpUrl(value: string): boolean {
244:   const rest = value.startsWith("https://")
245:     ? value.slice("https://".length)
246:     : value.startsWith("http://")
247:       ? value.slice("http://".length)
248:       : "";
249:   return rest.length > 0 && !/[\p{White_Space}\p{Cc}]/u.test(rest);
250: }
251: 
252: export function canonicalJson(value: unknown): string {
253:   if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
254:   if (plainObject(value)) {
255:     return `{${Object.keys(value)
256:       .sort(compareCodepoints)
257:       .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
258:       .join(",")}}`;
259:   }
260:   return JSON.stringify(value);
261: }
262: 
263: export function validateWriteRow(schema: any, tableName: string, row: Value): void {
264:   const columns = schema.tables?.[tableName]?.columns;
265:   if (columns === undefined) fail("E_SCHEMA", `missing table ${tableName}`);
266:   const object = asObject(row);
267:   if (!hasOwn(object, "id")) fail("E_SCHEMA", `${tableName} row lacks id`);
268:   const unknown = Object.keys(object).find((name) => !hasOwn(columns, name));
269:   if (unknown !== undefined)
270:     fail("E_INPUT", `${tableName} row contains undeclared field ${unknown}`);
271:   for (const [name, descriptor] of Object.entries<any>(columns)) {
272:     const value = hasOwn(object, name) ? object[name] : undefined;
273:     if (value === undefined && descriptor?.Optional === undefined)
274:       fail("E_INPUT", `${tableName}.${name} is required`);
275:     if (value !== undefined) validateColumnValue(schema, tableName, name, value);
276:   }
277:   const id = object.id;
278:   if (isVariant(id, 'Id') && !identityFits(id.Id)) {
279:     const maintain = schema.maintains.find((m: any) => m.target === tableName);
280:     if (canonicalValues(maintain.by.map((name: string) => fieldOrNull(row, name))) !== id.Id)
281:       fail('E_INPUT', `${tableName}.id differs from its maintained group`);
282:   }
283: }
284: 
285: export function validateInputs(schema: any, program: any, inputs: Record<string, Value>): void {
286:   for (const [name, descriptor] of Object.entries<any>(program.args ?? {})) {
287:     const value = inputs[name];
288:     if (value === undefined) fail("E_INPUT", `missing arg ${name}`);
289:     validateTypedValue(descriptor, value, `arg ${name}`, true, false, schema);
290:   }
291: }
292: 
293: /** Cursor scope follows executed control flow, including an empty merge. */
294: export function validateScanCursor(schema: any, scan: any, bindings: Map<string, Value>): void {
295:   if (!scan.opaque_cursor) return;
296:   if (scan.before !== null) fail("E_INPUT", "opaque cursors only support after");
297:   const cursor = scan.after?.Variable !== undefined ? bindings.get(scan.after.Variable) : scan.after?.Literal;
298:   if (cursor === undefined) fail("E_INPUT", "opaque cursor expression must derive from an operation argument");
299:   if (cursor === "Null") return;
300:   if (!isVariant(cursor, "String")) fail("E_INPUT", "opaque cursor must be a string");
301:   decodeCursorFor(cursor.String, {
302:     table: scan.table, index: scan.index, order: scan.order, suffix: cursorSuffix(schema, scan),
303:   }, schema);
304: }
305: 
306: /** Intrinsic addresses belong to the table; references belong to their declared target. */
307: export function columnDescriptor(schema: any, table: string, column: string): any {
308:   const kind = schema?.tables?.[table]?.columns?.[column];
309:   if (kind === undefined) fail('E_SCHEMA', `missing column ${table}.${column}`);
310:   return column === 'id' && kind === 'Id' ? { Ref: { table } } : kind;
311: }
312: export function validateColumnValue(schema: any, table: string, column: string, value: Value, internalKey = false): void {
313:   validateTypedValue(columnDescriptor(schema, table, column), value, `${table}.${column}`, false, internalKey, schema);
314: }
315: 
316: export function validateTypedValue(
317:   descriptor: any,
318:   value: Value,
319:   label: string,
320:   fanoutForLongList: boolean,
321:   internalKey = false,
322:   schema?: any,
323: ): void {
324:   const reserved = inspectValue(value, label, descriptor, schema);
325:   if (!internalKey && reserved)
326:     fail("E_INPUT", `${label} cannot carry the reserved system principal`);
327:   validateType(descriptor, value, label, fanoutForLongList, descriptorContainsAsset(descriptor));
328: }
329: 
330: // The complete scalar/shape preflight precedes every type refusal. Recursive descriptors
331: // reuse it, including assets, rather than walking each nested value again.
332: function validateType(descriptor: any, value: Value, label: string, fanout: boolean, asset: boolean): string[] | void {
333:   if (descriptor?.Optional !== undefined) {
334:     return value === "Null" ? [] : validateType(descriptor.Optional, value, label, fanout, asset);
335:   }
336:   if (descriptor?.List !== undefined) {
337:     const refuse = (message: string, overflow = false): never => { throw asset ? assetType(label,message) : new EvalError(
338:       fanout && overflow ? 'E_FANOUT' : 'E_INPUT', `${label} ${message}`); };
339:     if (!isVariant(value, "Array")) return refuse("must be a list");
340:     if (value.Array.length > descriptor.List.max) refuse(`exceeds list max ${descriptor.List.max}`,true);
341:     const ids: string[] | undefined = asset ? [] : undefined;
342:     if (descriptor.List.of !== null && descriptor.List.of !== undefined) {
343:       value.Array.forEach((item, index) => {
344:         const child = validateType(descriptor.List.of, item, asset ? `${label}[${index}]` : label, fanout, asset);
345:         if (ids && child) for (const id of child) ids.push(id);
346:       });
347:     }
348:     if (ids) {
349:       const seen = new Set<string>(), duplicate = ids.find(id => seen.has(id) || !seen.add(id));
350:       if (duplicate !== undefined) throw assetType(label, `repeats asset id ${duplicate}; asset ids in a list must be unique`);
351:     }
352:     return ids;
353:   }
354:   if (asset) return validateAsset(descriptor,value,label);
355:   if (descriptor === "Cursor") {
356:     if (!isVariant(value, "String")) fail("E_INPUT", `${label} must be a cursor string`);
357:     decodeCursor(value.String);
358:     return;
359:   }
360:   if (descriptor === "Scalar") return;
361:   if (descriptor === "Id" || descriptor === "Principal" || descriptor?.Ref !== undefined) {
362:     if (!isVariant(value, "Id")) fail("E_INPUT", `${label} must be an id`);
363:     return;
364:   }
365:   if (descriptor?.Text !== undefined) {
366:     if (!isVariant(value, "String")) fail("E_INPUT", `${label} must be text`);
367:     const codePoint = disallowedTextControlCodePoint(value.String);
368:     if (codePoint !== undefined)
369:       fail("E_INPUT", `${label} contains disallowed control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
370:     const length = Array.from(value.String).length;
371:     if (length > descriptor.Text.max)
372:       fail("E_INPUT", `${label} exceeds text max ${descriptor.Text.max}`);
373:     // Argument refinements apply recursively before any program body executes; column Text is unchanged.
374:     if (fanout && length < (descriptor.Text.min ?? 0))
375:       fail("E_INPUT", `${label} is shorter than text min ${descriptor.Text.min}`);
376:     if (fanout && descriptor.Text.format !== undefined && !(descriptor.Text.format === 'handle'
377:       ? /^[a-z0-9_]*$/.test(value.String) : descriptor.Text.format === 'url' && validHttpUrl(value.String)))
378:       fail('E_INPUT', `${label} has invalid ${String(descriptor.Text.format)} format`);
379:     return;
380:   }
381:   if (descriptor?.Bytes !== undefined) {
382:     if (!isVariant(value, "Bytes") || !canonicalBytes(value.Bytes))
383:       fail("E_INPUT", `${label} must be bytes`);
384:     if (value.Bytes.length / 2 > descriptor.Bytes.max)
385:       fail("E_INPUT", `${label} exceeds bytes max ${descriptor.Bytes.max}`);
386:     return;
387:   }
388:   if (["Int", "Time"].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) {
389:     if (!isVariant(value, "Int") || !Number.isSafeInteger(value.Int))
390:       fail("E_INPUT", `${label} must be an i53 integer`);
391:     return;
392:   }
393:   if (descriptor === "Bool") {
394:     if (!isVariant(value, "Bool")) fail("E_INPUT", `${label} must be a boolean`);
395:     return;
396:   }
397:   if (descriptor?.Json !== undefined) {
398:     if (utf8Length(canonicalValue(value)) > descriptor.Json.max_bytes)
399:       fail("E_INPUT", `${label} exceeds JSON max ${descriptor.Json.max_bytes} bytes`);
400:     return;
401:   }
402:   if (descriptor?.Enum !== undefined) {
403:     if (!isVariant(value, "String") || !descriptor.Enum.variants.includes(value.String))
404:       fail("E_INPUT", `${label} is not a declared enum value`);
405:     return;
406:   }
407:   fail("E_SCHEMA", `unsupported type for ${label}`);
408: }
409: 
410: function disallowedTextControlCodePoint(text: string): number | undefined {
411:   for (const character of text) {
412:     const codePoint = character.codePointAt(0)!;
413:     if (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) return codePoint;
414:   }
415:   return undefined;
416: }
417: 
418: function descriptorContainsAsset(descriptor: any): boolean {
419:   if (descriptor?.Image !== undefined || descriptor?.Video !== undefined) return true;
420:   if (descriptor?.Optional !== undefined) return descriptorContainsAsset(descriptor.Optional);
421:   if (descriptor?.List?.of !== null && descriptor?.List?.of !== undefined)
422:     return descriptorContainsAsset(descriptor.List.of);
423:   return false;
424: }
425: 
426: // @ref LLP 1006#6-the-write-validated-not-stamped — the twin enforces the closed asset record and list uniqueness but owns no ledger authority.
427: function validateAsset(descriptor: any, value: Value, label: string): string[] {
428:   const kind = descriptor?.Image !== undefined ? "image" : descriptor?.Video !== undefined ? "video" : null;
429:   if (kind === null) fail("E_SCHEMA", `unsupported asset type for ${label}`);
430:   if (!isVariant(value, "Map")) throw assetType(label, `must be a closed ${kind} asset map`);
431:   const expected = kind === "image" ? ["height", "id", "width"] : ["duration", "height", "id", "width"];
432:   const actual = Object.keys(value.Map).sort(compareCodepoints);
433:   if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
434:     throw assetType(label, `must contain exactly ${expected.join(", ")}`);
435:   const idValue = value.Map.id;
436:   const id = isVariant(idValue, "String") ? idValue.String : "";
437:   if (!validEngineId(id)) throw assetType(`${label}.id`, "must be a minted s2id");
438:   for (const field of kind === "image" ? ["width", "height"] : ["width", "height", "duration"]) {
439:     const member = value.Map[field];
440:     if (!isVariant(member, "Int") || !Number.isSafeInteger(member.Int) || member.Int <= 0)
441:       throw assetType(`${label}.${field}`, "must be a positive i53 integer");
442:   }
443:   return [id];
444: }
445: 
446: function validEngineId(id: string): boolean {
447:   return /^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/.test(id) && !id.endsWith("-0000000000000000");
448: }
449: 
450: function assetType(path: string, message: string): EvalError {
451:   return Object.assign(new EvalError("E_ASSET_TYPE", `${path} ${message}`), { path });
452: }
453: 
454: export function assertValue(value: Value, label: string, descriptor?: any, schema?: any): void { inspectValue(value, label, descriptor, schema); }
455: 
456: /** Collect reserved identity while validating every child; a later shape error still wins. */
457: function inspectValue(value: Value, label: string, descriptor?: any, schema?: any): boolean {
458:   while (descriptor?.Optional !== undefined) descriptor = descriptor.Optional;
459:   if (value === "Null") return false;
460:   if (!plainObject(value) || Object.keys(value).length !== 1) fail("E_INPUT", `${label} is not a tagged value`);
461:   const kind = kindOf(value);
462:   const data = (value as any)[kind];
463:   if (kind === "Bool" && typeof data === "boolean" || kind === "Int" && Number.isSafeInteger(data)) return false;
464:   if ((kind === "String" || kind === "Id") && typeof data === "string") {
465:     if (kind === "Id") {
466:       if (schema && descriptor?.Ref) validateAddress(schema, descriptor.Ref.table, data);
467:       else validateIdentity(data);
468:     } else scalarText(data);
469:     return kind === "Id" && data === coreIrContract.systemPrincipalId;
470:   }
471:   if (kind === "Bytes" && canonicalBytes(data)) return false;
472:   let reserved = false;
473:   if (kind === "Array" && Array.isArray(data)) {
474:     for (const item of data) reserved = inspectValue(item, label, descriptor?.List?.of, schema) || reserved;
475:     return reserved;
476:   }
477:   if ((kind === "Row" || kind === "Map") && plainObject(data)) {
478:     for (const [key, item] of Object.entries(data)) { scalarText(key); reserved = inspectValue(item as Value, label) || reserved; }
479:     return reserved;
480:   }
481:   fail("E_INPUT", `${label} is not a valid value`);
482: }
483: 
484: export function canonicalBytes(value: unknown): value is string {
485:   return typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value);
486: }
487: 
488: export function hasOwn(value: object, key: PropertyKey): boolean {
489:   return Object.hasOwn(value, key);
490: }
491: 
492: export function plainObject(value: unknown): value is Record<string, any> {
493:   return value !== null && typeof value === "object" && !Array.isArray(value);
494: }
495: 
496: export function clone<T>(value: T): T {
497:   // @ref LLP 1018.003.000#3-shared-publication — immutable
498:   // row ownership survives expression aliases and nested point reads.
499:   if (value === null || typeof value !== "object" || RowImage.is(value)) return value;
500:   return (Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value)
501:     .filter(([, child]) => child !== undefined).map(([key, child]) => [key, clone(child)]))) as T;
502: }
503: 
504: export function sortObject<T>(value: Record<string, T>): Record<string, T> {
505:   const sorted: Record<string, T> = Object.create(null);
506:   for (const key of Object.keys(value).sort(compareCodepoints)) sorted[key] = value[key];
507:   return sorted;
508: }
509: 
510: export function builtinArity(kind: string): number {
511:   switch (kind) {
512:     case "Len": case "Sort":  case "MentionTokens": case "Count": case "CountCapped": case "Sum": return 1;
513:     case "Concat": case "Min": case "Max": case "Divmod": return 2;
514:     case "Slice": case "DeterministicShare": return 3;
515:     default: fail("E_OPAQUE", `unsupported builtin ${kind}`);
516:   }
517: }
518: 
519: export function valueText(value: Value): string {
520:   if (value === "Null") return "null";
521:   if (isVariant(value, "Bool")) return String(value.Bool);
522:   if (isVariant(value, "Int")) return String(value.Int);
523:   if (isVariant(value, "String")) return value.String;
524:   if (isVariant(value, "Id")) return value.Id;
525:   if (isVariant(value, "Bytes")) return value.Bytes;
526:   if (isVariant(value, "Array")) return value.Array.map(valueText).join(",");
527:   return "[object Object]";
528: }
529: 
530: export function isWordCharacter(character: string): boolean {
531:   return character === "_" || /[\p{L}\p{N}]/u.test(character);
532: }
533: 
534: // @ref LLP 1001#unicode-search-foundation — canonical tagged identity allowance is actual UTF-8, including escapes.
535: export function scalarText(text: string): void {
536:   try { scalarLength(text, text.length); } catch { fail("E_INPUT", "invalid Unicode scalar text"); }
537: }
538: export function validateIdentity(id: string): void {
539:   scalarText(id);
540:   if (!identityFits(id)) fail("E_INPUT", "identity exceeds 144 canonical bytes");
541: }
542: function identityFits(id: string): boolean { return utf8Length(JSON.stringify({ Id: id })) <= 144; }
543: 
544: // @ref LLP 1001#maintained-addresses — exact source-domain tuples, never a wider untyped Id allowance.
545: export function validateAddress(schema: any, table: string, id: string): void {
546:   scalarText(id);
547:   if (identityFits(id)) return;
548:   const invalid = (): never => { fail('E_INPUT', `${table}.id is not a canonical maintained group address`); };
549:   const maintain = schema.maintains?.find((m: any) => m.target === table);
550:   if (!maintain) return validateIdentity(id);
551:   let key: Value[];
552:   try { key = JSON.parse(id); } catch { return invalid(); }
553:   if (!Array.isArray(key) || key.length !== maintain.by.length) invalid();
554:   for (let i = 0; i < key.length; i++) {
555:     const name = maintain.by[i], kind = schema.tables[maintain.source].columns[name];
556:     // Group members follow their declared type; only an intrinsic row/index slot rewrites Id to its owning target.
557:     validateTypedValue(kind, key[i], `${maintain.source}.${name}`, false, false, schema);
558:   }
559:   if (canonicalValues(key) !== id) invalid();
560: }
561: 
562: /** Wire construction preserves input-field refusal order; row admission follows in schema order. */
563: export type WireRefusal = (path: string, detail: string) => never;
564: export function wireObject(value: any): value is Record<string, any> {
565:   return plainObject(value)
566:     && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
567: }
568: export function rowFromWire(schema: any, table: string, row: Record<string, unknown>, fail: WireRefusal): Value {
569:   const columns = schema?.tables?.[table]?.columns;
570:   if (!wireObject(columns)) fail(`schema.tables.${table}.columns`, 'is missing');
571:   const tagged: Record<string, Value> = Object.create(null);
572:   for (const [name,value] of Object.entries(row)) {
573:     if (!(name in columns)) fail(`rows.${table}.${name}`, 'is not a declared column');
574:     tagged[name] = valueFromWire(columnDescriptor(schema,table,name),value,`rows.${table}.${name}`,fail,schema);
575:   }
576:   return { Row: tagged };
577: }
578: 
579: export function valueFromWire(descriptor: any, value: any, path: string, fail: WireRefusal, schema?: any): Value {
580:   if (wireObject(descriptor) && "Optional" in descriptor) return value === null ? "Null" : valueFromWire(descriptor.Optional, value, path, fail, schema);
581:   if (value === null) return "Null";
582:   if (descriptor === "Id" || descriptor === "Principal" || wireObject(descriptor) && "Ref" in descriptor) {
583:     if (typeof value !== "string") fail(path, "expected id string");
584:     if (schema && descriptor?.Ref) validateAddress(schema, descriptor.Ref.table, value);
585:     else validateIdentity(value);
586:     return { Id: value };
587:   }
588:   if (wireObject(descriptor) && ("Text" in descriptor || "Enum" in descriptor)) {
589:     if (typeof value !== "string") fail(path, "expected text string");
590:     const tagged = { String: value };
591:     validateTypedValue(descriptor, tagged, path, false);
592:     return tagged;
593:   }
594:   if (["Int", "Time"].includes(String(descriptor)) || wireObject(descriptor) && ("Decimal" in descriptor || "Money" in descriptor)) {
595:     if (!Number.isSafeInteger(value)) fail(path, "expected safe integer"); return { Int: value as number };
596:   }
597:   if (descriptor === "Bool") { if (typeof value !== "boolean") fail(path, "expected boolean"); return { Bool: value as boolean }; }
598:   if (wireObject(descriptor) && "Bytes" in descriptor) {
599:     const bytes = wireObject(value) && "Bytes" in value ? value.Bytes : undefined;
600:     if (!wireObject(value) || Object.keys(value).length !== 1 || !canonicalBytes(bytes))
601:       fail(path, "expected canonical Bytes");
602:     return { Bytes: bytes };
603:   }
604:   if (wireObject(descriptor) && "List" in descriptor) {
605:     if (!Array.isArray(value)) fail(path, "expected array");
606:     return { Array: value.map((item: any, index: number) => valueFromWire(descriptor.List.of, item, `${path}[${index}]`, fail, schema)) };
607:   }
608:   if (wireObject(descriptor) && ("Image" in descriptor || "Video" in descriptor)) {
609:     const tagged = tagJson(value);
610:     try { validateTypedValue(descriptor, tagged, path, false); }
611:     catch (error) {
612:       // Preserve the public decoder's path-bearing TypeError while sharing evaluator asset validation.
613:       if (error instanceof EvalError && error.code === 'E_ASSET_TYPE') fail((error as any).path ?? path, error.message);
614:       throw error;
615:     }
616:     return tagged;
617:   }
618:   // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — tag by
619:   // the declared column type only: a `json` value shaped `{ "Bytes": "…" }` is
620:   // application data, never the byte variant (O1a review).
621:   if (wireObject(descriptor) && "Json" in descriptor) return tagJson(value);
622:   fail(path, "has an unsupported schema descriptor");
623: }
624: 
625: function tagJson(value: any): Value {
626:   if (value === null) return "Null";
627:   if (typeof value === "boolean") return { Bool: value };
628:   if (typeof value === "number") return { Int: value };
629:   if (typeof value === "string") return { String: value };
630:   if (Array.isArray(value)) return { Array: value.map(tagJson) };
631:   return { Map: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagJson(item)])) };
632: }
```

## snapback2/packages/evaluator/src/unicode.ts

```text
1: // Shared pinned normalization for indexed search.
2: // @ref LLP 1001#unicode-search-foundation — pinned Unicode, independent fields and stable counting passes.
3: import { combining, folding, boundaries, decomposition, rangeValue, decomposeAt, composePair, MAX_DECOMPOSITION_DEPTH } from './unicode-tables';
4: export { TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH, MAX_LOOKUP_PROBES } from './unicode-tables';
5: 
6: export const SEARCH_CONTRACT = 'u17-nfc-scf-nfc-wsp-p' as const;
7: export type SearchContract = typeof SEARCH_CONTRACT;
8: // U=4N and all scalar/segment positions fit Uint32. This is an implementation
9: // ceiling, independent of each field max/Q; resource certification imposes much smaller bounds.
10: export const MAX_SEARCH_SOURCE_SCALARS = 0x3fffffff;
11: export class SearchInputError extends Error {
12:   readonly code = 'E_INPUT';
13:   constructor(message: string) { super(`E_INPUT: ${message}`); this.name = 'SearchInputError'; }
14: }
15: 
16: /** Reject UTF-16 surrogates before allocating scratch or replacing any input bytes. */
17: export function scalarLength(source: string, sourceMax: number): number {
18:   if (typeof source !== 'string') throw new SearchInputError('expected scalar text');
19:   if (!Number.isSafeInteger(sourceMax) || sourceMax < 0 || sourceMax > MAX_SEARCH_SOURCE_SCALARS) throw new SearchInputError('invalid search source bound');
20:   let n = 0;
21:   for (let i = 0; i < source.length; i++) {
22:     const c = source.charCodeAt(i);
23:     if (c >= 0xd800 && c <= 0xdbff) {
24:       const next = source.charCodeAt(++i);
25:       if (!(next >= 0xdc00 && next <= 0xdfff)) throw new SearchInputError('unpaired surrogate');
26:     } else if (c >= 0xdc00 && c <= 0xdfff) throw new SearchInputError('unpaired surrogate');
27:     if (++n > sourceMax) throw new SearchInputError('search source exceeds its declared scalar maximum');
28:   }
29:   return n;
30: }
31: /** Existing Text input domain, distinct from low-level NFC's full scalar domain.
32:  * Two scalar validation passes, no scratch; callers price input validation separately. */
33: export function validateSearchSource(source: string, sourceMax: number): number {
34:   const n = scalarLength(source, sourceMax);
35:   for (const ch of source) {
36:     const cp = ch.codePointAt(0)!;
37:     if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) throw new SearchInputError('search text contains a disallowed control character');
38:   }
39:   return n;
40: }
41: 
42: /** Logical pass ledger. A table lookup costs <=12 binary probes; counts exclude immutable tables. */
43: export interface NormalizationStats {
44:   inputScalars: number;
45:   outputScalars: number;
46:   outputChunks: number;
47:   decompositionVisits: number;
48:   reorderVisits: number;
49:   cccBucketVisits: number;
50:   segmentBucketVisits: number;
51:   compositionVisits: number;
52:   foldVisits: number;
53:   tableLookups: number;
54:   peakScalars: number;
55:   scratchBytes: number;
56: }
57: function stats(): NormalizationStats {
58:   return { inputScalars: 0, outputScalars: 0, outputChunks: 0, decompositionVisits: 0, reorderVisits: 0,
59:     cccBucketVisits: 0, segmentBucketVisits: 0, compositionVisits: 0, foldVisits: 0,
60:     tableLookups: 0, peakScalars: 0, scratchBytes: 0 };
61: }
62: export function normalizationScratchBytes(sourceMax: number): number {
63:   scalarLength('', sourceMax);
64:   // Typed buffers: 20U+1028. TS UTF-16 chunk conversion: <=4U payload,
65:   // 24 bytes per 256-unit chunk (string header + array reference), 2080 fixed
66:   // bytes (array/view headers and <=256 numeric call arguments). Final text is output.
67:   return 96 * sourceMax + 3108 + 24 * Math.ceil(sourceMax / 32);
68: }
69: /** Counts the named passes plus bounded table lookups as primitives, not CPU cycles. */
70: export function normalizationSteps(stats: NormalizationStats): number {
71:   return 2 * stats.inputScalars + stats.outputScalars + stats.outputChunks + stats.decompositionVisits + stats.reorderVisits
72:     + stats.cccBucketVisits + stats.segmentBucketVisits + stats.compositionVisits + stats.foldVisits + stats.tableLookups;
73: }
74: export function normalizationStepBound(sourceMax: number): number {
75:   scalarLength('', sourceMax);
76:   // Two NFC stages: decomposition <=2(D+1)U, reorder <=8U, composition <=2U,
77:   // fold <=U, lookup <=2(D+1)U+9U, output <=U; segment buckets <=4U+4.
78:   return 2 * sourceMax + 4 * sourceMax * (4 * (MAX_DECOMPOSITION_DEPTH + 1) + 25) + 1028 + Math.ceil(sourceMax / 32);
79: }
80: 
81: /** Scratch is reused between both NFC stages and sequential fields. Allocation follows actual N. */
82: export class SearchNormalizer {
83:   private a = new Uint32Array(0);
84:   private b = new Uint32Array(0);
85:   private sa = new Uint32Array(0);
86:   private sb = new Uint32Array(0);
87:   private counts = new Uint32Array(1);
88:   private cccCounts = new Uint32Array(256);
89:   private length = 0;
90:   private meter = stats();
91: 
92:   normalize(source: string, sourceMax: number): { text: string; stats: NormalizationStats } {
93:     return this.run(source, sourceMax, true);
94:   }
95:   nfc(source: string, sourceMax: number): { text: string; stats: NormalizationStats } {
96:     return this.run(source, sourceMax, false);
97:   }
98:   private run(source: string, sourceMax: number, fold: boolean) {
99:     const n = scalarLength(source, sourceMax), u = 4 * n;
100:     if (this.a.length < u) {
101:       // Drop old buffers before growth, so resizing has no additional live scratch payload.
102:       this.a = this.b = this.sa = this.sb = this.counts = new Uint32Array(0);
103:       this.a = new Uint32Array(u); this.b = new Uint32Array(u);
104:       this.sa = new Uint32Array(u); this.sb = new Uint32Array(u);
105:       this.counts = new Uint32Array(u + 1);
106:     }
107:     this.meter = stats();
108:     this.meter.inputScalars = n;
109:     this.meter.scratchBytes = 16 * this.a.length + this.counts.byteLength + this.cccCounts.byteLength;
110:     this.length = 0;
111:     for (const ch of source) this.a[this.length++] = ch.codePointAt(0)!;
112:     this.canonical();
113:     if (fold) {
114:       for (let i = 0; i < this.length; i++) {
115:         this.meter.foldVisits++; this.meter.tableLookups++;
116:         this.a[i] += rangeValue(folding, this.a[i]);
117:       }
118:       this.canonical();
119:     }
120:     this.meter.outputScalars = this.length;
121:     // Reuse the idle scalar buffer for UTF-16. Chunked flat-string construction
122:     // avoids unbounded spread arguments and any growing-string concatenation.
123:     const units = new Uint16Array(this.b.buffer);
124:     let end = 0;
125:     for (let i = 0; i < this.length; i++) {
126:       const cp = this.a[i];
127:       if (cp < 0x10000) units[end++] = cp;
128:       else { const x = cp - 0x10000; units[end++] = 0xd800 + (x >>> 10); units[end++] = 0xdc00 + (x & 1023); }
129:     }
130:     const chunks: string[] = [];
131:     for (let start = 0; start < end; start += 256) chunks.push(String.fromCharCode(...units.subarray(start, Math.min(end, start + 256))));
132:     this.meter.outputChunks = chunks.length;
133:     this.meter.scratchBytes += 2 * end + 24 * chunks.length + 32 + 8 * Math.min(end, 256);
134:     const text = chunks.join('');
135:     return { text, stats: { ...this.meter } };
136:   }
137:   private canonical() {
138:     let written = 0;
139:     const append = (cp: number) => {
140:       if (written >= this.b.length) throw new Error('Unicode U=4N invariant');
141:       this.b[written++] = cp;
142:     };
143:     const decompose = (cp: number) => {
144:       this.meter.decompositionVisits++;
145:       if (cp >= 0xac00 && cp <= 0xd7a3) {
146:         const x = cp - 0xac00;
147:         append(0x1100 + Math.floor(x / 588)); append(0x1161 + Math.floor((x % 588) / 28));
148:         if (x % 28) append(0x11a7 + x % 28);
149:       } else {
150:         this.meter.tableLookups++;
151:         const i = decomposeAt(cp);
152:         if (i < 0) append(cp);
153:         else for (let j = 1; j <= decomposition[i + 3]; j++) decompose(decomposition[i + j]);
154:       }
155:     };
156:     for (let i = 0; i < this.length; i++) decompose(this.a[i]);
157:     [this.a, this.b] = [this.b, this.a]; this.length = written;
158:     this.meter.peakScalars = Math.max(this.meter.peakScalars, written);
159: 
160:     // R2: stable CCC pass, then stable starter-segment pass. Leading marks use segment 0.
161:     this.cccCounts.fill(0); this.meter.cccBucketVisits += 256;
162:     let segment = 0;
163:     for (let i = 0; i < written; i++) {
164:       this.meter.tableLookups++; this.meter.reorderVisits++;
165:       const cls = rangeValue(combining, this.a[i]);
166:       if (cls === 0) segment++;
167:       this.sa[i] = segment; this.cccCounts[cls]++;
168:     }
169:     let sum = 0;
170:     for (let i = 0; i < 256; i++) {
171:       const n = this.cccCounts[i]; this.cccCounts[i] = sum; sum += n;
172:     }
173:     this.meter.cccBucketVisits += 256;
174:     for (let i = 0; i < written; i++) {
175:       this.meter.tableLookups++; this.meter.reorderVisits++;
176:       const pos = this.cccCounts[rangeValue(combining, this.a[i])]++;
177:       this.b[pos] = this.a[i]; this.sb[pos] = this.sa[i];
178:     }
179:     this.counts.fill(0, 0, segment + 1); this.meter.segmentBucketVisits += segment + 1;
180:     for (let i = 0; i < written; i++) { this.counts[this.sb[i]]++; this.meter.reorderVisits++; }
181:     sum = 0;
182:     for (let i = 0; i <= segment; i++) { const n = this.counts[i]; this.counts[i] = sum; sum += n; }
183:     this.meter.segmentBucketVisits += segment + 1;
184:     for (let i = 0; i < written; i++) { this.a[this.counts[this.sb[i]]++] = this.b[i]; this.meter.reorderVisits++; }
185: 
186:     let out = 0, starter = -1, last = 0;
187:     for (let i = 0; i < written; i++) {
188:       const cp = this.a[i];
189:       this.meter.compositionVisits++; this.meter.tableLookups++;
190:       const cls = rangeValue(combining, cp);
191:       let composite = 0;
192:       if (starter >= 0 && (last === 0 || last < cls)) {
193:         this.meter.tableLookups++; composite = composePair(this.a[starter], cp);
194:       }
195:       if (composite) this.a[starter] = composite;
196:       else { this.a[out] = cp; if (cls === 0) starter = out; out++; last = cls; }
197:     }
198:     this.length = out;
199:   }
200: }
201: 
202: export function normalizeSearch(source: string, sourceMax: number): string {
203:   return new SearchNormalizer().normalize(source, sourceMax).text;
204: }
205: export function isSearchBoundary(cp: number): boolean {
206:   if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new SearchInputError('invalid Unicode scalar');
207:   return rangeValue(boundaries, cp) !== 0;
208: }
209: function* tokens(text: string): Generator<string> {
210:   let start = 0, offset = 0;
211:   for (const ch of text) {
212:     if (isSearchBoundary(ch.codePointAt(0)!)) {
213:       if (offset > start) yield text.slice(start, offset);
214:       start = offset + ch.length;
215:     }
216:     offset += ch.length;
217:   }
218:   if (offset > start) yield text.slice(start);
219: }
220: export function searchWords(source: string | null, sourceMax: number): string[] {
221:   return searchFieldWords([{ source, sourceMax }]);
222: }
223: export function searchFieldWords(fields: readonly { source: string | null; sourceMax: number }[]): string[] {
224:   const normalizer = new SearchNormalizer(), words = new Set<string>();
225:   for (const { source, sourceMax } of fields) {
226:     scalarLength('', sourceMax);
227:     if (source !== null) {
228:       validateSearchSource(source, sourceMax);
229:       for (const word of tokens(normalizer.normalize(source, sourceMax).text)) words.add(word);
230:     }
231:   }
232:   return [...words];
233: }
234: /** null is the distinguished empty search, never a wildcard. Counts occurrences before dedup. */
235: export function searchQueryToken(source: string, sourceMax: number, normalizer = new SearchNormalizer()): string | null {
236:   validateSearchSource(source, sourceMax);
237:   let token: string | null = null;
238:   for (const next of tokens(normalizer.normalize(source, sourceMax).text)) {
239:     if (token !== null) throw new SearchInputError('search one word');
240:     token = next;
241:   }
242:   return token;
243: }
```

## snapback2/packages/evaluator/src/test-maintained-address.ts

```text
1: // @ref LLP 1001#maintained-addresses — native R2 c4912718 Runtime outputs, copied byte-for-byte.
2: // Additional absence/forgery/cursor controls below are synthetic, with no new native-output claim.
3: import assert from 'node:assert/strict';
4: import { readFileSync } from 'node:fs';
5: import { FixtureStore as ClientStore } from './test-certificate';
6: import { canonicalValues, scopedRuleHash, validateIdentity, validateInputs, validateWriteRow, wireJson } from './value-runtime';
7: import { decodeCursor, decodeCursorFor, encodeCursor } from './cursor';
8: import { preparePrefix, indexTuple } from './index-store';
9: import { RowImage, imageCanonical } from './row-image';
10: import { decodeDeliveryEnvelope, toClosureReceipt, tagWireRow, prepareWireRow, tagWireIndexValues } from '../../snapback2/src/offline-protocol';
11: import { tagArguments } from '../../snapback2/src/twin-hydrate';
12: import { decodeHeldProgram } from '../../snapback2/src/held-program';
13: import { decodeLocalCursor, encodeLocalCursor } from '../../snapback2/src/local-cursor';
14: import { canonicalSchemaJson } from './certificate-identity';
15: import { sha256 } from './hash';
16: 
17: const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));
18: 
19: for (let i = 1; i <= 4; i++) {
20:   const w = JSON.parse(readFileSync(new URL(`./test-maintained-fixtures/roundtrip-${i}.json`, import.meta.url), 'utf8'));
21:   const schema = w.project.schema, ir = w.project.programs.find((p: any) => p.name === w.program);
22:   const context = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: w.args, now: null, new_ids: [], read_time: null };
23:   const replay = (receipt: any) => new ClientStore(schema, receipt).reexecute(ir, context, w.certificate);
24:   assert.equal(replay(w.execution.receipt).state, 'fresh');
25:   assert.deepEqual(replay(w.execution.receipt).execution.result, w.execution.result);
26:   assert.deepEqual(
27:     plainJson(tagArguments(ir.args, Object.fromEntries(Object.entries(w.args).map(([k,v]) => [k,wireJson(v as any)])), schema)),
28:     w.args,
29:   );
30:   const descriptor = { kind: 'query', planHash: w.certificate.plan_hash, ir, certificate: w.certificate };
31:   const held = { generation: 'a'.repeat(64), schemaHash: w.certificate.schema_hash, schema, programs: { [ir.name]: descriptor } };
32:   assert(decodeHeldProgram(held)?.programs[ir.name], 'current exact held identity admits the native operation');
33:   const v4 = structuredClone(held); v4.programs[ir.name].certificate.evaluator_version = 'bounded-spike-rust-search-text-refinements-4';
34:   assert.equal(decodeHeldProgram(v4)?.programs[ir.name], undefined, 'a cold v4 held operation cannot execute under evaluator v5');
35:   const forgedPlan = structuredClone(held); forgedPlan.programs[ir.name].ir.name += '.forged';
36:   assert.equal(decodeHeldProgram(forgedPlan)?.programs[ir.name], undefined);
37:   if (!w.delivery) continue;
38:   const envelope = decodeDeliveryEnvelope(w.delivery);
39:   assert.deepEqual(replay(toClosureReceipt(envelope,schema)).execution.result, w.execution.result);
40:   const record = w.execution.receipt.rows[0], address = record.id, target = record.table;
41:   const ref = { Ref: { table: target } }, nested = { Optional: { List: { max: 2, of: { Optional: ref } } } };
42:   const input = { Array: ['Null', { Id: address }] } as any;
43:   validateInputs(schema,{ args: { input: nested } },{ input });
44:   assert.throws(() => validateInputs(schema,{ args: { input: { List: { of: ref,max: 1 } } } },
45:     { input: { Array: [{ Id: address },{ Id: address }] } }),{ code: 'E_FANOUT' });
46:   assert.deepEqual(plainJson(tagArguments({ input: nested },{ input: [null,address] },schema)),{ input });
47:   for (const descriptor of ['Id','Principal','Scalar',{ Json: { max_bytes: 4096 } },{ Ref: { table: 'memberships' } }])
48:     assert.throws(() => validateInputs(schema,{ args: { input: descriptor } },{ input: { Id: address } }), { code: 'E_INPUT' });
49:   const link = { Row: { id: { Id: 'link' }, parent: { Id: address }, parents: input } } as any;
50:   validateWriteRow(schema,'links',link);
51:   assert.deepEqual(plainJson(tagWireRow(schema,'links',wireJson(link) as any)),link);
52:   assert.throws(() => new ClientStore(schema,{ ...w.execution.receipt, rows: [{ ...record,id: 'forged' }] }),{ code: 'E_INPUT' });
53:   const image = RowImage.prepare(schema,target,record.row), first = imageCanonical(image);
54:   const replacement = structuredClone(record.row); replacement.Row.value = { Int: 2 };
55:   const store = new ClientStore(schema,w.execution.receipt);
56:   store.rehydrate({ ...w.execution.receipt, rows: [{ ...record,row: replacement }] });
57:   assert.equal(imageCanonical(image),first,'a later image cannot mutate the first disclosed image');
58:   const bad = structuredClone(record.row); bad.Row.principal = { Id: 'different' };
59:   assert.throws(() => store.rehydrate({ ...w.execution.receipt, rows: [{ ...record,row: bad }] }),{ code: 'E_INPUT' });
60:   assert.deepEqual(store.byId(target,address),replacement,'failed replacement leaves held rows intact');
61:   const forged = structuredClone(w.delivery); forged.rows[0].row.principal = 'different';
62:   const structural = decodeDeliveryEnvelope(forged); // Shape alone is never schema authority.
63:   assert.throws(() => toClosureReceipt(structural,schema),{ code: 'E_INPUT' });
64:   for (const invalid of [' '+address,address.replace('"Id"','"String"')]) {
65:     assert.throws(() => validateInputs(schema,{ args: { input: ref } },{ input: { Id: invalid } }),{ code: 'E_INPUT' });
66:     assert.throws(() => tagWireIndexValues(schema,target,'byId',[invalid]),{ code: 'E_INPUT' });
67:   }
68:   const group = JSON.parse(address); group[0] = { Id: 'b'.repeat(135) };
69:   const absent = canonicalValues(group), absence = { ...w.execution.receipt, rows: [], absences: [[target,'byId',[{ Id: absent }]]] };
70:   const absentContext = { ...context,args: { address: { Id: absent } } };
71:   const negative = new ClientStore(schema,absence).reexecute(ir,absentContext,w.certificate);
72:   assert.equal(negative.state,'fresh'); assert.equal(negative.execution.result,'Null');
73:   const unproven = new ClientStore(schema,{ ...absence,absences: [] }).reexecute(ir,absentContext,w.certificate);
74:   assert.equal(unproven.state,'partial'); assert.equal(unproven.execution.result,'Null');
75:   assert.equal(preparePrefix(schema,target,'byId',[{ Scalar: { Id: absent } }],[]).length,1);
76:   assert.deepEqual(indexTuple(schema,target,[{ Column: 'id' }],{ Array: [{ Id: absent }] }),[{ Id: absent }]);
77:   const position = { table: target,index: 'byId',order: 'Asc' as const,suffix: [{ name: 'id',kind: 'Id' }],values: [{ Id: address }] };
78:   const cursor = encodeCursor(position);
79:   assert.deepEqual(decodeCursor(cursor),position);
80:   assert.deepEqual(decodeCursorFor(cursor,position,schema),{ Array: position.values });
81:   assert.throws(() => decodeCursorFor(cursor,position),{ code: 'E_INPUT' },'a supplied suffix alone cannot authorize the address');
82:   const changed = structuredClone(schema); changed.tables[target].indexes.byId.components = [{ Column: 'value' }];
83:   assert.throws(() => decodeCursorFor(cursor,position,changed),{ code: 'E_INPUT' });
84:   const fence = { partition: 'alice',operation: ir.name,program: w.certificate.plan_hash,schema: w.certificate.schema_hash,generation: 'a',incarnation: 'first',revisions: [1] };
85:   const local = encodeLocalCursor(fence,'bound',position);
86:   assert.equal(decodeLocalCursor(local,fence,'bound',[position],schema),cursor);
87:   const badPosition = { ...position,values: [{ Id: address.replace('"Id"','"String"') }] };
88:   const badLocal = encodeLocalCursor(fence,'bound',badPosition);
89:   assert.throws(() => decodeLocalCursor(badLocal,{ ...fence,revisions: [2] },'bound',[position],schema),
90:     (error: any) => error.code === 'E_INPUT' && !error.restartLocalPage,'invalid values refuse before stale-page restart');
91:   assert.throws(() => encodeCursor({ ...position,values: [{ Id: 'x'.repeat(4096) }] }),/4096/);
92:   const raw = wireJson(record.row) as any;
93:   assert.deepEqual(plainJson(tagWireRow(schema,target,raw)),record.row);
94:   assert.equal(imageCanonical(prepareWireRow(schema,target,raw)),first);
95: }
96: validateIdentity('a'.repeat(135));
97: assert.throws(() => validateIdentity('a'.repeat(136)),{ code: 'E_INPUT' });
98: 
99: {
100:   const index = (columns: string[], unique = false) => ({
101:     components: columns.map(Column => ({ Column })),
102:     unique,
103:   });
104:   const rules = { read: 'Allow', insert: 'Allow', update: 'Allow', delete: 'Allow' };
105:   const schema: any = {
106:     tables: {
107:       ledger: {
108:         columns: { id: 'Id', at: 'Time', amount: 'Int' },
109:         indexes: { byId: index(['id'], true), byAt: index(['at','id']) },
110:         rules, constraints: [], retain: 'until-revoked',
111:       },
112:       balances: {
113:         columns: { id: 'Id', at: 'Time', value: 'Int' },
114:         indexes: { byId: index(['id'], true), byAt: index(['at'], true), byValue: index(['value'], true) },
115:         rules, constraints: [{ Unique: { index: 'byValue' } }], retain: 'until-revoked',
116:       },
117:       counts: {
118:         columns: { id: 'Id', at: 'Time', value: 'Int' },
119:         indexes: { byId: index(['id'], true) },
120:         rules, constraints: [], retain: 'until-revoked',
121:       },
122:     },
123:     maintains: [
124:       { kind: { Sum: { of: 'amount' } }, source: 'ledger', by: ['at'], target: 'balances', readable: 'Allow' },
125:       { kind: 'Count', source: 'ledger', by: ['at'], target: 'counts', readable: 'Allow' },
126:     ],
127:     schedules: [], channels: {}, auth: { password: false, guests: false }, effects: [],
128:   };
129:   const schema_hash = sha256(canonicalSchemaJson(schema));
130:   const source = (id: string, at: number, amount: number): any => ({
131:     Row: { id: { Id: id }, at: { Int: at }, amount: { Int: amount } },
132:   });
133:   const aggregate = (table: string, at: number, value: number): any => ({
134:     table, id: canonicalValues([{ Int: at }]), row: {
135:       Row: { id: { Id: canonicalValues([{ Int: at }]) }, at: { Int: at }, value: { Int: value } },
136:     },
137:   });
138:   const context: any = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
139:   let serial = 0;
140:   const mutation = (body: any[]) => ({
141:     name: `sparse.${serial++}`, kind: 'Mutation', args: {}, read_time_granularity_ms: null,
142:     body: [...body, { Return: { Literal: 'Null' } }],
143:   });
144:   const predict = (rows: any[], absences: any[], body: any[], ranges: any[] = []) => {
145:     const store = new ClientStore(schema, { schema_hash, rows, ranges, absences, verdicts: [] });
146:     const result = store.applyMutation(mutation(body), context);
147:     assert.equal(result.state, 'predicted', JSON.stringify(result));
148:     lastResult = result;
149:     return store;
150:   };
151:   let lastResult: any;
152:   const id100 = canonicalValues([{ Int: 100 }]), id200 = canonicalValues([{ Int: 200 }]);
153:   const absence = (table: string, id: string) => [table, 'byId', [{ Id: id }]];
154:   const atAbsence = (at: number) => ['balances', 'byAt', [{ Int: at }]];
155:   const valueAbsence = (value: number) => ['balances', 'byValue', [{ Int: value }]];
156:   const completeValueRange = (id: string, value: number) => ({
157:     site: 'test.byValue', table: 'balances', index: 'byValue', prefix: [{ Scalar: { Int: value } }],
158:     order: 'Asc', take: 10, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
159:     rule_hash: scopedRuleHash(schema,schema.tables.balances.rules.read), row_ids: [id], stop: 'Exhausted',
160:     absence: false, halo: null, n2_suffix: null,
161:   });
162:   const insert = (row: any) => ({ Insert: { table: 'ledger', row: { Literal: row } } });
163:   const update = (id: string, patch: any) => ({
164:     Update: { table: 'ledger', key: { Literal: { Id: id } }, patch: { Literal: { Row: patch } } },
165:   });
166:   const remove = (id: string) => ({ Delete: { table: 'ledger', key: { Literal: { Id: id } } } });
167: 
168:   let store = predict(
169:     [{ table: 'ledger', id: 'a', row: source('a',100,5) }, aggregate('balances',100,5), aggregate('counts',100,1)],
170:     [],
171:     [insert(source('b',100,-5))],
172:   );
173:   assert.equal(store.byId('balances',id100),null,'nonempty zero sum is sparse');
174:   assert.equal((wireJson(store.byId('counts',id100)!) as any).value,2);
175: 
176:   store = predict(
177:     [],
178:     [absence('ledger','a'),absence('ledger','b'),absence('balances',id100),atAbsence(100),valueAbsence(5),valueAbsence(1),absence('counts',id100)],
179:     [insert(source('a',100,5)),insert(source('b',100,-5)),update('b',{ amount: { Int: -4 } })],
180:   );
181:   assert.equal((wireJson(store.byId('balances',id100)!) as any).value,1);
182:   const targetWrites = lastResult.execution.writes.filter((write: any) => write.table === 'balances');
183:   assert.equal(targetWrites.length,1,'insert, sparse delete and reinsert coalesce to one target write');
184:   assert.equal((wireJson(targetWrites[0].row) as any).value,1);
185: 
186:   store = predict(
187:     [{ table: 'ledger', id: 'a', row: source('a',100,5) }, { table: 'ledger', id: 'b', row: source('b',100,-5) }, aggregate('counts',100,2)],
188:     [absence('balances',id100),atAbsence(100),valueAbsence(1)],
189:     [update('b',{ amount: { Int: -4 } })],
190:   );
191:   assert.equal((wireJson(store.byId('balances',id100)!) as any).value,1,'zero to nonzero inserts once');
192: 
193:   store = predict(
194:     [{ table: 'ledger', id: 'a', row: source('a',100,5) }, { table: 'ledger', id: 'b', row: source('b',100,-4) },
195:       aggregate('balances',100,1), aggregate('counts',100,2)],
196:     [absence('balances',id200),atAbsence(200),valueAbsence(5),valueAbsence(-4),absence('counts',id200)],
197:     [update('b',{ at: { Int: 200 } })],
198:   );
199:   assert.equal((wireJson(store.byId('balances',id100)!) as any).value,5);
200:   assert.equal((wireJson(store.byId('balances',id200)!) as any).value,-4);
201:   assert.equal((wireJson(store.byId('counts',id100)!) as any).value,1);
202:   assert.equal((wireJson(store.byId('counts',id200)!) as any).value,1);
203: 
204:   const max = Number.MAX_SAFE_INTEGER;
205:   for (const [before,after] of [[-max,max],[max,-max]]) {
206:     store = predict(
207:       [{ table: 'ledger', id: 'limit', row: source('limit',100,before) }, aggregate('balances',100,before), aggregate('counts',100,1)],
208:       [valueAbsence(after)],
209:       [update('limit',{ amount: { Int: after } })],
210:     );
211:     assert.equal((wireJson(store.byId('balances',id100)!) as any).value,after,'wide delta is narrowed only after exact coalescing');
212:   }
213: 
214:   const id300 = canonicalValues([{ Int: 300 }]), id400 = canonicalValues([{ Int: 400 }]);
215:   const orderedRows = [
216:       { table: 'ledger', id: 'a', row: source('a',400,1) },
217:       { table: 'ledger', id: 'b', row: source('b',400,1) },
218:       { table: 'ledger', id: 'c', row: source('c',300,1) },
219:       aggregate('balances',400,2), aggregate('balances',300,1),
220:       aggregate('counts',400,2), aggregate('counts',300,1),
221:   ];
222:   const orderedStore = new ClientStore(schema, { schema_hash, rows: orderedRows, ranges: [], absences: [], verdicts: [] });
223:   assert.throws(
224:     () => orderedStore.applyMutation(mutation([update('b',{ at: { Int: 300 } })]), context),
225:     (error: any) => error.code === 'E_CONSTRAINT' && error.message.includes('balances.byValue'),
226:     'old-group-first target uniqueness refusal matches native',
227:   );
228:   assert.equal((wireJson(orderedStore.byId('balances',id400)!) as any).value,2,'refusal rolls back the old group');
229:   assert.equal((wireJson(orderedStore.byId('balances',id300)!) as any).value,1,'refusal rolls back the destination');
230: 
231:   store = predict(
232:     [{ table: 'ledger', id: 'move', row: source('move',400,1) }, aggregate('balances',400,1), aggregate('counts',400,1)],
233:     [absence('balances',id300),atAbsence(300),absence('counts',id300)],
234:     [update('move',{ at: { Int: 300 } })],
235:     [completeValueRange(id400,1)],
236:   );
237:   assert.equal(store.byId('balances',id400),null,'old sparse group is removed first');
238:   assert.equal((wireJson(store.byId('balances',id300)!) as any).value,1,'destination reuses the released unique value');
239: 
240:   store = predict(
241:     [
242:       { table: 'ledger', id: 'duplicate-delete', row: source('duplicate-delete',200,1) },
243:       aggregate('balances',100,1), aggregate('balances',200,1), aggregate('counts',200,1),
244:     ],
245:     [],
246:     [remove('duplicate-delete')],
247:   );
248:   assert.equal(store.byId('balances',id200),null,'delete does not recheck a stale duplicate unique value');
249:   assert.notEqual(store.byId('balances',id100),null,'unrelated duplicate survivor remains');
250: 
251:   store = predict(
252:     [{ table: 'ledger', id: 'b', row: source('b',200,-4) }, aggregate('balances',200,-4), aggregate('counts',200,1)],
253:     [],
254:     [remove('b')],
255:   );
256:   assert.equal(store.byId('balances',id200),null,'last sum deletion removes target');
257:   assert.equal(store.byId('counts',id200),null,'last count deletion removes target');
258: }
259: // @ref LLP 1012#6-reads-offline — readable group exhaustion proves a point result, not primary write authority.
260: {
261:   const index = (name: string) => ({ components: [{ Column: name }], unique: true });
262:   const table = { columns: { id: 'Id', target: 'Principal', value: 'Int' },
263:     indexes: { byId: index('id'), byTarget: index('target') },
264:     rules: { read: 'Allow', insert: 'Deny', update: 'Deny', delete: 'Deny' }, constraints: [], retain: 'until-revoked' };
265:   const schema: any = { tables: { counts: table }, maintains: [], channels: {}, schedules: [], effects: [], auth: { password: false, guests: false } };
266:   const schema_hash = sha256(canonicalSchemaJson(schema)), key = { Id: 'alice' };
267:   const program: any = { name: 'counts.point', kind: 'Query', args: {}, read_time_granularity_ms: null,
268:     body: [{ Return: { Get: { site: 'count', table: 'counts', index: 'byTarget', key: [{ Literal: key }] } } }] };
269:   const context: any = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
270:   const range: any = { site: 'count', table: 'counts', index: 'byTarget', prefix: [{ Scalar: key }],
271:     order: 'Asc', take: 1, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
272:     rule_hash: scopedRuleHash(schema,table.rules.read), row_ids: [], stop: 'Exhausted', absence: true, halo: null, n2_suffix: null };
273:   const receipt = (ranges: any[], absences: any[] = []): any => ({ schema_hash, rows: [], ranges, absences, verdicts: [] });
274:   const replay = (ranges: any[], absences: any[] = []) => new ClientStore(schema,receipt(ranges,absences)).reexecute(program,context);
275:   const primary = ['counts','byId',[{ Id: canonicalValues([key]) }]];
276:   assert.equal(replay([range],[primary]).state,'fresh','the owner proof pair covers the missing public group');
277:   assert.equal(replay([range]).state,'fresh','readable group exhaustion does not need canonical-ID equivalence');
278:   assert.equal(replay([],[primary]).state,'partial','primary absence alone does not prove a group empty');
279:   for (const [name, change] of [
280:     ['truncated', { stop: 'Limit' }], ['another key', { prefix: [{ Scalar: { Id: 'bob' } }] }],
281:     ['another index', { index: 'byId' }], ['another rule', { rule_hash: 'f'.repeat(64) }],
282:     ['evicted', { evicted_ids: ['lost'] }],
283:     ...['after','before','gt','gte','lt','lte'].map(bound => [bound,{ prefix: [], [bound]: bound === 'after' || bound === 'before' ? { Array: [key] } : key }]),
284:   ] as [string,any][]) assert.equal(replay([{ ...range,...change }]).state,'partial',name);
285:   const store = new ClientStore(schema,receipt([range]));
286:   assert.equal(store.hasAbsence('counts','byTarget',[key]),false,'read coverage adds no rule/mutation negative fact');
287:   assert.equal(store.authorityAbsence('counts',canonicalValues([key])),false,'group exhaustion adds no primary write authority');
288:   store.setReceipt('seed');
289:   assert.equal(store.reexecute(program,context).state,'partial','removing the receipt removes its read coverage');
290:   const restricted = structuredClone(schema); restricted.tables.counts.rules.read = { Eq: [{ Field: 'target' },'Viewer'] };
291:   const restrictedReceipt = { ...receipt([{ ...range,rule_hash: scopedRuleHash(restricted,restricted.tables.counts.rules.read) }]),
292:     schema_hash: sha256(canonicalSchemaJson(restricted)) };
293:   assert.equal(new ClientStore(restricted,restrictedReceipt).reexecute(program,context).state,'partial','restricted empty range does not acquire absence authority');
294:   const guarded = structuredClone(schema);
295:   guarded.tables.counts.rules.insert = { Not: { Exists: { table: 'counts', index: 'byTarget', key: [{ Field: 'target' }] } } };
296:   const guardedReceipt = { ...receipt([range],[['counts','byId',[{ Id: 'new-row' }]]]), schema_hash: sha256(canonicalSchemaJson(guarded)) };
297:   const guardedStore = new ClientStore(guarded,guardedReceipt);
298:   const inserted = { Row: { id: { Id: 'new-row' }, target: key, value: { Int: 1 } } };
299:   const insert: any = { name: 'guarded.insert', kind: 'Mutation', args: {}, read_time_granularity_ms: null,
300:     body: [{ Insert: { table: 'counts', row: { Literal: inserted } } }, { Return: { Literal: 'Null' } }] };
301:   const blocked = guardedStore.applyMutation(insert,context);
302:   assert.equal(blocked.state,'partial','readable group exhaustion cannot authorize a negative write rule');
303:   assert(blocked.partialSites.length > 0,JSON.stringify(blocked));
304:   assert.equal(guardedStore.byId('counts','new-row'),null,'unknown write authority leaves no inserted row');
305:   const surviving = { table: 'counts', id: 'legacy', row: { Row: { id: { Id: 'legacy' }, target: key, value: { Int: 3 } } } };
306:   const legacy = new ClientStore(schema,{ ...receipt([range],[primary]),rows: [surviving] }).reexecute(program,context);
307:   assert.equal((wireJson(legacy.execution.result) as any).value,3,'noncanonical surviving group row wins over canonical primary absence');
308: }
309: console.log('maintained address: exact native held/delivery outputs, targeted Optional/List, absent authority, atomic images and current-schema cursors pass');
```

## snapback2/packages/evaluator/src/test-search-foundation.ts

```text
1: import assert from 'node:assert/strict';
2: import { readFileSync } from 'node:fs';
3: import { createHash } from 'node:crypto';
4: import { SEARCH_CONTRACT, SearchInputError, SearchNormalizer, normalizeSearch, searchWords, searchFieldWords,
5:   searchQueryToken, scalarLength, isSearchBoundary, normalizationScratchBytes, normalizationSteps,
6:   normalizationStepBound, TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH, MAX_LOOKUP_PROBES, MAX_SEARCH_SOURCE_SCALARS } from './unicode';
7: import { decomposition, composition, combining, folding, boundaries, rangeValue } from './unicode-tables';
8: import { compareScalarAtoms, decodeIndexAtom, indexKeysEqual, indexKeyStartsWith, prepareIndexAtom,
9:   wordPrefixWireMax, type IndexComponent, type LogicalIndexAtom } from './search-key';
10: import { sameValueZero, totalCompare, valueFromWire } from './value-runtime';
11: 
12: // Collection equality shares text/ID values; index ordering keeps their types.
13: for (const [left, right, equal] of [
14:   [{ String: 'alice' }, { Id: 'alice' }, true],
15:   [{ Id: 'alice' }, { String: 'bob' }, false],
16:   [{ Int: 0 }, { Int: -0 }, true],
17:   [{ Int: 0 }, { Bool: false }, false],
18:   ['Null', { Bool: false }, false],
19: ] as const) {
20:   assert.equal(sameValueZero(left, right), equal);
21:   assert.equal(sameValueZero(right, left), equal);
22: }
23: assert(totalCompare({ String: 'alice' }, { Id: 'alice' }) < 0);
24: for (const value of [{ Bytes: '00' }, { Row: {} }, { Array: [] }, { Map: {} }]) {
25:   assert.throws(() => sameValueZero(value, { Int: 0 }), { code: 'E_TYPE' });
26:   assert.throws(() => sameValueZero({ Int: 0 }, value), { code: 'E_TYPE' });
27: }
28: assert(totalCompare({ Bytes: '0f' }, { Bytes: '10' }) < 0);
29: for (const bytes of ['FF', '0', 42, null]) {
30:   const value = { Bytes: bytes } as any;
31:   assert.throws(() => totalCompare(value, { Bytes: '00' }), { code: 'E_INPUT' });
32:   assert.throws(() => totalCompare({ Bytes: '00' }, value), { code: 'E_INPUT' });
33:   assert.throws(() => valueFromWire({ Bytes: { max: 10 } }, value, 'payload', (path, message) => {
34:     throw new Error(`${path}: ${message}`);
35:   }), /payload: expected canonical Bytes/);
36: }
37: 
38: const root = new URL('../../../unicode/17.0.0/', import.meta.url);
39: const lines = (name: string) => readFileSync(new URL(name, root), 'utf8').split('\n');
40: const hex = (s: string) => Number.parseInt(s, 16);
41: const string = (s: string) => s.trim().split(/\s+/).filter(Boolean).map(cp => String.fromCodePoint(hex(cp))).join('');
42: for (const line of lines('SHA256SUMS').filter(Boolean)) {
43:   const [digest, name] = line.trim().split(/\s+/);
44:   assert.equal(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), digest);
45: }
46: assert.equal(MAX_NFD_SCALARS, 4);
47: assert.equal(MAX_SEARCH_SOURCE_SCALARS, 0x3fffffff);
48: assert.equal(TABLE_DIGEST, '29bb626cbddaec2bce2cc1efcac329a9ea07ee725322155b791005cd7781b9e8');
49: assert(MAX_DECOMPOSITION_DEPTH <= 4);
50: for (const count of [decomposition.length / 4, composition.length / 3, combining.length / 3, folding.length / 3, boundaries.length / 3]) {
51:   assert(count < 2 ** MAX_LOOKUP_PROBES, 'binary lookup primitive exceeded its pinned bound');
52: }
53: 
54: const normalizer = new SearchNormalizer();
55: let cases = 0;
56: const part1 = new Set<number>();
57: let section = '';
58: for (const line of lines('NormalizationTest.txt')) {
59:   const content = line.split('#')[0].trim();
60:   if (content.startsWith('@')) { section = content.split(';')[0]; continue; }
61:   if (!content) continue;
62:   const cs = content.split(';').slice(0, 5).map(string);
63:   if (section === '@Part1') part1.add(cs[0].codePointAt(0)!);
64:   for (let i = 0; i < 5; i++) assert.equal(normalizer.nfc(cs[i], 100).text, cs[i < 3 ? 1 : 3], content);
65:   cases++;
66: }
67: assert.equal(cases, 20034);
68: 
69: // Independent finite facts from official inputs, including all C/S entries and exact P* | White_Space.
70: const ds = new Map<number, number[]>(), folds = new Map<number, number>();
71: const expectedBoundary = new Uint8Array(0x110000);
72: for (const line of lines('UnicodeData.txt').filter(Boolean)) {
73:   const f = line.split(';'), cp = hex(f[0]);
74:   if (f[2].startsWith('P')) expectedBoundary[cp] = 1;
75:   if (f[5] && !f[5].startsWith('<')) ds.set(cp, f[5].split(' ').map(hex));
76: }
77: for (const line of lines('PropList.txt')) {
78:   const f = line.split('#')[0].split(';').map(s => s.trim());
79:   if (f[1] !== 'White_Space') continue;
80:   const [start, end = start] = f[0].split('..').map(hex);
81:   expectedBoundary.fill(1, start, end + 1);
82: }
83: for (const line of lines('CaseFolding.txt')) {
84:   const f = line.split('#')[0].split(';').map(s => s.trim());
85:   if (f[1] === 'C' || f[1] === 'S') folds.set(hex(f[0]), hex(f[2]));
86: }
87: function nfdLength(cp: number): number {
88:   if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 ? 3 : 2;
89:   return ds.get(cp)?.reduce((n, c) => n + nfdLength(c), 0) ?? 1;
90: }
91: let maxNfd = 0;
92: for (let cp = 0; cp < 0x110000; cp++) {
93:   if (cp >= 0xd800 && cp <= 0xdfff) continue;
94:   maxNfd = Math.max(maxNfd, nfdLength(cp));
95:   assert.equal(isSearchBoundary(cp), !!expectedBoundary[cp], `boundary ${cp.toString(16)}`);
96:   assert.equal(cp + rangeValue(folding, cp), folds.get(cp) ?? cp, `fold ${cp.toString(16)}`);
97:   // Official NFC conformance's unlisted Part1 scalar identity, not just the explicit rows.
98:   if (!part1.has(cp)) {
99:     const s = String.fromCodePoint(cp);
100:     assert.equal(normalizer.nfc(s, 1).text, s, `unlisted scalar ${cp.toString(16)}`);
101:   }
102: }
103: assert.equal(maxNfd, 4);
104: assert.equal(folds.size, 1512);
105: for (const [cp, to] of folds) {
106:   assert(nfdLength(to) <= nfdLength(cp), 'folding increased NFD length');
107:   assert.equal(normalizeSearch(String.fromCodePoint(cp), 1), normalizeSearch(String.fromCodePoint(to), 1));
108: }
109: 
110: assert.deepEqual(searchWords('Élodie E\u0301lodie foo—bar don’t stop\u00a0here', 100), ['élodie', 'foo', 'bar', 'don', 't', 'stop', 'here']);
111: assert.deepEqual(searchWords('ſẞİıΣς Straße STRASSE 🦉+☕ a_b-c\'d', 100), ['sßİıσσ', 'straße', 'strasse', '🦉+☕', 'a', 'b', 'c', 'd']);
112: assert.deepEqual(searchWords(null, 0), []);
113: assert.deepEqual(searchFieldWords([
114:   { source: 'a', sourceMax: 1 }, { source: null, sourceMax: 4000 },
115:   { source: '\u0301', sourceMax: 1 }, { source: 'b A', sourceMax: 3 },
116: ]), ['a', '\u0301', 'b']);
117: assert.deepEqual(searchFieldWords([{ source: 'foo', sourceMax: 3 }, { source: 'bar', sourceMax: 3 }]), ['foo', 'bar']);
118: assert.equal(searchQueryToken(' \t—', 3), null);
119: for (let cp = 0; cp < 0x20; cp++) {
120:   const s = String.fromCodePoint(cp);
121:   assert.equal(normalizeSearch(s, 1), s, 'low-level Unicode must retain the full scalar domain');
122:   if ([9, 10, 13].includes(cp)) assert.equal(searchQueryToken(s, 1), null);
123:   else {
124:     assert.throws(() => searchQueryToken(s, 1), SearchInputError);
125:     assert.throws(() => searchWords(s, 1), SearchInputError);
126:   }
127: }
128: for (const s of ['foo foo', 'FOO foo', 'É E\u0301', 'foo-bar']) {
129:   assert.throws(() => searchQueryToken(s, 100), (e: any) => e instanceof SearchInputError && e.code === 'E_INPUT' && e.message.endsWith('search one word'));
130: }
131: for (const s of ['\ud800', '\udfff', 'a\ud800z', '\ud800\ud800', '\udc00\ud800']) {
132:   assert.throws(() => normalizeSearch(s, 100), SearchInputError);
133:   assert.throws(() => searchWords(s, 100), SearchInputError);
134: }
135: assert.equal(scalarLength('𐐀', 1), 1);
136: assert.throws(() => normalizeSearch('𐐀a', 1), SearchInputError);
137: for (const q of [-1, 1.5, NaN, Infinity, 0x40000000]) assert.throws(() => normalizeSearch('', q), SearchInputError);
138: assert.deepEqual(searchWords('Élodie hello_world', 2000), ['élodie', 'hello', 'world'], 'indexed fields use the shared Unicode contract');
139: 
140: for (const [source, expected] of [
141:   ['\u0315\u0300'.repeat(1000), '\u0300'.repeat(1000) + '\u0315'.repeat(1000)],
142:   ['a' + '\u0315\u0300'.repeat(1000), 'à' + '\u0300'.repeat(999) + '\u0315'.repeat(1000)],
143:   ['a\u0315\u0300'.repeat(1000), 'à\u0315'.repeat(1000)],
144:   ['a\u0301\u0300', 'á\u0300'],
145:   ['𐐀'.repeat(2000), '𐐨'.repeat(2000)],
146:   ['\u{1d160}'.repeat(2000), '\u{1d158}\u{1d165}\u{1d16e}'.repeat(2000)],
147:   ['\u1f82'.repeat(4000), '\u1f82'.repeat(4000)],
148: ] as const) {
149:   const n = scalarLength(source, 10000), u = 4 * n;
150:   const result = new SearchNormalizer().normalize(source, n);
151:   assert.equal(result.text, expected);
152:   assert(result.stats.outputScalars <= u && result.stats.peakScalars <= u);
153:   assert(result.stats.scratchBytes <= normalizationScratchBytes(n));
154:   assert.equal(result.stats.cccBucketVisits, 1024, 'CCC buckets cleared once per pass, never per segment');
155:   assert(result.stats.reorderVisits <= 8 * u);
156:   assert(result.stats.segmentBucketVisits <= 4 * u + 4);
157:   assert(normalizationSteps(result.stats) <= normalizationStepBound(n));
158: }
159: const reused = new SearchNormalizer();
160: assert(reused.normalize('x'.repeat(2000), 2000).stats.scratchBytes <= normalizationScratchBytes(2000));
161: assert(reused.normalize('x', 1).stats.scratchBytes >= 161028, 'ledger includes retained workspace high watermark');
162: assert(reused.normalize('x'.repeat(4000), 4000).stats.scratchBytes <= normalizationScratchBytes(4000));
163: const { scratchBytes, outputChunks, ...commonPasses } = new SearchNormalizer().normalize('É E\u0301 가', 20).stats;
164: assert.deepEqual(commonPasses, { inputScalars: 7, outputScalars: 5, decompositionVisits: 18,
165:   reorderVisits: 64, cccBucketVisits: 1024, segmentBucketVisits: 28,
166:   compositionVisits: 16, foldVisits: 5, tableLookups: 84, peakScalars: 8 });
167: assert.equal(outputChunks, 1);
168: assert.equal(scratchBytes, 1694); // Same passes as Rust; TS additionally constructs one UTF-16 chunk.
169: 
170: const component: IndexComponent = { WordPrefixes: { fields: ['name', 'handle'], contract: SEARCH_CONTRACT } };
171: const atom = (source: string) => ({ WordPrefix: { contract: SEARCH_CONTRACT, source } });
172: const key = (source: string, q = 2000) => prepareIndexAtom(component, atom(source), q);
173: const scope: LogicalIndexAtom = { Scalar: { Id: 'conversation' } };
174: assert(indexKeysEqual([scope, key('É')], [scope, key('E\u0301')]));
175: assert(indexKeyStartsWith([scope, key('E\u0301'), { Scalar: { Int: 1 } }], [scope, key('É')]));
176: assert(!indexKeyStartsWith([scope, key('cat')], [scope, key('ca')]));
177: assert(!indexKeysEqual([key('Straße')], [key('STRASSE')]));
178: assert(!indexKeysEqual([key('a')], [{ Scalar: { String: 'a' } }]));
179: // Indexed name raw max may be 1; independent query Q=2 accepts the decomposed spelling.
180: assert(indexKeysEqual([key('É', 1)], [key('E\u0301', 2)]));
181: assert.throws(() => key('E\u0301', 1), SearchInputError);
182: assert(indexKeysEqual([key('É'.repeat(1000), 1000)], [key('E\u0301'.repeat(1000), 2000)]));
183: assert(indexKeysEqual([key('𐐀'.repeat(2000))], [key('𐐨'.repeat(2000))]));
184: assert(indexKeysEqual([key('\u{1d160}'.repeat(2000), 2000)], [key('\u{1d158}\u{1d165}\u{1d16e}'.repeat(2000), 6000)]));
185: const empty = key(' —');
186: assert('WordPrefix' in empty && empty.WordPrefix.empty && !empty.WordPrefix.matchesNormalizedWord('anything'));
187: const ca = key('CA');
188: assert('WordPrefix' in ca && ca.WordPrefix.matchesNormalizedWord('café') && !ca.WordPrefix.matchesNormalizedWord('éca'));
189: assert.throws(() => compareScalarAtoms(ca, ca), SearchInputError);
190: assert(compareScalarAtoms({ Scalar: { String: '\uffff' } }, { Scalar: { String: '𐐀' } }) < 0);
191: assert(compareScalarAtoms({ Scalar: { String: 'x' } }, { Scalar: { Id: 'x' } }) < 0);
192: const wire = JSON.stringify(atom('E\u0301'));
193: assert.equal(JSON.stringify(decodeIndexAtom(wire, component, 2).atom), wire);
194: for (const json of [
195:   `{"WordPrefix":{"contract":"${SEARCH_CONTRACT}","source":"a","source":"a"}}`,
196:   `{"WordPrefix":{"contract":"${SEARCH_CONTRACT}","contract":"${SEARCH_CONTRACT}","source":"a"}}`,
197:   `{"WordPrefix":{"source":"a","contract":"${SEARCH_CONTRACT}"}}`,
198:   ` ${JSON.stringify(atom('a'))}`,
199: ]) assert.throws(() => decodeIndexAtom(json, component, 100), SearchInputError);
200: for (const ch of ['𐐀', '"', '\\', '\t', '\n', '\r', '\u2028']) {
201:   const source = ch.repeat(2000), json = JSON.stringify(atom(source));
202:   assert(Buffer.byteLength(json) <= wordPrefixWireMax(2000));
203:   if (ch === '𐐀') assert.equal(Buffer.byteLength(json), wordPrefixWireMax(2000));
204:   decodeIndexAtom(json, component, 2000);
205: }
206: for (const bad of [
207:   {}, { WordPrefix: { source: 'foo' } }, { WordPrefix: { contract: 'unknown', source: 'foo' } },
208:   { WordPrefix: { contract: SEARCH_CONTRACT, source: 'foo', source_max: 999 } },
209:   { ...atom('foo'), extra: 1 }, { Scalar: { String: 'foo' } }, atom('foo foo'), atom('\ud800'),
210:   { WordPrefix: { contract: SEARCH_CONTRACT, source: null } },
211:   atom('\0'), atom('\u000b'), atom('\u001f'),
212: ]) assert.throws(() => prepareIndexAtom(component, bad, 100), SearchInputError);
213: assert.throws(() => prepareIndexAtom(component, atom('foo')), SearchInputError);
214: assert.throws(() => prepareIndexAtom({ Column: 'name' }, atom('foo'), 100), SearchInputError);
215: for (const value of [{ String: '\ud800' }, { Id: '\ud800' }, { Int: 1.1 }, { Array: [] }, { Bytes: 'FF' }, { Bool: true, Int: 1 }]) {
216:   assert.throws(() => prepareIndexAtom({ Column: 'name' }, { Scalar: value }), SearchInputError);
217: }
218: console.log(`Unicode/search foundation: ${cases} normalization rows + unlisted scalars, ${folds.size} C/S folds, bounds and logical keys; tables ${TABLE_DIGEST}`);
```

## snapback2/packages/compiler/src/quarry/bound-schema.ts

```text
1: import { nameRewrite } from "./diagnostics";
2: import type { ArgType, DeliverJson, IndexComponent, SchemaJson, SourceSite, TableJson, Value } from "../ir";
3: import { expandedNumericLiteral } from "../syntax";
4: import type { ChannelDecl, Document, Expr, MaintainDecl, RuleDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
5: import { orderedTables, selectIndex } from "./catalog";
6: import { currentRule, refuse, typeError } from "./diagnostics";
7: import { quarryExpression } from "./print";
8: 
9: type RuleContext = {
10:   names: Set<string>;
11:   focal?: boolean;
12:   effect?: RuleDecl["effect"];
13:   old?: string;
14:   next?: string;
15:   table?: TableDecl;
16:   args?: Map<string, ScalarType>;
17: };
18: 
19: type RuleTerm = { value: unknown; kind: "field" | "other"; field?: string; method?: "field" | "oldField" | "nextField" };
20: 
21: /** Lower prepared Quarry declarations directly into the executable schema contract. */
22: export function bindQuarrySchema(documents: Document[], catalog: TableCatalog): SchemaJson {
23:   return bindQuarrySchemaArtifact(documents, catalog).schema;
24: }
25: 
26: export type BoundQuarrySchemaArtifact = {
27:   schema: SchemaJson;
28:   sources: Array<[string, SourceSite]>;
29: };
30: 
31: /** Keep executable constraints and their authored locations in one ordered artifact. */
32: export function bindQuarrySchemaArtifact(documents: Document[], catalog: TableCatalog): BoundQuarrySchemaArtifact {
33:   const tables: Record<string, TableJson> = Object.create(null);
34:   const sources: Array<[string, SourceSite]> = [];
35:   for (const declaration of orderedTables(catalog)) {
36:     if (declaration.name === "connected") continue;
37:     const bound = bindTable(declaration, catalog);
38:     tables[declaration.name] = bound.table;
39:     const base = `schema.tables.${declaration.name}`;
40:     sources.push([base, declaration.site]);
41:     for (const column of declaration.columns) sources.push([`${base}.columns.${column.name}`, column.site]);
42:     for (const index of declaration.indexes) sources.push([`${base}.indexes.${index.name}`, index.site]);
43:     const read = declaration.rules.find(rule => rule.effect === "read");
44:     sources.push([`schema.tables.${declaration.name}.rules.read`, read?.site ?? declaration.public?.site ?? { ...declaration.site, text: "read <- deny" }]);
45:     for (const [offset, site] of bound.constraintSources.entries()) {
46:       sources.push([`schema.tables.${declaration.name}.constraints[${offset}]`, site]);
47:     }
48:     if (bound.deliverSource) sources.push([`schema.tables.${declaration.name}.deliver`, bound.deliverSource]);
49:   }
50:   const channels: Record<string, unknown> = Object.create(null);
51:   for (const declaration of documents.flatMap((document) => document.channels)) {
52:     channels[declaration.name] = bindChannel(declaration, catalog);
53:     const site = `schema.channels.${declaration.name}`;
54:     sources.push([site, declaration.site], [`${site}.publish`, declaration.publish.site],
55:       [`${site}.subscribe`, declaration.subscribe.site]);
56:     for (const [kind, fields] of [["args", declaration.args], ["value", declaration.value]] as const) {
57:       for (const field of fields) sources.push([`${site}.${kind}.${field.name}`, field.site]);
58:     }
59:   }
60:   const identity = documents.find((document) => document.identity)?.identity;
61:   const schema: SchemaJson = {
62:     tables,
63:     maintains: documents.flatMap((document) => document.maintains).map((item) => bindMaintain(item, catalog)),
64:     channels,
65:     auth: { password: identity?.password ?? false, guests: identity?.guests ?? false },
66:     effects: [],
67:   };
68:   return { schema, sources };
69: }
70: 
71: function bindTable(
72:   declaration: TableDecl,
73:   catalog: TableCatalog,
74: ): { table: TableJson; constraintSources: SourceSite[]; deliverSource?: SourceSite } {
75:   const columns: Record<string, unknown> = Object.assign(Object.create(null), { id: "Id" });
76:   for (const column of declaration.columns) columns[column.name] = bindColumn(column.type, catalog, column.site);
77:   const indexes: Record<string, unknown> = Object.create(null);
78:   for (const index of catalog.get(declaration.name)?.indexes ?? []) {
79:     indexes[index.name] = { components: structuredClone(index.components), unique: index.unique };
80:   }
81:   const rules: Record<string, unknown> = Object.create(null);
82:   for (const effect of ["read", "insert", "update", "delete"] as const) {
83:     const rule = declaration.rules.find((candidate) => candidate.effect === effect);
84:     if (effect === "read" && declaration.public) {
85:       if (rule) refuse(rule.site, `table ${declaration.name} cannot combine public with an explicit read rule`);
86:       rules.read = { Public: { reason: declaration.public.reason } };
87:     } else {
88:       rules[effect] = rule ? bindRule(rule, catalog, declaration) : "Deny";
89:     }
90:   }
91:   const constraints = bindConstraints(declaration, catalog);
92:   const deliver = bindDeliver(declaration, catalog);
93:   const table: TableJson = {
94:     columns,
95:     indexes,
96:     rules,
97:     constraints: constraints.values,
98:     // @ref LLP 1012#5-retention-revocation-and-the-fence — omission is an explicit IR default.
99:     retain: declaration.retain?.policy ?? "until-revoked",
100:     // @ref LLP 1019#3-what-writes-it — only the engine-derived log declares body eviction.
101:     ...(declaration.derived?.kind === "log" ? { tombstones: [{
102:       table: declaration.derived.deliver, column: "row",
103:       when: { Eq: [{ Field: "kind" }, { Literal: { String: "removed" } }] },
104:     }] } : {}),
105:     ...(deliver ? { deliver } : {}),
106:   };
107:   return { table, constraintSources: constraints.sources,
108:     ...(declaration.deliver ? { deliverSource: declaration.deliver.site } : {}) };
109: }
110: 
111: // @ref LLP 1019#1-the-declaration — the resolved descriptor in Rust field
112: // order; the tables it generates were materialized before the catalog.
113: function bindDeliver(declaration: TableDecl, catalog: TableCatalog): DeliverJson | undefined {
114:   const deliver = declaration.deliver;
115:   if (!deliver) return undefined;
116:   if (deliver.principal === undefined) refuse(deliver.site, `deliver on ${declaration.name} was not resolved before binding`);
117:   return {
118:     target: tableName(catalog, deliver.target, deliver.site),
119:     prefix: [...deliver.prefix],
120:     principal: deliver.principal,
121:     log: deliver.name,
122:     ...(deliver.receipts ? { receipts: true as const } : {}),
123:     ...(deliver.bootstrap ? { bootstrap: true as const } : {}),
124:   };
125: }
126: 
127: function bindColumn(type: ScalarType, catalog: TableCatalog, site: TableDecl["site"]): unknown {
128:   let descriptor: unknown;
129:   if (type.kind === "cursor") refuse(site, "cursor is an argument type, not a stored column type");
130:   if (type.kind === "text") descriptor = { Text: { max: type.max } };
131:   else if (type.kind === "id") descriptor = "Id";
132:   else if (type.kind === "principal") descriptor = "Principal";
133:   else if (type.kind === "int") descriptor = "Int";
134:   else if (type.kind === "decimal") descriptor = { Decimal: { scale: type.scale } };
135:   else if (type.kind === "money") descriptor = { Money: { currency: type.currency, scale: type.scale } };
136:   else if (type.kind === "time") descriptor = "Time";
137:   else if (type.kind === "bool") descriptor = "Bool";
138:   else if (type.kind === "json") descriptor = { Json: { max_bytes: type.max } };
139:   else if (type.kind === "bytes") descriptor = { Bytes: { max: type.max } };
140:   // @ref LLP 1006#3-authoring-surface — asset bounds and once custody are executable column metadata.
141:   else if (type.kind === "image") descriptor = { Image: { max: type.max, ...(type.once ? { once: true } : {}) } };
142:   else if (type.kind === "video") descriptor = { Video: { max: type.max } };
143:   else if (type.kind === "enum") descriptor = { Enum: { variants: [...type.variants] } };
144:   else if (type.kind === "ref") descriptor = { Ref: { table: tableName(catalog, type.table, site) } };
145:   else descriptor = { List: { of: bindColumn({ ...type.item, optional: false }, catalog, site), max: type.max } };
146:   return type.optional ? { Optional: descriptor } : descriptor;
147: }
148: 
149: function bindConstraints(
150:   declaration: TableDecl,
151:   catalog: TableCatalog,
152: ): { values: unknown[]; sources: SourceSite[] } {
153:   const constraints: unknown[] = [];
154:   const sources: SourceSite[] = [];
155:   const add = (value: unknown, site: SourceSite) => {
156:     constraints.push(value);
157:     sources.push(site);
158:   };
159:   for (const index of declaration.indexes.filter((item) => item.unique)) {
160:     add({ Unique: { index: index.name } }, index.site);
161:   }
162:   for (const cap of declaration.caps) add({ Cap: { by: [...cap.by], max: cap.max } }, cap.site);
163:   for (const immutable of declaration.immutable) {
164:     add({ Immutable: { fields: [...immutable.columns] } }, immutable.site);
165:   }
166:   for (const column of declaration.columns) {
167:     if (column.type.kind === "text" && (column.type.min !== undefined || column.type.format)) {
168:       add({ Text: {
169:         field: column.name,
170:         min: column.type.min ?? 0,
171:         ...(column.type.format ? { format: column.type.format } : {}),
172:       } }, column.site);
173:     }
174:   }
175:   for (const declarationConstraint of declaration.finalExists) {
176:     const read = declarationConstraint.value.read;
177:     const context: RuleContext = { names: new Set(), focal: true, effect: "insert", table: declaration };
178:     const index = selectIndex(
179:       catalog,
180:       read.table,
181:       read.keys,
182:       "exists",
183:       read.index,
184:       (value) => ruleTermType(value, context),
185:       read.site,
186:     );
187:     add({ FinalExistsOnInsert: {
188:       table: tableName(catalog, read.table, read.site),
189:       index: index.name,
190:       key: read.keys.map((item) => bindRuleTerm(item.value, context).value),
191:     } }, declarationConstraint.site);
192:   }
193:   return { values: constraints, sources };
194: }
195: 
196: function bindMaintain(declaration: MaintainDecl, catalog: TableCatalog): unknown {
197:   const target = catalog.get(declaration.name)?.declaration;
198:   if (!target) refuse(declaration.site, `maintain ${declaration.name} has no materialized target table`);
199:   return {
200:     kind: declaration.aggregate === "count" ? "Count" : { Sum: { of: declaration.column! } },
201:     source: tableName(catalog, declaration.source, declaration.site),
202:     by: [...declaration.by],
203:     target: target.name,
204:     readable: declaration.readable ? bindRule(declaration.readable, catalog, target) : null,
205:   };
206: }
207: 
208: function bindChannel(declaration: ChannelDecl, catalog: TableCatalog): unknown {
209:   const args: Record<string, unknown> = Object.create(null);
210:   for (const arg of declaration.args) args[arg.name] = bindArgument(arg.type, catalog, arg.site);
211:   const value: Record<string, ArgType> = Object.create(null);
212:   for (const field of declaration.value) value[field.name] = bindArgument(field.type, catalog, field.site);
213:   const context: RuleContext = {
214:     names: new Set(declaration.args.map((arg) => arg.name)),
215:     args: new Map(declaration.args.map((arg) => [arg.name, arg.type])),
216:   };
217:   return {
218:     args,
219:     value,
220:     publish: bindRuleExpr(declaration.publish, catalog, context),
221:     subscribe: bindRuleExpr(declaration.subscribe, catalog, context),
222:     ttl_ms: declaration.ttlSeconds * 1000,
223:   };
224: }
225: 
226: function bindArgument(type: ScalarType, catalog: TableCatalog, site: TableDecl["site"]): ArgType {
227:   let descriptor: ArgType;
228:   if (type.kind === "cursor") descriptor = "Cursor";
229:   else if (type.kind === "text") descriptor = { Text: {
230:     max: type.max,
231:     ...(type.min ? { min: type.min } : {}),
232:     ...(type.format ? { format: type.format } : {}),
233:   } };
234:   else if (type.kind === "id") descriptor = "Id";
235:   else if (type.kind === "principal") descriptor = "Principal";
236:   else if (type.kind === "int") descriptor = "Int";
237:   else if (type.kind === "decimal") descriptor = { Decimal: { scale: type.scale } };
238:   else if (type.kind === "money") descriptor = { Money: { currency: type.currency, scale: type.scale } };
239:   else if (type.kind === "time") descriptor = "Time";
240:   else if (type.kind === "bool") descriptor = "Bool";
241:   else if (type.kind === "json") descriptor = { Json: { max_bytes: type.max } };
242:   else if (type.kind === "bytes") descriptor = { Bytes: { max: type.max } };
243:   else if (type.kind === "image") descriptor = { Image: { max: type.max } };
244:   else if (type.kind === "video") descriptor = { Video: { max: type.max } };
245:   else if (type.kind === "enum") descriptor = { Enum: { variants: [...type.variants] } };
246:   else if (type.kind === "ref") descriptor = { Ref: { table: tableName(catalog, type.table, site) } };
247:   else descriptor = { List: { of: bindArgument({ ...type.item, optional: false }, catalog, site), max: type.max } };
248:   return type.optional ? { Optional: descriptor } : descriptor;
249: }
250: 
251: function bindRule(declaration: RuleDecl, catalog: TableCatalog, table?: TableDecl): unknown {
252:   const context: RuleContext = {
253:     names: new Set(declaration.bindings),
254:     focal: declaration.bindings.length === 0,
255:     effect: declaration.effect,
256:     table,
257:   };
258:   if (declaration.effect === "update" && declaration.bindings.length === 2) {
259:     [context.old, context.next] = declaration.bindings;
260:   }
261:   return bindRuleExpr(declaration.value, catalog, context);
262: }
263: 
264: function bindRuleExpr(expr: Expr, catalog: TableCatalog, context: RuleContext): unknown {
265:   currentRule(expr);
266:   if (expr.kind === "name") {
267:     if (expr.name === "allow") return "Allow";
268:     if (expr.name === "deny") return "Deny";
269:     if (expr.name === "public") return { Public: { reason: "Quarry public rule" } };
270:     refuse(expr.site, `rule expression ${expr.name} is not allow, deny, public, or a supported predicate`);
271:   }
272:   if (expr.kind === "unary" && expr.op === "not") return { Not: bindRuleExpr(expr.value, catalog, context) };
273:   if (expr.kind === "binary" && (expr.op === "and" || expr.op === "or")) {
274:     return { [expr.op === "and" ? "And" : "Or"]:
275:       flattenBoolean(expr, expr.op).map((item) => bindRuleExpr(item, catalog, context)) };
276:   }
277:   if (expr.kind === "binary" && (expr.op === "=" || expr.op === "!=")) {
278:     const leftType = ruleTermType(expr.left, context);
279:     const rightType = ruleTermType(expr.right, context);
280:     if (leftType?.kind === "int" && fractionalNumericLiteral(expr.right)
281:       || rightType?.kind === "int" && fractionalNumericLiteral(expr.left)) {
282:       typeError(expr.site, "int positions take integer literals", "use an integer literal in the int comparison");
283:     }
284:     if (leftType && rightType && !compatibleRuleTypes(leftType, rightType)
285:       && !brandedLiteralPair(leftType, expr.right) && !brandedLiteralPair(rightType, expr.left)) {
286:       refuse(expr.site, `cannot compare nominal ${leftType.kind} with ${rightType.kind}; fields compared with viewer must be principal`);
287:     }
288:     const left = bindRuleTerm(expr.left, context, rightType);
289:     const right = bindRuleTerm(expr.right, context, leftType);
290:     return { [expr.op === "=" ? "Eq" : "Ne"]: [left.value, right.value] };
291:   }
292:   if (expr.kind === "exists" || expr.kind === "created") {
293:     if (expr.read.table === "connected") refuse(
294:       expr.site,
295:       "connected is only readable in queries and mutations, not rules",
296:       `move ${quarryExpression(expr)} into a query or mutation; keep table rules based on durable facts`,
297:     );
298:     const index = selectIndex(
299:       catalog,
300:       expr.read.table,
301:       expr.read.keys,
302:       "exists",
303:       expr.read.index,
304:       (value) => ruleTermType(value, context),
305:       expr.site,
306:     );
307:     const key = expr.read.keys.map((item, position) => bindRuleTerm(
308:       item.value,
309:       context,
310:       indexComponentType(catalog, expr.read.table, index.components[position]),
311:     ).value);
312:     return { [expr.kind === "exists" ? "Exists" : "Created"]: {
313:       table: tableName(catalog, expr.read.table, expr.site),
314:       index: index.name,
315:       key,
316:       provenance: ruleProvenance(key),
317:     } };
318:   }
319:   if (expr.kind === "member" || expr.kind === "read") {
320:     refuse(expr.site, "rules cannot follow point reads or nested field chains; use a direct .field or exists/created probe");
321:   }
322:   if (expr.kind === "binary" && ["<", "<=", ">", ">="].includes(expr.op)) {
323:     // @ref LLP 1023.001#read-rule-comparison-diagnostic-follow-up — mutation preconditions do not govern read or channel authority.
324:     const writeRule = context.effect === "insert" || context.effect === "update" || context.effect === "delete";
325:     const repair = writeRule
326:       ? "move the bounded comparison into a mutation require"
327:       : "preserve this rule's authorization with supported predicates (guide rules); mutation require is not an automatic equivalent rewrite";
328:     refuse(expr.site, `the platform rule vocabulary has eq/ne but not ${expr.op}; ${repair}`);
329:   }
330:   refuse(expr.site, `rule expression cannot be represented by the Snapback 2 platform${context.effect ? ` for ${context.effect}` : ""}`);
331: }
332: 
333: function bindRuleTerm(expr: Expr, context: RuleContext, expected?: ScalarType): RuleTerm {
334:   rejectBareUpdateBinder(expr, context);
335:   if (expr.kind === "name" && expr.name === "viewer") return { value: "Viewer", kind: "other" };
336:   if (expr.kind === "literal") return { value: { Literal: bindLiteral(expr, expected) }, kind: "other" };
337:   // @ref LLP 1010#a3-one-row-binder — focal field access is the candidate row; two-image updates retain old/next.
338:   if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) {
339:     checkRuleField(context, expr.name, expr.site);
340:     return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
341:   }
342:   if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) {
343:     checkRuleField(context, expr.name, expr.site);
344:     const method = expr.base.name === context.old ? "oldField" : expr.base.name === context.next ? "nextField" : "field";
345:     const tag = method === "oldField" ? "OldField" : method === "nextField" ? "NextField" : "Field";
346:     return { value: { [tag]: expr.name }, kind: "field", field: expr.name, method };
347:   }
348:   if (expr.kind === "name" && context.names.has(expr.name)) {
349:     return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
350:   }
351:   if (expr.kind === "member") refuse(expr.site, "rule terms cannot follow nested field chains; use a direct .field or exists/created probe");
352:   refuse(expr.site, "rule terms may only be viewer, literals, channel arguments, or direct .fields of the ruled row");
353: }
354: 
355: // @ref LLP 1010#a3-one-row-binder — update binders name whole row images; only channel arguments lower as bare fields.
356: function rejectBareUpdateBinder(expr: Expr, context: RuleContext): void {
357:   if (expr.kind === "name" && (expr.name === context.old || expr.name === context.next)) {
358:     refuse(expr.site,
359:       `bare ${expr.name} is the update row, not a column; name a field`,
360:       `write ${expr.name}.id or ${expr.name}.<column>`);
361:   }
362: }
363: 
364: function bindLiteral(expr: Extract<Expr, { kind: "literal" }>, expected?: ScalarType): Value {
365:   if (expr.value === null) return "Null";
366:   if (typeof expr.value === "boolean") return { Bool: expr.value };
367:   if (typeof expr.value === "string") return { String: expr.value };
368:   const target = required(expected);
369:   if (target?.kind === "decimal" || target?.kind === "money") {
370:     const text = expr.numericText ?? String(expr.value);
371:     if (target.scale > 0 && !text.includes(".") && expr.value !== 0)
372:       typeError(expr.site, "integer rule literals do not implicitly become decimal whole units", `write ${text}.0 for decimal whole units`);
373:     const expanded = expandedNumericLiteral(text);
374:     if (!expanded || expanded.fraction.length > target.scale) {
375:       typeError(expr.site, `numeric rule literal must fit Decimal scale ${target.scale} and the safe integer range`, "use a literal that fits the declared scale");
376:     }
377:     const scaled = BigInt(expanded.whole) * (10n ** BigInt(target.scale))
378:       + BigInt(expanded.fraction.padEnd(target.scale, "0") || "0");
379:     if (scaled < -9_007_199_254_740_991n || scaled > 9_007_199_254_740_991n) {
380:       typeError(expr.site, `numeric rule literal must fit Decimal scale ${target.scale} and the safe integer range`, "use a literal that fits the declared scale");
381:     }
382:     return { Int: Number(scaled) };
383:   }
384:   if (!Number.isInteger(expr.value)) typeError(expr.site,
385:     "fractional numeric literals require a decimal or money context",
386:     "use an integer literal or compare against a decimal or money column");
387:   return { Int: expr.value };
388: }
389: 
390: function checkRuleField(context: RuleContext, name: string, site: TableDecl["site"]): void {
391:   if (context.table && name !== "id" && !context.table.columns.some((column) => column.name === name)) {
392:     refuse(site, `table ${context.table.name} has no rule field ${name}`, nameRewrite(name, ["id", ...context.table.columns.map(column => column.name)]));
393:   }
394: }
395: 
396: function ruleTermType(expr: Expr, context: RuleContext): ScalarType | undefined {
397:   rejectBareUpdateBinder(expr, context);
398:   if (expr.kind === "name" && expr.name === "viewer") return { kind: "principal", optional: false };
399:   if (expr.kind === "literal") {
400:     if (typeof expr.value === "string") return { kind: "text", max: Math.max(1, [...expr.value].length), optional: false };
401:     if (typeof expr.value === "number") return { kind: "int", optional: false };
402:     if (typeof expr.value === "boolean") return { kind: "bool", optional: false };
403:   }
404:   if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) return ruleFieldType(context.table, expr.name);
405:   if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) return ruleFieldType(context.table, expr.name);
406:   if (expr.kind === "name" && context.names.has(expr.name)) return context.args?.get(expr.name);
407:   return undefined;
408: }
409: 
410: function ruleFieldType(table: TableDecl | undefined, name: string): ScalarType | undefined {
411:   if (name === "id" && table) return { kind: "ref", table: table.name, optional: false };
412:   return table?.columns.find((column) => column.name === name)?.type;
413: }
414: 
415: function indexComponentType(
416:   catalog: TableCatalog,
417:   table: string,
418:   component: IndexComponent | undefined,
419: ): ScalarType | undefined {
420:   if (!component || !("Column" in component)) return undefined;
421:   return ruleFieldType(catalog.get(table)?.declaration, component.Column);
422: }
423: 
424: function compatibleRuleTypes(left: ScalarType, right: ScalarType): boolean {
425:   if (left.kind === "principal" || right.kind === "principal") return left.kind === "principal" && right.kind === "principal";
426:   if (left.kind === "ref" || left.kind === "id") return right.kind === "ref" || right.kind === "id";
427:   if (right.kind === "ref" || right.kind === "id") return false;
428:   if ((left.kind === "enum" && right.kind === "text") || (left.kind === "text" && right.kind === "enum")) return true;
429:   if (left.kind === "decimal" || right.kind === "decimal") {
430:     return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale;
431:   }
432:   if (left.kind === "money" || right.kind === "money") {
433:     return left.kind === "money" && right.kind === "money"
434:       && left.currency === right.currency && left.scale === right.scale;
435:   }
436:   return left.kind === right.kind;
437: }
438: 
439: function brandedLiteralPair(type: ScalarType, expr: Expr): boolean {
440:   return (type.kind === "decimal" || type.kind === "money") && numericLiteral(expr);
441: }
442: 
443: function numericLiteral(expr: Expr): boolean {
444:   return expr.kind === "literal" && typeof expr.value === "number"
445:     || expr.kind === "unary" && expr.op === "-" && numericLiteral(expr.value);
446: }
447: 
448: function fractionalNumericLiteral(expr: Expr): boolean {
449:   if (expr.kind === "unary" && expr.op === "-") return fractionalNumericLiteral(expr.value);
450:   return expr.kind === "literal" && typeof expr.value === "number" && expr.numericText?.includes(".") === true;
451: }
452: 
453: function flattenBoolean(expr: Expr, op: "and" | "or"): Expr[] {
454:   return expr.kind === "binary" && expr.op === op
455:     ? [...flattenBoolean(expr.left, op), ...flattenBoolean(expr.right, op)]
456:     : [expr];
457: }
458: 
459: function ruleProvenance(key: unknown[]): "Arg" | "Viewer" | "Const" | "Shape" | "Computed" {
460:   if (key.some((item) => typeof item === "object" && item !== null
461:     && ["Field", "OldField", "NextField"].some((term) => term in item))) return "Shape";
462:   if (key.some((item) => item === "Viewer")) return "Viewer";
463:   if (key.every((item) => typeof item === "object" && item !== null && "Literal" in item)) return "Const";
464:   return "Computed";
465: }
466: 
467: function required(type: ScalarType | undefined): ScalarType | undefined {
468:   return type?.optional ? { ...type, optional: false } : type;
469: }
470: 
471: function tableName(catalog: TableCatalog, authored: string, site: TableDecl["site"]): string {
472:   const declaration = catalog.get(authored)?.declaration;
473:   if (!declaration) refuse(site, `unknown table ${authored}`, nameRewrite(authored, catalog.keys()));
474:   return declaration.name;
475: }
```

## snapback2/packages/compiler/src/quarry-diagnostic-checks.ts

```text
1: import { deepStrictEqual } from "node:assert";
2: import { readdir } from "node:fs/promises";
3: import { lowerProject } from "./project";
4: import type { FrontendDiagnostic } from "./ir";
5: import { assert, compileInline, occurrences, withProject, type Test } from "./quarry-check-helpers";
6: 
7: // @ref LLP 1002#3-the-compiler-worker-and-the-project-json — independent
8: // refusals survive frontend recovery; failed bindings do not acquire a type.
9: export const diagnosticSchema = `use identity
10: 
11: table todos:
12:   title: text <=200
13:   done: bool
14:   ownerId: principal
15:   by byOwnerId: ownerId
16:   read <- .ownerId = viewer
17:   insert <- .ownerId = viewer
18:   update <- .ownerId = viewer
19:   delete <- .ownerId = viewer
20: `;
21: const mergeDiagnosticSchema = diagnosticSchema.replace("  by byOwnerId: ownerId", "  by byOwner: ownerId, id");
22: const originalPrefix = `query list():
23:   return todos[viewer] first 50
24: 
25: mutation add(title: text <=200):
26:   row = insert todos { title, done: false, ownerId: viewer }
27:   return { id: row.id }
28: 
29: `;
30: type Expected = { code: string; message: string; site?: string; absence?: boolean; boolean?: boolean };
31: export const quarryDiagnosticCases: Array<{
32:   name: string; source: string; expected: Expected[]; schema?: string; irCounts?: Record<string, number>;
33: }> = [
34:   { name: "independent write mismatch and unknown return", source: originalPrefix + `mutation complete(todoId: todos):
35:   update todos[todoId] { done: "yes" }
36:   return missingValue
37: `, expected: [
38:     { code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue", site: "10:10" },
39:     { code: "E_OPAQUE", message: "Type 'string' is not assignable to type 'boolean | undefined'", site: "9:3", absence: false, boolean: true },
40:   ] },
41:   { name: "nonnullable mismatch is not absence", source: originalPrefix + `mutation complete(todoId: todos):
42:   update todos[todoId] { done: "yes" }
43:   return true
44: `, expected: [{ code: "E_OPAQUE", message: "Type 'string' is not assignable to type 'boolean | undefined'", site: "9:3", absence: false, boolean: true }] },
45:   { name: "unknown statement before independent mismatch", source: `mutation complete(todoId: todos):
46:   lost = missingValue
47:   update todos[todoId] { done: "yes" }
48:   return true
49: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue", site: "2:10" }, { code: "E_OPAQUE", message: "Type 'string'", site: "3:3", absence: false }] },
50:   { name: "failed binding and aliases suppress dependent cascades", source: `mutation complete(todoId: todos):
51:   lost = missingValue
52:   alias = lost
53:   update todos[todoId] { done: alias }
54:   return anotherMissing
55: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name anotherMissing" }] },
56:   { name: "failed read key never borrows inferred index facts", source: `query probe():
57:   key = missingValue
58:   row = todos[key]
59:   return anotherMissing
60: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name anotherMissing" }] },
61:   { name: "nested branch refusals keep independent type checks", source: `mutation complete(todoId: todos, flag: bool):
62:   if flag:
63:     lost = missingThen
64:     update todos[todoId] { done: "yes" }
65:   else:
66:     lost = missingElse
67:   return true
68: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingThen" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingElse" }, { code: "E_OPAQUE", message: "Type 'string'", site: "4:5", absence: false }] },
69:   { name: "unresolved condition does not pretend to check its dependants", source: `query probe():
70:   if missingCondition:
71:     return missingInside
72:   return missingAfter
73: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingCondition" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingAfter" }] },
74:   { name: "failed binding invalidates a same-name argument", source: `mutation probe(done: bool, todoId: todos):
75:   done = missingValue
76:   update todos[todoId] { done }
77:   return missingAfter
78: `, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingAfter" }] },
79:   { name: "nullable wrong primitive still needs a type repair", source: `mutation complete(todoId: todos, value: text <=10 ?):
80:   update todos[todoId] { done: value }
81:   return true
82: `, expected: [{ code: "E_OPAQUE", message: "Type 'string | undefined' is not assignable", absence: false, boolean: true }] },
83:   { name: "nullable matching insert value retains presence advice", source: `mutation add(done: bool ?):
84:   row = insert todos { title: "hi", done, ownerId: viewer }
85:   return true
86: `, expected: [{ code: "E_OPAQUE", message: "undefined", absence: true }] },
87:   { name: "null-only insert needs a value instead of an assertion", source: `mutation add():
88:   row = insert todos { title: "hi", done: null, ownerId: viewer }
89:   return true
90: `, expected: [{ code: "E_OPAQUE", message: "null", absence: false, boolean: true }] },
91:   { name: "possibly absent dereference retains presence advice", schema: "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by byAuthor: author\n\ntable copies:\n  name: text <=50\n  public\n", source: "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    insert copies { name: post.author.name }\n  null\n", expected: [{ code: "E_OPAQUE", message: "undefined", absence: true }] },
92:   { name: "corrected original keeps all three operations", source: originalPrefix + `mutation complete(todoId: todos):
93:   update todos[todoId] { done: true }
94:   return true
95: `, expected: [] },
96:   { name: "presence assertion corrects the optional insert", source: `mutation add(done: bool ?):
97:   row = insert todos { title: "hi", done: done! else MISSING_DONE, ownerId: viewer }
98:   return { row, next: new }
99: `, expected: [] },
100:   { name: "generated declaration errors do not become type mismatch advice", source: `query probe():
101:   x = 1
102:   x = 2
103:   return x
104: `, expected: [
105:     { code: "E_QUARRY_UNKNOWN", message: "duplicate local x", site: "3:3" },
106:   ] },
107:   { name: "lexical loop-shadow", source: `mutation complete(todoId: todos):
108:   done = missingValue
109:   for done in ["yes"]:
110:     update todos[todoId] { done }
111:   return true
112: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "4:5", "absence": false, "boolean": true}], },
113:   { name: "lexical if-shadow", source: `mutation complete(todoId: todos):
114:   item = missingValue
115:   if exists todos[todoId]:
116:     item = todos[todoId] ! else NOT_FOUND
117:     update todos[todoId] { done: item.title }
118:   else:
119:     return false
120:   return true
121: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "5:5", "absence": false, "boolean": true}], },
122:   { name: "lexical loop-capture", source: `mutation complete(todoId: todos):
123:   item = missingValue
124:   for item in ["yes"]:
125:     box = { original: item }
126:     update todos[todoId] { done: box.original }
127:   return true
128: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "5:5", "absence": false, "boolean": true}], },
129:   { name: "lexical if-capture-isolation", source: `mutation complete(todoId: todos):
130:   item = missingValue
131:   if exists todos[todoId]:
132:     item = todos[todoId] ! else NOT_FOUND
133:     box = { original: item }
134:     update todos[todoId] { done: box.original.title }
135:   else:
136:     update todos[todoId] { done: item }
137:   update todos[todoId] { done: item }
138:   return true
139: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "6:5", "absence": false, "boolean": true}], },
140:   { name: "lexical nested-loop-isolation", source: `mutation complete(todoId: todos):
141:   item = missingValue
142:   for item in ["yes"]:
143:     for item in [true]:
144:       update todos[todoId] { done: item }
145:     box = { original: item }
146:     update todos[todoId] { done: box.original }
147:   update todos[todoId] { done: item }
148:   return true
149: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:5", "absence": false, "boolean": true}], },
150:   { name: "lexical failed-loop-domain", source: `mutation complete(todoId: todos):
151:   item = missingValue
152:   for item in item:
153:     update todos[todoId] { done: "yes" }
154:   return missingAfter
155: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], },
156:   { name: "lexical failed-if-condition", source: `mutation complete(todoId: todos):
157:   todoId = missingValue
158:   if exists todos[todoId]:
159:     todoId = todos[todoId] ! else NOT_FOUND
160:     update todos[todoId.id] { done: "yes" }
161:   else:
162:     return missingInside
163:   return missingAfter
164: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:12"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}], },
165:   { name: "lexical failed-tuple-initializer", source: `mutation complete(todoId: todos):
166:   item = missingValue
167:   (item, other) = sorted(true, item)
168:   update todos[todoId] { done: other }
169:   return missingAfter
170: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], },
171:   { name: "lexical fresh-divmod-binding", source: `mutation complete(todoId: todos):
172:   item = missingValue
173:   (item, other) = divmod(3, 2)
174:   update todos[todoId] { done: item }
175:   return true
176: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'number' is not assignable to type 'boolean | undefined'", "site": "4:3", "absence": false, "boolean": true}], },
177:   { name: "lexical failed-inner-shadow-restores-outer", source: `mutation complete(todoId: todos):
178:   item = "yes"
179:   for item in [true]:
180:     item = missingValue
181:     box = { original: item }
182:     update todos[todoId] { done: box.original }
183:   update todos[todoId] { done: item }
184:   return true
185: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "4:12"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:3", "absence": false, "boolean": true}], },
186:   { name: "lexical fresh-capture-rollback", source: `mutation complete(todoId: todos):
187:   item = missingOuter
188:   for item in ["yes"]:
189:     broken = { first: new, row: insert todos { title: "hi", done: false, ownerId: viewer }, bad: missingInner }
190:     box = { original: broken }
191:     update todos[todoId] { done: box.original }
192:     update todos[todoId] { done: item }
193:   return true
194: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingOuter", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingInner", "site": "4:98"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:5", "absence": false, "boolean": true}], },
195:   { name: "lexical merge-binder-independent", source: `mutation complete(todoId: todos):
196:   item = missingValue
197:   page = merge todos first 3 by byOwner:
198:     [item.ownerId] for item in todos[viewer] first 2 by byOwner
199:   update todos[todoId] { done: count(page) }
200:   return true
201: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'number' is not assignable to type 'boolean | undefined'", "site": "5:3", "absence": false, "boolean": true}], schema: `use identity
202: 
203: table todos:
204:   title: text <=200
205:   done: bool
206:   ownerId: principal
207:   by byOwner: ownerId, id
208:   read <- .ownerId = viewer
209:   insert <- .ownerId = viewer
210:   update <- .ownerId = viewer
211:   delete <- .ownerId = viewer
212: `, },
213:   { name: "lexical merge-binder-mismatch", source: `query probe():
214:   item = missingValue
215:   page = merge todos first 3 by byOwner:
216:     [item.title] for item in todos[viewer] first 2 by byOwner
217:   return true
218: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is text; todos.byOwner.ownerId is principal", "site": "4:5"}], schema: `use identity
219: 
220: table todos:
221:   title: text <=200
222:   done: bool
223:   ownerId: principal
224:   by byOwner: ownerId, id
225:   read <- .ownerId = viewer
226:   insert <- .ownerId = viewer
227:   update <- .ownerId = viewer
228:   delete <- .ownerId = viewer
229: `, },
230:   { name: "lexical fresh-sorted-type-fact", source: `mutation complete(todoId: todos):
231:   item = missingValue
232:   (item, other) = sorted("yes", "no")
233:   require item else INVALID
234:   return true
235: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_TYPE", "message": "condition requires bool, got text", "site": "4:11"}], },
236:   { name: "lexical failed-merge-domain", source: `query probe():
237:   item = missingValue
238:   page = merge todos first 3 by byOwner:
239:     [item.ownerId] for item in todos[item] first 2 by byOwner
240:   return missingAfter
241: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], schema: `use identity
242: 
243: table todos:
244:   title: text <=200
245:   done: bool
246:   ownerId: principal
247:   by byOwner: ownerId, id
248:   read <- .ownerId = viewer
249:   insert <- .ownerId = viewer
250:   update <- .ownerId = viewer
251:   delete <- .ownerId = viewer
252: `, },
253:   { name: "merge domain merge-failed-domain-wrong-prefix", schema: mergeDiagnosticSchema, source: `query probe():
254:   item = missingValue
255:   page = merge todos first 3 by byOwner:
256:     [item.title] for item in todos[item] first 2 by byOwner
257:   return missingAfter
258: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
259:   { name: "merge domain merge-missing-domain-wrong-prefix", schema: mergeDiagnosticSchema, source: `query probe():
260:   item = missingValue
261:   page = merge todos first 3 by byOwner:
262:     [item.title] for item in todos[missingDomain] first 2 by byOwner
263:   return missingAfter
264: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "4:36"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
265:   { name: "merge domain merge-missing-domain-renamed", schema: mergeDiagnosticSchema, source: `query probe():
266:   item = missingValue
267:   page = merge todos first 3 by byOwner:
268:     [fresh.title] for fresh in todos[missingDomain] first 2 by byOwner
269:   return missingAfter
270: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "4:38"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
271:   { name: "merge domain merge-valid-prefix-failed-domain", schema: mergeDiagnosticSchema, source: `query probe():
272:   item = missingValue
273:   page = merge todos first 3 by byOwner:
274:     [item.ownerId] for item in todos[item] first 2 by byOwner
275:   update todos["t"] { done: count(page) }
276:   return missingAfter
277: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "queries cannot write", "site": "5:3"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "6:10"}] },
278:   { name: "merge domain failed-domain-captured-outer", schema: mergeDiagnosticSchema, source: `query probe():
279:   item = missingValue
280:   box = { item }
281:   page = merge todos first 3 by byOwner:
282:     [item.title] for item in todos[box.item] first 2 by byOwner
283:   return missingAfter
284: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "6:10"}] },
285:   { name: "merge domain unknown-domain-table", schema: mergeDiagnosticSchema, source: `query probe():
286:   page = merge todos first 3 by byOwner:
287:     [item.title] for item in absentTable[viewer] first 2 by byOwner
288:   return missingAfter
289: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown table absentTable", "site": "3:30"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
290:   { name: "merge domain domain-key-type-before-prefix", schema: mergeDiagnosticSchema, source: `query probe(key: int):
291:   page = merge todos first 3 by byOwner:
292:     [item.title] for item in todos[key] first 2 by byOwner
293:   return missingAfter
294: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "todos.byOwner expects principal for ownerId, got int", "site": "3:36"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
295:   { name: "merge domain effectful-domain-prefix-fails", schema: mergeDiagnosticSchema, source: `query probe():
296:   page = merge todos first 3 by byOwner:
297:     [item.title] for item in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
298:   return missingAfter
299: `, expected: [{"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is text; todos.byOwner.ownerId is principal", "site": "3:5"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
300:   { name: "merge domain second-lane-domain-fails-rollback", schema: mergeDiagnosticSchema, source: `mutation probe(todoId: todos):
301:   item = missingValue
302:   page = merge todos first 3 by byOwner:
303:     [a.ownerId] for a in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
304:     [item.title] for item in todos[item] first 2 by byOwner
305:   update todos[todoId] { done: count(page) }
306:   update todos[todoId] { done: "yes" }
307:   return missingAfter
308: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:3", "absence": false, "boolean": true}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}] },
309:   { name: "merge domain nested-failed-merge-restores-item", schema: mergeDiagnosticSchema, source: `mutation probe(todoId: todos):
310:   item = missingOuter
311:   for item in ["yes"]:
312:     page = merge todos first 3 by byOwner:
313:       [item.title] for item in todos[missingDomain] first 2 by byOwner
314:     update todos[todoId] { done: item }
315:   update todos[todoId] { done: item }
316:   return missingAfter
317: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingOuter", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "5:38"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "6:5", "absence": false, "boolean": true}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}] },
318:   { name: "merge domain literal-prefix-mismatch", schema: mergeDiagnosticSchema, source: `query probe():
319:   page = merge todos first 3 by byOwner:
320:     [2]
321:   return missingAfter
322: `, expected: [{"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is int; todos.byOwner.ownerId is principal", "site": "3:5"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
323:   { name: "merge domain fresh-lane-not-in-domain", schema: mergeDiagnosticSchema, source: `query probe():
324:   page = merge todos first 3 by byOwner:
325:     [item.ownerId] for item in todos[item.ownerId] first 2 by byOwner
326:   return missingAfter
327: `, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name item", "site": "3:38"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
328:   { name: "merge domain lawful-shadow-domain", schema: mergeDiagnosticSchema, source: `query probe(item: principal):
329:   page = merge todos first 3 by byOwner:
330:     [item.ownerId] for item in todos[item] first 2 by byOwner
331:   return page
332: `, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 2 } },
333:   { name: "merge domain lawful-multiple-named-cursor", schema: mergeDiagnosticSchema, source: `query probe(c: cursor ?, other: principal):
334:   page = merge todos after c last 3 by byOwner:
335:     [ownerId = viewer]
336:     [ownerId = item.ownerId] for item in todos[other] first 2 by byOwner
337:   return page { id, title }
338: `, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 3, '"opaque_cursor":true': 2 } },
339:   { name: "merge domain lawful-domain-guard-once", schema: mergeDiagnosticSchema, source: `query probe():
340:   page = merge todos first 3 by byOwner:
341:     [item.ownerId] for item in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
342:   return page
343: `, expected: [], irCounts: { '"Merge":': 1, '"Get":': 1, '"Require":': 1, '"table":"todos"': 3 } },
344:   { name: "merge domain lawful-domain-allocation-once", schema: mergeDiagnosticSchema, source: `mutation probe():
345:   page = merge todos first 3 by byOwner:
346:     [item.ownerId] for item in todos[new] first 2 by byId
347:   return { page, next: new }
348: `, expected: [], irCounts: { '"Merge":': 1, '"Input":"NewId"': 2, '"table":"todos"': 2 } },
349:   { name: "merge domain lawful-nullable-prefix", schema: mergeDiagnosticSchema, source: `query probe():
350:   page = merge todos first 3 by byOwner:
351:     [todos[item.id]! else NOT_FOUND.ownerId] for item in todos[viewer] first 2 by byOwner
352:   return page
353: `, expected: [], irCounts: { '"Merge":': 1, '"Get":': 1, '"Require":': 1, '"table":"todos"': 3 } },
354:   { name: "merge domain lawful-two-discovered-lanes", schema: mergeDiagnosticSchema, source: `query probe(other: principal):
355:   page = merge todos first 3 by byOwner:
356:     [a.ownerId] for a in todos[viewer] first 2 by byOwner
357:     [b.ownerId] for b in todos[other] first 2 by byOwner
358:   return page
359: `, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 4 } },
360: ];
361: 
362: export function registerQuarryDiagnosticChecks(test: Test): void {
363:   test("rule comparison advice preserves read authority and distinguishes write preconditions", () => {
364:     for (const op of ["<", "<=", ">", ">="]) {
365:       for (const effect of ["read", "insert", "update", "delete"]) {
366:         const source = `table rows:
367:   owner: principal
368:   expiresAt: time ?
369:   ${effect} <- .owner = viewer and (.expiresAt = null or .expiresAt ${op} now)
370: `;
371:         const result = compileInline([{ fileName: "snapback/schema.q", source }]);
372:         assert(!result.ok, `${effect} ${op} unexpectedly compiled`);
373:         assert(result.diagnostics.length === 1, JSON.stringify(result));
374:         const diagnostic = result.diagnostics[0]!;
375:         assert(diagnostic.code === "E_QUARRY_UNKNOWN" && diagnostic.family === "quarry", JSON.stringify(diagnostic));
376:         assert(diagnostic.site.startsWith("snapback/schema.q:4:"), diagnostic.site);
377:         assert(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`), diagnostic.message);
378:         if (effect === "read") {
379:           assert(diagnostic.rewrite.includes("preserve this rule's authorization")
380:             && diagnostic.rewrite.includes("not an automatic equivalent rewrite"), diagnostic.rewrite);
381:           assert(diagnostic.rewrite.includes("guide rules"), diagnostic.rewrite);
382:           assert(!diagnostic.rewrite.includes("move the bounded comparison"), diagnostic.rewrite);
383:         } else {
384:           assert(diagnostic.rewrite.includes("move the bounded comparison into a mutation require"), diagnostic.rewrite);
385:         }
386:       }
387:     }
388:     const supported = compileInline([{ fileName: "snapback/schema.q", source: `table rows:
389:   owner: principal
390:   value: int
391:   read <- .owner = viewer
392:   insert <- .owner = viewer
393: ` }, { fileName: "snapback/rows.q", source: `mutation add(value: int):
394:   require value > 0 else POSITIVE_REQUIRED
395:   return insert rows { owner: viewer, value }
396: ` }]);
397:     assert(supported.ok, JSON.stringify(supported));
398:     assert(supported.project.programs[0]!.body.some(statement => typeof statement === "object" && "Require" in statement),
399:       "the supported write comparison lost its mutation precondition");
400:   });
401:   test("channel comparison advice preserves publish and subscribe authority", () => {
402:     for (const op of ["<", "<=", ">", ">="]) {
403:       for (const effect of ["publish", "subscribe"]) {
404:         const source = `table rows:
405:   value: bool
406:   public
407: 
408: channel activity(owner: principal, deadline: time):
409:   value: { active: bool }
410:   publish <- ${effect === "publish" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}
411:   subscribe <- ${effect === "subscribe" ? `owner = viewer and deadline ${op} now` : "owner = viewer"}
412:   ttl 5s
413: `;
414:         const result = compileInline([{ fileName: "snapback/schema.q", source }]);
415:         assert(!result.ok && result.diagnostics.length === 1, JSON.stringify(result));
416:         const diagnostic = result.diagnostics[0]!;
417:         assert(diagnostic.code === "E_QUARRY_UNKNOWN" && diagnostic.family === "quarry", JSON.stringify(diagnostic));
418:         assert(diagnostic.site.startsWith(`snapback/schema.q:${effect === "publish" ? 7 : 8}:`), diagnostic.site);
419:         assert(diagnostic.message.includes(`rule vocabulary has eq/ne but not ${op}`), diagnostic.message);
420:         assert(diagnostic.rewrite.includes("preserve this rule's authorization")
421:           && diagnostic.rewrite.includes("guide rules")
422:           && diagnostic.rewrite.includes("not an automatic equivalent rewrite"), diagnostic.rewrite);
423:         assert(!diagnostic.rewrite.includes("move the bounded comparison"), diagnostic.rewrite);
424:       }
425:     }
426:   });
427:   registerDiagnosticFixChecks(test);
428:   for (const c of quarryDiagnosticCases) test(`Quarry diagnostic recovery: ${c.name}`, async () => {
429:     await withProject({ "snapback/schema.q": c.schema ?? diagnosticSchema, "snapback/todos.q": c.source }, async root => {
430:       const result = await lowerProject(root);
431:       if (!c.expected.length) {
432:         assert(result.ok, JSON.stringify(result));
433:         const ir = JSON.stringify(result.project.programs);
434:         for (const [needle, count] of Object.entries(c.irCounts ?? {})) {
435:           deepStrictEqual(occurrences(ir, needle), count, `${c.name}: ${ir}`);
436:         }
437:         return;
438:       }
439:       assert(!result.ok, "invalid project acquired executable output");
440:       deepStrictEqual(Object.keys(result).sort(), ["diagnostics", "ms", "ok"], "partial emission escaped the diagnostic path");
441:       assert(!(await readdir(root, { recursive: true })).some(path => path.startsWith(".snapback")), "refusal wrote executable artifacts");
442:       deepStrictEqual(result.diagnostics.length, c.expected.length, JSON.stringify(result));
443:       for (const wanted of c.expected) {
444:         const diagnostic: FrontendDiagnostic | undefined = result.diagnostics.find(item => diagnosticMatches(item, wanted));
445:         assert(diagnostic, JSON.stringify(result));
446:         if (wanted.absence !== undefined) deepStrictEqual(diagnostic.rewrite.includes("! else CODE"), wanted.absence, JSON.stringify(diagnostic));
447:         if (wanted.boolean) assert(diagnostic.rewrite.includes("true or false"), JSON.stringify(diagnostic));
448:         assert(!!diagnostic.family && !!diagnostic.guide && !!diagnostic.rewrite, "incomplete refusal envelope");
449:       }
450:     });
451:   });
452:   for (const operations of [1, 3]) test(`Quarry diagnostic recovery: ${operations} operation refusal bounds count omitted failures`, async () => {
453:     const source = Array.from({ length: operations }, (_, op) => `query bad${op}():\n${Array.from({ length: 26 }, (_, i) => `  x${i} = missing${i}`).join("\n")}\n  return true\n`).join("\n");
454:     await withProject({ "snapback/schema.q": diagnosticSchema, "snapback/todos.q": source }, async root => {
455:       const result = await lowerProject(root); assert(!result.ok, "unknown names compiled");
456:       deepStrictEqual(result.diagnostics.length, operations === 1 ? 20 : 50);
457:       deepStrictEqual(result.diagnostics.at(-1)?.code, "E_DIAG_TRUNCATED");
458:       assert(result.diagnostics.at(-1)?.message.startsWith(`…and ${operations === 1 ? 7 : 17} more`), JSON.stringify(result));
459:     });
460:   });
461: }
462: 
463: function diagnosticMatches(item: FrontendDiagnostic, wanted: Expected): boolean {
464:   const code = wanted.code === "E_OPAQUE" ? "E_QUARRY_TYPE" : wanted.code;
465:   if (item.code !== code) return false;
466:   if (wanted.site) {
467:     const line = wanted.site.split(":")[0];
468:     if (!item.site.startsWith(`snapback/todos.q:${line}:`)) return false;
469:   }
470:   if (wanted.code !== "E_OPAQUE") return item.message.includes(wanted.message);
471:   if (wanted.message.includes("string")) return item.message.includes("got text");
472:   if (wanted.message.includes("number")) return item.message.includes("got int");
473:   if (wanted.message.includes("null")) return item.message.includes("got null");
474:   return item.message.includes("expects");
475: }
476: 
477: // @ref LLP 1002#diagnostics-say-the-fix — fixes use the declared catalog and never hide a missing bound.
478: export function registerDiagnosticFixChecks(test: Test): void {
479:   const schema = `use identity
480: table conversations:
481:   title: text <=80
482:   public
483: table memberships:
484:   conversationId: conversations
485:   principal: principal
486:   unique byConversationPrincipal: conversationId, principal
487:   by byPrincipalConversation: principal, conversationId
488:   public
489: table posts:
490:   authorId: principal
491:   body: text <=100
492:   at: time
493:   status: enum('open', 'closed')
494:   by byTime: at, id
495:   by byAuthorTime: authorId, at, id
496:   public
497: `;
498:   const cases = [
499:     { name: "walk rejects a wrong self-reference type", source: "query one(id: posts):\n  return walk posts[id] up .body depth 3", message: "requires a self-reference column", fixes: ["declare body: posts ?"], code: "E_QUARRY_TYPE" },
500:     { name: "walk misspelled column", source: "query one(id: posts):\n  return walk posts[id] up .bodu depth 3", message: "unknown posts field", fixes: ["did you mean `body`?"], code: "E_QUARRY_UNKNOWN" },
501:     { name: "unknown call preserves fallback", source: "fn identity from access\nquery one():\n  return idnetity(1)", message: "unknown fn", fixes: ["did you mean `identity`?", "use a direct Quarry pure builtin"], code: "E_QUARRY_UNKNOWN" },
502:     { name: "empty range needs a bound", source: "query all():\n  return posts[]", message: "`posts[]` reads a range; name its bound", fixes: ["posts[] first 50 by byTime", "posts[] first 50 by byAuthorTime"], code: "E_UNBOUND_SCAN" },
503:     { name: "principal prefix needs a bound", source: "query any(p: principal):\n  return memberships[p]", message: "`memberships[p]` reads a range; name its bound", fixes: ["memberships[p] first 50 by byPrincipalConversation", "principal: principal"], code: "E_UNBOUND_SCAN" },
504:     { name: "explicit nonunique prefix needs a bound", source: "query any(p: principal):\n  return memberships[p] by byPrincipalConversation", message: "reads a range; name its bound", fixes: ["first 50 by byPrincipalConversation"], code: "E_UNBOUND_SCAN" },
505:     { name: "unknown keys keep declared types", source: "query any(p: principal, flag: bool):\n  return memberships[p, flag]", message: "matches [principal, bool]", fixes: ["conversationId: conversations", "principal: principal"], code: "E_QUARRY_UNKNOWN" },
506:     { name: "column case typo", source: "mutation add():\n  insert posts { authorid: viewer }", message: "unknown posts field `authorid`", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_TYPE" },
507:     { name: "index transposition", source: "query all():\n  return posts[] first 50 by byTmie", message: "has no index", fixes: ["did you mean `byTime`?"], code: "E_QUARRY_UNKNOWN" },
508:     { name: "merge index transposition", source: "query all():\n  return merge posts first 50 by byAuthorTmie:\n    [viewer]", message: "has no index", fixes: ["did you mean `byAuthorTime`?"], code: "E_QUARRY_UNKNOWN" },
509:     { name: "enum transposition", source: "mutation add():\n  insert posts { authorId: viewer, body: 'Hi', at: now, status: 'opne' }", message: "enum literal", fixes: ["did you mean `open`?"], code: "E_QUARRY_TYPE" },
510:     { name: "named key column spelling", source: "query all(p: principal):\n  return posts[authorid = p] first 5 by byAuthorTime", message: "unknown posts field", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_UNKNOWN" },
511:     { name: "table transposition", source: "query all():\n  return psots[] first 5 by byTime", message: "unknown table", fixes: ["did you mean `posts`?"], code: "E_QUARRY_UNKNOWN" },
512:     { name: "row column spelling", source: "query one(p: posts):\n  return posts[p].authorid", message: "unknown posts field", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_TYPE" },
513:     { name: "fn spelling", source: "fn idnetity from access\nquery one():\n  return idnetity(1)", message: "unknown fn", fixes: ["did you mean `identity`?"], code: "E_QUARRY_UNKNOWN" },
514:     { name: "proc spelling", source: "proc stroe from access\nmutation one():\n  stroe()", message: "unknown proc", fixes: ["did you mean `store`?"], code: "E_QUARRY_UNKNOWN" },
515:     { name: "shape spelling", source: "shape crad from access\nquery one(p: posts):\n  return posts[p] crad", message: "unknown shape", fixes: ["did you mean `card`?"], code: "E_QUARRY_UNKNOWN" },
516:     { name: "module spelling", source: "fn identity from acceess\nquery one():\n  return identity(1)", message: "unknown fn module", fixes: ["did you mean `access`?"], code: "E_QUARRY_UNKNOWN" },
517:     { name: "op spelling", source: "mutation store():\n  return null\nschedule sweep every 1m: stroe()", message: "schedule target", fixes: ["did you mean `store`?"], code: "E_SCHEDULE_TARGET" },
518:     { name: "intrinsic-only range needs a bound", source: "query all():\n  return conversations[]", message: "reads a range; name its bound", fixes: ["conversations[] first 50 by byId"], code: "E_UNBOUND_SCAN" },
519:     { name: "distant column lists names", source: "mutation add():\n  insert posts { unrelated: viewer }", message: "unknown posts field", fixes: ["authorId", "body", "status"], code: "E_QUARRY_TYPE" },
520:   ];
521:   test("diagnostic fix: implicit walk id prescribes a legal self-reference repair", async () => {
522:     let rewrite = "";
523:     await withProject({ "snapback/schema.q": schema,
524:       "snapback/ops.q": "query one(id: posts):\n  return walk posts[id] up .id depth 3\n" }, async root => {
525:       const result = await lowerProject(root);
526:       assert(!result.ok, "implicit id must not be a walk edge");
527:       const diagnostic = result.diagnostics[0]!;
528:       rewrite = diagnostic.rewrite;
529:       assert(diagnostic.code === "E_QUARRY_TYPE" && diagnostic.guide === "quarry", JSON.stringify(diagnostic));
530:       assert(!rewrite.includes("declare id:") && rewrite.includes("declare parent: posts ?")
531:         && rewrite.includes("walk posts[id] up .parent depth 3"), rewrite);
532:     });
533:     const declaration = rewrite.match(/declare (parent: posts \?)/)![1]!;
534:     const walk = rewrite.match(/walk posts\[id\] up \.parent depth 3/)![0];
535:     await withProject({ "snapback/schema.q": schema.replace("table posts:", `table posts:\n  ${declaration}`),
536:       "snapback/ops.q": `query one(id: posts):\n  return ${walk}\n` }, async root => {
537:       const repaired = await lowerProject(root);
538:       assert(repaired.ok, JSON.stringify(repaired));
539:     });
540:   });
541:   for (const item of cases) test(`diagnostic fix: ${item.name}`, async () => {
542:     await withProject({ "snapback/schema.q": schema, "snapback/posts.q": item.source + "\n",
543:       "snapback/access.q": "fn identity(v: int): v\nshape card = { * }\nproc store():\n  insert posts { authorId: viewer, body: 'Hi', at: now, status: 'open' }\n",
544:     }, async root => {
545:       const result = await lowerProject(root);
546:       assert(!result.ok, "invalid source escaped");
547:       const diagnostic = result.diagnostics.find(d => d.code === item.code && d.message.includes(item.message));
548:       assert(diagnostic && item.fixes.every(fix => diagnostic.rewrite.includes(fix)), JSON.stringify(result));
549:       if (item.code === "E_UNBOUND_SCAN" || item.code === "E_QUARRY_TYPE") assert(diagnostic.guide === "quarry", JSON.stringify(diagnostic));
550:       assert(!diagnostic.message.includes("[?]"), JSON.stringify(diagnostic));
551:       if (item.name === "walk rejects a wrong self-reference type") assert(!diagnostic.rewrite.includes("did you mean `body`"), JSON.stringify(diagnostic));
552:       if (item.name.startsWith("distant")) assert(!diagnostic.rewrite.includes("did you mean"), JSON.stringify(diagnostic));
553:     });
554:   });
555: 
556:   test("diagnostic fix: cap suggestions retain a compiling repair", async () => {
557:     await withProject({ "snapback/schema.q": schema.replace("  by byTime:", "  cap 50 by authorid\n  by byTime:"),
558:       "snapback/ops.q": "query one():\n  return null\n" }, async root => {
559:       const result = await lowerProject(root);
560:       assert(!result.ok, "misspelled cap compiled");
561:       const rewrite = result.diagnostics[0]!.rewrite;
562:       assert(rewrite.includes("did you mean `authorId`?") && rewrite.includes("cap 50 by authorId"), rewrite);
563:     });
564:     await withProject({ "snapback/schema.q": schema.replace("  by byTime:", "  cap 50 by authorId\n  by byTime:"),
565:       "snapback/ops.q": "query one():\n  return null\n" }, async root => assert((await lowerProject(root)).ok, "cap repair failed"));
566:   });
567:   for (const [kind, use, repair] of [["fn", "missing(1)", "fn missing(value: int): value"], ["shape", "posts[id] missing", "shape missing = { * }"], ["proc", "missing(1)", "proc missing(value: int):"]]) {
568:     for (const module of ["access", "unavailable"]) test(`diagnostic fix: ${kind} empty catalog ${module}`, async () => {
569:       const source = `${kind} missing from ${module}\n${kind === "proc" ? "mutation" : "query"} one(id: posts):\n  ${kind === "proc" ? use + "\n  return null" : "return " + use}\n`;
570:       await withProject({ "snapback/schema.q": schema, "snapback/ops.q": source,
571:         "snapback/access.q": "query ping():\n  return null\n" }, async root => {
572:         const result = await lowerProject(root);
573:         assert(!result.ok, "unknown declaration compiled");
574:         const rewrite = result.diagnostics[0]!.rewrite;
575:         assert(rewrite.includes(module === "access" ? repair : "create snapback/unavailable.q"), rewrite);
576:       });
577:     });
578:   }
579: 
580:   test("diagnostic fix: every emitted Require has source attribution", async () => {
581:     await withProject({ "snapback/schema.q": schema,
582:       "snapback/ops.q": `query one(id: posts):
583:   require true else MISSING
584:   return posts[id] ! else MISSING
585: mutation remove(c: conversations, p: principal):
586:   delete memberships[c, p]
587:   return null
588: ` }, async root => {
589:       const result = await lowerProject(root);
590:       assert(result.ok, JSON.stringify(result));
591:       for (const program of result.project.programs) {
592:         const emitted = JSON.stringify(program.body).match(/"Require":/g)?.length ?? 0;
593:         const recorded = Object.entries(result.sources).filter(([site, source]) => site.startsWith(program.name + "/require/") && source.requirement).length;
594:         assert(emitted === recorded, `${program.name}: ${emitted} Require, ${recorded} source associations`);
595:       }
596:     });
597:   });
598: 
599:   test("diagnostic fix: named range lists matching ranges before exact unique choices", async () => {
600:     await withProject({ "snapback/schema.q": schema.replace("  by byPrincipalConversation:", "  unique byPrincipal: principal\n  by byPrincipalConversation:"),
601:       "snapback/posts.q": "query one(p: principal):\n  return memberships[p] by byPrincipalConversation\n" }, async root => {
602:       const result = await lowerProject(root);
603:       assert(!result.ok, "nonunique point escaped");
604:       const rewrite = result.diagnostics[0]!.rewrite;
605:       assert(rewrite.includes("memberships[p] first 50 by byPrincipalConversation; memberships[p] by byPrincipal"), rewrite);
606:       assert(!rewrite.includes("byConversationPrincipal"), rewrite);
607:     });
608:   });
609:   for (const clause of ["by byOwner: authorid", "immutable authorid", "read <- .authorid = viewer"]) {
610:     test(`diagnostic fix: schema column in ${clause}`, async () => {
611:       await withProject({ "snapback/schema.q": schema.replace("  by byTime:", `  ${clause}\n  by byTime:`).replace(/  public\n$/, ""),
612:         "snapback/posts.q": "query one():\n  return null\n" }, async root => {
613:         const result = await lowerProject(root);
614:         assert(!result.ok && result.diagnostics.some(d => d.rewrite.includes("did you mean `authorId`?")), JSON.stringify(result));
615:       });
616:     });
617:   }
618: 
619: }
```

## snapback2/packages/snapback2/tests/real-owner-prediction.test.ts

```text
1: import assert from "node:assert/strict";
2: import { after, test } from "node:test";
3: import { api,
4:   createClient,
5:   initialQueryState,
6:   reduceQueryState } from "../dist/client.mjs";
7: import { RefusalError } from "../dist/client-observed-test.mjs";
8: import { configureRealOwner, RealOwnerHarness } from "./owner-harness.ts";
9: 
10: const owner = await configureRealOwner();
11: after(async () => owner.close());
12: 
13: // @ref LLP 1018#4-move-two-efficient-execution-and-certification-that-agree — maintained cap
14: // rows must be acquired through ordinary reads; unheld counts are not zero.
15: test("public count reads enable multi-principal offline cap prediction without inventing missing counts", async (t) => {
16:   if (!owner.owned) return t.skip("requires an isolated self-started count owner");
17:   const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
18:   const { tmpdir } = await import("node:os");
19:   const { join } = await import("node:path");
20:   const { fileRangeStore } = await import("../dist/test.mjs");
21:   const previousUrl = process.env.SNAPBACK_URL;
22:   delete process.env.SNAPBACK_URL;
23:   const directory = await mkdtemp(join(tmpdir(), "snapback-public-counts-"));
24:   const fixture = join(directory, "source");
25:   const longRealm = "😀".repeat(64);
26:   const longRealmRef = JSON.stringify([{ Id: "dev:alice" }, { String: longRealm }]);
27:   let local: RealOwnerHarness | undefined;
28:   const clients: ReturnType<typeof createClient>[] = [];
29:   try {
30:     await mkdir(fixture);
31:     await writeFile(join(fixture, "schema.q"), `use identity
32: 
33: table capEntries:
34:   principal: principal
35:   author: principal
36:   by byPrincipal: principal, id
37:   cap 3 by principal
38:   read <- allow
39:   insert <- .author = viewer
40:   update <- deny
41:   delete <- deny
42: 
43: maintain principalCounts: count capEntries by principal
44:   read <- allow
45: 
46: table realmMemberships:
47:   principal: principal
48:   realm: text <=64 ?
49:   by byPrincipalRealm: principal, realm, id
50:   read <- allow
51:   insert <- allow
52:   update <- deny
53:   delete <- deny
54: 
55: maintain realmCounts: count realmMemberships by principal, realm
56:   read <- allow
57: 
58: table refCapEntries:
59:   realm: realmCounts
60:   author: principal
61:   by byRealm: realm, id
62:   cap 3 by realm
63:   read <- allow
64:   insert <- .author = viewer
65:   update <- deny
66:   delete <- deny
67: 
68: maintain refCounts: count refCapEntries by realm
69:   read <- allow
70: `);
71:     await writeFile(join(fixture, "caps.q"), `query countFor(principal: principal):
72:   return principalCounts[principal]
73: 
74: query entriesFor(principal: principal):
75:   return capEntries[principal] first 50 by byPrincipal
76: 
77: mutation allocate(principals: [principal] <=49):
78:   for principal in principals:
79:     insert capEntries { principal, author: viewer }
80:   return null
81: 
82: query refCountFor(realm: realmCounts):
83:   return refCounts[realm]
84: 
85: mutation allocateRef(realms: [realmCounts] <=3):
86:   for realm in realms:
87:     insert refCapEntries { realm, author: viewer }
88:   return null
89: `);
90:     const sizes = { heldA: 1, heldB: 1, unheldA: 1, unheldB: 1, rollbackA: 1, full: 3 };
91:     const rows = Object.entries(sizes).flatMap(([principal, size]) => Array.from({ length: size }, (_, index) => ({
92:       id: `${principal}-${index}`, principal: `dev:${principal}`, author: "dev:alice",
93:     })));
94:     await writeFile(join(fixture, "seed.ts"), `import { seed } from 'snapback2';\nexport default seed(${JSON.stringify({ personas: ["alice"], rows: {
95:       capEntries: rows, realmMemberships: [{ id: "long-realm", principal: "dev:alice", realm: longRealm }],
96:     } })});\n`);
97:     local = await RealOwnerHarness.create({ fixture });
98:     const observer = createClient({ url: local.url, persona: "alice" });
99:     clients.push(observer);
100:     const count = async (client: ReturnType<typeof createClient>, principal: string) => {
101:       const result: any = await client.query(api.caps.countFor, { principal: `dev:${principal}` });
102:       assert.equal(result.state, "complete", JSON.stringify(result));
103:       return result.data;
104:     };
105:     const scenarios = [
106:       { name: "held", principals: ["heldA", "heldB"], hold: ["heldA", "heldB"], predicted: true, final: [2, 2] },
107:       { name: "unheld", principals: ["unheldA", "unheldB"], hold: ["unheldA"], predicted: false, final: [2, 2] },
108:       { name: "zero", principals: ["zero"], hold: ["zero"], predicted: true, final: [3] },
109:       { name: "overflow", principals: ["rollbackA", "full"], hold: ["rollbackA", "full"], predicted: false, final: [1, 3] },
110:     ];
111:     for (const scenario of scenarios) {
112:       const reads: any[] = [];
113:       let mutations = 0;
114:       let client = createClient({ url: local.url, offline: { store: fileRangeStore(join(directory, scenario.name)) },
115:         fetch: async (input, init) => {
116:           const response = await fetch(input, init);
117:           const path = new URL(String(input)).pathname;
118:           if (path === "/api/query") reads.push(await response.clone().json());
119:           if (path === "/api/mutation") mutations++;
120:           return response;
121:         } });
122:       clients.push(client);
123:       await client.ready;
124:       await client.auth.guest();
125:       const before = await Promise.all(scenario.hold.map(principal => count(client, principal)));
126:       await client.online();
127:       const readiness = await client.outbox.status(api.caps.allocate);
128:       assert.equal(readiness.ready, true, JSON.stringify(readiness));
129:       assert.ok(reads.every(read => (read.rows ?? []).every((row: any) => row.table !== "capEntries")), "count queries did not preload source rows");
130:       if (scenario.name === "zero") {
131:         assert.deepEqual(before, [0], "the owner proved zero through the public count query");
132:         const receipt = reads.at(-1).receipt;
133:         assert.ok(receipt.absences.some(([table, index, key]: any) =>
134:           table === "principalCounts" && index === "byId"
135:           && key[0] === JSON.stringify([{ Id: "dev:zero" }])));
136:         assert.ok(receipt.ranges.some((range: any) => range.table === "principalCounts"
137:           && range.prefix[0]?.Scalar === "dev:zero" && range.stop === "Exhausted"
138:           && range.absence && range.rowIds.length === 0), "the owner supplies independent group absence");
139:         t.diagnostic(`zero public query receipt: ${JSON.stringify(reads)}`);
140:       }
141:       await client.offline();
142:       const readsBeforeReopen = reads.length;
143:       client = await client.restart();
144:       clients.push(client);
145:       if (scenario.name === "zero") {
146:         const cold = await client.query(api.caps.countFor, { principal: "dev:zero" });
147:         assert.equal(cold.state, "complete", "the delivered scalar answer remains cached");
148:         assert.equal(cold.data, 0);
149:         assert.equal(cold.live, false);
150:         assert.ok(cold.stale, "a cached zero is a stale answer, not new group-absence authority");
151:       } else {
152:         assert.deepEqual(await Promise.all(scenario.hold.map(principal => count(client, principal))), before,
153:           "held count rows remain complete after a cold offline carrier reopen");
154:       }
155:       assert.equal(reads.length, readsBeforeReopen, "cold held counts do not reacquire network evidence");
156:       const queued = await client.mutation(api.caps.allocate, { principals: scenario.principals.map(principal => `dev:${principal}`) });
157:       assert.equal(queued.state, "queued");
158:       assert.equal(mutations, 0, "offline allocation sends no mutation bytes");
159:       const [entry] = await client.outbox.entries();
160:       assert.equal(entry.predicted === true, scenario.predicted, `${scenario.name}: ${JSON.stringify(entry)}`);
161:       if (!scenario.predicted) assert.deepEqual(entry.trace, { points: [], verdicts: [] });
162:       if (scenario.predicted) {
163:         for (let index = 0; index < scenario.principals.length; index++) {
164:           assert.equal(await count(client, scenario.principals[index]), before[index] + 1, "held count advances in the offline overlay");
165:         }
166:       }
167:       if (scenario.name === "zero") {
168:         // Reopen with an actual predicted aggregate, then consume the remaining
169:         // capacity through the same public queue. A fourth insert cannot predict.
170:         client = await client.restart();
171:         clients.push(client);
172:         assert.equal(await count(client, "zero"), 1);
173:         for (const nextCount of [2, 3, 4]) {
174:           await client.mutation(api.caps.allocate, { principals: ["dev:zero"] });
175:           const latest = (await client.outbox.entries()).at(-1)!;
176:           assert.equal(latest.predicted === true, nextCount <= 3);
177:           assert.equal(await count(client, "zero"), Math.min(nextCount, 3));
178:         }
179:         assert.equal(mutations, 0);
180:         assert.equal(reads.length, readsBeforeReopen);
181:       }
182:       await client.online();
183:       assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
184:       const [settled] = await client.outbox.entries();
185:       assert.equal(settled.state, scenario.name === "overflow" ? "rejected" : "committed");
186:       if (scenario.name === "overflow") assert.equal((settled.response as any).code, "E_CONSTRAINT");
187:       if (scenario.name === "zero") {
188:         const settledEntries = await client.outbox.entries();
189:         assert.deepEqual(settledEntries.map(entry => entry.state), ["committed", "committed", "committed", "rejected"]);
190:         assert.equal((settledEntries.at(-1)!.response as any).code, "E_CONSTRAINT");
191:       }
192:       const actual = await Promise.all(scenario.principals.map(principal => count(observer, principal)));
193:       assert.deepEqual(actual, scenario.final, "owner counts prove complete commit or atomic rollback");
194:       t.diagnostic(`${scenario.name}: ${JSON.stringify({ before, predicted: entry.predicted === true, trace: entry.trace, state: settled.state, final: actual })}`);
195:       await client.close();
196:     }
197: 
198:     const longRealmRefBytes = Buffer.byteLength(longRealmRef, "utf8");
199:     assert.ok(longRealmRefBytes > 144, "the Ref exceeds the ordinary identity byte domain");
200:     const reads: any[] = [];
201:     let mutations = 0;
202:     const refCountFor = (api as any).caps.refCountFor;
203:     const allocateRef = (api as any).caps.allocateRef;
204:     let refClient = createClient({ url: local.url, offline: { store: fileRangeStore(join(directory, "long-ref")) },
205:       fetch: async (input, init) => {
206:         const response = await fetch(input, init);
207:         const path = new URL(String(input)).pathname;
208:         if (path === "/api/query") reads.push(await response.clone().json());
209:         if (path === "/api/mutation") mutations++;
210:         return response;
211:       } });
212:     clients.push(refClient); await refClient.ready; await refClient.auth.guest();
213:     const before: any = await refClient.query(refCountFor, { realm: longRealmRef });
214:     assert.equal(before.state, "complete", JSON.stringify(before)); assert.equal(before.data, 0);
215:     const evidence = reads.at(-1).receipt;
216:     assert.ok(evidence.ranges.some((range: any) => range.table === "refCounts"
217:       && range.prefix[0]?.Scalar === longRealmRef && range.absence && range.stop === "Exhausted"));
218:     assert.ok(evidence.absences.some(([table, index, key]: any) => table === "refCounts" && index === "byId"
219:       && key[0] === JSON.stringify([{ Id: longRealmRef }])));
220:     await refClient.offline(); const readsBeforeReopen = reads.length;
221:     refClient = await refClient.restart(); clients.push(refClient);
222:     const cold: any = await refClient.query(refCountFor, { realm: longRealmRef });
223:     assert.equal(cold.state, "complete"); assert.equal(cold.data, 0); assert.equal(cold.live, false);
224:     const queued = await refClient.mutation(allocateRef, { realms: [longRealmRef] });
225:     assert.equal(queued.state, "queued"); assert.equal(mutations, 0);
226:     assert.equal((await refClient.outbox.entries())[0].predicted, true);
227:     const predicted: any = await refClient.query(refCountFor, { realm: longRealmRef });
228:     assert.equal(predicted.state, "complete"); assert.equal(predicted.data, 1);
229:     assert.equal(reads.length, readsBeforeReopen);
230:     await refClient.online(); assert.deepEqual(await refClient.outbox.drain(), { stopped: false, remaining: 0 });
231:     const final: any = await observer.query(refCountFor, { realm: longRealmRef });
232:     assert.equal(final.state, "complete"); assert.equal(final.data, 1);
233:     t.diagnostic(`long maintained Ref: ${JSON.stringify({ utf8Bytes: longRealmRefBytes, cold: cold.data,
234:       predicted: predicted.data, final: final.data })}`);
235:     await refClient.close();
236:   } finally {
237:     for (const client of clients) await client.close();
238:     await local?.close();
239:     await rm(directory, { recursive: true, force: true });
240:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
241:     else process.env.SNAPBACK_URL = previousUrl;
242:   }
243: });
244: 
245: // @ref LLP 1012#6-reads-offline — consume public exhaustion without mixing an old computed answer with newer row images.
246: test("a durable observed row and zero count survives receipt replay, owner changes and cold reopen", async () => {
247:   const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
248:   const { tmpdir } = await import("node:os");
249:   const { join } = await import("node:path");
250:   const { fileRangeStore } = await import("../dist/test.mjs");
251:   const { answerOffline } = await import("../dist/client-observed-test.mjs");
252:   const { itemInputs } = await import("../dist/image-runtime.mjs");
253:   const directory = await mkdtemp(join(tmpdir(), "snapback-count-composite-"));
254:   const fixture = join(directory, "source"), clients: any[] = [], stops: (() => void)[] = [];
255:   let local: RealOwnerHarness | undefined;
256:   const until = async (check: () => boolean, label: string) => {
257:     const end = Date.now() + 5_000;
258:     while (!check()) { assert(Date.now() < end, label); await new Promise(resolve => setTimeout(resolve, 10)); }
259:   };
260:   try {
261:     await mkdir(fixture);
262:     await writeFile(join(fixture, "schema.q"), `use identity
263: table rows:
264:   owner: principal
265:   label: text <=40
266:   public
267:   insert <- .owner = viewer
268:   update <- .owner = viewer
269:   delete <- .owner = viewer
270: 
271: table votes:
272:   target: rows
273:   owner: principal
274:   by byTarget: target
275:   public
276:   insert <- .owner = viewer
277:   update <- deny
278:   delete <- .owner = viewer
279: 
280: maintain counts: count votes by target
281:   read <- allow
282: `);
283:     await writeFile(join(fixture, "ops.q"), `query composite(target: rows):
284:   return { row: rows[target], count: counts[target] }
285: 
286: query row(target: rows):
287:   return rows[target]
288: 
289: mutation create(label: text <=40, positive: bool):
290:   row = insert rows { owner: viewer, label }
291:   if positive:
292:     insert votes { owner: viewer, target: row.id }
293:   return row.id
294: 
295: mutation rename(target: rows, label: text <=40):
296:   update rows[target] { label }
297:   return null
298: 
299: mutation remove(target: rows):
300:   delete rows[target]
301:   return null
302: `);
303:     local = await RealOwnerHarness.create({ forceOwned: true, fixture });
304:     let token: string | null = null;
305:     const tokenStore = { load: () => token, save: (value: string | null) => { token = value; } };
306:     const plain = createClient({ url: local.url, tokenStore }); clients.push(plain);
307:     await plain.auth.guest();
308:     for (const count of [0, 1]) {
309:       const made: any = await plain.mutation(api.ops.create, { label: `row ${count}`, positive: count === 1 });
310:       assert.equal(made.state, "committed");
311:       const target = made.data, refreshed: any[] = [];
312:       let client: any = createClient({ url: local.url, tokenStore, offline: { store: fileRangeStore(join(directory, `client-${count}`)) },
313:         offlineReadObserver: (_op: unknown, args: any, result: any) => {
314:           if (args.target === target) refreshed.push(result);
315:         } } as any);
316:       clients.push(client); await client.ready; await client.auth.me();
317:       const expected: any = await plain.query(api.ops.composite, { target });
318:       assert.equal(expected.state, "complete"); assert.equal(expected.data.count, count);
319:       const observed = client.observe(api.ops.composite, { target });
320:       stops.push(observed.subscribe(() => {}));
321:       await until(() => refreshed.length > 0, "the accepted owner receipt reaches local replay");
322:       assert.equal(refreshed[0].state, "complete", "the row/count composite must be reconstructible after its receipt commits");
323:       // Equal exact replay preserves live server provenance (client-observed.ts);
324:       // the receipt-commit observer above proves the local result, not just the first frame.
325:       await until(() => observed.getSnapshot().receipt?.state === "complete", "the observed publication remains complete after local replay");
326:       assert.equal(observed.getSnapshot().receipt.state, "complete");
327:       assert.deepEqual(observed.getSnapshot().data, expected.data);
328:       const firstSequence = observed.getSnapshot().receipt.seq;
329:       // An unrelated answer changes durable order while the owner sequence stays fixed.
330:       await client.query(api.ops.row, { target: "unrelated-missing" });
331:       await new Promise(resolve => setTimeout(resolve, 30));
332:       assert.equal(observed.getSnapshot().receipt.seq, firstSequence);
333:       assert.deepEqual(observed.getSnapshot().data, expected.data);
334:       const label = `changed ${count}`;
335:       assert.equal((await client.mutation(api.ops.rename, { target, label })).state, "committed");
336:       await until(() => refreshed.some(result => result.seq > firstSequence && result.data?.row?.label === label), "new owner row is replayed with its count");
337:       await until(() => observed.getSnapshot().data?.row?.label === label, "the observed client publishes the changed owner row");
338:       assert.equal(observed.getSnapshot().data.count, count);
339:       await client.offline(); client = await client.restart(); clients.push(client);
340:       const cold: any = await client.query(api.ops.composite, { target });
341:       assert.equal(cold.state, "complete"); assert.equal(cold.live, false);
342:       assert.equal(cold.data.row.label, label); assert.equal(cold.data.count, count);
343:       const coldObserved = client.observe(api.ops.composite, { target });
344:       stops.push(coldObserved.subscribe(() => {}));
345:       await until(() => coldObserved.getSnapshot().data?.row?.label === label, "cold observation replays the complete composite");
346:       assert.equal((await client.mutation(api.ops.remove, { target })).state, "queued");
347:       const overlay: any = await answerOffline(client.offlineRuntime, "ops.composite", { target }, (value: any) => value);
348:       assert(itemInputs(overlay)?.entries?.some((entry: any) => entry.predicted), "the removal control has an actual queued overlay");
349:       assert.equal(overlay.data?.row ?? null, null, "the held owner answer cannot revive the removed row");
350:       await client.close();
351:     }
352:   } finally {
353:     for (const stop of stops) stop();
354:     for (const client of clients) await client.close();
355:     await local?.close();
356:     await rm(directory, { recursive: true, force: true });
357:   }
358: });
```

## snapback2/packages/snapback2/tests/real-owner-successor.test.ts

```text
1: import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
2: import { tmpdir } from "node:os";
3: import { join, resolve } from "node:path";
4: import { spawnSync } from "node:child_process";
5: import { fileRangeStore } from "../dist/test.mjs";
6: import { subscribe } from "../src/internal.js";
7: import assert from "node:assert/strict";
8: import { test } from "node:test";
9: import { api, createClient, browserTokenStore } from "../dist/client.mjs";
10: import { answerOffline } from "../dist/client-observed-test.mjs";
11: import { RealOwnerHarness } from "./owner-harness.ts";
12: import React from "react";
13: import TestRenderer, { act } from "react-test-renderer";
14: import { SnapbackProvider, useQuery } from "../dist/react.mjs";
15: 
16: // @ref LLP 1018#6-move-four-evolution-of-the-whole-application —
17: // evolve populated data while real client intents remain in durable custody.
18: test("durable client intents survive a schema successor and a lost acknowledgement survives operation removal", async (t) => {
19:   if (process.env.SNAPBACK_URL) return t.skip("requires an isolated self-started successor owner");
20:   const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
21:   const { tmpdir } = await import("node:os");
22:   const { join } = await import("node:path");
23:   const { fileRangeStore } = await import("../dist/test.mjs");
24:   const previousUrl = process.env.SNAPBACK_URL;
25:   delete process.env.SNAPBACK_URL;
26:   let local: RealOwnerHarness | undefined;
27:   const directory = await mkdtemp(join(tmpdir(), "snapback-successor-client-"));
28:   const clients: ReturnType<typeof createClient>[] = [];
29:   const subscriptions: { close(): void }[] = [];
30:   const requests: { body: string; response: any }[] = [];
31:   const resets: any[] = [];
32:   let loseAcknowledgement = false;
33:   const observe: typeof fetch = async (input, init) => {
34:     const response = await fetch(input, init);
35:     const path = new URL(String(input)).pathname;
36:     if (path === "/api/resume") resets.push(await response.clone().json());
37:     if (path === "/api/mutation" && JSON.parse(String(init?.body)).op === "messages.send") {
38:       const body = await response.clone().json();
39:       requests.push({ body: String(init?.body), response: body });
40:       if (loseAcknowledgement && body.state === "committed") {
41:         loseAcknowledgement = false;
42:         // The real owner committed. Only its delivery to this client is lost.
43:         throw new TypeError("simulated connection loss after durable commit");
44:       }
45:     }
46:     return response;
47:   };
48:   try {
49:     local = await RealOwnerHarness.create({ withDeliveries: true });
50:     const makeClient = () => {
51:       const client = createClient({ url: local!.url, persona: "alice", fetch: observe,
52:         offline: { store: fileRangeStore(directory) } });
53:       clients.push(client);
54:       return client;
55:     };
56:     const warm = async (client: ReturnType<typeof createClient>) => {
57:       await client.ready;
58:       const sub = subscribe(client, api.messages.inbox, { c: null }, () => {}, { drain: true });
59:       subscriptions.push(sub);
60:       await sub.until(event => event.live === true, 5_000);
61:       assert.equal((await client.outbox.status(api.messages.send)).ready, true);
62:       return sub;
63:     };
64:     const first = makeClient();
65:     const drain = await warm(first);
66:     const before: any = await first.query(api.messages.thread, { conversationId: "conversation-1", c: null });
67:     assert.equal(before.state, "complete");
68:     assert.equal(before.next, null);
69:     const baselineCount: any = await first.query(api.messages.conversationView, { conversationId: "conversation-1" });
70:     await first.offline();
71:     const queued = [];
72:     for (const body of ["successor first", "successor second"]) {
73:       const result = await first.mutation(api.messages.send, { conversationId: "conversation-1", body });
74:       assert.equal(result.state, "queued");
75:       queued.push(result);
76:     }
77:     const admitted = (await first.outbox.entries()).filter(entry => entry.op === "messages.send");
78:     assert.equal(admitted.length, 2);
79:     assert.equal(admitted[0].predicted, true);
80:     assert.equal(admitted[1].predicted, true);
81:     assert.equal(requests.length, 0, "offline admission sends nothing");
82:     drain.close();
83:     await first.close();
84:     await local.stop();
85:     const schemaPath = join(local.root!, "snapback/schema.q");
86:     const schema = await readFile(schemaPath, "utf8");
87:     assert.ok(schema.includes("table messages:\n"));
88:     await writeFile(schemaPath, schema.replace("table messages:\n", "table messages:\n  category: text <=40 ?\n"));
89:     await local.start(false);
90:     // Fix round r1, item 5: the cold-open route (the schema changed while the owner was
91:     // down) writes the same `successor: applied` line the hot installation writes.
92:     const coldLog = (await readFile(join(local.root!, ".snapback/log.jsonl"), "utf8")).trim().split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; /* a record the owner is still writing */ } });
93:     const coldApplied = coldLog.filter(line => line.successor === "applied" && line.report?.addedColumns?.includes("messages.category"));
94:     assert.equal(coldApplied.length, 1, `cold open logs the successor once: ${JSON.stringify(coldLog.filter(line => line.successor))}`);
95:     assert.ok(coldApplied[0].report.from && coldApplied[0].report.to && coldApplied[0].report.from !== coldApplied[0].report.to, JSON.stringify(coldApplied[0]));
96: 
97:     const reopened = makeClient();
98:     await reopened.ready;
99:     await reopened.online();
100:     assert.deepEqual(await reopened.outbox.drain(), { stopped: false, remaining: 0 });
101:     assert.ok(resets.some(result => result.code === "E_OFFLINE_RESET"), "the real owner requires successor recovery");
102:     assert.deepEqual(requests.map(request => JSON.parse(request.body)), admitted.map(entry => ({
103:       op: entry.op, args: entry.args, replay: { grant: entry.grant, offset: entry.offset,
104:         count: entry.count, intent: entry.intent, trace: entry.trace ?? { points: [], verdicts: [] } },
105:     })), "FIFO replay preserves every admitted envelope field after close, schema reset, and reopen");
106:     const terminals = await reopened.outbox.entries();
107:     for (const entry of admitted) {
108:       const terminal = terminals.find(result => result.intent === entry.intent)!;
109:       assert.equal(terminal.state, "rejected");
110:       assert.equal((terminal.response as any).code, "E_OFFLINE_CONFLICT");
111:       assert.match((terminal.response as any).site, /^rule:/);
112:     }
113:     // Rule verdicts bind the complete schema. Even this optional addition
114:     // invalidates predecessor verdicts; new-generation intent admission is
115:     // an explicit user retry, never a rewrite of an existing envelope.
116:     const conflicted: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
117:     assert.equal(conflicted.data.length, before.data.length, "the conflicted sends wrote no messages");
118:     for (const body of ["successor first", "successor second"]) {
119:       const result = await reopened.mutation(api.messages.send, { conversationId: "conversation-1", body });
120:       assert.equal(result.state, "committed", JSON.stringify(result));
121:       assert.ok(!admitted.some(entry => entry.intent === JSON.parse(requests.at(-1)!.body).replay.intent));
122:     }
123:     const after: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
124:     assert.equal(after.state, "complete");
125:     assert.equal(after.next, null);
126:     for (const row of before.data) {
127:       const actual = after.data.find((value: any) => value.id === row.id);
128:       assert.ok(actual, `preserved message ${row.id}`);
129:       assert.equal(actual.message.category, null);
130:       const { category, ...originalFields } = actual.message;
131:       assert.deepEqual(originalFields, row.message);
132:     }
133:     for (const body of ["successor first", "successor second"]) assert.equal(after.data.filter((row: any) => row.message?.body === body).length, 1);
134:     const afterCount: any = await reopened.query(api.messages.conversationView, { conversationId: "conversation-1" });
135:     assert.equal(afterCount.data.count, baselineCount.data.count + 2);
136:     t.diagnostic(`schema reset preserved ${before.data.length} original messages; two predicted intents settled E_OFFLINE_CONFLICT, and two explicit new intents advanced the first room count by two`);
137: 
138:     // A committed-but-unacknowledged intent must still settle if its operation
139:     // disappears before a cold client retries. New calls cannot use that op.
140:     const reopenedDrain = await warm(reopened);
141:     loseAcknowledgement = true;
142:     const uncertain = await reopened.mutation(api.messages.send, { conversationId: "conversation-1", body: "ack lost before removal" });
143:     assert.equal(uncertain.state, "queued");
144:     const originalRequest = requests.at(-1)!;
145:     assert.equal(originalRequest.response.state, "committed");
146:     reopenedDrain.close();
147:     await reopened.close();
148:     await local.stop();
149:     const operationPath = join(local.root!, "snapback/messages.q");
150:     const operations = await readFile(operationPath, "utf8");
151:     assert.ok(operations.includes("mutation send("));
152:     await writeFile(operationPath, operations.replace("mutation send(", "mutation sendAfterEvolution("));
153:     await local.start(false);
154:     const retry = makeClient();
155:     await retry.ready;
156:     await retry.online();
157:     assert.deepEqual(await retry.outbox.drain(), { stopped: false, remaining: 0 });
158:     const retried = requests.filter(request => JSON.parse(request.body).replay.intent === uncertain.intent);
159:     assert.equal(retried.length, 2, "one original attempt and one cold retry");
160:     assert.equal(retried[1].body, originalRequest.body, "exact request bytes survive operation removal");
161:     assert.deepEqual(retried[1].response, originalRequest.response, "the owner returns its stored terminal");
162:     assert.match((originalRequest.response as any).program?.planHash, /^[a-f0-9]{64}$/);
163:     assert.match((originalRequest.response as any).program?.schemaHash, /^[a-f0-9]{64}$/);
164:     const terminal = (await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)!;
165:     assert.equal((terminal.response as any).program.planHash, terminal.targets?.planHash,
166:       "lost acknowledgement retains the original allocation proof after operation removal");
167:     assert.equal((await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)?.state, "committed");
168:     const final: any = await retry.query(api.messages.thread, { conversationId: "conversation-1", c: null });
169:     assert.equal(final.state, "complete");
170:     assert.equal(final.data.filter((row: any) => row.message?.body === "ack lost before removal").length, 1);
171:     const rejected = await fetch(`${local.url}/api/mutation`, { method: "POST",
172:       headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
173:       body: JSON.stringify({ op: "messages.send", args: { conversationId: "conversation-1", body: "new forbidden call" } }) });
174:     assert.equal((await rejected.json()).code, "E_OP_UNKNOWN");
175:     t.diagnostic("lost acknowledgement retried byte-identically after operation removal; stored terminal settled with one message; new call refused E_OP_UNKNOWN");
176:   } finally {
177:     for (const sub of subscriptions) sub.close();
178:     for (const client of clients) await client.close();
179:     await local?.close();
180:     await rm(directory, { recursive: true, force: true });
181:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
182:     else process.env.SNAPBACK_URL = previousUrl;
183:   }
184: });
185: 
186: 
187: // @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
188: // even an immediate empty-effect compaction must hand the online caller its terminal.
189: test("real owner no-op successes compact with zero readers and preserve each issuing result", async (t) => {
190:   if (process.env.SNAPBACK_URL) return t.skip("requires isolated owner");
191:   const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
192:   const { tmpdir } = await import("node:os"), { join } = await import("node:path");
193:   const { fileRangeStore } = await import("../dist/test.mjs");
194:   const root = await mkdtemp(join(tmpdir(), "snapback-compacted-result-"));
195:   const previousUrl = process.env.SNAPBACK_URL;
196:   let local: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
197:   try {
198:     local = await RealOwnerHarness.create({ prepare: async project => {
199:       await writeFile(join(project, "snapback/noop.q"), "mutation echo(value: int):\n  return value\n");
200:     } });
201:     const factory = fileRangeStore(root);
202:     client = createClient({ url: local.url, offline: { store: factory } });
203:     await client.ready;
204:     const session = await client.auth.guest();
205:     for (let value = 0; value < 20; value++) {
206:       const result = await client.mutation(api.noop.echo, { value });
207:       assert.equal(result.state, "committed", JSON.stringify(result));
208:       if (result.state === "committed") { assert.equal(result.data, value); assert.deepEqual(result.effects, []); }
209:       assert.deepEqual(await client.outbox.entries(), [], "zero observers; no success accumulates");
210:     }
211:     await client.close(); client = undefined;
212:     const reopened = factory(); await reopened.open(session.viewer);
213:     assert.deepEqual(await reopened.outbox.all(), []);
214:     assert((await reopened.outbox.compactedThrough!()) > 0);
215:     await reopened.close?.();
216:   } finally {
217:     await client?.close(); await local?.close(); await rm(root, { recursive: true, force: true });
218:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
219:   }
220: });
221: 
222: test("real chat sends compact after own fanout and maintained count arrive", async (t) => {
223:   if (process.env.SNAPBACK_URL) return t.skip("requires isolated owner");
224:   const { mkdtemp, rm } = await import("node:fs/promises");
225:   const { tmpdir } = await import("node:os"), { join } = await import("node:path");
226:   const { fileRangeStore } = await import("../dist/test.mjs");
227:   const root = await mkdtemp(join(tmpdir(), "snapback-compacted-chat-"));
228:   let local: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
229:   let drain: { close(): void } | undefined;
230:   try {
231:     local = await RealOwnerHarness.create({ fullChat: true });
232:     client = createClient({ url: local.url, persona: "alice", offline: { store: fileRangeStore(root) } });
233:     await client.ready;
234:     const tail = subscribe(client, api.messages.inbox, { c: null }, () => undefined, { drain: true });
235:     drain = tail;
236:     await tail.until(value => "caughtUp" in value && value.caughtUp === true);
237:     for (let n = 0; n < 10; n++) {
238:       const result = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: `compact ${n}` });
239:       assert.equal(result.state, "committed", JSON.stringify(result));
240:       if (result.state === "committed") assert.deepEqual(result.effects?.map(row => row.table).sort(), ["deliveries", "deliveriesReceipts", "deliveriesReceipts", "messageCounts", "messages"]);
241:       const view = await client.query(api.messages.conversationView, { conversationId: "conversation-1", c: null });
242:       assert("data" in view && view.data.messages.some((row: any) => row.message?.body === `compact ${n}`));
243:       await client.query(api.messages.receipts, { messageId: (result as any).data.id });
244:       await client.outbox.drain();
245:       assert.deepEqual((await client.outbox.entries()).filter(entry => entry.op === "messages.send"), [], "all readable fanout, receipts and count arrived; no send history remains");
246:     }
247:   } finally { drain?.close(); await client?.close(); await local?.close(); await rm(root, { recursive: true, force: true }); }
248: });
249: 
250: 
251: const binary = resolve(import.meta.dirname, "../../../target/debug/snapback2");
252: const compiler = resolve(import.meta.dirname, "../dist/compiler.mjs");
253: const env = { ...process.env, SNAPBACK2_NODE: process.execPath, SNAPBACK2_COMPILER: compiler };
254: const schema = (cases = "'text', 'image'", by = "sender") => `use identity
255: 
256: table messages:
257:   sender: principal
258:   recipient: principal
259:   kind: enum(${cases})
260:   body: text <=100
261:   by bySender: sender, id
262:   read <- allow
263:   insert <- allow
264:   update <- allow
265:   delete <- allow
266: 
267: table stamps:
268:   value: int
269:   read <- allow
270:   insert <- allow
271: 
272: maintain counts: count messages by ${by}
273:   read <- allow
274: 
275: maintain hiddenCounts: count messages by sender
276:   read <- .sender = viewer
277: `;
278: const operations = (cases = "'text', 'image'", retired = true) => `query all(c: cursor ?):
279:   return messages[] after c first 50 by byId
280: 
281: query count(who: principal):
282:   return counts[who]
283: 
284: query hidden(who: principal):
285:   return hiddenCounts[who]
286: 
287: mutation send(kind: enum(${cases}), body: text <=100):
288:   insert messages { sender: viewer, recipient: viewer, kind, body }
289:   return true
290: ${retired ? '\nmutation retired():\n  insert stamps { value: 1 }\n  return true\n' : ''}`;
291: async function fixture() {
292:   const directory = await mkdtemp(join(tmpdir(), "snapback-successor-"));
293:   const source = join(directory, "source");
294:   await mkdir(source);
295:   await writeFile(join(source, "schema.q"), schema());
296:   await writeFile(join(source, "ops.q"), operations());
297:   await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
298: export default seed({ personas: ['alice', 'bob'], rows: { messages: [
299:   { id: 'original', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'original bytes: " \\u263a' }
300: ] } });\n`);
301:   return { directory, source };
302: }
303: function cli(root: string, args: string[]) {
304:   const result = spawnSync(binary, [...args, "--project", root, "--json"], { env, encoding: "utf8", timeout: 15_000 });
305:   assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
306:   return JSON.parse(result.stdout);
307: }
308: async function status(owner: RealOwnerHarness) {
309:   const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
310:   return fetch(`${owner.url}/control/status`, { headers: { "x-snapback-control": info.secret } }).then(r => r.json());
311: }
312: async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
313:   const start = Date.now();
314:   let value: T;
315:   do {
316:     value = await read();
317:     if (predicate(value)) return value;
318:     await new Promise(resolve => setTimeout(resolve, 25));
319:   } while (Date.now() - start < 8_000);
320:   assert.fail(`${label}: ${JSON.stringify(value)}`);
321: }
322: async function install(owner: RealOwnerHarness, cases: string, by = "sender", retired = true) {
323:   const before = await status(owner);
324:   await writeFile(join(owner.root!, "snapback/ops.q"), operations(cases, retired));
325:   await writeFile(join(owner.root!, "snapback/schema.q"), schema(cases, by));
326:   const ready: any = await until(() => status(owner), (s: any) => s.generation !== before.generation && s.status === "ready", "successor installation");
327:   return ready;
328: }
329: 
330: /** Hold selected complete owner frames after the server produced them but before the client can consume them. */
331: function gateLiveResponse(response: Response, select: (delivery: any) => Promise<void>): Response {
332:   assert.ok(response.body, "live response has a streaming body");
333:   const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
334:   let buffered = "", done = false;
335:   const body = new ReadableStream<Uint8Array>({
336:     async pull(controller) {
337:       while (true) {
338:         const boundary = buffered.indexOf("\n\n");
339:         if (boundary >= 0) {
340:           const event = buffered.slice(0, boundary + 2); buffered = buffered.slice(boundary + 2);
341:           const line = event.split("\n").find(value => value.startsWith("data: "));
342:           if (line) {
343:             const frame = JSON.parse(line.slice(6));
344:             if (frame?.data) await select(frame.data);
345:           }
346:           controller.enqueue(encoder.encode(event)); return;
347:         }
348:         if (done) {
349:           if (buffered) controller.enqueue(encoder.encode(buffered));
350:           controller.close(); return;
351:         }
352:         const chunk = await reader.read(); done = chunk.done;
353:         if (chunk.value) buffered += decoder.decode(chunk.value, { stream: !done });
354:       }
355:     },
356:     cancel(reason) { return reader.cancel(reason); },
357:   });
358:   return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
359: }
360: 
361: // @ref LLP 1012#6-reads-offline — an unheld aggregate cannot supply a screen's zero.
362: test("Insights hooks with never-held maintained values wait for authority, warm and cold", { timeout: 60000 }, async t => {
363:   const { directory, source } = await fixture();
364:   const previousUrl = process.env.SNAPBACK_URL;
365:   const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
366:   (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
367:   let owner: RealOwnerHarness | undefined, client: any, renderer: ReturnType<typeof TestRenderer.create> | undefined;
368:   try {
369:     await writeFile(join(source, "schema.q"), schema().replace("table stamps:\n", "table stamps:\n  bucket: int ?\n") + `
370: maintain received: count messages by recipient
371:   read <- allow
372: 
373: maintain sums: sum stamps of value by bucket
374:   read <- allow
375: `);
376:     await writeFile(join(source, "ops.q"), operations() + `
377: query insights(who: principal):
378:   return { sent: counts[who], received: received[who], sum: sums[7], zeroSum: sums[8], hidden: hiddenCounts[who], doubled: counts[who] * 2 }
379: `);
380:     await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
381: export default seed({ personas: ['alice', 'bob'], rows: {
382:   messages: [{ id: 'original', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'first insight' }],
383:   stamps: [{ id: 'stamp', value: 7, bucket: 7 }]
384: } });\n`);
385:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
386:     for (const cold of [false, true]) {
387:       const carrier = fileRangeStore(join(directory, cold ? "cold" : "warm"));
388:       client = createClient({ url: owner.url, persona: "bob", offline: { store: carrier } });
389:       await client.ready;
390:       // Hold the program and ordinary rows, but no aggregate rows or absences.
391:       assert.equal((await client.query(api.ops.all, { c: null })).state, "complete");
392:       await client.offline();
393:       if (cold) {
394:         await client.close();
395:         client = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
396:         await client.ready;
397:       }
398:       const seen: Record<string, any[]> = { count: [], insights: [], zero: [], hidden: [] };
399:       function Insight({ name, op, who }: { name: string; op: any; who: string }) {
400:         const snapshot = useQuery(op, { who });
401:         seen[name].push(snapshot);
402:         return React.createElement("output", { id: name }, snapshot.data === undefined ? snapshot.status : JSON.stringify(snapshot.data));
403:       }
404:       await act(async () => {
405:         renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
406:           React.createElement(Insight, { name: "count", op: api.ops.count, who: "dev:alice" }),
407:           React.createElement(Insight, { name: "insights", op: api.ops.insights, who: "dev:alice" }),
408:           React.createElement(Insight, { name: "zero", op: api.ops.count, who: "dev:bob" }),
409:           React.createElement(Insight, { name: "hidden", op: api.ops.hidden, who: "dev:alice" })));
410:       });
411:       await act(async () => {
412:         await until(async () => Object.fromEntries(Object.keys(seen).map(name => [name, client.observe(
413:           name === "insights" ? api.ops.insights : name === "hidden" ? api.ops.hidden : api.ops.count,
414:           { who: name === "zero" ? "dev:bob" : "dev:alice" }).getSnapshot()])),
415:         values => Object.values(values).every((value: any) => value.receipt?.state === "partial"), "unheld insights");
416:       });
417:       for (const [name, snapshots] of Object.entries(seen)) {
418:         const snapshot = snapshots.at(-1);
419:         assert.equal(snapshot.receipt?.state, "partial", `${cold}/${name}`);
420:         assert.equal(snapshot.status, "unavailable", `${cold}/${name}: ${JSON.stringify(snapshot)}`);
421:         assert.equal(snapshot.data, undefined, `${cold}/${name}: never-held is not zero`);
422:         assert.equal(snapshot.reason?.code, "partial");
423:       }
424:       await act(async () => { await client.online(); });
425:       await act(async () => {
426:         await until(async () => client.observe(api.ops.insights, { who: "dev:alice" }).getSnapshot(),
427:           value => value.freshness.live && value.data?.sum === 7, "live insights");
428:       });
429:       const expected = { sent: 1, received: 0, sum: 7, zeroSum: 0, hidden: 0, doubled: 2 };
430:       assert.deepEqual(seen.insights.at(-1).data, expected);
431:       assert.equal(seen.count.at(-1).data, 1);
432:       assert.equal(seen.zero.at(-1).data, 0, "proved absence remains a typed zero");
433:       assert.equal(seen.hidden.at(-1).data, 0, "proved unreadability remains a typed zero");
434:       assert.equal(seen.count.some(snapshot => snapshot.data === 0), false, "no intermediate zero paint");
435:       assert.equal(seen.insights.some(snapshot => snapshot.data?.sent === 0 || snapshot.data?.sum === 0), false);
436:       t.diagnostic(`${cold ? "cold" : "warm"} Insights: ${seen.insights.map(s => `${s.status}/${s.receipt?.state}/${JSON.stringify(s.data)}`).join(" → ")}`);
437:       await act(async () => renderer!.unmount()); renderer = undefined;
438:       await client.close(); client = undefined;
439:       client = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
440:       await client.ready;
441:       const retained: any = await client.query(api.ops.insights, { who: "dev:alice" });
442:       assert.equal(retained.state, "complete", "cold literal totals retain their checked owner answer");
443:       assert.deepEqual(retained.data, expected);
444:       assert.equal(retained.live, false);
445:       await client.close(); client = undefined;
446:     }
447:   } finally {
448:     if (renderer) await act(async () => renderer!.unmount());
449:     await client?.close(); await owner?.close();
450:     (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
451:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
452:     await rm(directory, { recursive: true, force: true });
453:   }
454: });
455: 
456: // @ref LLP 1012#6-reads-offline — an exact maintained
457: // zero the device actually held remains usable but stale; reconnect must never
458: // relabel it live while the owner has already advanced the group.
459: test("a cold maintained zero stays explicitly stale until the owner publishes the current value", { timeout: 60000 }, async t => {
460:   const { directory, source } = await fixture();
461:   const previousUrl = process.env.SNAPBACK_URL;
462:   let owner: RealOwnerHarness | undefined;
463:   const clients: any[] = [];
464:   const stops: Array<() => void> = [];
465:   try {
466:     delete process.env.SNAPBACK_URL;
467:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
468:     const carrier = fileRangeStore(join(directory, "maintained-bob"));
469:     const cached: any = createClient({ url: owner.url, persona: "bob", offline: { store: carrier } });
470:     clients.push(cached);
471:     await cached.ready;
472:     const args = { who: "dev:bob" };
473:     const cachedZero: any = await cached.query(api.ops.count, args);
474:     assert.deepEqual({ state: cachedZero.state, data: cachedZero.data, seq: cachedZero.seq },
475:       { state: "complete", data: 0, seq: 1 });
476:     await cached.close(); clients.pop();
477: 
478:     const writer: any = createClient({ url: owner.url, persona: "bob" });
479:     clients.push(writer);
480:     const write = await writer.mutation(api.ops.send, { kind: "text", body: "after cached zero" });
481:     assert.equal(write.state, "committed", JSON.stringify(write));
482:     const ownerNow: any = await writer.query(api.ops.count, args);
483:     assert.deepEqual({ state: ownerNow.state, data: ownerNow.data, seq: ownerNow.seq },
484:       { state: "complete", data: 1, seq: 2 });
485:     await writer.close(); clients.pop();
486: 
487:     const cold: any = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
488:     clients.push(cold);
489:     await cold.ready;
490:     const observed = cold.observe(api.ops.count, args);
491:     const snapshots: any[] = [];
492:     stops.push(observed.subscribe(() => snapshots.push(observed.getSnapshot())));
493:     const stale: any = await until(async () => observed.getSnapshot(),
494:       value => value.status === "ready" && value.data === 0 && value.receipt?.source === "twin", "cold maintained zero");
495:     assert.deepEqual({ data: stale.data, status: stale.status, receipt: stale.receipt,
496:       freshness: stale.freshness, reason: stale.reason?.code }, {
497:       data: 0,
498:       status: "ready",
499:       receipt: { state: "complete", source: "twin", seq: 1, next: null },
500:       freshness: { live: false, staleSince: stale.freshness.staleSince, connection: "offline" },
501:       reason: "stale",
502:     });
503:     assert.equal(typeof stale.freshness.staleSince, "number");
504: 
505:     await cold.online();
506:     const live: any = await until(async () => observed.getSnapshot(),
507:       value => value.status === "ready" && value.data === 1 && value.freshness.live === true, "current maintained value");
508:     assert.deepEqual(live.receipt, { state: "complete", source: "server", seq: 2, next: null });
509:     assert.equal(snapshots.some(snapshot => snapshot.data === 0 && snapshot.freshness.live === true), false,
510:       `the stale zero was never fabricated as current: ${JSON.stringify(snapshots)}`);
511: 
512:     stops.splice(0).forEach(stop => stop());
513:     await cold.offline(); await cold.close(); clients.pop();
514:     const colder: any = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
515:     clients.push(colder); await colder.ready;
516:     const retained: any = await colder.query(api.ops.count, args);
517:     assert.deepEqual({ state: retained.state, data: retained.data, seq: retained.seq, live: retained.live },
518:       { state: "complete", data: 1, seq: 2, live: false });
519:     t.diagnostic(`maintained custody: ${JSON.stringify({ cached: { data: 0, seq: 1, live: false, source: "twin" },
520:       owner: { data: 1, seq: 2 }, transitions: snapshots.map(snapshot => ({ data: snapshot.data,
521:         live: snapshot.freshness.live, source: snapshot.receipt?.source, seq: snapshot.receipt?.seq })), retained: { data: 1, seq: 2 } })}`);
522:   } finally {
523:     stops.splice(0).forEach(stop => stop());
524:     for (const client of clients.reverse()) await client.close();
525:     await owner?.close();
526:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
527:     await rm(directory, { recursive: true, force: true });
528:   }
529: });
530: 
531: // @ref LLP 1020#a8-acceptance — actual owners, durable carriers, and original intent bytes.
532: test("two clients and cold carrier reopen preserve rows; an enum replay with a lost acknowledgment cannot be dismissed", { timeout: 60000 }, async t => {
533:   const { directory, source } = await fixture();
534:   const previousUrl = process.env.SNAPBACK_URL;
535:   let owner: RealOwnerHarness | undefined;
536:   const clients: any[] = [];
537:   const resets: any[] = [];
538:   let loseAcknowledgment = false;
539:   const committed = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
540:   let retry: Promise<unknown> | undefined;
541:   const observe: typeof fetch = async (input, init) => {
542:     const response = await fetch(input, init);
543:     const path = new URL(String(input)).pathname;
544:     if (path === "/api/resume") resets.push(await response.clone().json());
545:     if (path === "/api/mutation" && loseAcknowledgment && response.ok) {
546:       assert.equal((await response.clone().json()).state, "committed");
547:       loseAcknowledgment = false;
548:       committed.resolve(); await release.promise;
549:       throw new TypeError("replay committed; acknowledgment lost");
550:     }
551:     return response;
552:   };
553:   try {
554:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
555:     let alice: any = createClient({ url: owner.url, persona: "alice", fetch: observe, offline: { store: fileRangeStore(join(directory, "alice")) } });
556:     let bob: any = createClient({ url: owner.url, persona: "bob", offline: { store: fileRangeStore(join(directory, "bob")) } });
557:     clients.push(alice, bob);
558:     await Promise.all([alice.ready, bob.ready]);
559:     const initial: any = await alice.query(api.ops.all, {});
560:     assert.equal(initial.state, "complete");
561:     assert.deepEqual((await bob.query(api.ops.all, {})).data, initial.data);
562:     for (const client of [alice, bob]) {
563:       const draining = subscribe(client, api.ops.all, {}, () => {}, { drain: true });
564:       await draining.until((event: any) => event.live === true, 3_000); draining.close();
565:     }
566:     await Promise.all([alice.online(), bob.online()]);
567:     const terminal = await alice.mutation(api.ops.retired, {});
568:     assert.equal(terminal.state, "committed", JSON.stringify(terminal));
569:     const retired = (await alice.outbox.entries()).find((entry: any) => entry.op === "ops.retired");
570:     assert.ok(retired?.response, `terminal is durable before removal: ${JSON.stringify(await alice.outbox.entries())}`);
571:     const widened: any = await install(owner, "'text', 'image', 'poll'");
572:     assert.notEqual(widened.successor.from, widened.successor.to);
573:     for (const client of [alice, bob]) {
574:       await client.online();
575:       const after = await client.query(api.ops.all, {});
576:       assert.equal(after.state, "complete");
577:       assert.deepEqual(after.data, initial.data);
578:     }
579:     await Promise.all([alice.offline(), bob.offline()]);
580:     alice = await alice.restart(); bob = await bob.restart(); clients.push(alice, bob);
581:     for (const client of [alice, bob]) {
582:       const cold = await client.query(api.ops.all, {});
583:       assert.equal(cold.live, false);
584:       assert.equal(cold.state, "complete");
585:       assert.deepEqual(cold.data, initial.data);
586:     }
587:     const args = { kind: "image", body: 'queued original: " \\ ☺' };
588:     const queued = await alice.mutation(api.ops.send, args);
589:     assert.equal(queued.state, "queued");
590:     const original = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
591:     assert.ok(original);
592:     const originalBytes = JSON.stringify({ args: original.args, intent: original.intent, generation: original.expectedGeneration });
593:     const narrowed = await install(owner, "'text', 'poll'", "sender", false);
594:     assert.equal(narrowed.successor.narrowings[0].affectedRows, 0);
595:     assert.deepEqual(narrowed.successor.narrowings[0].removedCases, ["image"]);
596:     // The existing contract (owner test offline_replay_successor): resume resets the
597:     // held generation, the server judges the replay by current validation, and a
598:     // refused intent is never spent — its bytes stay queued, untouched.
599:     resets.length = 0;
600:     const refused: any = await alice.online().then(() => alice.outbox.drain()).then(() => undefined, (error: any) => error);
601:     assert.equal(refused?.code, "E_INPUT", JSON.stringify(refused));
602:     assert.match(refused.message, /"image" is not in \["text", "poll"\]/);
603:     assert.ok(resets.some((result: any) => result.code === "E_OFFLINE_RESET"), JSON.stringify(resets));
604:     const stale = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
605:     assert.equal(stale.state, "queued");
606:     assert.equal(JSON.stringify({ args: stale.args, intent: stale.intent, generation: stale.expectedGeneration }), originalBytes);
607:     const history = (await alice.outbox.entries()).find((entry: any) => entry.intent === retired.intent);
608:     assert.equal(history.state, "committed");
609:     assert.deepEqual(history.response, retired.response, "removing the operation retains its original terminal");
610:     await bob.online();
611:     assert.deepEqual((await bob.query(api.ops.all, {})).data, initial.data, "removed queued case never enters the store");
612:     t.diagnostic(`old-generation intent: ${JSON.stringify({ state: stale.state, refusal: refused.envelope, reset: resets.find((result: any) => result.code === "E_OFFLINE_RESET")?.code, originalBytes })}`);
613:     // Widening the case back admits the same bytes: nothing was rewritten or dropped.
614:     await install(owner, "'text', 'image', 'poll'", "sender", false);
615:     loseAcknowledgment = true;
616:     retry = alice.outbox.drain();
617:     void retry!.catch(() => undefined);
618:     await committed.promise;
619:     assert.equal(await alice.outbox.dismiss(queued.intent), undefined, "committed replay is still in flight");
620:     release.resolve();
621:     assert.deepEqual(await retry, { stopped: "transport", remaining: 1 });
622:     assert.equal(await alice.outbox.dismiss(queued.intent), undefined, "lost acknowledgment leaves the outcome unknown");
623:     assert.equal((await alice.outbox.status()).blocked, undefined);
624:     assert.equal((await alice.outbox.entries()).find((e: any) => e.intent === queued.intent).refusal, undefined);
625:     await alice.online();
626:     assert.deepEqual(await alice.outbox.drain(), { stopped: false, remaining: 0 });
627:     const landed = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
628:     assert.equal(landed.state, "committed", JSON.stringify(landed));
629:     assert.equal(JSON.stringify({ args: landed.args, intent: landed.intent, generation: landed.expectedGeneration }), originalBytes);
630:     await bob.online();
631:     const rows: any = await bob.query(api.ops.all, {});
632:     assert.equal(rows.data.filter((row: any) => row.kind === "image" && row.body === args.body).length, 1, JSON.stringify(rows));
633:   } finally {
634:     release.resolve(); await retry?.catch(() => undefined);
635:     for (const client of clients.reverse()) await client.close();
636:     await owner?.close();
637:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
638:     await rm(directory, { recursive: true, force: true });
639:   }
640: });
641: 
642: test("positional reads compile after a regroup, report it in log/status, and distinguish public coverage from hidden or unheld groups", { timeout: 60000 }, async t => {
643:   const { directory, source } = await fixture();
644:   const previousUrl = process.env.SNAPBACK_URL;
645:   let owner: RealOwnerHarness | undefined;
646:   const clients: any[] = [], subscriptions: any[] = [];
647:   const onlineLive = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
648:   const onlineQuery = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
649:   const onlineReset = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
650:   const resumeReset = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
651:   const resumeQuery = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
652:   let predecessor: string | undefined;
653:   const queryReceipts = new Map<string, any>();
654:   const gatedJson = async (response: Response, gate: typeof onlineQuery) => {
655:     const value = await response.clone().json();
656:     if (gate.armed) { gate.armed = false; gate.entered.resolve(value); await gate.release.promise; }
657:     return response;
658:   };
659:   try {
660:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
661:     const onlineFetch: typeof fetch = async (input, init) => {
662:       const response = await fetch(input, init), path = new URL(String(input)).pathname;
663:       if (path === "/api/live") return gateLiveResponse(response, async delivery => {
664:         if (onlineLive.armed && delivery?.generation && delivery.generation !== predecessor) {
665:           onlineLive.armed = false; onlineLive.entered.resolve(delivery); await onlineLive.release.promise;
666:         }
667:       });
668:       if (path === "/api/query") {
669:         const envelope = await response.clone().json();
670:         if (envelope.receipt) queryReceipts.set(JSON.parse(String(init?.body)).op, envelope);
671:         if (onlineQuery.armed) return gatedJson(response, onlineQuery);
672:       }
673:       if (path === "/api/resume" && onlineReset.armed) return gatedJson(response, onlineReset);
674:       return response;
675:     };
676:     const resumeFetch: typeof fetch = async (input, init) => {
677:       const response = await fetch(input, init), path = new URL(String(input)).pathname;
678:       if (path === "/api/resume" && resumeReset.armed) return gatedJson(response, resumeReset);
679:       if (path === "/api/query" && resumeQuery.armed) return gatedJson(response, resumeQuery);
680:       return response;
681:     };
682:     const online: any = createClient({ url: owner.url, persona: "bob", fetch: onlineFetch,
683:       offline: { store: fileRangeStore(join(directory, "bob-online")) } });
684:     const resuming: any = createClient({ url: owner.url, persona: "bob", fetch: resumeFetch,
685:       offline: { store: fileRangeStore(join(directory, "bob-resume")) } });
686:     clients.push(online, resuming);
687:     await Promise.all([online.ready, resuming.ready]);
688:     for (const client of clients) assert.equal((await client.query(api.ops.count, { who: "dev:alice" })).data, 1);
689:     predecessor = online.offlineRuntime.programGeneration;
690:     assert.equal(resuming.offlineRuntime.programGeneration, predecessor);
691:     const onlineEvents: any[] = [], resumeEvents: any[] = [];
692:     const onlineSub = subscribe(online, api.ops.count, { who: "dev:alice" }, value => onlineEvents.push(value));
693:     const resumeSub = subscribe(resuming, api.ops.count, { who: "dev:alice" }, value => resumeEvents.push(value));
694:     subscriptions.push(onlineSub, resumeSub);
695:     await Promise.all([
696:       onlineSub.until((event: any) => event.live === true && event.data === 1, 5_000),
697:       resumeSub.until((event: any) => event.live === true && event.data === 1, 5_000),
698:     ]);
699:     await resuming.offline();
700:     onlineLive.armed = true;
701:     const after: any = await install(owner, "'text', 'image'", "recipient");
702:     const blockedLive = await onlineLive.entered.promise;
703:     assert.notEqual(blockedLive.generation, predecessor, "the held frame belongs to the installed successor");
704:     assert.equal(online.offlineRuntime.programGeneration, predecessor, "the retained online client still holds the predecessor before the frame commits");
705:     assert.equal(resuming.offlineRuntime.programGeneration, predecessor, "the offline client retains the predecessor before resume");
706:     cli(owner.root!, ["check"]);
707:     assert.deepEqual(after.successor.maintains, ["maintain counts: by sender → by recipient"]);
708:     const text = await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8");
709:     assert.ok(text.includes("maintain counts: by sender → by recipient"));
710:     assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor.maintains, after.successor.maintains);
711: 
712:     // The owner has produced both successor answers while the twin still owns
713:     // the predecessor schema. Neither may be applied through its old bySender index.
714:     onlineQuery.armed = true; onlineReset.armed = true;
715:     const queried = online.query(api.ops.count, { who: "dev:alice" });
716:     const blockedQuery = await onlineQuery.entered.promise;
717:     assert.equal(blockedQuery.generation, blockedLive.generation);
718:     assert.equal(online.offlineRuntime.programGeneration, predecessor);
719:     onlineQuery.release.resolve();
720:     assert.equal((await queried).data, 0, "the one-shot online read returns the successor answer");
721:     const resetRefusal = await onlineReset.entered.promise;
722:     assert.equal(resetRefusal.code, "E_OFFLINE_RESET", JSON.stringify(resetRefusal));
723:     assert.equal(online.offlineRuntime.resetNeeded, true);
724:     assert.equal((await answerOffline(online.offlineRuntime, "ops.count", { who: "dev:alice" }, error => error as Error)).state,
725:       "hydrating", "superseded predecessor coverage is never served as exact");
726:     onlineLive.release.resolve(); onlineReset.release.resolve();
727:     const onlineSuccessor = await onlineSub.until((event: any) => event.live === true && event.state === "complete" && event.data === 0, 8_000);
728:     assert.equal(onlineSuccessor.data, 0);
729:     await until(async () => online.offlineRuntime, (runtime: any) => runtime.programGeneration !== predecessor && !runtime.resetNeeded,
730:       "online successor coverage completion");
731: 
732:     // The offline client sends predecessor facts. Hold the owner's reset
733:     // refusal, then hold the fresh mounted answer during the atomic rebuild.
734:     resumeReset.armed = true; resumeQuery.armed = true;
735:     const resumed = resuming.online();
736:     const resumeRefusal = await resumeReset.entered.promise;
737:     assert.equal(resumeRefusal.code, "E_OFFLINE_RESET", JSON.stringify(resumeRefusal));
738:     assert.equal(resuming.offlineRuntime.programGeneration, predecessor);
739:     resumeReset.release.resolve();
740:     const freshResume = await resumeQuery.entered.promise;
741:     assert.equal(freshResume.generation, blockedLive.generation);
742:     assert.notEqual(resuming.offlineRuntime.programGeneration, predecessor, "successor program is adopted before fresh coverage");
743:     assert.equal(resuming.offlineRuntime.resetNeeded, true);
744:     assert.equal((await answerOffline(resuming.offlineRuntime, "ops.count", { who: "dev:alice" }, error => error as Error)).state,
745:       "hydrating", "the shared reset never exposes a partial predecessor/successor image");
746:     resumeQuery.release.resolve(); await resumed;
747:     assert.equal((await resuming.query(api.ops.count, { who: "dev:alice" })).data, 0);
748:     assert.equal((await resuming.query(api.ops.count, { who: "dev:bob" })).data, 1);
749:     await resumeSub.until((event: any) => event.live === true && event.state === "complete" && event.data === 0, 8_000);
750: 
751:     const unheld = await online.offlineRuntime.evaluate("ops.count", { who: "dev:never-held" });
752:     assert.equal(unheld?.state, "partial", "a different unqueried successor group has no coverage");
753:     assert.equal(unheld?.reason, "never-held");
754:     for (const [name, who] of [["hidden", "dev:alice"], ["count", "dev:alice"]]) {
755:       const server: any = await online.query(api.ops[name], { who });
756:       assert.equal(server.data, 0, `${name}: server typed zero: ${JSON.stringify(server)}`);
757:       await online.online();
758:       const replay = await online.offlineRuntime.evaluate(`ops.${name}`, { who });
759:       const envelope = queryReceipts.get(`ops.${name}`);
760:       t.diagnostic(`${name}: ${JSON.stringify({ generation: envelope.generation, receipt: envelope.receipt, server: server.state, replay })}`);
761:       assert.equal(server.state, "complete", `${name}: the server's typed zero is complete`);
762:       assert.equal(envelope.generation, online.offlineRuntime.programGeneration, "coverage belongs to the adopted successor");
763:       if (name === "count") {
764:         const range = envelope.receipt.ranges.find((range: any) => range.table === "counts");
765:         assert.ok(range, "the public Count read carries its independent group coverage");
766:         assert.deepEqual({ index: range.index, prefix: range.prefix, rows: range.rowIds, stop: range.stop, absence: range.absence },
767:           { index: "byRecipient", prefix: [{ Scalar: who }], rows: [], stop: "Exhausted", absence: true });
768:         for (const bound of ["after", "before", "gt", "gte", "lt", "lte"]) assert.equal(range[bound], null);
769:         assert.equal(replay?.state, "complete", "the exhausted public successor group covers its zero");
770:         assert.equal(replay?.data, 0);
771:       } else {
772:         assert.deepEqual(envelope.receipt, { ranges: [], absences: [], verdicts: [] }, "hidden zero exposes no absence authority");
773:         assert.equal(replay?.state, "partial", "hidden receipt-only evaluation cannot mint zero authority");
774:         assert.equal(replay?.reason, "never-held");
775:       }
776:     }
777:     assert.equal(onlineEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);
778:     assert.equal(resumeEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);
779:   } finally {
780:     onlineLive.release.resolve(); onlineQuery.release.resolve(); onlineReset.release.resolve();
781:     resumeReset.release.resolve(); resumeQuery.release.resolve();
782:     for (const subscription of subscriptions) subscription.close();
783:     for (const client of clients.reverse()) await client.close();
784:     await owner?.close();
785:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
786:     await rm(directory, { recursive: true, force: true });
787:   }
788: });
789: 
790: // @ref LLP 1001#maintained-addresses — a day bucket is an ordinary typed
791: // maintain group: the owner derives the UTC epoch day and updates its count in
792: // the same source mutation rather than asking the client to assemble a chart.
793: test("real owner maintains seven UTC-day insight buckets", { timeout: 60000 }, async () => {
794:   const directory = await mkdtemp(join(tmpdir(), "snapback-time-buckets-"));
795:   const source = join(directory, "source");
796:   const previousUrl = process.env.SNAPBACK_URL;
797:   let owner: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
798:   try {
799:     await mkdir(source);
800:     await writeFile(join(source, "schema.q"), `use identity
801: 
802: table events:
803:   author: principal
804:   day: int
805:   by byDay: day, id
806:   read <- allow
807:   insert <- allow
808: 
809: maintain dayCounts: count events by day
810:   read <- allow
811: `);
812:     await writeFile(join(source, "insights.q"), `mutation record():
813:   day = divmod(now, 86400000).quotient
814:   insert events { author: viewer, day }
815:   return day
816: 
817: query week(start: int):
818:   return { d0: dayCounts[start], d1: dayCounts[start + 1], d2: dayCounts[start + 2], d3: dayCounts[start + 3], d4: dayCounts[start + 4], d5: dayCounts[start + 5], d6: dayCounts[start + 6] }
819: `);
820:     await writeFile(join(source, "seed.ts"), "import { seed } from 'snapback2';\nexport default seed({ personas: ['alice'], rows: {} });\n");
821:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
822:     client = createClient({ url: owner.url, persona: "alice" });
823:     await client.ready;
824:     let firstDay: number | undefined;
825:     const expected: Record<string, number> = {};
826:     for (let offset = 0; offset < 7; offset += 1) {
827:       const recorded: any = await client.mutation(api.insights.record, {});
828:       assert.equal(recorded.state, "committed", JSON.stringify(recorded));
829:       firstDay ??= recorded.data;
830:       assert.equal(recorded.data, firstDay + offset, "owner clock advances across exact UTC-day buckets");
831:       expected[`d${offset}`] = 1;
832:       if (offset < 6) {
833:         const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
834:         const advanced = await fetch(`${owner.url}/control/clock`, { method: "POST", headers: {
835:           "content-type": "application/json", "x-snapback-control": info.secret,
836:         }, body: JSON.stringify({ advanceMs: 86400000 }) });
837:         assert.equal(advanced.status, 200, await advanced.text());
838:       }
839:     }
840:     const week: any = await client.query(api.insights.week, { start: firstDay });
841:     assert.equal(week.state, "complete", JSON.stringify(week));
842:     assert.deepEqual(week.data, expected);
843:   } finally {
844:     await client?.close(); await owner?.close();
845:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
846:     await rm(directory, { recursive: true, force: true });
847:   }
848: });
849: 
850: test("successor guide aliases and Quarry diagnostic rewrites compile", { timeout: 60000 }, async () => {
851:   const directory = await mkdtemp(join(tmpdir(), "snapback-successor-guide-"));
852:   try {
853:     await mkdir(join(directory, "snapback"));
854:     const pages = ["successor", "migrations", "migration"].map(name => cli(directory, ["guide", name]).content);
855:     assert.equal(pages[0], pages[1]); assert.equal(pages[0], pages[2]);
856:     // 4,608 while the page carries the custody-log paragraph (LLP 1019); it moves to `guide deliver`.
857:     assert.ok(Buffer.byteLength(pages[0]) <= 4608);
858:     assert.ok(!pages[0].includes("once J1b lands"));
859:     const families = JSON.parse(await readFile(resolve(import.meta.dirname, "../guide/families.source.json"), "utf8"));
860:     // Fix round r1, item 9: every successor family row and the `E_STEPS` pair. A Quarry
861:     // block compiles through `check` (file markers name the files; otherwise the block is
862:     // the schema, with a job split into admin.q), and `E_STEPS.wrong` must refuse that code
863:     // in family `bound`, page `bounds`. Prose-only sides (`E_SUCCESSOR_ROW_INVALID`,
864:     // `E_SUCCESSOR_STORE`, `E_SUCCESSOR_DESTRUCTIVE.right`) have nothing to compile.
865:     const project = (source: string): Record<string, string> => {
866:       const marked: Record<string, string> = {};
867:       let path: string | undefined;
868:       for (const line of source.split("\n")) {
869:         const marker = /^-- (snapback\/[A-Za-z0-9_./-]+\.q)$/.exec(line);
870:         if (marker) { path = marker[1]!; marked[path] = ""; } else if (path) marked[path] += `${line}\n`;
871:       }
872:       if (Object.keys(marked).length) return marked;
873:       const start = source.indexOf("\njob ");
874:       return start < 0 ? { "snapback/schema.q": source, "snapback/admin.q": "query inspect():\n  return null\n" }
875:         : { "snapback/schema.q": source.slice(0, start), "snapback/admin.q": source.slice(start) };
876:     };
877:     const rows = families.filter((row: any) => row.code.startsWith("E_SUCCESSOR") || row.code === "E_STEPS");
878:     assert.deepEqual(rows.map((row: any) => row.code).sort(), ["E_STEPS", "E_SUCCESSOR_BOOTSTRAP", "E_SUCCESSOR_CAP", "E_SUCCESSOR_COLUMN_REQUIRED", "E_SUCCESSOR_DESTRUCTIVE", "E_SUCCESSOR_NARROWING", "E_SUCCESSOR_ROW_INVALID", "E_SUCCESSOR_STORE", "E_SUCCESSOR_UNIQUE"]);
879:     let compiled = 0;
880:     for (const example of rows) {
881:       assert.equal(example.guide, example.code === "E_STEPS" ? "bounds" : "successor", example.code); assert.ok(example.site, example.code);
882:       for (const side of example.code === "E_STEPS" ? ["wrong", "right"] : ["right"]) {
883:         const source = /```q\n([\s\S]*?)\n```/.exec(example[side])?.[1];
884:         if (!source) continue;
885:         await rm(join(directory, "snapback"), { recursive: true, force: true });
886:         await mkdir(join(directory, "snapback"));
887:         for (const [path, text] of Object.entries(project(source))) await writeFile(join(directory, path), text);
888:         const result = spawnSync(binary, ["check", "--project", directory, "--json"], { env, encoding: "utf8", timeout: 15_000 });
889:         compiled += 1;
890:         if (side === "right") { assert.equal(result.status, 0, `${example.code}.${side}: ${result.stdout}\n${result.stderr}`); continue; }
891:         assert.equal(result.status, 1, `${example.code}.wrong: ${result.stdout}\n${result.stderr}`);
892:         const refusal = JSON.parse(result.stdout.trim().split("\n")[0]);
893:         assert.deepEqual({ code: refusal.code, family: refusal.family, guide: refusal.guide }, { code: "E_STEPS", family: "bound", guide: "bounds" }, result.stdout);
894:       }
895:     }
896:     assert.equal(compiled, 6, "four successor `right` blocks plus both E_STEPS sides compile");
897:   } finally { await rm(directory, { recursive: true, force: true }); }
898: });
899: 
900: test("nested enum refusal names both generations and declaration, and its pasted job repairs the predecessor", { timeout: 60000 }, async t => {
901:   const { directory, source } = await fixture();
902:   const previousUrl = process.env.SNAPBACK_URL;
903:   let owner: RealOwnerHarness | undefined;
904:   const nested = (cases: string) => schema().replace("  body: text <=100", `  body: text <=100\n  tags: [[enum(${cases})] <=3] <=3 ?`);
905:   try {
906:     await writeFile(join(source, "schema.q"), nested("'a', 'b'"));
907:     await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
908: export default seed({ personas: ['alice', 'bob'], rows: { messages: [
909:   { id: 'keep', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'keep', tags: [[], ['a']] },
910:   { id: 'remove', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'remove', tags: [['b', 'b']] }
911: ] } });\n`);
912:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
913:     const before: any = await status(owner);
914:     // Seed changes make future empty-store startup valid; the populated row still has b.
915:     await writeFile(join(owner.root!, "snapback/seed.ts"), (await readFile(join(source, "seed.ts"), "utf8")).replaceAll("'b', 'b'", "'a', 'a'"));
916:     await writeFile(join(owner.root!, "snapback/schema.q"), nested("'a'"));
917:     const refused: any = await until(() => status(owner), (s: any) => s.status?.refused?.some((e: any) => e.code === "E_SUCCESSOR_NARROWING"), "nested enum narrowing refusal");
918:     const error = refused.status.refused.find((e: any) => e.code === "E_SUCCESSOR_NARROWING");
919:     assert.equal(refused.generation, before.generation);
920:     assert.equal(error.from, before.generation); assert.notEqual(error.to, error.from);
921:     assert.match(error.site, /schema\.q:8:3$/);
922:     assert.equal(error.affectedRows, 1); assert.deepEqual(error.sample, ["remove"]);
923:     assert.deepEqual(error.removedCases, ["b"]);
924:     const repair = join(directory, "repair.q");
925:     await writeFile(repair, error.rewrite);
926:     // Restore the predecessor declarations for the ad hoc compiler as the rewrite directs.
927:     await writeFile(join(owner.root!, "snapback/schema.q"), nested("'a', 'b'"));
928:     await until(() => status(owner), (s: any) => s.status === "ready", "predecessor declarations restored");
929:     const result = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 15_000 });
930:     assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${error.rewrite}`);
931:     assert.ok(result.stdout.includes('"state":"done"'), result.stdout);
932:     await writeFile(join(owner.root!, "snapback/schema.q"), `${nested("'a'")}\n`);
933:     const ready: any = await until(() => status(owner), (s: any) => s.generation !== before.generation && s.status === "ready", "repaired successor");
934:     assert.equal(ready.successor.narrowings[0].affectedRows, 0);
935:     const rows = cli(owner.root!, ["data", "messages", "--as", "system"]);
936:     assert.ok(JSON.stringify(rows).includes('"keep"'));
937:     assert.ok(!JSON.stringify(rows).includes('"remove"'));
938:     t.diagnostic(`nested refusal: ${JSON.stringify({ from: error.from, to: error.to, site: error.site, affectedRows: error.affectedRows, removedCases: error.removedCases, rewrite: error.rewrite })}`);
939:     // A scalar enum pastes one whole-table sweep that deletes every affected row.
940:     cli(owner.root!, ["run", "ops.send", JSON.stringify({ kind: "image", body: "scalar" }), "--as", "alice"]);
941:     const scalar = (cases: string) => `${nested("'a'")}\n`.replace("kind: enum('text', 'image')", `kind: enum(${cases})`);
942:     const narrowKind = async (cases: string) => {
943:       await writeFile(join(owner!.root!, "snapback/ops.q"), operations(cases));
944:       await writeFile(join(owner!.root!, "snapback/schema.q"), scalar(cases));
945:     };
946:     await narrowKind("'text'");
947:     const flat: any = await until(() => status(owner), (s: any) => s.status?.refused?.some((e: any) => e.column === "kind"), "scalar enum narrowing refusal");
948:     const flatError = flat.status.refused.find((e: any) => e.column === "kind");
949:     assert.equal(flatError.affectedRows, 1); assert.deepEqual(flatError.removedCases, ["image"]);
950:     assert.ok(flatError.rewrite.includes("  chunk p in messages first 100 by byId:\n    if p.kind = 'image':\n      delete messages[p.id]"), flatError.rewrite);
951:     await writeFile(repair, flatError.rewrite);
952:     await narrowKind("'text', 'image'");
953:     await until(() => status(owner), (s: any) => s.status === "ready", "scalar predecessor restored");
954:     const swept = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 15_000 });
955:     assert.equal(swept.status, 0, `${swept.stdout}\n${swept.stderr}\n${flatError.rewrite}`);
956:     assert.ok(swept.stdout.includes('"state":"done"'), swept.stdout);
957:     await narrowKind("'text'");
958:     const flatReady: any = await until(() => status(owner), (s: any) => s.generation !== flat.generation && s.status === "ready", "scalar repaired successor");
959:     assert.equal(flatReady.successor.narrowings.find((n: any) => n.column === "kind").affectedRows, 0);
960:     const afterSweep = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
961:     assert.ok(afterSweep.includes('"keep"') && !afterSweep.includes('"scalar"'), afterSweep);
962:   } finally {
963:     await owner?.close();
964:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
965:     await rm(directory, { recursive: true, force: true });
966:   }
967: });
968: 
969: // Fix round r1, items 1, 4 and 6: the combined unwrap-plus-removal job fills and deletes in
970: // one sweep, the list-shrink job checks every row with one `.length`, and both run to zero
971: // on a real owner (a removed case inside a list stays the sampled job: the nested test).
972: test("combined and list-narrowing pasted jobs run to zero on the real owner", { timeout: 90000 }, async t => {
973:   const { directory, source } = await fixture();
974:   const previousUrl = process.env.SNAPBACK_URL;
975:   let owner: RealOwnerHarness | undefined;
976:   const declare = (note: string, tags: string) => schema().replace("  body: text <=100", `  body: text <=100\n  note: ${note}\n  tags: ${tags}`);
977:   const ops = (note: string) => operations().replace(
978:     "mutation send(kind: enum('text', 'image'), body: text <=100):\n  insert messages { sender: viewer, recipient: viewer, kind, body }",
979:     `mutation send(kind: enum('text', 'image'), body: text <=100, note: ${note}):\n  insert messages { sender: viewer, recipient: viewer, kind, body, note }`);
980:   const seed = (rows: string) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: [\n${rows}\n] } });\n`;
981:   const row = (id: string, fields: string) => `  { id: '${id}', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: '${id}'${fields} }`;
982:   const wide = { note: "enum('a', 'b', 'c') ?", tags: "[enum('x', 'y')] <=3 ?" };
983:   try {
984:     await writeFile(join(source, "schema.q"), declare(wide.note, wide.tags));
985:     await writeFile(join(source, "ops.q"), ops(wide.note));
986:     await writeFile(join(source, "seed.ts"), seed([row("keep", ", note: 'a', tags: ['x']"), row("nul", ", tags: ['x', 'y', 'x']"), row("gone", ", note: 'c', tags: []")].join(",\n")));
987:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
988:     const start: any = await status(owner);
989:     // Seeds only feed an empty store; keep them valid for every schema below.
990:     await writeFile(join(owner.root!, "snapback/seed.ts"), seed(row("keep", ", note: 'a', tags: ['x']")));
991:     const declareAll = async (note: string, tags: string) => {
992:       await writeFile(join(owner!.root!, "snapback/ops.q"), ops(note));
993:       await writeFile(join(owner!.root!, "snapback/schema.q"), declare(note, tags));
994:     };
995:     const repair = join(directory, "repair.q");
996:     const run = (args?: string) => spawnSync(binary, ["run", "--file", repair, ...(args ? [args] : []), "--as", "system", "--wait", "--project", owner!.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
997:     // 1. `note` loses its `?` and the case 'c' at once: one job fills the null and deletes the case.
998:     await declareAll("enum('a', 'b')", wide.tags);
999:     const first: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "note"), "combined narrowing refusal");
1000:     const note = first.status.refused.find((e: any) => e.column === "note");
1001:     assert.deepEqual({ affectedRows: note.affectedRows, nullRows: note.nullRows, oversizeRows: note.oversizeRows, removedCases: note.removedCases, sample: note.sample },
1002:       { affectedRows: 2, nullRows: 1, oversizeRows: 0, removedCases: ["c"], sample: ["gone"] }, JSON.stringify(note));
1003:     assert.ok(note.rewrite.includes("job remove_messages_note(value: enum('a', 'b')):\n  chunk p in messages first 100 by byId:\n    if p.note = null:\n      update messages[p.id] { note: value }\n    if p.note = 'c':\n      delete messages[p.id]"), note.rewrite);
1004:     await writeFile(repair, note.rewrite);
1005:     await declareAll(wide.note, wide.tags);
1006:     await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "predecessor restored");
1007:     const filled = run('{"value":"b"}');
1008:     assert.equal(filled.status, 0, `${filled.stdout}\n${filled.stderr}\n${note.rewrite}`); assert.ok(filled.stdout.includes('"state":"done"'), filled.stdout);
1009:     await declareAll("enum('a', 'b')", wide.tags);
1010:     const second: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "combined successor admitted");
1011:     assert.equal(second.successor.narrowings.find((n: any) => n.column === "note").affectedRows, 0);
1012:     let rows = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
1013:     assert.ok(rows.includes('"keep"') && rows.includes('"nul"') && !rows.includes('"gone"') && rows.includes('"note":"b"'), rows);
1014:     // 2. `tags` keeps its cases and its maximum drops to 2: one sweep with `.length`.
1015:     await declareAll("enum('a', 'b')", "[enum('x', 'y')] <=2 ?");
1016:     const third: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "tags"), "list narrowing refusal");
1017:     const tags = third.status.refused.find((e: any) => e.column === "tags");
1018:     assert.deepEqual({ affectedRows: tags.affectedRows, nullRows: tags.nullRows, oversizeRows: tags.oversizeRows, removedCases: tags.removedCases, sample: tags.sample },
1019:       { affectedRows: 1, nullRows: 0, oversizeRows: 1, removedCases: [], sample: ["nul"] }, JSON.stringify(tags));
1020:     assert.ok(tags.rewrite.includes("job shrink_messages_tags():\n  chunk p in messages first 100 by byId:\n    if (p.tags ?? []).length > 2:\n      delete messages[p.id]"), tags.rewrite);
1021:     assert.match(tags.message, /1 affected rows remain \(0 null or absent, 1 over the new maximum\)/);
1022:     await writeFile(repair, tags.rewrite);
1023:     await declareAll("enum('a', 'b')", wide.tags);
1024:     await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === second.generation, "list predecessor restored");
1025:     const swept = run();
1026:     assert.equal(swept.status, 0, `${swept.stdout}\n${swept.stderr}\n${tags.rewrite}`); assert.ok(swept.stdout.includes('"state":"done"'), swept.stdout);
1027:     await declareAll("enum('a', 'b')", "[enum('x', 'y')] <=2 ?");
1028:     const fourth: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== second.generation, "list successor admitted");
1029:     assert.equal(fourth.successor.narrowings.find((n: any) => n.column === "tags").affectedRows, 0);
1030:     rows = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
1031:     assert.ok(rows.includes('"keep"') && !rows.includes('"nul"'), rows);
1032:     t.diagnostic(`combined: ${JSON.stringify({ note: note.message, tags: tags.message })}`);
1033:   } finally {
1034:     await owner?.close();
1035:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
1036:     await rm(directory, { recursive: true, force: true });
1037:   }
1038: });
1039: 
1040: test("sampled required-list repair keeps filled nulls and converges beyond ten removed-case rows", { timeout: 90000 }, async t => {
1041:   const { directory, source } = await fixture();
1042:   const previousUrl = process.env.SNAPBACK_URL;
1043:   let owner: RealOwnerHarness | undefined;
1044:   const declare = (type: string) => schema().replace("  body: text <=100", `  body: text <=100\n  tags: ${type}`);
1045:   const wide = "[enum('a', 'b')] <=3 ?", narrow = "[enum('a')] <=3";
1046:   const rows = [{ id: "00-null", tags: null }, { id: "keep", tags: ["a"] },
1047:     ...Array.from({ length: 12 }, (_, i) => ({ id: `bad-${i}`, tags: ["b"] }))]
1048:     .map(row => ({ sender: "dev:alice", recipient: "dev:bob", kind: "text", body: row.id, ...row }));
1049:   const seed = (values: unknown[]) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: ${JSON.stringify(values)} } });\n`;
1050:   try {
1051:     await writeFile(join(source, "schema.q"), declare(wide));
1052:     await writeFile(join(source, "ops.q"), operations().replace("kind, body }", "kind, body, tags: ['a'] }"));
1053:     await writeFile(join(source, "seed.ts"), seed(rows));
1054:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1055:     const start: any = await status(owner);
1056:     await writeFile(join(owner.root!, "snapback/seed.ts"), seed([rows[1]]));
1057:     const schemaPath = join(owner.root!, "snapback/schema.q");
1058:     const data = () => (cli(owner!.root!, ["data", "messages", "--as", "system"]) as any).data;
1059:     const unchanged = JSON.stringify(data().find((row: any) => row.id === "keep"));
1060:     const repair = join(directory, "repair.q");
1061:     let priorSample: string[] = [];
1062:     for (const remaining of [13, 2]) {
1063:       await writeFile(schemaPath, declare(narrow));
1064:       const refused: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "tags"), "sampled narrowing refusal");
1065:       const conflict = refused.status.refused.find((e: any) => e.column === "tags");
1066:       assert.equal(conflict.affectedRows, remaining);
1067:       assert.equal(conflict.nullRows, remaining === 13 ? 1 : 0);
1068:       assert.ok(conflict.sample.every((id: string) => !priorSample.includes(id)), "fresh sample on re-apply");
1069:       priorSample = conflict.sample;
1070:       await writeFile(repair, conflict.rewrite);
1071:       await writeFile(schemaPath, declare(wide));
1072:       await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "predecessor restored");
1073:       const run = spawnSync(binary, ["run", "--file", repair, '{"value":["a"]}', "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
1074:       assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${conflict.rewrite}`);
1075:       const after = data();
1076:       assert.deepEqual(after.find((row: any) => row.id === "00-null")?.tags, ["a"], "filled null survives");
1077:       assert.equal(JSON.stringify(after.find((row: any) => row.id === "keep")), unchanged);
1078:       assert.ok(run.stdout.includes('"state":"done"'), run.stdout);
1079:       t.diagnostic(`${conflict.affectedRows} affected; sample ${JSON.stringify(conflict.sample)}; repair done; filled null and unchanged row kept`);
1080:     }
1081:     await writeFile(schemaPath, declare(narrow));
1082:     const admitted: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "narrow successor admitted");
1083:     assert.equal(admitted.successor.narrowings.find((n: any) => n.column === "tags").affectedRows, 0);
1084:     const after = data();
1085:     assert.deepEqual(after.map((row: any) => row.id).sort(), ["00-null", "keep"]);
1086:   } finally {
1087:     await owner?.close();
1088:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
1089:     await rm(directory, { recursive: true, force: true });
1090:   }
1091: });
1092: 
1093: test("text repair truncates scalars or deletes only over-long rows, preserving short text and nulls", { timeout: 90000 }, async () => {
1094:   for (const remove of [false, true]) {
1095:     const { directory, source } = await fixture();
1096:     const previousUrl = process.env.SNAPBACK_URL;
1097:     let owner: RealOwnerHarness | undefined;
1098:     const declare = (max: number) => schema().replace("  body: text <=100", `  body: text <=100\n  note: text <=${max} ?`);
1099:     const rows = [{ id: "null", note: null }, { id: "short", note: "a😀" }, { id: "long", note: "😀".repeat(12) }]
1100:       .map(row => ({ sender: "dev:alice", recipient: "dev:bob", kind: "text", body: row.id, ...row }));
1101:     const seed = (values: unknown[]) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: ${JSON.stringify(values)} } });\n`;
1102:     try {
1103:       await writeFile(join(source, "schema.q"), declare(20));
1104:       await writeFile(join(source, "seed.ts"), seed(rows));
1105:       owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1106:       const start: any = await status(owner);
1107:       await writeFile(join(owner.root!, "snapback/seed.ts"), seed(rows.slice(0, 2)));
1108:       const path = join(owner.root!, "snapback/schema.q");
1109:       await writeFile(path, declare(10));
1110:       const refused: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "note"), "text maximum refusal");
1111:       const conflict = refused.status.refused.find((e: any) => e.column === "note");
1112:       assert.equal(conflict.oversizeRows, 1);
1113:       let job = conflict.rewrite;
1114:       if (remove) {
1115:         const alternative = job.split("\n").filter((line: string) => /^-- (if |  delete )/.test(line)).map((line: string) => `    ${line.slice(3)}`).join("\n");
1116:         assert.match(alternative, /!= slice/);
1117:         job = `job drop_messages_note():\n  chunk p in messages first 100 by byId:\n${alternative}`;
1118:       }
1119:       const repair = join(directory, "repair.q");
1120:       await writeFile(repair, job);
1121:       await writeFile(path, declare(20));
1122:       await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "text predecessor restored");
1123:       const run = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
1124:       assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${job}`);
1125:       await writeFile(path, declare(10));
1126:       await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "text successor admitted");
1127:       const data = (cli(owner.root!, ["data", "messages", "--as", "system"]) as any).data;
1128:       assert.deepEqual(data.find((row: any) => row.id === "short"), rows[1]);
1129:       assert.deepEqual(data.find((row: any) => row.id === "null"), rows[0]);
1130:       assert.deepEqual(data.find((row: any) => row.id === "long"), remove ? undefined : { ...rows[2], note: "😀".repeat(10) });
1131:     } finally {
1132:       await owner?.close();
1133:       if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
1134:       await rm(directory, { recursive: true, force: true });
1135:     }
1136:   }
1137: });
1138: 
1139: test("dev status retains the completed install report including delivery audience bounds", async () => {
1140:   const { directory, source } = await fixture();
1141:   const previousUrl = process.env.SNAPBACK_URL;
1142:   let owner: RealOwnerHarness | undefined;
1143:   const audience = `\ntable audience:\n  sender: principal\n  member: principal\n  by bySender: sender, member\n  cap 10 by sender\n  read <- allow\n`;
1144:   try {
1145:     await writeFile(join(source, "schema.q"), schema() + audience);
1146:     delete process.env.SNAPBACK_URL;
1147:     owner = await RealOwnerHarness.create({ fixture: source });
1148:     await mkdir(join(directory, "snapback"));
1149:     await writeFile(join(directory, "snapback/schema.q"), schema().replace("  body: text <=100", "  body: text <=100\n  deliver to audience[.sender] by .member as deliveries") + audience);
1150:     await writeFile(join(directory, "snapback/ops.q"), operations());
1151:     cli(directory, ["check"]);
1152:     const project = JSON.parse(await readFile(join(directory, ".snapback/build/project.json"), "utf8"));
1153:     const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
1154:     const response = await fetch(`${owner.url}/control/apply`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-control": info.secret }, body: JSON.stringify({ project }) });
1155:     const report = await response.json();
1156:     assert.equal(response.status, 200, JSON.stringify(report));
1157:     assert.deepEqual(report.audienceBounds, { deliveries: 10 });
1158:     assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor, report);
1159:   } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
1160: });
1161: 
1162: test("cold owner regroup logs the old and new keys and serves the successor positional value", async () => {
1163:   const { directory, source } = await fixture();
1164:   const previousUrl = process.env.SNAPBACK_URL;
1165:   let owner: RealOwnerHarness | undefined;
1166:   try {
1167:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1168:     assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data, 1);
1169:     await owner.stop();
1170:     await writeFile(join(owner.root!, "snapback/schema.q"), schema("'text', 'image'", "recipient"));
1171:     await owner.start(false);
1172:     const line = "maintain counts: by sender → by recipient";
1173:     const report = cli(owner.root!, ["dev", "--status"]).successor;
1174:     assert.deepEqual(report.maintains, [line]);
1175:     const logs = (await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8")).split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
1176:     assert.deepEqual(logs.filter(row => row.successor === "applied" && row.report.to === report.to).map(row => row.report.maintains), [[line]]);
1177:     cli(owner.root!, ["check"]);
1178:     assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:bob"}', "--as", "bob"]).data, 1);
1179:     assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data, 0);
1180:   } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
1181: });
1182: 
1183: test("real owner input refusal exposes the head and dismissal returns args before the next queued send commits", async () => {
1184:   const { directory, source } = await fixture();
1185:   const previousUrl = process.env.SNAPBACK_URL;
1186:   let owner: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
1187:   try {
1188:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1189:     client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(join(directory, "client")) } });
1190:     await client.ready;
1191:     const drain = subscribe(client, api.ops.all, {}, () => {}, { drain: true });
1192:     try { await drain.until((event: any) => event.live === true, 3_000); } finally { drain.close(); }
1193:     await client.online(); await client.offline();
1194:     const args = { kind: "image", body: 'dismiss these original bytes: " \\ ☺' };
1195:     const first = await client.mutation(api.ops.send, args);
1196:     const second = await client.mutation(api.ops.send, { kind: "text", body: "after dismissal" });
1197:     assert.equal(first.state, "queued"); assert.equal(second.state, "queued");
1198:     await install(owner, "'text'");
1199:     await assert.rejects(client.online(), { code: "E_INPUT" });
1200:     assert.deepEqual((await client.outbox.status()).blocked, { intent: first.intent, code: "E_INPUT" });
1201:     const entry = (await client.outbox.entries()).find(e => e.intent === first.intent)!;
1202:     assert.deepEqual(await client.outbox.dismiss(first.intent!), { intent: first.intent, op: "ops.send", args, refusal: entry.refusal });
1203:     assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
1204:     assert.equal((await client.outbox.status()).blocked, undefined);
1205:     const entries = await client.outbox.entries();
1206:     assert.equal(entries.some(e => e.intent === first.intent), false);
1207:     assert.equal(entries.find(e => e.intent === second.intent)?.state, "committed");
1208:     const rows: any = await client.query(api.ops.all, {});
1209:     assert.equal(rows.data.some((row: any) => row.body === args.body), false);
1210:     assert.equal(rows.data.filter((row: any) => row.body === "after dismissal").length, 1);
1211:   } finally { await client?.close(); await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
1212: });
1213: 
1214: test("owner source changes rebuild distinct totals and report hot install, migration and cold open", async () => {
1215:   const { directory, source } = await fixture();
1216:   const previousUrl = process.env.SNAPBACK_URL;
1217:   let owner: RealOwnerHarness | undefined;
1218:   const posts = `\ntable posts:\n  sender: principal\n  read <- allow\n`;
1219:   const sourceSchema = (table: string) => (schema() + posts).replace("maintain counts: count messages", `maintain counts: count ${table}`);
1220:   try {
1221:     await writeFile(join(source, "schema.q"), sourceSchema("messages"));
1222:     const seedPath = join(source, "seed.ts");
1223:     await writeFile(seedPath, (await readFile(seedPath, "utf8")).replace("] } });", "], posts: [{ id: 'post-1', sender: 'dev:alice' }, { id: 'post-2', sender: 'dev:alice' }, { id: 'post-3', sender: 'dev:alice' }] } });"));
1224:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1225:     const count = () => cli(owner!.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data;
1226:     assert.equal(count(), 1);
1227:     await mkdir(join(directory, "snapback"));
1228:     await writeFile(join(directory, "snapback/ops.q"), operations());
1229:     for (const [route, from, to, expected] of [["apply", "messages", "posts", 3], ["migrate", "posts", "messages", 1], ["reopen", "messages", "posts", 3]] as const) {
1230:       let report: any;
1231:       if (route === "reopen") {
1232:         await owner.stop();
1233:         await writeFile(join(owner.root!, "snapback/schema.q"), sourceSchema(to));
1234:         await owner.start(false);
1235:         report = cli(owner.root!, ["dev", "--status"]).successor;
1236:       } else {
1237:         await writeFile(join(directory, "snapback/schema.q"), sourceSchema(to));
1238:         cli(directory, ["check"]);
1239:         const project = JSON.parse(await readFile(join(directory, ".snapback/build/project.json"), "utf8"));
1240:         const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
1241:         const response = await fetch(`${owner.url}/control/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-control": info.secret }, body: JSON.stringify({ project, plan: { drops: [] } }) });
1242:         report = await response.json();
1243:         assert.equal(response.status, 200, JSON.stringify(report));
1244:       }
1245:       const line = `maintain counts: from ${from} → from ${to}`;
1246:       assert.deepEqual(report.maintains, [line], route);
1247:       assert.equal(count(), expected, route);
1248:       assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor, report, route);
1249:       const logs = (await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8")).split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
1250:       assert.ok(logs.some(row => row.successor === "applied" && row.report.to === report.to && row.report.maintains.includes(line)), route);
1251:     }
1252:   } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
1253: });
1254: 
1255: // @ref LLP 1023.000#b--make-the-existing-one-client-freshness-path-sufficient —
1256: // execute the packaged consumer recipe against real owner envelopes, including equal-seq clock changes.
1257: test("timed Clique Insights load and refresh reach the screen on one durable client", { timeout: 60000 }, async t => {
1258:   const directory = await mkdtemp(join(tmpdir(), "snapback-timed-insights-"));
1259:   const source = join(directory, "source"), carrier = fileRangeStore(join(directory, "client"));
1260:   const previousUrl = process.env.SNAPBACK_URL;
1261:   let owner: RealOwnerHarness | undefined, client: any, screen: any;
1262:   let delayed: { arrived: ReturnType<typeof Promise.withResolvers<any>>; release: ReturnType<typeof Promise.withResolvers<void>> } | undefined;
1263:   const envelopes: any[] = [], paints: any[] = [], observedFrames: any[] = [];
1264:   let transportDown = false;
1265:   const { JSDOM } = await import("jsdom");
1266:   const dom = new JSDOM("<output></output>"), output = dom.window.document.querySelector("output")!;
1267:   const paint = (value: any) => { paints.push(structuredClone(value)); output.textContent = JSON.stringify(value); };
1268:   const saved = new Map<string, string>();
1269:   const tokenStore = browserTokenStore({ getItem: key => saved.get(key) ?? null,
1270:     setItem: (key, value) => { saved.set(key, value); }, removeItem: key => { saved.delete(key); } }, "insights");
1271:   const kinds = ["posts", "likesReceived", "repostsReceived", "repliesReceived", "followers", "following"];
1272:   const totals = kinds.map(kind => `${kind}: totals[viewer, '${kind}']`).join(", ");
1273:   const week = Array.from({ length: 7 }, (_, i) =>
1274:     `d${i}: { day: today - ${6-i}, posts: daily[viewer, today - ${6-i}, 'posts'], likesReceived: daily[viewer, today - ${6-i}, 'likesReceived'] }`).join(", ");
1275:   try {
1276:     await mkdir(source);
1277:     await writeFile(join(source, "schema.q"), `use identity
1278: table profiles:
1279:   principal: principal
1280:   name: text <=40
1281:   unique byPrincipal: principal
1282:   read <- allow
1283:   insert <- .principal = viewer
1284: 
1285: table events:
1286:   who: principal
1287:   kind: enum('posts', 'likesReceived', 'repostsReceived', 'repliesReceived', 'followers', 'following')
1288:   day: int
1289:   read <- .who = viewer
1290:   insert <- .who = viewer
1291: 
1292: maintain totals: count events by who, kind
1293:   read <- .who = viewer
1294: maintain daily: count events by who, day, kind
1295:   read <- .who = viewer
1296: `);
1297:     await writeFile(join(source, "insights.q"), `query screen():
1298:   today = divmod(now, 86400000).quotient
1299:   return { viewer: profiles[viewer], ${totals}, week: { ${week} } }
1300: 
1301: mutation profile():
1302:   insert profiles { principal: viewer, name: 'Alice' }
1303:   return true
1304: 
1305: mutation record(kind: enum('posts', 'likesReceived', 'repostsReceived', 'repliesReceived', 'followers', 'following')):
1306:   insert events { who: viewer, kind, day: divmod(now, 86400000).quotient }
1307:   return true
1308: `);
1309:     await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
1310: export default seed({ personas: ['alice', 'bob'], rows: {
1311:   profiles: [{ id: 'alice-profile', principal: 'dev:alice', name: 'Alice' }],
1312:   events: [{ id: 'hidden', who: 'dev:bob', kind: 'posts', day: 0 }]
1313: } });`);
1314:     owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
1315:     // Cross UTC midnight inside a fresh session. A whole-day jump also expires
1316:     // the bearer and correctly makes that refresh obsolete after auth fencing.
1317:     const clockInfo = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
1318:     const dayMs = 86400000;
1319:     const alignClock = await fetch(`${owner.url}/control/clock`, { method: "POST", headers: {
1320:       "content-type": "application/json", "x-snapback-control": clockInfo.secret,
1321:     }, body: JSON.stringify({ advanceMs: (dayMs - Date.now() % dayMs - 60000 + dayMs) % dayMs }) });
1322:     assert.equal(alignClock.status, 200, await alignClock.text());
1323:     const traced: typeof fetch = async (input, init) => {
1324:       if (transportDown && new URL(String(input)).pathname === "/api/query") throw new TypeError("controlled transport loss");
1325:       const response = await fetch(input, init);
1326:       if (new URL(String(input)).pathname === "/api/query" && JSON.parse(String(init?.body)).op === "insights.screen") {
1327:         const body: any = await response.clone().json();
1328:         envelopes.push(body);
1329:         const gate = delayed;
1330:         if (gate) { delayed = undefined; gate.arrived.resolve(body); await gate.release.promise; }
1331:       }
1332:       return response;
1333:     };
1334:     client = createClient({ url: owner.url, tokenStore, fetch: traced, offline: { store: carrier } });
1335:     await client.ready;
1336:     await client.auth.guest();
1337:     assert.equal((await client.mutation(api.insights.profile, {})).state, 'committed');
1338:     // Populate distinct real maintained groups; missing groups and the hidden Bob group stay zero.
1339:     for (const kind of ["posts", "posts", "likesReceived", "followers", "following", "following"]) {
1340:       assert.equal((await client.mutation(api.insights.record, { kind })).state, "committed");
1341:     }
1342:     const guide = await readFile(new URL("../guide/live-query.md", import.meta.url), "utf8");
1343:     const recipe = /## Load and refresh[\s\S]*?```js\n([\s\S]*?)\n```/.exec(guide)![1];
1344:     const mount = new (Object.getPrototypeOf(async function() {}).constructor)("client", "api", "paint",
1345:       recipe + "\nreturn { refresh, cancel, close };");
1346:     screen = await mount(client, api, paint);
1347:     const loaded = paints.at(-1);
1348:     assert.equal(loaded.state, "complete", JSON.stringify(paints));
1349:     assert.equal(JSON.parse(output.textContent!).data.posts, 2, "owner load reaches the displayed consumer");
1350:     assert.equal(loaded.live, undefined, "imperative owner result has no offline marker");
1351:     assert.equal(loaded.data.viewer.name, "Alice");
1352:     assert.deepEqual(kinds.map(kind => loaded.data[kind]), [2, 1, 0, 0, 1, 2]);
1353:     assert.deepEqual(Object.values(loaded.data.week).map((day: any) => [day.posts, day.likesReceived]), [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[2,1]]);
1354:     assert.equal(envelopes.at(-1).readTime !== undefined, true, "Quarry now carries the owner's read clock");
1355:     for (const options of [{ live: false as const }, {}]) {
1356:       const observed = client.observe(api.insights.screen, {}, options);
1357:       const frames: any[] = [];
1358:       const off = observed.subscribe(() => { const value = observed.getSnapshot(); frames.push(value); observedFrames.push(value); });
1359:       try {
1360:         await until(async () => frames,
1361:           frames => frames.some(frame => frame.receipt?.source === "server" && frame.data?.posts === 2), "Insights observation owner delivery");
1362:         assert.equal(frames.some(frame => frame.data?.posts === 0), false, "never-held is not a zero paint");
1363:       } finally { off(); }
1364:     }
1365:     const oldGate = { arrived: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
1366:     delayed = oldGate;
1367:     const older = screen.refresh();
1368:     const oldEnvelope = await oldGate.arrived.promise;
1369:     assert.equal(paints.at(-1).state, "refreshing");
1370:     const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
1371:     const clock = await fetch(`${owner.url}/control/clock`, { method: "POST", headers: {
1372:       "content-type": "application/json", "x-snapback-control": info.secret,
1373:     }, body: JSON.stringify({ advanceMs: dayMs - oldEnvelope.readTime % dayMs + 1000 }) });
1374:     const clockState = await clock.clone().json();
1375:     assert.equal(clock.status, 200, await clock.text());
1376:     const newer = await screen.refresh();
1377:     assert.equal(newer.state, "complete", JSON.stringify(newer));
1378:     assert.equal(newer.seq, oldEnvelope.seq, "UTC rollover needs no durable write");
1379:     assert.equal(paints.at(-1).data.week.d6.day, loaded.data.week.d6.day + 1);
1380:     assert.deepEqual(Object.values(paints.at(-1).data.week).slice(-2).map((d: any) => [d.posts, d.likesReceived]), [[2,1],[0,0]]);
1381:     const display = output.textContent;
1382:     oldGate.release.resolve();
1383:     assert.equal(await older, "obsolete");
1384:     assert.equal(output.textContent, display, "the delayed same-sequence answer cannot repaint or finish a newer refresh");
1385:     const unchanged = await screen.refresh();
1386:     assert.deepEqual(unchanged.data, newer.data, "an unchanged owner answer still finishes refresh");
1387:     assert.equal((await client.mutation(api.insights.record, { kind: "likesReceived" })).state, "committed");
1388:     await screen.refresh();
1389:     assert.equal(paints.at(-1).data.likesReceived, 2);
1390:     assert.equal(paints.at(-1).data.week.d6.likesReceived, 1);
1391: 
1392:     await client.offline();
1393:     await screen.refresh();
1394:     const offline = paints.at(-1);
1395:     assert.equal(offline.live, false);
1396:     assert.equal(offline.state, "partial", JSON.stringify(offline));
1397:     assert.equal(offline.data, undefined, "timed mixed totals cannot invent replay coverage");
1398:     screen.close(); screen = undefined;
1399:     await client.close();
1400:     client = createClient({ url: owner.url, tokenStore, startOffline: true, offline: { store: carrier }, fetch: traced });
1401:     await client.ready;
1402:     screen = await mount(client, api, paint);
1403:     assert.equal(paints.at(-1).state, "partial");
1404:     assert.equal(paints.at(-1).data, undefined);
1405:     await client.online();
1406:     const reconnected = await screen.refresh();
1407:     assert.ok(paints.at(-1).data, JSON.stringify({reconnected, paints: paints.slice(-5), snapshot: {auth: client.snapshot.auth, connection: client.snapshot.connection}}));
1408:     assert.equal(paints.at(-1).data.likesReceived, 2);
1409: 
1410:     transportDown = true;
1411:     await screen.refresh();
1412:     assert.equal(paints.at(-1).live, false, "transport fallback never finishes as an owner-fresh answer");
1413:     assert.equal(paints.at(-1).data, undefined);
1414:     transportDown = false;
1415:     await client.online();
1416:     await screen.refresh();
1417: 
1418:     const generationGate = { arrived: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
1419:     delayed = generationGate;
1420:     const oldProgram = screen.refresh(); await generationGate.arrived.promise;
1421:     await client.offline();
1422:     await owner.stop();
1423:     const schemaPath = join(owner.root!, "snapback/schema.q");
1424:     await writeFile(schemaPath, (await readFile(schemaPath, "utf8")).replace("  name: text <=40", "  name: text <=40\n  note: text <=40 ?"));
1425:     await owner.start(false);
1426:     // The dev control clock is process-local. Restore its offset before any
1427:     // bearer request: moving time behind session creation correctly refuses auth.
1428:     const restarted = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
1429:     const restoreClock = await fetch(`${owner.url}/control/clock`, { method: "POST", headers: {
1430:       "content-type": "application/json", "x-snapback-control": restarted.secret,
1431:     }, body: JSON.stringify({ advanceMs: clockState.offsetMs }) });
1432:     assert.equal(restoreClock.status, 200, await restoreClock.text());
1433:     await client.online();
1434:     await screen.refresh();
1435:     assert.equal(paints.at(-1).data?.viewer?.note, null, JSON.stringify(paints.slice(-3)));
1436:     const evolved = output.textContent;
1437:     generationGate.release.resolve();
1438:     assert.equal(await oldProgram, "obsolete");
1439:     assert.equal(output.textContent, evolved, "predecessor program answer cannot overwrite the successor");
1440: 
1441:     const cancelledGate = { arrived: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
1442:     delayed = cancelledGate;
1443:     const cancelled = screen.refresh(); await cancelledGate.arrived.promise;
1444:     screen.cancel();
1445:     const cancelledPaint = JSON.stringify(paints.at(-1));
1446:     cancelledGate.release.resolve();
1447:     assert.equal(await cancelled, "obsolete");
1448:     assert.equal(JSON.stringify(paints.at(-1)), cancelledPaint);
1449:     const accountGate = { arrived: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
1450:     delayed = accountGate;
1451:     const predecessor = screen.refresh(); await accountGate.arrived.promise;
1452:     await client.auth.guest();
1453:     assert.deepEqual(paints.at(-1), { state: "unavailable" }, "account change clears displayed predecessor data");
1454:     accountGate.release.resolve();
1455:     assert.equal(await predecessor, "obsolete");
1456:     await screen.refresh();
1457:     assert.equal(paints.at(-1).data.viewer, null);
1458:     assert.deepEqual(kinds.map(kind => paints.at(-1).data[kind]), [0,0,0,0,0,0]);
1459:     t.diagnostic(JSON.stringify({ owner: envelopes.map(e => ({ state: e.state, seq: e.seq, readTime: e.readTime,
1460:       rows: e.rows?.length, receipt: e.receipt, data: e.data })), observedFrames, paints }));
1461:   } finally {
1462:     delayed?.release.resolve();
1463:     screen?.close(); dom.window.close(); await client?.close(); await owner?.close();
1464:     if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
1465:     await rm(directory, { recursive: true, force: true });
1466:   }
1467: });
```

## Existing read contract

## 6. Reads offline

**Maintained totals (2026-09-11).** Quarry's typed zero for an absent or
unreadable maintained target requires authority. If a local execution has an
uncovered maintained point, its entire result (including arithmetic and
composites of totals) has no publishable data: the hook is `unavailable` with
reason `partial` until a receipt permits the answer. Previously held complete
zeros remain readable with their original freshness. The real-owner Insights
hook regression covers warm and cold clients, count/sum/computed totals, and
legitimate absent/hidden zeros.
Literal containers of totals can keep their complete checked owner answer
when a partial twin cannot reconstruct a hidden count or sparse sum. This
requires the same qualified owner selection (sequence and durable order),
receipt custody, no returned pooled rows, no missing fact proofs, no retention
rewrite, no execution clock, and no newer prediction (including removal-only
overlays). Eviction and missing-rule-authority partials cannot use it. Mixed
row/projection composites and timed queries still need their own exact rerun;
the fallback adds no authority to the unheld target.

A public (`read <- allow`) unique-key point can also be covered by a held,
exhausted range whose typed scope contains that complete key. This is read
coverage: it adds neither an alternate-index negative rule fact nor primary
mutation authority, and does not infer a maintained row address. The point
lookup validates its complete ordinary key before coverage reuses
`hasCompleteRange`; no second key preparation or broader authority is needed.
A public Count query's independently proved empty group range therefore lets an exact
local rerun keep a row-plus-zero composite. A truncated or bounded fragment
alone cannot discharge that point; evicted, wrong-scope or wrong-rule evidence
cannot establish the required complete coverage. Restricted
read rules retain their existing authority requirements, and pooled-answer
fallback guards above remain unchanged. The evaluator contrast controls and
real-owner durable observation/cold-reopen regression qualify this boundary.

**The twin is the client.** `useQuery(op, args)` with the backend
unreachable runs the certified program through the twin
(`snapback2-evaluator`) hydrated from the carrier's coherent snapshot and
revision deltas: rows, ranges, absences, and verdicts. A read inside coverage
is exact; a read outside is `partial`
at that site with `reason: 'never-held' | 'evicted' | 'computed-key'`. The
published Snapshot carries `freshness.live: false`,
`freshness.connection: 'offline'`, `freshness.staleSince` when stale, and
`local.retained: true` when §5 rule 4 kept a row. Its receipt preserves the
certified outcome and partial sites. A query whose every read is covered
replays exactly, which is what a stored answer is — the covered case, not a
separate mechanism. A partial without data is `status: 'unavailable'` with
reason `partial`; the twin's no-held-data marker while disconnected is
`unavailable` with reason `offline`. Snapshot summaries follow LLP 1018.003;
the internal hydrating event is not the hook's public status. The evaluator
ticket's "done when" list is lane O2's acceptance verbatim: the certified
program and certificate on the wire (§8), receipt custody, successor and
auth-epoch fences, canonical hashing, and the five outcome classes proven
against the server.

**Shared installation (2026-09-09, LLP 1018.007.002).** Concurrent readers
share one source-synchronization flight, not one mutable query evaluation.
The flight captures principal, program identity, generation, schema and the
runtime auth epoch. Source results are revalidated before installation; a
successor cannot join a predecessor's authority. A reader arriving after a
captured revision requests another delta pass. Root replacement reloads cold
inside the flight instead of recursively awaiting the public entry point.
Cold rows, indexes and receipt custody are built privately and published in
one synchronous turn; failed reads remain retryable. Immutable prepared leaves
can be shared, while generic mutable source values remain isolated.

**Execution-local hashes (2026-09-09, LLP 1018.007.002).** A synchronous
evaluator execution has one fixed schema and fixed rule objects. Compute the
canonical schema-scoped hash once for each distinct rule identity in that
Runner, retaining the existing canonical hash function and wire bytes. Repeated
candidate checks and range receipts reuse that value, not authorization
verdicts from another execution. A new Runner recomputes even if its caller
reuses a schema object that has since changed. No process-global or cross-query
hash cache can outlive the schema/program authority that justified it.

LLP 1018.007.000's later sustained-send profile permits a narrowly owned
extension: an explicitly isolated, deeply immutable admitted schema may own
its canonical schema/rule hashes across fresh Runners. Eligibility must come
from that ownership boundary, not a caller-supplied digest, object identity
alone, or a shallow `Object.isFrozen` check. Mutable direct-evaluator inputs
keep the execution-local fallback above. A changed schema/program gets new
custody; changing rows, viewer or auth epoch still executes fresh permission
checks. Only deterministic canonical bytes are reusable, never rule verdicts,
row visibility or a previous query's trace. Tests must preserve public-hasher
parity, caller isolation, nested immutability and successor rule changes even
when an outer rule's shape is unchanged. No runtime byte-cap increase is
authorized by this optimization.

**Owner page continuation (2026-09-09, LLP 1018.007.003).** An ordinary
observed page keeps a receipt-backed capped owner answer whole when its local
rerun has that same owner's selection proof but cannot reconstruct the
computed projection or owner continuation. It does not attach an old cursor
to a different local result. A successor or unrelated checked delivery may
advance the store-wide local sequence without changing the head page. That
sequence alone cannot revoke the head: the local rerun must carry the head's
exact qualified membership observation `{ through, order }`. A missing or
different selection, active overlay custody (including a committed removal
awaiting retirement), denied or invalidated custody, and maintained-sibling
incoherence still win over that fallback. Drain observations retain their
independent page/tail lifecycle. The 45-row real owner/carrier/React witness
exercises Global, Following and author pages across refresh, moving boundaries
and cold reopen; local cursor tokens remain forbidden on the transport.

The current overlay guard is deliberately partition-wide, not a row-key or
operation-name dependency guess. An apparently unrelated prediction can
therefore temporarily select a truthful partial without continuation. Once
that overlay retires, still-valid owner selection can be used again. This is
a conservative availability limit, not proof that the server has only one
page. A narrower guard needs sound dependencies covering filters, maintained
values, permission reads, absences and ranges; intersecting returned row ids
alone cannot establish that. No such dependency mechanism is introduced by
the Clique correction.

**Maintained-group range custody (2026-09-09, LLP 1018.007.003).** A source
transition for one engine-maintained group does not withdraw an independently
proved range for a different group merely because both targets share a table.
The target-table reverse index supplies candidates, not table-wide membership.
The carrier may retain a candidate range only when its admitted immutable index
meaning equality-binds a `maintain by` column and the transition's typed group
value differs there. Same-group ranges, prefixes whose index columns cannot be
matched to the maintained group, point references and absences, and target
invalidations without source-transition evidence remain conservative and make
the owner partial. This is range-membership coherence; it neither pastes an
owner cursor onto a changed projection nor weakens sequence, revocation,
overlay, generation or authority fences.

**Retained projections and page boundaries (2026-09-08).** Retention keeps
authorized row bodies; restoring older bodies into a newer answer or purging
projection literals does not preserve the exact whole-query result. Such
answers are `partial`, including array projections. The retained rows remain
readable, while count, preview and other composite fields cannot claim a
complete typed result. An exact local reconstruction or fresh full delivery
can restore completeness. The local partial may preserve its already-certified
owner `next` as a positional page boundary; it neither certifies the altered
projection nor creates complete range coverage. Authority invalidation clears
that boundary. Ordinary incomplete local executions mint no continuation, and
wire partials still carry none. The reducer and Snapshot preserve a partial's
continuation only with its existing `retained` fact.

Mounted named queries subscribe to the carrier's committed input revisions.
After a swap changes rows, coverage, authority, a query clock, or the prediction
overlay, each active shared entry reevaluates against the finished atomic state
and publishes one immutable snapshot to headless and React consumers. Overlap is
coalesced per entry; receipt/grant bookkeeping that cannot change evaluation is
silent; equal results retain identity. A server frame's own store commit therefore
does not double-publish. Program and account fences discard late reevaluations.

**The coverage rule that makes "everything on the phone" exact.** A
certified-uniform prefix range drained to `next: null` is the viewer's whole
partition for that prefix, proven by receipt. The twin therefore treats a
fully drained uniform prefix as covering **every named query over that
prefix on any index**. That is why `thread(conversationId)`, which reads
the log on a different index than the drain, replays exactly for a chat the
viewer never opened online, and why a queued send appears inside that
thread's result, in order, as `predicted`. It is not a relational replica
in the design's sense: only named programs, only the viewer's own
partition, completeness proven rather than assumed — the design's own
`replica` notion for owner partitions, reached from the log.

**`drain: true`.** One subscription option (§3). Its Snapshot exposes
`local.caughtUp` and `local.watermark`. Offline, `caughtUp` means the last
online drain reached `next: null`, and `freshness.staleSince` stays visible. This is the only new
read surface in v1; a `useDrain` hook is the same thing with a second name
and is not added.
The cursor argument is restored from the held program on cold offline
startup. Following a repeated cursor is refused rather than retried in an
unbounded loop. Offline traversal never advances the persisted server watermark.

**Drain admission correction (2026-09-06, Codex Astra xhigh).**
The owner shares `resumable_log_cursor` between drain and resume admission.
It reuses LLP 1011 §B1's return-provenance walk: every possible return must
be a certified ascending page of at most 50 rows, continued through the same
declared Cursor argument, including stable aliases and shaped/conditional
returns. Unrelated auxiliary scans/cursors confer no eligibility; mixed-order
branches and non-page returns conservatively refuse the operation as a drain.
Fallthrough and early returns inside loops also lack certified page provenance.
Ordinary descending queries and separately fetched history stay valid.
The descriptor travels in the existing manifest/program metadata and is held
with its generation. Online query/subscription requests use `drain=1`; the
owner validates each page and live rerun after authentication. Offline drains
require held eligibility; legacy missing metadata must reconnect. No cursor
is decoded by the client to decide admission, and authorization is unchanged.
Refusal precedes durable watermark/catch-up success, reaches callbacks/hooks
and current/later waiters, and never clears valid coverage, grants or queued IDs.
Each event remains one page; the application log must append events for edits
and removals. The last tail is live, not every historical page.

**Bounded acquisition (2026-09-11).** The first-party online drain may request
up to sixteen ordinary envelopes through the same query route, bounded by a
1 MiB transport target and a 20 ms owner turn checked between executions.
Each envelope retains its own arguments, sequence, receipt and validator.
Full structural preflight precedes independently durable groups of four pages;
a later failure preserves an earlier committed prefix. Every accepted public
page still emits its own item evidence, with a lifecycle fence between callbacks.
Only actual exhaustion records the caught-up watermark; interrupted work may
replay idempotently. Grouped persistence and lazy private integrity indexes do
not change the 50-row certificate or complete/partial/held meanings. The
[implementation and qualification plan](./1018.008.007.002-bounded-bulk-acquisition.plan.md)
records the limits, journal measurements and performance results.

**Search offline.** Search remains an ordinary named query over an
engine-maintained `wordPrefixes` index. The persistent twin replays the same
Unicode normalization, scope merge, ordering, prediction, and trace
invalidation over effective held rows. A complete source scope can answer a
previously unseen term as `held`; incomplete membership/history is `partial`,
and bounded discovery or execution is `capped`. The cursor identifies the
normalized non-cursor arguments and current partition/program/schema,
incarnation, authority, effective-row, and overlay revisions. React, Expo, and
headless callers see these facts directly; no app-side substring fallback
manufactures a stronger answer.

The O2b implementation and browser/Expo witness corrections preserve these
rules: local coverage derives from held-answer receipts; broken drained-page
chains prove no whole range; offline remounts do not advance the stored resume
watermark; and retained answers remain fallbacks when a local rerun cannot
produce an admissible result. The detailed implementation chronology is in
[LLP 1022](./1022-local-first-v1-implementation-history.explainer.md#read-store-and-witness-implementation-record).

### Indexed held search

**2026-09-07 integration record.** Under the user's
explicit delegation, Codex takes engine-owned `wordPrefixes` indexing and the
persistent indexed twin onto the doing-list. Exact 2 waits until this search
qualifies on React web and Expo. The **complete local-runtime ceiling is 90,000 bytes gzip,
with 80,000 the working target**, per the frozen allocation below; normalization data/decoding, indexing,
incremental state, prediction and local cursors all participate in the measured
entry. Relocating required payload is not a saving. No new gate or repository
design document is introduced. LLP 1001 §"Unicode search foundation" records
the one ordinary core `build.rs` exception and shared Unicode/key primitives.
**Implementer/date:** Codex gpt-6-astra at xhigh, foundation 2026-09-06;
engine/compiler/twin integration in the 2026-09-07 LLP 1018 run. The chat
template now declares the global membership merge and calls
`api.messages.search` on web and Expo. Its witnesses use one
decomposed-uppercase Unicode term for warm, cold, prediction, settlement, and
revocation checks. Final capability qualification still depends on those real
web/Expo witnesses and the measurements below.

The superseded 34,000, 50,000, 66,000, and 82,000-byte allocations, their
incomplete measurements, and allocation-review record moved to
[LLP 1022](./1022-local-first-v1-implementation-history.explainer.md#indexed-search-allocation-history).
The current allocation and measurement method follow.

### Bytes — frozen allocation

**2026-09-10 (author amendment; current allocation).** Charlie explicitly
approved a **90,000-byte gzip ceiling**, retaining the **80,000-byte target**
and existing size checks, after recovery landed at 84,986 bytes. This buys
implementation room beyond 14 bytes of headroom without removing the fixed
five-root measurement, changing its pinned toolchain, or widening the separate
1% comparable-growth guard. The earlier one-time 2% public-package allowance
for recovery remains a separate, scoped decision. No historical measurement
or accepted baseline is reset. Rationale and authorization: LLP 1018.008 §10.
This supersedes the 85,000-byte allocation preserved in LLP 1022, not the requirement to
justify growth or fit future features by deletion/descope.

**Elegance program §E, implemented/revised 2026-09-08, Codex GPT-6 Astra.**
Every arm, including the default entry and witnesses, forwards modules reachable
from the client to one packaged implementation. Generated forwarding aliases
belong to `snapback2/internal`; `client.mjs` exports only the authored public
surface. ES module splitting places shared bodies in the private
`client-runtime.mjs` chunk. The existing nominal image module remains shared.
React and Expo adapter targets remain 12,000 and 16,000 gzip bytes respectively.

Every loop record carries client, React, Expo and complete-runtime byte fields.
The first three count each entry's complete packaged static dependency closure,
summing gzip level 9 once per file; moving a body into a chunk cannot hide bytes.
The five-root source measurement is unchanged and appends current-SHA evidence
to `metrics/twin.jsonl`. Only successful package builds and measurements on
Node 24.18.0 / esbuild 0.25.9 / gzip 9 publish trusted values. Rejected values
remain raw evidence. The 1% guard compares with the last accepted comparable
record; scoring and the loop checks precede recording acceptance, so a rejected
candidate cannot approve its own retry. Prior leaf-only records are not
comparable to the packaged-closure measure; failed parent-SHA lines remain
historical evidence, never baselines. The existing self-tests exercise these
histories, rebuild absent `dist/`, and execute browser/native/node exports with
shared constructor identity and real file/SQLite store operations.

Superseded allocation amendments and their historical measurements are
preserved in [LLP 1022](./1022-local-first-v1-implementation-history.explainer.md#indexed-search-allocation-history).

Keep one indexed store per open principal/program/schema generation. Cold open
constructs it once; warm evaluation consumes an incrementally maintained atomic
snapshot, not whole-history `coverage()` cloning. Immutable rows and a prediction
journal maintain FIFO overlay contributions per row. Removing/rejecting/retiring
an overlay recomputes effective rows/postings; authoritative absences, tombstones,
expiry and applicable revocations dominate stale overlays. Queued intent IDs,
arguments and point/verdict replay traces remain fixed. Ranges still re-execute
against current state at server replay and are not snapshot-compared.

A maintained readable-source scope directory includes delivered-history rows
even when membership downloads are partial. Their existing hidden-case
readability remains; explicit purges still remove them. Until-revoked rows need
current authority evidence. Missing required authority remains partial with no
computed result or continuation; index presence grants nothing. Eligible global
search receives a compiler-certified held execution descriptor only when lane
discovery enumerates the source rule's authorization scopes without extra
application filters or side effects. It may enumerate that source directory
locally without fabricating membership rows/verdicts. Ordinary scope arguments
still filter; arbitrary merges keep normal replay.

The 1,000-chat guide form does not widen that eligibility. It pages every
current membership, executes the ordinary certified one-row search in each
scope, and uses `snapback2/global-search-pager` for the descending union. The
pager bounds one-shot concurrency, refills only the winning scope, suppresses
duplicate ids, refuses silent directory truncation, and exposes the weakest
unusable receipt before advancing. Its calls are separately authorized
snapshots; local held/partial results never become global complete authority.

`held` means exact over locally readable held rows in the requested scope when
local enumeration is whole but server coverage is not. Directory overflow,
truncated discovery or exhausted execution bounds remain `capped`; covered
queries retain ordinary complete/capped page rules. Complete source scopes
cover unseen terms; complete term-search ranges never imply whole source scopes.
No result claims more than its authority/coverage proves.

Local `h1` cursors bind every query value except the selected page's cursor (word bindings by
normalized meaning), operation/page descriptor, partition, program/schema,
fresh store incarnation and authority/effective-row/overlay revisions plus the
ordinary suffix. Their byte bound follows declared arguments; current server
cursor identity and 4,096-byte payload limit stay. Changes reject a local cursor
and restart paging. Server preflight rejects `h1` before any discovery; clients
never send it after reconnect. It cannot move a drain watermark, retire an
overlay or prove server progress. Cold reopen has a fresh incarnation.
The native return-path proof issues the selected cursor name with manifest and
program custody. All certified page returns must use the same formal; aliases,
helper expansion and unrelated earlier cursor arguments do not change it.
Different cursor bindings across return paths leave local continuation absent.
Every other cursor argument stays in the local binding. Transport clears local
tokens in all declared cursor fields, including after a successor loses a
selected page, and preserves ordinary text arguments unchanged.

Before this integration qualifies: measure the complete twin, actual 100-lane
whole media-bearing message closure and max-width operations under the existing
1M-step/4 MiB closure/8 MiB heap/1 MiB output limits; prove warm never-queried and
cold process-kill search, partial memberships/history, authority/retention,
negative-overlay dominance and cursor fences; measure phone cold-build peak and
the full-engine 10%/50%/100% latency curve. The foundation's Unicode conformance
is evidence for its primitive, not those integration claims.


