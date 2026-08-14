// Static bounded-query extraction and NormalizedDataQueryCoreV1 compilation.
//
// @ref LLP 0255#s43-dataqueryv1
// @ref LLP 0255#s51-source-grammar-and-construction-decision
// @ref LLP 0255#s52-filters-and-index-admissibility
// @ref LLP 0255#s61-exact-match
// @ref LLP 0255#s62-static-synthesized-member

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import ts from 'typescript';

import {
  arg,
  authUserId,
  defineLiveQuery,
  defineQuery,
  results,
  v,
} from './define.mjs';
import {
  argsContractHash,
  effectiveArgsContract,
  effectiveResultContract,
  resultContractHash,
} from './result-contracts.mjs';

export const DATA_QUERY_FORMAT = 'snapback.normalized-data-query.v1';
export const DATA_QUERY_SCHEMA_VERSION = 'snapback.data-query.v1';
export const DATA_QUERY_GUIDE_ANCHOR = 'guide/data/queries';
export const DATA_QUERY_CEILINGS = Object.freeze({
  maxDescriptorBytes: 32_768,
  maxFilterFields: 8,
  maxInValues: 32,
  maxProjectionFields: 64,
  maxTake: 200,
  maxCandidateRows: 1_024,
  maxResultBytes: 65_536,
  maxIndexesPerResource: 16,
  maxFieldsPerResource: 64,
});
export const DATA_QUERY_REFUSAL_VOCABULARY = Object.freeze([
  ['SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'generation'],
  ['SNAPBACK_DATA_QUERY_NOT_CATALOGUED', 'admission'],
  ['SNAPBACK_DATA_QUERY_BOUND_EXCEEDED', 'admission'],
  ['SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE', 'admission'],
  ['SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS', 'generation'],
  ['SNAPBACK_DATA_QUERY_NAME_COLLISION', 'generation'],
  ['SNAPBACK_DATA_CURSOR_INVALID', 'admission'],
  ['SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE', 'admission'],
].map(([code, phase]) => Object.freeze({ code, phase, guideAnchor: DATA_QUERY_GUIDE_ANCHOR })));

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set([
  '.git', '.snapback', '_generated', 'generated', 'node_modules', 'runtime-artifacts',
]);
const QUERY_METHODS = new Set(['using', 'where', 'orderBy', 'select', 'take', 'after']);
const EXACT_SEQUENCES = new Set([
  'using,orderBy,take',
  'using,orderBy,take,after',
  'using,orderBy,select,take',
  'using,orderBy,select,take,after',
  'using,where,orderBy,take',
  'using,where,orderBy,take,after',
  'using,where,orderBy,select,take',
  'using,where,orderBy,select,take,after',
]);
const OPERATORS = new Set([
  'eq', 'in', 'lt', 'lte', 'gt', 'gte',
  'gt-lt', 'gt-lte', 'gte-lt', 'gte-lte',
]);
const SINGLE_OPERATOR_KEYS = new Set(['eq', 'in', 'lt', 'lte', 'gt', 'gte']);

const dataQueryError = (code, message, details = {}) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.details = { guideAnchor: DATA_QUERY_GUIDE_ANCHOR, ...details };
  return error;
};

const codeUnitCompare = (left, right) => (
  left < right ? -1 : left > right ? 1 : 0
);

const sourceSpan = (root, path, node, sourceFile) => {
  const at = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path: relative(root, path).split(sep).join('/'),
    line: at.line + 1,
    column: at.character + 1,
  };
};

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort(codeUnitCompare)) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      const path = join(directory, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(name))) files.push(path);
    }
  };
  visit(root);
  return files;
}

function stringLiteral(node, where) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw dataQueryError(
    'SNAPBACK_DATA_QUERY_NOT_CATALOGUED',
    `${where} must be a compile-time string literal; make the complete query shape static`,
  );
}

function integerLiteral(node, where) {
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    if (Number.isSafeInteger(value)) return value;
  }
  throw dataQueryError(
    'SNAPBACK_DATA_QUERY_NOT_CATALOGUED',
    `${where} must be a compile-time safe-integer literal`,
  );
}

function propertyName(node, where) {
  if (!node || node.name === undefined || node.dotDotDotToken !== undefined) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_NOT_CATALOGUED', `${where} must use static object properties`);
  }
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  throw dataQueryError('SNAPBACK_DATA_QUERY_NOT_CATALOGUED', `${where} has a computed property`);
}

