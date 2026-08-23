import { createHash } from 'node:crypto';

const GRAPH_PLAN_DOMAIN = 'snapback:graph-plan:v1:';
const ARGUMENT_CONTRACT_DOMAIN = 'snapback:argument-binding-contract:v1:';
const PARTITION_FUNCTION_DOMAIN = 'snapback:graph-partition-function:v1:';
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

export const GRAPH_IDENTITY_DOMAINS = Object.freeze({
  plan: GRAPH_PLAN_DOMAIN,
  instance: 'snapback:graph-instance:v1:',
  materialization: 'snapback:graph-materialization:v1:',
  partitionFunction: PARTITION_FUNCTION_DOMAIN,
  authorityPartition: 'snapback:graph-authority-partition:v1:',
  broadcastScope: 'snapback:graph-broadcast-scope:v1:',
});

const graphError = (code, message) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
};

// This is a dependency-local mirror of packages/snapback-client/rqs.mjs's
// shipped RFC 8785 implementation. snapback-codegen and snapback-client are
// sibling published packages, so importing the client here would add an
// authored-package edge that the repository topology does not admit. The
// graph-query suite pins this function byte-for-byte against `rqs.mjs` on the
// shared vectors and against the Rust-owned graph boundary vectors.
//
// Unlike JSON.stringify, this path cannot honor toJSON or invoke a getter. It
// accepts only own enumerable data properties on plain records/arrays, which
// is also the runtime preflight boundary for graph source carriers.
function canonicalValueRefusal(reason) {
  const error = new TypeError(`SNAPBACK_GRAPH_ARGUMENT_UNBOUND: canonical graph value refused (${reason})`);
  error.code = 'SNAPBACK_GRAPH_ARGUMENT_UNBOUND';
  error.canonicalValueReason = reason;
  throw error;
}

