import { createHash } from 'node:crypto';
export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from '@snapback/contract/result-contract-validator';

// @ref LLP 0101#final-author-reconciliation-after-round-3 — the emitted
// contract is the schema-expanded effective contract, and its hash is over
// canonical JSON rather than an authored table-name shorthand.

export const RESULT_CONTRACT_VERSION = 1;
export const RESULT_MAX_BYTES = 4 * 1024 * 1024;
export const RESULT_MAX_STRING_BYTES = 1024 * 1024;
export const RESULT_MAX_ARRAY_ITEMS = 1024;
export const RESULT_MAX_DEPTH = 16;
export const RESULT_MAX_NODES = 65_536;
const JS_SAFE_INTEGER = 9_007_199_254_740_991;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));

export function resultContractHash(contract) {
  return `sha256:${createHash('sha256')
    .update('snapback:function-result:v1\n')
    .update(canonicalJson(contract))
    .digest('hex')}`;
}

export function argsContractHash(args) {
  return `sha256:${createHash('sha256')
    .update('snapback:function-args:v1\n')
    .update(canonicalJson(args ?? {}))
    .digest('hex')}`;
}

const scalar = (kind, extra = {}) => ({ kind, ...extra });

function invalidResultContract(message) {
  const error = new TypeError(`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: ${message}`);
  error.code = 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID';
  throw error;
}

function primitiveKind(contract) {
  if (contract.kind === 'null') return 'null';
  if (contract.kind === 'boolean') return 'boolean';
  if (['string', 'principal', 'id'].includes(contract.kind)) return 'string';
  if (['integer', 'finiteReal'].includes(contract.kind)) return 'number';
  if (contract.kind === 'array') return 'array';
  if (contract.kind === 'object') return 'object';
  if (contract.kind === 'literal') {
    if (contract.value === null) return 'null';
    if (Array.isArray(contract.value)) return 'array';
    return typeof contract.value;
  }
  return 'any-json';
}

function objectUnionHasDiscriminator(variants) {
  if (!variants.every((variant) => variant.kind === 'object' && variant.allowExtra === false)) {
    return false;
  }
  return variants[0].fields.some((candidate) => {
    if (!candidate.required || candidate.value.kind !== 'literal') return false;
    const values = [];
    for (const variant of variants) {
      const field = variant.fields.find(
        (entry) => entry.required && entry.name === candidate.name && entry.value.kind === 'literal',
      );
      if (!field) return false;
      values.push(canonicalJson(field.value.value));
    }
    return new Set(values).size === values.length;
  });
}