function predicateShape(node, field) {
  if (!ts.isObjectLiteralExpression(node)) return { operator: 'eq', slotCount: 1 };
  const entries = node.properties.map((property) => propertyName(property, `where.${field}`));
  if (new Set(entries).size !== entries.length || entries.length === 0 || entries.length > 2) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where.${field} has an invalid predicate object`);
  }
  if (entries.length === 1) {
    const [operator] = entries;
    if (!SINGLE_OPERATOR_KEYS.has(operator)) {
      throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where.${field} uses unsupported operator ${operator}`);
    }
    return { operator, slotCount: 1 };
  }
  const lower = entries.find((entry) => entry === 'gt' || entry === 'gte');
  const upper = entries.find((entry) => entry === 'lt' || entry === 'lte');
  if (!lower || !upper) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where.${field} range must contain one lower and one upper operator`);
  }
  return { operator: `${lower}-${upper}`, slotCount: 2 };
}

function whereShape(node) {
  if (!ts.isObjectLiteralExpression(node)) {
    throw dataQueryError(
      'SNAPBACK_DATA_QUERY_NOT_CATALOGUED',
      'where(...) must be an exact object literal so its field/operator shape can be catalogued',
    );
  }
  if (node.properties.length < 1) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'where(...) requires at least one field');
  }
  if (node.properties.length > DATA_QUERY_CEILINGS.maxFilterFields) {
    throw dataQueryError(
      'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
      `where(...) has ${node.properties.length} fields; maxFilterFields is ${DATA_QUERY_CEILINGS.maxFilterFields}`,
      { ceiling: 'maxFilterFields', observed: node.properties.length },
    );
  }
  const filters = node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      throw dataQueryError('SNAPBACK_DATA_QUERY_NOT_CATALOGUED', 'where(...) does not admit spreads or accessors');
    }
    const field = propertyName(property, 'where');
    const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    return { field, ...predicateShape(value, field) };
  });
  if (new Set(filters.map(({ field }) => field)).size !== filters.length) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'where(...) fields must be distinct');
  }
  return filters;
}

function stringArrayLiteral(node, where) {
  if (!ts.isArrayLiteralExpression(node)) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_NOT_CATALOGUED', `${where} must be an array literal`);
  }
  return node.elements.map((element) => stringLiteral(element, where));
}

function unwindChain(node) {
  const steps = [];
  let current = node;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const method = current.expression.name.text;
    if (!QUERY_METHODS.has(method)) break;
    steps.unshift({ method, args: [...current.arguments], node: current });
    current = current.expression.expression;
  }
  if (!ts.isPropertyAccessExpression(current)) return null;
  return { resource: current.name.text, steps, root: current.expression };
}

function parseTemplate(root, path, node, sourceFile, resourceNames) {
  const chain = unwindChain(node);
  if (!chain || !resourceNames.has(chain.resource)) return null;
  if (!ts.isIdentifier(chain.root) || chain.root.text !== 'data') return null;
  const sequence = chain.steps.map(({ method }) => method).join(',');
  if (!EXACT_SEQUENCES.has(sequence)) {
    throw dataQueryError(
      'SNAPBACK_DATA_QUERY_SHAPE_INVALID',
      `${chain.resource} query methods occur in unsupported order ${sequence || '<empty>'}`,
    );
  }
  const one = (method, count) => {
    const step = chain.steps.find((entry) => entry.method === method);
    if (!step || step.args.length !== count) {
      throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `${method}(...) requires exactly ${count} argument${count === 1 ? '' : 's'}`);
    }
    return step;
  };
  const using = one('using', 1);
  const orderBy = one('orderBy', 2);
  const take = one('take', 1);
  const where = chain.steps.find(({ method }) => method === 'where');
  const select = chain.steps.find(({ method }) => method === 'select');
  const after = chain.steps.find(({ method }) => method === 'after');
  if (where && where.args.length !== 1) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'where(...) requires one argument');
  if (select && select.args.length !== 1) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'select(...) requires one argument');
  if (after && after.args.length !== 1) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'after(...) requires one cursor argument');
  return {
    resource: chain.resource,
    index: stringLiteral(using.args[0], 'using(index)'),
    filters: where ? whereShape(where.args[0]) : [],
    order: {
      field: stringLiteral(orderBy.args[0], 'orderBy(field, direction)'),
      direction: stringLiteral(orderBy.args[1], 'orderBy(field, direction)'),
    },
    projection: select ? stringArrayLiteral(select.args[0], 'select(fields)') : null,
    take: integerLiteral(take.args[0], 'take(limit)'),
    sourceSpan: sourceSpan(root, path, node, sourceFile),
  };
}

export function extractDataQueryTemplates({ root, resourceNames }) {
  const resources = new Set(resourceNames);
  const templates = [];
  for (const path of sourceFiles(root)) {
    const source = readFileSync(path, 'utf8');
    const kind = /\.[cm]?tsx?$/u.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, kind);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const parentMethod = ts.isPropertyAccessExpression(node.parent)
          && node.parent.expression === node
          && ts.isCallExpression(node.parent.parent)
          && node.parent.parent.expression === node.parent
          ? node.parent.name.text
          : null;
        // Only the maximal fluent chain is a template. Visiting every nested
        // receiver would misdiagnose the intentionally incomplete typestates
        // inside a valid complete chain.
        if (!QUERY_METHODS.has(parentMethod)) {
          const template = parseTemplate(root, path, node, sourceFile, resources);
          if (template) templates.push(template);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const distinct = new Map();
  for (const template of templates) {
    const key = JSON.stringify({
      resource: template.resource,
      index: template.index,
      filters: template.filters,
      order: template.order,
      projection: template.projection,
      take: template.take,
    });
    if (!distinct.has(key)) distinct.set(key, template);
  }
  return [...distinct.values()];
}

const validatorIsStructured = (validator) => (
  validator?.primitive === 'object'
  || validator?.resultKind === 'array'
  || validator?.resultKind === 'tuple'
  || validator?.resultKind === 'vector'
  || validator?.fieldType?.Structured !== undefined
);

const systemValidator = (resource, field) => ({
  _id: v.id(resource),
  _version: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  _createdAt: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  _updatedAt: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
})[field];

const fieldValidator = (draft, field) => draft.tableBuilder.fields[field] ?? systemValidator(draft.table, field);

function canonicalProjection(template, draft) {
  const fields = [
    '_id', '_version', '_createdAt', '_updatedAt',
    ...Object.keys(draft.tableBuilder.fields),
  ];
  if (template.projection === null) {
    if (fields.length > DATA_QUERY_CEILINGS.maxProjectionFields) {
      throw dataQueryError(
        'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
        `omitted select projects ${fields.length} fields; maxProjectionFields is ${DATA_QUERY_CEILINGS.maxProjectionFields}`,
        { ceiling: 'maxProjectionFields', observed: fields.length },
      );
    }
    return { kind: 'all-readable-fields', fields };
  }
  if (template.projection.length === 0 || template.projection.length > DATA_QUERY_CEILINGS.maxProjectionFields) {
    throw dataQueryError(
      template.projection.length > DATA_QUERY_CEILINGS.maxProjectionFields
        ? 'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED'
        : 'SNAPBACK_DATA_QUERY_SHAPE_INVALID',
      `select(...) has ${template.projection.length} fields; the allowed range is 1..${DATA_QUERY_CEILINGS.maxProjectionFields}`,
      { ceiling: 'maxProjectionFields', observed: template.projection.length },
    );
  }
  const selected = new Set(template.projection);
  if (selected.size !== template.projection.length) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'select(...) fields must be duplicate-free');
  }
  for (const field of selected) {
    if (!fields.includes(field)) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `select(...) names unknown field ${field}`);
  }
  return { kind: 'selected-fields', fields: fields.filter((field) => selected.has(field)) };
}

function validateAndCanonicalizeTemplate(template, draft) {
  if (template.order.direction !== 'asc' && template.order.direction !== 'desc') {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'orderBy direction must be "asc" or "desc"');
  }
  if (!Number.isSafeInteger(template.take) || template.take < 1 || template.take > DATA_QUERY_CEILINGS.maxTake) {
    throw dataQueryError(
      'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
      `take(${template.take}) violates maxTake ${DATA_QUERY_CEILINGS.maxTake}`,
      { ceiling: 'maxTake', observed: template.take },
    );
  }
  const index = (draft.tableManifest.indexes ?? []).find(({ name }) => name === template.index);
  if (!index) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `using(${JSON.stringify(template.index)}) names no ordinary index on ${draft.table}`);
  const ownerField = draft.access.kind === 'owner' ? draft.access.field : null;
  if (ownerField !== null && index.fields[0] !== ownerField) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `owner query index ${index.name} must begin with ${ownerField}`);
  }
  const callerFields = index.fields.slice(ownerField === null ? 0 : 1);
  const byField = new Map(template.filters.map((filter) => [filter.field, filter]));
  let position = 0;
  let terminalPredicate = null;
  while (position < callerFields.length && byField.has(callerFields[position])) {
    const filter = byField.get(callerFields[position]);
    if (!fieldValidator(draft, filter.field)) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where(...) names unknown field ${filter.field}`);
    if (filter.field === ownerField) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where(...) cannot name injected owner field ${ownerField}`);
    if (validatorIsStructured(fieldValidator(draft, filter.field)) || draft.tableBuilder.fields[filter.field]?.fieldType?.RelationIncarnation !== undefined) {
      throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where(...) cannot filter structured or relation field ${filter.field}`);
    }
    if (!OPERATORS.has(filter.operator)) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `unsupported predicate ${filter.operator}`);
    if (filter.operator === 'eq') {
      if (terminalPredicate !== null) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'equality predicates cannot follow in/range');
    } else {
      if (terminalPredicate !== null) throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'at most one in/range predicate is admitted');
      terminalPredicate = filter;
    }
    position += 1;
    if (terminalPredicate !== null) break;
  }
  if (position !== template.filters.length) {
    const invalid = template.filters.find(({ field }) => !callerFields.slice(0, position).includes(field));
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `where field ${invalid?.field ?? '<unknown>'} skips the contiguous index prefix or follows an ordered field`);
  }
  const expectedOrderField = terminalPredicate?.field ?? callerFields[position] ?? '_id';
  if (template.order.field !== expectedOrderField) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', `orderBy must name ${expectedOrderField} for this admitted index prefix`);
  }
  const canonicalFilters = callerFields
    .filter((field) => byField.has(field))
    .map((field) => byField.get(field));
  let slot = 0;
  const filters = canonicalFilters.map(({ field, operator, slotCount }) => {
    const slots = Array.from({ length: slotCount }, () => slot++);
    return { field, operator, slots };
  });
  return {
    ...template,
    filters,
    projection: canonicalProjection(template, draft),
    indexFields: [...index.fields],
    ownerField,
  };
}

