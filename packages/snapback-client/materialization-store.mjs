// Carrier-neutral LLP 0157 materialization semantics over the LLP 0166 v3
// transaction domain. Authorization witnesses, dispositions, leases, and
// barrier decisions are inputs from their owners; this module only validates
// their bindings and applies the supplied store effects.

import { compileResultContractValidator } from '@expo/snapback-contract/result-contract-validator';

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { refuseLocalEvaluation } from './evaluation-floor.mjs';
import { allocateQueryInstanceIdInMeta } from './rqs-store-meta.mjs';
import { base64UrlNoPad, hex, jcs, jcsBytes, sha256 } from './rqs.mjs';

const utf8 = new TextEncoder();
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const QMK = /^qmk1\.[A-Za-z0-9_-]{43}$/u;
const BASE64URL = /^[A-Za-z0-9_-]*$/u;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DEFAULT_MATERIALIZATION_LIMITS = Object.freeze({
  byteCeiling: 32 * 1024 * 1024,
  recordCeiling: 256,
  fragmentCeiling: 1_024,
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const same = (left, right) => jcs(left) === jcs(right);

function materializationError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({ code, message, details: Object.freeze({ ...details }) });
  return error;
}

function refuse(code, message, details = {}) {
  throw materializationError(code, message, details);
}

function exact(value, fields, where) {
  if (!plain(value)) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must be an object`);
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} has unknown field ${field}`);
    }
  }
  for (const field of fields) {
    if (!own(value, field)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is missing ${field}`);
    }
  }
  return value;
}

function jsonClone(value, where) {
  try {
    const copied = clone(value);
    jcs(copied);
    return copied;
  } catch {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must be a finite JSON value`);
  }
}

function nonempty(value, where) {
  if (typeof value !== 'string' || value.length === 0) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must be non-empty`);
  }
  return value;
}

function boundedId(value, where) {
  nonempty(value, where);
  if (utf8.encode(value).length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is not an admitted identity string`);
  }
  return value;
}

function digest(value, where) {
  if (!DIGEST.test(value ?? '')) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must be a sha256 digest`);
  }
  return value;
}

function safeInteger(value, where, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is outside portable integer bounds`);
  }
  return value;
}

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function hashRecord(domain, value) {
  return `sha256:${hex(sha256(concat(utf8.encode(domain), jcsBytes(value))))}`;
}

function decodeBase64url(value, length, where) {
  if (
    typeof value !== 'string'
    || !BASE64URL.test(value)
    || value.includes('=')
    || value.length % 4 === 1
  ) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is not canonical base64url`);
  }
  const bytes = new Uint8Array(Math.floor(value.length * 6 / 8));
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is not base64url`);
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (accumulator >>> bits) & 0xff;
      offset += 1;
    }
  }
  if (bytes.length !== length || base64UrlNoPad(bytes) !== value) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} has the wrong byte length or spelling`);
  }
  return bytes;
}

function compareUtf8(left, right) {
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < shared; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function prepareAddress(address) {
  if (
    !Array.isArray(address)
    || address.length !== 3
    || address[0] !== 'snapback:client-materialization-address:v1'
  ) refuse('SNAPBACK_MATERIALIZATION_ADDRESS_INVALID', 'address is not ClientMaterializationAddressV1');
  boundedId(address[1], 'address.clientStoreId');
  if (!QMK.test(address[2] ?? '')) {
    refuse('SNAPBACK_MATERIALIZATION_ADDRESS_INVALID', 'address materialization key is not qmk1');
  }
  decodeBase64url(address[2].slice(5), 32, 'address materialization key');
  return clone(address);
}

export function materializationAddressKey(address) {
  return jcs(prepareAddress(address));
}

function prepareCursorEnd(value, where) {
  if (value?.kind === 'first') return clone(exact(value, ['kind'], where));
  if (value?.kind === 'cursor') {
    exact(value, ['kind', 'profileId', 'digest'], where);
    if (!['relational-query.v1', 'bounded-children.v1', 'snapshot-batch.v1', 'snapshot-batch.v2'].includes(value.profileId)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where}.profileId is not admitted`);
    }
    digest(value.digest, `${where}.digest`);
    return clone(value);
  }
  refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is not a cursor end`);
}

function preparePage(value, where = 'proof.page') {
  if (value?.kind === 'sealed-terminal') {
    exact(value, ['kind', 'input', 'output'], where);
    prepareCursorEnd(value.input, `${where}.input`);
    exact(value.output, ['kind'], `${where}.output`);
    if (value.output.kind !== 'terminal') refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must terminate`);
    return clone(value);
  }
  if (value?.kind === 'visible') {
    exact(value, ['kind', 'input', 'boundaryVectorDigest', 'output'], where);
    prepareCursorEnd(value.input, `${where}.input`);
    digest(value.boundaryVectorDigest, `${where}.boundaryVectorDigest`);
    if (value.output?.kind === 'terminal') exact(value.output, ['kind'], `${where}.output`);
    else {
      prepareCursorEnd(value.output, `${where}.output`);
      if (value.output.kind !== 'cursor') {
        refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where}.output must be cursor or terminal`);
      }
    }
    return clone(value);
  }
  refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} is not PageIdentityV1`);
}

function prepareNode(value, index) {
  exact(value, ['position', 'classId', 'classVersion', 'nodePlanHash'], `proof.nodes[${index}]`);
  if (value.position !== index) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'proof node positions must be dense');
  boundedId(value.classId, `proof.nodes[${index}].classId`);
  safeInteger(value.classVersion, `proof.nodes[${index}].classVersion`, { positive: true });
  digest(value.nodePlanHash, `proof.nodes[${index}].nodePlanHash`);
  return clone(value);
}

export function prepareCompletenessProofV1(value) {
  try {
    exact(value, [
      'format', 'materializationKey', 'queryInstanceId', 'activationHash', 'planHash',
      'version', 'authorizationWitnessDigest', 'page', 'nodes', 'batchIdentity',
      'resultDigest', 'proofKeyId', 'signature',
    ], 'proof');
    if (value.format !== 'snapback.completeness-proof.v1' || !QMK.test(value.materializationKey ?? '')) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'proof format or materialization key is invalid');
    }
    safeInteger(value.queryInstanceId, 'proof.queryInstanceId', { positive: true });
    digest(value.activationHash, 'proof.activationHash');
    digest(value.planHash, 'proof.planHash');
    exact(value.version, ['stream', 'commit'], 'proof.version');
    boundedId(value.version.stream, 'proof.version.stream');
    safeInteger(value.version.commit, 'proof.version.commit');
    digest(value.authorizationWitnessDigest, 'proof.authorizationWitnessDigest');
    preparePage(value.page);
    if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'proof.nodes must be non-empty');
    }
    value.nodes.forEach(prepareNode);
    if (!/^sbbi1\.[A-Za-z0-9_-]{22}$/u.test(value.batchIdentity ?? '')) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'proof.batchIdentity is invalid');
    }
    decodeBase64url(value.batchIdentity.slice(6), 16, 'proof.batchIdentity');
    digest(value.resultDigest, 'proof.resultDigest');
    boundedId(value.proofKeyId, 'proof.proofKeyId');
    decodeBase64url(value.signature, 64, 'proof.signature');
    return clone(value);
  } catch (error) {
    if (error?.code) return null;
    return null;
  }
}

function requireProof(value) {
  const proof = prepareCompletenessProofV1(value);
  if (proof === null) refuse('SNAPBACK_COMPLETENESS_PROOF_INVALID', 'proof record is invalid');
  return proof;
}

function prepareRequestedScope(value) {
  if (value?.kind === 'page') {
    exact(value, ['kind', 'input'], 'requestedScope');
    prepareCursorEnd(value.input, 'requestedScope.input');
    return clone(value);
  }
  if (value?.kind === 'page-set') {
    exact(value, ['kind', 'from', 'through'], 'requestedScope');
    if (value.from !== 'first' || value.through !== 'terminal') {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'requested page set must span first through terminal');
    }
    return clone(value);
  }
  refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'requestedScope is invalid');
}

function prepareAuthorityState(value, queryInstanceId = undefined) {
  if (!plain(value)) refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authority state must be an object');
  const state = jsonClone(value, 'authorityState');
  if (state.query_instance_id !== null) {
    safeInteger(state.query_instance_id, 'authorityState.query_instance_id', { positive: true });
  }
  if (queryInstanceId !== undefined && state.query_instance_id !== queryInstanceId) {
    refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authority state instance does not match record');
  }
  if (!['active', 'retiring'].includes(state.query_lifecycle)) {
    refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authority lifecycle is invalid');
  }
  safeInteger(state.authority_generation, 'authorityState.authority_generation');
  safeInteger(state.query_generation, 'authorityState.query_generation');
  if (!['retain', 'quarantine', 'delete'].includes(state.effective_disposition)) {
    refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authority disposition is invalid');
  }
  if (!plain(state.expected_authorization)) {
    refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authority expected authorization is missing');
  }
  boundedId(state.expected_authorization.incarnation, 'authorityState.expected_authorization.incarnation');
  safeInteger(state.expected_authorization.epoch, 'authorityState.expected_authorization.epoch');
  boundedId(state.expected_authorization.version_stream, 'authorityState.expected_authorization.version_stream');
  return state;
}