function primitiveUnionIsDisjoint(variants) {
  const groups = new Map();
  for (const variant of variants) {
    const kind = primitiveKind(variant);
    if (kind === 'any-json') return false;
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

function validateEffectiveResultContract(contract) {
  let objectFields = 0;
  const visit = (value, depth) => {
    if (depth > RESULT_MAX_DEPTH) invalidResultContract('contract depth exceeds 16');
    if (value.kind === 'string') {
      if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes < 0
        || value.maxBytes > RESULT_MAX_STRING_BYTES) {
        invalidResultContract('string maxBytes exceeds 1 MiB');
      }
    } else if (value.kind === 'integer') {
      if (!Number.isSafeInteger(value.min) || !Number.isSafeInteger(value.max)
        || value.min < -JS_SAFE_INTEGER || value.max > JS_SAFE_INTEGER || value.min > value.max) {
        invalidResultContract('integer bounds are invalid or outside JavaScript-safe integers');
      }
    } else if (value.kind === 'finiteReal') {
      if (!Number.isFinite(value.min) || !Number.isFinite(value.max) || value.min > value.max) {
        invalidResultContract('finite-real bounds are invalid');
      }
    } else if (value.kind === 'id') {
      if (typeof value.table !== 'string' || value.table.length === 0) {
        invalidResultContract('id contract names an empty table');
      }
    } else if (value.kind === 'literal') {
      if (
        value.value !== null
        && typeof value.value !== 'string'
        && typeof value.value !== 'boolean'
        && !(typeof value.value === 'number' && Number.isFinite(value.value))
      ) invalidResultContract('literal must be a finite JSON scalar');
    } else if (value.kind === 'json') {
      if (!Number.isSafeInteger(value.maxDepth) || value.maxDepth < 0
        || value.maxDepth > RESULT_MAX_DEPTH
        || !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 0
        || value.maxBytes > RESULT_MAX_STRING_BYTES) {
        invalidResultContract('JSON bounds exceed depth 16 or 1 MiB');
      }
    } else if (value.kind === 'array') {
      if (!Number.isSafeInteger(value.maxItems) || value.maxItems < 0
        || value.maxItems > RESULT_MAX_ARRAY_ITEMS) {
        invalidResultContract('array maxItems exceeds 1,024');
      }
      visit(value.element, depth + 1);
    } else if (value.kind === 'union') {
      if (value.variants.length < 2 || value.variants.length > 8) {
        invalidResultContract('union must contain 2–8 variants');
      }
      const primitiveDisjoint = primitiveUnionIsDisjoint(value.variants);
      if (!primitiveDisjoint && !objectUnionHasDiscriminator(value.variants)) {
        invalidResultContract('union variants are not syntactically disjoint');
      }
      for (const variant of value.variants) visit(variant, depth + 1);
    } else if (value.kind === 'object') {
      objectFields += value.fields.length;
      if (objectFields > 128) invalidResultContract('contract exceeds 128 object fields');
      const names = new Set();
      for (const field of value.fields) {
        if (typeof field.name !== 'string' || field.name.length === 0 || names.has(field.name)) {
          invalidResultContract('object field names must be non-empty and unique');
        }
        names.add(field.name);
        visit(field.value, depth + 1);
      }
    }
  };
  let value;
  if (contract.kind === 'documents' || contract.kind === 'document') {
    if (typeof contract.table !== 'string' || contract.table.length === 0) {
      invalidResultContract('document contract names an empty table');
    }
    value = contract.document;
  } else if (contract.kind === 'records') {
    if (contract.record.kind !== 'object' || contract.record.allowExtra !== false) {
      invalidResultContract('records requires a closed object');
    }
    value = contract.record;
  } else if (contract.kind === 'value') value = contract.value;
  else if (contract.kind === 'legacyQueryRowsV0') value = contract.row;
  if (value) visit(value, 0);
  return contract;
}

export function validatorResultValue(validator, {
  legacy = false,
} = {}) {
  if (!validator || validator.__validator !== true) {
    throw new TypeError('result value must be a Snapback validator');
  }
  const options = validator.resultOptions ?? {};
  let value;
  if (validator.resultKind === 'null') value = scalar('null');
  else if (validator.resultKind === 'literal') {
    value = scalar('literal', { value: validator.literal });
  } else if (validator.resultKind === 'array') {
    value = scalar('array', {
      element: validatorResultValue(validator.element, { legacy }),
      maxItems: options.maxItems ?? RESULT_MAX_ARRAY_ITEMS,
    });
  } else if (validator.resultKind === 'union') {
    value = scalar('union', {
      variants: validator.variants.map((variant) => validatorResultValue(variant, { legacy })),
    });
  } else if (validator.primitive === 'object') {
    value = scalar('object', {
      fields: Object.entries(validator.fields ?? {}).map(([name, field]) => ({
        name,
        required: field.optional !== true,
        value: validatorResultValue(field, { legacy }),
      })),
      allowExtra: legacy,
    });
  } else {
    const fieldType = validator.fieldType;
    if (fieldType === 'String') {
      value = scalar('string', {
        maxBytes: options.maxBytes ?? RESULT_MAX_STRING_BYTES,
      });
    } else if (fieldType === 'Boolean') value = scalar('boolean');
    else if (fieldType === 'Integer') {
      value = scalar('integer', {
        min: options.min ?? -JS_SAFE_INTEGER,
        max: options.max ?? JS_SAFE_INTEGER,
      });
    } else if (fieldType === 'Real') {
      value = scalar('finiteReal', {
        min: options.min ?? -Number.MAX_VALUE,
        max: options.max ?? Number.MAX_VALUE,
      });
    } else if (fieldType === 'Principal') value = scalar('principal');
    else if (fieldType && typeof fieldType === 'object' && fieldType.RelationIncarnation) {
      value = scalar('string', { maxBytes: 64 });
    }
    else if (fieldType && typeof fieldType === 'object' && fieldType.Id) {
      value = scalar('id', { table: fieldType.Id.table });
    } else if (fieldType === 'Json') {
      value = scalar('json', {
        maxDepth: options.maxDepth ?? RESULT_MAX_DEPTH,
        maxBytes: options.maxBytes ?? RESULT_MAX_STRING_BYTES,
      });
    } else {
      throw new TypeError(`unsupported result validator ${JSON.stringify(fieldType)}`);
    }
  }
  return value;
}

function tableDocumentValue(table, tables) {
  const definition = tables[table];
  if (!definition) throw new TypeError(`result contract references unknown table ${table}`);
  const fields = [
    { name: '_id', required: true, value: scalar('id', { table }) },
    {
      name: '_version',
      required: true,
      value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
    },
    {
      name: '_createdAt',
      required: true,
      value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
    },
    {
      name: '_updatedAt',
      required: true,
      value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
    },
  ];
  for (const field of definition.fields ?? []) {
    fields.push({
      name: field.name,
      // Storage materializes authored optionals as a present null.
      required: true,
      value: field.optional
        ? scalar('union', {
            variants: [
              scalar('null'),
              validatorResultValue({
                __validator: true,
                fieldType: field.field_type,
                primitive: typeof field.field_type === 'string'
                  ? field.field_type.toLowerCase()
                  : 'string',
                optional: false,
              }),
            ],
          })
        : validatorResultValue({
            __validator: true,
            fieldType: field.field_type,
            primitive: typeof field.field_type === 'string'
              ? field.field_type.toLowerCase()
              : 'string',
            optional: false,
          }),
    });
  }
  return scalar('object', { fields, allowExtra: false });
}

function tableFieldValue(field) {
  const value = validatorResultValue({
    __validator: true,
    fieldType: field.field_type,
    primitive: typeof field.field_type === 'string'
      ? field.field_type.toLowerCase()
      : 'string',
    optional: false,
  });
  // Search stores every declared projection key. An absent optional source
  // value is materialized as JSON null by the Rust authority.
  return field.optional
    ? scalar('union', { variants: [scalar('null'), value] })
    : value;
}

// @ref LLP 0073#ranking-order-and-cursors — the operation contract closes
// `fields` over exactly the declared stored projection. It is not an
// application-authored JSON escape hatch.
function searchRowsValue(runtime, tables) {
  const plan = runtime?.HostPlan?.SearchQuery;
  if (!plan) return null;
  const table = tables[plan.table];
  if (!table) throw new TypeError(`search result contract references unknown table ${plan.table}`);
  const index = (table.searchIndexes ?? []).find(({ name }) => name === plan.index);
  if (!index) {
    throw new TypeError(
      `search result contract references unknown index ${plan.table}.${plan.index}`,
    );
  }
  const sourceFields = new Map((table.fields ?? []).map((field) => [field.name, field]));
  const storedFields = (index.storedFields ?? []).map((name) => {
    const field = sourceFields.get(name);
    if (!field) {
      throw new TypeError(
        `search result contract references unknown stored field ${plan.table}.${name}`,
      );
    }
    return { name, required: true, value: tableFieldValue(field) };
  });
  return {
    kind: 'records',
    record: scalar('object', {
      allowExtra: false,
      fields: [
        {
          name: 'rowId',
          required: true,
          value: scalar('id', { table: plan.table }),
        },
        {
          name: 'score',
          required: true,
          value: scalar('integer', { min: 0, max: 22_937_600 }),
        },
        {
          name: 'fields',
          required: true,
          value: scalar('object', { fields: storedFields, allowExtra: false }),
        },
        {
          name: 'highlights',
          required: true,
          value: scalar('array', {
            maxItems: 3,
            element: scalar('object', {
              allowExtra: false,
              fields: [
                {
                  name: 'field',
                  required: true,
                  value: scalar('string', { maxBytes: RESULT_MAX_STRING_BYTES }),
                },
                {
                  name: 'text',
                  required: true,
                  value: scalar('string', { maxBytes: 256 }),
                },
                {
                  name: 'matches',
                  required: true,
                  value: scalar('array', {
                    maxItems: 8,
                    element: scalar('object', {
                      allowExtra: false,
                      fields: [
                        {
                          name: 'start',
                          required: true,
                          value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
                        },
                        {
                          name: 'end',
                          required: true,
                          value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
                        },
                      ],
                    }),
                  }),
                },
              ],
            }),
          }),
        },
      ],
    }),
  };
}

function authoredContract(spec, tables) {
  if (!spec) return null;
  if (spec.kind === 'documents') {
    return {
      kind: 'documents',
      table: spec.table,
      document: tableDocumentValue(spec.table, tables),
    };
  }
  if (spec.kind === 'document') {
    return {
      kind: 'document',
      table: spec.table,
      document: tableDocumentValue(spec.table, tables),
    };
  }
  if (spec.kind === 'records') {
    const record = validatorResultValue(spec.validator);
    if (record.kind !== 'object') throw new TypeError('results.records() requires v.object(...)');
    return { kind: 'records', record };
  }
  if (spec.kind === 'value') {
    return { kind: 'value', value: validatorResultValue(spec.validator) };
  }
  throw new TypeError(`unsupported result contract kind ${JSON.stringify(spec.kind)}`);
}

function legacyRows(validator) {
  const row = validatorResultValue(validator, { legacy: true });
  if (row.kind !== 'object') throw new TypeError('legacy query result must be v.object(...)');
  const system = [
    { name: '_id', required: true, value: scalar('string', { maxBytes: RESULT_MAX_STRING_BYTES }) },
    { name: '_version', required: true, value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }) },
    { name: '_createdAt', required: true, value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }) },
    { name: '_updatedAt', required: true, value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }) },
  ];
  return {
    kind: 'legacyQueryRowsV0',
    row: { ...row, fields: [...system, ...row.fields], allowExtra: true },
  };
}

