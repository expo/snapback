// Browser-safe preparation of codegen-owned mutation IR for the durable
// outbox/rebase composition. This module never invents a transform: it only
// instantiates the generated plan with call arguments and labeled ctx claims.
//
// @ref LLP 0155#execution-contract — generated IR is the only authored write;
// the client derives a private layer and Lane-L claims from that same carrier.

import {
  canonicalizeClientValueV1,
} from './canonical-client-value.mjs';
import { createClientMutationId } from '@expo/snapback-contract/client-store';

export const GENERATED_MUTATION_IR_FORMAT_V1 = 'snapback.generated-mutation-ir.v1';
export const GENERATED_OPTIMISTIC_OPERATION_FORMAT_V1 =
  'snapback.generated-optimistic-operation.v1';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SETTLEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(canonicalizeClientValueV1(value));

const same = (left, right) => (
  canonicalizeClientValueV1(left) === canonicalizeClientValueV1(right)
);

const fail = (code, message) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  throw error;
};

export function generatedMutationIrCapability(reference) {
  const mutationIr = reference?.mutationIr;
  if (!plain(mutationIr) || mutationIr.format !== GENERATED_MUTATION_IR_FORMAT_V1) {
    return Object.freeze({
      generated: false,
      localExecutable: false,
      code: 'SNAPBACK_GENERATED_IR_ABSENT',
    });
  }
  return Object.freeze({
    generated: true,
    localExecutable: mutationIr.capabilityClass === 'local-executable',
    code: mutationIr.capabilityCode,
    operationHash: mutationIr.operationHash,
  });
}

/** Instantiate one generated local mutation without accepting app transforms. */
export function prepareGeneratedMutationIrV1({
  reference,
  args = {},
  clientMutationId,
  now = Date.now(),
  mintSpeculativeId = () => createClientMutationId('id'),
  authUserId = null,
} = {}) {
  const mutationIr = reference?.mutationIr;
  if (
    reference?.artifactKind !== 'functionReference'
    || reference?.kind !== 'Mutation'
    || !plain(mutationIr)
    || mutationIr.format !== GENERATED_MUTATION_IR_FORMAT_V1
  ) fail('SNAPBACK_GENERATED_IR_INVALID', 'mutation reference has no generated IR carrier');
  if (mutationIr.capabilityClass !== 'local-executable') {
    fail(
      'SNAPBACK_GENERATED_IR_SERVER_ONLY',
      `generated plan is not locally executable (${mutationIr.capabilityCode ?? 'unclassified'})`,
    );
  }
  if (!DIGEST.test(mutationIr.operationHash ?? '')) {
    fail('SNAPBACK_GENERATED_IR_INVALID', 'generated operation hash is invalid');
  }
  if (
    mutationIr.sourceIdentity?.functionId !== reference.id
    || mutationIr.sourceIdentity?.implementationHash !== reference.implementationHash
    || mutationIr.sourceIdentity?.authoredSourceHash !== reference.authoredSourceHash
    || !same(mutationIr.sourceIdentity?.activation, reference.expectedGeneration)
  ) fail('SNAPBACK_GENERATED_IR_SOURCE_MISMATCH', 'generated IR source identity drifted');
  if (
    mutationIr.schemaIdentity?.schemaVersion !== reference.expectedGeneration?.schemaVersion
    || mutationIr.schemaIdentity?.appId !== reference.expectedGeneration?.appId
    || mutationIr.schemaIdentity?.schemaHash !== reference.expectedGeneration?.schemaHash
  ) fail('SNAPBACK_GENERATED_IR_SCHEMA_MISMATCH', 'generated IR schema identity drifted');
  if (typeof clientMutationId !== 'string' || !SETTLEMENT_ID.test(clientMutationId)) {
    fail('SNAPBACK_GENERATED_IR_SETTLEMENT_ID_INVALID', 'client mutation identity is invalid');
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    fail('SNAPBACK_GENERATED_IR_CLOCK_INVALID', 'captured local clock is outside the portable range');
  }
  if (!Array.isArray(mutationIr.mintSites)) {
    fail('SNAPBACK_GENERATED_IR_MINT_SITES_INVALID', 'generated mint sites are invalid');
  }

  const ids = [];
  const mints = [];
  const occurrences = new Map();
  for (const site of mutationIr.mintSites) {
    if (typeof site !== 'string' || site.length === 0) {
      fail('SNAPBACK_GENERATED_IR_MINT_SITES_INVALID', 'generated mint site is invalid');
    }
    const claimed = mintSpeculativeId();
    if (typeof claimed !== 'string' || !SETTLEMENT_ID.test(claimed)) {
      fail('SNAPBACK_GENERATED_IR_MINT_INVALID', 'speculative id mint returned an invalid id');
    }
    const occurrence = occurrences.get(site) ?? 0;
    occurrences.set(site, occurrence + 1);
    ids.push(claimed);
    mints.push({ claimed, site, occurrence });
  }
  const ctxLedger = Object.freeze({ version: 1, ids: Object.freeze(ids), now });
  const settlementClaims = Object.freeze({
    version: 1,
    ...(mutationIr.usesRuntimeNow === true ? { now } : {}),
    mints: Object.freeze(mints),
  });
  const optimisticOperation = Object.freeze({
    format: GENERATED_OPTIMISTIC_OPERATION_FORMAT_V1,
    name: reference.name,
    operationHash: mutationIr.operationHash,
    sourceIdentity: clone(mutationIr.sourceIdentity),
    schemaIdentity: clone(mutationIr.schemaIdentity),
    schema: clone(mutationIr.schema),
    plan: clone(mutationIr.plan),
    args: clone(args),
    ctxLedger,
    authUserId,
    layerId: clientMutationId,
    declaredEffectClass: mutationIr.declaredEffectClass,
    declaredReads: clone(mutationIr.declaredReads),
    localReadRequirements: clone(mutationIr.localReadRequirements),
  });
  return Object.freeze({
    clientMutationId,
    operationHash: mutationIr.operationHash,
    ctxLedger,
    settlementLane: 're-derive',
    settlementIdentity: Object.freeze({
      implementationHash: reference.implementationHash,
      activation: clone(reference.expectedGeneration),
    }),
    settlementClaims,
    boundedSkew: mutationIr.boundedSkew === null ? null : clone(mutationIr.boundedSkew),
    optimisticOperation,
  });
}
