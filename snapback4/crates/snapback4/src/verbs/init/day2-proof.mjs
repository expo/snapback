// API signatures: snapback4 guide api proof | client | auth | generated
// npm run day2:proof
// Saved sources belong outside snapback/, where every .q file compiles together.
// Add your business assertions at each release transition.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, rollback, startServe, testSource, cli, cleanup } from "snapback4/proof";
import { runProofSuite } from "snapback4/proof-runner";
await runProofSuite(async () => {
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
  const catalog = await checked(["sql", ".tables", "--release", directory, "--json"]);
  const ephemeral = new Set(catalog.tables.filter(table => table.kind === "ephemeral table").map(table => table.name));
  const tables = declarations.map(([name]) => name).filter(name => !ephemeral.has(name));
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

});
