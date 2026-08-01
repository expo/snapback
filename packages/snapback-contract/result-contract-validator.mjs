// Browser-safe result-contract admission and validation shared by generated
// artifacts and client projections.
//
// @ref LLP 0108#result-contract-vocabulary — this module mirrors the closed
// Rust-owned descriptor grammar and validates the post-JSON image.
// @ref LLP 0107#optimistic-mutation-projection — React compiles the exact
// deployed descriptor once and never maintains a second result grammar.

export const RESULT_CONTRACT_LIMITS_V1 = Object.freeze({
  maxDepth: 16,
  maxObjectFields: 128,
  maxUnionVariants: 8,
  maxArrayItems: 1_024,
  maxValueBytes: 1_024 * 1_024,
  maxResultBytes: 4 * 1_024 * 1_024,
  maxResultNodes: 65_536,
  maxSafeInteger: Number.MAX_SAFE_INTEGER,
});

const utf8 = new TextEncoder();
const own = (value, name) => Object.prototype.hasOwnProperty.call(value, name);

function invalid(message) {
  const error = new TypeError(`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: ${message}`);
  error.code = 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID';
  return error;
}

function exactObject(value, fields, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${where} must be an object`);
  }
  const allowed = new Set(fields);
  for (const name of Object.keys(value)) {
    if (!allowed.has(name)) throw invalid(`${where} has unknown field ${name}`);
  }
}

function integer(value, where, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalid(`${where} is outside its integer bounds`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((name) => (
      `${JSON.stringify(name)}:${canonicalJson(value[name])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function primitiveKind(contract) {
  if (contract.kind === 'null') return 'null';
  if (contract.kind === 'boolean') return 'boolean';
  if (['string', 'principal', 'assetRef', 'id'].includes(contract.kind)) return 'string';
  if (['integer', 'finiteReal'].includes(contract.kind)) return 'number';
  if (contract.kind === 'array') return 'array';
  if (contract.kind === 'object') return 'object';
  if (contract.kind === 'literal') {
    if (contract.value === null) return 'null';
    return typeof contract.value;
  }
  return 'anyJson';
}

function unionHasObjectDiscriminator(variants) {
  if (!variants.every((variant) => variant.kind === 'object' && variant.allowExtra === false)) {
    return false;
  }
  return variants[0].fields.some((candidate) => {
    if (!candidate.required || candidate.value.kind !== 'literal') return false;
    const values = new Set();
    for (const variant of variants) {
      const field = variant.fields.find((entry) => (
        entry.required && entry.name === candidate.name && entry.value.kind === 'literal'
      ));
      if (!field) return false;
      const encoded = canonicalJson(field.value.value);
      if (values.has(encoded)) return false;
      values.add(encoded);
    }
    return true;
  });
}

function primitiveUnionIsDisjoint(variants) {
  const groups = new Map();
  for (const variant of variants) {
    const kind = primitiveKind(variant);
    if (kind === 'anyJson') return false;
    const group = groups.get(kind) ?? [];
    group.push(variant);
    groups.set(kind, group);
  }
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    if (!group.every((variant) => variant.kind === 'literal')) return false;
    const literals = group.map((variant) => canonicalJson(variant.value));
    if (new Set(literals).size !== literals.length) return false;
  }
  return true;
}

function admitValueContract(contract, depth, budget, where) {
  if (depth > RESULT_CONTRACT_LIMITS_V1.maxDepth) {
    throw invalid('result contract exceeds the depth-16 profile');
  }
  exactObject(contract, (() => {
    switch (contract?.kind) {
      case 'null':
      case 'boolean':
      case 'principal':
      case 'assetRef': return ['kind'];
      case 'string': return ['kind', 'maxBytes'];
      case 'integer':
      case 'finiteReal': return ['kind', 'min', 'max'];
      case 'id': return ['kind', 'table'];
      case 'literal': return ['kind', 'value'];
      case 'json': return ['kind', 'maxDepth', 'maxBytes'];
      case 'array': return ['kind', 'element', 'maxItems'];
      case 'union': return ['kind', 'variants'];
      case 'object': return ['kind', 'fields', 'allowExtra'];
      default: throw invalid(`${where} has unsupported kind ${JSON.stringify(contract?.kind)}`);
    }
  })(), where);

  switch (contract.kind) {
    case 'null':
    case 'boolean':
    case 'principal':
    case 'assetRef':
      break;
    case 'string':
      integer(contract.maxBytes, `${where}.maxBytes`, {
        min: 0,
        max: RESULT_CONTRACT_LIMITS_V1.maxValueBytes,
      });
      break;
    case 'integer':
      if (
        !Number.isSafeInteger(contract.min)
        || !Number.isSafeInteger(contract.max)
        || contract.min < -RESULT_CONTRACT_LIMITS_V1.maxSafeInteger
        || contract.max > RESULT_CONTRACT_LIMITS_V1.maxSafeInteger
        || contract.min > contract.max
      ) throw invalid(`${where} has invalid JavaScript-safe integer bounds`);
      break;
    case 'finiteReal':
      if (
        typeof contract.min !== 'number'
        || typeof contract.max !== 'number'
        || !Number.isFinite(contract.min)
        || !Number.isFinite(contract.max)
        || contract.min > contract.max
      ) throw invalid(`${where} has invalid finite-real bounds`);
      break;
    case 'id':
      if (typeof contract.table !== 'string' || contract.table.length === 0) {
        throw invalid(`${where}.table must be non-empty`);
      }
      break;
    case 'literal':
      if (
        contract.value !== null
        && typeof contract.value !== 'string'
        && typeof contract.value !== 'boolean'
        && !(typeof contract.value === 'number' && Number.isFinite(contract.value))
      ) throw invalid(`${where}.value must be a finite JSON scalar`);
      break;
    case 'json':
      integer(contract.maxDepth, `${where}.maxDepth`, {
        max: RESULT_CONTRACT_LIMITS_V1.maxDepth,
      });
      integer(contract.maxBytes, `${where}.maxBytes`, {
        max: RESULT_CONTRACT_LIMITS_V1.maxValueBytes,
      });
      break;
    case 'array':
      integer(contract.maxItems, `${where}.maxItems`, {
        max: RESULT_CONTRACT_LIMITS_V1.maxArrayItems,
      });
      admitValueContract(contract.element, depth + 1, budget, `${where}.element`);
      break;
    case 'union': {
      if (
        !Array.isArray(contract.variants)
        || contract.variants.length < 2
        || contract.variants.length > RESULT_CONTRACT_LIMITS_V1.maxUnionVariants
      ) throw invalid(`${where}.variants must contain 2–8 entries`);
      for (let index = 0; index < contract.variants.length; index += 1) {
        admitValueContract(
          contract.variants[index],
          depth + 1,
          budget,
          `${where}.variants[${index}]`,
        );
      }
      const primitiveDisjoint = primitiveUnionIsDisjoint(contract.variants);
      if (!primitiveDisjoint && !unionHasObjectDiscriminator(contract.variants)) {
        throw invalid(`${where}.variants are not syntactically disjoint`);
      }
      break;
    }
    case 'object': {
      if (!Array.isArray(contract.fields) || typeof contract.allowExtra !== 'boolean') {
        throw invalid(`${where} requires fields and allowExtra`);
      }
      budget.objectFields += contract.fields.length;
      if (budget.objectFields > RESULT_CONTRACT_LIMITS_V1.maxObjectFields) {
        throw invalid('result contract exceeds 128 object fields');
      }
      const names = new Set();
      for (let index = 0; index < contract.fields.length; index += 1) {
        const field = contract.fields[index];
        exactObject(field, ['name', 'required', 'value'], `${where}.fields[${index}]`);
        if (
          typeof field.name !== 'string'
          || field.name.length === 0
          || names.has(field.name)
          || typeof field.required !== 'boolean'
        ) throw invalid(`${where} field names must be non-empty and unique`);
        names.add(field.name);
        admitValueContract(field.value, depth + 1, budget, `${where}.fields[${index}].value`);
      }
      break;
    }
    default:
      throw invalid(`${where} has unsupported kind`);
  }
}

function jsonImage(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return { ok: false, path: '$' };
  }
  if (
    encoded === undefined
    || utf8.encode(encoded).byteLength > RESULT_CONTRACT_LIMITS_V1.maxResultBytes
  ) return { ok: false, path: '$' };
  try {
    return { ok: true, value: JSON.parse(encoded) };
  } catch {
    return { ok: false, path: '$' };
  }
}

