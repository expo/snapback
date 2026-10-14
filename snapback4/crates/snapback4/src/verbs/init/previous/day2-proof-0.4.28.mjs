// npm run day2:proof -- versions/v1.q versions/v2.q
// Saved sources belong outside snapback/, where every .q file compiles together.
// Add your business assertions at each release transition.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, rollback, startServe, testSource, cli, cleanup } from "snapback4/proof";
const [v1, v2] = process.argv.slice(2);
if (!v1 || !v2) throw Error("usage: npm run day2:proof -- versions/v1.q versions/v2.q");
const before = await Promise.all([readFile(v1), readFile(v2)]);
const directory = await mkdtemp(join(tmpdir(), "snapback4-day2-"));
let serve;
try {
  await testSource(v1);
  await testSource(v2);
  await deploy(directory, v1);
  serve = await startServe(directory);
  await deploy(directory, v2);
  await rollback(directory, 1);
  await rollback(directory, "latest");
  const history = await cli(["releases", directory, "--json"]);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(await Promise.all([readFile(v1), readFile(v2)]), before);
  console.log("day2:proof passed: deploy, hot upgrade, rollback and forward; sources unchanged");
} finally { await cleanup(() => serve?.stop(), () => rm(directory, { recursive: true, force: true })); }
