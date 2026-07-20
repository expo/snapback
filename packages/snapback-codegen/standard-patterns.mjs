// Schema-derived common operations for the declarative data tier.
//
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
//   common CRUD, unique lookup, and pagination should be generated from one
//   schema source, while authorization and visibility remain explicit.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   generated writes stay inside the closed, portable mutation IR.

import {
  arg,
  asc,
  authUserId,
  bindingRef,
  defineLiveQuery,
  defineMutation,
  del,
  desc,
  eq,
  eqv,
  field,
  get,
  gtFilter,
  guard,
  insert,
  ltFilter,
  patch,
  returnDocument,
  runtimeId,
  runtimeNow,
  v,
} from './define.mjs';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CRUD_NAME_FIELDS = Object.freeze(['list', 'get', 'create', 'update', 'delete']);

function fail(code, message) {
  throw new TypeError(`${code}: ${message}`);
}

function exactObject(value, where, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where} must be an object`);
  }
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where} has unknown field ${field}`);
  }
}

function tableFacts(table, where = 'table') {
  if (!table?.__table || typeof table.__tableName !== 'string' || !table.__tableName) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_TABLE_UNBOUND',
      `${where} must be a defineTable(...) installed in defineSchema(...)`,
    );
  }
  return { name: table.__tableName, fields: table.fields, indexes: table.indexes ?? [] };
}

function requireName(name, where) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where} must be a JavaScript identifier`);
  }
  return name;
}

function ownerVisibility(table, visibility) {
  exactObject(visibility, 'visibility', new Set(['kind', 'field']));
  if (visibility.kind !== 'owner') {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'v1 standard patterns require visibility: { kind: "owner", field: ... }',
    );
  }
  const field = visibility.field;
  if (typeof field !== 'string' || !Object.hasOwn(table.fields, field)) {
    fail('SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED', 'visibility.field must name a schema field');
  }
  const validator = table.fields[field];
  if (validator.optional || (validator.fieldType !== 'Principal' && validator.fieldType !== 'String')) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'owner visibility requires a non-optional principal or string field',
    );
  }
  return field;
}

function normalizeDefaults(table, defaults, where) {
  if (defaults === undefined) return {};
  exactObject(defaults, where, new Set(Object.keys(table.fields)));
  const result = {};
  for (const [field, kind] of Object.entries(defaults)) {
    if (kind !== 'now' && kind !== 'id') {
      fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where}.${field} must be "now" or "id"`);
    }
    const validator = table.fields[field];
    if (kind === 'now' && !['Integer', 'Real'].includes(validator.fieldType)) {
      fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where}.${field} uses now but is not numeric`);
    }
    if (kind === 'id' && validator.primitive !== 'string') {
      fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where}.${field} uses id but is not string-valued`);
    }
    result[field] = kind;
  }
  return result;
}

function defaultExpr(kind) {
  return kind === 'now' ? runtimeNow() : runtimeId();
}

function argsAndValues(table, excluded, defaults = {}) {
  const args = {};
  const values = {};
  for (const [field, validator] of Object.entries(table.fields)) {
    if (excluded.has(field)) continue;
    if (Object.hasOwn(defaults, field)) {
      values[field] = defaultExpr(defaults[field]);
    } else {
      args[field] = validator;
      values[field] = arg(field);
    }
  }
  return { args, values };
}

function ownedRowGuard(tableName, idArg, ownerField, bindAs) {
  return [
    get(tableName, arg(idArg), bindAs, { elseError: 'SNAPBACK_ROW_NOT_FOUND' }),
    guard(
      eqv(field(bindingRef(bindAs), ownerField), authUserId()),
      'SNAPBACK_ROW_NOT_VISIBLE',
    ),
  ];
}

/**
 * Generate list/get/create/update/delete functions from a bound table builder.
 *
 * The first profile deliberately supports only owner visibility. That makes
 * the declaration floor executable: callers cannot omit visibility or infer
 * it from read/write sets, and generated mutations re-check ownership inside
 * the transaction before touching a row.
 */
