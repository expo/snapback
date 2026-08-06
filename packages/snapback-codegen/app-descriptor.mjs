import { createHash } from 'node:crypto';

export const APP_DESCRIPTOR_FORMAT = 'snapback.app.v1';
export const APP_DESCRIPTOR_MAX_BYTES = 16 * 1024 * 1024;

const GENERATED_IDENTITY = /^(?:sha256:[0-9a-f]+|snapback\.v[0-9]+:[a-z0-9-]+:(?:schema|function):sha256:[0-9a-f]{64})$/u;
const ROOT_KEYS = ['api', 'capabilities', 'commands', 'format', 'identity', 'surfaces'];
const IDENTITY_KEYS = ['app', 'descriptor', 'functions', 'schema'];
const API_KEYS = ['assets', 'ephemeral', 'mutations', 'queries', 'queryGroups'];
const CAPABILITY_KEYS = ['required'];
const SURFACE_KEYS = [
  'appId', 'artifactKind', 'assets', 'commands', 'id', 'mutations', 'name',
  'params', 'presence', 'reads', 'schemaVersion', 'sourceSpan',
];
const SURFACE_MEMBER_KEYS = ['artifactKind', 'bindings', 'inputs', 'reference'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// @ref LLP 0179#portable-descriptor-document-and-typed-binding — descriptor
// identity is SHA-256 over the RFC 8785/JCS encoding with the descriptor field
// fixed to the empty-string sentinel. JavaScript's JSON number/string encoding
// and UTF-16 member ordering are the JCS primitives; invalid I-JSON values are
// rejected instead of being silently coerced by JSON.stringify.
export function canonicalizeAppDescriptorV1(value) {
  const seen = new Set();
  const normalize = (entry, path) => {
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'string') {
      if (hasLoneSurrogate(entry)) throw new TypeError(`${path} contains an invalid lone surrogate`);
      return entry;
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`${path} contains a non-finite number`);
      return Object.is(entry, -0) ? 0 : entry;
    }
    if (typeof entry !== 'object') {
      throw new TypeError(`${path} contains a non-JSON ${typeof entry} value`);
    }
    if (seen.has(entry)) throw new TypeError(`${path} contains a cycle`);
    seen.add(entry);
    let output;
    if (Array.isArray(entry)) {
      output = entry.map((item, index) => normalize(item, `${path}[${index}]`));
    } else {
      output = Object.create(null);
      for (const key of Object.keys(entry).sort(compareUtf16)) {
        if (hasLoneSurrogate(key)) throw new TypeError(`${path} has an invalid member name`);
        output[key] = normalize(entry[key], `${path}.${key}`);
      }
    }
    seen.delete(entry);
    return output;
  };
  return JSON.stringify(normalize(value, '$'));
}

export function appDescriptorDigestV1(candidate) {
  if (!isRecord(candidate) || !isRecord(candidate.identity)) {
    throw new TypeError('descriptor identity must be an object');
  }
  const preimage = {
    ...candidate,
    identity: { ...candidate.identity, descriptor: '' },
  };
  return `sha256:${createHash('sha256')
    .update(canonicalizeAppDescriptorV1(preimage))
    .digest('hex')}`;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort(compareUtf16);
  const wanted = [...expected].sort(compareUtf16);
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function problem(code, path, message, details = {}) {
  return { code, path, message, details };
}

function validateSourceSpan(value, path, problems) {
  if (value === undefined) return;
  if (!isRecord(value)
    || typeof value.file !== 'string'
    || value.file.length === 0
    || (value.line !== undefined && (!Number.isSafeInteger(value.line) || value.line < 1))
    || (value.column !== undefined && (!Number.isSafeInteger(value.column) || value.column < 1))) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
      path,
      `${path} must be a portable source span`,
    ));
  }
}

