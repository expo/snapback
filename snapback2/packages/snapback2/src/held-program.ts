// @ref LLP 1001#10-what-binds-and-how-it-is-checked — trusted issuing-operation Q follows identity-checked certified IR.
import { canonicalProgramJson } from "../../evaluator/src/certificate-identity.js";
import { sha256 } from "../../evaluator/src/hash.js";
import { immutable } from "../../evaluator/src/row-image.js";
import { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION } from "../../evaluator/src/runner.js";
import { clone, prepareSchema } from "../../evaluator/src/value-runtime.js";
import type { DrainContract } from "./types.js";
import type { HeldProgram, HeldOperation } from "./store/range-store.js";
import { object } from "./store/row-values.js";
/** Both trusted descriptions must name the same exact query clock; there is no client quantization. */
export function queryClock(operation: HeldOperation): boolean {
  const ir = (operation.ir as any).read_time_granularity_ms ?? null;
  const cert = (operation.certificate as any).read_time_granularity_ms ?? null;
  if (ir !== cert || (ir !== null && (!Number.isSafeInteger(ir) || ir <= 0))) throw new TypeError('query clock declaration mismatch');
  return operation.kind === 'query' && ir !== null;
}
/**
 * `GET /api/program` as custody: the shape the twin holds per generation.
 * Anything malformed is refused here rather than evaluated later.
 */
export function decodeHeldProgram(value: unknown): HeldProgram | undefined {
  if (!object(value)) return undefined;
  const { generation, schemaHash, schema, programs } = value;
  if (typeof generation !== "string" || typeof schemaHash !== "string" || !object(schema) || !object(schema.tables) || !object(programs)) {
    return undefined;
  }
  // @ref LLP 1012#6-reads-offline — admitted program custody is the sole
  // cross-execution hash owner; arbitrary evaluator schemas remain mutable.
  const ownedSchema = prepareSchema(schema,schemaHash);
  if (!ownedSchema) return undefined;
  const held: Record<string, HeldOperation> = {};
  for (const [name, entry] of Object.entries(programs)) {
    if (!object(entry)) continue;
    const { kind,planHash,ir,certificate,cursor,drain } = entry;
    if ((kind !== "query" && kind !== "mutation") || typeof planHash !== "string" || !object(ir) || !object(certificate)) continue;
    // The payload binds each op to one certificate: the plan hashes must agree.
    if (certificate.plan_hash !== planHash || certificate.schema_hash !== schemaHash
      || certificate.value_model_version !== CURRENT_VALUE_MODEL_VERSION || certificate.evaluator_version !== CURRENT_EVALUATOR
      || sha256(canonicalProgramJson(ir)) !== planHash) continue;
    held[name] = clone({ kind,planHash,ir,certificate,
      ...(typeof cursor === 'string' ? { cursor } : {}),
      ...(object(drain) ? { drain: drain as unknown as DrainContract } : {}) });
  }
  return immutable({ generation, schemaHash, schema: ownedSchema as HeldProgram["schema"], programs: held });
}
