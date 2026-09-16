import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.SNAPBACK4_BIN ?? resolve(root, "../../target/debug/snapback4");

test("Following recipe usage compiles against its generated API in fresh and Expo projects", (t) => {
  for (const expo of [false, true]) for (const prefix of ["", "feed", "social_2"]) {
    const dir = mkdtempSync(join(root, ".init-recipe-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = (args) => {
      const result = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    let starterNotes = [];
    if (expo) {
      run(["init", "--expo"]);
      starterNotes = JSON.parse(run(["check", "--json"])).notes;
    }
    run(["init", "--recipe", "feeds", ...(prefix ? ["--prefix", prefix] : [])]);
    const checked = JSON.parse(run(["check", "--json"]));
    assert.deepEqual(checked.notes, starterNotes, "the recipe adds no notes");
    const options = {
      noEmit: true, strict: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      baseUrl: root, paths: { "snapback4/*": ["src/*"] },
    };
    const program = ts.createProgram([join(dir, "src/following.ts")], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => dir, getCanonicalFileName: (file) => file, getNewLine: () => "\n",
    }));
    const api = program.getSourceFile(join(dir, "snapback/generated/api.ts"));
    assert.ok(api?.text.includes(`feed.${prefix ? `${prefix}Following` : "following"}`), "usage must import the real generated API");
    if (prefix) {
      assert.ok(!readFileSync(join(dir, "src/following.ts"), "utf8").includes("client.mutate("));
      for (const name of ["Register", "Follow", "Unfollow", "CreatePost", "Repost", "DeletePost", "Unrepost"]) {
        assert.ok(!api.text.includes(`"feed.${prefix}${name}"`), `${name} must be a helper, not a client operation`);
      }
    }
  }
});

test("Search recipe helper compiles and walks two cursors without advancing a cut", async (t) => {
  for (const prefix of ["", "history"]) {
    const dir = mkdtempSync(join(root, ".init-recipe-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const args of [["init", "--recipe", "search", ...(prefix ? ["--prefix", prefix] : [])], ["check"]]) {
      const result = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    }
    const program = ts.createProgram([join(dir, "src/search.ts")], {
      noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      baseUrl: root, paths: { "snapback4/*": ["src/*"] },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => dir, getCanonicalFileName: file => file, getNewLine: () => "\n",
    }));
    // Run the installed helper itself; supply only its generated operation descriptors.
    const source = readFileSync(join(dir, "src/search.ts"), "utf8").replace('import { api } from "../snapback/generated/api";',
      `const api = { search: { ${prefix ? `${prefix}SearchChats` : "searchChats"}: "chats", ${prefix ? `${prefix}SearchChatBatch` : "searchChatBatch"}: "batch" } };`);
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const { searchServer } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const page = (data, next = null, extra = {}) => ({ data, next, complete: true, fresh: true, cut: null, ...extra });
    const run = async (replies) => {
      const calls = [], events = [];
      const client = { query: async (op, args) => { calls.push([op, args]); assert.ok(replies.length, "unexpected continuation"); return replies.shift(); } };
      for await (const event of searchServer(client, "cof")) events.push(event);
      assert.equal(replies.length, 0);
      return { calls, events };
    };
    const walked = await run([page([1], "members-2"), page([]), page([2]), page(["hit"], "results-2"), page(["last"])]);
    assert.deepEqual(walked.calls, [
      ["chats", { c: null }], ["batch", { q: "cof", batch: null, c: null }],
      ["chats", { c: "members-2" }], ["batch", { q: "cof", batch: "members-2", c: null }],
      ["batch", { q: "cof", batch: "members-2", c: "results-2" }],
    ]);
    assert.equal(walked.events.at(-1).finished, true);
    assert.ok(walked.events.slice(0, -1).every(event => !event.finished));
    for (const cut of ["meter", "words", null]) {
      const stopped = await run([page([1], "must-not-advance"), page(["partial"], "unsafe", { complete: false, cut })]);
      assert.equal(stopped.calls.length, 2);
      assert.equal(stopped.events.at(-1).read.cut, cut);
      assert.equal(stopped.events.at(-1).finished, false);
      assert.equal(stopped.events.at(-1).batch, null);
    }
    for (const read of [{ loading: true }, { denied: { code: "E_OFFLINE" } }, page([], null, { complete: false, cut: "meter" }), page([], null, { fresh: false })]) {
      const stopped = await run([read]);
      assert.equal(stopped.calls.length, 1);
      assert.equal(stopped.events[0].finished, false);
      assert.equal(stopped.events[0].phase, "memberships");
    }
  }
});
