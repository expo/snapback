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
  // The default below proves storage conservation only, not business policy.
  return [];
  // BUSINESS_ASSERTION_END
}
async function checked(args) {
  const result = await cli(args); assert.equal(result.code, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}
const tableIdentity = new Map();
async function snapshotAll() {
  const status = await checked(["releases", directory, "--json"]);
  const source = join(directory, "releases", String(status.release), "snapback");
  const files = await readdir(source); const tables = new Set();
  for (const file of files.filter(file => file.endsWith(".q"))) {
    const text = await readFile(join(source, file), "utf8");
    for (const match of text.matchAll(/^table (\w+)(?: renamed from (\w+))?:/gm)) {
      tables.add(match[1]);
      if (match[2]) tableIdentity.set(match[1], tableIdentity.get(match[2]) ?? match[2]);
    }
  }
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
  await assertBusiness({ url: serve.url, release: "v2" });
  let current = await snapshotAll();
  compareMoves(oldRows, current); // compare ids, never array order
  for (let cycle = 0; cycle < 2; cycle++) {
    await rollback(directory, 1);
    const writes = await assertBusiness({ url: serve.url, release: "rollback-v1" });
    assert.ok(writes.every(write => typeof write.id === "string" && Array.isArray(write.fields) && write.fields.every(field => typeof field === "string")));
    const changedByV1 = new Map(writes.map(write => [write.id, write.fields]));
    const older = await snapshotAll();
    compareMoves(current, older, { required: oldRows.keys() }); // v2-native rows may lack a v1 view
    await rollback(directory, "latest");
    await assertBusiness({ url: serve.url, release: "forward-v2" });
    const forward = await snapshotAll();
    compareMoves(current, forward, { ignore: changedByV1, values: true });
    compareMoves(older, forward); // includes new v1-client rows
    current = forward;
  }
  const history = await cli(["releases", directory, "--json"]);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(await Promise.all([snapshot(v1), snapshot(v2)]), before);
  console.log("day2:proof passed: persisted ids and values across two rollback/forward cycles; sources unchanged (add business assertions for policy coverage)");
} finally { await cleanup(() => serve?.stop(), () => temporary && rm(directory, { recursive: true, force: true })); }
