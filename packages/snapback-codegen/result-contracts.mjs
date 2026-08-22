import { createHash } from 'node:crypto';
export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from '@expo/snapback-contract/result-contract-validator';

// @ref LLP 0108#final-author-reconciliation-after-round-3 — the emitted
// contract is the schema-expanded effective contract, and its hash is over
// canonical JSON rather than an authored table-name shorthand.

export const RESULT_CONTRACT_VERSION = 1;
export const RESULT_MAX_BYTES = 4 * 1024 * 1024;
export const RESULT_MAX_STRING_BYTES = 1024 * 1024;
export const RESULT_MAX_ARRAY_ITEMS = 1024;
export const VECTOR_MAX_DIMENSIONS = 4096;
export const VECTOR_COMPONENT_ABS_MAX = 2 ** 100;
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

// @ref LLP 0131#identity-and-hashing — the args witness is computed over the
// canonical extended descriptor under the v2 domain, replacing v1 (which
// hashed a bounds-blind projection). SchemaRef nodes contribute their
// reference id, never referenced-artifact bytes. Every function's
// argsContractHash changed once, visibly, at adoption.
export function argsContractHash(contract) {
  return `sha256:${createHash('sha256')
    .update('snapback:function-args:v2\n')
    .update(canonicalJson(contract ?? { fields: [] }))
    .digest('hex')}`;
}

/**
 * Build FunctionArgsContractV1 (LLP 0131 §The argument-contract descriptor):
 * one closed object contract over the declared arguments, declaration-
 * ordered, each field carrying a value node from the same vocabulary the
 * result manifest uses — bounds included — plus the platform-owned SchemaRef
 * node. Validated under the shared node/bounds profile before emission.
 */
export function effectiveArgsContract(args) {
  const fields = Object.entries(args ?? {}).map(([name, validator]) => ({
    name,
    required: validator?.optional !== true,
    value: validatorResultValue(validator, { args: true }),
  }));
  validateEffectiveResultContract({
    kind: 'value',
    value: { kind: 'object', fields, allowExtra: false },
  });
  return { fields };
}

const SCHEMA_REF_REGISTRY_V1 = new Set(['snapback:search-query-ast:v1']);

const scalar = (kind, extra = {}) => ({ kind, ...extra });

function invalidResultContract(message) {
  const error = new TypeError(`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: ${message}`);
  error.code = 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID';
  throw error;
}

function primitiveKind(contract) {
  if (contract.kind === 'null') return 'null';
  if (contract.kind === 'boolean') return 'boolean';
  if (['string', 'principal', 'assetRef', 'id'].includes(contract.kind)) return 'string';
  if (['integer', 'finiteReal'].includes(contract.kind)) return 'number';
  if (contract.kind === 'array' || contract.kind === 'tuple' || contract.kind === 'vector') return 'array';
  if (contract.kind === 'object' || contract.kind === 'mediaRef.v1') return 'object';
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
    } else if (value.kind === 'tuple') {
      if (!Array.isArray(value.elements) || value.elements.length < 1 || value.elements.length > 8) {
        invalidResultContract('tuple must contain 1–8 elements');
      }
      for (const element of value.elements) visit(element, depth + 1);
    } else if (value.kind === 'vector') {
      if (!Number.isSafeInteger(value.dimensions)
        || value.dimensions < 1
        || value.dimensions > VECTOR_MAX_DIMENSIONS) {
        invalidResultContract('vector dimensions must be in 1..=4,096');
      }
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
    const closedRecord = contract.record.kind === 'object'
      && contract.record.allowExtra === false;
    const sealedRecordUnion = contract.record.kind === 'union'
      && contract.record.variants.every(
        (variant) => variant.kind === 'object' && variant.allowExtra === false,
      );
    if (!closedRecord && !sealedRecordUnion) {
      invalidResultContract('records requires a closed object or discriminated union of closed objects');
    }
    if (contract.rows !== undefined && (
      !Number.isSafeInteger(contract.rows.minItems)
      || !Number.isSafeInteger(contract.rows.maxItems)
      || contract.rows.minItems < 0
      || contract.rows.minItems > contract.rows.maxItems
      || contract.rows.maxItems > RESULT_MAX_ARRAY_ITEMS
    )) {
      invalidResultContract('records row bounds require 0 <= minItems <= maxItems <= 1,024');
    }
    value = contract.record;
  } else if (contract.kind === 'value') value = contract.value;
  else if (contract.kind === 'legacyQueryRowsV0') value = contract.row;
  if (value) visit(value, 0);
  return contract;
}

