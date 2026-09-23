import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.SNAPBACK4_BIN ?? resolve(root, "../../target/debug/snapback4");
const retired = `E_RECIPE_RETIRED: the Following recipe installer is retired; no files written
  rewrite: maintain feed: timeline
    authors profiles by principal
    events posts by authorId, at removed by removed
    reposts reposts by actorId, postId, at
    edges follows by followerId, followedId
    size authors 1008, edges 5921
  declare before event and edge data exists; see snapback4 guide feeds
`;
const options = [
  ["--prefix", "feed"], ["--authors", "1008"], ["--edges", "5921"],
  ["--public-profiles", "profiles:principal"], ["--public-posts", "posts:authorId:at"],
  ["--public-follows", "follows:followerId:followedId"], ["--public-reposts", "reposts:actorId:postId:at"],
];
const snapshot = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).map(e => {
  const path = join(e.parentPath, e.name);
  return [path, e.isDirectory() ? "directory" : "file", e.isDirectory() ? null : readFileSync(path)];
}).sort(([a], [b]) => a.localeCompare(b));

test("Retired Following installer and orphan options preserve fresh and existing directory trees", (t) => {
  for (const expo of [false, true]) {
    const dir = mkdtempSync(join(root, ".init-recipe-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = (args) => spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    if (expo) {
      const starter = run(["init", "--expo"]);
      assert.equal(starter.status, 0, starter.stderr);
    }
    const before = snapshot(dir);
    const variants = [[], ...options, options.flat(), ["--prefix", "social_2"], ["--authors", "0"]];
    for (const mode of [[], ["--expo"], ["--online"], ["--expo", "--online"]]) {
      for (const extra of variants) {
        const args = ["init", ...mode, "--recipe", "feeds", ...extra];
        const refused = run(args);
        assert.equal(refused.status, 2, JSON.stringify(args));
        assert.equal(refused.stderr, retired);
        assert.equal(refused.stdout, "");
        assert.deepEqual(snapshot(dir), before, JSON.stringify(args));
      }
    }
    for (const orphan of options) {
      const refused = run(["init", ...orphan]);
      assert.equal(refused.status, 2);
      assert.equal(refused.stderr, retired);
      assert.equal(refused.stdout, "");
      assert.deepEqual(snapshot(dir), before);
    }
    if (expo) assert.equal(run(["check"]).status, 0);
  }
});

test("Removed search recipe gets the ordinary unknown-recipe refusal", (t) => {
  const dir = mkdtempSync(join(root, ".init-recipe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (recipe) => spawnSync(binary, ["init", "--recipe", recipe], { cwd: dir, encoding: "utf8" });
  const before = snapshot(dir);
  const unknown = run("unknown"), removed = run("search");
  assert.equal(unknown.status, 2);
  assert.equal(removed.status, unknown.status);
  assert.equal(removed.stderr, unknown.stderr);
  assert.equal(removed.stderr, "usage: snapback4 init [dir] [--online|--expo|--web]\n");
  assert.deepEqual(snapshot(dir), before);
});
