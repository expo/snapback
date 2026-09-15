import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  }
});