function prepareProductState(value, authorityState) {
  exact(value, [
    'lifecycle', 'effectiveDisposition', 'freshness', 'requestedScope',
    'requestedVersion', 'attempt', 'heldProofs',
  ], 'productState');
  if (value.lifecycle !== authorityState.query_lifecycle) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'product lifecycle is not the authority projection');
  }
  if (value.effectiveDisposition !== authorityState.effective_disposition) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'product disposition is not the authority projection');
  }
  if (![null, 'current', 'retained'].includes(value.freshness)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'product freshness is invalid');
  }
  prepareRequestedScope(value.requestedScope);
  if (value.requestedVersion !== 'as-of-proof') {
    exact(value.requestedVersion, ['stream', 'commit'], 'productState.requestedVersion');
    boundedId(value.requestedVersion.stream, 'productState.requestedVersion.stream');
    safeInteger(value.requestedVersion.commit, 'productState.requestedVersion.commit');
  }
  if (!['idle', 'pending'].includes(value.attempt)) {
    exact(value.attempt, ['refused'], 'productState.attempt');
    exact(value.attempt.refused, ['code', 'fallback'], 'productState.attempt.refused');
    boundedId(value.attempt.refused.code, 'productState.attempt.refused.code');
    if (value.attempt.refused.fallback !== null) nonempty(value.attempt.refused.fallback, 'productState.attempt.refused.fallback');
  }
  if (!Array.isArray(value.heldProofs) || value.heldProofs.some((proof) => prepareCompletenessProofV1(proof) === null)) {
    refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'product held proofs are invalid');
  }
  return clone(value);
}

function prepareMembership(value, where = 'membership') {
  exact(value, ['localRowHandle', 'materializationKey', 'pageIdentityDigest'], where);
  boundedId(value.localRowHandle, `${where}.localRowHandle`);
  if (!QMK.test(value.materializationKey ?? '')) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where}.materializationKey is invalid`);
  digest(value.pageIdentityDigest, `${where}.pageIdentityDigest`);
  return clone(value);
}

export function preparePageSetManifestV1(value) {
  try {
    exact(value, ['identity', 'orderedProofDigests'], 'pageSet');
    digest(value.identity, 'pageSet.identity');
    if (!Array.isArray(value.orderedProofDigests) || value.orderedProofDigests.length === 0) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'pageSet proof digests must be non-empty');
    }
    value.orderedProofDigests.forEach((entry, index) => digest(entry, `pageSet.orderedProofDigests[${index}]`));
    return clone(value);
  } catch {
    return null;
  }
}

function prepareFragment(value, where = 'fragment') {
  exact(value, ['pageIdentityDigest', 'resultContractHash', 'bytes', 'proof', 'authorizedLeaseHash'], where);
  digest(value.pageIdentityDigest, `${where}.pageIdentityDigest`);
  nonempty(value.resultContractHash, `${where}.resultContractHash`);
  if (!(value.bytes instanceof Uint8Array)) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where}.bytes must be Uint8Array`);
  requireProof(value.proof);
  if (value.authorizedLeaseHash !== null) nonempty(value.authorizedLeaseHash, `${where}.authorizedLeaseHash`);
  return clone(value);
}

function prepareStringArray(value, where) {
  if (!Array.isArray(value)) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', `${where} must be an array`);
  value.forEach((entry, index) => boundedId(entry, `${where}[${index}]`));
  return clone(value);
}

export function prepareMaterializationRecordV1(value) {
  try {
    exact(value, [
      'format', 'address', 'queryInstanceId', 'planHash', 'activationHash', 'argsDigest',
      'authorityPartitionDigest', 'storageProfile', 'productState', 'authorityState',
      'fragments', 'pageSets', 'memberships', 'subscription', 'optimisticLayerIds',
      'outboxEntryIds', 'settlementIds',
    ], 'materialization');
    if (value.format !== 'snapback.materialization-record.v1') {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'materialization format is invalid');
    }
    prepareAddress(value.address);
    safeInteger(value.queryInstanceId, 'materialization.queryInstanceId', { positive: true });
    digest(value.planHash, 'materialization.planHash');
    digest(value.activationHash, 'materialization.activationHash');
    digest(value.argsDigest, 'materialization.argsDigest');
    digest(value.authorityPartitionDigest, 'materialization.authorityPartitionDigest');
    if (!['volatile-online-v1', 'durable-fragments-v1'].includes(value.storageProfile)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'materialization storage profile is invalid');
    }
    const authorityState = prepareAuthorityState(value.authorityState, value.queryInstanceId);
    prepareProductState(value.productState, authorityState);
    if (!Array.isArray(value.fragments)) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'fragments must be an array');
    value.fragments.forEach((fragment, index) => prepareFragment(fragment, `fragments[${index}]`));
    if (!Array.isArray(value.pageSets) || value.pageSets.some((entry) => preparePageSetManifestV1(entry) === null)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'pageSets must be valid manifests');
    }
    if (!Array.isArray(value.memberships)) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'memberships must be an array');
    value.memberships.forEach((entry, index) => prepareMembership(entry, `memberships[${index}]`));
    exact(value.subscription, ['delivery', 'connectionState', 'resumeCredentialDigest'], 'subscription');
    if (!['none', 'live_replace', 'live_delta'].includes(value.subscription.delivery)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'subscription delivery is invalid');
    }
    if (!['inactive', 'connecting', 'live', 'offline', 'resync-required', 'retiring'].includes(value.subscription.connectionState)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'subscription state is invalid');
    }
    if (value.subscription.resumeCredentialDigest !== null) digest(value.subscription.resumeCredentialDigest, 'subscription.resumeCredentialDigest');
    prepareStringArray(value.optimisticLayerIds, 'optimisticLayerIds');
    prepareStringArray(value.outboxEntryIds, 'outboxEntryIds');
    prepareStringArray(value.settlementIds, 'settlementIds');
    return clone(value);
  } catch {
    return null;
  }
}

function requireRecord(value) {
  const record = prepareMaterializationRecordV1(value);
  if (record === null) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'stored materialization record is invalid');
  return record;
}

function encodeRecord(record) {
  const encoded = clone(record);
  for (const fragment of encoded.fragments) {
    fragment.bytes = `u8.${base64UrlNoPad(fragment.bytes)}`;
  }
  return encoded;
}

export function encodeMaterializationRecordV1(value) {
  return encodeRecord(requireRecord(value));
}

function decodeRecord(value) {
  if (!plain(value) || !Array.isArray(value.fragments)) return null;
  const decoded = clone(value);
  for (const fragment of decoded.fragments) {
    if (typeof fragment?.bytes !== 'string' || !fragment.bytes.startsWith('u8.')) return null;
    const spelling = fragment.bytes.slice(3);
    if (!BASE64URL.test(spelling)) return null;
    let bytes;
    try {
      bytes = decodeBase64url(
        spelling,
        Math.floor(spelling.length * 6 / 8),
        'fragment bytes',
      );
    } catch {
      return null;
    }
    if (base64UrlNoPad(bytes) !== spelling) return null;
    fragment.bytes = bytes;
  }
  return prepareMaterializationRecordV1(decoded);
}

export function decodeMaterializationRecordV1(value) {
  return decodeRecord(value);
}

function prepareWitness(value) {
  exact(value, ['format', 'queryInstanceId', 'compositeWitness'], 'authorizationWitness');
  if (value.format !== 'snapback.authorization-witness.v1') {
    refuse('SNAPBACK_COMPLETENESS_PROOF_INVALID', 'authorization witness format is invalid');
  }
  safeInteger(value.queryInstanceId, 'authorizationWitness.queryInstanceId', { positive: true });
  exact(value.compositeWitness, ['authorization', 'data'], 'authorizationWitness.compositeWitness');
  exact(value.compositeWitness.authorization, ['incarnation', 'epoch'], 'authorizationWitness.authorization');
  boundedId(value.compositeWitness.authorization.incarnation, 'authorizationWitness.authorization.incarnation');
  safeInteger(value.compositeWitness.authorization.epoch, 'authorizationWitness.authorization.epoch');
  if (value.compositeWitness.data !== null) {
    exact(value.compositeWitness.data, ['versionStream', 'minCommitVersion'], 'authorizationWitness.data');
    boundedId(value.compositeWitness.data.versionStream, 'authorizationWitness.data.versionStream');
    safeInteger(value.compositeWitness.data.minCommitVersion, 'authorizationWitness.data.minCommitVersion');
  }
  return clone(value);
}

function prepareTrustedActivation(value) {
  exact(value, ['format', 'activation', 'activationHash', 'proofKeys'], 'trustedActivation');
  if (value.format !== 'snapback.trusted-composition-activation.v1') {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'trusted activation format is invalid');
  }
  // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
  // — v1 and v2 are separately closed and hashed; no third format enters
  // proof-key custody through a permissive compatibility path.
  let activationDomain;
  if (!plain(value.activation)) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'activation identity must be an object');
  } else if (value.activation.format === 'snapback.composition-activation.v1') {
    exact(value.activation, [
      'format', 'databaseId', 'deploymentId', 'targetProfileId', 'authMode',
      'expectedGeneration', 'proofKeyManifestDigest',
    ], 'trustedActivation.activation');
    exact(value.activation.expectedGeneration, [
      'schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash',
    ], 'activation.expectedGeneration');
    Object.entries(value.activation.expectedGeneration)
      .forEach(([key, entry]) => nonempty(entry, `activation.expectedGeneration.${key}`));
    activationDomain = 'snapback:composition-activation:v1:';
  } else if (value.activation.format === 'snapback.composition-activation.v2') {
    exact(value.activation, [
      'format', 'databaseId', 'deploymentId', 'targetProfileId', 'authMode',
      'authoredSourceHash', 'mintedGeneration', 'proofKeyManifestDigest',
    ], 'trustedActivation.activation');
    digest(value.activation.authoredSourceHash, 'activation.authoredSourceHash');
    exact(value.activation.mintedGeneration, [
      'schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash',
    ], 'activation.mintedGeneration');
    Object.entries(value.activation.mintedGeneration)
      .forEach(([key, entry]) => nonempty(entry, `activation.mintedGeneration.${key}`));
    activationDomain = 'snapback:composition-activation:v2:';
  } else {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'activation identity format is invalid');
  }
  boundedId(value.activation.databaseId, 'activation.databaseId');
  boundedId(value.activation.deploymentId, 'activation.deploymentId');
  boundedId(value.activation.targetProfileId, 'activation.targetProfileId');
  if (!['dev', 'sessions'].includes(value.activation.authMode)) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'activation auth mode is invalid');
  }
  digest(value.activation.proofKeyManifestDigest, 'activation.proofKeyManifestDigest');
  exact(value.proofKeys, ['format', 'keys'], 'trustedActivation.proofKeys');
  if (value.proofKeys.format !== 'snapback.completeness-proof-keys.v1' || !Array.isArray(value.proofKeys.keys)) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'proof key manifest is invalid');
  }
  let prior = null;
  for (let index = 0; index < value.proofKeys.keys.length; index += 1) {
    const key = value.proofKeys.keys[index];
    exact(key, ['proofKeyId', 'algorithm', 'publicKeyBase64url'], `proofKeys.keys[${index}]`);
    boundedId(key.proofKeyId, `proofKeys.keys[${index}].proofKeyId`);
    if (key.algorithm !== 'Ed25519') refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'proof key algorithm is not Ed25519');
    decodeBase64url(key.publicKeyBase64url, 32, `proofKeys.keys[${index}].publicKeyBase64url`);
    if (prior !== null && compareUtf8(prior, key.proofKeyId) >= 0) {
      refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'proof keys are not ascending and unique');
    }
    prior = key.proofKeyId;
  }
  const manifestDigest = hashRecord('snapback:completeness-proof-keys:v1:', value.proofKeys);
  if (manifestDigest !== value.activation.proofKeyManifestDigest) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'proof key manifest digest does not reproduce');
  }
  const activationHash = hashRecord(activationDomain, value.activation);
  if (activationHash !== value.activationHash) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_INVALID', 'activation hash does not reproduce');
  }
  return clone(value);
}