function argumentNames(filters) {
  const names = [];
  for (const filter of filters) {
    if (filter.operator === 'eq' || filter.operator === 'in') names.push(filter.field);
    else {
      for (const operator of filter.operator.split('-')) names.push(`${filter.field}_${operator}`);
    }
  }
  return names;
}

function queryDefinition(compiled, draft) {
  const names = argumentNames(compiled.filters);
  const args = {};
  let nameIndex = 0;
  for (const filter of compiled.filters) {
    const validator = fieldValidator(draft, filter.field);
    if (filter.operator === 'in') args[names[nameIndex++]] = v.array(validator, { maxItems: DATA_QUERY_CEILINGS.maxInValues });
    else {
      for (let index = 0; index < filter.slots.length; index += 1) args[names[nameIndex++]] = validator;
    }
  }
  args.after = { ...v.optional(v.string({ maxBytes: 2_048 })), dataCursorV1: true };

  const filters = draft.access.kind === 'owner'
    ? [{ field: draft.access.field, op: 'Eq', value: authUserId() }]
    : [];
  nameIndex = 0;
  for (const filter of compiled.filters) {
    const operators = filter.operator.includes('-') ? filter.operator.split('-') : [filter.operator];
    for (const operator of operators) {
      filters.push({
        field: filter.field,
        op: ({ eq: 'Eq', in: 'In', lt: 'Lt', lte: 'Lte', gt: 'Gt', gte: 'Gte' })[operator],
        value: arg(names[nameIndex++]),
      });
    }
  }
  const direction = compiled.order.direction === 'asc' ? 'Asc' : 'Desc';
  // Policy equality consumes the leading owner field. The runtime order is
  // therefore the complete post-policy-prefix index order, exactly matching
  // the data lowerer's list member and the continuation-vector contract.
  let order = compiled.indexFields
    .slice(compiled.ownerField === null ? 0 : 1)
    .map((field) => ({ field, direction }));
  if (order.length === 0) order = [{ field: '_id', direction }];
  const selected = compiled.projection.kind === 'selected-fields';
  const resultContract = selected
    ? results.records(v.object(Object.fromEntries(compiled.projection.fields.map((field) => [
        field,
        fieldValidator(draft, field),
      ]))))
    : results.documents(draft.table);
  const define = draft.sync.enabled ? defineLiveQuery : defineQuery;
  const definition = define({
    table: draft.table,
    args,
    filter: filters,
    order,
    limit: compiled.take,
    index: compiled.index,
    auth: draft.access.kind === 'owner' ? 'authenticated' : 'public',
    ...(draft.access.kind === 'public-read' ? { authorityIndependent: true } : {}),
    ...(draft.access.kind === 'owner' ? { authScopeField: draft.access.field } : {}),
    standardPattern: { helper: 'data-query.v1', profile: 'bounded-index.v1' },
  });
  definition.resultContract = resultContract;
  return definition;
}

