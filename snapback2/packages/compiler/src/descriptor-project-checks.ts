import assert from "node:assert/strict";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { createProjectProgram } from "./project-program";
import { createSourceProgram } from "./typecheck";
import { resolve } from "node:path";
import { descriptorFiles, descriptorSource, legacyDescriptorDeclarations } from "./argument-descriptor-checks";
import { apiConsumerDiagnostics, withProject, type Test } from "./quarry-check-helpers";
import { registerSourceCustodyChecks } from "./source-custody-checks";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — checked project origin owns both admission and generated signatures, including migration guidance.
const text = 't.text(31,{min:8,format:"url"})';
const refined = { Text: { max: 31, min: 8, format: "url" } };
const saved = "const originalText=t.text;";
const replacement = "(max:number)=>originalText(31)";
const other = 'import {query} from "snapback2";export const other=query({},()=>true);';

export const ownerFlowCases: ReadonlyArray<readonly [string, string]> = [
  ["let alias", `let owner=t;owner.text=${replacement};`],
  ["array member", `const owners=[t];owners[0].text=${replacement};`],
  ["array destructuring", `const [owner]=[t];owner.text=${replacement};`],
  ["array rest", `const [...owners]=[t];owners[0].text=${replacement};`],
  ["nested destructuring", `const {owners:[owner]}={owners:[t]};owner.text=${replacement};`],
  ["mutable container", `let holder={types:t};holder.types.text=${replacement};`],
  ["getter container", `const holder={get types(){return t;}};holder.types.text=${replacement};`],
  ["nested array object", `const holders=[{types:t}];holders[0].types.text=${replacement};`],
  ["mutable selection key", `let key:"types"="types";const holder={types:t};holder[key].text=${replacement};`],
  ["unknown selection key", `declare const key:string;const holder:{[key:string]:typeof t}={types:t};holder[key].text=${replacement};`],
  ["for of binding", `for(const owner of [t]){owner.text=${replacement};}`],
  ["for of destructuring", `for(const {types:owner} of [{types:t}]){owner.text=${replacement};}`],
  ["assignment escape", "declare const target:{types:typeof t};target.types=t;"],
  ["destructuring assignment escape", "let target:typeof t;[target]=[t];"],
  ["array escape", "declare function consume(x:(typeof t)[]):void;consume([t]);"],
  ["spread escape", "declare function consume(...x:(typeof t)[]):void;consume(...[t]);"],
  ["getter escape", "declare function consume(x:{types:typeof t}):void;consume({get types(){return t;}});"],
  ["mutable accessor escape", "let get=()=>t;declare function consume(x:()=>typeof t):void;consume(get);"],
  ["nontransparent accessor write", `function get(){const owner=t;return owner;}get().text=${replacement};`],
  ["default accessor write", `function get(owner=t){return owner;}get().text=${replacement};`],
  ["class storage escape", "class Holder{types=t;}"],
  ["method receiver escape", `const owners=[t];owners.map(owner=>{owner.text=${replacement};return owner;});`],
  ["tagged call escape", 'declare function consume(parts:readonly string[],owner:typeof t):void;consume`owner${t}`;'],
  ["yield escape", "function* owners(){yield t;}"],
];