export function completenessProofDigestV1(proof) {
  return hashRecord('snapback:completeness-proof-digest:v1:', requireProof(proof));
}

export function pageIdentityDigestV1(page) {
  return hashRecord('snapback:page-identity:v1:', preparePage(page));
}

export function resultDigestV1(bytes) {
  if (!(bytes instanceof Uint8Array)) refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'result bytes must be Uint8Array');
  return hashRecord('snapback:established-result:v1:', {
    encodingId: 'established-result-jcs.v1',
    bytesBase64url: base64UrlNoPad(bytes),
  });
}

function proofPreimage(proof) {
  const { signature: _signature, ...unsigned } = proof;
  return concat(utf8.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned));
}

function signatureReceiptId(rawKey, proof) {
  return hex(sha256(concat(
    utf8.encode('snapback:completeness-proof-signature-receipt:v1:'),
    rawKey,
    proofPreimage(proof),
    decodeBase64url(proof.signature, 64, 'proof.signature'),
  )));
}

async function verifySignatureCandidate(proofInput, trustedActivationInput) {
  const proof = requireProof(proofInput);
  const trusted = prepareTrustedActivation(trustedActivationInput);
  const key = trusted.proofKeys.keys.find((candidate) => candidate.proofKeyId === proof.proofKeyId);
  if (!key) return null;
  const rawKey = decodeBase64url(key.publicKeyBase64url, 32, 'proof public key');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    refuse(
      'SNAPBACK_COMPLETENESS_CRYPTO_UNAVAILABLE',
      'proof verification requires WebCrypto Ed25519 support',
    );
  }
  let publicKey;
  try {
    publicKey = await subtle.importKey('raw', rawKey, 'Ed25519', false, ['verify']);
  } catch {
    refuse(
      'SNAPBACK_COMPLETENESS_CRYPTO_UNAVAILABLE',
      'proof verification requires WebCrypto Ed25519 support',
    );
  }
  let verified;
  try {
    verified = await subtle.verify(
      'Ed25519',
      publicKey,
      decodeBase64url(proof.signature, 64, 'proof.signature'),
      proofPreimage(proof),
    );
  } catch {
    verified = false;
  }
  return verified ? signatureReceiptId(rawKey, proof) : null;
}

async function verifySignatureCandidates(candidates) {
  const receipts = new Set();
  for (const { proof, trustedActivation } of candidates) {
    const receipt = await verifySignatureCandidate(proof, trustedActivation);
    if (receipt !== null) receipts.add(receipt);
  }
  return receipts;
}

function validateResultBytes(fragment, context) {
  if (fragment.resultContractHash !== context.resultContractHash) {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment result contract hash does not match the trusted plan');
  }
  let text;
  let value;
  try {
    text = fatalUtf8.decode(fragment.bytes);
    value = JSON.parse(text);
  } catch {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment is not valid UTF-8 JSON');
  }
  let canonical;
  try { canonical = canonicalizeClientValueV1(value); } catch {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment is not an admitted canonical client value');
  }
  if (canonical !== text) refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment bytes are not exact JCS');
  let validation;
  try { validation = compileResultContractValidator(context.resultContract).validate(value); } catch {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'trusted result contract is invalid');
  }
  if (validation?.ok !== true) refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment fails its result contract');
  return value;
}

function validateProof(record, fragment, suppliedProof, context, signatureReceipts) {
  if (context?.publicationAdmitted === false) {
    refuse(
      'SNAPBACK_MATERIALIZATION_AUTHORITY_STALE',
      'authority publication changed before the materialization commit',
    );
  }
  const proof = requireProof(suppliedProof);
  const trusted = prepareTrustedActivation(context?.trustedActivation);
  const witness = prepareWitness(context?.authorizationWitness);
  if (context.authorizationWitnessOwnerProduced !== true) {
    refuse('SNAPBACK_COMPLETENESS_WITNESS_INVALID', 'authorization witness lacks owner provenance');
  }
  if (
    proof.materializationKey !== record.address[2]
    || proof.queryInstanceId !== record.queryInstanceId
    || proof.activationHash !== record.activationHash
    || proof.planHash !== record.planHash
    || proof.activationHash !== trusted.activationHash
    || context.planHash !== record.planHash
    || !same(proof.nodes, context.nodes)
    || pageIdentityDigestV1(proof.page) !== fragment.pageIdentityDigest
  ) refuse('SNAPBACK_COMPLETENESS_BINDING_INVALID', 'proof identity binding does not match the current materialization');
  if (witness.queryInstanceId !== record.queryInstanceId) {
    refuse('SNAPBACK_COMPLETENESS_WITNESS_INVALID', 'authorization witness instance is stale');
  }
  const expected = record.authorityState.expected_authorization;
  if (
    witness.compositeWitness.authorization.incarnation !== expected.incarnation
    || witness.compositeWitness.authorization.epoch !== expected.epoch
  ) refuse('SNAPBACK_COMPLETENESS_WITNESS_INVALID', 'authorization witness pair is stale');
  if (hashRecord('snapback:authorization-witness:v1:', witness) !== proof.authorizationWitnessDigest) {
    refuse('SNAPBACK_COMPLETENESS_WITNESS_INVALID', 'authorization witness digest does not match proof');
  }
  const data = witness.compositeWitness.data;
  if (data !== null && (
    data.versionStream !== expected.version_stream
    ||
    proof.version.stream !== data.versionStream
    || proof.version.commit < data.minCommitVersion
  )) refuse('SNAPBACK_COMPLETENESS_VERSION_INVALID', 'proof is below the authorization witness floor');
  validateResultBytes(fragment, context);
  if (resultDigestV1(fragment.bytes) !== proof.resultDigest) {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'fragment result digest does not match proof');
  }
  const key = trusted.proofKeys.keys.find((candidate) => candidate.proofKeyId === proof.proofKeyId);
  if (!key) refuse('SNAPBACK_COMPLETENESS_TRUST_MISSING', 'proof key is not in the trusted activation');
  const rawKey = decodeBase64url(key.publicKeyBase64url, 32, 'proof public key');
  if (!signatureReceipts?.has(signatureReceiptId(rawKey, proof))) {
    refuse('SNAPBACK_COMPLETENESS_SIGNATURE_INVALID', 'proof signature is invalid');
  }
  if (
    record.productState.freshness === 'retained'
    && !retainedAuthorityValid(context, fragment.authorizedLeaseHash, proof)
  ) {
    refuse(
      'SNAPBACK_COMPLETENESS_LEASE_INVALID',
      'retained fragment lacks exact owner lease custody or a signed public-exact class proof',
    );
  }
  return proof;
}

/** Verify an optional finite-response proof carrier with the same shape,
 * Ed25519/JCS, witness, result, and identity checks used by `commitPage`.
 * Absence is the compatibility path and returns null; a partial or invalid
 * carrier rejects before callers can install any bytes.
 *
 * @ref LLP 0094#llp-0157-finite-carrier-completeness-amendment--2026-08-04
 *   — finite answers reuse the establishment verifier unchanged.
 */
export async function verifyFiniteCompletenessCarrierV1(carrierInput, context) {
  const { verifyFiniteCompletenessCarrierV1: verify } = await import(
    './finite-completeness-carrier.mjs'
  );
  return verify(carrierInput, context, [
    own,
    pageIdentityDigestV1,
    plain,
    preparePageSetManifestV1,
    prepareTrustedActivation,
    prepareWitness,
    refuse,
    requireProof,
    same,
    validatePageSetProofChain,
    validateProof,
    verifySignatureCandidate,
  ]);
}

function proofMatchesRequest(proof, productState) {
  const versionMatches = productState.requestedVersion === 'as-of-proof'
    || (
      proof.version.stream === productState.requestedVersion.stream
      && proof.version.commit === productState.requestedVersion.commit
    );
  if (!versionMatches) return false;
  if (productState.requestedScope.kind === 'page') {
    return same(proof.page.input, productState.requestedScope.input);
  }
  return false;
}

