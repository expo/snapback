// Schema-derived common operations for the declarative data tier.
//
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
//   common CRUD, unique lookup, and pagination should be generated from one
//   schema source, while authorization and visibility remain explicit.
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   generated writes stay inside the closed, portable mutation IR.
// @ref LLP 0065#2-the-v1-visibility-floor — owner visibility is an executable
//   predicate and transaction guard, never metadata-only inference.

import {
  arg,
  asc,
  authUserId,
  bindingRef,
  defineLiveQuery,
  defineMutation,
  defineQuery,
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
  membershipResource,
  patch,
  returnDocument,
  runtimeId,
  runtimeNow,
  v,
} from './define.mjs';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CRUD_NAME_FIELDS = Object.freeze(['list', 'get', 'create', 'update', 'delete']);
const CRUD_OPTION_FIELDS = new Set([
  'table', 'names', 'visibility', 'idArg', 'createDefaults',
  'updateDefaults', 'immutable', 'listIndex', 'listLimit',
  'discloseUniqueConflicts',
]);
const UNIQUE_LOOKUP_OPTION_FIELDS = new Set([
  'table', 'name', 'index', 'visibility', 'live',
]);
const KEYSET_OPTION_FIELDS = new Set([
  'table', 'names', 'index', 'cursorField', 'cursor', 'direction',
  'limit', 'visibility',
]);
const MEMBERSHIP_KEYSET_OPTION_FIELDS = new Set([
  'table', 'names', 'membership', 'index', 'cursorField', 'cursor',
  'direction', 'limit',
]);
const MEMBERSHIP_KEYSET_MEMBERSHIP_FIELDS = new Set([
  'declaration', 'resourceArg', 'resourceField', 'roles',
]);
const SYSTEM_ORDER_FIELDS = new Set(['_id', '_version', '_createdAt', '_updatedAt']);

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
  return {
    name: table.__tableName,
    fields: table.fields,
    indexes: table.indexes ?? [],
    authorityBearing: Boolean(table.membershipDeclaration) || Boolean(table.permissionBackingDeclared),
  };
}

