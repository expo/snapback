// @ref LLP 1001#10-what-binds-and-how-it-is-checked — trusted issuing-operation Q follows identity-checked certified IR.
import { canonicalProgramJson } from "../../evaluator/src/certificate-identity.js";
import { sha256 } from "../../evaluator/src/hash.js";
import { CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION } from "../../evaluator/src/runner.js";
import { schemaDigest } from "./offline-schema.js";
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
  if (schemaDigest(schema) !== schemaHash) return undefined;
  const held: Record<string, HeldOperation> = {};
  for (const [name, entry] of Object.entries(programs)) {
    if (!object(entry) || (entry.kind !== "query" && entry.kind !== "mutation")) continue;
    if (typeof entry.planHash !== "string" || !object(entry.ir) || !object(entry.certificate)) continue;
    // The payload binds each op to one certificate: the plan hashes must agree.
    if (entry.certificate.plan_hash !== entry.planHash || entry.certificate.schema_hash !== schemaHash
      || entry.certificate.value_model_version !== CURRENT_VALUE_MODEL_VERSION || entry.certificate.evaluator_version !== CURRENT_EVALUATOR
      || sha256(canonicalProgramJson(entry.ir)) !== entry.planHash) continue;
    held[name] = { kind: entry.kind, planHash: entry.planHash, ir: entry.ir, certificate: entry.certificate,
      ...(typeof entry.cursor === 'string' ? { cursor: entry.cursor } : {}),
      ...(object(entry.drain) ? { drain: entry.drain as unknown as DrainContract } : {}) };
  }
  return { generation, schemaHash, schema: schema as HeldProgram["schema"], programs: held };
}