function pageSetMatchesRequest(record, productState) {
  if (productState.requestedScope.kind !== 'page-set') return false;
  const proofByDigest = new Map(record.productState.heldProofs.map((proof) => [
    completenessProofDigestV1(proof), proof,
  ]));
  return record.pageSets.some((manifest) => {
    const proofs = manifest.orderedProofDigests.map((entry) => proofByDigest.get(entry));
    if (proofs.some((entry) => entry === undefined)) return false;
    if (proofs[0].page.input.kind !== 'first') return false;
    if (proofs.at(-1).page.output.kind !== 'terminal') return false;
    if (productState.requestedVersion !== 'as-of-proof' && proofs.some((proof) => (
      proof.version.stream !== productState.requestedVersion.stream
      || proof.version.commit !== productState.requestedVersion.commit
    ))) return false;
    return proofs.slice(0, -1).every((proof, index) => (
      proof.page.output.kind === 'cursor'
      && same(proof.page.output, proofs[index + 1].page.input)
    ));
  });
}

export function deriveCompletenessStatusV1(value) {
  const record = requireRecord(value);
  if (
    record.productState.lifecycle === 'active'
    && record.productState.effectiveDisposition === 'retain'
  ) {
    const matching = record.productState.requestedScope.kind === 'page'
      ? record.productState.heldProofs.some((proof) => proofMatchesRequest(proof, record.productState))
      : pageSetMatchesRequest(record, record.productState);
    if (matching) return 'complete';
  }
  if (plain(record.productState.attempt) && own(record.productState.attempt, 'refused')) {
    const matching = record.productState.requestedScope.kind === 'page'
      ? record.productState.heldProofs.some((proof) => proofMatchesRequest(proof, record.productState))
      : pageSetMatchesRequest(record, record.productState);
    if (!matching) return 'refused';
  }
  return 'unknown';
}

function prepareFence(value) {
  exact(value, ['queryInstanceId', 'authorityGeneration', 'queryGeneration'], 'expectedFence');
  safeInteger(value.queryInstanceId, 'expectedFence.queryInstanceId', { positive: true });
  safeInteger(value.authorityGeneration, 'expectedFence.authorityGeneration');
  safeInteger(value.queryGeneration, 'expectedFence.queryGeneration');
  return clone(value);
}

function fenceOf(record) {
  return {
    queryInstanceId: record.queryInstanceId,
    authorityGeneration: record.authorityState.authority_generation,
    queryGeneration: record.authorityState.query_generation,
  };
}

function assertFence(record, expected) {
  const fence = prepareFence(expected);
  if (!same(fence, fenceOf(record))) {
    refuse('SNAPBACK_MATERIALIZATION_FENCE_STALE', 'materialization fence compare-and-commit failed');
  }
}

function assertActive(record) {
  if (record.productState.lifecycle !== 'active') {
    refuse('SNAPBACK_MATERIALIZATION_RETIRING', 'retiring materializations reject render and writes');
  }
}

function membershipKey(addressKey, membership) {
  return `${addressKey}\u0000${membership.pageIdentityDigest}\u0000${membership.localRowHandle}`;
}

function snapshotFor(record, previousFence = null) {
  if (record === null) {
    return deepFreeze({
      format: 'snapback.materialization-observation.v1',
      present: false,
      generation: previousFence === null ? null : { ...previousFence },
      status: null,
      materialization: null,
    });
  }
  const fence = fenceOf(record);
  const resultContractHashes = [...new Set(
    record.fragments.map((fragment) => fragment.resultContractHash),
  )];
  return deepFreeze({
    format: 'snapback.materialization-observation.v1',
    present: true,
    address: [...record.address],
    queryInstanceId: record.queryInstanceId,
    generation: fence,
    materialization: {
      materializationKey: record.address[2],
      queryInstanceId: record.queryInstanceId,
      planHash: record.planHash,
      activationHash: record.activationHash,
      resultContractHash: resultContractHashes.length === 1
        ? resultContractHashes[0]
        : null,
      authorityPartitionDigest: record.authorityPartitionDigest,
    },
    lifecycle: record.productState.lifecycle,
    effectiveDisposition: record.productState.effectiveDisposition,
    freshness: record.productState.freshness,
    requestedScope: clone(record.productState.requestedScope),
    attempt: plain(record.productState.attempt)
      ? clone(record.productState.attempt)
      : record.productState.attempt,
    status: deriveCompletenessStatusV1(record),
    fragmentCount: record.fragments.length,
    pageSetCount: record.pageSets.length,
    membershipCount: record.memberships.length,
  });
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function projectAuthority(record, authorityState) {
  record.authorityState = authorityState;
  record.productState.lifecycle = authorityState.query_lifecycle;
  record.productState.effectiveDisposition = authorityState.effective_disposition;
}

function removePayload(view, addressKey, record) {
  for (const manifest of record.pageSets) view.pageSets.delete(manifest.identity);
  for (const [key, membership] of view.memberships) {
    if (membership?.materializationKey === record.address[2]) view.memberships.delete(key);
  }
  record.fragments = [];
  record.pageSets = [];
  record.memberships = [];
  record.productState.heldProofs = [];
  record.productState.freshness = null;
  view.materializations.set(addressKey, encodeRecord(record));
}

function addressByteCompare(left, right) {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function payloadProjection(record) {
  return {
    bytes: record.fragments.reduce((sum, fragment) => (
      sum + fragment.bytes.length + jcsBytes(fragment.proof).length
    ), 0)
      + record.pageSets.reduce((sum, manifest) => sum + jcsBytes(manifest).length, 0)
      + record.memberships.reduce((sum, membership) => sum + jcsBytes(membership).length, 0),
    fragments: record.fragments.length,
  };
}

function enforceMaterializationEnvelope(view, committingKey, limits, at) {
  const records = [...view.materializations.entries()].map(([key, stored]) => {
    const record = decodeRecord(stored);
    if (record === null) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'budget scan found an invalid record');
    return { key, record, projection: payloadProjection(record) };
  });
  let bytes = records.reduce((sum, entry) => sum + entry.projection.bytes, 0);
  let fragments = records.reduce((sum, entry) => sum + entry.projection.fragments, 0);
  const over = () => bytes > limits.byteCeiling
    || records.length > limits.recordCeiling
    || fragments > limits.fragmentCeiling;
  if (!over()) return null;
  const committingRecord = records.find((entry) => entry.key === committingKey);
  if (
    committingRecord
    && (committingRecord.projection.bytes > limits.byteCeiling
      || committingRecord.projection.fragments > limits.fragmentCeiling)
  ) {
    removePayload(view, committingRecord.key, committingRecord.record);
    return materializationError(
      'SNAPBACK_MATERIALIZATION_BUDGET_EXCEEDED',
      'single materialization payload exceeds its envelope',
      { byteCeiling: limits.byteCeiling, fragmentCeiling: limits.fragmentCeiling },
    );
  }
  const policyRoot = plain(view.storeMeta.policyBudgetFacts?.addresses)
    ? view.storeMeta.policyBudgetFacts.addresses : {};
  const candidates = [];
  for (const entry of records) {
    const fact = policyRoot[entry.record.address[2]] ?? {};
    const current = fact.currentPolicy ?? {
      demandState: 'undemanded', idleTtlClass: 'none', retentionRequest: 'none',
    };
    if (
      current.demandState === 'demanded-active'
      || entry.record.productState.lifecycle !== 'active'
      || entry.record.productState.effectiveDisposition !== 'retain'
      || entry.projection.bytes === 0
      || entry.record.outboxEntryIds.length > 0
      || entry.record.settlementIds.length > 0
      || (fact.blockers?.length ?? 0) > 0
    ) continue;
    let step;
    let primary;
    if (current.demandState === 'undemanded' && fact.pinnedIdleTtlClass !== 'pinned') {
      step = 1; primary = fact.releaseAt ?? Number.MAX_SAFE_INTEGER;
    } else if (current.demandState === 'demanded-idle' && current.idleTtlClass !== 'pinned') {
      step = 2; primary = fact.lastEstablishmentAt ?? 0;
    } else if (fact.pinnedIdleTtlClass === 'pinned' || current.idleTtlClass === 'pinned') {
      step = 3; primary = fact.lastEstablishmentAt ?? 0;
    } else continue;
    candidates.push({ ...entry, step, primary });
  }
  candidates.sort((a, b) => a.step - b.step
    || a.primary - b.primary
    || addressByteCompare(a.record.address[2], b.record.address[2]));
  for (const candidate of candidates) {
    if (!over()) break;
    removePayload(view, candidate.key, candidate.record);
    bytes -= candidate.projection.bytes;
    fragments -= candidate.projection.fragments;
    if (!plain(view.storeMeta.policyBudgetFacts)) view.storeMeta.policyBudgetFacts = {};
    const root = view.storeMeta.policyBudgetFacts;
    root.compactionCount = (Number.isSafeInteger(root.compactionCount) ? root.compactionCount : 0) + 1;
    root.lastCompactionAt = at;
  }
  if (!over()) return null;
  const committing = records.find((entry) => entry.key === committingKey);
  if (committing?.projection.bytes > 0) removePayload(view, committing.key, committing.record);
  return materializationError(
    'SNAPBACK_MATERIALIZATION_BUDGET_EXCEEDED',
    'materialization commit cannot fit without compacting demanded-active or blocker-held custody',
    { byteCeiling: limits.byteCeiling, recordCeiling: limits.recordCeiling, fragmentCeiling: limits.fragmentCeiling },
  );
}

function applyOwnerInput(view, addressKey, record, input) {
  if (!plain(input) || !plain(input.authorityState)) {
    refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'authorization transition must carry owner state');
  }
  const next = prepareAuthorityState(input.authorityState, record.queryInstanceId);
  const current = record.authorityState;
  if (
    next.authority_generation < current.authority_generation
    || next.query_generation < current.query_generation
    || (
      next.authority_generation === current.authority_generation
      && next.query_generation === current.query_generation
      && !same(next, current)
    )
  ) refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'owner transition does not advance its fence');
  projectAuthority(record, next);
  if (next.effective_disposition === 'delete') {
    if (!own(input, 'tombstone')) {
      refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'delete transition must supply its owner tombstone');
    }
    removePayload(view, addressKey, record);
    view.storeMeta.tombstoneHighWaters[addressKey] = jsonClone(input.tombstone, 'owner tombstone');
    if (input.removeRegistrationSlots !== false) {
      delete view.storeMeta.durableRegistrations[addressKey];
    }
  } else {
    view.materializations.set(addressKey, encodeRecord(record));
  }
  view.storeMeta.generationCounters.authorityGenerationHighWater = Math.max(
    view.storeMeta.generationCounters.authorityGenerationHighWater,
    next.authority_generation,
  );
  view.storeMeta.generationCounters.queryGenerationHighWater = Math.max(
    view.storeMeta.generationCounters.queryGenerationHighWater,
    next.query_generation,
  );
  return record;
}

