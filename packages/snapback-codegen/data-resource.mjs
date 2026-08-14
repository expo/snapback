// DataResourceV1 declaration validation, lowering, normalization, and
// generated-manifest parity checks.
//
// @ref LLP 0255#s1-exact-data-resource-authoring-grammar
// @ref LLP 0255#s2-lowering-to-standard-operations

import { lowerDataResourceV1 } from './standard-patterns.mjs';
import { validatorResultValue } from './result-contracts.mjs';

export const DATA_RESOURCE_FORMAT = 'snapback.normalized-data-resource.v1';
export const DATA_RESOURCE_SCHEMA_VERSION = 'snapback.data-resource.v1';
export const DATA_RESOURCE_GUIDE_ANCHOR = 'guide/data/resources';
export const DATA_RESOURCE_VISIBILITY_GUIDE_ANCHOR = 'guide/auth/protecting-data.md#declare-who-can-read-each-table';
export const DATA_RESOURCE_REFUSAL_VOCABULARY = Object.freeze([
  Object.freeze({
    code: 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE',
    phase: 'admission',
    guideAnchor: DATA_RESOURCE_GUIDE_ANCHOR,
  }),
  Object.freeze({
    code: 'SNAPBACK_ROW_NOT_FOUND',
    phase: 'admission',
    guideAnchor: DATA_RESOURCE_GUIDE_ANCHOR,
  }),
]);

const SYSTEM_FIELD_CONTRACTS = Object.freeze({
  _id: Object.freeze({ kind: 'id', table: '$resource' }),
  _version: Object.freeze({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }),
  _createdAt: Object.freeze({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }),
  _updatedAt: Object.freeze({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }),
});

const dataError = (code, message, details = {}) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  return error;
};

const visibilityProfile = (visibility) => {
  if (visibility?.kind === 'owner') return 'owner.v1';
  if (visibility?.kind === 'public-read') return 'public-read.v1';
  return null;
};

const relationFieldNames = (table) => Object.entries(table.fields)
  .filter(([, validator]) => validator?.fieldType?.RelationIncarnation !== undefined)
  .map(([name]) => name);