function planForDefinition(definition, draft) {
  const expression = (value) => {
    if (value?.Arg !== undefined) return { Arg: value.Arg };
    if (value?.Literal !== undefined) return { Literal: value.Literal };
    if (value?.kind === 'AuthUserId') return 'AuthUserId';
    return value;
  };
  return {
    table: definition.plan.table,
    ...(draft.access.kind === 'owner'
      ? { tableVisibility: { kind: 'owner', field: draft.access.field } }
      : {}),
    filters: definition.plan.filters.map(({ field, op, value }) => ({ field, op, value: expression(value) })),
    membershipFilters: [],
    order: definition.plan.order.map(({ field, direction, maxEncodedBytes }) => ({
      field,
      direction,
      ...(maxEncodedBytes === undefined ? {} : { maxEncodedBytes }),
    })),
    limit: definition.plan.limit,
    indexed_by: definition.plan.index,
  };
}

function equivalentCandidate(candidate, hypothetical, planHash) {
  const same = (left, right) => canonicalJson(left) === canonicalJson(right);
  return candidate.kind === hypothetical.kind
    && candidate.argsContractHash === hypothetical.argsContractHash
    && candidate.resultContractHash === hypothetical.resultContractHash
    && candidate.authRequirement === hypothetical.authRequirement
    && (candidate.authorityIndependent === true) === hypothetical.authorityIndependent
    && same(candidate.authorizationDependence ?? [], hypothetical.authorizationDependence ?? [])
    && same(candidate.authorityProfileDependence ?? [], hypothetical.authorityProfileDependence ?? [])
    && same(candidate.readSetSummary, hypothetical.readSetSummary)
    && same(candidate.writeSetSummary, hypothetical.writeSetSummary)
    && same(candidate.effectCeiling, hypothetical.effectCeiling)
    && same(candidate.standardPattern, hypothetical.standardPattern)
    && same(candidate.refusals ?? [], hypothetical.refusals)
    && candidate.syncabilityClass === hypothetical.syncabilityClass
    && candidate.retainable !== true
    && candidate.retentionClass == null
    && same(candidate.requiredCapabilities ?? [], hypothetical.requiredCapabilities ?? [])
    && candidate.planHash === planHash;
}

export function resolveDataQueryCandidateV1(candidates, normalizedDataQueryId) {
  if (candidates.length > 1) {
    throw dataQueryError(
      'SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS',
      `query ${normalizedDataQueryId} exactly matches multiple generated candidates`,
      { normalizedDataQueryId, candidates: candidates.map(({ id }) => id) },
    );
  }
  return candidates[0] ?? null;
}

