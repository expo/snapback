// Familiar TypeScript authoring adapter. This module is definition-time only:
// its values are evaluated by the same capability-empty bundle/VM boundary as
// the canonical builders, and every successful constructor returns a
// canonical definition marker.

import {
  allow,
  defineAction,
  defineAssetUpload,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineSchema,
  defineTable as defineCanonicalTable,
  membershipResource,
  results,
  v,
} from './define.mjs';
import { FAMILIAR_DISPOSITIONS } from './familiar-dispositions.mjs';

export { allow, defineAssetUpload, defineSchema, membershipResource, v };

const AUTH = new Set(['public', 'optional-user', 'authenticated']);
const QUERY_KEYS = new Set([
  'args', 'returns', 'auth', 'reads', 'delivery', 'handler',
  'refusals', 'trackedRefusals', 'retainable', 'authScopeField', 'membership',
]);
const MUTATION_KEYS = new Set([
  'args', 'returns', 'auth', 'reads', 'writes', 'handler',
  'refusals', 'trackedRefusals', 'membership',
]);
const ACTION_KEYS = new Set([
  'args', 'returns', 'auth', 'secrets', 'handler',
  'refusals', 'trackedRefusals',
]);

// @ref LLP 0253#s41-constructors — every admitted familiar key is checked
// against Appendix A's committed disposition table at module load; a future
// canonical field cannot become an accidental adapter default.
const FAMILIAR_TO_CANONICAL_FIELD = Object.freeze({
  returns: 'result',
  delivery: 'defaultLive',
  secrets: 'uses',
});

for (const [kind, keys] of [['query', QUERY_KEYS], ['mutation', MUTATION_KEYS], ['action', ACTION_KEYS]]) {
  for (const key of keys) {
    const canonical = FAMILIAR_TO_CANONICAL_FIELD[key] ?? key;
    const disposition = FAMILIAR_DISPOSITIONS.functionSpecFields[canonical];
    if (!disposition || disposition.disposition === 4) {
      throw new Error(`familiar ${kind} key matrix is not covered by an admitted Appendix A disposition: ${key}`);
    }
  }
}

function familiarError(code, message) {
  const error = new Error(`[snapback-familiar] ${message}`);
  error.code = code;
  throw error;
}

function exactSpec(spec, kind, allowed) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    familiarError(
      'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
      `${kind} expects one closed ${kind} spec object in snapback-familiar-ts-v1`,
    );
  }
  for (const key of Object.keys(spec)) {
    if (!allowed.has(key)) {
      const disposition = FAMILIAR_DISPOSITIONS.functionSpecFields[key];
      familiarError(
        'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
        `${kind} key ${JSON.stringify(key)} is unsupported in snapback-familiar-ts-v1; ${disposition?.route ?? 'use the explicit profile (the key has no Appendix A disposition)'}`,
      );
    }
  }
}

function required(spec, kind, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(spec, key)) {
      familiarError(
        'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
        `${kind} requires ${key} in snapback-familiar-ts-v1`,
      );
    }
  }
}

function familiarReturns(spec, kind) {
  if (!Object.hasOwn(spec, 'returns')) {
    familiarError(
      'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
      `${kind} requires returns in the familiar v.* grammar; run the LLP 0245 declaration suggestion and accept its addition-only returns patch`,
    );
  }
  return lowerFamiliarReturns(kind, spec.returns);
}

function auth(spec, kind) {
  if (!Object.hasOwn(spec, 'auth')) {
    familiarError(
      'SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING',
      `${kind} requires auth: "public" | "optional-user" | "authenticated"; familiar v1 never defaults auth to public`,
    );
  }
  if (!AUTH.has(spec.auth)) {
    familiarError(
      'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
      `${kind} auth must use the canonical enum public | optional-user | authenticated`,
    );
  }
  return spec.auth;
}

const isDoc = (validator) => (
  validator?.__validator === true
  && validator?.fieldType?.AppSchemaRef?.table !== undefined
);
const isClosedRecord = (validator) => (
  validator?.__validator === true && validator.primitive === 'object'
);
function containsDoc(validator, seen = new Set()) {
  if (!validator || typeof validator !== 'object' || seen.has(validator)) return false;
  seen.add(validator);
  if (isDoc(validator)) return true;
  if (validator.resultKind === 'array') return containsDoc(validator.element, seen);
  if (validator.resultKind === 'tuple') {
    return (validator.elements ?? []).some((entry) => containsDoc(entry, seen));
  }
  if (validator.resultKind === 'union') {
    return (validator.variants ?? []).some((entry) => containsDoc(entry, seen));
  }
  if (validator.primitive === 'object') {
    return Object.values(validator.fields ?? {}).some((entry) => containsDoc(entry, seen));
  }
  return false;
}

function returnsShape(validator) {
  if (isDoc(validator)) return `v.doc(${JSON.stringify(validator.fieldType.AppSchemaRef.table)})`;
  if (validator?.resultKind === 'array') {
    return `v.array(${returnsShape(validator.element)}${validator.resultOptions?.maxItems === undefined ? '' : `, { maxItems: ${validator.resultOptions.maxItems} }`})`;
  }
  if (validator?.resultKind === 'tuple') {
    return `v.tuple(${(validator.elements ?? []).map(returnsShape).join(', ')})`;
  }
  if (validator?.resultKind === 'union') {
    return `v.union(${(validator.variants ?? []).map(returnsShape).join(', ')})`;
  }
  return validator?.primitive ? `v.${validator.primitive}(...)` : 'the authored validator';
}

