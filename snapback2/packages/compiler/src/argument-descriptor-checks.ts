import assert from "node:assert/strict";
import ts from "typescript";
import { lowerSource, typecheckSource } from "./compiler";
import { lowerArgDescriptor, lowerLegacyArgDescriptor, lowerSchema } from "./lower/schema";
import { lowerProject } from "./project";
import { apiConsumerDiagnostics, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — descriptor failure cannot erase authored bounds at argument admission.
export type DescriptorCase = { name: string; value: string; prelude?: string; expected?: unknown };
export const legacyDescriptorDeclarations = `declare const records: unknown;
declare function scalar(): import('snapback2').Arg<unknown>;
declare function id(table: unknown): import('snapback2').Arg<string>;
declare function text(options?: {max?: number}): import('snapback2').Arg<string>;
declare function optional<T>(value: import('snapback2').Arg<T>): import('snapback2').Arg<T, true>;
declare function list<T>(value: import('snapback2').Arg<T>, options: {max:number}): import('snapback2').Arg<T[]>;`;
const refined = { Text: { max: 31, min: 8, format: "url" } };
export const descriptorCases: DescriptorCase[] = [
  { name: "literal-computed-review", value: 't["text"](31, { format: "url" })' },
  { name: "parenthesized-callee-review", value: '(t.text)(31, { min: 8, format: "url" })' },
  { name: "parenthesized-owner-undefined-review", value: '(t).text(31, { format: undefined })' },
  ...["t", "(t)", "a", "ns.t", "(ns.t)", "alias", "holder.types"].map(owner => ({
    name: `supported-owner-${owner}`, value: `${owner}.text(31, { min: 8, format: "url" })`,
    prelude: "const alias=t; const holder={types:t};", expected: refined,
  })),
  ...["t", "(t)", "a", "ns.t", "(ns.t)", "alias", "holder.types"].map(owner => ({
    name: `invalid-owner-${owner}`, value: `${owner}.text(31, { min: 8, format: undefined })`,
    prelude: "const alias=t; const holder={types:t};",
  })),
  { name: "cast-result", value: '(t.text(31, { min: 8, format: "url" }) as import("snapback2").Arg<string>)', expected: refined },
  { name: "parenthesized-result", value: '(t.text(31, { min: 8, format: "url" }))', expected: refined },
  { name: "literal-template-callee", value: 't[`text`](31, { format: "url" })' },
  { name: "computed-name", prelude: 'const key="text";', value: 't[key](31, { format: "url" })' },
  { name: "computed-expression", value: 't["te"+"xt"](31, { format: "url" })' },
  { name: "computed-owner", value: 'ns["t"].text(31, { min: 8, format: "url" })', expected: refined },
  { name: "constructor-alias", prelude: "const make=t.text;", value: 'make(31, { format: "url" })' },
  { name: "destructured-alias", prelude: "const {text:make}=t;", value: 'make(31, { format: "url" })' },
  { name: "descriptor-alias", prelude: 'const descriptor=t.text(31, { format: "url" });', value: "descriptor" },
  { name: "descriptor-property", prelude: 'const holder={value:t.text(31, { format: "url" })};', value: "holder.value" },
  { name: "factory", prelude: 'function make(){return t.text(31, { format: "url" });}', value: "make()" },
  { name: "scalar-named-factory", prelude: 'function scalar(){return t.text(31, { format: "url" });}', value: "scalar()" },
  { name: "scalar-named-alias", prelude: "const scalar=t.text;", value: 'scalar(31, { format: "url" })' },
  { name: "nonliteral-options", prelude: 'const options={format:"url" as const};', value: "t.text(31, options)" },
  { name: "nonliteral-maximum", prelude: "const bound=31;", value: 't.text(bound, { format: "url" })' },
  { name: "nonliteral-format", prelude: 'const format="url";', value: "t.text(31, { format })" },
  { name: "explicit-null", value: '(t).text(31, { format: null })' },
  { name: "bad-minimum", value: '(t).text(31, { min: 32, format: "url" })' },
  { name: "unknown-factory", prelude: "declare function make(): import('snapback2').Arg<string>;", value: "make()" },
  { name: "computed-optional", value: 't["optional"](t.text(31, { format: "url" }))' },
  { name: "parenthesized-list", value: '(t.list)(t.text(31, { format: "url" }), { max: 2 })' },
  { name: "unknown-wrapper", prelude: "function wrap(x:import('snapback2').Arg<string>){return x;}", value: 'wrap(t.text(31, { format: "url" }))' },
  { name: "malformed-wrapper", value: '(t).optional(t.text(31, { format: "url" }), 0)' },
  { name: "malformed-list", value: '(t).list(t.text(31, { format: "url" }), { max: 0 })' },
  { name: "bare-invalid-wrapper", prelude: "declare function optional(x:import('snapback2').Arg<string>):import('snapback2').Arg<string>;", value: 'optional((t).text(31, { format: undefined }))' },
  { name: "unknown-prototype-method", value: "t.toString()" },
];

export function descriptorSource(value: string, kind = "query", prelude = ""): string {
  const imports = "import {query,mutation,channel,schema,rule,t,t as a} from 'snapback2'; import * as ns from 'snapback2';";
  return kind === "channel" ? `${imports}\n${prelude}\nexport const probe=channel({args:{value:${value}},publish:rule.allow(),subscribe:rule.allow(),ttlMs:5000});\nexport default schema({tables:{},channels:{probe}});`
    : `${imports}\n${prelude}\nexport const probe=${kind}({value:${value}},({args})=>args.value);`;
}

export function descriptorFiles(source: string, kind: string): Record<string, string> {
  return kind === "channel" ? { "snapback/schema.ts": source, "snapback/ops.ts": "import {query} from 'snapback2'; export const read=query({},()=>true);" }
    : { "snapback/schema.ts": "import {schema} from 'snapback2'; export default schema({tables:{}});", "snapback/ops.ts": source };
}

function channelValue(schema: { channels: Record<string, unknown> }): unknown {
  const channel = schema.channels.probe;
  assert(channel && typeof channel === "object" && "args" in channel);
  assert(channel.args && typeof channel.args === "object" && "value" in channel.args);
  return channel.args.value;
}

export function registerArgumentDescriptorChecks(test: Test, lib: string): void {
  registerDescriptorOriginChecks(test, lib);
  for (const item of descriptorCases) test(`argument descriptor custody ${item.name}`, async () => {
    for (const wrap of [false, true]) {
      const value = wrap ? `t.optional(t.list(t.optional(${item.value}), {max:2}))` : item.value;
      const expected = item.expected === undefined ? undefined : wrap
        ? { Optional: { List: { of: { Optional: item.expected }, max: 2 } } } : item.expected;
      const expression = ts.createSourceFile("descriptor.ts", descriptorSource(value, "query", item.prelude) + `\n${value};`, ts.ScriptTarget.ESNext, true).statements.at(-1);
      assert(expression && ts.isExpressionStatement(expression));
      assert.deepEqual(lowerArgDescriptor(expression.expression), expected);
      for (const kind of ["query", "mutation", "channel"]) {
        const source = descriptorSource(value, kind, item.prelude);
        if (kind === "channel") {
          const raw = lowerSchema(source, "schema.ts");
          if (expected !== undefined) { assert.deepEqual(raw.diagnostics, []); assert.deepEqual(channelValue(raw.schema), expected); }
          else assert(raw.diagnostics.some(d => d.code === "E_SCHEMA_INVALID" && d.site && d.guide && d.rewrite));
        } else {
          const raw = lowerSource(source, "descriptor.ts");
          const checked = lowerSource(source, "descriptor.ts", lib);
          if (expected !== undefined) {
            assert(raw.ok, JSON.stringify(raw)); assert.deepEqual(raw.programs[0]!.args.value, expected);
            assert(checked.ok, JSON.stringify(checked)); assert.deepEqual(checked.programs[0]!.args.value, expected);
          } else {
            assert(!raw.ok, JSON.stringify(raw)); assert(!checked.ok, JSON.stringify(checked));
            const refusal = raw.diagnostics.find(d => d.code === "E_ARGS_DESCRIPTOR");
            assert(refusal && refusal.site && refusal.family && refusal.guide && refusal.rewrite, JSON.stringify(raw));
            assert(lowerSource(descriptorSource(refusal.rewrite, kind, item.prelude), "repair.ts", lib).ok, JSON.stringify(refusal));
          }
        }
        const project = await withProject(descriptorFiles(source, kind), root => lowerProject(root, { authoring: "any" }));
        if (expected !== undefined) {
          assert(project.ok, JSON.stringify(project));
          assert.deepEqual(kind === "channel" ? channelValue(project.project.schema) : project.project.programs[0]!.args.value, expected);
          if (kind !== "channel") assert(!project.apiDts.includes("value: unknown"));
        } else assert(!project.ok, JSON.stringify(project));
      }
    }
  });

  test("every native constructor fails closed under malformed and recursive argument syntax", () => {
    const values = ["cursor(0)", "id(0)", "principal(0)", "int(0)", "bool(0)", "time(0)", "bytes(0)", "image(0)", "video(0)", "json(0)", "enum([])", "decimal(13)", "money('usd')", "ref()", "text(0)", "optional()", "list(t.int(), {max:0})", "unknown()"];
    for (const value of values) for (const owner of ["t", "(t)", "a", "ns.t", "other"])
      for (const wrapper of ["$", "t.optional($)", "t.list($, {max:2})"]) {
        const source = descriptorSource(wrapper.replace("$", `${owner}.${value}`));
        const result = lowerSource(source, "constructors.ts");
        assert(!result.ok, JSON.stringify({ source, result }));
        assert(result.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify(result));
      }
  });

  test("explicit gauntlet Scalar forms survive while bounded legacy text retains its descriptor", async () => {
    const controls: Array<[string, unknown]> = [["scalar()", "Scalar"], ["id(records)", "Scalar"], ["text()", "Scalar"], ["text({})", "Scalar"], ["optional(scalar())", "Scalar"], ["list(scalar(),{max:2})", {List:{max:2}}], ["text({max:31})", {Text:{max:31}}], ["list(text({max:31}),{max:2})", {List:{of:{Text:{max:31}},max:2}}], ["optional(list(text({max:31}),{max:2}))", {Optional:{List:{of:{Text:{max:31}},max:2}}}]];
    for (const [value, expected] of controls) {
      const source = descriptorSource(value, "query", legacyDescriptorDeclarations);
      const result = lowerSource(source, "legacy.ts", lib);
      assert(result.ok, JSON.stringify(result)); assert.deepEqual(result.programs[0]!.args.value, expected);
      const project = await withProject(descriptorFiles(source, "query"), root => lowerProject(root, { authoring: "any" }));
      assert(project.ok, JSON.stringify(project)); assert.deepEqual(project.project.programs[0]!.args.value, expected);
    }
    for (const value of ["scalar(t.text(31))", "text({max:undefined})", "text({max:0})", "optional(make())", "list(make(),{max:2})", "list(text({max:0}),{max:2})", "t.optional(scalar())", "t.list(scalar(),{max:2})"])
      assert(!lowerSource(descriptorSource(value), "legacy-invalid.ts").ok, value);
  });
  test("legacy wrappers do not retry a failed reference without the table catalog", () => {
    for (const value of ["optional(t.ref(missing))", "list(t.ref(missing), {max:2})"])
      assert(!lowerSource(descriptorSource(value), "reference.ts", undefined, { tables: new Map() }).ok, value);
  });
  test("unsupported descriptor repairs use the actual named or namespace import", () => {
    for (const [imports, descriptor] of [["import {query,t as a} from 'snapback2';", 'a["text"](31,{format:"url"})'], ["import {query} from 'snapback2'; import * as ns from 'snapback2';", '(ns.t.text)(31,{format:"url"})']]) {
      const source = `${imports} export const probe=query({value:${descriptor}},({args})=>args.value);`;
      const result = lowerSource(source, "imports.ts", lib); assert(!result.ok);
      const refusal = result.diagnostics.find(d => d.code === "E_ARGS_DESCRIPTOR"); assert(refusal);
      assert(lowerSource(source.replace(descriptor, refusal.rewrite), "imports.ts", lib).ok, JSON.stringify(refusal));
    }
  });
}

function registerDescriptorOriginChecks(test: Test, lib: string): void {
  test("descriptor origin argument isolation retains historical Column refusal sites", () => {
    for (const leaf of ["text(31)", "int()", 'money("USD")']) for (const wrapper of ["optional", "list"]) {
      const value = wrapper === "optional" ? `t.optional(${leaf},0)` : `t.list(${leaf},{max:0})`;
      const source = `import {schema,table,t} from 'snapback2';export const records=table({columns:{value:${value}}});export default schema({tables:{records}});`;
      const result = lowerSchema(source,"schema.ts");
      assert.equal(result.diagnostics.length,1);
      assert.equal(result.diagnostics[0]!.message,`t.${wrapper} arguments do not form a valid descriptor`);
      assert.equal(result.diagnostics[0]!.site,`schema.ts:1:${source.indexOf(value)+1}`);
    }
  });
  const constructors: Array<[string, string]> = [
    ...["id", "principal", "cursor", "int", "bool", "time"].map(name => [name, ""] as [string, string]),
    ...["text", "bytes", "image", "video", "json"].map(name => [name, "90"] as [string, string]),
    ["decimal", "3"], ["money", '"USD"'], ["enum", '["a","b"]'], ["ref", "records"],
    ["optional", "t.int()"], ["list", "t.int(),{max:2}"], ["scalar", ""],
  ];
  const returnText = 'return t.text(31,{min:8,format:"url"});';
  for (const [name, args] of constructors) test(`descriptor origin refuses ${name} factory bindings across complete private projects`, async () => {
    const forms = [
      { prelude: `function ${name}(...values:unknown[]){${returnText}}`, value: `${name}(${args})` },
      { prelude: `const owner={${name}(...values:unknown[]){${returnText}}};`, value: `owner.${name}(${args})` },
      { prelude: `namespace factories {export function make(...values:unknown[]){${returnText}}} import ${name}=factories.make;`, value: `${name}(${args})` },
    ];
    // `enum` is a reserved binding word in TypeScript; its method spelling is
    // legal and exercises the same native-origin boundary without a parse error.
    for (const form of name === "enum" ? [forms[1]!] : forms) for (const wrap of [false, true]) for (const kind of ["query", "mutation", "channel"]) {
      const value = wrap ? `t.optional(t.list(t.optional(${form.value}),{max:2}))` : form.value;
      const source = descriptorSource(value, kind, `declare const records:unknown; ${form.prelude}`);
      assert.deepEqual(typecheckSource(source, "origin.ts", lib).map(d => ({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,"\n")})), [], source);
      const project = await withProject(descriptorFiles(source, kind), root => lowerProject(root, { authoring: "any" }));
      assert(!project.ok, JSON.stringify({source,project}));
      const refusal = project.diagnostics.find(d => d.code === (kind === "channel" ? "E_SCHEMA_INVALID" : "E_ARGS_DESCRIPTOR"));
      assert(refusal?.site && refusal.family && refusal.guide && refusal.rewrite, JSON.stringify(project));
      assert.match(refusal.message, /direct descriptor call/);
      assert(!("apiDts" in project), "a refused factory must not publish a substituted API");
    }
  });
  const unsupported = [
    ["native-named-constructor-alias", "const text=t.text;", 'text(31,{min:8,format:"url"})'],
    ["destructured-constructor", "const {text}=t;", 'text(31,{min:8,format:"url"})'],
    ["getter-factory", `const owner={get text(){return (max:number)=>{${returnText}}}};`, "owner.text(90)"],
    ["factory-owner", `function get(){return {text(max:number){${returnText}}}}`, "get().text(90)"],
    ["dynamic-factory-owner", `const key="nested";const owner={nested:{int(){${returnText}}}};`, "owner[key].int()"],
    ["undefined-factory", "function int(){return t.text(31,{format:undefined});}", "int()"],
    ["overloaded-factory", `function int():import('snapback2').Arg<string>;function int(){${returnText}}`, "int()"],
    ["ambient-native-name", "declare function int():import('snapback2').Arg<string>;", "int()"],
    ["imported-foreign-owner", "import {t as foreign} from './foreign';", "foreign.int()"],
    ["mutable-owner", "let owner=t;", 'owner.text(31,{min:8,format:"url"})'],
    ["owner-method-write", `const owner={types:t};owner.types.text=(max:number)=>{${returnText}}`, 'owner.types.text(90)'],
    ["owner-method-write-alias", `const owner={types:t};const alias=owner.types;alias.text=(max:number)=>{${returnText}}`, 't.text(90)'],
    ["escaped-owner", "declare function consume(value:typeof t):void;consume(t);", 't.text(90)'],
    ["escaped-container", "const holder={types:t};declare function consume(value:typeof holder):void;consume(holder);", 't.text(90)'],
    ["escaped-spread-container", "const holder={types:t};declare function consume(value:typeof holder):void;consume({...holder});", 't.text(90)'],
    ["for-assigned-method", `const replacement=(max:number)=>{${returnText}};for(t.text of [replacement]){}`, 't.text(90)'],
  ];
  for (const [name, prelude, value] of unsupported) test(`descriptor origin ${name} has a sited refusal`, async () => {
    for (const kind of ["query", "mutation", "channel"]) {
      const source = descriptorSource(`t.optional(t.list(t.optional(${value}),{max:2}))`, kind, prelude);
      const files = { ...descriptorFiles(source, kind), "snapback/foreign.ts": `import {t as native} from 'snapback2';export const t={int(){return native.text(31,{min:8,format:"url"})}};` };
      const project = await withProject(files, root => lowerProject(root, {authoring:"any"}));
      assert(!project.ok, JSON.stringify(project));
      assert(project.diagnostics.some(d => d.code === (kind === "channel" ? "E_SCHEMA_INVALID" : "E_ARGS_DESCRIPTOR") && d.site), JSON.stringify(project));
    }
  });
  const owners = [
    ["import-rename", "import {t as scalar} from 'snapback2';", "scalar"],
    ["import-equals-owner", "import scalar=ns.t;", "scalar"],
    ["destructured-owner", "const {t:owner}=ns;", "owner"],
    ["nested-alias", "const first=t; const second=first; const holder={types:second};", "holder.types"],
    ["shorthand", "const types=t;const holder={types};", "holder.types"],
    ["static-key", 'const key="native";const holders={native:t};', "holders[key]"],
    ["literal-owner-choice", "", "(true?t:t)"],
    ["transparent-accessor", "function get(){return t;}", "get()"],
    ["renamed-accessor", "function int(){return t;}", "int()"],
    ["arrow-accessor", "const get=()=>t;", "get()"],
  ];
  for (const [name, prelude, owner] of owners) test(`descriptor origin ${name} retains the native recursive descriptor`, async () => {
    for (const kind of ["query", "mutation", "channel"]) {
      const value = `t.optional(t.list(t.optional(${owner}.text(31,{min:8,format:"url"})),{max:2}))`;
      const source = descriptorSource(value, kind, prelude);
      assert.deepEqual(typecheckSource(source, "owner.ts", lib).map(d => ({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,"\n")})), [], source);
      const project = await withProject(descriptorFiles(source, kind), root => lowerProject(root, {authoring:"any"}));
      assert(project.ok, JSON.stringify(project));
      assert.deepEqual(kind === "channel" ? channelValue(project.project.schema) : project.project.programs[0]!.args.value,
        {Optional:{List:{of:{Optional:refined},max:2}}});
    }
  });
  test("descriptor origin generated API consumers retain Text through native owner aliases", async () => {
    for (const kind of ["query", "mutation", "channel"]) {
      const source = descriptorSource('t.optional(t.list(holder.types.text(31,{min:8,format:"url"}),{max:2}))', kind, "const types=t;const holder={types};");
      const project = await withProject(descriptorFiles(source, kind), root => lowerProject(root, {authoring:"any"}));
      assert(project.ok, JSON.stringify(project));
      const consumer = `import {api,type Op,type Channel} from 'snapback2/client';
type Args<T>=T extends ${kind === "channel" ? "Channel<infer A,unknown>" : "Op<infer A,unknown>"}?A:never;
const args:Args<typeof api.${kind === "channel" ? "channels" : "ops"}.probe>={value:[VALUE]};`;
      assert.deepEqual(apiConsumerDiagnostics(project.apiDts, consumer.replace("VALUE", '"https://x"')), []);
      const wrong = apiConsumerDiagnostics(project.apiDts, consumer.replace("VALUE", "42"));
      assert(wrong.length > 0 && wrong.every(message => message.includes("TS2322")), JSON.stringify(wrong));
    }
  });
  test("descriptor origin lexical bindings override ambient spellings in every parsed scope", () => {
    for (const prelude of [
      `const scalar=()=>{${returnText}};`, `function scalar(){${returnText}}`,
      `namespace factory {export function make(){${returnText}}} import scalar=factory.make;`,
      `const {scalar}={scalar:()=>{${returnText}}};`,
    ]) {
      const source = ts.createSourceFile("scope.ts", `import {t} from 'snapback2';{${prelude} scalar();}`, ts.ScriptTarget.ES2022, true);
      const block = source.statements[1];assert(block && ts.isBlock(block));
      const last = block.statements.at(-1);assert(last && ts.isExpressionStatement(last));
      assert.equal(lowerArgDescriptor(last.expression), undefined);
      assert.equal(lowerLegacyArgDescriptor(last.expression), undefined);
    }
  });
}