export function compileDataQueryCatalog({
  templates,
  resourceDrafts,
  normalizedResources,
  decoratedByName,
  tableManifests,
  hash,
  existingNames,
}) {
  const drafts = new Map(resourceDrafts.map((draft) => [draft.resource, draft]));
  const resources = new Map(normalizedResources.map((resource) => [resource.core.resource, resource]));
  const catalog = [];
  const synthesized = [];
  const reserved = new Map();
  for (const source of templates) {
    const draft = drafts.get(source.resource);
    const resource = resources.get(source.resource);
    if (!draft || !resource) continue;
    const template = validateAndCanonicalizeTemplate(source, draft);
    const definition = queryDefinition(template, draft);
    const plan = planForDefinition(definition, draft);
    const runtime = { HostPlan: { Query: plan } };
    const argsContract = effectiveArgsContract(definition.args);
    const resultContract = effectiveResultContract({
      def: definition,
      functionKind: definition.__kind,
      runtime,
      tables: tableManifests,
    });
    const planHash = hash('snapback:data-plan:v1', runtime.HostPlan);
    const policyId = resource.core.access.policyId;
    const dataLoweredCandidates = draft.operationNames
      .filter((name) => name.endsWith('.list'))
      .map((name) => decoratedByName.get(name))
      .filter(Boolean);
    const requiredCapabilities = dataLoweredCandidates[0]?.requiredCapabilities ?? [];
    const core = {
      format: DATA_QUERY_FORMAT,
      surfaceProfile: 'snapback.data-surface.v1',
      resourceId: resource.id,
      resource: template.resource,
      index: template.index,
      filters: template.filters.map(({ field, operator, slots }) => ({ field, operator, slots })),
      order: { ...template.order, totalizer: '_id' },
      projection: template.projection,
      take: template.take,
      policyId,
      requiredCapabilities,
      resultContractHash: resultContractHash(resultContract),
      planHash,
      ceilings: { ...DATA_QUERY_CEILINGS },
      refusalVocabulary: [...DATA_QUERY_REFUSAL_VOCABULARY],
      guideAnchor: DATA_QUERY_GUIDE_ANCHOR,
    };
    const descriptorBytes = Buffer.byteLength(JSON.stringify(core), 'utf8');
    if (descriptorBytes > DATA_QUERY_CEILINGS.maxDescriptorBytes) {
      throw dataQueryError(
        'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
        `query descriptor is ${descriptorBytes} bytes; maxDescriptorBytes is ${DATA_QUERY_CEILINGS.maxDescriptorBytes}`,
        { ceiling: 'maxDescriptorBytes', observed: descriptorBytes },
      );
    }
    const normalizedDataQueryId = hash('snapback:normalized-data-query:v1', core);
    const hypothetical = {
      kind: definition.__kind,
      argsContractHash: argsContractHash(argsContract),
      resultContractHash: resultContractHash(resultContract),
      authRequirement: draft.access.kind === 'owner' ? 'authenticated' : 'public',
      authorityIndependent: draft.access.kind === 'public-read',
      authorizationDependence: draft.access.kind === 'owner' ? ['userId'] : [],
      authorityProfileDependence: [],
      readSetSummary: {
        mode: 'singleTable', primaryTable: draft.table, tables: [draft.table],
        authScopeField: draft.access.kind === 'owner' ? draft.access.field : null,
      },
      writeSetSummary: { mode: 'none', primaryTable: null, tables: [] },
      effectCeiling: {
        version: 'EffectCeilingV1',
        basis: 'static',
        reads: [{ table: draft.table, access: 'query', index: template.index }],
        writes: [],
        authorizationInputs: draft.access.kind === 'owner' ? ['authUserId'] : [],
        hostOperations: [],
      },
      standardPattern: {
        helper: 'data-resource.v1',
        profile: draft.access.kind === 'owner' ? 'owner.v1' : 'public-read.v1',
      },
      refusals: [],
      syncabilityClass: draft.sync.enabled ? 'syncable-live' : 'online-only',
      requiredCapabilities,
    };
    const candidates = dataLoweredCandidates
      .map((candidate) => ({ ...candidate, planHash: hash('snapback:data-plan:v1', candidate.runtime.HostPlan) }))
      .filter((candidate) => equivalentCandidate(candidate, hypothetical, planHash));
    const resolvedCandidate = resolveDataQueryCandidateV1(candidates, normalizedDataQueryId);
    if (catalog.some((entry) => entry.normalizedDataQueryId === normalizedDataQueryId)) {
      // Source property/list order is deliberately outside normalized query
      // identity. Keep the first deterministic source span and emit exactly
      // one catalog/function member for the shared pre-resolution witness.
      continue;
    }
    let exportedName;
    let resolutionKind;
    if (resolvedCandidate !== null) {
      exportedName = resolvedCandidate.exportedName;
      resolutionKind = 'existing-generated';
    } else {
      exportedName = `${template.resource}.query_${normalizedDataQueryId.slice('sha256:'.length, 'sha256:'.length + 16)}`;
      resolutionKind = 'synthesized-generated';
      const previous = reserved.get(exportedName);
      if ((previous && previous !== normalizedDataQueryId) || existingNames.has(exportedName)) {
        throw dataQueryError(
          'SNAPBACK_DATA_QUERY_NAME_COLLISION',
          `synthesized query name ${exportedName} collides with another function or witness`,
          { exportedName, normalizedDataQueryId, previous: previous ?? null },
        );
      }
      reserved.set(exportedName, normalizedDataQueryId);
      synthesized.push({
        exportedName,
        definition,
        plan,
        argsContract,
        resultContract,
        sourceSpan: template.sourceSpan,
      });
    }
    catalog.push({
      id: normalizedDataQueryId,
      core,
      normalizedDataQueryId,
      resolution: { kind: resolutionKind, exportedName },
      argumentNames: argumentNames(template.filters),
      policyClass: draft.access.kind,
      shape: {
        resource: source.resource,
        index: source.index,
        filters: template.filters.map(({ field, operator }) => ({ field, operator })),
        order: source.order,
        projection: template.projection.kind === 'selected-fields'
          ? template.projection.fields
          : null,
        take: source.take,
      },
      sourceSpan: template.sourceSpan,
    });
  }
  catalog.sort((left, right) => codeUnitCompare(left.id, right.id));
  return { catalog, synthesized };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(codeUnitCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'query arguments must be finite JSON');
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'query arguments must be portable JSON and never undefined');
  }
  return JSON.stringify(value);
}