export function defineOwnedCrud({
  table,
  names,
  visibility,
  idArg = 'id',
  createDefaults,
  updateDefaults,
  immutable = [],
  listOrder = '_createdAt',
  listLimit = 100,
}) {
  const facts = tableFacts(table);
  exactObject(names, 'names', new Set(CRUD_NAME_FIELDS));
  for (const field of CRUD_NAME_FIELDS) requireName(names[field], `names.${field}`);
  requireName(idArg, 'idArg');
  const ownerField = ownerVisibility(facts, visibility);
  const createDefaultMap = normalizeDefaults(facts, createDefaults, 'createDefaults');
  const updateDefaultMap = normalizeDefaults(facts, updateDefaults, 'updateDefaults');
  if (!Array.isArray(immutable) || immutable.some((field) => typeof field !== 'string' || !Object.hasOwn(facts.fields, field))) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'immutable must contain schema field names');
  }
  if (!Number.isSafeInteger(listLimit) || listLimit < 1 || listLimit > 1_024) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'listLimit must be an integer from 1 through 1024');
  }

  const create = argsAndValues(facts, new Set([ownerField]), createDefaultMap);
  create.values[ownerField] = authUserId();
  const update = argsAndValues(
    facts,
    new Set([ownerField, ...immutable, ...Object.keys(updateDefaultMap)]),
  );
  for (const [field, kind] of Object.entries(updateDefaultMap)) update.values[field] = defaultExpr(kind);

  const getArgs = { [idArg]: v.id(facts.name) };
  const rowBind = '__standardOwnedRow';
  const createIdBind = '__standardCreatedId';
  const definitions = {
    [names.list]: defineLiveQuery({
      table: facts.name,
      args: {},
      filter: [eq(ownerField, authUserId())],
      order: [asc(listOrder)],
      limit: listLimit,
      auth: 'authenticated',
      authScopeField: ownerField,
    }),
    [names.get]: defineLiveQuery({
      table: facts.name,
      args: getArgs,
      filter: [eq(ownerField, authUserId()), eq('_id', arg(idArg))],
      auth: 'authenticated',
      authScopeField: ownerField,
    }),
    [names.create]: defineMutation({
      args: create.args,
      auth: 'authenticated',
      plan: insert(facts.name, create.values, { bindIdAs: createIdBind }),
      returns: returnDocument(facts.name, bindingRef(createIdBind)),
    }),
    [names.update]: defineMutation({
      args: { ...getArgs, ...update.args },
      auth: 'authenticated',
      plan: [
        ...ownedRowGuard(facts.name, idArg, ownerField, rowBind),
        patch(facts.name, arg(idArg), update.values),
      ],
      returns: returnDocument(facts.name, arg(idArg)),
    }),
    [names.delete]: defineMutation({
      args: getArgs,
      auth: 'authenticated',
      plan: [
        ...ownedRowGuard(facts.name, idArg, ownerField, rowBind),
        del(facts.name, arg(idArg)),
      ],
    }),
  };
  return Object.freeze(definitions);
}

/** Generate an owner-scoped lookup backed by a declared unique index. */
export function defineOwnedUniqueLookup({ table, name, index, visibility, live = true }) {
  const facts = tableFacts(table);
  requireName(name, 'name');
  const ownerField = ownerVisibility(facts, visibility);
  const indexFacts = facts.indexes.find((candidate) => candidate.name === index);
  if (!indexFacts?.unique) {
    fail('SNAPBACK_STANDARD_PATTERN_UNIQUE_INDEX_REQUIRED', `${index} must be a declared unique index`);
  }
  if (!indexFacts.fields.includes(ownerField)) {
    fail('SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED', `${index} must include owner field ${ownerField}`);
  }
  const args = {};
  const filter = [];
  for (const field of indexFacts.fields) {
    if (field === ownerField) filter.push(eq(field, authUserId()));
    else {
      args[field] = facts.fields[field];
      filter.push(eq(field, arg(field)));
    }
  }
  const query = {
    table: facts.name,
    args,
    filter,
    limit: 1,
    index,
    auth: 'authenticated',
    authScopeField: ownerField,
  };
  return live ? defineLiveQuery(query) : defineLiveQuery({ ...query, defaultLive: false });
}

/**
 * Generate first/next owner-scoped keyset pages. The selected index must
 * contain both the visibility field and cursor field, so this helper never
 * hides a scan behind a pagination-looking API.
 */
export function defineOwnedKeysetPages({
  table,
  names,
  index,
  cursorField = '_id',
  cursor = 'after',
  direction = 'asc',
  limit = 50,
  visibility,
}) {
  const facts = tableFacts(table);
  exactObject(names, 'names', new Set(['first', 'next']));
  requireName(names.first, 'names.first');
  requireName(names.next, 'names.next');
  requireName(cursor, 'cursor');
  const ownerField = ownerVisibility(facts, visibility);
  if (direction !== 'asc' && direction !== 'desc') {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'direction must be asc or desc');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_024) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'limit must be an integer from 1 through 1024');
  }
  const indexFacts = facts.indexes.find((candidate) => candidate.name === index);
  if (!indexFacts || !indexFacts.fields.includes(ownerField) || !indexFacts.fields.includes(cursorField)) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED',
      `${index} must include owner field ${ownerField} and cursor field ${cursorField}`,
    );
  }
  const cursorValidator = cursorField === '_id' ? v.id(facts.name) : facts.fields[cursorField];
  if (!cursorValidator) fail('SNAPBACK_STANDARD_PATTERN_INVALID', `unknown cursor field ${cursorField}`);
  const order = direction === 'asc' ? asc(cursorField) : desc(cursorField);
  const after = direction === 'asc' ? gtFilter(cursorField, arg(cursor)) : ltFilter(cursorField, arg(cursor));
  const base = {
    table: facts.name,
    order: [order],
    limit,
    index,
    auth: 'authenticated',
    authScopeField: ownerField,
  };
  return Object.freeze({
    [names.first]: defineLiveQuery({
      ...base,
      args: {},
      filter: [eq(ownerField, authUserId())],
    }),
    [names.next]: defineLiveQuery({
      ...base,
      args: { [cursor]: cursorValidator },
      filter: [eq(ownerField, authUserId()), after],
    }),
  });
}
