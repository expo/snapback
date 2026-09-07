// Exact shared synthetic metadata fixture extracted to keep the integrated test file below its source cap.
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