export function registerDescriptorProjectChecks(test: Test, lib: string): void {
  registerSourceCustodyChecks(test, lib);
  test("project descriptor library custody survives authored virtual-path collisions", () => {
    const schemaPath = resolve("schema.ts");
    const first = resolve("__snapback2_lib.d.ts"), second = resolve("___snapback2_lib.d.ts");
    const authored = "export declare const marker: 42;";
    const checked = createProjectProgram(schemaPath, "export {};", [[first, authored], [second, authored]], lib);
    assert.equal(checked.library.text, lib);
    assert.equal(checked.program.getSourceFile(first)!.text, authored);
    assert.equal(checked.program.getSourceFile(second)!.text, authored);
    assert.notEqual(checked.library, checked.program.getSourceFile(first));
    assert.notEqual(checked.library, checked.program.getSourceFile(second));
  });
  test("project descriptor standalone library custody keeps the authored source", () => {
    const authored = "export declare const marker: 42;";
    const checked = createSourceProgram(authored, "bounded-lib.d.ts", lib);
    assert.equal(checked.sourceFile.text, authored);
    assert.equal(checked.library.text, lib);
    assert.notEqual(checked.sourceFile, checked.library);
  });
  for (const kind of ["query", "mutation", "channel"]) {
    for (const [name, setup] of ownerFlowCases) test(`project descriptor ${kind} invalidates ${name}`, async () => {
      for (const wrap of [false, true]) {
        const value = wrap ? "t.optional(t.list(t.optional(t.text(90)),{max:2}))" : "t.text(90)";
        const source = descriptorSource(value, kind, saved + setup);
        const result = await withProject(descriptorFiles(source, kind), root => lowerProject(root, { authoring: "any" }));
        assert(!result.ok, JSON.stringify({ source, result }));
        const refusal = result.diagnostics.find(d => d.code === (kind === "channel" ? "E_SCHEMA_INVALID" : "E_ARGS_DESCRIPTOR"));
        assert(refusal?.site && refusal.guide && refusal.rewrite, JSON.stringify(result));
        assert(!("apiDts" in result));
      }
    });
    for (const [name, setup, imported] of [
      ["second module write", `t.text=${replacement};`, 'import "./change";'],
      ["second module alias write", `let owner=t;owner.text=${replacement};`, 'import "./change";'],
      ["second module escape", "declare function consume(x:(typeof t)[]):void;consume([t]);", 'import "./change";'],
      ["resolved outside module", `t.text=${replacement};`, 'import "../support/change";'],
    ]) test(`project descriptor ${kind} includes ${name}`, async () => {
      const source = descriptorSource("t.optional(t.list(t.optional(t.text(90)),{max:2}))", kind, imported);
      const path = name === "resolved outside module" ? "support/change.ts" : "snapback/change.ts";
      const files = { ...descriptorFiles(source, kind), [path]: `import {t} from 'snapback2';${saved}${setup}${other}` };
      const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
      assert(!result.ok, JSON.stringify(result));
      assert(result.diagnostics.some(d => d.code === (kind === "channel" ? "E_SCHEMA_INVALID" : "E_ARGS_DESCRIPTOR")), JSON.stringify(result));
    });
    test(`project descriptor ${kind} follows imported namespace carrier escapes`, async () => {
      const source = descriptorSource("t.text(90)", kind,
        'import * as owners from "../support/owners";declare function consume(x:typeof owners):void;consume(owners);');
      const files = { ...descriptorFiles(source, kind), "support/owners.ts": 'export {t as owner} from "snapback2";' };
      const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
      assert(!result.ok, JSON.stringify(result));
      assert(result.diagnostics.some(d => d.code === (kind === "channel" ? "E_SCHEMA_INVALID" : "E_ARGS_DESCRIPTOR")), JSON.stringify(result));
    });
  }

  for (const kind of ["query", "mutation"]) {
    test(`project descriptor ${kind} ambient shadows cannot hide global factory writes`, async () => {
      for (const written of [false, true]) for (const value of ["scalar()", "optional(list(scalar(),{max:2}))"]) {
        const source = descriptorSource(value, kind, `import "./legacy";${legacyDescriptorDeclarations}`);
        const files = { ...descriptorFiles(source, kind), "snapback/legacy.ts":
          `import {t} from "snapback2";declare global {function scalar():import("snapback2").Arg<unknown>;}
          ${written ? `globalThis.scalar=()=>${text};` : ""}${other}` };
        const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
        assert.equal(result.ok, !written, JSON.stringify(result));
        if (!result.ok) assert(result.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify(result));
        else assert.deepEqual(result.project.programs.find(p => p.name === "ops.probe")!.args.value,
          value === "scalar()" ? "Scalar" : { Optional: { List: { max: 2 } } });
      }
    });
    for (const [name, write] of [
      ["assigned global", `globalThis.scalar=()=>${text};`],
      ["global alias", `const globals=globalThis;globals.scalar=()=>${text};`],
      ["global unknown call", "declare function consume(x:typeof globalThis):void;consume(globalThis);"],
    ]) test(`project descriptor ${kind} refuses ${name} through legacy wrappers`, async () => {
      for (const value of ["scalar()", "optional(list(scalar(),{max:2}))"]) {
        const source = descriptorSource(value, kind, `import "./legacy";${legacyDescriptorDeclarations.replace(/declare function scalar[^;]+;/, "")}`);
        const files = { ...descriptorFiles(source, kind), "snapback/legacy.ts":
          `import {t} from "snapback2";declare global {function scalar():import("snapback2").Arg<string>;} ${write}${other}` };
        const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
        assert(!result.ok, JSON.stringify(result));
        assert(result.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify(result));
        assert(!("apiDts" in result));
      }
    });
    test(`project descriptor ${kind} preserves an actual ambient global with no writer`, async () => {
      const source = descriptorSource("scalar()", kind, 'import "../support/legacy";');
      const files = { ...descriptorFiles(source, kind), "support/legacy.d.ts":
        'export {};declare global {function scalar():import("snapback2").Arg<unknown>;}' };
      const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
      assert(result.ok, JSON.stringify(result));
      assert.equal(result.project.programs[0]!.args.value, "Scalar");
      assert.match(result.apiDts, /value: unknown/);
    });
    test(`project descriptor ${kind} preserves immutable imported owners and accessors`, async () => {
      for (const owner of ["owner", "get()", "holder.get()"]) {
        const source = descriptorSource(`t.optional(t.list(${owner}.text(31,{min:8,format:"url"}),{max:2}))`, kind,
          'import {owner,get} from "../support/owners";const holder={get};');
        const files = { ...descriptorFiles(source, kind), "support/owners.ts":
          'import {t} from "snapback2";export const owner=t;export function get(){return t;}' };
        const result = await withProject(files, root => lowerProject(root, { authoring: "any" }));
        assert(result.ok, JSON.stringify(result));
        assert.deepEqual(result.project.programs[0]!.args.value, { Optional: { List: { of: refined, max: 2 } } });
        assert.match(result.apiDts, /value\?: string\[\] \| null/);
      }
    });
  }
  test("project descriptor unbound scalar receives no invented ambient declaration", () => {
    const source = descriptorSource("scalar()");
    const result = lowerSource(source, "unbound.ts");
    assert(!result.ok && result.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify(result));
    const genuine = lowerSource(source, "ambient.ts", `${lib}\ndeclare function scalar():import('snapback2').Arg<unknown>;`);
    assert(genuine.ok, JSON.stringify(genuine));
    assert.equal(genuine.programs[0]!.args.value, "Scalar");
  });

  for (const imported of ['import type owner from "../support/types";', 'import {owner} from "../support/types";'])
    test(`project descriptor migration requires a value import: ${imported}`, async () => {
      const source = descriptorSource('owner.text(31,{min:8,format:"url"})', "query", imported);
      const files = { ...descriptorFiles(source, "query"), "support/types.ts":
        'import {t} from "snapback2";export default t;export type {t as owner} from "snapback2";' };
      const result = await withProject(files, root => lowerProject(root));
      assert(!result.ok);
      assert(result.diagnostics.some(d => d.rewrite.startsWith("argument value: descriptor origin")), JSON.stringify(result));
    });

  for (const namespace of [false, true]) for (const typeOnly of [false, true])
    test(`project descriptor migration follows ${typeOnly ? "type-only" : "value"} ${namespace ? "namespace" : "star"} exports`, async () => {
      const imported = namespace ? 'import {owner} from "../support/types";' : 'import {t as owner} from "../support/types";';
      const source = descriptorSource(`${namespace ? "owner.t" : "owner"}.text(31,{min:8,format:"url"})`, "query", imported);
      const files = { ...descriptorFiles(source, "query"), "support/types.ts":
        `export ${typeOnly ? "type " : ""}*${namespace ? " as owner" : ""} from "snapback2";` };
      const result = await withProject(files, root => lowerProject(root));
      assert(!result.ok);
      assert(result.diagnostics.some(d => typeOnly ? d.rewrite.startsWith("argument value: descriptor origin")
        : d.rewrite === "query probe(value: text 8..31 format url):"), JSON.stringify(result));
      const checked = await withProject(files, root => lowerProject(root, { authoring: "any" }));
      assert.equal(checked.ok, !typeOnly, JSON.stringify(checked));
      if (checked.ok) assert.deepEqual(checked.project.programs[0]!.args.value, refined);
    });

  test("project descriptor bounded carrier discovery refuses shared alias expansion", () => {
    const aliases = ["const a0=t;"];
    for (let i = 1; i <= 18; i++) aliases.push(`const a${i}={left:a${i - 1},right:a${i - 1}};`);
    const source = descriptorSource("t.text(90)", "query", `${aliases.join("")}declare function consume(x:unknown):void;consume(a18);`);
    const result = lowerSource(source, "shared.ts");
    assert(!result.ok && result.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify(result));
  });

  const invalidWrappers = [
    ['shorthand maximum', `const max=2;`, `t.list(${text},{max})`],
    ['unknown option', '', `t.list(${text},{max:2,unknown:1})`],
    ['duplicate maximum', '', `t.list(${text},{max:2,max:3})`],
    ['named maximum', `const max=2;`, `t.list(${text},{max:max})`],
    ['named options', 'const options={max:2};', `t.list(${text},options)`],
    ['wrapper arity', '', `t.optional(${text},0)`],
    ['missing bound', '', `t.list(${text},{})`],
    ['invalid nested list', '', `t.optional(t.list(t.list(${text},{max:0}),{max:2}))`],
  ];
  for (const kind of ["query", "mutation", "channel"]) for (const [name, prelude, value] of invalidWrappers)
    test(`project descriptor ${kind} migration refuses ${name}`, async () => {
      // Put channels in a TS operation module to exercise its migration diagnostic;
      // its private schema admission is independently covered above.
      const files = descriptorFiles(descriptorSource(value, kind === "channel" ? "query" : kind, prelude), "query");
      if (kind === "channel") files["snapback/ops.ts"] = descriptorSource(value, "channel", prelude);
      const result = await withProject(files, root => lowerProject(root));
      assert(!result.ok);
      const refusal = result.diagnostics.find(d => d.site.startsWith("snapback/ops.ts") && d.rewrite.startsWith("argument value:"));
      assert(refusal, JSON.stringify(result));
      assert(!result.diagnostics.some(d => new RegExp(`^${kind} probe\\(`).test(d.rewrite)), JSON.stringify(result));
    });

  for (const kind of ["query", "mutation", "channel"]) test(`project descriptor ${kind} migration compiles the actual lawful signature and API`, async () => {
    const value = `t.optional(t.list(${text},{max:2}))`;
    const files = { "snapback/schema.ts": "import {schema} from 'snapback2';export default schema({tables:{}});",
      "snapback/ops.ts": descriptorSource(value, kind) };
    const result = await withProject(files, root => lowerProject(root));
    assert(!result.ok);
    const header = result.diagnostics.find(d => d.rewrite.startsWith(`${kind} probe(`))?.rewrite;
    assert.equal(header, `${kind} probe(value: [text 8..31 format url] <=2 ?):`);
    const q = kind === "channel" ? { "snapback/schema.q": `table records:\n  body: text <=31\n  public\n${header}\n  publish <- allow\n  subscribe <- allow\n  ttl 5s\n`, "snapback/ops.q": "query read():\n  return true\n" }
      : { "snapback/schema.q": "table records:\n  body: text <=31\n  public\n", "snapback/ops.q": `${header}\n  return value\n` };
    const project = await withProject(q, root => lowerProject(root));
    assert(project.ok, JSON.stringify(project));
    if (kind !== "channel") assert.deepEqual(project.project.programs[0]!.args.value, { Optional: { List: { of: refined, max: 2 } } });
    const consumer = `import {api,type Op,type Channel} from 'snapback2/client';
      type Args<T>=T extends ${kind === "channel" ? "Channel" : "Op"}<infer A,unknown>?A:never;
      const args:Args<typeof api.${kind === "channel" ? "channels" : "ops"}.probe>={value:[VALUE]};`;
    assert.deepEqual(apiConsumerDiagnostics(project.apiDts, consumer.replace("VALUE", '"https://x"')), []);
    assert(apiConsumerDiagnostics(project.apiDts, consumer.replace("VALUE", "42")).some(d => d.includes("TS2322")));
  });
}