export function validatorResultValue(validator, {
  legacy = false,
  args = false,
  tables,
  mediaSource,
} = {}) {
  if (!validator || validator.__validator !== true) {
    throw new TypeError('result value must be a Snapback validator');
  }
  const options = validator.resultOptions ?? {};
  let value;
  if (validator.primitive === 'platformSchemaRef') {
    // @ref LLP 0131#the-argument-contract-descriptor — argument-lane only;
    // the reference id must name the closed platform registry, and the
    // authority class is a closed enum with exactly `platform` in v1.
    const reference = validator.fieldType?.PlatformSchemaRef;
    if (
      !args
      || reference?.authority !== 'platform'
      || typeof reference?.schema !== 'string'
      || !SCHEMA_REF_REGISTRY_V1.has(reference.schema)
    ) {
      throw new TypeError(`unsupported schema reference ${JSON.stringify(reference?.schema)}`);
    }
    value = scalar('platformSchemaRef', { authority: 'platform', schema: reference.schema });
  } else if (validator.primitive === 'appSchemaRef') {
    // @ref LLP 0127#move-1--contracts-reference-nothing-respells — app
    // document references are result-authoring sugar only. Resolve them to
    // the existing frozen structural contract before validation and hashing;
    // neither the wire grammar nor the argument grammar gains a new node.
    const reference = validator.fieldType?.AppSchemaRef;
    if (
      args
      || legacy
      || reference?.authority !== 'app'
      || typeof reference?.table !== 'string'
      || reference.table.length === 0
      || !tables
    ) {
      throw new TypeError(`unsupported app schema reference ${JSON.stringify(reference?.table)}`);
    }
    value = tableDocumentValue(reference.table, tables);
  } else if (validator.resultKind === 'vector') {
    value = scalar('vector', { dimensions: validator.dimensions });
  } else if (validator.resultKind === 'null') value = scalar('null');
  else if (validator.resultKind === 'literal') {
    value = scalar('literal', { value: validator.literal });
  } else if (validator.resultKind === 'array') {
    value = scalar('array', {
      element: validatorResultValue(validator.element, { legacy, args, tables }),
      maxItems: options.maxItems ?? RESULT_MAX_ARRAY_ITEMS,
    });
  } else if (validator.resultKind === 'tuple') {
    value = scalar('tuple', {
      elements: validator.elements.map((element) => validatorResultValue(element, { legacy, args, tables })),
    });
  } else if (validator.resultKind === 'union') {
    value = scalar('union', {
      variants: validator.variants.map((variant) => validatorResultValue(variant, { legacy, args, tables })),
    });
  } else if (validator.primitive === 'object') {
    value = scalar('object', {
      fields: Object.entries(validator.fields ?? {}).map(([name, field]) => ({
        name,
        required: field.optional !== true,
        value: validatorResultValue(field, { legacy, args, tables }),
      })),
      allowExtra: legacy,
    });
  } else {
    const fieldType = validator.fieldType;
    if (fieldType === 'String') {
      value = scalar('string', {
        maxBytes: options.maxBytes ?? RESULT_MAX_STRING_BYTES,
      });
    } else if (fieldType && typeof fieldType === 'object' && fieldType.Enum) {
      value = scalar('union', {
        variants: fieldType.Enum.values.map((literal) => scalar('literal', { value: literal })),
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
    else if (fieldType && typeof fieldType === 'object' && fieldType.Vector) {
      value = scalar('vector', { dimensions: fieldType.Vector.dimensions });
    }
    else if (fieldType && typeof fieldType === 'object' && fieldType.AssetRef) {
      const media = fieldType.AssetRef.media;
      if (!media) value = scalar('assetRef');
      else {
        if (args || !mediaSource) {
          throw new TypeError('v.media() is a top-level stored field projection, not an argument or anonymous result validator');
        }
        const sourceFieldGeneration = `sha256:${createHash('sha256')
          .update('snapback:media-source-field-generation:v1\n')
          .update(canonicalJson({
            table: mediaSource.table,
            field: mediaSource.field,
            descriptor: media,
          }))
          .digest('hex')}`;
        value = scalar('mediaRef.v1', {
          sourceTable: mediaSource.table,
          sourceField: mediaSource.field,
          sourceFieldGeneration,
          optional: mediaSource.optional === true,
          classMTreatment: 'class-m.none.v1',
          uploadIntent: media.intent,
          policyGeneration: media.policy,
          kinds: [...media.kinds],
          delivery: media.delivery ?? null,
          variants: [...(media.variants ?? [])],
          classificationProfile: media.classificationProfile,
          retentionClass: media.retentionClass,
        });
      }
    }
    else if (fieldType && typeof fieldType === 'object' && fieldType.RelationIncarnation) {
      // @ref LLP 0131#the-argument-contract-descriptor — normalization rule:
      // at argument positions a relation incarnation is the `string` node
      // with the profile-maximum byte bound. Incarnation values on the wire
      // are host-minted UUIDv7 tokens, not parent row ids — an
      // id(parentTable) projection would type-admit a genuine parent row id
      // while rejecting a held token. Whether a token names the active
      // incarnation stays the relation machinery's runtime check (LLP 0110).
      // Accepted consequence: v.string() and an incarnation argument are
      // witness-identical. The result lane keeps its shipped 64-byte string
      // mapping (resultContractHash is untouched).
      value = args
        ? scalar('string', { maxBytes: RESULT_MAX_STRING_BYTES })
        : scalar('string', { maxBytes: 64 });
    }
    else if (fieldType && typeof fieldType === 'object' && fieldType.Id) {
      value = scalar('id', { table: fieldType.Id.table });
    } else if (fieldType && typeof fieldType === 'object' && fieldType.Vector) {
      // The storage field is structurally fixed by the schema manifest; the
      // shared LLP 0108 result vocabulary caps ordinary arrays at 1,024, while
      // vector storage admits 4,096 dimensions. Preserve safe validation as a
      // bounded JSON value here; VectorPageV1 never releases source vectors.
      if (args) throw new TypeError('v.vector() is a schema validator, not an argument validator');
      value = scalar('json', { maxDepth: 1, maxBytes: 32 * 1024 });
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

// Build and validate the exact recursive descriptor persisted by a
// StoredStructuredContractV1 carrier. This deliberately runs the shared
// LLP 0131 node/bounds/disjointness validator before the carrier is hashed.
// @ref LLP 0211#declaration-closed-dispatch-closed-interior
export function storedStructuredContractDescriptor(validator) {
  const value = validatorResultValue(validator);
  validateEffectiveResultContract({ kind: 'value', value });
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
    const stored = field.field_type?.Structured
      ? structuredClone(field.field_type.Structured.contract.descriptor)
      : validatorResultValue({
          __validator: true,
          fieldType: field.field_type,
          primitive: typeof field.field_type === 'string'
            ? field.field_type.toLowerCase()
            : 'string',
          optional: false,
        }, { mediaSource: { table, field: field.name, optional: field.optional } });
    fields.push({
      name: field.name,
      // Storage materializes authored optionals as a present null.
      required: true,
      value: field.optional
        // JSON already includes null. Wrapping it in null|json creates an
        // overlapping union that the closed contract grammar must reject.
        ? (stored.kind === 'json' ? stored : nullableValue(stored))
        : stored,
    });
  }
  return scalar('object', { fields, allowExtra: false });
}

function tableFieldValue(field, table) {
  const value = field.field_type?.Structured
    ? structuredClone(field.field_type.Structured.contract.descriptor)
    : validatorResultValue({
        __validator: true,
        fieldType: field.field_type,
        primitive: typeof field.field_type === 'string'
          ? field.field_type.toLowerCase()
          : 'string',
        optional: false,
      }, { mediaSource: { table, field: field.name, optional: field.optional } });
  // Search stores every declared projection key. An absent optional source
  // value is materialized as JSON null by the Rust authority.
  return field.optional
    ? (value.kind === 'json' ? value : nullableValue(value))
    : value;
}

function nullableValue(value) {
  if (value.kind === 'null') return value;
  if (
    value.kind === 'union'
    && value.variants.some((variant) => variant.kind === 'null')
  ) return value;
  if (value.kind === 'union') {
    return scalar('union', { variants: [scalar('null'), ...value.variants] });
  }
  return scalar('union', { variants: [scalar('null'), value] });
}

// `bounded-children.v1` normally carries an authored sealed union, but media
// leaves need their exact schema source identity and therefore cannot be
// lowered as anonymous validators. Derive the same closed union from the plan
// and table manifests so a child `AssetRef.media` becomes the one canonical
// `mediaRef.v1` node rather than a second collection-only value shape.
// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
function boundedChildrenRowsValue(runtime, tables) {
  const plan = runtime.HostPlan.BoundedChildrenQuery;
  const resultField = (name, value) => ({ name, required: true, value });
  const projected = (tableName, projection) => {
    const table = tables[tableName];
    if (!table) throw new TypeError(`bounded children references unknown table ${tableName}`);
    return scalar('object', {
      fields: projection.map(({ name, field: sourceName }) => {
        if (sourceName === '_id') {
          return resultField(name, scalar('id', { table: tableName }));
        }
        const source = table.fields.find((candidate) => candidate.name === sourceName);
        if (!source) {
          throw new TypeError(`bounded children projection references unknown field ${tableName}.${sourceName}`);
        }
        return resultField(name, tableFieldValue(source, tableName));
      }),
      allowExtra: false,
    });
  };
  const parent = projected(plan.parentTable, plan.parentProjection);
  const child = projected(plan.childTable, plan.childProjection);
  const envelope = (kind, parentValue, maxItems, continuation) => scalar('object', {
    fields: [
      resultField('kind', scalar('literal', { value: kind })),
      resultField('parent', parentValue),
      resultField('children', scalar('array', { element: child, maxItems })),
      resultField('continuation', continuation),
    ],
    allowExtra: false,
  });
  return {
    kind: 'records',
    record: scalar('union', {
      variants: [
        envelope('absent', scalar('null'), 0, scalar('null')),
        envelope(
          'visible',
          parent,
          plan.take,
          scalar('union', {
            variants: [scalar('null'), scalar('string', { maxBytes: 1_024 })],
          }),
        ),
      ],
    }),
    rows: { minItems: 1, maxItems: 1 },
  };
}

// @ref LLP 0080#1-closed-relational-plan — the projection is closed data,
// so its result contract is derivable from the two schema declarations plus
// literal leaves; there is no handler body whose return shape must be guessed.
// @ref LLP 0080#2-portable-evaluation-semantics — left joins materialize an
// absent or invisible joined row as present `null` leaves, never omitted keys.
function relationalRowsValue(runtime, tables) {
  const plan = runtime?.HostPlan?.RelationalQuery;
  if (!plan) return null;
  const sourceFields = (tableName) => {
    const table = tables[tableName];
    if (!table) {
      throw new TypeError(`relational result contract references unknown table ${tableName}`);
    }
    return new Map((table.fields ?? []).map((field) => [field.name, field]));
  };
  const rootFields = sourceFields(plan.root);
  const joinedFields = sourceFields(plan.joined);
  const projected = (fields, tableName, fieldName, nullable) => {
    const field = fields.get(fieldName);
    if (!field) {
      throw new TypeError(
        `relational result contract references unknown field ${tableName}.${fieldName}`,
      );
    }
    const value = tableFieldValue(field, tableName);
    return nullable ? nullableValue(value) : value;
  };
  const fields = plan.projection.map((leaf) => {
    if (Object.hasOwn(leaf.source, 'RootField')) {
      return {
        name: leaf.name,
        required: true,
        value: projected(rootFields, plan.root, leaf.source.RootField, false),
      };
    }
    if (Object.hasOwn(leaf.source, 'JoinedField')) {
      return {
        name: leaf.name,
        required: true,
        value: projected(
          joinedFields,
          plan.joined,
          leaf.source.JoinedField,
          plan.joinKind === 'Left',
        ),
      };
    }
    if (Object.hasOwn(leaf.source, 'Literal')) {
      return {
        name: leaf.name,
        required: true,
        value: scalar('literal', { value: leaf.source.Literal }),
      };
    }
    throw new TypeError(
      `relational result contract has unknown projection source for ${leaf.name}`,
    );
  });
  return {
    kind: 'records',
    rows: { minItems: 0, maxItems: plan.take },
    record: scalar('object', { fields, allowExtra: false }),
  };
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
    return { name, required: true, value: tableFieldValue(field, plan.table) };
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

// @ref LLP 0132#query-surface — rows inside QueryOutput are exactly the
// item carrier. The source vector is categorically excluded from storedFields.
function vectorRowsValue(runtime, tables) {
  const plan = runtime?.HostPlan?.VectorQuery;
  if (!plan) return null;
  const table = tables[plan.table];
  if (!table) throw new TypeError(`vector result contract references unknown table ${plan.table}`);
  const index = (table.vectorIndexes ?? []).find(({ name }) => name === plan.index);
  if (!index) throw new TypeError(`vector result contract references unknown index ${plan.table}.${plan.index}`);
  const sourceFields = new Map((table.fields ?? []).map((field) => [field.name, field]));
  const storedFields = (index.storedFields ?? []).map((name) => {
    const field = sourceFields.get(name);
    if (!field) throw new TypeError(`vector result contract references unknown stored field ${plan.table}.${name}`);
    if (field.field_type?.Vector) throw new TypeError('vector storedFields must not expose source vectors');
    return { name, required: true, value: tableFieldValue(field, plan.table) };
  });
  return {
    kind: 'records',
    rows: { minItems: 0, maxItems: 64 },
    record: scalar('object', {
      allowExtra: false,
      fields: [
        { name: 'rowId', required: true, value: scalar('id', { table: plan.table }) },
        {
          name: 'distance',
          required: true,
          value: scalar('finiteReal', { min: -Number.MAX_VALUE, max: Number.MAX_VALUE }),
        },
        {
          name: 'fields',
          required: true,
          value: scalar('object', { fields: storedFields, allowExtra: false }),
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
    // A top-level v.doc(T) is exactly the already-shipped documents(T)
    // contract, including its identity. Normalize before hashing so adding
    // the composable authoring node does not fork the existing witness.
    if (
      spec.validator?.primitive === 'appSchemaRef'
      && spec.rows === undefined
    ) {
      const reference = spec.validator.fieldType?.AppSchemaRef;
      if (reference?.authority !== 'app' || typeof reference?.table !== 'string') {
        throw new TypeError(`unsupported app schema reference ${JSON.stringify(reference?.table)}`);
      }
      return {
        kind: 'documents',
        table: reference.table,
        document: tableDocumentValue(reference.table, tables),
      };
    }
    const record = validatorResultValue(spec.validator, { tables });
    if (
      record.kind !== 'object'
      && !(
        record.kind === 'union'
        && record.variants.every((variant) => variant.kind === 'object')
      )
    ) {
      throw new TypeError('results.records() requires v.object(...), v.doc(...), or a discriminated object union');
    }
    return {
      kind: 'records',
      record,
      ...(spec.rows === undefined ? {} : { rows: { ...spec.rows } }),
    };
  }
  if (spec.kind === 'value') {
    return { kind: 'value', value: validatorResultValue(spec.validator, { tables }) };
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

// @ref LLP 0070#inspection-audit-and-recovery — the declared job-status query serves the
// Rust-owned lifecycle projection (`JobStatusRow::to_row_value` in
// src/jobs.rs); its shape is platform-complete by construction and
// `defineJobStatusQuery` deliberately refuses authored result contracts.
// Emitting the exact projection here keeps the generated types, provider
// introspection, and manifest contract precise and prevents the
// degraded-result advisory from asking authors for a declaration the
// surface refuses to accept
// (issues/closed/20260801-0137-reverify-jobstatus-declaration-degraded-advisory.md).
const nullable = (value) => scalar('union', { variants: [scalar('null'), value] });

function jobStatusRowsValue() {
  const jobString = () => scalar('string', { maxBytes: RESULT_MAX_STRING_BYTES });
  const jobInteger = () => scalar('integer', { min: 0, max: JS_SAFE_INTEGER });
  const field = (name, value) => ({ name, required: true, value });
  return {
    kind: 'records',
    record: {
      kind: 'object',
      allowExtra: false,
      fields: [
        field('_id', jobString()),
        field('jobId', jobString()),
        field('queue', jobString()),
        field('action', jobString()),
        field('state', scalar('union', {
          variants: ['pending', 'claimed', 'succeeded', 'dead', 'cancelled']
            .map((state) => scalar('literal', { value: state })),
        })),
        field('availableAtMs', jobInteger()),
        field('enqueuedAtMs', jobInteger()),
        field('attemptCount', jobInteger()),
        field('maxAttempts', jobInteger()),
        field('stateVersion', jobInteger()),
        field('terminalAtMs', nullable(jobInteger())),
        field('lastErrorCode', nullable(jobString())),
        field('producerMutationId', jobString()),
        field('producerSnapshotVersion', nullable(jobInteger())),
        field('producerFunction', jobString()),
      ],
    },
  };
}

// @ref LLP 0143#d6-activation-migration-and-the-no-op-posture — the generated
// ledger query is platform-shaped so packaged types cannot accidentally grow
// token bytes, payload fields, or raw provider prose.
function pushLedgerRowsValue() {
  const text = () => scalar('string', { maxBytes: RESULT_MAX_STRING_BYTES });
  const integer = () => scalar('integer', { min: 0, max: JS_SAFE_INTEGER });
  const literalUnion = (values) => scalar('union', {
    variants: values.map((value) => scalar('literal', { value })),
  });
  const field = (name, value) => ({ name, required: true, value });
  const optionalText = () => nullable(text());
  const optionalInteger = () => nullable(integer());
  return {
    kind: 'records',
    record: {
      kind: 'object',
      allowExtra: false,
      fields: [
        field('_id', text()),
        field('intentId', text()),
        field('triggerMode', literalUnion(['immediate', 'system', 'deferred'])),
        // The closed result grammar caps a literal union at eight variants;
        // the host projection still owns and tests the ten-state vocabulary.
        field('intentState', text()),
        field('attemptCount', integer()),
        field('createdAtMs', integer()),
        field('updatedAtMs', integer()),
        field('expiresAtMs', integer()),
        field('batchId', optionalText()),
        field('attemptNumber', optionalInteger()),
        field('batchIndex', optionalInteger()),
        field('batchState', optionalText()),
        field('transmittingAtMs', optionalInteger()),
        field('settledAtMs', optionalInteger()),
        field('httpStatus', optionalInteger()),
        field('requestErrorCode', optionalText()),
        field('previousAmbiguous', nullable(scalar('boolean'))),
        field('messageId', optionalText()),
        field('tokenId', optionalText()),
        field('messageState', optionalText()),
        field('ticketId', optionalText()),
        field('receiptPollCount', optionalInteger()),
        field('nextReceiptPollAtMs', optionalInteger()),
        field('receiptWindowClosesAtMs', optionalInteger()),
        field('handedToExpoAtMs', optionalInteger()),
        field('expoAcceptedAtMs', optionalInteger()),
        field('expoErrorCode', optionalText()),
        field('retirementEffect', nullable(scalar('boolean'))),
      ],
    },
  };
}

// @ref LLP 0275#d3-derive-exact-result-contracts-from-closed-plans — binding
// shadowing and nullable document lookup are part of the exact derivation;
// opaque return expressions stay unknown.
function planDerivedResultContract({ runtime, tables }) {
  const plan = runtime?.HostPlan?.Mutation;
  if (!plan) return null;
  const returned = plan.return_value;
  if (returned === 'ChangedCount') {
    return validateEffectiveResultContract({
      kind: 'value',
      value: scalar('integer', { min: 0, max: JS_SAFE_INTEGER }),
    });
  }
  if (returned?.Binding) {
    // Mutation bindings are an evaluation-ordered mutable namespace. Derive
    // an id only when the final write to the returned binding is an insert;
    // an earlier insert may be shadowed by Insert, Get, Let, or allocation.
    const finalWrite = [...(plan.steps ?? [])].reverse().find((step) => (
      step.Insert?.bind_id_as === returned.Binding
      || step.Get?.bind_as === returned.Binding
      || step.Let?.bind_as === returned.Binding
      || step.AllocateSequence?.into === returned.Binding
    ));
    const insert = finalWrite?.Insert;
    if (!insert) return null;
    if (!tables[insert.table]) {
      throw new TypeError(`plan-derived binding references unknown table ${insert.table}`);
    }
    return validateEffectiveResultContract({
      kind: 'value',
      value: scalar('id', { table: insert.table }),
    });
  }
  if (returned?.Document?.table) {
    return validateEffectiveResultContract({
      kind: 'value',
      value: nullable(tableDocumentValue(returned.Document.table, tables)),
    });
  }
  return null;
}

function authoredContractContainsDerived(authored, derived) {
  if (canonicalJson(authored) === canonicalJson(derived)) return true;
  if (authored?.kind !== 'value' || derived?.kind !== 'value') return false;
  const authoredValue = authored.value;
  const derivedValue = derived.value;
  if (authoredValue?.kind === 'integer' && derivedValue?.kind === 'integer') {
    return authoredValue.min <= derivedValue.min && authoredValue.max >= derivedValue.max;
  }
  return false;
}

export function effectiveResultContractFacts({
  def,
  functionKind,
  runtime,
  tables,
}) {
  if (def?.resultContract) {
    const query = functionKind === 'Query' || functionKind === 'LiveQuery';
    const allowed = query // @ref LLP 0108#query-single-value-egress--2026-08-15 — generated query kinds match the runtime's one-row carrier.
      ? new Set(['documents', 'records', 'document', 'value'])
      : new Set(['document', 'value']);
    if (!allowed.has(def.resultContract.kind)) {
      throw new TypeError(
        `${functionKind} cannot use ${String(def.resultContract.kind)} result contract`,
      );
    }
  }
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && runtime?.HostPlan?.BoundedChildrenQuery
  ) {
    return {
      contract: validateEffectiveResultContract(boundedChildrenRowsValue(runtime, tables)),
      provenance: 'platform-derived',
    };
  }
  const authored = authoredContract(def?.resultContract, tables);
  const derived = functionKind === 'Mutation'
    ? planDerivedResultContract({ runtime, tables })
    : null;
  if (authored && derived && !authoredContractContainsDerived(authored, derived)) {
    throw new TypeError(
      `authored result contract conflicts with the closed plan-derived contract; remove result: or make it compatible with ${canonicalJson(derived)}`,
    );
  }
  if (authored && derived) {
    return {
      contract: derived,
      provenance: 'authored-compatible-plan-derived',
    };
  }
  if (authored) {
    return {
      contract: validateEffectiveResultContract(authored),
      provenance: 'authored',
    };
  }
  if (derived) return { contract: derived, provenance: 'plan-derived' };
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && def?.result
  ) return {
    contract: validateEffectiveResultContract(legacyRows(def.result)),
    provenance: 'authored',
  };
  const queryTable = runtime?.HostPlan?.Query?.table;
  if ((functionKind === 'Query' || functionKind === 'LiveQuery') && queryTable) {
    return {
      contract: validateEffectiveResultContract({
        kind: 'documents',
        table: queryTable,
        document: tableDocumentValue(queryTable, tables),
      }),
      provenance: 'plan-derived',
    };
  }
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && runtime?.HostPlan?.SearchQuery
  ) {
    return { contract: validateEffectiveResultContract(searchRowsValue(runtime, tables)), provenance: 'plan-derived' };
  }
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && runtime?.HostPlan?.RelationalQuery
  ) {
    return { contract: validateEffectiveResultContract(relationalRowsValue(runtime, tables)), provenance: 'plan-derived' };
  }
  if (functionKind === 'Query' && runtime?.HostPlan?.VectorQuery) {
    return { contract: validateEffectiveResultContract(vectorRowsValue(runtime, tables)), provenance: 'plan-derived' };
  }
  if (
    (functionKind === 'Query' || functionKind === 'LiveQuery')
    && runtime?.HostPlan?.JobStatusQuery
  ) {
    return { contract: validateEffectiveResultContract(jobStatusRowsValue()), provenance: 'platform-derived' };
  }
  if (functionKind === 'Query' && runtime?.HostPlan?.PushLedgerQuery) {
    return { contract: validateEffectiveResultContract(pushLedgerRowsValue()), provenance: 'platform-derived' };
  }
  return { contract: { kind: 'unknown' }, provenance: 'unknown' };
}

export function effectiveResultContract(args) {
  return effectiveResultContractFacts(args).contract;
}

// @ref LLP 0244#d4-result-artifact-retention-and-rqs-identity-rotate-explicitly
// — operation result types follow the expanded result contract. In particular,
// a media-bearing document is not the physical string-valued storage model.
export function resultContractType(contract) {
  if (contract.kind === 'documents') {
    return `ReadonlyArray<${resultValueType(contract.document)}>`;
  }
  if (contract.kind === 'document') return resultValueType(contract.document);
  if (contract.kind === 'records') {
    const row = resultValueType(contract.record);
    return contract.rows?.minItems === 1 && contract.rows?.maxItems === 1
      ? `readonly [${row}]`
      : `ReadonlyArray<${row}>`;
  }
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

export function vectorPageResultType(contract) {
  if (contract?.kind !== 'records' || contract.record?.kind !== 'object') {
    return 'VectorPageV1';
  }
  const fields = contract.record.fields.find(({ name }) => name === 'fields')?.value;
  const rowId = contract.record.fields.find(({ name }) => name === 'rowId')?.value;
  if (fields?.kind !== 'object' || rowId === undefined) return 'VectorPageV1';
  return `VectorPageV1<${resultValueType(fields)}, ${resultValueType(rowId)}>`;
}

function resultValueType(value) {
  if (value.kind === 'null') return 'null';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'principal') return 'Principal';
  if (value.kind === 'string' || value.kind === 'assetRef') return 'string';
  if (value.kind === 'mediaRef.v1') {
    return `MediaRef<${value.kinds.map(JSON.stringify).join(' | ')}>`;
  }
  if (value.kind === 'id') return `Id<${JSON.stringify(value.table)}>`;
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'json') return 'unknown';
  if (value.kind === 'array') return `ReadonlyArray<${resultValueType(value.element)}>`;
  if (value.kind === 'tuple') return `readonly [${value.elements.map(resultValueType).join(', ')}]`;
  if (value.kind === 'vector') {
    return `ReadonlyArray<number> & { readonly length: ${value.dimensions} }`;
  }
  if (value.kind === 'union') return value.variants.map(resultValueType).join(' | ');
  if (value.kind === 'object') {
    return `{ ${value.fields.map((field) => (
      `${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${resultValueType(field.value)}`
    )).join('; ')} }`;
  }
  return 'unknown';
}