function requireContext(resolveValidationContext, address, record, phase) {
  const context = resolveValidationContext?.({ address: clone(address), record: clone(record), phase });
  if (!plain(context)) refuse('SNAPBACK_COMPLETENESS_TRUST_MISSING', 'validation context is unavailable');
  return context;
}

const INDEPENDENT_RETENTION_AUTHORITY = 'rqs-authority-independent-snapshot-v1';

function retainedAuthorityValid(
  context,
  fragmentAuthorizedLeaseHash = undefined,
  ownerProof = undefined,
) {
  if (context.retentionAuthority === INDEPENDENT_RETENTION_AUTHORITY) {
    const custodyMatches = context.leaseStatus === 'not-required'
      && context.authorizedLeaseHash === null
      && (fragmentAuthorizedLeaseHash === undefined || fragmentAuthorizedLeaseHash === null);
    // Calls without a concrete fragment/proof are preliminary maintenance
    // gates; validateProof performs the authoritative decision for every byte
    // before commit or render. Once a proof is present, no-lease retention is
    // admitted only by the owner's signed exact single-table class, never by
    // caller-carried classification bytes alone.
    if (!custodyMatches || ownerProof === undefined) return custodyMatches;
    return Array.isArray(ownerProof.nodes)
      && ownerProof.nodes.length === 1
      && ownerProof.nodes[0]?.position === 0
      && ownerProof.nodes[0]?.classId === 'single_table_v1'
      && ownerProof.nodes[0]?.classVersion === 1;
  }
  return context.leaseStatus === 'valid'
    && (
      fragmentAuthorizedLeaseHash === undefined
      || context.authorizedLeaseHash === fragmentAuthorizedLeaseHash
    );
}

function validatePageSetProofChain(proofs, manifest) {
  const first = proofs[0];
  const shared = {
    materializationKey: first.materializationKey,
    activationHash: first.activationHash,
    planHash: first.planHash,
    version: first.version,
    authorizationWitnessDigest: first.authorizationWitnessDigest,
    nodes: first.nodes,
  };
  if (first.page.input.kind !== 'first' || proofs.at(-1).page.output.kind !== 'terminal') {
    refuse('SNAPBACK_PAGE_SET_INVALID', 'page set must span first through terminal');
  }
  for (let index = 0; index < proofs.length; index += 1) {
    const proof = proofs[index];
    if (
      proof.materializationKey !== shared.materializationKey
      || proof.activationHash !== shared.activationHash
      || proof.planHash !== shared.planHash
      || !same(proof.version, shared.version)
      || proof.authorizationWitnessDigest !== shared.authorizationWitnessDigest
      || !same(proof.nodes, shared.nodes)
      || completenessProofDigestV1(proof) !== manifest.orderedProofDigests[index]
    ) refuse('SNAPBACK_PAGE_SET_INVALID', 'page set proofs do not share one identity/version');
    if (index < proofs.length - 1 && (
      proof.page.output.kind !== 'cursor'
      || !same(proof.page.output, proofs[index + 1].page.input)
    )) refuse('SNAPBACK_PAGE_SET_INVALID', 'page set cursor chain is discontinuous');
  }
  const identityRecord = {
    format: 'snapback.page-set.v1',
    materializationKey: shared.materializationKey,
    activationHash: shared.activationHash,
    planHash: shared.planHash,
    version: shared.version,
    authorizationWitnessDigest: shared.authorizationWitnessDigest,
    orderedProofDigests: manifest.orderedProofDigests,
  };
  if (hashRecord('snapback:page-set:v1:', identityRecord) !== manifest.identity) {
    refuse('SNAPBACK_PAGE_SET_INVALID', 'page set identity does not reproduce');
  }
}

function validatePageSet(record, manifest, context, signatureReceipts) {
  const fragments = new Map(record.fragments.map((fragment) => [
    completenessProofDigestV1(fragment.proof), fragment,
  ]));
  const ordered = manifest.orderedProofDigests.map((entry) => fragments.get(entry));
  if (ordered.some((entry) => entry === undefined)) {
    refuse('SNAPBACK_PAGE_SET_INVALID', 'page set references an absent fragment proof');
  }
  for (const fragment of ordered) {
    validateProof(record, fragment, fragment.proof, context, signatureReceipts);
  }
  validatePageSetProofChain(ordered.map((fragment) => fragment.proof), manifest);
}

