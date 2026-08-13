// Contract-directed argument normalization shared by every first-party JS arm.
//
// @ref LLP 0247#d1-contract-directed-optional-omission — only an optional
// property in an exact closed generated contract may turn explicit undefined
// into omission; all other non-canonical shapes refuse before effects.

import { snapbackDiagnosticError } from './diagnostic-error.mjs';

export const ARGUMENT_NORMALIZATION_VERSION = 'snapback.argument-normalization.v1';

const refuseAt = (reason, path, details = {}) => {
  throw snapbackDiagnosticError(
    'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
    `generated arguments cannot be normalized: ${reason}`,
    { reason, path, ...details },
    { operation: 'argument-normalization', effectCommitted: false, effectMayHaveCommitted: false },
  );
};

// This is the observable-descriptor admission primitive from
// canonical-client-value.mjs:62-95, reused verbatim so neither arm reads a
// source property or invokes an accessor while capturing caller input.
function captureObject(value, path) {
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    refuseAt('object descriptor inspection failed', path);
  }
  if (keys.some((key) => typeof key !== 'string')) {
    refuseAt('symbol object key', path);
  }
  if (
    Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    refuseAt('inconsistent object descriptors', path);
  }
  // A second key-only observation catches mutating and inconsistent proxy
  // traps without ever reading a property value through the source object.
  let confirmation;
  try {
    confirmation = Reflect.ownKeys(value);
  } catch {
    refuseAt('object key confirmation failed', path);
  }
  if (
    confirmation.length !== keys.length
    || confirmation.some((key, index) => key !== keys[index])
  ) {
    refuseAt('object keys changed during descriptor capture', path);
  }
  return keys.map((key) => [key, descriptors[key]]);
}

const contractNode = (contract) => {
  if (contract?.kind === 'object') return contract;
  if (Array.isArray(contract?.fields)) {
    return { kind: 'object', fields: contract.fields, allowExtra: false };
  }
  return contract;
};

const schemaNode = (schema) => {
  if (!schema || typeof schema !== 'object') return { kind: 'json' };
  if (Array.isArray(schema.anyOf)) {
    return { kind: 'union', variants: schema.anyOf.map(schemaNode) };
  }
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    return {
      kind: 'object',
      allowExtra: schema.additionalProperties !== false,
      fields: Object.entries(schema.properties ?? {}).map(([name, child]) => ({
        name,
        required: required.has(name),
        value: schemaNode(child),
      })),
    };
  }
  if (Array.isArray(schema.prefixItems)) {
    return { kind: 'tuple', elements: schema.prefixItems.map(schemaNode) };
  }
  if (schema.type === 'array') return { kind: 'array', element: schemaNode(schema.items) };
  if (schema.type === undefined && schema.const === undefined) return { kind: 'json' };
  if (schema.const !== undefined) return { kind: 'literal', value: schema.const };
  return { kind: schema.type === 'number' ? 'finiteReal' : schema.type };
};

export function exactArgumentContract(reference) {
  if (reference?.argsContract && Array.isArray(reference.argsContract.fields)) {
    const contract = contractNode(reference.argsContract);
    if (contract?.kind === 'object' && contract.allowExtra !== true) return contract;
  }
  // One-release compatibility for references generated before argsContract
  // was carried directly: a closed generated operation schema has the same
  // required/optional object boundary and is still an exact contract. An
  // absent or open schema is not enough evidence and continues to refuse.
  if (
    reference?.argumentSchema?.type === 'object'
    && reference.argumentSchema.additionalProperties === false
  ) {
    return schemaNode(reference.argumentSchema);
  }
  return null;
}

const prototypeOf = (value, path) => {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    refuseAt('object prototype inspection failed', path);
  }
};

const captureDataDescriptors = (value, path) => {
  const descriptors = captureObject(value, path);
  for (const [key, descriptor] of descriptors) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable) refuseAt('non-enumerable object property', path, { key });
    if (!('value' in descriptor)) refuseAt('accessor object property', path, { key });
  }
  return descriptors;
};