function validateReferenceMap(map, path, expectedClass, expectedKinds, problems, nameField = 'name') {
  if (!isRecord(map)) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
      path,
      `${path} must be an object map`,
    ));
    return;
  }
  for (const [name, reference] of Object.entries(map)) {
    const memberPath = `${path}.${name}`;
    if (!isRecord(reference) || typeof reference.artifactKind !== 'string') {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
        memberPath,
        `${memberPath} must be a generated reference object`,
      ));
      continue;
    }
    if (reference.artifactKind !== expectedClass) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
        memberPath,
        `${memberPath} has unsupported member class ${JSON.stringify(reference.artifactKind)}`,
        { expectedClass, observedClass: reference.artifactKind },
      ));
      continue;
    }
    if (expectedKinds && !expectedKinds.has(reference.kind)) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
        `${memberPath}.kind`,
        `${memberPath} has kind ${JSON.stringify(reference.kind)} in the wrong API namespace`,
        { expectedKinds: [...expectedKinds], observedKind: reference.kind ?? null },
      ));
    }
    for (const field of ['appId', 'id', nameField]) {
      if (typeof reference[field] !== 'string' || reference[field].length === 0) {
        problems.push(problem(
          'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
          `${memberPath}.${field}`,
          `${memberPath}.${field} must be a non-empty string`,
        ));
      }
    }
    validateSourceSpan(reference.sourceSpan, `${memberPath}.sourceSpan`, problems);
  }
}

function validateSurfaceBindingValue(value, path, problems, depth = 0) {
  if (!isRecord(value) || typeof value.kind !== 'string' || depth > 1) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
      path,
      `${path} must be a bounded surface binding value`,
    ));
    return;
  }
  if (value.kind === 'param' || value.kind === 'input') {
    if (!exactKeys(value, ['kind', 'name']) || typeof value.name !== 'string' || value.name.length === 0) {
      problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', path, `${path} has an invalid ${value.kind} binding`));
    }
    return;
  }
  if (value.kind === 'literal') {
    if (!exactKeys(value, ['kind', 'value'])) {
      problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', path, `${path} has an invalid literal binding`));
    }
    return;
  }
  if (value.kind === 'scope') {
    if (!exactKeys(value, ['fields', 'kind']) || !isRecord(value.fields)) {
      problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', path, `${path} has an invalid scope binding`));
      return;
    }
    for (const [name, field] of Object.entries(value.fields)) {
      validateSurfaceBindingValue(field, `${path}.fields.${name}`, problems, depth + 1);
    }
    return;
  }
  problems.push(problem(
    'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
    path,
    `${path} has unsupported binding class ${JSON.stringify(value.kind)}`,
  ));
}

function validateSurfaceMember(member, path, expectedClass, expectedKinds, problems) {
  if (!exactKeys(member, SURFACE_MEMBER_KEYS) || member.artifactKind !== 'surfaceMemberBinding') {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
      path,
      `${path} must be a closed surface member binding`,
    ));
    return;
  }
  validateReferenceMap({ member: member.reference }, `${path}.reference`, expectedClass, expectedKinds, problems);
  if (!isRecord(member.bindings)) {
    problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', `${path}.bindings`, `${path}.bindings must be an object map`));
  } else {
    for (const [name, value] of Object.entries(member.bindings)) {
      validateSurfaceBindingValue(value, `${path}.bindings.${name}`, problems);
    }
  }
  if (!isRecord(member.inputs)) {
    problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', `${path}.inputs`, `${path}.inputs must be an object map`));
  } else {
    for (const [name, input] of Object.entries(member.inputs)) {
      if (!exactKeys(input, ['contract', 'optional']) || !isRecord(input.contract) || typeof input.optional !== 'boolean') {
        problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', `${path}.inputs.${name}`, `${path}.inputs.${name} must carry a contract and optionality`));
      }
    }
  }
}

