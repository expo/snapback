import { createHash } from 'node:crypto';

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
  const authored = authoredContract(def?.resultContract, tables);
  if (authored) return authored;
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && def?.result
  ) return legacyRows(def.result);
  const queryTable = runtime?.HostPlan?.Query?.table;
  if ((functionKind === 'Query' || functionKind === 'LiveQuery') && queryTable) {
    return {
      kind: 'documents',
      table: queryTable,
      document: tableDocumentValue(queryTable, tables),
    };
  }
  const returnedDocument = runtime?.HostPlan?.Mutation?.return_value?.Document?.table;
  if (functionKind === 'Mutation' && returnedDocument) {
    return {
      kind: 'document',
      table: returnedDocument,
      document: tableDocumentValue(returnedDocument, tables),
    };
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