function normalizeOpenJson(value, path, seen) {
  if (value === undefined) refuseAt('undefined inside open JSON', path);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    refuseAt('non-finite number inside open JSON', path);
  }
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value !== 'object') refuseAt(`${typeof value} inside open JSON`, path);
  if (seen.has(value)) refuseAt('cyclic value', path);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototypeOf(value, path) !== Array.prototype) refuseAt('exotic array prototype', path);
      const descriptors = captureDataDescriptors(value, path);
      const byKey = new Map(descriptors);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = byKey.get(String(index));
        if (!descriptor) refuseAt('sparse array entry', `${path}[${index}]`);
        result.push(normalizeOpenJson(descriptor.value, `${path}[${index}]`, seen));
      }
      for (const [key] of descriptors) {
        if (key === 'length') continue;
        if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
          refuseAt('non-index array property', path, { key });
        }
      }
      return result;
    }
    const prototype = prototypeOf(value, path);
    if (prototype !== Object.prototype && prototype !== null) {
      refuseAt('exotic object prototype', path);
    }
    const result = Object.create(null);
    for (const [key, descriptor] of captureDataDescriptors(value, path)) {
      result[key] = normalizeOpenJson(descriptor.value, `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function normalizeNode(nodeInput, value, path, seen) {
  const node = contractNode(nodeInput) ?? { kind: 'json' };
  if (value === undefined) refuseAt('undefined in a required position', path);
  if (
    node.kind === 'json'
    || node.kind === 'unknown'
    || node.kind === 'schemaRef'
    || node.kind === 'platformSchemaRef'
  ) {
    return normalizeOpenJson(value, path, seen);
  }
  if (node.kind === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      refuseAt('value does not match an object contract', path);
    }
    if (seen.has(value)) refuseAt('cyclic value', path);
    const prototype = prototypeOf(value, path);
    if (prototype !== Object.prototype && prototype !== null) {
      refuseAt('exotic object prototype', path);
    }
    seen.add(value);
    try {
      const descriptors = captureDataDescriptors(value, path);
      const byName = new Map(descriptors);
      const fields = new Map((node.fields ?? []).map((field) => [field.name, field]));
      if (node.allowExtra !== true) {
        for (const [key] of descriptors) {
          if (!fields.has(key)) refuseAt('unknown object property', `${path}.${key}`, { key });
        }
      }
      const result = Object.create(null);
      for (const [name, field] of fields) {
        const descriptor = byName.get(name);
        if (!descriptor) {
          if (field.required === true) refuseAt('missing required property', `${path}.${name}`);
          continue;
        }
        if (descriptor.value === undefined) {
          if (field.required === true) refuseAt('undefined in a required property', `${path}.${name}`);
          continue;
        }
        result[name] = normalizeNode(field.value, descriptor.value, `${path}.${name}`, seen);
      }
      if (node.allowExtra === true) {
        for (const [key, descriptor] of descriptors) {
          if (!fields.has(key)) result[key] = normalizeOpenJson(descriptor.value, `${path}.${key}`, seen);
        }
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }
  if (node.kind === 'array' || node.kind === 'tuple') {
    if (!Array.isArray(value)) refuseAt('value does not match an array contract', path);
    if (prototypeOf(value, path) !== Array.prototype) refuseAt('exotic array prototype', path);
    if (seen.has(value)) refuseAt('cyclic value', path);
    seen.add(value);
    try {
      const descriptors = captureDataDescriptors(value, path);
      const byKey = new Map(descriptors);
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = byKey.get(String(index));
        if (!descriptor) refuseAt('sparse array entry', `${path}[${index}]`);
        const child = node.kind === 'tuple' ? node.elements?.[index] : node.element;
        if (child === undefined) refuseAt('undeclared tuple position', `${path}[${index}]`);
        result.push(normalizeNode(child, descriptor.value, `${path}[${index}]`, seen));
      }
      for (const [key] of descriptors) {
        if (key === 'length') continue;
        if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
          refuseAt('non-index array property', path, { key });
        }
      }
      if (node.kind === 'tuple' && value.length !== (node.elements?.length ?? 0)) {
        refuseAt('tuple length mismatch', path);
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }
  if (node.kind === 'union') {
    let firstError = null;
    for (const variant of node.variants ?? []) {
      try {
        return normalizeNode(variant, value, path, new Set(seen));
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
  if (node.kind === 'literal') {
    if (!Object.is(value, node.value)) refuseAt('value does not match a literal contract', path);
    return value;
  }
  if (node.kind === 'null') {
    if (value !== null) refuseAt('value does not match a null contract', path);
    return value;
  }
  if (['string', 'principal', 'assetRef', 'id'].includes(node.kind)) {
    if (typeof value !== 'string') refuseAt('value does not match a string contract', path);
    return value;
  }
  if (node.kind === 'boolean') {
    if (typeof value !== 'boolean') refuseAt('value does not match a boolean contract', path);
    return value;
  }
  if (node.kind === 'integer') {
    if (!Number.isSafeInteger(value)) refuseAt('value does not match an integer contract', path);
    return value;
  }
  if (node.kind === 'finiteReal') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      refuseAt('value does not match a finite-real contract', path);
    }
    return value;
  }
  if (node.kind === 'vector') {
    return normalizeNode({ kind: 'array', element: { kind: 'finiteReal' } }, value, path, seen);
  }
  if (value !== null && typeof value === 'object') {
    // Type validation remains owned by the generated schema validator, but
    // object-shaped mismatches still cannot smuggle accessors/exotics to it.
    return normalizeOpenJson(value, path, seen);
  }
  return value;
}

export function normalizeArgumentsAgainstContractV1(args, contract, { path = 'args' } = {}) {
  if (contract === null || contract === undefined) {
    refuseAt('generated exact argument contract is missing', path);
  }
  return normalizeNode(contract, args, path, new Set());
}

export function normalizeGeneratedArgumentsV1(reference, args) {
  if (typeof reference === 'string') return normalizeOpenJson(args, 'args', new Set());
  if (reference?.artifactKind !== 'functionReference') {
    refuseAt('generated function reference is required', 'ref');
  }
  return normalizeArgumentsAgainstContractV1(args, exactArgumentContract(reference));
}

export function optionalPropertyPathsV1(contract, prefix = 'args') {
  const paths = [];
  const visit = (nodeInput, path) => {
    const node = contractNode(nodeInput);
    if (node?.kind === 'union') {
      for (const variant of node.variants ?? []) visit(variant, path);
      return;
    }
    if (node?.kind === 'array') {
      visit(node.element, `${path}[]`);
      return;
    }
    if (node?.kind === 'tuple') {
      for (const [index, element] of (node.elements ?? []).entries()) {
        visit(element, `${path}[${index}]`);
      }
      return;
    }
    if (node?.kind === 'object') {
      for (const field of node.fields ?? []) {
        const childPath = `${path}.${field.name}`;
        if (field.required !== true) paths.push(childPath);
        if (field.value?.kind !== 'json') visit(field.value, childPath);
      }
    }
  };
  visit(contract, prefix);
  return paths;
}