function requireName(name, where) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where} must be a JavaScript identifier`);
  }
  return name;
}

function ownerVisibility(table, visibility) {
  if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'v1 standard patterns require visibility: { kind: "owner", field: ... }',
    );
  }
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
    // @ref LLP 0065#3-common-pattern-contracts — `now` binds only to a
    //   JavaScript-safe integer millisecond field; float timestamps are not
    //   admitted.
    if (kind === 'now' && validator.fieldType !== 'Integer') {
      fail(
        'SNAPBACK_STANDARD_PATTERN_INVALID',
        `${where}.${field} uses now but is not an integer millisecond field`,
      );
    }
    if (kind === 'id' && (validator.fieldType !== 'String' || validator.optional)) {
      fail(
        'SNAPBACK_STANDARD_PATTERN_INVALID',
        `${where}.${field} uses id but is not a plain string field`,
      );
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

// The public boundary collapses missing and invisible: both legs refuse with
// SNAPBACK_ROW_NOT_FOUND and an identical body, so a caller probing another
// owner's id learns nothing an absent id would not teach. The distinguishing
// record belongs to the separately authorized audit channel, never a public
// code.
// @ref LLP 0065#2-the-v1-visibility-floor — existence secrecy collapses at
//   the public boundary by default.
function ownedRowGuard(tableName, idArg, ownerField, bindAs) {
  return [
    get(tableName, arg(idArg), bindAs, { elseError: 'SNAPBACK_ROW_NOT_FOUND' }),
    guard(
      eqv(field(bindingRef(bindAs), ownerField), authUserId()),
      'SNAPBACK_ROW_NOT_FOUND',
    ),
  ];
}

function requireDistinctNames(names, fields, where) {
  const values = fields.map((field) => names[field]);
  if (new Set(values).size !== values.length) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', `${where} must name distinct operations`);
  }
}

/**
 * Generate list/get/create/update/delete functions from a bound table builder.
 *
 * The first profile deliberately supports only owner visibility. That makes
 * the declaration floor executable: callers cannot omit visibility or infer
 * it from read/write sets, and generated mutations re-check ownership inside
 * the transaction before touching a row.
 */
export function defineOwnedCrud(options) {
  exactObject(options, 'defineOwnedCrud options', CRUD_OPTION_FIELDS);
  const {
    table,
    names,
    visibility,
    idArg = 'id',
    createDefaults,
    updateDefaults,
    immutable = [],
    listIndex,
    listLimit = 100,
    discloseUniqueConflicts = [],
  } = options;
  const facts = tableFacts(table);
  // @ref LLP 0065#3-common-pattern-contracts — mutating helpers refuse
  //   authority-bearing tables: generic CRUD over a membership or
  //   permission-backing table would launder authority creation past LLP
  //   0055/0056's provenance and effect-site gates.
  if (facts.authorityBearing) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE',
      `${facts.name} carries a membership or permission-backing declaration; `
        + 'generated CRUD cannot own authority-bearing writes',
    );
  }
  exactObject(names, 'names', new Set(CRUD_NAME_FIELDS));
  for (const field of CRUD_NAME_FIELDS) requireName(names[field], `names.${field}`);
  requireDistinctNames(names, CRUD_NAME_FIELDS, 'names');
  requireName(idArg, 'idArg');
  if (Object.hasOwn(facts.fields, idArg)) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', `idArg ${idArg} collides with a schema field`);
  }
  const ownerField = ownerVisibility(facts, visibility);
  const createDefaultMap = normalizeDefaults(facts, createDefaults, 'createDefaults');
  const updateDefaultMap = normalizeDefaults(facts, updateDefaults, 'updateDefaults');
  if (Object.hasOwn(createDefaultMap, ownerField) || Object.hasOwn(updateDefaultMap, ownerField)) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_INVALID',
      `trusted defaults cannot set owner visibility field ${ownerField}`,
    );
  }
  if (!Array.isArray(immutable) || immutable.some((field) => typeof field !== 'string' || !Object.hasOwn(facts.fields, field))) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'immutable must contain schema field names');
  }
  const updateDefaultFields = Object.keys(updateDefaultMap);
  if (immutable.some((field) => updateDefaultFields.includes(field))) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'updateDefaults cannot set immutable fields');
  }
  // @ref LLP 0065#3-common-pattern-contracts — the generated list requires an
  //   explicitly named owner-leading declared index; index choice is never
  //   inferred and an unindexed owner scan is never emitted. Ordering is the
  //   index sequence; the storage layer's implicit `_id` component totalizes
  //   it (LLP 0007 amended Index Contract).
  if (listIndex === undefined) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED',
      'defineOwnedCrud requires listIndex naming a declared index whose leading field is the owner field',
    );
  }
  requireName(listIndex, 'listIndex');
  const listIndexFacts = facts.indexes.find((candidate) => candidate.name === listIndex);
  if (!listIndexFacts || listIndexFacts.fields[0] !== ownerField) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED',
      `listIndex ${listIndex} must be a declared index whose leading field is ${ownerField}`,
    );
  }
  if (!Number.isSafeInteger(listLimit) || listLimit < 1 || listLimit > 1_024) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'listLimit must be an integer from 1 through 1024');
  }
  // @ref LLP 0065#2-the-v1-visibility-floor — uniqueness is existence
  //   disclosure by conflict: a client-observable unique constraint reached
  //   by generated create/update must be owner-partitioned or carry an
  //   explicit disclosure declaration naming the index.
  if (
    !Array.isArray(discloseUniqueConflicts)
    || discloseUniqueConflicts.some((name) => typeof name !== 'string')
  ) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'discloseUniqueConflicts must be an array of index names');
  }
  for (const name of discloseUniqueConflicts) {
    if (!facts.indexes.some((candidate) => candidate.name === name && candidate.unique)) {
      fail(
        'SNAPBACK_STANDARD_PATTERN_INVALID',
        `discloseUniqueConflicts names ${name}, which is not a declared unique index`,
      );
    }
  }
  for (const index of facts.indexes) {
    if (!index.unique) continue;
    if (index.fields.includes(ownerField)) continue;
    if (discloseUniqueConflicts.includes(index.name)) continue;
    fail(
      'SNAPBACK_STANDARD_PATTERN_DISCLOSURE_REQUIRED',
      `unique index ${index.name} excludes owner field ${ownerField}: a generated create/update `
        + 'conflict would disclose another owner\'s row; owner-partition the index or name it in '
        + 'discloseUniqueConflicts',
    );
  }

  const create = argsAndValues(facts, new Set([ownerField]), createDefaultMap);
  create.values[ownerField] = authUserId();
  const update = argsAndValues(
    facts,
    new Set([ownerField, ...immutable, ...updateDefaultFields]),
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
      order: listIndexFacts.fields.slice(1).map((field) => asc(field)),
      limit: listLimit,
      index: listIndex,
      auth: 'authenticated',
      authScopeField: ownerField,
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
    }),
    [names.get]: defineLiveQuery({
      table: facts.name,
      args: getArgs,
      filter: [eq(ownerField, authUserId()), eq('_id', arg(idArg))],
      auth: 'authenticated',
      authScopeField: ownerField,
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
    }),
    [names.create]: defineMutation({
      args: create.args,
      auth: 'authenticated',
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
      plan: insert(facts.name, create.values, { bindIdAs: createIdBind }),
      returns: returnDocument(facts.name, bindingRef(createIdBind)),
    }),
    [names.update]: defineMutation({
      args: { ...getArgs, ...update.args },
      auth: 'authenticated',
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
      plan: [
        ...ownedRowGuard(facts.name, idArg, ownerField, rowBind),
        patch(facts.name, arg(idArg), update.values),
      ],
      returns: returnDocument(facts.name, arg(idArg)),
    }),
    [names.delete]: defineMutation({
      args: getArgs,
      auth: 'authenticated',
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
      plan: [
        ...ownedRowGuard(facts.name, idArg, ownerField, rowBind),
        del(facts.name, arg(idArg)),
      ],
    }),
  };
  return Object.freeze(definitions);
}

/** Generate an owner-scoped lookup backed by a declared unique index. */
export function defineOwnedUniqueLookup(options) {
  exactObject(options, 'defineOwnedUniqueLookup options', UNIQUE_LOOKUP_OPTION_FIELDS);
  const { table, name, index, visibility, live = true } = options;
  const facts = tableFacts(table);
  requireName(name, 'name');
  if (typeof live !== 'boolean') {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'live must be boolean');
  }
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
    standardPattern: { helper: 'owned-unique-lookup.v1', profile: 'owner.v1' },
  };
  const definition = live ? defineLiveQuery(query) : defineLiveQuery({ ...query, defaultLive: false });
  return Object.freeze({ [name]: definition });
}

/**
 * Generate first/next owner-scoped keyset pages. The selected index must
 * have exactly the visibility field followed by the cursor field, so the
 * cursor is both an index range boundary and unique within one owner.
 */
export function defineOwnedKeysetPages(options) {
  exactObject(options, 'defineOwnedKeysetPages options', KEYSET_OPTION_FIELDS);
  const {
    table,
    names,
    index,
    cursorField,
    cursor = 'after',
    direction = 'asc',
    limit = 50,
    visibility,
  } = options;
  const facts = tableFacts(table);
  exactObject(names, 'names', new Set(['first', 'next']));
  requireName(names.first, 'names.first');
  requireName(names.next, 'names.next');
  requireDistinctNames(names, ['first', 'next'], 'names');
  requireName(cursorField, 'cursorField');
  requireName(cursor, 'cursor');
  const ownerField = ownerVisibility(facts, visibility);
  if (cursorField === ownerField) {
    fail('SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED', 'cursor field must differ from owner field');
  }
  if (direction !== 'asc' && direction !== 'desc') {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'direction must be asc or desc');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_024) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'limit must be an integer from 1 through 1024');
  }
  const indexFacts = facts.indexes.find((candidate) => candidate.name === index);
  if (
    !indexFacts
    || indexFacts.unique !== true
    || indexFacts.fields.length !== 2
    || indexFacts.fields[0] !== ownerField
    || indexFacts.fields[1] !== cursorField
  ) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED',
      `${index} must be unique with exact fields [${ownerField}, ${cursorField}] in that order`,
    );
  }
  const cursorValidator = facts.fields[cursorField];
  if (!cursorValidator) fail('SNAPBACK_STANDARD_PATTERN_INVALID', `unknown cursor field ${cursorField}`);
  if (cursorValidator.optional) {
    fail('SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED', `cursor field ${cursorField} must be required`);
  }
  const order = direction === 'asc' ? asc(cursorField) : desc(cursorField);
  const after = direction === 'asc' ? gtFilter(cursorField, arg(cursor)) : ltFilter(cursorField, arg(cursor));
  const base = {
    table: facts.name,
    order: [order],
    limit,
    index,
    auth: 'authenticated',
    authScopeField: ownerField,
    standardPattern: { helper: 'owned-keyset-pages.v1', profile: 'owner.v1' },
  };
  return Object.freeze({
    [names.first]: defineLiveQuery({
      ...base,
      args: {},
      filter: [eq(ownerField, authUserId())],
    }),
    [names.next]: defineLiveQuery({
      ...base,
      // The continuation argument is the opaque versioned cursor the server
      // minted on the previous full page (LLP 0065): a string token, never
      // the raw boundary value. The runtime verifies its MAC and binding
      // (app, pair plan identity, caller authority) and substitutes the
      // bound boundary before the strict comparison runs; a malformed,
      // cross-plan, or cross-owner token refuses with
      // SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID, never repositioned.
      args: { [cursor]: v.string() },
      filter: [eq(ownerField, authUserId()), after],
    }),
  });
}

/**
 * Generate first/next membership-scoped keyset pages (LLP 0100 §4): pages of
 * one membership-protected resource, visible to the caller's declared seat
 * rather than a principal-owner partition. The selected index must be unique
 * with exactly [resourceField, cursorField], and the declaration-bound
 * membership predicate executes on every page invocation — executable
 * authority, never metadata.
 *
 * @ref LLP 0100#4-membership-scoped-keyset-pages — the pair is emitted as
 *   ordinary callable `Query` definitions (a deliberate delta from the owned
 *   helper's defineLiveQuery+defaultLive:false emission): a subscribable
 *   historical page would be exactly the per-visited-page
 *   authorization-sensitive subscription the RFC rules out. The separate
 *   current-room live_replace query owns live grant/revocation updates.
 */
export function defineMembershipKeysetPages(options) {
  exactObject(options, 'defineMembershipKeysetPages options', MEMBERSHIP_KEYSET_OPTION_FIELDS);
  const {
    table,
    names,
    membership,
    index,
    cursorField,
    cursor = 'after',
    direction = 'asc',
    limit = 50,
  } = options;
  const facts = tableFacts(table);
  // A membership or permission-backing table can never be the page table:
  // paging authority rows through a generated reader would disclose the
  // authority surface this helper exists to gate.
  if (facts.authorityBearing) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE',
      `${facts.name} carries a membership or permission-backing declaration; `
        + 'membership keyset pages cannot page an authority-bearing table',
    );
  }
  exactObject(names, 'names', new Set(['first', 'next']));
  requireName(names.first, 'names.first');
  requireName(names.next, 'names.next');
  requireDistinctNames(names, ['first', 'next'], 'names');
  requireName(cursorField, 'cursorField');
  requireName(cursor, 'cursor');
  if (direction !== 'asc' && direction !== 'desc') {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'direction must be asc or desc');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_024) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'limit must be an integer from 1 through 1024');
  }
  // The membership block IS this profile's visibility declaration: closed,
  // resource-scoped, and role-explicit — omission fails generation exactly
  // like a missing owner visibility.
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'defineMembershipKeysetPages requires membership: '
        + '{ declaration, resourceArg, resourceField, roles }',
    );
  }
  exactObject(membership, 'membership', MEMBERSHIP_KEYSET_MEMBERSHIP_FIELDS);
  const declarationTable = membership.declaration;
  const declared = declarationTable?.membershipDeclaration;
  if (!declarationTable?.__table || typeof declarationTable.__tableName !== 'string'
    || !declarationTable.__tableName || !declared) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'membership.declaration must be a defineTable(...) carrying membership(), '
        + 'installed in defineSchema(...)',
    );
  }
  if (declared.scope !== 'resource') {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'membership keyset pages require a resource-scoped membership declaration',
    );
  }
  const resourceArg = requireName(membership.resourceArg, 'membership.resourceArg');
  const resourceField = requireName(membership.resourceField, 'membership.resourceField');
  if (resourceArg === cursor) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'membership.resourceArg collides with the cursor argument');
  }
  if (cursorField === resourceField) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED',
      'cursor field must differ from the resource field',
    );
  }
  const resourceValidator = facts.fields[resourceField];
  if (!resourceValidator || resourceValidator.optional) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      `membership.resourceField ${resourceField} must be a required schema field`,
    );
  }
  // Exact nominal resource identity (LLP 0100 §4): the page table's resource
  // field must carry the same nominal id type as the declaration's own
  // resource axis — a string that merely looks like a room id is refused.
  const declarationResourceValidator = declarationTable.fields[declared.resource];
  if (
    !declarationResourceValidator
    || JSON.stringify(resourceValidator.fieldType)
      !== JSON.stringify(declarationResourceValidator.fieldType)
  ) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      `membership.resourceField ${resourceField} must carry the declaration's exact `
        + 'nominal resource type',
    );
  }
  // roles: a non-empty canonical subset of the declaration's FULL roles.
  // Pending roles are rejected in v1: a pending seat is not visibility.
  const roles = membership.roles;
  if (!Array.isArray(roles) || roles.length === 0
    || roles.some((role) => typeof role !== 'string' || role.length === 0)) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
      'membership.roles must be a non-empty array of declared role names',
    );
  }
  const canonicalRoles = [...new Set(roles)].sort();
  if (canonicalRoles.length !== roles.length) {
    fail('SNAPBACK_STANDARD_PATTERN_INVALID', 'membership.roles must not repeat roles');
  }
  for (const role of canonicalRoles) {
    if ((declared.pendingRoles ?? []).includes(role)) {
      fail(
        'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
        `membership.roles names pending role ${role}; pending seats are not page visibility`,
      );
    }
    if (!declared.roles.includes(role)) {
      fail(
        'SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED',
        `membership.roles names undeclared role ${role}`,
      );
    }
  }
  const indexFacts = facts.indexes.find((candidate) => candidate.name === index);
  if (
    !indexFacts
    || indexFacts.unique !== true
    || indexFacts.fields.length !== 2
    || indexFacts.fields[0] !== resourceField
    || indexFacts.fields[1] !== cursorField
  ) {
    fail(
      'SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED',
      `${index} must be unique with exact fields [${resourceField}, ${cursorField}] in that order`,
    );
  }
  const cursorValidator = facts.fields[cursorField];
  if (!cursorValidator) fail('SNAPBACK_STANDARD_PATTERN_INVALID', `unknown cursor field ${cursorField}`);
  if (cursorValidator.optional) {
    fail('SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED', `cursor field ${cursorField} must be required`);
  }
  const order = direction === 'asc' ? asc(cursorField) : desc(cursorField);
  const after = direction === 'asc' ? gtFilter(cursorField, arg(cursor)) : ltFilter(cursorField, arg(cursor));
  const seat = declarationTable.hasRole(
    membershipResource.arg(resourceArg),
    ...canonicalRoles,
  );
  const base = {
    table: facts.name,
    order: [order],
    limit,
    index,
    auth: 'authenticated',
    membership: [seat],
    standardPattern: {
      helper: 'membership-keyset-pages.v1',
      profile: 'membership.v1',
      membership: {
        declaration: declared.id ?? declarationTable.__tableName,
        resourceArg,
        resourceField,
        roles: canonicalRoles,
      },
    },
  };
  return Object.freeze({
    // Ordinary callable Query emission (LLP 0100 §4): these definitions
    // cannot be subscribed at all — not defaultLive:false live queries.
    [names.first]: defineQuery({
      ...base,
      args: { [resourceArg]: resourceValidator },
      filter: [eq(resourceField, arg(resourceArg))],
    }),
    [names.next]: defineQuery({
      ...base,
      // The continuation is the opaque MAC cursor from the previous full
      // page. Its binding additionally covers the concrete resource-argument
      // VALUE, the declaration facts, the global authorization pair, the
      // data-version stream, and the active artifact identity (LLP 0100 §5)
      // — a room-A cursor presented for room B, a post-membership-change
      // cursor, or a cursor crossing a reset/redeploy refuses with the
      // byte-identical SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID.
      args: { [resourceArg]: resourceValidator, [cursor]: v.string() },
      filter: [eq(resourceField, arg(resourceArg)), after],
    }),
  });
}