function discardCorruptFragment(view, key, record, fragment) {
  record.fragments = record.fragments.filter((entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest);
  record.productState.heldProofs = record.productState.heldProofs.filter((proof) => (
    pageIdentityDigestV1(proof.page) !== fragment.pageIdentityDigest
  ));
  record.memberships = record.memberships.filter((entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest);
  for (const [membershipKeyValue, membership] of view.memberships) {
    if (
      membership?.materializationKey === record.address[2]
      && membership?.pageIdentityDigest === fragment.pageIdentityDigest
    ) view.memberships.delete(membershipKeyValue);
  }
  let proofDigest = null;
  try { proofDigest = completenessProofDigestV1(fragment.proof); } catch { /* corrupt shape */ }
  for (const manifest of record.pageSets) {
    if (proofDigest === null || manifest.orderedProofDigests.includes(proofDigest)) {
      view.pageSets.delete(manifest.identity);
    }
  }
  record.pageSets = record.pageSets.filter((manifest) => (
    proofDigest !== null && !manifest.orderedProofDigests.includes(proofDigest)
  ));
  record.productState.freshness = record.fragments.length === 0 ? null : record.productState.freshness;
  view.materializations.set(key, encodeRecord(record));
}

function witnessFailureReason(record, context) {
  const expected = record.authorityState.expected_authorization;
  const witness = context.authorizationWitness;
  return witness?.compositeWitness?.authorization?.incarnation === expected.incarnation
    && witness?.compositeWitness?.data?.versionStream === expected.version_stream
    && witness?.compositeWitness?.authorization?.epoch > expected.epoch
    ? 'witness-newer-epoch'
    : 'witness-invalid';
}

function revalidateRetainedRecord(
  view,
  key,
  record,
  resolveValidationContext,
  phase,
  signatureReceipts,
) {
  let context = null;
  try {
    context = resolveValidationContext?.({
      address: clone(record.address),
      record: clone(record),
      phase,
    }) ?? null;
  } catch {
    context = null;
  }
  if (!plain(context) || context.trustedActivation === null || context.retentionEligible === false) {
    record.productState.heldProofs = [];
    view.materializations.set(key, encodeRecord(record));
    return { record, changed: true };
  }
  let trusted;
  try { trusted = prepareTrustedActivation(context.trustedActivation); } catch {
    record.productState.heldProofs = [];
    view.materializations.set(key, encodeRecord(record));
    return { record, changed: true };
  }
  if (trusted.activationHash !== record.activationHash) {
    const input = context.ownerTransitionForRetainedFailure?.('activation-mismatch', clone(record));
    return { record: applyOwnerInput(view, key, record, input), changed: true };
  }
  if (!retainedAuthorityValid(context)) {
    const input = context.ownerTransitionForRetainedFailure?.('lease-invalid', clone(record));
    return { record: applyOwnerInput(view, key, record, input), changed: true };
  }
  let changed = false;
  for (const proof of [...record.productState.heldProofs]) {
    const pageDigest = pageIdentityDigestV1(proof.page);
    const fragment = record.fragments.find((entry) => entry.pageIdentityDigest === pageDigest);
    if (!fragment) {
      record.productState.heldProofs = record.productState.heldProofs.filter((entry) => entry !== proof);
      view.materializations.set(key, encodeRecord(record));
      changed = true;
      continue;
    }
    try {
      validateProof(record, fragment, fragment.proof, context, signatureReceipts);
    } catch (error) {
      if (error?.code === 'SNAPBACK_COMPLETENESS_WITNESS_INVALID') {
        const input = context.ownerTransitionForRetainedFailure?.(
          witnessFailureReason(record, context),
          clone(record),
        );
        return { record: applyOwnerInput(view, key, record, input), changed: true };
      }
      discardCorruptFragment(view, key, record, fragment);
      changed = true;
    }
  }
  for (const manifest of [...record.pageSets]) {
    try {
      validatePageSet(record, manifest, context, signatureReceipts);
    } catch {
      record.pageSets = record.pageSets.filter((entry) => entry.identity !== manifest.identity);
      view.pageSets.delete(manifest.identity);
      view.materializations.set(key, encodeRecord(record));
      changed = true;
    }
  }
  return { record, changed };
}

// @ref LLP 0157#d7--the-move-2-store-interface — all semantic writes ride one
// exact v3 carrier transaction and publish only after that transaction commits.
export async function createMaterializationStore(storeHandle, {
  resolveValidationContext = null,
  resolveRetirementTransition = null,
  policyLimits = null,
  now = () => Date.now(),
} = {}) {
  if (typeof storeHandle?.materializationTransaction !== 'function') {
    throw new TypeError('materialization store requires a v3 RQS store handle');
  }
  const materializationRuntime = await import('./materialization-store-runtime.mjs');
  const listeners = new Map();
  const cache = new Map();
  const materializationLimits = Object.freeze({
    ...DEFAULT_MATERIALIZATION_LIMITS,
    ...(policyLimits ?? {}),
  });

  const loadFrom = (view, key) => {
    const stored = view.materializations.get(key);
    if (stored === undefined) return null;
    const record = decodeRecord(stored);
    if (record === null) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'stored materialization is invalid');
    return record;
  };

  const bootSignatureReceipts = await materializationRuntime.bootMaterializationStore([
    storeHandle,
    loadFrom,
    resolveValidationContext,
    clone,
    plain,
    prepareTrustedActivation,
    verifySignatureCandidates,
    decodeRecord,
    refuse,
    removePayload,
    revalidateRetainedRecord,
    cache,
    snapshotFor,
  ]);

  const publish = (key, snapshot) => {
    cache.set(key, snapshot);
    for (const listener of [...(listeners.get(key) ?? [])]) {
      try { listener(snapshot); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  };

  // @ref LLP 0157#d7--the-move-2-store-interface — WebCrypto verification is
  // asynchronous while every carrier transaction callback is deliberately
  // synchronous. Preflight receipts bind the exact key/message/signature;
  // the committing callback recomputes that receipt after rechecking the
  // current fence and owner context, before publishing one atomic successor.
  const preverifyAddressProofs = async (address, phase, selectProofs) => {
    const admittedAddress = prepareAddress(address);
    const key = jcs(admittedAddress);
    const candidates = await storeHandle.materializationTransaction('readonly', (view) => {
      const record = loadFrom(view, key);
      if (record === null) return [];
      const proofs = selectProofs(record);
      if (proofs.length === 0) return [];
      const context = requireContext(resolveValidationContext, admittedAddress, record, phase);
      return proofs.map((proof) => ({ proof, trustedActivation: context.trustedActivation }));
    });
    return verifySignatureCandidates(candidates);
  };

  const write = async (address, operation) => {
    const admittedAddress = prepareAddress(address);
    const key = jcs(admittedAddress);
    const result = await storeHandle.materializationTransaction('readwrite', (view) => (
      operation(view, key, admittedAddress)
    ));
    if (result?.snapshot) publish(key, result.snapshot);
    if (result?.error) throw result.error;
    return result?.value;
  };

  const initialize = async (address, identities, authorityBarrierReceipt = null) => write(
    address,
    (view, key, admittedAddress) => {
      const existing = loadFrom(view, key);
      if (existing !== null) {
        for (const field of ['planHash', 'activationHash', 'argsDigest', 'authorityPartitionDigest', 'storageProfile']) {
          if (existing[field] !== identities?.[field]) {
            refuse('SNAPBACK_MATERIALIZATION_IDENTITY_MISMATCH', `initialize cannot mutate ${field} in place`);
          }
        }
        return { value: clone(existing) };
      }
      if (view.materializations.size >= materializationLimits.recordCeiling) {
        return { error: materializationError(
          'SNAPBACK_MATERIALIZATION_BUDGET_EXCEEDED',
          'materialization record ceiling is full',
          { recordCeiling: materializationLimits.recordCeiling },
        ) };
      }
      exact(identities, [
        'planHash', 'activationHash', 'argsDigest', 'authorityPartitionDigest',
        'storageProfile', 'authorityState',
      ], 'identities');
      digest(identities.planHash, 'identities.planHash');
      digest(identities.activationHash, 'identities.activationHash');
      digest(identities.argsDigest, 'identities.argsDigest');
      digest(identities.authorityPartitionDigest, 'identities.authorityPartitionDigest');
      if (!['volatile-online-v1', 'durable-fragments-v1'].includes(identities.storageProfile)) {
        refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'identities.storageProfile is invalid');
      }
      if (
        identities.storageProfile === 'durable-fragments-v1'
        && storeHandle.durability?.().durable !== true
      ) {
        refuse(
          'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP',
          'carrier does not implement durable_fragments_v1',
          { requiredCapability: 'durable_fragments_v1' },
        );
      }
      const successorBarriers = Object.values(view.storeMeta.barrierHighWaters).filter((entry) => (
        plain(entry)
        && entry.status === 'complete'
        && entry.successor === identities.authorityPartitionDigest
      ));
      if (successorBarriers.length > 0 && authorityBarrierReceipt === null) {
        refuse(
          'SNAPBACK_STORE_AUTHORITY_BARRIER_REQUIRED',
          'rotated authority partition requires its durable barrier receipt',
        );
      }
      if (authorityBarrierReceipt !== null) {
        if (!plain(authorityBarrierReceipt)) {
          refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_REQUIRED', 'authority barrier receipt is invalid');
        }
        const durable = Object.values(view.storeMeta.barrierHighWaters).find((entry) => (
          plain(entry)
          && entry.status === 'complete'
          && entry.successor === identities.authorityPartitionDigest
          && same(entry.receipt, authorityBarrierReceipt)
        ));
        if (!durable) {
          refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_REQUIRED', 'authority barrier receipt is not durably published');
        }
      }
      const allocated = allocateQueryInstanceIdInMeta(view.storeMeta);
      if (allocated === null) refuse('SNAPBACK_RQS_STORE_CORRUPT', 'store metadata is invalid');
      view.storeMeta = allocated.meta;
      const authorityState = prepareAuthorityState(identities.authorityState);
      if (authorityState.query_instance_id !== null) {
        refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'new authority state must leave instance allocation to the store');
      }
      authorityState.query_instance_id = allocated.queryInstanceId;
      if (authorityState.query_lifecycle !== 'active' || authorityState.effective_disposition !== 'retain') {
        refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'new authority state must initialize active/retain');
      }
      const record = {
        format: 'snapback.materialization-record.v1',
        address: admittedAddress,
        queryInstanceId: allocated.queryInstanceId,
        planHash: identities.planHash,
        activationHash: identities.activationHash,
        argsDigest: identities.argsDigest,
        authorityPartitionDigest: identities.authorityPartitionDigest,
        storageProfile: identities.storageProfile,
        productState: {
          lifecycle: 'active',
          effectiveDisposition: 'retain',
          freshness: null,
          requestedScope: { kind: 'page', input: { kind: 'first' } },
          requestedVersion: 'as-of-proof',
          attempt: 'idle',
          heldProofs: [],
        },
        authorityState,
        fragments: [],
        pageSets: [],
        memberships: [],
        subscription: { delivery: 'none', connectionState: 'inactive', resumeCredentialDigest: null },
        optimisticLayerIds: [],
        outboxEntryIds: [],
        settlementIds: [],
      };
      view.materializations.set(key, encodeRecord(requireRecord(record)));
      return { value: clone(record), snapshot: snapshotFor(record) };
    },
  );

  const beginEstablishment = async (address, requestedScope, expectedFence) => write(
    address,
    (view, key) => {
      const record = loadFrom(view, key);
      if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'establishment cannot allocate an instance');
      assertActive(record);
      assertFence(record, expectedFence);
      record.productState.requestedScope = prepareRequestedScope(requestedScope);
      record.productState.attempt = 'pending';
      view.materializations.set(key, encodeRecord(record));
      return { value: clone(record), snapshot: snapshotFor(record) };
    },
  );

  const commitPageInView = (
    view,
    key,
    admittedAddress,
    fragmentInput,
    proofInput,
    resolutionBundle,
    expectedFence,
    signatureReceipts,
  ) => {
    return materializationRuntime.commitPageInView([
      view,
      key,
      admittedAddress,
      fragmentInput,
      proofInput,
      resolutionBundle,
      expectedFence,
      signatureReceipts,
      loadFrom,
      refuse,
      assertActive,
      assertFence,
      exact,
      prepareFragment,
      requireContext,
      resolveValidationContext,
      retainedAuthorityValid,
      validateProof,
      prepareMembership,
      applyOwnerInput,
      clone,
      snapshotFor,
      membershipKey,
      pageIdentityDigestV1,
      projectAuthority,
      encodeRecord,
      enforceMaterializationEnvelope,
      materializationLimits,
      now,
    ]);
    const record = loadFrom(view, key);
    if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'page commit cannot allocate an instance');
    assertActive(record);
    assertFence(record, expectedFence);
    exact(fragmentInput, [
      'pageIdentityDigest', 'resultContractHash', 'bytes', 'authorizedLeaseHash',
      'memberships', 'freshness',
    ], 'fragment input');
    if (!['current', 'retained'].includes(fragmentInput.freshness)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'fragment freshness is invalid');
    }
    if (fragmentInput.freshness === 'retained' && record.storageProfile !== 'durable-fragments-v1') {
      refuse(
        'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP',
        'volatile-online-v1 cannot install retained payload',
        { requiredCapability: 'durable_fragments_v1' },
      );
    }
    if (!Array.isArray(fragmentInput.memberships)) {
      refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'fragment memberships must be an array');
    }
    const fragment = prepareFragment({
      pageIdentityDigest: fragmentInput.pageIdentityDigest,
      resultContractHash: fragmentInput.resultContractHash,
      bytes: fragmentInput.bytes,
      proof: proofInput,
      authorizedLeaseHash: fragmentInput.authorizedLeaseHash,
    });
    const context = requireContext(resolveValidationContext, admittedAddress, record, 'commit');
    fragment.proof = validateProof(record, fragment, proofInput, context, signatureReceipts);
    if (
      fragmentInput.freshness === 'retained'
      && !retainedAuthorityValid(
        context,
        fragmentInput.authorizedLeaseHash,
        fragment.proof,
      )
    ) {
      refuse(
        'SNAPBACK_COMPLETENESS_LEASE_INVALID',
        'retained commit lacks exact owner lease custody or a signed public-exact class proof',
      );
    }
    const memberships = fragmentInput.memberships.map((entry, index) => prepareMembership(entry, `fragment.memberships[${index}]`));
    for (const membership of memberships) {
      if (
        membership.materializationKey !== record.address[2]
        || membership.pageIdentityDigest !== fragment.pageIdentityDigest
      ) refuse('SNAPBACK_MATERIALIZATION_RECORD_INVALID', 'membership does not bind the committed page');
    }
    if (resolutionBundle !== null) applyOwnerInput(view, key, record, resolutionBundle);
    if (record.authorityState.effective_disposition === 'delete') {
      return { value: clone(record), snapshot: snapshotFor(record) };
    }
    record.fragments = record.fragments.filter((entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest);
    record.fragments.push(fragment);
    record.memberships = record.memberships.filter((entry) => entry.pageIdentityDigest !== fragment.pageIdentityDigest);
    for (const [membershipKeyValue, entry] of view.memberships) {
      if (
        entry?.materializationKey === record.address[2]
        && entry?.pageIdentityDigest === fragment.pageIdentityDigest
      ) view.memberships.delete(membershipKeyValue);
    }
    for (const membership of memberships) {
      record.memberships.push(membership);
      view.memberships.set(membershipKey(key, membership), clone(membership));
    }
    record.productState.heldProofs = record.productState.heldProofs.filter((entry) => (
      pageIdentityDigestV1(entry.page) !== fragment.pageIdentityDigest
    ));
    record.productState.heldProofs.push(fragment.proof);
    record.productState.freshness = fragmentInput.freshness;
    record.productState.attempt = 'idle';
    projectAuthority(record, record.authorityState);
    view.materializations.set(key, encodeRecord(record));
    const budgetError = enforceMaterializationEnvelope(view, key, materializationLimits, now());
    const storedAfterBudget = loadFrom(view, key);
    return budgetError
      ? { error: budgetError, snapshot: snapshotFor(storedAfterBudget) }
      : { value: clone(storedAfterBudget), snapshot: snapshotFor(storedAfterBudget) };
  };

  const commitPage = async (
    address,
    fragmentInput,
    proofInput,
    resolutionBundle,
    expectedFence,
  ) => {
    const signatureReceipts = await preverifyAddressProofs(address, 'commit', (record) => {
      assertActive(record);
      assertFence(record, expectedFence);
      return [proofInput];
    });
    return write(address, (view, key, admittedAddress) => commitPageInView(
      view,
      key,
      admittedAddress,
      fragmentInput,
      proofInput,
      resolutionBundle,
      expectedFence,
      signatureReceipts,
    ));
  };

  // The sole staged-migration writer: validate the exact legacy record, the
  // empty-outbox precondition, the QMK proof/result, and the current fence in
  // one carrier transaction; only then delete the legacy alias.
  // @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — there is
  // no interval in which both records are renderable and no crash cut after
  // legacy deletion but before proof-validated QMK publication.
  const commitLegacyAdoption = async (
    address,
    legacyKey,
    expectedLegacyRecord,
    fragmentInput,
    proofInput,
    resolutionBundle,
    expectedFence,
  ) => {
    return materializationRuntime.commitLegacyAdoption([
      address,
      legacyKey,
      expectedLegacyRecord,
      fragmentInput,
      proofInput,
      resolutionBundle,
      expectedFence,
      preverifyAddressProofs,
      assertActive,
      assertFence,
      write,
      refuse,
      same,
      commitPageInView,
    ]);
    if (typeof legacyKey !== 'string' || legacyKey.length === 0) {
      refuse('SNAPBACK_SINGLE_TABLE_ADOPTION_LEGACY_MISMATCH', 'legacy adoption key is invalid');
    }
    const signatureReceipts = await preverifyAddressProofs(address, 'commit', (record) => {
      assertActive(record);
      assertFence(record, expectedFence);
      return [proofInput];
    });
    return write(address, (view, key, admittedAddress) => {
      if (!(view.entries instanceof Map)) {
        refuse('SNAPBACK_SINGLE_TABLE_ADOPTION_DOMAIN_UNAVAILABLE', 'carrier omits legacy entries from the materialization transaction');
      }
      let pending;
      try { pending = pendingOutboxRecords(view.outbox); } catch { pending = [null]; }
      if (pending.length > 0) {
        refuse(
          'SNAPBACK_SINGLE_TABLE_ADOPTION_PENDING_OUTBOX',
          'legacy adoption waits for the durable mutation outbox to settle',
        );
      }
      const currentLegacyRecord = view.entries.get(legacyKey);
      if (currentLegacyRecord === undefined || !same(currentLegacyRecord, expectedLegacyRecord)) {
        refuse(
          'SNAPBACK_SINGLE_TABLE_ADOPTION_LEGACY_MISMATCH',
          'legacy adoption candidate changed before the atomic switch',
        );
      }
      const committed = commitPageInView(
        view,
        key,
        admittedAddress,
        fragmentInput,
        proofInput,
        resolutionBundle,
        expectedFence,
        signatureReceipts,
      );
      if (committed.error) throw committed.error;
      view.entries.delete(legacyKey);
      return committed;
    });
  };

  const commitPageSet = async (address, set, expectedFence) => {
    const signatureReceipts = await preverifyAddressProofs(address, 'commit-page-set', (record) => {
      assertActive(record);
      assertFence(record, expectedFence);
      const manifest = preparePageSetManifestV1(set);
      if (manifest === null) refuse('SNAPBACK_PAGE_SET_INVALID', 'page-set manifest is invalid');
      const fragments = new Map(record.fragments.map((fragment) => [
        completenessProofDigestV1(fragment.proof), fragment,
      ]));
      const ordered = manifest.orderedProofDigests.map((entry) => fragments.get(entry));
      if (ordered.some((entry) => entry === undefined)) {
        refuse('SNAPBACK_PAGE_SET_INVALID', 'page set references an absent fragment proof');
      }
      return ordered.map((fragment) => fragment.proof);
    });
    return write(address, (view, key, admittedAddress) => {
      const record = loadFrom(view, key);
      if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'page-set commit cannot allocate an instance');
      assertActive(record);
      assertFence(record, expectedFence);
      const manifest = preparePageSetManifestV1(set);
      if (manifest === null) refuse('SNAPBACK_PAGE_SET_INVALID', 'page-set manifest is invalid');
      const context = requireContext(resolveValidationContext, admittedAddress, record, 'commit-page-set');
      validatePageSet(record, manifest, context, signatureReceipts);
      record.pageSets = record.pageSets.filter((entry) => entry.identity !== manifest.identity);
      record.pageSets.push(manifest);
      record.productState.attempt = 'idle';
      view.pageSets.set(manifest.identity, clone(manifest));
      view.materializations.set(key, encodeRecord(record));
      const budgetError = enforceMaterializationEnvelope(view, key, materializationLimits, now());
      const storedAfterBudget = loadFrom(view, key);
      return budgetError
        ? { error: budgetError, snapshot: snapshotFor(storedAfterBudget) }
        : { value: clone(storedAfterBudget), snapshot: snapshotFor(storedAfterBudget) };
    });
  };

  const recordAttemptOutcome = async (address, outcome, expectedFence) => write(
    address,
    (view, key) => {
      const record = loadFrom(view, key);
      if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'attempt outcome cannot allocate an instance');
      assertActive(record);
      assertFence(record, expectedFence);
      if (outcome?.kind === 'transient') {
        exact(outcome, ['kind'], 'attempt outcome');
        record.productState.attempt = 'idle';
      } else if (outcome?.kind === 'refused') {
        exact(outcome, ['kind', 'code', 'fallback'], 'attempt outcome');
        boundedId(outcome.code, 'attempt outcome code');
        if (outcome.fallback !== null) nonempty(outcome.fallback, 'attempt outcome fallback');
        record.productState.attempt = { refused: { code: outcome.code, fallback: outcome.fallback } };
      } else {
        refuse('SNAPBACK_MATERIALIZATION_EVENT_INVALID', 'attempt outcome is outside the closed transition vocabulary');
      }
      view.materializations.set(key, encodeRecord(record));
      return { value: clone(record), snapshot: snapshotFor(record) };
    },
  );

  const applyAuthorizationTransition = async (address, obligationOrResolution) => write(
    address,
    (view, key) => {
      const record = loadFrom(view, key);
      if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'authorization transition has no current instance');
      if (plain(obligationOrResolution?.authorityState) && same(
        obligationOrResolution.authorityState,
        record.authorityState,
      )) return { value: clone(record) };
      const next = applyOwnerInput(view, key, record, obligationOrResolution);
      return { value: clone(next), snapshot: snapshotFor(next) };
    },
  );

  const applyStoreAuthorityBarrier = async (
    clientStoreId,
    predecessor,
    successor,
    transition,
  ) => {
    boundedId(clientStoreId, 'clientStoreId');
    digest(predecessor, 'predecessor authority partition');
    digest(successor, 'successor authority partition');
    if (!plain(transition) || !Array.isArray(transition.records)) {
      refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'barrier transition must carry owner decisions');
    }
    boundedId(transition.barrierId, 'barrierId');
    safeInteger(transition.authorityGeneration, 'barrier authorityGeneration');
    if (!plain(transition.receipt)) {
      refuse('SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID', 'barrier transition must carry an owner receipt');
    }
    const publications = [];
    const value = await storeHandle.materializationTransaction('readwrite', (view) => {
      if (view.storeMeta.clientStoreId !== clientStoreId) {
        refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_INVALID', 'barrier clientStoreId does not match store');
      }
      const priorBarrier = view.storeMeta.barrierHighWaters[transition.barrierId];
      if (plain(priorBarrier) && priorBarrier.status === 'complete') {
        if (
          priorBarrier.predecessor === predecessor
          && priorBarrier.successor === successor
          && priorBarrier.authorityGeneration === transition.authorityGeneration
          && same(priorBarrier.receipt, transition.receipt)
        ) return clone(priorBarrier.receipt);
        refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_INVALID', 'barrier id is already bound to another transition');
      }
      const decisions = new Map(transition.records.map((entry) => [materializationAddressKey(entry.address), entry]));
      const predecessors = [];
      for (const [key] of view.materializations) {
        const record = loadFrom(view, key);
        if (record.authorityPartitionDigest === predecessor) predecessors.push([key, record]);
      }
      for (const [key, record] of predecessors) {
        const decision = decisions.get(key);
        if (!decision) refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_INCOMPLETE', 'barrier omits a predecessor address');
        if (decision.authorityState?.authority_generation !== transition.authorityGeneration) {
          refuse(
            'SNAPBACK_STORE_AUTHORITY_BARRIER_INVALID',
            'every predecessor owner state must carry the barrier authority generation',
          );
        }
        const next = applyOwnerInput(view, key, record, decision);
        publications.push([key, snapshotFor(next)]);
      }
      if (transition.records.some((entry) => !predecessors.some(([key]) => key === materializationAddressKey(entry.address)))) {
        refuse('SNAPBACK_STORE_AUTHORITY_BARRIER_INVALID', 'barrier decision names a non-predecessor address');
      }
      view.storeMeta.generationCounters.authorityGenerationHighWater = Math.max(
        view.storeMeta.generationCounters.authorityGenerationHighWater,
        transition.authorityGeneration,
      );
      view.storeMeta.barrierHighWaters[transition.barrierId] = {
        status: 'complete',
        predecessor,
        successor,
        authorityGeneration: transition.authorityGeneration,
        receipt: clone(transition.receipt),
      };
      return clone(transition.receipt);
    });
    for (const [key, snapshot] of publications) publish(key, snapshot);
    return value;
  };

  const readRenderable = async (address, expectedFence) => {
    const admittedAddress = prepareAddress(address);
    const key = jcs(admittedAddress);
    const signatureCandidates = await storeHandle.materializationTransaction('readonly', (view) => {
      const record = loadFrom(view, key);
      if (record === null || !same(fenceOf(record), prepareFence(expectedFence))) return [];
      if (
        record.productState.freshness !== 'retained'
        && (
          record.productState.lifecycle !== 'active'
          || record.productState.effectiveDisposition !== 'retain'
          || deriveCompletenessStatusV1(record) !== 'complete'
        )
      ) return [];
      let context = null;
      try {
        context = resolveValidationContext?.({
          address: clone(admittedAddress),
          record: clone(record),
          phase: 'render',
        }) ?? null;
      } catch {
        context = null;
      }
      if (!plain(context) || context.trustedActivation === null || context.retentionEligible === false) {
        return [];
      }
      try { prepareTrustedActivation(context.trustedActivation); } catch { return []; }
      return record.fragments.map((fragment) => ({
        proof: fragment.proof,
        trustedActivation: context.trustedActivation,
      }));
    });
    const signatureReceipts = await verifySignatureCandidates(signatureCandidates);
    const result = await storeHandle.materializationTransaction('readwrite', (view) => {
      let record = loadFrom(view, key);
      if (record === null || !same(fenceOf(record), prepareFence(expectedFence))) return { bytes: null };
      if (record.productState.freshness === 'retained') {
        const validation = revalidateRetainedRecord(
          view,
          key,
          record,
          resolveValidationContext,
          'render',
          signatureReceipts,
        );
        record = validation.record;
        if (validation.changed) return { bytes: null, snapshot: snapshotFor(record) };
      }
      if (
        record.productState.lifecycle !== 'active'
        || record.productState.effectiveDisposition !== 'retain'
        || deriveCompletenessStatusV1(record) !== 'complete'
      ) return { bytes: null };
      const context = requireContext(resolveValidationContext, admittedAddress, record, 'render');
      if (context.trustedActivation === null || context.retentionEligible === false) {
        record.productState.heldProofs = [];
        view.materializations.set(key, encodeRecord(record));
        return { bytes: null, snapshot: snapshotFor(record) };
      }
      let trusted;
      try { trusted = prepareTrustedActivation(context.trustedActivation); } catch {
        record.productState.heldProofs = [];
        view.materializations.set(key, encodeRecord(record));
        return { bytes: null, snapshot: snapshotFor(record) };
      }
      if (trusted.activationHash !== record.activationHash) {
        const ownerInput = context.ownerTransitionForRetainedFailure?.('activation-mismatch', clone(record));
        const next = applyOwnerInput(view, key, record, ownerInput);
        return { bytes: null, snapshot: snapshotFor(next) };
      }
      if (record.productState.freshness === 'retained' && !retainedAuthorityValid(context)) {
        const ownerInput = context.ownerTransitionForRetainedFailure?.('lease-invalid', clone(record));
        const next = applyOwnerInput(view, key, record, ownerInput);
        return { bytes: null, snapshot: snapshotFor(next) };
      }
      let fragments;
      if (record.productState.requestedScope.kind === 'page') {
        fragments = record.fragments.filter((entry) => proofMatchesRequest(entry.proof, record.productState));
        fragments = fragments.slice(0, 1);
      } else {
        const proofByDigest = new Map(record.fragments.map((entry) => [completenessProofDigestV1(entry.proof), entry]));
        const manifest = record.pageSets.find((entry) => pageSetMatchesRequest(
          { ...record, pageSets: [entry] }, record.productState,
        ));
        fragments = manifest?.orderedProofDigests.map((entry) => proofByDigest.get(entry)) ?? [];
        if (manifest) {
          try {
            const context = requireContext(resolveValidationContext, admittedAddress, record, 'render');
            validatePageSet(record, manifest, context, signatureReceipts);
          } catch {
            record.pageSets = record.pageSets.filter((entry) => entry.identity !== manifest.identity);
            view.pageSets.delete(manifest.identity);
            view.materializations.set(key, encodeRecord(record));
            return { bytes: null, snapshot: snapshotFor(record) };
          }
        }
      }
      if (fragments.length === 0 || fragments.some((entry) => entry === undefined)) return { bytes: null };
      try {
        for (const fragment of fragments) {
          validateProof(record, fragment, fragment.proof, context, signatureReceipts);
        }
      } catch (error) {
        if (error?.code === 'SNAPBACK_COMPLETENESS_WITNESS_INVALID') {
          const reason = witnessFailureReason(record, context);
          const ownerInput = context.ownerTransitionForRetainedFailure?.(reason, clone(record));
          const next = applyOwnerInput(view, key, record, ownerInput);
          return { bytes: null, snapshot: snapshotFor(next) };
        }
        for (const fragment of fragments) discardCorruptFragment(view, key, record, fragment);
        return { bytes: null, snapshot: snapshotFor(record) };
      }
      const bytes = fragments.map((fragment) => new Uint8Array(fragment.bytes));
      return { bytes: bytes.length === 1 ? bytes[0] : Object.freeze(bytes) };
    });
    if (result.snapshot) publish(key, result.snapshot);
    return result.bytes;
  };

  const observeMaterialization = (address, listener) => {
    if (typeof listener !== 'function') throw new TypeError('materialization listener must be a function');
    const key = materializationAddressKey(address);
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    listener(cache.get(key) ?? snapshotFor(null));
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      set.delete(listener);
      if (set.size === 0) listeners.delete(key);
    };
  };

  const compactPayload = async (address, expectedFence) => write(
    address,
    (view, key) => {
      const record = loadFrom(view, key);
      if (record === null) refuse('SNAPBACK_MATERIALIZATION_NOT_INITIALIZED', 'compaction requires a current instance');
      assertFence(record, expectedFence);
      // @ref LLP 0166#compaction-eviction--payload-custody-only — preserve
      // identity, owner state, fence/frontier metadata, and registration slots.
      removePayload(view, key, record);
      return { value: clone(record), snapshot: snapshotFor(record) };
    },
  );

  // @ref LLP 0166#current-law-restated — the pre-gate store surface exposes
  // exact retained bytes only; every transform/evaluation request refuses.
  const readOpaqueSnapshot = readRenderable;
  const evaluateLocal = async (_address, request) => refuseLocalEvaluation(request);

  const retire = async (address) => {
    const admittedAddress = prepareAddress(address);
    const key = jcs(admittedAddress);
    const retiring = await storeHandle.materializationTransaction('readwrite', (view) => {
      const record = loadFrom(view, key);
      if (record === null) return null;
      if (record.productState.lifecycle === 'active') {
        const ownerInput = resolveRetirementTransition?.({
          phase: 'begin',
          address: clone(admittedAddress),
          record: clone(record),
        });
        applyOwnerInput(view, key, record, ownerInput);
        if (
          record.authorityState.query_lifecycle !== 'retiring'
          || record.authorityState.effective_disposition !== 'delete'
        ) {
          refuse(
            'SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID',
            'retirement owner transition must enter retiring/delete',
          );
        }
        record.subscription.connectionState = 'retiring';
        view.materializations.set(key, encodeRecord(record));
      }
      return { record, snapshot: snapshotFor(record) };
    });
    if (retiring === null) return false;
    publish(key, retiring.snapshot);
    const removed = await storeHandle.materializationTransaction('readwrite', (view) => {
      const current = loadFrom(view, key);
      if (current === null) return snapshotFor(null, fenceOf(retiring.record));
      if (current.productState.lifecycle !== 'retiring') {
        refuse('SNAPBACK_MATERIALIZATION_RETIREMENT_INVALID', 'terminal removal requires retiring state');
      }
      const finalization = resolveRetirementTransition?.({
        phase: 'finalize',
        address: clone(admittedAddress),
        record: clone(current),
      });
      if (finalization?.remove !== true) {
        refuse(
          'SNAPBACK_AUTHORIZATION_OWNER_INPUT_INVALID',
          'retirement finalization requires the owner removal decision',
        );
      }
      removePayload(view, key, current);
      view.materializations.delete(key);
      delete view.storeMeta.durableRegistrations[key];
      return snapshotFor(null, fenceOf(current));
    });
    publish(key, removed);
    return true;
  };

  return Object.freeze({
    initialize,
    beginEstablishment,
    commitPage,
    commitLegacyAdoption,
    commitPageSet,
    recordAttemptOutcome,
    applyAuthorizationTransition,
    applyStoreAuthorityBarrier,
    readRenderable,
    readOpaqueSnapshot,
    evaluateLocal,
    observeMaterialization,
    retire,
    compactPayload,
  });
}