function validateEligibility(name, table, policyDataSync) {
  const declaration = table.dataDeclaration;
  if (table.visibilityDeclaration === undefined) {
    throw dataError(
      'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED',
      `${name} .data() requires an explicit owner or public-read table visibility policy`,
      { table: name, guideAnchor: DATA_RESOURCE_VISIBILITY_GUIDE_ANCHOR },
    );
  }
  const profile = visibilityProfile(table.visibilityDeclaration);
  if (profile === null) {
    throw dataError(
      'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED',
      `${name} uses unsupported ${table.visibilityDeclaration.kind} visibility; DataResourceV1 admits only owner and public-read`,
      { table: name, visibility: table.visibilityDeclaration, guideAnchor: DATA_RESOURCE_VISIBILITY_GUIDE_ANCHOR },
    );
  }
  if (table.syncSource === 'authored') {
    throw dataError(
      'SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN',
      `${name} uses authored .sync() before .data(); remove it and use application policy dataSync: "disabled" for the opt-out`,
      { table: name, dataSync: policyDataSync ?? 'enabled' },
    );
  }
  const ineligible = [];
  if (table.membershipDeclaration) ineligible.push('membership declaration');
  if (table.permissionBackingDeclared) ineligible.push('permission-backing declaration');
  if ((table.authorityProfileDeclarations ?? []).length > 0) ineligible.push('authority-profile declaration');
  if (table.historyDeclaration) ineligible.push('history declaration');
  const relations = relationFieldNames(table);
  if (relations.length > 0) ineligible.push(`relation-incarnation fields: ${relations.join(', ')}`);
  const fieldNames = Object.keys(table.fields);
  if (fieldNames.includes('after')) ineligible.push('reserved field name: after');
  const fieldNameSet = new Set(fieldNames);
  for (const field of fieldNames) {
    for (const suffix of ['gt', 'gte', 'lt', 'lte']) {
      const derived = `${field}_${suffix}`;
      if (fieldNameSet.has(derived)) {
        ineligible.push(`slot argument collision: ${field} and ${derived}`);
      }
    }
  }
  if (Object.keys(table.fields).length > 64) ineligible.push(`${Object.keys(table.fields).length} authored fields (maximum 64)`);
  if ((table.indexes ?? []).length > 16) ineligible.push(`${table.indexes.length} ordinary indexes (maximum 16)`);
  if (ineligible.length > 0) {
    throw dataError(
      'SNAPBACK_DATA_RESOURCE_INELIGIBLE',
      `${name} cannot lower to DataResourceV1 because it carries ${ineligible.join('; ')}`,
      { table: name, facts: ineligible },
    );
  }
  if (profile === 'public-read.v1') {
    for (const forbidden of ['createDefaults', 'updateDefaults', 'immutable']) {
      if (Object.hasOwn(declaration, forbidden)) {
        throw dataError(
          'SNAPBACK_DATA_RESOURCE_INELIGIBLE',
          `${name} public-read .data() cannot declare ${forbidden}; public resources generate no writes`,
          { table: name, field: forbidden },
        );
      }
    }
  } else {
    const ownerField = table.visibilityDeclaration.field;
    const owner = table.fields[ownerField];
    if (!owner || owner.optional || (owner.fieldType !== 'Principal' && owner.fieldType !== 'String')) {
      throw dataError(
        'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED',
        `${name} owner visibility field ${ownerField} must be a required principal or plain string`,
        { table: name, field: ownerField, guideAnchor: DATA_RESOURCE_VISIBILITY_GUIDE_ANCHOR },
      );
    }
    if ((declaration.immutable ?? []).includes(ownerField)) {
      throw dataError(
        'SNAPBACK_DATA_RESOURCE_INELIGIBLE',
        `${name} immutable cannot name generated owner field ${ownerField}`,
        { table: name, field: ownerField },
      );
    }
    for (const index of table.indexes ?? []) {
      if (index.unique === true && !index.fields.includes(ownerField)) {
        throw dataError(
          'SNAPBACK_DATA_RESOURCE_INELIGIBLE',
          `${name} unique index ${index.name} excludes owner field ${ownerField} and would disclose cross-owner conflicts`,
          { table: name, index: index.name, ownerField },
        );
      }
    }
  }
  return profile;
}

/** Validate every declaration and lower it into ordinary function markers.
 * The caller installs returned definitions into the evaluated function module
 * before the existing function-manifest pipeline runs. */
