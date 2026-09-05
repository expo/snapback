import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { lowerProject } from "./project";
import { typecheckSource } from "./typecheck";
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
    for (const name of effectGlobals) assert(source.includes(`${name}:`), `missing runtime witness for ${name}`);
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
    await withProject({
      "snapback/schema.q": schema,
      "snapback/programs.q": 'query preview(body: text <=200):\n  return body.substring(0, 80)\n',
      "snapback/provider.ts": 'import { effect } from "snapback2"; export const notify = effect({ grants: ["https://example.com"], run: async (p: {body: string}) => p.body.substring(0, 80) });',
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.every((item) => item.site.startsWith("snapback/programs.q:")), JSON.stringify(result));
    });
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
}