function consume(budget, depth, path) {
  budget.nodes += 1;
  return budget.nodes <= RESULT_CONTRACT_LIMITS_V1.maxResultNodes
    && depth <= RESULT_CONTRACT_LIMITS_V1.maxDepth
    ? null
    : path;
}

function validateJson(value, depth, maxDepth, budget, path) {
  const consumed = consume(budget, depth, path);
  if (consumed || depth > maxDepth) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = validateJson(value[index], depth + 1, maxDepth, budget, `${path}[${index}]`);
      if (child) return child;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [name, childValue] of Object.entries(value)) {
      const child = validateJson(childValue, depth + 1, maxDepth, budget, `${path}.${name}`);
      if (child) return child;
    }
  }
  return null;
}

function validateJsonChildren(value, depth, maxDepth, budget, path) {
  if (depth > maxDepth) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = validateJson(value[index], depth + 1, maxDepth, budget, `${path}[${index}]`);
      if (child) return child;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [name, childValue] of Object.entries(value)) {
      const child = validateJson(childValue, depth + 1, maxDepth, budget, `${path}.${name}`);
      if (child) return child;
    }
  }
  return null;
}

function valuePath(contract, value, path, depth, budget) {
  const consumed = consume(budget, depth, path);
  if (consumed) return consumed;
  switch (contract.kind) {
    case 'null': return value === null ? null : path;
    case 'boolean': return typeof value === 'boolean' ? null : path;
    case 'string':
      return typeof value === 'string' && utf8.encode(value).byteLength <= contract.maxBytes
        ? null : path;
    case 'integer':
      return Number.isSafeInteger(value) && value >= contract.min && value <= contract.max
        ? null : path;
    case 'finiteReal':
      return typeof value === 'number' && Number.isFinite(value)
        && value >= contract.min && value <= contract.max ? null : path;
    case 'principal':
    case 'assetRef':
    case 'id':
      return typeof value === 'string' && value.length > 0 ? null : path;
    case 'literal':
      return canonicalJson(value) === canonicalJson(contract.value) ? null : path;
    case 'json': {
      const encoded = JSON.stringify(value);
      if (utf8.encode(encoded).byteLength > contract.maxBytes) return path;
      return validateJsonChildren(value, depth, contract.maxDepth, budget, path);
    }
    case 'array':
      if (!Array.isArray(value) || value.length > contract.maxItems) return path;
      for (let index = 0; index < value.length; index += 1) {
        const child = valuePath(
          contract.element,
          value[index],
          `${path}[${index}]`,
          depth + 1,
          budget,
        );
        if (child) return child;
      }
      return null;
    case 'union':
      for (const variant of contract.variants) {
        const trial = { nodes: budget.nodes };
        const child = valuePath(variant, value, path, depth, trial);
        if (!child) {
          budget.nodes = trial.nodes;
          return null;
        }
      }
      return path;
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return path;
      const fields = new Map(contract.fields.map((field) => [field.name, field]));
      if (!contract.allowExtra) {
        const extra = Object.keys(value).find((name) => !fields.has(name));
        if (extra) return `${path}.${extra}`;
      }
      for (const field of contract.fields) {
        if (!own(value, field.name)) {
          if (field.required) return `${path}.${field.name}`;
          continue;
        }
        const child = valuePath(
          field.value,
          value[field.name],
          `${path}.${field.name}`,
          depth + 1,
          budget,
        );
        if (child) return child;
      }
      return null;
    }
    default:
      return path;
  }
}