function unlowerable(kind, validator, route) {
  const convexGet = validator?.resultKind === 'union'
    && (validator.variants ?? []).length === 2
    && (validator.variants ?? []).some(isDoc)
    && (validator.variants ?? []).some((entry) => entry?.resultKind === 'null');
  familiarError(
    'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
    convexGet && kind === 'query'
      ? 'query returns v.union(v.doc(t), v.null()), but canonical queries are list-shaped; use returns: v.array(v.doc(t)) and return [] or [row]'
      : `${kind} returns ${returnsShape(validator)} cannot lower exactly; ${route}`,
  );
}

// @ref LLP 0253#s43-returns-lowering-kind-partitioned-refusing — Familiar
// preserves the canonical row contracts where the authored shape is already
// row-shaped and uses the canonical single-value query carrier for every
// other exact v.* result.
export function lowerFamiliarReturns(kind, validator) {
  if (!validator?.__validator) {
    unlowerable(kind, validator, 'declare returns with the familiar v.* grammar');
  }
  if (kind === 'query') {
    if (validator.resultKind === 'array') {
      const maxItems = validator.resultOptions?.maxItems;
      if (isDoc(validator.element) && maxItems === undefined) {
        return results.documents(validator.element.fieldType.AppSchemaRef.table);
      }
      if (isClosedRecord(validator.element) && maxItems === undefined) {
        return results.records(validator.element);
      }
      if (isClosedRecord(validator.element) && maxItems !== undefined) {
        return results.records(validator.element, { minItems: 0, maxItems });
      }
      if (validator.element?.resultKind === 'union'
        && (validator.element.variants ?? []).every(isClosedRecord)
        && maxItems === undefined) {
        return results.records(validator.element);
      }
    }
    if (validator.resultKind === 'tuple'
      && validator.elements?.length === 1
      && isClosedRecord(validator.elements[0])) {
      return results.records(validator.elements[0], { minItems: 1, maxItems: 1 });
    }
    return results.value(validator);
  }
  if (isDoc(validator)) {
    return results.document(validator.fieldType.AppSchemaRef.table);
  }
  if (!containsDoc(validator)) return results.value(validator);
  return unlowerable(
    kind,
    validator,
    'document-containing composite values require the explicit result: grammar',
  );
}

function markFamiliar(definition, contextKind) {
  // Enumerable by design: isolated definition normalization rejects hidden
  // state. Codegen consumes this adapter-owned tag before decoration.
  definition.familiarContext = contextKind;
  return definition;
}

export function query(spec) {
  exactSpec(spec, 'query', QUERY_KEYS);
  required(spec, 'query', ['args', 'reads', 'handler']);
  const delivery = spec.delivery ?? 'live';
  if (delivery !== 'live' && delivery !== 'read') {
    familiarError(
      'SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID',
      `query delivery ${JSON.stringify(delivery)} is invalid; use "live" (the default) or "read"`,
    );
  }
  const constructor = delivery === 'live' ? defineJsLiveQuery : defineJsQuery;
  return markFamiliar(constructor({
    args: spec.args,
    result: familiarReturns(spec, 'query'),
    auth: auth(spec, 'query'),
    reads: spec.reads,
    handler: spec.handler,
    ...(spec.refusals === undefined ? {} : { refusals: spec.refusals }),
    ...(spec.trackedRefusals === undefined ? {} : { trackedRefusals: spec.trackedRefusals }),
    ...(spec.retainable === undefined ? {} : { retainable: spec.retainable }),
    ...(spec.authScopeField === undefined ? {} : { authScopeField: spec.authScopeField }),
    ...(spec.membership === undefined ? {} : { membership: spec.membership }),
  }), 'query');
}

export function mutation(spec) {
  exactSpec(spec, 'mutation', MUTATION_KEYS);
  required(spec, 'mutation', ['args', 'reads', 'writes', 'handler']);
  return markFamiliar(defineJsMutation({
    args: spec.args,
    result: familiarReturns(spec, 'mutation'),
    auth: auth(spec, 'mutation'),
    reads: spec.reads,
    writes: spec.writes,
    handler: spec.handler,
    ...(spec.refusals === undefined ? {} : { refusals: spec.refusals }),
    ...(spec.trackedRefusals === undefined ? {} : { trackedRefusals: spec.trackedRefusals }),
    ...(spec.membership === undefined ? {} : { membership: spec.membership }),
  }), 'mutation');
}

export function action(spec) {
  exactSpec(spec, 'action', ACTION_KEYS);
  required(spec, 'action', ['args', 'handler']);
  return markFamiliar(defineAction({
    args: spec.args,
    result: familiarReturns(spec, 'action'),
    auth: auth(spec, 'action'),
    handler: spec.handler,
    uses: spec.secrets ?? [],
    ...(spec.refusals === undefined ? {} : { refusals: spec.refusals }),
    ...(spec.trackedRefusals === undefined ? {} : { trackedRefusals: spec.trackedRefusals }),
  }), 'action');
}

// @ref LLP 0253#s46-delivery — syncability is a versioned familiar-profile
// default, while the canonical builder and explicit profile remain unchanged.
export function defineTable(fields) {
  const table = defineCanonicalTable(fields).sync();
  // @ref LLP 0255#s1-exact-data-resource-authoring-grammar — familiar
  // profile sync is a versioned default, not an authored per-table decision.
  table.syncSource = 'profile-default';
  return table;
}
