import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { lowerProject } from "./project";
import { typecheckSource } from "./typecheck";
import { lowerSource } from "./compiler";
import { effectGlobals } from "./lower/effects";

type Test = (name: string, run: () => Promise<void>) => void;
type WithProject = (files: Record<string, string>, run: (root: string) => Promise<void>) => Promise<void>;
const schema = "table records:\n  body: text <=200\n  read <- public\n  insert <- allow\n";

export function registerEffectLanguageChecks(test: Test, withProject: WithProject, frontend: string, subset: string) {
  test("effect ES2020 witness compiles every admitted global and the full prelude response shape", async () => {
    const result = await lowerProject(`${frontend}fixtures/effect-es2020`);
    assert(result.ok, JSON.stringify(result));
    assert.equal(result.project.effects.length, 1);
    const source = result.project.effects[0]!.source;
    const file = ts.createSourceFile("witness.js", source, ts.ScriptTarget.ES2020, true);
    const keys = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
        for (const property of node.expression.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) keys.add(property.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    for (const name of effectGlobals) assert(keys.has(name), `missing runtime witness for ${name}`);
    const libs = await readFile(`${frontend}../snapback2/dist/effects-lib.d.ts`, "utf8");
    assert.equal(ts.preProcessFile(libs).libReferenceDirectives.length, 0, "packaged libs must not load TypeScript files at runtime");
    assert(!libs.includes("interface Document ") && !libs.includes("interface WorkerGlobalScope "));
  });

  test("effect refusals keep their family inside locals and reject non-runtime globals", async () => {
    for (const expression of ["document", "window", "require('x')", "import('x')", "eval('1')", "Function('return 1')",
      "crypto.randomUUID()", "Atomics", "SharedArrayBuffer", "globalThis", "new Response()", "setInterval(() => {}, 1)"]) {
      await withProject({
        "snapback/schema.q": schema,
        "snapback/programs.q": "query ping():\n  return null\n",
        "snapback/provider.ts": `import { effect } from 'snapback2';
          export const notify = effect({ grants: ['https://example.com'], run: async () => {
            const value = ${expression}; return value;
          } });`,
      }, async (root) => {
        const result = await lowerProject(root);
        assert(!result.ok, `${expression} unexpectedly compiled`);
        assert(result.diagnostics.every((item) => item.family === "effect"), JSON.stringify(result));
        const refusal = result.diagnostics.find((item) => item.code === "E_EFFECT_CLOSURE" || item.code === "E_EFFECT_IMPORT");
        assert(refusal, JSON.stringify(result));
        if (refusal.code === "E_EFFECT_CLOSURE") {
          for (const name of effectGlobals) assert(refusal.rewrite.includes(name), refusal.rewrite);
        }
      });
    }
  });

  test("effects use ES2020 types while Quarry and its generated checker retain the subset", async () => {
    const messages = typecheckSource('const s = "hello"; s.substring(0, 80); s.charAt(0); s[0];', "quarry.ts", subset)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.equal(messages.length, 3, messages.join("\n"));
    assert(messages[0]!.includes("substring") && messages[1]!.includes("charAt"));
    assert.match(messages[2]!, /can't be used to index type 'String'/);
    // Quarry refuses JS method/constructor syntax before it can reach the TS checker.
    for (const expression of ["body.substring(0, 80)", "body.charAt(0)", "body[0]", "new Map()", "new Headers()"]) {
      await withProject({
        "snapback/schema.q": schema,
        "snapback/programs.q": `query preview(body: text <=200):\n  return ${expression}\n`,
      }, async (root) => {
        const result = await lowerProject(root);
        assert(!result.ok, `${expression} escaped Quarry`);
        assert(result.diagnostics.every((item) => item.family === "quarry" && item.site.startsWith("snapback/programs.q:")), JSON.stringify(result));
        assert(result.diagnostics.some((item) => expression === "body[0]"
          ? item.code === "E_QUARRY_UNKNOWN" && item.message === "unknown table body"
          : item.code === "E_QUARRY_SYNTAX" && item.message === 'expected newline, got "("'), JSON.stringify(result));
      });
    }
    // Pin the downstream subset refusal too, where family opaque actually applies.
    for (const [expression, message] of [
      ["args.body.substring(0, 80)", /substring/], ["args.body.charAt(0)", /charAt/],
      ["args.body[0]", /index type 'String'/],
    ] as const) {
      const result = lowerSource(`import { query, t } from "snapback2";
        export const preview = query({body: t.text(200)}, ({args}) => ${expression});`, "programs.ts", subset);
      assert(!result.ok, `${expression} escaped the subset`);
      assert(result.diagnostics.some((item) => item.family === "opaque" && message.test(item.message)), JSON.stringify(result));
    }
    await withProject({
      "snapback/schema.q": schema,
      "snapback/programs.q": "query ping():\n  return null\n",
      "snapback/provider.ts": `import { effect } from 'snapback2';
        export const notify = effect({ grants: ['https://example.com'], run: async (p: {body: string}) => {
          const bad: number = p.body.substring(0, 80); return bad;
        } });`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_EFFECT_TYPE" && item.message.includes("not assignable")), JSON.stringify(result));
    });
  });

  test("effect public globals agree with Hermes and the guide/spec in exact order", async () => {
    const rust = await readFile(`${frontend}../../crates/snapback2-effects/src/ibex.rs`, "utf8");
    const list = rust.match(/const EFFECT_GLOBALS:.*?= &\[([\s\S]*?)\];/);
    assert(list);
    const internal = new Set(["$SHBuiltin", "DebuggerInternal", "HermesInternal", "__ibex2_fire_timer", "globalThis"]);
    const names = [...list[1]!.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]!).filter((name) => !internal.has(name));
    assert.deepEqual(names, effectGlobals);
    for (const path of [`${frontend}../snapback2/guide/effects.md`, `${frontend}../../../llp/1003-effects-on-ibex2.spec.md`]) {
      const doc = await readFile(path, "utf8");
      const list = doc.match(/exactly `(Array, [^`]+)`/);
      assert(list, path);
      assert.deepEqual(list[1]!.split(", "), effectGlobals, path);
    }
  });

  test("one effect signature supplies all three metadata fields", async () => {
    const declarations = await readFile(`${frontend}lib.d.ts`, "utf8");
    const globals = await readFile(`${frontend}../snapback2/dist/effects-lib.d.ts`, "utf8");
    const file = ts.createSourceFile("lib.d.ts", declarations + globals, ts.ScriptTarget.ES2020, true);
    const signatures: ts.FunctionDeclaration[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "effect") signatures.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(signatures.length, 1);
    const diagnostics = typecheckSource(`import { effect } from "snapback2";
      effect({grants: ["https://example.com"], run: async (_p: null, {meta}) => {
        const id: string = meta.id; const name: string = meta.effect; const attempt: number = meta.attempt;
        return {id, name, attempt};
      }});`, "provider.ts", declarations + globals);
    assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  });

  test("authored helper modules get ES2020 with or without an effect export", async () => {
    const files = {
      "snapback/schema.q": schema,
      "snapback/programs.q": "query ping():\n  return null\n",
      "snapback/util.ts": 'export function clip(s: string) { return s.substring(0, 80); }',
    };
    await withProject(files, async (root) => { const result = await lowerProject(root); assert(result.ok, JSON.stringify(result)); });
    await withProject({ "snapback/schema.q": schema, "snapback/util.ts": files["snapback/util.ts"] }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_OP_NONE"), JSON.stringify(result));
    });
    await withProject({
      ...files,
      "snapback/provider.ts": `import { effect } from "snapback2";
        import { clip } from "./util";
        type Payload = {body: ReturnType<typeof clip>};
        export const notify = effect({ grants: ["https://example.com"], run: async (p: Payload) => p.body.substring(0, 80) });`,
    }, async (root) => { const result = await lowerProject(root); assert(result.ok, JSON.stringify(result)); });
    await withProject({
      ...files,
      "snapback/provider.ts": `import { effect } from "snapback2"; import { clip } from "./util";
        export const notify = effect({ grants: ["https://example.com"], run: async (p: {body: string}) => clip(p.body) });`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.length === 1, JSON.stringify(result));
      assert.equal(result.diagnostics[0]!.code, "E_EFFECT_CLOSURE", JSON.stringify(result));
      assert.match(result.diagnostics[0]!.message, /non-JSON value clip/);
    });
    await withProject({ ...files, "snapback/util.ts": 'export function clip(s: string) { const bad: number = s.substring(0, 80); return bad; }' }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.length === 1, JSON.stringify(result));
      assert.equal(result.diagnostics[0]!.code, "E_EFFECT_TYPE");
      assert.match(result.diagnostics[0]!.site, /^snapback\/util.ts:/);
      assert.match(result.diagnostics[0]!.message, /not assignable to type 'number'/);
    });
  });

  test("static imports inside run refuse E_EFFECT_IMPORT", async () => {
    for (const statement of ['import "snapback2";', 'import { effect } from "snapback2";', 'import helper = require("snapback2");']) {
      await withProject({
        "snapback/schema.q": schema,
        "snapback/programs.q": "query ping():\n  return null\n",
        "snapback/provider.ts": `import { effect } from "snapback2";
          export const notify = effect({ grants: ["https://example.com"], run: async () => { ${statement} return null; } });`,
      }, async (root) => {
        const result = await lowerProject(root);
        assert(!result.ok, statement);
        assert(result.diagnostics.every((item) => item.family === "effect" && item.site.startsWith("snapback/provider.ts:")), JSON.stringify(result));
        assert(result.diagnostics.some((item) => item.code === "E_EFFECT_IMPORT"), JSON.stringify(result));
      });
    }
  });

  test("Quarry and effect diagnostics are each reported once by their own checker", async () => {
    await withProject({
      "snapback/schema.q": schema,
      "snapback/programs.q": "query preview(body: text <=200):\n  return body - 1\n",
      "snapback/provider.ts": `import { effect } from "snapback2";
        export const notify = effect({ grants: ["https://example.com"], run: async (p: {body: string}) => {
          const bad: number = p.body.substring(0, 80); return bad;
        } });`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.length === 2, JSON.stringify(result));
      assert.deepEqual(result.diagnostics.map((item) => [item.family, item.site.split(":")[0]]).sort(),
        [["effect", "snapback/provider.ts"], ["opaque", "snapback/programs.q"]]);
    });
  });

  test("the benchmark notification payload can project body.substring inside run", async () => {
    await withProject({
      "snapback/schema.q": schema,
      "snapback/programs.q": "query ping():\n  return null\n",
      "snapback/provider.ts": `import { effect } from "snapback2";
        export const notify = effect({ grants: ["https://example.com"],
          run: async (payload: {messageId: string; targetUserId: string; chatId: string; senderDisplayName: string; body: string; media: string}, {fetch, meta}) => {
            const data = {messageId: payload.messageId, targetUserId: payload.targetUserId, chatId: payload.chatId,
              senderDisplayName: payload.senderDisplayName, body: payload.body.substring(0, 80), media: payload.media};
            const response = await fetch("https://example.com/push", {method: "POST",
              headers: {"content-type": "application/json", "idempotency-key": meta.id}, body: JSON.stringify(data)});
            if (!response.ok) throw new Error("Push seam " + response.status);
            return {ok: true};
          }
        });`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, JSON.stringify(result));
      assert.match(result.project.effects[0]!.source, /body: payload.body.substring\(0, 80\)/);
    });
  });

  test("TextDecoder exposes no unwitnessed constructor or streaming options", async () => {
    await withProject({
      "snapback/schema.q": schema,
      "snapback/programs.q": "query ping():\n  return null\n",
      "snapback/provider.ts": `import { effect } from "snapback2";
        export const notify = effect({ grants: ["https://example.com"], run: async () =>
          new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(), {stream: true}) });`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.length === 2, JSON.stringify(result));
      assert(result.diagnostics.every((item) => item.code === "E_EFFECT_TYPE" && /Expected 0(?:-1)? arguments, but got 2/.test(item.message)), JSON.stringify(result));
    });
  });
}