export function compileResultContractValidator(descriptor) {
  exactObject(descriptor, (() => {
    switch (descriptor?.kind) {
      case 'unknown': return ['kind'];
      case 'documents': return ['kind', 'table', 'document'];
      case 'records': return ['kind', 'record', 'rows'];
      case 'document': return ['kind', 'table', 'document'];
      case 'value': return ['kind', 'value'];
      case 'legacyQueryRowsV0': return ['kind', 'row'];
      default: throw invalid(`unsupported result contract kind ${JSON.stringify(descriptor?.kind)}`);
    }
  })(), 'result contract');

  let row = null;
  let direct = null;
  if (descriptor.kind === 'documents' || descriptor.kind === 'document') {
    if (typeof descriptor.table !== 'string' || descriptor.table.length === 0) {
      throw invalid('result contract table must be non-empty');
    }
    if (descriptor.kind === 'documents') row = descriptor.document;
    else direct = descriptor.document;
  } else if (descriptor.kind === 'records') {
    if (
      descriptor.record?.kind !== 'object'
      && !(
        descriptor.record?.kind === 'union'
        && descriptor.record.variants.every((variant) => variant?.kind === 'object')
      )
    ) {
      throw invalid('records result must carry an object or discriminated object-union contract');
    }
    if (descriptor.rows !== undefined) {
      exactObject(descriptor.rows, ['minItems', 'maxItems'], 'result contract rows');
      integer(descriptor.rows.minItems, 'result contract rows.minItems', {
        max: RESULT_CONTRACT_LIMITS_V1.maxArrayItems,
      });
      integer(descriptor.rows.maxItems, 'result contract rows.maxItems', {
        max: RESULT_CONTRACT_LIMITS_V1.maxArrayItems,
      });
      if (descriptor.rows.minItems > descriptor.rows.maxItems) {
        throw invalid('result contract row bounds require minItems <= maxItems');
      }
    }
    row = descriptor.record;
  } else if (descriptor.kind === 'legacyQueryRowsV0') row = descriptor.row;
  else if (descriptor.kind === 'value') direct = descriptor.value;

  if (row || direct) {
    admitValueContract(row ?? direct, 0, { objectFields: 0 }, 'result contract value');
  }

  return Object.freeze({
    kind: descriptor.kind,
    validate(value) {
      const image = jsonImage(value);
      if (!image.ok) return Object.freeze({ ok: false, path: '$', value: undefined });
      if (descriptor.kind === 'unknown') {
        const path = validateJson(
          image.value,
          0,
          RESULT_CONTRACT_LIMITS_V1.maxDepth,
          { nodes: 0 },
          '$',
        );
        return Object.freeze({ ok: path === null, path, value: path ? undefined : image.value });
      }
      const budget = { nodes: 0 };
      let path = null;
      if (row) {
        if (!Array.isArray(image.value)) path = '$';
        else if (
          descriptor.rows
          && (
            image.value.length < descriptor.rows.minItems
            || image.value.length > descriptor.rows.maxItems
          )
        ) path = '$';
        else {
          for (let index = 0; index < image.value.length && path === null; index += 1) {
            path = valuePath(row, image.value[index], `$[${index}]`, 1, budget);
          }
        }
      } else {
        path = valuePath(direct, image.value, '$', 0, budget);
      }
      return Object.freeze({ ok: path === null, path, value: path ? undefined : image.value });
    },
  });
}
