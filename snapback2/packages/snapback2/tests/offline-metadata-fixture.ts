// Exact shared synthetic metadata fixture extracted to keep the integrated test file below its source cap.
import { readFileSync } from "node:fs";
import { schemaDigest } from "../dist/index.mjs";
export const generation = "d".repeat(64);
const metadataSchema = {
        tables: {
          messages: {
            columns: { id: "Id", conversationId: { Ref: { table: "conversations" } }, at: "Time", body: { Text: { max: 4000 } } },
            indexes: { byConvTime: { components: [{ Column: "conversationId" }, { Column: "at" }, { Column: "id" }], unique: false }, byId: { components: [{ Column: "id" }], unique: true } },
            retain: "delivered-history",
          },
        },
      };
export const schemaHash = schemaDigest(metadataSchema);
export const planHash = "f".repeat(64);

// This separate drain identity is an evaluator-corpus program certified by the
// native checker. Tests which execute a drain use its exact schema, IR and
// certificate instead of teaching strict custody to accept synthetic metadata.
const corpus = JSON.parse(readFileSync(new URL("../../../corpus/local-pagination-partial-clears-next.json", import.meta.url), "utf8"));
export const certifiedDrain = {
  op: corpus.program.name as string,
  generation: "e".repeat(64), schemaHash: corpus.certificate.schema_hash as string,
  planHash: corpus.certificate.plan_hash as string,
};

export function certifiedDrainPage(page: 1 | 2) {
  const source = corpus.receipt.ranges[0];
  const selected = page === 1 ? corpus.receipt.rows.slice(0, 3) : corpus.receipt.rows.slice(2, 3);
  const rows = selected.map((item: any) => ({ table: item.table, id: item.id,
    row: Object.fromEntries(Object.entries(item.row.Row).map(([name, value]: [string, any]) => [name, Object.values(value)[0]])) }));
  const rowIds = page === 1 ? source.row_ids : ["p2"];
  return { data: rowIds.map((id: string) => ({ $row: { table: source.table, id } })), rows, receipt: { ranges: [{
    site: source.site, table: source.table, index: source.index, prefix: source.prefix, order: source.order,
    take: source.take, after: page === 1 ? source.after : [1, "p1"], before: source.before, gt: source.gt, gte: source.gte, lt: source.lt, lte: source.lte,
    ruleHash: source.rule_hash, rowIds, stop: page === 1 ? source.stop : "Exhausted", absence: source.absence,
    ...(page === 1 ? { haloId: source.halo.id } : {}),
  }], absences: [], verdicts: [] } };
}

export function certifiedDrainEnvelope(data: unknown, validator = "1".repeat(64), seq = 3) {
  return { protocol: 1, generation: certifiedDrain.generation, schemaHash: certifiedDrain.schemaHash, planHash: certifiedDrain.planHash,
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq,
    rows: [], receipt: { ranges: [], absences: [], verdicts: [] }, validator,
    ...(seq === 1 || seq === 2 ? certifiedDrainPage(seq) : {}) };
}

export function certifiedDrainMetadataResponse(input: RequestInfo | URL): Response | undefined {
  const url = String(input), drain = { cursor: "c" };
  if (url.endsWith("/api/manifest")) return new Response(JSON.stringify({
    generation: "certified-schema-generation", programGeneration: certifiedDrain.generation,
    ops: { [certifiedDrain.op]: { kind: "query", planHash: certifiedDrain.planHash, drain, args: corpus.program.args } },
    channels: {}, auth: {}, tables: Object.fromEntries(Object.entries(corpus.schema.tables).map(([name, table]: [string, any]) => [name, { retain: table.retain }])),
  }), { status: 200 });
  if (url.includes("/api/program?")) return new Response(JSON.stringify({
    generation: certifiedDrain.generation, schemaHash: certifiedDrain.schemaHash, schema: corpus.schema,
    programs: { [certifiedDrain.op]: { kind: "query", planHash: certifiedDrain.planHash, drain, ir: corpus.program, certificate: corpus.certificate } },
  }), { status: 200 });
  return undefined;
}

export function metadataResponse(input: RequestInfo | URL): Response | undefined {
  const url = String(input);
  if (url.endsWith("/api/manifest")) {
    return new Response(JSON.stringify({
      generation: "schema-generation",
      programGeneration: generation,
      ops: { "deliveries.inbox": { kind: "query", planHash, drain: { cursor: "c" }, args: { c: { Optional: "Cursor" } } } },
      channels: {},
      auth: {},
      tables: { messages: { retain: "delivered-history" } },
    }), { status: 200 });
  }
  if (url.includes("/api/program?")) {
    return new Response(JSON.stringify({
      generation,
      schemaHash,
      programs: {},
      schema: metadataSchema,
    }), { status: 200 });
  }
  return undefined;
}
