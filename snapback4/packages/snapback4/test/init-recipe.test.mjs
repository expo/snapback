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
    events posts by authorId, at removed by removed
    reposts reposts by actorId, postId, at
    edges follows by followerId, followedId
  use a fresh feed name; dev adopts retained sources and deploy requires --allow-feed-adoption; see snapback4 guide feeds
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

// Exercise the exact modules emitted by init. They own UI references only:
// reopening enumerates IDs and never invokes a mutation.
for (const starter of ["expo", "web"]) test(`CCP ${starter} generated intent transitions`, async t => {
  const { tmpdir } = await import("node:os");
  const ts = (await import("typescript")).default;
  const dir = mkdtempSync(join(tmpdir(), `ccp-${starter}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(binary, ["init", `--${starter}`], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const source = readFileSync(join(dir, "src/intents.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const values = new Map(); let fails = false, viewer = "alice", dispatches = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (fails) throw Error("disk full"); values.set(key, value); }, removeItem: key => values.delete(key) };
  if (starter === "web") {
    const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    t.after(() => { if (old) Object.defineProperty(globalThis, "localStorage", old); else delete globalThis.localStorage; });
  }
  const client = { viewer: () => viewer, link: () => "online" };
  const open = (url = "https://one.invalid", account = "alice") => starter === "web" ? new mod.ViewState(client, url, account)
    : new mod.IntentJournal(storage, url, account, () => viewer === account);
  const entries = journal => { const saved = journal.read(); return Array.isArray(saved) ? saved : saved.intents; };
  const intent = n => starter === "web" ? { id: `id-${n}`, room: "room", operation: "send", body: `text ${n}` }
    : { id: `id-${n}`, room: "room", op: "send", body: `text ${n}` };
  const journal = open(); let draft = "kept draft";
  fails = true;
  assert.throws(() => { journal.remember(intent(0)); dispatches++; draft = ""; }, /disk full/);
  assert.equal(dispatches, 0); assert.equal(draft, "kept draft"); assert.equal(values.size, 0);
  fails = false;
  for (let n = 1; n <= 3; n++) { journal.remember(intent(n)); dispatches++; }
  const reopened = open();
  assert.deepEqual(entries(reopened).map(i => i.id), ["id-1", "id-2", "id-3"]);
  assert.equal(dispatches, 3, "opening never resubmits");
  assert.deepEqual(entries(reopened).map(i => i.body), ["text 1", "text 2", "text 3"]);
  assert.deepEqual(entries(open("https://other.invalid")), []);
  viewer = "bob"; assert.deepEqual(entries(open("https://one.invalid", "bob")), []);
  assert.throws(() => journal.remember(intent(4)), /no longer active/);
  if (starter === "expo") {
    const old = new Map([["sdk.writes", "legacy intent"]]);
    const credentials = { get: async key => old.get(key) ?? null, set: async (key, value) => { old.set(key, value); }, delete: async key => { old.delete(key); } };
    const custody = mod.withIntentStorage(credentials, storage);
    fails = true; await assert.rejects(custody.get("sdk.writes"), /disk full/);
    assert.equal(old.get("sdk.writes"), "legacy intent", "failed migration retains old custody");
    fails = false; assert.equal(await custody.get("sdk.writes"), "legacy intent");
    assert.equal(old.has("sdk.writes"), false); assert.equal(values.get("sdk.writes"), "legacy intent");
    await custody.set("sdk.writes.damaged.abc", "preserved intent");
    assert.equal(old.has("sdk.writes.damaged.abc"), false);
    assert.equal(values.get("sdk.writes.damaged.abc"), "preserved intent");
    await custody.set("sdk.session", "token"); assert.equal(old.get("sdk.session"), "token");
    assert.equal(values.has("sdk.session"), false, "credentials stay in their store");
    assert.match(mod.intentOutcome(undefined), /^Outcome unknown/);
    const failed = { state: "failed", id: "id-1", why: { message: "A refused after B" } };
    assert.equal(mod.intentOutcome(failed), "A refused after B");
    viewer = "alice"; assert.equal(entries(reopened)[0].body, "text 1");
    assert.match(mod.intentOutcome({ state: "pending", id: "id-2", reason: "no predicted row" }), /Queued on this device: no predicted row/);
  }
});
