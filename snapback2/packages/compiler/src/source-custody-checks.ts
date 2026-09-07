import assert from "node:assert/strict";
import { resolve } from "node:path";
import ts from "typescript";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { createProjectProgram, projectTypeDiagnostics } from "./project-program";
import { createSourceProgram, typecheckSource } from "./typecheck";
import { apiConsumerDiagnostics, withProject, type Test } from "./quarry-check-helpers";

const missing = "export declare const marker: MissingType;";
const marker = "export declare const marker: 42;";
const query = "import {query,t} from 'snapback2';export const probe=query({value:t.text(31,{min:8,format:'url'})},({args})=>args.value);";
const companion = query.replace("export const", "const bad:number='wrong';export const");
const spellings = ["", "./", "child/../", "child/.././", ".\\", "child\\..\\"];

export function registerSourceCustodyChecks(test: Test, lib: string): void {
  for (const name of [...spellings.map(prefix => `${prefix}bounded-lib.d.ts`),
    "ordinary.d.ts", "nested/bounded-lib.d.ts", "../bounded-lib.d.ts", "probe.ts", "./probe.ts", "child/../probe.ts"])
    test(`source custody standalone ${name}`, () => {
      const checked = createSourceProgram(missing, name, lib);
      assert.equal(checked.sourceFile.text, missing);
      assert.equal(checked.library.text, lib);
      assert.notEqual(checked.sourceFile, checked.library);
      const diagnostics = typecheckSource(missing, name, lib);
      assert(diagnostics.some(d => d.code === 2304 && d.file?.text === missing));
      assert(!diagnostics.some(d => d.code === 6053));
      const bad = lowerSource(companion, name, lib);
      assert(!bad.ok && bad.diagnostics.some(d => d.message.includes("not assignable")), JSON.stringify(bad));
      assert(!bad.ok && !bad.diagnostics.some(d => d.code === "E_OP_NONE"), JSON.stringify(bad));
      if (!name.endsWith(".d.ts")) {
        const good = lowerSource(query, name, lib);
        assert(good.ok, JSON.stringify(good));
        assert.deepEqual(good.programs[0]!.args.value, { Text: { max: 31, min: 8, format: "url" } });
      }
    });

  for (const prefix of spellings) for (const count of [1, 2, 5])
    test(`source custody project ${count} collisions ${prefix}`, () => {
      const root = resolve("__custody_virtual_project"), schema = `${root}/schema.ts`;
      const entries = Array.from({ length: count }, (_, n) =>
        [`${root}/${prefix}${"_".repeat(n + 2)}snapback2_lib.d.ts`, `export declare const marker${n}: ${n};`] as const);
      const checked = createProjectProgram(schema, "export {};", entries, lib);
      assert.equal(checked.library.text, lib);
      for (const [name, text] of entries) {
        const file = checked.program.getSourceFile(name)!;
        assert.equal(file.text, text);
        assert.notEqual(file, checked.library);
      }
      assert.equal(checked.program.getSourceFiles().length, count + 2);
    });

  for (const prefix of spellings) test(`source custody authored diagnostic ${prefix}`, () => {
    const root = resolve("__custody_virtual_project"), path = `${root}/${prefix}__snapback2_lib.d.ts`;
    const source = "export declare const marker: ;";
    const checked = createProjectProgram(`${root}/schema.ts`, "export {};", [[path, source]], `${lib}\ndeclare const brokenLibrary: ;`);
    const all = projectTypeDiagnostics(checked.program, root);
    const selected = projectTypeDiagnostics(checked.program, root, () => true, new Set([path]));
    assert.equal(all.length, 1, JSON.stringify(all));
    assert.deepEqual(selected, all);
    assert.equal(all[0]!.site, "__snapback2_lib.d.ts:1:30");
    assert(all[0]!.rewrite.includes(source));
    // The real library's syntax error must not be confused with this authored
    // declaration after its virtual path moves to the next collision slot.
    assert(!all[0]!.rewrite.includes("brokenLibrary"));
  });

  test("source custody diagnostic filtering uses library identity across programs", () => {
    const root = resolve("__custody_virtual_project"), source = "export declare const marker: ;";
    const a = createProjectProgram(`${root}/schema.ts`, "export {};", [[`${root}/user__snapback2_lib.d.ts`, source]], lib);
    const b = createProjectProgram(`${root}/schema.ts`, "export {};", [[`${root}/__snapback2_lib.d.ts`, source]], lib);
    assert.equal(projectTypeDiagnostics(a.program, root).length, 1);
    assert.equal(projectTypeDiagnostics(b.program, root).length, 1);
  });

  test("source custody normalized imports resolve virtual modules without disk substitutes", () => {
    const root = resolve("__custody_virtual_project");
    const imports = "import {marker} from './child/../owners'; export const checked:42=marker;";
    const checked = createProjectProgram(`${root}/schema.ts`, "export {};", [
      [`${root}/./ops.ts`, imports], [`${root}/child/../owners.d.ts`, marker],
    ], lib);
    assert.equal(checked.program.getSourceFile(`${root}/owners.d.ts`)!.text, marker);
    assert.deepEqual(projectTypeDiagnostics(checked.program, root), []);
    const file = checked.program.getSourceFile(`${root}/ops.ts`)!;
    const statement = file.statements.find(ts.isVariableStatement)!;
    assert.equal(checked.checker.typeToString(checked.checker.getTypeAtLocation(statement.declarationList.declarations[0]!.name)), "42");
  });

  for (const same of [true, false]) test(`source custody duplicate equivalent paths ${same}`, () => {
    const root = resolve("__custody_virtual_project");
    const build = () => createProjectProgram(`${root}/schema.ts`, "export {};", [
      [`${root}/owners.d.ts`, marker], [`${root}/child/../owners.d.ts`, same ? marker : missing],
    ], lib);
    if (!same) assert.throws(build, /conflicting authored sources resolve to/);
    else assert.equal(build().program.getSourceFiles().filter(f => f.text === marker).length, 1);
  });

  for (const broken of [false, true]) test(`source custody public helper declaration ${broken}`, async () => {
    const files = {
      "snapback/schema.q": "table records:\n  value: int\n  public\n",
      "snapback/ops.q": "query probe(value: int):\n  return value\n",
      "snapback/delivery.ts": "import type {Marker} from '../support/__snapback2_lib'; import {effect} from 'snapback2'; export const deliver=effect({grants:['https://example.test'],run:async()=>42});",
      "support/__snapback2_lib.d.ts": broken ? "export type Marker = ;" : "export type Marker = 42;",
    };
    const full = await withProject(files, root => lowerProject(root));
    assert.equal(full.ok, !broken, JSON.stringify(full));
    if (!full.ok) {
      assert(full.diagnostics.some(d => d.site.startsWith("support/__snapback2_lib.d.ts:") && d.message === "Type expected."));
      assert(!("apiDts" in full));
    } else {
      assert.deepEqual(full.project.programs[0]!.args, { value: "Int" });
      const consumer = "import {api,type Op} from 'snapback2/client';type Args<T>=T extends Op<infer A,unknown>?A:never;const args:Args<typeof api.ops.probe>={value:VALUE};";
      assert.deepEqual(apiConsumerDiagnostics(full.apiDts, consumer.replace("VALUE", "42")), []);
      assert(apiConsumerDiagnostics(full.apiDts, consumer.replace("VALUE", "'wrong'" )).some(d => d.includes("TS2322")));
    }
  });
}
