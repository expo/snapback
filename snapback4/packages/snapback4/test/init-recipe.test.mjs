import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.SNAPBACK4_BIN ?? resolve(root, "../../target/debug/snapback4");

test("Retired Following installer refuses fresh and existing Expo projects without changing files", (t) => {
  for (const expo of [false, true]) for (const prefix of ["", "feed", "social_2"]) {
    const dir = mkdtempSync(join(root, ".init-recipe-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = (args) => spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    if (expo) {
      const starter = run(["init", "--expo"]);
      assert.equal(starter.status, 0, starter.stderr);
    }
    const snapshot = () => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
      .map(e => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name), "utf8")]).sort();
    const before = snapshot();
    const refused = run(["init", "--recipe", "feeds", ...(prefix ? ["--prefix", prefix] : []), "--authors", "1008", "--edges", "5921"]);
    assert.equal(refused.status, 2);
    for (const phrase of ["E_RECIPE_RETIRED", "maintain feed: timeline", "size authors 1008, edges 5921", "snapback4 guide feeds"]) {
      assert.ok(refused.stderr.includes(phrase), refused.stderr);
    }
    assert.deepEqual(snapshot(), before);
    if (expo) assert.equal(run(["check"]).status, 0);
  }
});

test("Removed search recipe gets the ordinary unknown-recipe refusal", (t) => {
  const dir = mkdtempSync(join(root, ".init-recipe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (recipe) => spawnSync(binary, ["init", "--recipe", recipe], { cwd: dir, encoding: "utf8" });
  const unknown = run("unknown"), removed = run("search");
  assert.equal(unknown.status, 2);
  assert.equal(removed.status, unknown.status);
  assert.equal(removed.stderr, unknown.stderr);
});