export function dataQueryDomainHash(domain, value) {
  return `sha256:${createHash('sha256').update(`${domain}\n`, 'utf8').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function createDataQueryEnvelopeV1({
  catalogEntry,
  generation,
  functionReference,
  arguments: positionalArguments,
  cursor = null,
  authorityPartitionDigest,
  materializationKey = null,
}) {
  if (!catalogEntry || positionalArguments.length !== catalogEntry.argumentNames.length) {
    throw dataQueryError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'query arguments do not fill the catalogued slots densely');
  }
  if (cursor !== null && (typeof cursor !== 'string' || !cursor.startsWith('dc1.') || Buffer.byteLength(cursor, 'utf8') > 2_048)) {
    throw dataQueryError('SNAPBACK_DATA_CURSOR_INVALID', 'cursor is not a bounded DataCursorV1');
  }
  const namedArgs = Object.fromEntries(catalogEntry.argumentNames.map((name, index) => [name, positionalArguments[index]]));
  if (cursor !== null) namedArgs.after = cursor;
  const canonicalArgsDigest = dataQueryDomainHash('snapback:data-canonical-args:v1', Object.fromEntries(
    Object.entries(namedArgs).filter(([name]) => name !== 'after'),
  ));
  const explain = {
    witness: catalogEntry.normalizedDataQueryId,
    resource: catalogEntry.core.resource,
    table: catalogEntry.core.resource,
    index: catalogEntry.core.index,
    policyId: catalogEntry.core.policyId,
    policyClass: catalogEntry.policyClass ?? 'public-read',
    filters: catalogEntry.core.filters,
    order: catalogEntry.core.order,
    projection: catalogEntry.core.projection.fields,
    take: catalogEntry.core.take,
    ceilings: catalogEntry.core.ceilings,
    resolution: { ...catalogEntry.resolution, candidateCount: catalogEntry.resolution.kind === 'existing-generated' ? 1 : 0 },
    planHash: catalogEntry.core.planHash,
    resultContractHash: catalogEntry.core.resultContractHash,
    requiredCapabilities: catalogEntry.core.requiredCapabilities,
    servedCapabilities: catalogEntry.core.requiredCapabilities,
    retained: false,
    materializationKey,
    authorityPartitionDigest,
    ownershipReason: 'canonical generated function/materialization owner',
    refusal: null,
  };
  return {
    artifactKind: 'dataQuery',
    schemaVersion: DATA_QUERY_SCHEMA_VERSION,
    normalizedDataQueryId: catalogEntry.normalizedDataQueryId,
    core: catalogEntry.core,
    resolution: {
      ...catalogEntry.resolution,
      functionId: functionReference.id,
    },
    generation,
    functionReference,
    arguments: [...positionalArguments],
    canonicalArgsDigest,
    cursor,
    authorityPartitionDigest,
    materializationKey,
    explain,
    sourceSpan: catalogEntry.sourceSpan,
  };
}

const DATA_QUERY_RUNTIME_CRYPTO = String.raw`
const __dataEncoder = new TextEncoder();
const __dataShaK = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const __dataSha256 = (bytes) => {
  const length = bytes.length; const bits = length * 8;
  const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64); padded.set(bytes); padded[length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000)); view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) { const s0=((w[i-15]>>>7)|(w[i-15]<<25))^((w[i-15]>>>18)|(w[i-15]<<14))^(w[i-15]>>>3); const s1=((w[i-2]>>>17)|(w[i-2]<<15))^((w[i-2]>>>19)|(w[i-2]<<13))^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0; }
    let [a,b,c,d,e,f,g,z]=h;
    for (let i=0;i<64;i+=1) { const s1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)); const ch=(e&f)^(~e&g); const t1=(z+s1+ch+__dataShaK[i]+w[i])>>>0; const s0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)); const maj=(a&b)^(a&c)^(b&c); const t2=(s0+maj)>>>0; z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
    h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+z)>>>0;
  }
  const out = new Uint8Array(32); const outView = new DataView(out.buffer); for (let i=0;i<8;i+=1) outView.setUint32(i*4,h[i]); return out;
};
const __dataCanonical = (value) => Array.isArray(value)
  ? '[' + value.map(__dataCanonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + __dataCanonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const __dataDigest = (domain, value) => 'sha256:' + [...__dataSha256(__dataEncoder.encode(domain + '\n' + __dataCanonical(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
`;

export function renderDataQueryRuntime(catalog) {
  const runtimeCatalog = catalog.map((entry) => ({
    ...entry,
    policyClass: entry.policyClass,
    generation: entry.generation,
    functionReference: entry.functionReference,
  }));
  return `\nexport const dataQueryCatalog = Object.freeze(${JSON.stringify(runtimeCatalog, null, 2)});\n`
    + DATA_QUERY_RUNTIME_CRYPTO
    + `const __dataError = (code, message) => Object.assign(new TypeError(code + ': ' + message), { code });\n`
    + `const __shape = (value) => { if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'query values must be finite portable JSON'); return value; };\n`
    + `const __operator = (value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) return { operator: 'eq', values: [__shape(value)] }; const keys = Object.keys(value); const lower = keys.find((key) => key === 'gt' || key === 'gte'); const upper = keys.find((key) => key === 'lt' || key === 'lte'); const singles = new Set(['eq','in','lt','lte','gt','gte']); const operator = keys.length === 1 && singles.has(keys[0]) ? keys[0] : (keys.length === 2 && lower && upper ? lower + '-' + upper : ''); if (!operator) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'predicate object is outside the closed grammar'); const ordered = operator.includes('-') ? operator.split('-') : [operator]; let values = ordered.map((key) => __shape(value[key])); if (operator === 'in') { if (!Array.isArray(values[0]) || values[0].length < 1 || values[0].length > 32) throw __dataError('SNAPBACK_DATA_QUERY_BOUND_EXCEEDED', 'in requires 1..32 values'); values = [[...new Map(values[0].map((item) => [JSON.stringify(item), item])).values()]]; } return { operator, values }; };\n`
    + `const __sameProjection = (authored, canonical) => { if (authored === null || canonical === null) return authored === canonical; if (authored.length !== canonical.length || new Set(authored).size !== authored.length) return false; const admitted = new Set(canonical); return authored.every((field) => admitted.has(field)); };\n`
    + `const __finish = (state, cursor = null) => { if (!Number.isSafeInteger(state.take) || state.take < 1 || state.take > 200) throw __dataError('SNAPBACK_DATA_QUERY_BOUND_EXCEEDED', 'take must be a safe integer in 1..200'); if (state.projection !== null && state.projection.length < 1) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'select requires at least one duplicate-free field'); if (state.projection !== null && state.projection.length > 64) throw __dataError('SNAPBACK_DATA_QUERY_BOUND_EXCEEDED', 'select exceeds maxProjectionFields 64'); if (state.projection !== null && new Set(state.projection).size !== state.projection.length) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'select fields must be duplicate-free'); if (cursor !== null && (typeof cursor !== 'string' || !cursor.startsWith('dc1.') || new TextEncoder().encode(cursor).length > 2048)) throw __dataError('SNAPBACK_DATA_CURSOR_INVALID', 'cursor is not a bounded DataCursorV1'); const byField = new Map(state.filters.map((filter) => [filter.field, filter])); const entry = dataQueryCatalog.find((candidate) => candidate.shape.resource === state.resource && candidate.shape.index === state.index && JSON.stringify(candidate.shape.order) === JSON.stringify(state.order) && candidate.shape.take === state.take && __sameProjection(state.projection, candidate.shape.projection) && candidate.shape.filters.length === state.filters.length && candidate.shape.filters.every((filter) => byField.get(filter.field)?.operator === filter.operator)); if (!entry) throw __dataError('SNAPBACK_DATA_QUERY_NOT_CATALOGUED', 'this dynamic query shape is absent from the active static catalogue'); const args = entry.shape.filters.flatMap(({ field }) => byField.get(field).values); const namedArguments = Object.assign(Object.fromEntries(entry.argumentNames.map((name, index) => [name, args[index]])), cursor === null ? {} : { after: cursor }); const descriptor = { ...entry.envelope, arguments: Object.freeze(args), canonicalArgsDigest: __dataDigest('snapback:data-canonical-args:v1', Object.fromEntries(Object.entries(namedArguments).filter(([name]) => name !== 'after'))), cursor, namedArguments: Object.freeze(namedArguments) }; return Object.freeze(cursor === null ? { ...descriptor, after(next) { return __finish(state, next); } } : descriptor); };\n`
    + `const __resource = (resource) => Object.freeze({ using(index) { const base = { resource, index, filters: [], projection: null }; const ordered = (state) => Object.freeze({ orderBy(field, direction) { const next = { ...state, order: { field, direction } }; return Object.freeze({ select(fields) { if (!Array.isArray(fields)) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'select requires an array'); const selected = { ...next, projection: [...fields] }; return Object.freeze({ take(take) { return __finish({ ...selected, take }); } }); }, take(take) { return __finish({ ...next, take }); } }); } }); return Object.freeze({ where(filters) { if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'where requires an object'); const entries = Object.entries(filters); if (entries.length < 1) throw __dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'where requires at least one field'); if (entries.length > 8) throw __dataError('SNAPBACK_DATA_QUERY_BOUND_EXCEEDED', 'where exceeds maxFilterFields 8'); return ordered({ ...base, filters: entries.map(([field, value]) => ({ field, ...__operator(value) })) }); }, orderBy: ordered(base).orderBy }); } });\n`
    + `const __dataObject = Object.fromEntries([...new Set(dataQueryCatalog.map(({ core }) => core.resource))].map((resource) => [resource, __resource(resource)]));\n`
    + `export const explainDataQuery = (descriptor) => descriptor?.explain ?? descriptor?.envelope?.explain ?? null;\n`;
}

function dataQueryContractType(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if (value.kind === 'null') return 'null';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'string' || value.kind === 'assetRef') return 'string';
  if (value.kind === 'principal') return 'Principal';
  if (value.kind === 'id') return `Id<${JSON.stringify(value.table)}>`;
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'json') return 'unknown';
  if (value.kind === 'array') return `ReadonlyArray<${dataQueryContractType(value.element)}>`;
  if (value.kind === 'tuple') return `readonly [${(value.elements ?? []).map(dataQueryContractType).join(', ')}]`;
  if (value.kind === 'vector') return `ReadonlyArray<number> & { readonly length: ${value.dimensions} }`;
  if (value.kind === 'union') return (value.variants ?? []).map(dataQueryContractType).join(' | ');
  if (value.kind === 'object') {
    const fields = (value.fields ?? []).map((field) => (
      `readonly ${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${dataQueryContractType(field.value)}`
    ));
    return fields.length === 0 ? 'Readonly<Record<string, never>>' : `Readonly<{ ${fields.join('; ')} }>`;
  }
  return 'unknown';
}

export function renderDataQueryTypes(resources) {
  const resourceTypes = resources.map(({ core }) => {
    const name = core.resource.replace(/(^|_)([a-z])/gu, (_, __, letter) => letter.toUpperCase());
    const indexes = core.indexes.map(({ name: index }) => JSON.stringify(index)).join(' | ') || 'never';
    const fields = core.fields.map(({ name: field }) => JSON.stringify(field)).join(' | ') || 'never';
    const row = `Readonly<{ ${core.fields.map((field) => (
      `readonly ${JSON.stringify(field.name)}${field.optional ? '?' : ''}: ${dataQueryContractType(field.validatorContract)}`
    )).join('; ')} }>`;
    return `type ${name}DataRow = ${row};\n`
      + `type ${name}DataField = keyof ${name}DataRow;\n`
      + `interface ${name}DataUsing { using(index: ${indexes}): ${name}DataWhereOrOrder; }\n`
      + `interface ${name}DataWhereOrOrder { where(filters: Readonly<Partial<Record<${fields}, DataPredicateV1>>>): ${name}DataOrder; orderBy(field: ${fields}, direction: DataOrderDirectionV1): ${name}DataSelectOrTake; }\n`
      + `interface ${name}DataOrder { orderBy(field: ${fields}, direction: DataOrderDirectionV1): ${name}DataSelectOrTake; }\n`
      + `interface ${name}DataSelectOrTake { select<const Fields extends readonly ${name}DataField[]>(fields: Fields): ${name}DataTake<Pick<${name}DataRow, Fields[number]>>; take(limit: number): DataQueryDescriptorV1<${name}DataRow>; }\n`
      + `interface ${name}DataTake<Row> { take(limit: number): DataQueryDescriptorV1<Row>; }\n`;
  }).join('\n');
  const members = resources.map(({ core }) => {
    const name = core.resource.replace(/(^|_)([a-z])/gu, (_, __, letter) => letter.toUpperCase());
    return `readonly ${JSON.stringify(core.resource)}: ${name}DataUsing;`;
  }).join(' ');
  return `export type DataOrderDirectionV1 = 'asc' | 'desc';\n`
    + `export type DataPredicateV1<T = unknown> = T | Readonly<{ eq: T } | { in: readonly T[] } | { lt: T } | { lte: T } | { gt: T } | { gte: T } | { gt: T; lt: T } | { gt: T; lte: T } | { gte: T; lt: T } | { gte: T; lte: T }>;\n`
    + `export interface DataQueryPageV1<Row = Readonly<Record<string, unknown>>> { readonly artifactKind: 'dataQuery'; readonly schemaVersion: 'snapback.data-query.v1'; readonly normalizedDataQueryId: \`sha256:\${string}\`; readonly arguments: readonly unknown[]; readonly cursor: string | null; readonly __result?: Row; }\n`
    + `export interface DataQueryDescriptorV1<Row = Readonly<Record<string, unknown>>> extends DataQueryPageV1<Row> { after(cursor: string): DataQueryPageV1<Row>; }\n`
    + resourceTypes
    + `export declare const data: Readonly<{ ${members} }> & Readonly<{ readonly __snapbackDataTypeBinding?: Readonly<{ readonly tx: DataTransactionBuilderV1 }> }>;\n`
    + `export declare const dataQueryCatalog: readonly Readonly<Record<string, unknown>>[];\n`
    + `export declare function explainDataQuery(descriptor: DataQueryDescriptorV1<unknown>): Readonly<Record<string, unknown>> | null;\n`
    + `declare module '@expo/snapback-react/data' { interface SnapbackDataBinding { readonly data: typeof data; } }\n`;
}