export function compileDataResourceDeclarations({
  schemaDef,
  tableManifests,
  authoredFunctions,
  authoringProfile,
  dataSync,
  error,
}) {
  const declarations = Object.entries(schemaDef.tables)
    .filter(([, table]) => table.dataDeclaration !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (declarations.length === 0) {
    if (dataSync !== null) {
      error(
        'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
        'codegen',
        'codegen policy dataSync is forbidden when the schema declares no .data() resources',
        { dataSync },
      );
    }
    return { resources: [], definitions: {}, promotions: new Map() };
  }
  const syncEnabled = dataSync !== 'disabled';
  const resources = [];
  const definitions = {};
  const promotions = new Map();
  for (const [name, table] of declarations) {
    try {
      const profile = validateEligibility(name, table, dataSync);
      const lowered = lowerDataResourceV1({
        table,
        resource: name,
        visibility: table.visibilityDeclaration,
        ...table.dataDeclaration,
        delivery: syncEnabled ? 'live' : 'read',
      });
      const promotedNames = [];
      for (const [operationName, definition] of Object.entries(lowered.definitions)) {
        const authored = authoredFunctions[operationName];
        if (authored !== undefined) {
          const marker = authored?.__dataPromotion;
          const operation = operationKind(operationName);
          const comparable = (candidate) => JSON.stringify({
            kind: candidate?.__kind,
            auth: candidate?.auth,
            args: candidate?.args,
            plan: candidate?.plan,
            resultContract: candidate?.resultContract,
          });
          if (
            marker?.schemaVersion !== 'snapback.data-promotion.v1'
            || marker.resource !== name
            || marker.operation !== operation
            || typeof marker.normalizedDataResourceId !== 'string'
            || !marker.frozenFacts
            || comparable(authored) !== comparable(definition)
          ) {
            throw dataError(
              'SNAPBACK_DATA_OPERATION_NAME_COLLISION',
              `${name} generated operation ${operationName} collides with an authored export that is not its exact approved promotion`,
              { table: name, operation: operationName },
            );
          }
          promotions.set(operationName, marker);
          promotedNames.push(operationName);
          continue;
        }
        if (Object.hasOwn(definitions, operationName)) {
          throw dataError(
            'SNAPBACK_DATA_OPERATION_NAME_COLLISION',
            `${name} generated operation ${operationName} collides with an authored or generated export`,
            { table: name, operation: operationName },
          );
        }
        // Authored definitions receive this marker while crossing the
        // capability-empty evaluator. Generated definitions are constructed
        // afterward, so the internal lowerer supplies the same discriminator.
        definition.__snapbackDefinitionKind = 'function';
        definitions[operationName] = definition;
      }
      resources.push({
        resource: name,
        table: name,
        tableBuilder: table,
        tableManifest: tableManifests[name],
        surfaceProfile: profile,
        authoringProfile,
        declaration: table.dataDeclaration,
        access: profile === 'owner.v1'
          ? { kind: 'owner', field: table.visibilityDeclaration.field }
          : { kind: 'public-read' },
        listIndex: lowered.listIndex,
        sync: {
          enabled: syncEnabled,
          delivery: syncEnabled ? 'live' : 'read',
          source: dataSync === 'disabled' ? 'application-policy' : 'default',
        },
        operationNames: Object.keys(lowered.definitions),
        promotedNames,
      });
    } catch (cause) {
      let code = cause.code;
      if (code === 'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED') {
        code = 'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED';
      } else if (code !== 'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED'
        && !String(code).startsWith('SNAPBACK_DATA_')) {
        code = 'SNAPBACK_DATA_RESOURCE_INELIGIBLE';
      }
      error(code ?? 'SNAPBACK_DATA_RESOURCE_INELIGIBLE', 'data-resource', cause.message, {
        table: name,
        guideAnchor: code === 'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED'
          ? DATA_RESOURCE_VISIBILITY_GUIDE_ANCHOR
          : DATA_RESOURCE_GUIDE_ANCHOR,
        ...(cause.details ?? {}),
      });
    }
  }
  return { resources, definitions, promotions };
}

const operationKind = (name) => name.slice(name.lastIndexOf('.') + 1);

export function buildNormalizedDataResourceCore(draft, decoratedByName, hash) {
  const policyId = hash('snapback:data-policy:v1', { table: draft.table, access: draft.access });
  const fields = [];
  for (const [name, contract] of Object.entries(SYSTEM_FIELD_CONTRACTS)) {
    fields.push({
      name,
      validatorContract: name === '_id' ? { ...contract, table: draft.table } : contract,
      optional: false,
      source: 'system',
      createInput: false,
      updateInput: false,
      serverOwned: true,
      immutable: true,
      default: null,
      ownerAssigned: false,
    });
  }
  const ownerField = draft.access.kind === 'owner' ? draft.access.field : null;
  for (const [name, validator] of Object.entries(draft.tableBuilder.fields)) {
    const createDefault = draft.declaration.createDefaults?.[name] ?? null;
    const updateDefault = draft.declaration.updateDefaults?.[name] ?? null;
    if (createDefault !== null && updateDefault !== null && createDefault !== updateDefault) {
      throw dataError(
        'SNAPBACK_DATA_RESOURCE_INELIGIBLE',
        `${draft.table} field ${name} uses different create/update trusted defaults and cannot normalize to one DataResourceV1 default fact`,
      );
    }
    const ownerAssigned = name === ownerField;
    const immutable = ownerAssigned || (draft.declaration.immutable ?? []).includes(name);
    fields.push({
      name,
      validatorContract: validatorResultValue(validator, {
        tables: Object.fromEntries([[draft.table, draft.tableManifest]]),
        mediaSource: { table: draft.table, field: name, optional: validator.optional === true },
      }),
      optional: validator.optional === true,
      source: 'authored',
      createInput: !ownerAssigned && createDefault === null,
      updateInput: !ownerAssigned && !immutable && updateDefault === null,
      serverOwned: ownerAssigned || createDefault !== null || updateDefault !== null,
      immutable,
      default: createDefault ?? updateDefault,
      ownerAssigned,
    });
  }
  const indexes = (draft.tableManifest.indexes ?? []).map((index) => ({
    name: index.name,
    fields: [...index.fields],
    unique: index.unique === true,
    listIndex: index.name === draft.listIndex,
    queryable: true,
  }));
  const operations = draft.operationNames.map((name) => {
    const fn = decoratedByName.get(name);
    if (!fn) throw dataError('SNAPBACK_DATA_RESOURCE_INELIGIBLE', `missing decorated function ${name}`);
    const kind = operationKind(name);
    return {
      name: kind,
      kind: fn.kind,
      exportedName: fn.exportedName,
      argsContractHash: fn.argsContractHash,
      resultContractHash: fn.resultContractHash,
      policyId,
      planHash: hash('snapback:data-plan:v1', fn.runtime.HostPlan),
      readTables: [...fn.readSetSummary.tables],
      writeTables: [...fn.writeSetSummary.tables],
      effectCeilingClass: fn.kind === 'Mutation' ? 'write' : 'read',
      dispatchRequiredCapabilities: fn.kind === 'Mutation' ? ['offline_mutation_replay'] : [],
      prediction: fn.kind === 'Mutation' ? 'generated-exact' : 'none',
      custody: fn.kind === 'Mutation'
        ? { class: 'queue-eligible', reason: null }
        : null,
      refusals: DATA_RESOURCE_REFUSAL_VOCABULARY.filter(({ code }) => (
        (code === 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE' && kind === 'list')
          || (code === 'SNAPBACK_ROW_NOT_FOUND' && (kind === 'update' || kind === 'delete'))
      )),
    };
  });
  return {
    format: DATA_RESOURCE_FORMAT,
    surfaceProfile: 'snapback.data-surface.v1',
    resource: draft.resource,
    table: draft.table,
    tableSchemaHash: hash('snapback:data-table-schema:v1', draft.tableManifest),
    fields,
    access: draft.access.kind === 'owner'
      ? { kind: 'owner', ownerField: draft.access.field, policyId }
      : { kind: 'public-read', policyId },
    indexes,
    operations,
    sync: {
      enabled: draft.sync.enabled,
      source: draft.sync.enabled ? 'data-profile-default' : 'application-opt-out',
    },
    capabilities: {
      read: true,
      write: draft.surfaceProfile === 'owner.v1',
      live: draft.sync.enabled,
      localMaterialization: draft.sync.enabled,
      retained: false,
      offlineCustody: draft.surfaceProfile === 'owner.v1',
      cursor: 'data-cursor.v1',
    },
    ceilings: {
      maxDescriptorBytes: 32_768,
      maxFilterFields: 8,
      maxInValues: 32,
      maxProjectionFields: 64,
      maxTake: 200,
      maxCandidateRows: 1_024,
      maxResultBytes: 65_536,
      maxIndexesPerResource: 16,
      maxFieldsPerResource: 64,
    },
    refusalVocabulary: [...DATA_RESOURCE_REFUSAL_VOCABULARY],
    guideAnchor: DATA_RESOURCE_GUIDE_ANCHOR,
  };
}

export function createDataResourceEnvelope(core, generation, sourceSpan, hash, functionReferences) {
  const normalizedDataResourceId = hash('snapback:normalized-data-resource:v1', core);
  return {
    artifactKind: 'dataResource',
    schemaVersion: DATA_RESOURCE_SCHEMA_VERSION,
    core,
    normalizedDataResourceId,
    generation,
    functionReferences,
    sourceSpan: sourceSpan ?? null,
  };
}

// Every currently shipped generated data-function record is walked
// recursively. The explicit tree gives future additions no implicit default;
// callers must classify them before generation can succeed.
const DATA_FUNCTION_DISPOSITION = Object.freeze({
  id: true, name: true, exportedName: true, kind: true, sourceSpan: true,
  handlerForm: true, implementationHash: true, argsContractHash: true,
  argsContract: true, resultContract: true, resultContractHash: true,
  requiredCapabilities: true, authRequirement: true, authorityIndependent: true,
  refusals: true, authorizationDependence: true, syncabilityClass: true, readSetSummary: true,
  writeSetSummary: true, effectCeiling: true, standardPattern: true,
  bundleEntrypoint: true, uses: true, runtime: true,
});

export function assertDataFunctionRecordParity(record) {
  if (!record || typeof record !== 'object') {
    throw dataError(
      'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
      'generated data function is missing from the canonical function manifest',
    );
  }
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(DATA_FUNCTION_DISPOSITION, key)) {
      throw dataError(
        'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
        `generated data function ${record.name} has unclassified canonical field ${key}`,
        { function: record.name, path: key },
      );
    }
  }
  // These record-valued fields are explicitly recursive gates. Their member
  // sets are frozen here rather than accepted by nominal top-level presence.
  const exactMembers = (value, path, admitted) => {
    if (value === undefined || value === null) return;
    for (const key of Object.keys(value)) {
      if (!admitted.has(key)) {
        throw dataError(
          'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
          `generated data function ${record.name} has unclassified canonical field ${path}.${key}`,
          { function: record.name, path: `${path}.${key}` },
        );
      }
    }
  };
  exactMembers(record.readSetSummary, 'readSetSummary', new Set(['mode', 'primaryTable', 'tables', 'authScopeField']));
  exactMembers(record.writeSetSummary, 'writeSetSummary', new Set(['mode', 'primaryTable', 'tables']));
  exactMembers(record.effectCeiling, 'effectCeiling', new Set([
    'version', 'basis', 'reads', 'writes', 'authorizationInputs', 'hostOperations',
  ]));
  for (const [index, read] of (record.effectCeiling?.reads ?? []).entries()) {
    exactMembers(read, `effectCeiling.reads[${index}]`, new Set(['access', 'index', 'table']));
  }
  for (const [index, write] of (record.effectCeiling?.writes ?? []).entries()) {
    exactMembers(write, `effectCeiling.writes[${index}]`, new Set(['operations', 'table']));
  }
  exactMembers(record.standardPattern, 'standardPattern', new Set(['helper', 'profile']));
  exactMembers(record.runtime, 'runtime', new Set(['HostPlan']));
  exactMembers(record.runtime?.HostPlan, 'runtime.HostPlan', new Set(['Query', 'Mutation']));

  const expression = (value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const variants = Object.keys(value);
    if (variants.length !== 1) {
      throw dataError(
        'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
        `generated data function ${record.name} has unclassified canonical expression ${path}`,
        { function: record.name, path },
      );
    }
    const variant = variants[0];
    exactMembers(value, path, new Set(['Arg', 'Binding', 'Document', 'Field', 'Binary']));
    if (variant === 'Field') {
      exactMembers(value.Field, `${path}.Field`, new Set(['base', 'key']));
      expression(value.Field.base, `${path}.Field.base`);
    } else if (variant === 'Binary') {
      exactMembers(value.Binary, `${path}.Binary`, new Set(['left', 'op', 'right']));
      expression(value.Binary.left, `${path}.Binary.left`);
      expression(value.Binary.right, `${path}.Binary.right`);
    } else if (variant === 'Document') {
      exactMembers(value.Document, `${path}.Document`, new Set(['id', 'table']));
      expression(value.Document.id, `${path}.Document.id`);
    }
  };

  const query = record.runtime?.HostPlan?.Query;
  exactMembers(query, 'runtime.HostPlan.Query', new Set([
    'filters', 'indexed_by', 'limit', 'membershipFilters', 'order', 'table', 'tableVisibility',
  ]));
  for (const [index, filter] of (query?.filters ?? []).entries()) {
    exactMembers(filter, `runtime.HostPlan.Query.filters[${index}]`, new Set(['field', 'op', 'value']));
    expression(filter.value, `runtime.HostPlan.Query.filters[${index}].value`);
  }
  for (const [index, order] of (query?.order ?? []).entries()) {
    exactMembers(order, `runtime.HostPlan.Query.order[${index}]`, new Set(['direction', 'field']));
  }
  exactMembers(query?.tableVisibility, 'runtime.HostPlan.Query.tableVisibility', new Set(['field', 'kind']));

  const mutation = record.runtime?.HostPlan?.Mutation;
  exactMembers(mutation, 'runtime.HostPlan.Mutation', new Set(['return_value', 'steps']));
  expression(mutation?.return_value, 'runtime.HostPlan.Mutation.return_value');
  for (const [index, step] of (mutation?.steps ?? []).entries()) {
    const path = `runtime.HostPlan.Mutation.steps[${index}]`;
    exactMembers(step, path, new Set(['Delete', 'Get', 'Guard', 'Insert', 'Patch']));
    if (Object.keys(step).length !== 1) {
      throw dataError(
        'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
        `generated data function ${record.name} has unclassified canonical mutation step ${path}`,
        { function: record.name, path },
      );
    }
    if (step.Get) {
      exactMembers(step.Get, `${path}.Get`, new Set(['bind_as', 'else_error', 'id', 'table']));
      expression(step.Get.id, `${path}.Get.id`);
    } else if (step.Guard) {
      exactMembers(step.Guard, `${path}.Guard`, new Set(['cond', 'else_error']));
      expression(step.Guard.cond, `${path}.Guard.cond`);
    } else if (step.Insert) {
      exactMembers(step.Insert, `${path}.Insert`, new Set(['bind_id_as', 'table', 'values']));
      for (const [field, value] of Object.entries(step.Insert.values ?? {})) {
        expression(value, `${path}.Insert.values.${field}`);
      }
    } else if (step.Patch) {
      exactMembers(step.Patch, `${path}.Patch`, new Set(['id', 'table', 'values']));
      expression(step.Patch.id, `${path}.Patch.id`);
      for (const [field, value] of Object.entries(step.Patch.values ?? {})) {
        expression(value, `${path}.Patch.values.${field}`);
      }
    } else if (step.Delete) {
      exactMembers(step.Delete, `${path}.Delete`, new Set(['id', 'table']));
      expression(step.Delete.id, `${path}.Delete.id`);
    }
  }

  const contractValue = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const allowed = {
      array: ['element', 'kind', 'maxItems'],
      assetRef: ['kind'],
      boolean: ['kind'],
      finiteReal: ['kind', 'max', 'min'],
      id: ['kind', 'table'],
      integer: ['kind', 'max', 'min'],
      json: ['kind', 'maxBytes', 'maxDepth'],
      literal: ['kind', 'value'],
      'mediaRef.v1': [
        'classMTreatment', 'classificationProfile', 'delivery', 'kind', 'kinds',
        'optional', 'policyGeneration', 'retentionClass', 'sourceField',
        'sourceFieldGeneration', 'sourceTable', 'uploadIntent', 'variants',
      ],
      null: ['kind'],
      object: ['allowExtra', 'fields', 'kind'],
      platformSchemaRef: ['authority', 'kind', 'schema'],
      principal: ['kind'],
      string: ['kind', 'maxBytes'],
      tuple: ['elements', 'kind'],
      union: ['kind', 'variants'],
      vector: ['dimensions', 'kind'],
    }[value.kind];
    if (!allowed) {
      throw dataError(
        'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
        `generated data function ${record.name} has unclassified canonical contract kind ${path}.${String(value.kind)}`,
        { function: record.name, path },
      );
    }
    exactMembers(value, path, new Set(allowed));
    if (value.kind === 'array') contractValue(value.element, `${path}.element`);
    if (value.kind === 'tuple') {
      value.elements.forEach((item, index) => contractValue(item, `${path}.elements[${index}]`));
    }
    if (value.kind === 'union') {
      value.variants.forEach((item, index) => contractValue(item, `${path}.variants[${index}]`));
    }
    if (value.kind === 'object') {
      for (const [index, field] of value.fields.entries()) {
        exactMembers(field, `${path}.fields[${index}]`, new Set(['name', 'required', 'value']));
        contractValue(field.value, `${path}.fields[${index}].value`);
      }
    }
  };
  exactMembers(record.argsContract, 'argsContract', new Set(['fields']));
  for (const [index, field] of (record.argsContract?.fields ?? []).entries()) {
    exactMembers(field, `argsContract.fields[${index}]`, new Set(['name', 'required', 'value']));
    contractValue(field.value, `argsContract.fields[${index}].value`);
  }
  const result = record.resultContract;
  const resultMembers = {
    document: ['document', 'kind', 'table'],
    documents: ['document', 'kind', 'table'],
    records: ['kind', 'record', 'rows'],
    value: ['kind', 'value'],
  }[result?.kind];
  if (!resultMembers) {
    throw dataError(
      'SNAPBACK_DATA_FUNCTION_RECORD_PARITY_FAILED',
      `generated data function ${record.name} has unclassified canonical result kind ${String(result?.kind)}`,
      { function: record.name, path: 'resultContract' },
    );
  }
  exactMembers(result, 'resultContract', new Set(resultMembers));
  if (result.document) contractValue(result.document, 'resultContract.document');
  if (result.record) contractValue(result.record, 'resultContract.record');
  if (result.value) contractValue(result.value, 'resultContract.value');
  exactMembers(result.rows, 'resultContract.rows', new Set(['maxItems', 'minItems']));
  exactMembers(record.sourceSpan, 'sourceSpan', new Set(['column', 'file', 'line']));
  return true;
}

export function renderDataModule(envelopes) {
  return `// Generated by @expo/snapback-codegen. Do not edit.\n`
    + `// @ref LLP 0255#s42-dataresourcev1\n`
    + `export const dataResources = Object.freeze(${JSON.stringify(envelopes.map((resource) => ({
      resource: resource.core.resource,
      normalizedDataResourceId: resource.normalizedDataResourceId,
      core: resource.core,
      functionReferences: resource.functionReferences,
    })), null, 2)});\n`;
}

export function renderDataTypes(envelopes) {
  const resources = envelopes.map(({ core }) => JSON.stringify(core.resource)).join(' | ') || 'never';
  return `// Generated by @expo/snapback-codegen. Do not edit.\n`
    + `// @ref LLP 0255#s42-dataresourcev1\n`
    + `import type { Id, Principal } from './api.mjs';\n`
    + `export type DataResourceName = ${resources};\n`
    + 'export declare const dataResources: readonly Readonly<Record<string, unknown>>[];\n';
}
