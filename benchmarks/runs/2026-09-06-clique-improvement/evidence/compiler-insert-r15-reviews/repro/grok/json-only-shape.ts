import { writeFileSync } from "node:fs";
import { join } from "node:path";

const compilerRoot = process.env.COMPILER_ROOT!;
const outPath = process.env.OUT!;
const { lowerProject } = await import(join(compilerRoot, "src/project.ts"));
const { withProject } = await import(join(compilerRoot, "src/quarry-check-helpers.ts"));
const { custodyActual } = await import(join(compilerRoot, "src/capture-custody-checks.ts"));
const { decodeProducerValue } = await import(join(compilerRoot, "src/capture-producer-checks.ts"));

const schema = `import {schema,table,t,rule} from 'snapback2';
export const records=table({columns:{payload:t.optional(t.json(10000))},rules:{read:rule.allow(),insert:rule.allow()}});
export default schema({tables:{records}});`;
const wrap = (body: string, args = "payload:t.json(100)") =>
  `import {mutation,t} from 'snapback2';import {records} from './schema';
export const probe=mutation({${args}},({db,ctx,args})=>{${body}});`;

const cases = [
  { name: "json-only unknown insert id key",
    source: wrap("const input:any=args.payload; const row=db.insert(records,input); return db.get(records,[row.id]);") },
  { name: "json-only unknown insert omitted nothing-else",
    source: wrap("const input:any=args.payload; const row=db.insert(records,input); return {row, stored: db.get(records,[row.id])};") },
  { name: "json-only direct json insert id key",
    source: wrap("const row=db.insert(records,args.payload); return db.get(records,[row.id]);") },
  { name: "json-only unknown insert missing member",
    source: wrap("const input:any=args.payload; const row:any=db.insert(records,input); return db.get(records,[row.missing]);") },
  { name: "json-only ternary insert optional-looking id",
    source: wrap("const input:any=args.flag?{id:ctx.newId(),payload:null}:{payload:null}; const row=db.insert(records,input); return db.get(records,[row.id]);", "flag:t.bool()") },
];

const results = [];
for (const item of cases) {
  const entry: any = { name: item.name };
  await withProject({ "snapback/schema.ts": schema, "snapback/probe.ts": item.source }, async (root: string) => {
    const full = await lowerProject(root, { authoring: "any" });
    entry.ok = !!full.ok;
    entry.diagnostics = (full.diagnostics ?? []).map((d: any) => ({ code: d.code, message: d.message, site: d.site }));
    if (full.ok) {
      const gets: any[] = [];
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { for (const v of node) visit(v); return; }
        if (node.Get) gets.push({ provenance: node.Get.provenance, table: node.Get.table, index: node.Get.index });
        for (const v of Object.values(node)) visit(v);
      };
      visit(full.project.programs);
      entry.gets = gets;
      try {
        const actual = custodyActual(full, { payload: { Row: { hello: { Int: 1 } } }, flag: { Bool: true } });
        entry.evalTrue = { state: actual.state, result: actual.execution && decodeProducerValue(actual.execution.result) };
      } catch (error) {
        entry.evalTrue = { error: error instanceof Error ? error.message : String(error) };
      }
      try {
        const actual = custodyActual(full, { payload: { Row: { id: { Id: "given" } } }, flag: { Bool: false } });
        entry.evalFalse = { state: actual.state, result: actual.execution && decodeProducerValue(actual.execution.result) };
      } catch (error) {
        entry.evalFalse = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  results.push(entry);
}
writeFileSync(outPath, JSON.stringify({ compilerRoot, results }, null, 2));
console.log(JSON.stringify(results.map((r: any) => ({ name: r.name, ok: r.ok, codes: (r.diagnostics??[]).map((d:any)=>d.code), gets: r.gets, evalTrue: r.evalTrue, evalFalse: r.evalFalse })), null, 2));