function validateSurfaceMap(surfaces, problems) {
  if (!isRecord(surfaces)) {
    problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', '$.surfaces', 'surfaces must be an object map'));
    return;
  }
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    const path = `$.surfaces.${surfaceName}`;
    if (!exactKeys(surface, SURFACE_KEYS)
      || surface.artifactKind !== 'surfaceDescriptor'
      || typeof surface.appId !== 'string'
      || typeof surface.id !== 'string'
      || surface.name !== surfaceName
      || typeof surface.schemaVersion !== 'string'
      || surface.schemaVersion.length === 0
      || !isRecord(surface.params)) {
      problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', path, `${path} must be a closed surface descriptor`));
      continue;
    }
    validateSourceSpan(surface.sourceSpan, `${path}.sourceSpan`, problems);
    for (const [name, contract] of Object.entries(surface.params)) {
      if (!isRecord(contract)) problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', `${path}.params.${name}`, `${path}.params.${name} must be a portable contract`));
    }
    for (const [namespace, expectedClass, expectedKinds] of [
      ['reads', 'functionReference', new Set(['Query', 'LiveQuery'])],
      ['mutations', 'functionReference', new Set(['Mutation'])],
      ['presence', 'ephemeralCollectionReference', null],
      ['assets', 'assetUploadReference', null],
    ]) {
      const members = surface[namespace];
      if (!isRecord(members)) {
        problems.push(problem('SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH', `${path}.${namespace}`, `${path}.${namespace} must be an object map`));
        continue;
      }
      for (const [name, member] of Object.entries(members)) {
        validateSurfaceMember(member, `${path}.${namespace}.${name}`, expectedClass, expectedKinds, problems);
      }
    }
    for (const namespace of ['commands']) {
      if (!isRecord(surface[namespace]) || Object.keys(surface[namespace]).length > 0) {
        problems.push(problem(
          'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
          `${path}.${namespace}`,
          `${path}.${namespace} is reserved for a later delivery slice`,
        ));
      }
    }
  }
}

