import { registerDescriptorProjectChecks } from "./descriptor-project-checks";
import assert from "node:assert/strict";
import { registerArgumentDescriptorChecks } from "./argument-descriptor-checks";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { lowerProject } from "./project";
import type { SchemaJson } from "./ir";
import { apiConsumerDiagnostics, compileInline, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — every job argument is admitted before any sweep, including unused arguments.
const schema = `table records:
  body: text <=2048
  handle: text 1..20 format handle
  link: text <=2048 format url ?
  public
  update <- allow
`;
export const formatArguments = "handle: text 1..20 format handle, link: text <=2048 format url ?, items: [text <=20 format handle] <=2, optionalItems: [text 0..20 format handle] <=2 ?, nested: [[text 8..2048 format url] <=3] <=2 ?";
export const formatDescriptors = {
  handle: { Text: { max: 20, min: 1, format: "handle" } },
  link: { Optional: { Text: { max: 2048, format: "url" } } },
  items: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } },
  optionalItems: { Optional: { List: { of: { Text: { max: 20, format: "handle" } }, max: 2 } } },
  nested: { Optional: { List: { of: { List: { of: { Text: { max: 2048, min: 8, format: "url" } }, max: 3 } }, max: 2 } } },
};
const ordinaryBody = "  return { handle, link, items, optionalItems, nested }\n";
const jobBody = "  chunk record in records first 2 by byId:\n    update records[record.id] { body: handle }\n";
const channelBody = "  publish <- allow\n  subscribe <- allow\n  ttl 5s\n";

function files(kind: string, args = formatArguments) {
  const declaration = `${kind} probe(${args}):\n${kind === "channel" ? channelBody : kind === "job" ? jobBody : ordinaryBody}`;
  return {
    "snapback/schema.q": schema + (kind === "channel" ? declaration : ""),
    "snapback/ops.q": kind === "channel" ? "query read():\n  return true\n" : declaration,
  };
}

function privateSource(value: string, kind = "query") {
  return `import { query, mutation, t } from 'snapback2';
export const probe = ${kind}({ value: ${value} }, ({ args }) => args.value);`;
}
function privateChannel(value: string) {
  return `import { channel, schema, rule, t } from 'snapback2';
export const probe = channel({ args: { value: ${value} }, publish: rule.allow(), subscribe: rule.allow(), ttlMs: 5000 });
export default schema({ tables: {}, channels: { probe } });`;
}

function channelArgs(schema: SchemaJson): unknown {
  const channel = schema.channels.probe;
  assert(channel && typeof channel === "object" && "args" in channel);
  return channel.args;
}

