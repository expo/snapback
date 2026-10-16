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
  // BUSINESS_ASSERTION_BEGIN: replace this block with authenticated persisted-row,
  // backfill and refusal assertions against url for each release transition.
  assert.fail(`day2:proof needs a business assertion for ${release} at ${url}; replace BUSINESS_ASSERTION_BEGIN in scripts/day2-proof.mjs`);
  // BUSINESS_ASSERTION_END
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
  await testSource(v1);
  await testSource(v2);
  await deploy(directory, v1);
  serve = await startServe(directory);
  await assertBusiness({ url: serve.url, release: "v1" });
  await deploy(directory, v2);
  await assertBusiness({ url: serve.url, release: "v2" });
  await rollback(directory, 1);
  await assertBusiness({ url: serve.url, release: "rollback-v1" });
  await rollback(directory, "latest");
  await assertBusiness({ url: serve.url, release: "forward-v2" });
  const history = await cli(["releases", directory, "--json"]);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(await Promise.all([snapshot(v1), snapshot(v2)]), before);
  console.log("day2:proof passed: deploy, hot upgrade, rollback and forward; sources unchanged");
} finally { await cleanup(() => serve?.stop(), () => temporary && rm(directory, { recursive: true, force: true })); }