export function effectiveResultContract({
  def,
  functionKind,
  runtime,
  tables,
}) {
  if (def?.resultContract) {
    const query = functionKind === 'Query' || functionKind === 'LiveQuery';
    const allowed = query
      ? new Set(['documents', 'records'])
      : new Set(['document', 'value']);
    if (!allowed.has(def.resultContract.kind)) {
      throw new TypeError(
        `${functionKind} cannot use ${String(def.resultContract.kind)} result contract`,
      );
    }
  }
  const authored = authoredContract(def?.resultContract, tables);
  if (authored) return validateEffectiveResultContract(authored);
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && def?.result
  ) return validateEffectiveResultContract(legacyRows(def.result));
  const queryTable = runtime?.HostPlan?.Query?.table;
  if ((functionKind === 'Query' || functionKind === 'LiveQuery') && queryTable) {
    return validateEffectiveResultContract({
      kind: 'documents',
      table: queryTable,
      document: tableDocumentValue(queryTable, tables),
    });
  }
  if (functionKind === 'Query' && runtime?.HostPlan?.SearchQuery) {
    return validateEffectiveResultContract(searchRowsValue(runtime, tables));
  }
  const returnedDocument = runtime?.HostPlan?.Mutation?.return_value?.Document?.table;
  if (functionKind === 'Mutation' && returnedDocument) {
    return validateEffectiveResultContract({
      kind: 'document',
      table: returnedDocument,
      document: tableDocumentValue(returnedDocument, tables),
    });
  }
  return { kind: 'unknown' };
}