// This validator is the language-neutral descriptor admission twin used by
// codegen before the transactional graph publication. It deliberately closes
// S1's surface grammar and S0's still-empty command namespace.
// @ref LLP 0179#delivery — S1 admits bounded generated surfaces without
// weakening the portable descriptor or pre-admitting S2 commands.
export function validateAppDescriptorV1(candidate, {
  maxBytes = APP_DESCRIPTOR_MAX_BYTES,
  verifyDigest = true,
} = {}) {
  const problems = [];
  if (!exactKeys(candidate, ROOT_KEYS)) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_SHAPE_INVALID',
      '$',
      'descriptor must be the closed snapback.app.v1 root record',
      { expectedKeys: ROOT_KEYS, actualKeys: isRecord(candidate) ? Object.keys(candidate) : [] },
    ));
    return problems;
  }
  if (candidate.format !== APP_DESCRIPTOR_FORMAT) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_FORMAT_UNSUPPORTED',
      '$.format',
      `descriptor format must be ${APP_DESCRIPTOR_FORMAT}`,
      { observedFormat: candidate.format ?? null },
    ));
  }
  if (!exactKeys(candidate.identity, IDENTITY_KEYS)) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_SHAPE_INVALID',
      '$.identity',
      'descriptor identity must be the closed app/schema/functions/descriptor record',
    ));
  } else {
    for (const field of IDENTITY_KEYS) {
      const value = candidate.identity[field];
      const valid = field === 'app'
        ? typeof value === 'string' && value.length > 0
        : typeof value === 'string' && GENERATED_IDENTITY.test(value);
      if (!valid) {
        problems.push(problem(
          'SNAPBACK_APP_DESCRIPTOR_IDENTITY_INVALID',
          `$.identity.${field}`,
          `identity.${field} must reuse a non-empty generated identity`,
        ));
      }
    }
  }
  if (!exactKeys(candidate.api, API_KEYS)) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_SHAPE_INVALID',
      '$.api',
      'descriptor api must be the closed queries/mutations/assets/ephemeral/queryGroups record',
    ));
  } else {
    validateReferenceMap(
      candidate.api.queries,
      '$.api.queries',
      'functionReference',
      new Set(['Query', 'LiveQuery']),
      problems,
    );
    validateReferenceMap(
      candidate.api.mutations,
      '$.api.mutations',
      'functionReference',
      new Set(['Mutation']),
      problems,
    );
    validateReferenceMap(candidate.api.assets, '$.api.assets', 'assetUploadReference', null, problems);
    validateReferenceMap(candidate.api.ephemeral, '$.api.ephemeral', 'ephemeralCollectionReference', null, problems);
    validateReferenceMap(candidate.api.queryGroups, '$.api.queryGroups', 'queryGroupReference', null, problems, 'route');
  }
  for (const namespace of ['commands']) {
    if (!isRecord(candidate[namespace])) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_MEMBER_TYPE_MISMATCH',
        `$.${namespace}`,
        `${namespace} must be an object map`,
      ));
    } else if (Object.keys(candidate[namespace]).length > 0) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_MEMBER_CLASS_UNSUPPORTED',
        `$.${namespace}`,
        `${namespace} members are not admitted before descriptor slice S2`,
        { members: Object.keys(candidate[namespace]).sort(compareUtf16) },
      ));
    }
  }
  validateSurfaceMap(candidate.surfaces, problems);
  if (!exactKeys(candidate.capabilities, CAPABILITY_KEYS)
    || !Array.isArray(candidate.capabilities?.required)
    || candidate.capabilities.required.some((entry) => typeof entry !== 'string' || entry.length === 0)
    || new Set(candidate.capabilities.required).size !== candidate.capabilities.required.length
    || candidate.capabilities.required.some((entry, index, entries) => index > 0 && compareUtf16(entries[index - 1], entry) >= 0)) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_CAPABILITIES_INVALID',
      '$.capabilities',
      'capabilities.required must be a unique, strictly sorted string array',
    ));
  }
  let canonical;
  try {
    canonical = canonicalizeAppDescriptorV1(candidate);
  } catch (error) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_PORTABILITY_INVALID',
      '$',
      `descriptor is not portable I-JSON: ${error.message}`,
    ));
    return problems;
  }
  const bytes = Buffer.byteLength(canonical, 'utf8');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes > maxBytes) {
    problems.push(problem(
      'SNAPBACK_APP_DESCRIPTOR_BUDGET_EXCEEDED',
      '$',
      `descriptor canonical bytes ${bytes} exceed the generation protocol budget ${maxBytes}`,
      { bytes, maximum: maxBytes },
    ));
  }
  if (verifyDigest && exactKeys(candidate.identity, IDENTITY_KEYS)) {
    let expected;
    try {
      expected = appDescriptorDigestV1(candidate);
    } catch (error) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_PORTABILITY_INVALID',
        '$.identity.descriptor',
        `descriptor digest could not be reproduced: ${error.message}`,
      ));
    }
    if (expected !== undefined && candidate.identity.descriptor !== expected) {
      problems.push(problem(
        'SNAPBACK_APP_DESCRIPTOR_IDENTITY_INVALID',
        '$.identity.descriptor',
        'identity.descriptor does not reproduce from the JCS empty-sentinel preimage',
        { expected, observed: candidate.identity.descriptor ?? null },
      ));
    }
  }
  return problems;
}

export function createAppDescriptorV1({
  app,
  schema,
  functions,
  api,
  surfaces = {},
  requiredCapabilities,
}) {
  const descriptor = {
    format: APP_DESCRIPTOR_FORMAT,
    identity: { app, schema, functions, descriptor: '' },
    api,
    commands: {},
    surfaces,
    capabilities: {
      required: [...new Set(requiredCapabilities)].sort(compareUtf16),
    },
  };
  descriptor.identity.descriptor = appDescriptorDigestV1(descriptor);
  return descriptor;
}

export function serializeAppDescriptorV1(descriptor) {
  return `${canonicalizeAppDescriptorV1(descriptor)}\n`;
}