export function registerArgumentFormatChecks(test: Test, libText: string): void {
  registerArgumentDescriptorChecks(test, libText);
  registerDescriptorProjectChecks(test, libText);
  for (const kind of ["query", "mutation", "job", "channel"]) {
    test(`text formats survive complete ${kind} lowering, recursive wrappers and exports`, async () => {
      const result = await withProject(files(kind), lowerProject);
      assert(result.ok, JSON.stringify(result));
      const ordinary = await withProject(files(kind, formatArguments.replace(/ format (handle|url)/g, "")), lowerProject);
      assert(ordinary.ok, JSON.stringify(ordinary));
      const args = kind === "channel" ? channelArgs(result.project.schema) : result.project.programs[0]!.args;
      assert.deepEqual(JSON.parse(JSON.stringify(args)), formatDescriptors);
      assert.deepEqual(result.project.schema.tables, ordinary.project.schema.tables);
      assert.deepEqual(result.project.programs.map(p => p.body), ordinary.project.programs.map(p => p.body));
      assert.deepEqual(result.sources, ordinary.sources);
      assert.equal(result.apiDts, ordinary.apiDts);
      assert(!JSON.stringify(result.project.programs).includes('"Require"'));
      if (kind === "job") assert.equal(result.project.programs[0]!.kind, "job");
      if (kind === "query" || kind === "mutation") {
        assert.deepEqual(apiConsumerDiagnostics(result.apiDts, `import { api, type Op } from 'snapback2/client';
type Args<T> = T extends Op<infer A, unknown> ? A : never;
const args: Args<typeof api.ops.probe> = { handle: 'abc_123', link: 'https://x', items: [''], nested: [['http://x']] };`), []);
      }
      if (kind === "channel") assert.match(result.apiDts, /readonly channels: \{ probe: Channel</);
    });
  }

  for (const format of ["handle", "url"]) {
    for (const min of [0, 1, 20]) {
      test(`${format} private descriptor retains minimum ${min} and maximum through Optional/List`, () => {
        const descriptor = `t.text(20, { format: '${format}', min: ${min} })`;
        const expected = { Optional: { List: { of: { Optional: { Text: { max: 20, ...(min ? { min } : {}), format } } }, max: 2 } } };
        const value = `t.optional(t.list(t.optional(${descriptor}), { max: 2 }))`;
        for (const kind of ["query", "mutation"]) {
          const result = lowerSource(privateSource(value, kind), "format.ts", libText);
          assert(result.ok, JSON.stringify(result));
          assert.deepEqual(result.programs[0]!.args.value, expected);
        }
        const channel = lowerSchema(privateChannel(value), "schema.ts");
        assert.deepEqual(channel.diagnostics, []);
        assert.deepEqual(channelArgs(channel.schema), { value: expected });
      });
    }
  }
  test("absent text format and zero minimum preserve canonical descriptors", () => {
    for (const descriptor of ["t.text(20)", "t.text(20, {})", "t.text(20, { min: 0 })"]) {
      const result = lowerSource(privateSource(`t.optional(t.list(${descriptor}, { max: 2 }))`), "absent.ts", libText);
      assert(result.ok, JSON.stringify(result));
      assert.deepEqual(result.programs[0]!.args.value, { Optional: { List: { of: { Text: { max: 20 } }, max: 2 } } });
    }
  });
  test("formatted argument u32 endpoint remains accepted without changing the bound", () => {
    const result = lowerSource(privateSource("t.text(4294967295, { min: 4294967295, format: 'handle' })"), "max.ts", libText);
    assert(result.ok, JSON.stringify(result));
    assert.deepEqual(result.programs[0]!.args.value, { Text: { max: 4294967295, min: 4294967295, format: "handle" } });
  });
  test("private repeated Optional preserves its descriptor and renders one paved question mark", async () => {
    const source = privateSource("t.optional(t.optional(t.text(20, { format: 'handle' })))");
    const lowered = lowerSource(source, "repeated.ts", libText);
    assert(lowered.ok, JSON.stringify(lowered));
    assert.deepEqual(lowered.programs[0]!.args.value, { Optional: { Optional: { Text: { max: 20, format: "handle" } } } });
    const result = await withProject({ "snapback/schema.q": schema, "snapback/ops.ts": source }, lowerProject);
    assert(!result.ok);
    const diagnostic = result.diagnostics.find(d => d.code === "E_QUARRY_ONLY");
    assert.equal(diagnostic?.rewrite, "query probe(value: text <=20 format handle ?):");
    assert(compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: diagnostic!.rewrite + "\n  return value\n" },
    ]).ok);
  });
  test("private text columns still refuse argument refinements with an ordinary column repair", () => {
    const result = lowerSchema(`import {schema,table,t} from 'snapback2';
export const records = table({ columns: { value: t.text(20, { min: 1, format: 'handle' }) } });
export default schema({ tables: { records } });`, "schema.ts");
    const diagnostic = result.diagnostics.find(d => d.code === "E_SCHEMA_COLUMN");
    assert(diagnostic, JSON.stringify(result));
    assert.equal(diagnostic.rewrite, "t.text(100)");
  });

  const invalidFormats = ["'unknown'", "'Handle'", "'URL'", "''", "null", "undefined", "0", "false", "{}", "[]"];
  const invalid = [
    ...invalidFormats.map(format => `t.text(20, { format: ${format} })`),
    "t.text(20, { format: 'handle', format: 'url' })",
    "t.text(20, { ['format']: 'handle' })",
    "t.text(20, { ...{ format: 'handle' } })",
    "t.text(20, { format })",
    "t.text(20, { get format() { return 'handle'; } })",
    "t.text(20, { format: 'handle', unknown: true })",
    "t.text(20, { min: 21, format: 'handle' })",
    "t.text(20, { min: -1, format: 'url' })",
    "t.text(20, { min: 1.5, format: 'handle' })",
    "t.text(20, { min: null, format: 'url' })",
    "t.text(20, { min: undefined, format: 'handle' })",
    "t.text(0, { format: 'handle' })",
    "t.text(4294967296, { format: 'url' })",
    "t.text(1.5, { format: 'handle' })",
    "t.text(20, { format: 'url' }, 0)",
  ];
  for (const descriptor of invalid) {
    test(`raw text descriptor refuses without the TS checker: ${descriptor}`, () => {
      for (const value of [descriptor, `t.optional(t.list(t.optional(${descriptor}), { max: 2 }))`]) {
        const result = lowerSource(privateSource(value), "invalid-format.ts");
        assert(!result.ok, JSON.stringify(result));
        const diagnostic = result.diagnostics.find(d => d.code === "E_ARGS_DESCRIPTOR");
        assert(diagnostic, JSON.stringify(result));
        assert.match(diagnostic.site, /^invalid-format.ts:\d+:\d+$/);
        assert(diagnostic.family && diagnostic.guide && diagnostic.rewrite);
        const repair = lowerSource(privateSource(diagnostic.rewrite), "repair.ts", libText);
        assert(repair.ok, JSON.stringify(repair));
        const channel = lowerSchema(privateChannel(value), "schema.ts");
        const channelDiagnostic = channel.diagnostics.find(d => d.code === "E_SCHEMA_INVALID");
        assert(channelDiagnostic, JSON.stringify(channel));
        assert.match(channelDiagnostic.site, /^schema.ts:\d+:\d+$/);
        assert.deepEqual(lowerSchema(privateChannel(channelDiagnostic.rewrite), "schema.ts").diagnostics, []);
      }
    });
  }

  test("unknown public format refuses at the authored token with parser-confirmed repairs", async () => {
    for (const kind of ["query", "mutation", "job", "channel"]) {
      const inputs = files(kind, formatArguments.replace("format handle", "format unknown"));
      const result = compileInline(Object.entries(inputs).map(([fileName, source]) => ({ fileName, source })));
      assert(!result.ok);
      const project = await withProject(inputs, lowerProject);
      assert(!project.ok && project.diagnostics.some(d => d.code === "E_QUARRY_SYNTAX"));
      const diagnostic = result.diagnostics.find(d => d.code === "E_QUARRY_SYNTAX");
      assert(diagnostic, JSON.stringify(result));
      assert.match(diagnostic.message, /unknown text format unknown/);
      assert.equal(diagnostic.guide, "quarry/grammar");
      assert.equal(diagnostic.rewrite, "-- use text 1..20 format handle or text 1..20 format url");
      for (const replacement of ["text 1..20 format handle", "text 1..20 format url"]) {
        const repaired = Object.entries(inputs).map(([fileName, source]) => ({ fileName,
          source: source.replace("text 1..20 format unknown", replacement) }));
        assert(compileInline(repaired).ok);
        const full = await withProject(Object.fromEntries(repaired.map(f => [f.fileName, f.source])), lowerProject);
        assert(full.ok, JSON.stringify(full));
      }
    }
  });
  test("public formatted bounds and unsupported optional list elements retain their refusals", () => {
    for (const type of ["text 21..20 format handle", "text <=0 format url", "text 1.5..20 format handle", "[text <=20 format handle ?] <=2", "[[text <=20 format url] <=2 ?] <=2"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `query probe(value: ${type}):\n  return value\n` },
      ]);
      assert(!result.ok, type);
      if (type.includes("?")) assert(result.diagnostics.some(d => d.message === "list element types cannot be optional"));
    }
  });

  test("catalog index diagnostic retains column text minimum and format", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: schema.replace("  public", "  by handle\n  public") },
      { fileName: "snapback/ops.q", source: "query probe(value: int):\n  return records[value] first 2 by byHandle\n" },
    ]);
    assert(!result.ok);
    assert(result.diagnostics.some(d => d.message.includes("text 1..20 format handle") && d.rewrite.includes("text 1..20 format handle")), JSON.stringify(result));
  });
  test("private declaration rewrites retain formats, including channel and renamed exports", async () => {
    for (const kind of ["query", "mutation", "channel"]) {
      const value = "t.optional(t.list(t.list(t.text(2048, { min: 8, format: 'url' }), { max: 3 }), { max: 2 }))";
      const source = (kind === "channel" ? privateChannel(value).replace(/export default[^\n]+/, "") : privateSource(value, kind))
        .replace("export const probe", "const local") + "\nexport { local as probe };\n";
      const result = await withProject({ "snapback/schema.q": schema, "snapback/ops.ts": source }, lowerProject);
      assert(!result.ok);
      const diagnostic = result.diagnostics.find(d => d.code === "E_QUARRY_ONLY");
      assert(diagnostic, JSON.stringify(result));
      const signature = `${kind} probe(value: [[text 8..2048 format url] <=3] <=2 ?):`;
      assert.equal(diagnostic.rewrite, signature);
      const declaration = signature + "\n" + (kind === "channel" ? channelBody : "  return value\n");
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: schema + (kind === "channel" ? declaration : "") },
        { fileName: "snapback/ops.q", source: kind === "channel" ? "query read():\n  return true\n" : declaration },
      ]);
      assert(compiled.ok, JSON.stringify(compiled));
    }
  });
  test("private-only optional elements and invalid formats get no misleading Quarry signature", async () => {
    for (const value of ["t.list(t.optional(t.text(20, { format: 'handle' })), { max: 2 })", "t.text(20, { format: null })"]) {
      const result = await withProject({ "snapback/schema.q": schema, "snapback/ops.ts": privateSource(value) }, lowerProject);
      assert(!result.ok);
      const diagnostic = result.diagnostics.find(d => d.code === "E_QUARRY_ONLY");
      assert(diagnostic);
      assert.match(diagnostic.rewrite, /^argument value:/);
      assert(!diagnostic.rewrite.includes("query probe("));
    }
  });
}