function jcsEscape(value) {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function assertWellFormed(value) {
  if (typeof value.isWellFormed === 'function'
    ? !value.isWellFormed()
    : /[\uD800-\uDFFF]/u.test(value)
      && !/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/u.test(value)) {
    canonicalValueRefusal('lone surrogate');
  }
}

function jcsNumber(value) {
  if (!Number.isFinite(value)) canonicalValueRefusal('non-finite number');
  if (Number.isInteger(value)
    && Math.abs(value) > Number.MAX_SAFE_INTEGER
    && Math.abs(value) < 1e21) {
    canonicalValueRefusal('unsafe integer');
  }
  if (Object.is(value, -0)) return '0';
  return String(value);
}

function canonicalDataProperties(value, stack) {
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) {
    canonicalValueRefusal('non-plain prototype');
  }
  if (stack.has(value)) canonicalValueRefusal('cyclic value');
  stack.add(value);
  try {
    if (array) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') {
        canonicalValueRefusal('non-dense array');
      }
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          canonicalValueRefusal('array accessor or hole');
        }
        entries.push(graphCanonicalJsonInternal(descriptor.value, stack));
      }
      return `[${entries.join(',')}]`;
    }
    const entries = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') canonicalValueRefusal('symbol property');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        canonicalValueRefusal('object accessor or hidden property');
      }
      if (descriptor.value !== undefined) entries.push([key, descriptor.value]);
    }
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    for (const [key] of entries) assertWellFormed(key);
    return `{${entries.map(([key, child]) => (
      `${jcsEscape(key)}:${graphCanonicalJsonInternal(child, stack)}`
    )).join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function graphCanonicalJsonInternal(value, stack) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return jcsNumber(value);
  if (typeof value === 'bigint') {
    if (value > 9_007_199_254_740_991n || value < -9_007_199_254_740_991n) {
      canonicalValueRefusal('unsafe integer');
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    assertWellFormed(value);
    return jcsEscape(value);
  }
  if (typeof value === 'object') return canonicalDataProperties(value, stack);
  canonicalValueRefusal(`unsupported value type ${typeof value}`);
}

export function graphCanonicalJson(value) {
  return graphCanonicalJsonInternal(value, new Set());
}

const copy = (value) => JSON.parse(graphCanonicalJson(value));
const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const compareJcs = (left, right) => Buffer.compare(
  Buffer.from(graphCanonicalJson(left), 'utf8'),
  Buffer.from(graphCanonicalJson(right), 'utf8'),
);

export function graphDomainHash(domain, value) {
  const canonical = graphCanonicalJson(value);
  return `sha256:${createHash('sha256').update(domain).update(canonical).digest('hex')}`;
}

const contentIdentity = (value) => `sha256:${createHash('sha256')
  .update(graphCanonicalJson(value))
  .digest('hex')}`;

function normalizeVisibility(visibility) {
  const normalized = copy(visibility);
  const normalizeLeaf = (leaf) => {
    if (leaf.kind === 'membership' && leaf.roles !== undefined) {
      leaf.roles = [...new Set(leaf.roles)].sort(compareCodeUnits);
    }
    return leaf;
  };
  if (normalized.kind === 'any-of') {
    normalized.arms = normalized.arms.map(normalizeLeaf).sort(compareJcs);
    normalized.arms = normalized.arms.filter(
      (arm, index, arms) => index === 0 || graphCanonicalJson(arm) !== graphCanonicalJson(arms[index - 1]),
    );
  } else {
    normalizeLeaf(normalized);
  }
  return normalized;
}

function normalizePolicyInputs(inputs) {
  const normalized = copy(inputs).sort((left, right) => (
    compareCodeUnits(left.declarationId, right.declarationId)
    || compareCodeUnits(graphCanonicalJson(left.kind), graphCanonicalJson(right.kind))
    || compareCodeUnits(left.identity, right.identity)
  ));
  for (let index = 1; index < normalized.length; index += 1) {
    if (graphCanonicalJson(normalized[index - 1]) === graphCanonicalJson(normalized[index])) {
      graphError('SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE', 'a class-2 proof repeats a policy input');
    }
  }
  return normalized;
}

export function graphPartitionEquivalenceProofV1(nodeId, policyInputs) {
  if (!Array.isArray(policyInputs) || policyInputs.length === 0) {
    graphError('SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE', 'class 2 requires declared policy inputs');
  }
  const inputs = normalizePolicyInputs(policyInputs);
  return {
    format: 'snapback.graph-partition-equivalence-proof.v1',
    nodeId,
    declaredClass: 2,
    policyInputs: inputs,
    partitionFunction: graphDomainHash(PARTITION_FUNCTION_DOMAIN, inputs),
    equivalenceWitness: 'declared-inputs-only',
  };
}

function normalizeFilterValue(value, argumentNames, argumentIds) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1) {
    if (Object.hasOwn(value, 'Arg')) {
      const rewritten = argumentNames.get(value.Arg) ?? argumentIds.get(value.Arg);
      if (rewritten === undefined) {
        graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', `filter references unbound argument ${String(value.Arg)}`);
      }
      return { Arg: rewritten };
    }
    if (Object.hasOwn(value, 'Literal')) return { Literal: copy(value.Literal) };
  }
  graphError('SNAPBACK_GRAPH_CODE_FORBIDDEN', 'graph filters admit only one Arg or Literal expression arm');
}

function normalizeFilters(filters, argumentNames, argumentIds, optional) {
  if (filters === undefined) return undefined;
  if (optional && filters.length === 0) {
    graphError('SNAPBACK_GRAPH_UNKNOWN_FIELD', 'an empty optional filter conjunction must be omitted');
  }
  return filters.map((filter) => ({
    field: filter.field,
    op: filter.op,
    value: normalizeFilterValue(filter.value, argumentNames, argumentIds),
  })).sort(compareJcs);
}

function rewriteProjectionIds(object, nodeIds) {
  const rewritten = copy(object);
  const replace = (id) => {
    const normalized = nodeIds.get(id);
    if (normalized === undefined) {
      graphError('SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID', `projection references unknown node ${String(id)}`);
    }
    return normalized;
  };
  const visit = (projection) => {
    projection.scopeNodeId = replace(projection.scopeNodeId);
    for (const field of projection.fields) {
      const value = field.value;
      if (value.kind === 'field' || value.kind === 'exists') value.nodeId = replace(value.nodeId);
      if (value.kind === 'object') {
        value.nodeId = replace(value.nodeId);
        visit(value.object);
      }
      if (value.kind === 'array') {
        value.scopeNodeId = replace(value.scopeNodeId);
        visit(value.item);
      }
    }
  };
  visit(rewritten);
  return rewritten;
}

function normalizeEventSelector(selector) {
  const normalized = copy(selector);
  if (normalized.kind === 'permission-backing-write') {
    if (Array.isArray(normalized.permissionFields)) {
      normalized.permissionFields = [...new Set(normalized.permissionFields)].sort(compareCodeUnits);
    }
    if (normalized.scope?.kind === 'bindings') {
      normalized.scope.bindings.sort((left, right) => (
        compareCodeUnits(left.rowField, right.rowField)
        || compareCodeUnits(left.scopeArgumentId, right.scopeArgumentId)
      ));
    }
  }
  return normalized;
}

function normalizeNode(node, nodeIds, argumentNames, argumentIds, argumentOrder) {
  const normalized = copy(node);
  normalized.nodeId = nodeIds.get(node.nodeId);
  if (normalized.parentNodeId !== undefined) normalized.parentNodeId = nodeIds.get(node.parentNodeId);
  if (normalized.authority?.proof) {
    const suppliedHash = normalized.authority.proof.partitionFunction;
    const proof = graphPartitionEquivalenceProofV1(
      normalized.nodeId,
      normalized.authority.proof.policyInputs,
    );
    if (suppliedHash !== proof.partitionFunction) {
      graphError('SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE', 'class-2 partitionFunction does not match its declared inputs');
    }
    normalized.authority.proof = proof;
  }
  if (['root-window', 'equality-to-one', 'bounded-to-many', 'principal-bound'].includes(normalized.kind)) {
    normalized.visibility = normalizeVisibility(normalized.visibility);
  }
  if (normalized.kind === 'principal-bound' && normalized.binding) {
    normalized.binding.visibility = normalizeVisibility(normalized.binding.visibility);
  }
  if (normalized.kind === 'exists-semi-join') {
    normalized.edge.visibility = normalizeVisibility(normalized.edge.visibility);
    if (normalized.edge.targetVisibility !== undefined) {
      normalized.edge.targetVisibility = normalizeVisibility(normalized.edge.targetVisibility);
    }
    if (normalized.argumentId !== undefined) {
      const rewritten = argumentNames.get(normalized.argumentId) ?? argumentIds.get(normalized.argumentId);
      if (rewritten === undefined) graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'exists node argument is unbound');
      normalized.argumentId = rewritten;
    }
  }
  if (normalized.kind === 'search-membership') {
    for (const binding of normalized.scopeBindings) {
      if (binding.source.kind === 'argument') {
        const rewritten = argumentNames.get(binding.source.argumentId)
          ?? argumentIds.get(binding.source.argumentId);
        if (rewritten === undefined) graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'search scope argument is unbound');
        binding.source.argumentId = rewritten;
      } else {
        binding.source.nodeId = nodeIds.get(binding.source.nodeId);
      }
    }
    if (normalized.argumentIds !== undefined) {
      normalized.argumentIds = [...new Set(normalized.argumentIds.map((argumentId) => {
        const rewritten = argumentNames.get(argumentId) ?? argumentIds.get(argumentId);
        if (rewritten === undefined) graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'search argument is unbound');
        return rewritten;
      }))].sort((left, right) => argumentOrder.get(left) - argumentOrder.get(right));
    }
    normalized.invalidationTables = [...new Set(normalized.invalidationTables)].sort(compareCodeUnits);
  }
  if (normalized.kind === 'root-window') {
    normalized.filters = normalizeFilters(normalized.filters, argumentNames, argumentIds, false);
  } else if (['equality-to-one', 'bounded-to-many', 'exists-semi-join', 'principal-bound'].includes(normalized.kind)) {
    const filters = normalizeFilters(normalized.filters, argumentNames, argumentIds, true);
    if (filters === undefined) delete normalized.filters;
    else normalized.filters = filters;
  }
  return normalized;
}

/** JS mirror of B1's `normalized_graph_plan`. */
export function normalizeGraphPlanV1(candidate) {
  const plan = copy(candidate);
  const projections = plan.nodes.filter((node) => node.kind === 'closed-projection');
  const dataNodes = plan.nodes.filter((node) => node.kind !== 'closed-projection');
  const roots = dataNodes.filter((node) => node.kind === 'root-window');
  if (roots.length !== 1) graphError('SNAPBACK_GRAPH_ROOT_COUNT_INVALID', 'graph requires exactly one root-window');
  if (projections.length !== 1) graphError('SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID', 'graph requires exactly one closed-projection');
  const byId = new Map();
  for (const node of dataNodes) {
    if (typeof node.nodeId !== 'string' || node.nodeId.length === 0 || byId.has(node.nodeId)) {
      graphError('SNAPBACK_GRAPH_UNKNOWN_FIELD', 'graph node ids must be unique non-empty strings');
    }
    byId.set(node.nodeId, node);
  }
  if (typeof projections[0].nodeId !== 'string' || projections[0].nodeId.length === 0
    || byId.has(projections[0].nodeId)) {
    graphError('SNAPBACK_GRAPH_UNKNOWN_FIELD', 'projection id must be non-empty and distinct from every data node');
  }
  const children = new Map();
  const siblingNames = new Set();
  for (const node of dataNodes) {
    if (node.parentNodeId === undefined) continue;
    if (!byId.has(node.parentNodeId)) graphError('SNAPBACK_GRAPH_PARENT_INVALID', 'graph parent does not exist');
    const sibling = graphCanonicalJson([node.parentNodeId, node.edgeName]);
    if (siblingNames.has(sibling)) graphError('SNAPBACK_GRAPH_UNKNOWN_FIELD', 'sibling edgeName values must be unique');
    siblingNames.add(sibling);
    const list = children.get(node.parentNodeId) ?? [];
    list.push(node.nodeId);
    children.set(node.parentNodeId, list);
  }
  const visiting = new Set();
  const visited = new Set();
  const orderedIds = [];
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) graphError('SNAPBACK_GRAPH_CYCLE', 'graph parent relation is cyclic');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    orderedIds.push(nodeId);
    for (const childId of (children.get(nodeId) ?? []).sort((left, right) => (
      compareCodeUnits(byId.get(left).edgeName, byId.get(right).edgeName)
    ))) visit(childId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  visit(roots[0].nodeId);
  if (orderedIds.length !== dataNodes.length) graphError('SNAPBACK_GRAPH_PARENT_INVALID', 'graph has an orphaned data node');

  const nodeIds = new Map(orderedIds.map((oldId, index) => [oldId, `n${index}`]));
  nodeIds.set(projections[0].nodeId, `n${orderedIds.length}`);

  const argumentsByName = [...plan.arguments].sort((left, right) => compareCodeUnits(left.name, right.name));
  const argumentNames = new Map();
  const argumentIds = new Map();
  const generatedIds = new Set(argumentsByName.map((_, index) => `a${index}`));
  for (const [index, argument] of argumentsByName.entries()) {
    const normalizedId = `a${index}`;
    if (!argument.name || generatedIds.has(argument.name) || argumentNames.has(argument.name)
      || !argument.argumentId || argumentIds.has(argument.argumentId)) {
      graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'argument names and source ids must be unique and non-canonical');
    }
    argumentNames.set(argument.name, normalizedId);
    argumentIds.set(argument.argumentId, normalizedId);
    argument.argumentId = normalizedId;
    argument.contractHash = graphDomainHash(ARGUMENT_CONTRACT_DOMAIN, argument.contract);
  }
  const argumentOrder = new Map(argumentsByName.map((argument, index) => [argument.argumentId, index]));

  const normalizedNodes = orderedIds.map((oldId) => normalizeNode(
    byId.get(oldId), nodeIds, argumentNames, argumentIds, argumentOrder,
  ));
  const projection = normalizeNode(
    projections[0], nodeIds, argumentNames, argumentIds, argumentOrder,
  );
  projection.object = rewriteProjectionIds(projection.object, nodeIds);
  normalizedNodes.push(projection);

  const costs = new Map(plan.queryCost.graph.nodes.map((cost) => [cost.nodeId, copy(cost)]));
  plan.queryCost.graph.nodes = orderedIds.map((oldId) => {
    const cost = costs.get(oldId);
    if (!cost) graphError('SNAPBACK_GRAPH_UNBOUNDED_EXPANSION', `node ${oldId} lacks a cost record`);
    costs.delete(oldId);
    cost.nodeId = nodeIds.get(oldId);
    return cost;
  });
  if (costs.size !== 0) graphError('SNAPBACK_GRAPH_BOUND_INVALID', 'cost record names a non-data node');
  plan.queryCost.graph.arguments = plan.queryCost.graph.arguments.map((cost) => {
    const argumentId = argumentNames.get(cost.argumentId) ?? argumentIds.get(cost.argumentId);
    if (argumentId === undefined) graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'argument cost is unbound');
    return { ...cost, argumentId };
  }).sort((left, right) => argumentOrder.get(left.argumentId) - argumentOrder.get(right.argumentId));

  for (const input of plan.authorityPartitionRule.class2Inputs) {
    input.nodeId = nodeIds.get(input.nodeId);
    input.scopeArgumentIds = [...new Set(input.scopeArgumentIds.map((argumentId) => {
      const rewritten = argumentNames.get(argumentId) ?? argumentIds.get(argumentId);
      if (rewritten === undefined) graphError('SNAPBACK_GRAPH_ARGUMENT_UNBOUND', 'authority scope argument is unbound');
      return rewritten;
    }))].sort(compareCodeUnits);
    input.eventSelectors = input.eventSelectors.map(normalizeEventSelector).sort(compareJcs);
  }
  plan.authorityPartitionRule.class2Inputs.sort((left, right) => (
    compareCodeUnits(left.nodeId, right.nodeId)
    || compareCodeUnits(left.declarationId, right.declarationId)
  ));

  if (plan.broadcast.classification === 'query-shaped') {
    plan.broadcast.reason = normalizedNodes.slice(0, -1)
      .some((node) => node.authority.declaredClass !== 1)
      ? 'base-not-class-1'
      : 'declared-query-shaped';
  }
  plan.rootNodeId = 'n0';
  plan.nodes = normalizedNodes;
  plan.arguments = argumentsByName;
  return plan;
}

export function graphPlanIdentityV1(candidate) {
  const normalizedPlan = normalizeGraphPlanV1(candidate);
  return {
    normalizedPlan,
    planHash: graphDomainHash(GRAPH_PLAN_DOMAIN, normalizedPlan),
  };
}

export function normalizeKeysetKeyV1(key, order) {
  if (!key || typeof key.id !== 'string' || key.id.length === 0
    || !Array.isArray(key.entries) || key.entries.length !== order.length
    || key.entries.some((entry, index) => (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== 'string'
      || entry[0] === '_id'
      || entry[0] !== order[index].field
      || graphCanonicalJson(entry[1]).length > 65_536
    ))) {
    graphError('SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID', 'keyset entries must exactly match declared order and carry _id separately');
  }
  return copy(key);
}

export function normalizeGraphIntervalEndV1(end, order) {
  if (order.some((entry) => entry.field === '_id')) {
    graphError('SNAPBACK_GRAPH_ORDER_NOT_TOTAL', 'declared order keeps _id as an implicit tie-break');
  }
  if (end?.kind === 'unbounded') return copy(end);
  if (end?.kind !== 'inclusive' && end?.kind !== 'exclusive') {
    graphError('SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID', 'interval end kind is outside the closed vocabulary');
  }
  return { kind: end.kind, key: normalizeKeysetKeyV1(end.key, order) };
}

function policyIdentityForTable(table, kind, declarationId, roles) {
  if (kind === 'role') return contentIdentity({ declarationId, kind, roles });
  if (kind === 'membership') return contentIdentity({ kind, table: table.name, declaration: table.membership });
  return contentIdentity({
    kind,
    table: table.name,
    permissionFields: table.permissionFields ?? null,
  });
}

function visibilityInputs(visibility, tables, inputs) {
  const leaves = visibility?.kind === 'any-of' ? visibility.arms : [visibility];
  for (const leaf of leaves) {
    if (leaf?.kind !== 'membership') continue;
    const table = Object.values(tables).find(
      (candidate) => (candidate.membership?.id ?? candidate.name) === leaf.declaration,
    );
    if (!table) graphError('SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID', `unknown membership declaration ${leaf.declaration}`);
    inputs.push({
      declarationId: leaf.declaration,
      kind: 'membership',
      identity: policyIdentityForTable(table, 'membership', leaf.declaration),
      table,
    });
    if (leaf.roles !== undefined) {
      inputs.push({
        declarationId: leaf.declaration,
        kind: 'role',
        identity: policyIdentityForTable(table, 'role', leaf.declaration, [...leaf.roles].sort(compareCodeUnits)),
        table,
      });
    }
  }
}

function nodePolicyInputs(node, tables) {
  const inputs = [];
  const addTable = (tableName, visibility) => {
    const table = tables[tableName];
    if (!table) graphError('SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID', `unknown table ${String(tableName)}`);
    if (table.permissionBacking === true) {
      inputs.push({
        declarationId: table.name,
        kind: 'permissionBacking',
        identity: policyIdentityForTable(table, 'permissionBacking', table.name),
        table,
      });
    }
    visibilityInputs(visibility, tables, inputs);
  };
  if (['root-window', 'equality-to-one', 'bounded-to-many', 'principal-bound'].includes(node.kind)) {
    addTable(node.table, node.visibility);
  }
  if (node.kind === 'exists-semi-join') {
    addTable(node.edge.table, node.edge.visibility);
    if (node.edge.targetTable !== undefined) addTable(node.edge.targetTable, node.edge.targetVisibility);
  }
  if (node.kind === 'principal-bound' && node.binding) addTable(node.binding.table, node.binding.visibility);
  const unique = new Map(inputs.map((input) => [graphCanonicalJson({
    declarationId: input.declarationId,
    kind: input.kind,
    identity: input.identity,
  }), input]));
  return [...unique.values()];
}

function visibilityClass(visibility, requestedClass) {
  if (visibility.kind === 'public-read') return 1;
  if (visibility.kind === 'owner') return 3;
  if (visibility.kind === 'membership') return requestedClass === 2 ? 2 : 3;
  if (visibility.kind === 'any-of') {
    if (visibility.arms.some((arm) => arm.kind === 'owner')) return 3;
    return requestedClass === 2 ? 2 : 3;
  }
  graphError('SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID', 'node lacks an installed table visibility');
}

function localAuthorityClass(node, inputs) {
  if (node.kind === 'principal-bound') return 3;
  const visibilities = [];
  if (['root-window', 'equality-to-one', 'bounded-to-many'].includes(node.kind)) visibilities.push(node.visibility);
  if (node.kind === 'exists-semi-join') {
    visibilities.push(node.edge.visibility);
    if (node.edge.targetVisibility) visibilities.push(node.edge.targetVisibility);
  }
  let authorityClass = Math.max(1, ...visibilities.map((visibility) => (
    visibilityClass(visibility, node.authorityClass)
  )));
  if (inputs.length > 0 && authorityClass === 1) authorityClass = node.authorityClass === 2 ? 2 : 3;
  return authorityClass;
}

function eventSelectors(input) {
  const selectors = [{
    kind: 'permission-backing-write',
    table: input.table.name,
    permissionFields: input.table.permissionFields ?? null,
    scope: { kind: 'all-declaration-scopes' },
  }, {
    kind: 'authorization-metadata-activation',
    declarationId: input.declarationId,
  }, ...['app-reset', 'logical-import', 'declared-physical-restore'].map((cause) => ({
    kind: 'authorization-incarnation-change', cause,
  })), {
    kind: 'out-of-band-permission-revocation',
    declarationId: input.declarationId,
  }];
  return selectors.sort(compareJcs);
}

/** Compile the pre-lowering defineGraphQuery carrier against installed schema/policy facts. */
export function compileGraphQueryV1({ source, argsContract, resultContractHash, tables }) {
  if (source.broadcast.classification !== 'query-shaped') {
    graphError(
      'SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE',
      'B2 emits no broadcast certificate; declare classification query-shaped',
    );
  }
  const argumentFields = argsContract.fields ?? [];
  const argumentsV1 = argumentFields.map((field) => ({
    argumentId: field.name,
    name: field.name,
    contract: {
      format: 'snapback.argument-binding-contract.v1',
      required: field.required,
      value: copy(field.value),
    },
    contractHash: ZERO_HASH,
  }));
  const nodes = copy(source.nodes);
  if (nodes.some((node) => node.kind === 'search-membership')) {
    graphError(
      'SNAPBACK_GRAPH_SEARCH_UNADMITTED',
      'B2 cannot author search membership before the owner-issued D6 admission certificate exists',
    );
  }
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const node of nodes) {
    if (node.parentNodeId !== undefined && !byId.has(node.parentNodeId)) {
      graphError('SNAPBACK_GRAPH_PARENT_INVALID', `node ${node.nodeId} references unknown parent ${node.parentNodeId}`);
    }
  }
  const authorityPartitionInputs = [];
  const classById = new Map();
  const class2PolicyInputsByNode = new Map();
  const unresolved = new Set(nodes.map((node) => node.nodeId));
  while (unresolved.size > 0) {
    let progress = false;
    for (const nodeId of [...unresolved]) {
      const node = byId.get(nodeId);
      if (node.parentNodeId !== undefined && !classById.has(node.parentNodeId)) continue;
      const inputs = nodePolicyInputs(node, tables);
      const derived = Math.max(
        localAuthorityClass(node, inputs),
        node.parentNodeId === undefined ? 1 : classById.get(node.parentNodeId),
      );
      if (![1, 2, 3].includes(node.authorityClass) || node.authorityClass < derived
        || (node.authorityClass === 2 && inputs.length === 0)) {
        graphError('SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE', `node ${node.nodeId} requested class ${String(node.authorityClass)} but compiler derived ${derived}`);
      }
      const policyInputs = inputs.map(({ declarationId, kind, identity }) => ({
        declarationId, kind, identity,
      }));
      node.authority = node.authorityClass === 2
        ? { declaredClass: 2, proof: graphPartitionEquivalenceProofV1(node.nodeId, policyInputs) }
        : { declaredClass: node.authorityClass, proof: null };
      delete node.authorityClass;
      if (node.authority.declaredClass === 2) {
        class2PolicyInputsByNode.set(node.nodeId, inputs);
        for (const input of inputs) {
          authorityPartitionInputs.push({
            nodeId: node.nodeId,
            declarationId: input.declarationId,
            scopeArgumentIds: [...(source.authorityScopes?.[node.nodeId] ?? [])],
            policyIdentity: input.identity,
            eventSelectors: eventSelectors(input),
          });
        }
      }
      classById.set(nodeId, node.authority.declaredClass);
      unresolved.delete(nodeId);
      progress = true;
    }
    if (!progress) graphError('SNAPBACK_GRAPH_CYCLE', 'authority derivation found a parent cycle');
  }
  const projectionClass = Math.max(...classById.values());
  if (source.projection.authorityClass !== projectionClass) {
    graphError('SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE', `projection class must equal compiler roll-up ${projectionClass}`);
  }
  const projectionInputs = projectionClass === 2
    ? [...new Map(
        [...class2PolicyInputsByNode.values()].flat().map((input) => [
          graphCanonicalJson({
            declarationId: input.declarationId,
            kind: input.kind,
            identity: input.identity,
          }),
          input,
        ]),
      ).values()]
    : [];
  nodes.push({
    ...copy(source.projection),
    authority: projectionClass === 2
      ? {
          declaredClass: 2,
          proof: graphPartitionEquivalenceProofV1(
            source.projection.nodeId,
            projectionInputs.map(({ declarationId, kind, identity }) => ({
              declarationId, kind, identity,
            })),
          ),
        }
      : { declaredClass: projectionClass, proof: null },
  });
  delete nodes[nodes.length - 1].authorityClass;
  if (projectionClass === 2) {
    for (const input of projectionInputs) {
      authorityPartitionInputs.push({
        nodeId: source.projection.nodeId,
        declarationId: input.declarationId,
        scopeArgumentIds: [...(source.authorityScopes?.[source.projection.nodeId] ?? [])],
        policyIdentity: input.identity,
        eventSelectors: eventSelectors(input),
      });
    }
  }

  const candidate = {
    format: 'snapback.graph-query-plan.v1',
    capabilityId: 'graph_query_v1',
    rootNodeId: nodes.find((node) => node.kind === 'root-window')?.nodeId ?? '',
    nodes,
    arguments: argumentsV1,
    queryCost: copy(source.queryCost),
    authorityPartitionRule: {
      format: 'snapback.graph-authority-partition-rule.v1',
      class2Inputs: authorityPartitionInputs,
      class3: [...classById.values()].some((authorityClass) => authorityClass === 3)
        ? 'partition-of-one'
        : 'none',
    },
    broadcast: {
      format: 'snapback.graph-broadcast-admission.v1',
      classification: 'query-shaped',
      reason: 'declared-query-shaped',
    },
    resultContractHash,
  };
  return graphPlanIdentityV1(candidate);
}