export function resultContractType(contract, tableType = (table) => `GeneratedDataModel[${JSON.stringify(table)}]`) {
  if (contract.kind === 'documents') return `ReadonlyArray<${tableType(contract.table)}>`;
  if (contract.kind === 'document') return tableType(contract.table);
  if (contract.kind === 'records') return `ReadonlyArray<${resultValueType(contract.record)}>`;
  if (contract.kind === 'value') return resultValueType(contract.value);
  if (contract.kind === 'legacyQueryRowsV0') {
    return `ReadonlyArray<${resultValueType(contract.row)}>`;
  }
  return 'unknown';
}

export function searchPageResultType(contract) {
  if (contract?.kind !== 'records' || contract.record?.kind !== 'object') {
    return 'SearchPageV1';
  }
  const fields = contract.record.fields.find(({ name }) => name === 'fields')?.value;
  const rowId = contract.record.fields.find(({ name }) => name === 'rowId')?.value;
  if (fields?.kind !== 'object' || rowId === undefined) return 'SearchPageV1';
  return `SearchPageV1<${resultValueType(fields)}, ${resultValueType(rowId)}>`;
}

function resultValueType(value) {
  if (value.kind === 'null') return 'null';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'string' || value.kind === 'principal') return 'string';
  if (value.kind === 'id') return `Id<${JSON.stringify(value.table)}>`;
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'json') return 'unknown';
  if (value.kind === 'array') return `ReadonlyArray<${resultValueType(value.element)}>`;
  if (value.kind === 'union') return value.variants.map(resultValueType).join(' | ');
  if (value.kind === 'object') {
    return `{ ${value.fields.map((field) => (
      `${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${resultValueType(field.value)}`
    )).join('; ')} }`;
  }
  return 'unknown';
}
