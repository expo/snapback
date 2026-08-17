// Deterministic, review-only authorization projection.
//
// @ref LLP 0173#1-artifact-and-custody — this module projects the validated
// codegen graph into a small consumer-committed artifact. It reports structural
// facts only; it neither supplies runtime enforcement nor approval authority.

import { createHash } from 'node:crypto';

import { stableArtifactJson } from './review-surface.mjs';
import { WRITE_POLICY_CHECKS_SCHEMA_VERSION } from './write-policy.mjs';

export const AUTHORIZATION_REVIEW_FILE = 'authorization-review.json';
export const AUTHORIZATION_REVIEW_SCHEMA_VERSION = 'snapback.authorization-review.v2';
export const AUTHORIZATION_REVIEW_SCHEMA_AUTHORITY =
  '@expo/snapback-codegen/authorization-review.schema.json';

const RESERVED_SECTION_SCHEMAS = Object.freeze({
  fieldPolicies: 'snapback.authorization-review.field-policies.reserved.v1',
  maskedFieldUses: 'snapback.authorization-review.masked-field-uses.reserved.v1',
  tablePolicyTransitions: 'snapback.authorization-review.table-policy-transitions.v1',
  visibilityOverrides: 'snapback.authorization-review.visibility-overrides.v1',
  writePolicyChecks: WRITE_POLICY_CHECKS_SCHEMA_VERSION,
});

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const canonicalKey = (value) => stableArtifactJson(value);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function sortedBy(values, key) {
  return [...values].sort((left, right) => compareText(key(left), key(right)));
}

function normalizedPolicy(policy) {
  if (!policy) return { kind: 'public-read' };
  if (policy.kind === 'public-read') return { kind: 'public-read' };
  if (policy.kind === 'membership') {
    return {
      kind: 'membership',
      declaration: policy.declaration,
      resourceField: policy.resourceField,
      ...(policy.roles === undefined || policy.roles === null
        ? {}
        : { roles: uniqueSorted(policy.roles) }),
    };
  }
  if (policy.kind === 'owner') return { kind: 'owner', field: policy.field };
  if (policy.kind === 'any-of') {
    return {
      kind: 'any-of',
      arms: sortedBy((policy.arms ?? []).map(normalizedPolicy), canonicalKey),
    };
  }
  throw new TypeError(`unsupported table visibility policy ${JSON.stringify(policy)}`);
}

function tablePolicyFacts(tables, summary) {
  const declared = new Set((summary.tableVisibility?.declared ?? []).map(({ table }) => table));
  return Object.entries(tables).map(([table, definition]) => ({
    table,
    origin: declared.has(table) ? 'declared' : 'legacy-default',
    policy: normalizedPolicy(definition.visibility),
  })).sort((left, right) => compareText(left.table, right.table));
}

function authorizationTableFacts(tables) {
  const facts = [];
  for (const [table, definition] of Object.entries(tables)) {
    if (definition.membership) {
      facts.push({
        kind: 'membership',
        id: definition.membership.id ?? table,
        table,
        definition: clone(definition.membership),
      });
    }
    if (definition.permissionBacking === true) {
      facts.push({
        kind: 'permission-backing',
        id: table,
        table,
        fields: uniqueSorted(definition.permissionFields ?? []),
      });
    }
  }
  return sortedBy(facts, ({ kind, id, table }) => `${kind}\0${id}\0${table}`);
}

function authorityProfileFacts(tables) {
  return sortedBy(
    Object.values(tables)
      .map(({ authorityProfile }) => authorityProfile)
      .filter(Boolean)
      .map(({ id, generation, roleLattice }) => ({
        id,
        generation,
        roleLattice: sortedBy(
          roleLattice.map(({ role, implies }) => ({ role, implies: uniqueSorted(implies) })),
          ({ role }) => role,
        ),
      })),
    ({ id }) => id,
  );
}

function portableSource(source) {
  if (!source || typeof source !== 'object') return null;
  let path = String(source.file ?? source.path ?? '').replaceAll('\\', '/');
  if (path.startsWith('/')) path = path.slice(path.lastIndexOf('/') + 1);
  if (path === '') path = 'functions.mjs';
  return { path, line: source.line, column: source.column };
}

function normalizedReadOrWriteSummary(summary) {
  const value = clone(summary ?? { mode: 'none', primaryTable: null, tables: [] });
  value.tables = uniqueSorted(value.tables ?? []);
  if (value.authScopeField !== undefined && value.authScopeField !== null) {
    value.authScopeField = {
      field: value.authScopeField,
      purpose: 'live-invalidation-disjointness',
      authorizationProof: false,
    };
  } else if (value.authScopeField !== undefined) {
    value.authScopeField = null;
  }
  return value;
}

function containsAuthorizationInput(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsAuthorizationInput);
  if (['AuthUserId', 'AuthKind', 'AuthActorKind', 'AuthIsDelegated', 'MembershipExists']
    .some((key) => Object.hasOwn(value, key))) return true;
  return Object.values(value).some(containsAuthorizationInput);
}

function authorizationPredicates(fn) {
  if (fn.runtime?.IbexModule) return 'opaque';
  const query = fn.runtime?.HostPlan?.Query;
  if (!query) return [];
  const predicates = [];
  for (const filter of query.filters ?? []) {
    if (!containsAuthorizationInput(filter.value)) continue;
    predicates.push({
      kind: 'filter',
      table: query.table,
      field: filter.field,
      operator: filter.op,
      input: clone(filter.value),
    });
  }
  for (const membership of query.membershipFilters ?? []) {
    predicates.push({
      kind: 'membership',
      table: query.table,
      declaration: membership.declaration,
      resource: clone(membership.resource),
      roles: membership.roles === undefined ? null : uniqueSorted(membership.roles),
    });
  }
  return sortedBy(predicates, canonicalKey);
}

function operationRequirementOrigin(fn, sourceFn, implicitOperations) {
  if (sourceFn?.standardPattern) return 'derived';
  if (sourceFn?.authRequirement !== undefined) return 'explicit';
  if (sourceFn || implicitOperations.has(fn.name)) return 'legacy-default';
  return 'explicit';
}

function effectiveTablePolicies(fn, sourceFn, policiesByTable) {
  const facts = [];
  const query = fn.runtime?.HostPlan?.Query;
  if (query) {
    const policy = policiesByTable.get(query.table);
    if (policy) {
      facts.push({
        table: query.table,
        surface: 'host-plan.single-table',
        origin: policy.origin,
        composition: 'schema-rederived',
        policy: clone(policy.policy),
      });
    }
  } else if (
    fn.runtime?.IbexModule
    && ['Query', 'LiveQuery', 'Mutation'].includes(fn.kind)
  ) {
    for (const table of fn.readSetSummary?.tables ?? sourceFn?.declaredReads ?? []) {
      const policy = policiesByTable.get(table);
      if (!policy) continue;
      facts.push({
        table,
        surface: 'handler.ctx.db',
        origin: policy.origin,
        composition: 'ordinary-default',
        policy: clone(policy.policy),
      });
    }
  }
  return sortedBy(facts, ({ table, surface }) => `${table}\0${surface}`);
}

function uncomposedReadSurfaces(name, diagnostics) {
  return sortedBy(
    diagnostics
      .filter(({ details }) => (details?.function ?? details?.operation) === name)
      .map(({ details }) => ({
        surface: details.surface,
        table: details.table,
        declaredPolicy: normalizedPolicy(details.declaredPolicy),
        analysisLimit: details.analysisLimit,
      })),
    ({ surface, table }) => `${surface}\0${table}`,
  );
}

function elevatedDatabase(fn, sourceFn) {
  const available = Boolean(
    fn.runtime?.IbexModule
    && ['Query', 'LiveQuery', 'Mutation'].includes(fn.kind),
  );
  const directUses = [
    ...(sourceFn?.elevatedDbUses ?? []),
    ...(sourceFn?.customAuthorizationEvaluator?.elevatedDbUses ?? []),
  ];
  const capturedUses = available
    ? sortedBy(
        directUses.map(({ member, table = null, source, capture }) => ({
          member,
          table,
          source: portableSource(source),
          capture,
        })),
        ({ member, table, source, capture }) => (
          `${source?.path ?? ''}\0${source?.line ?? 0}\0${source?.column ?? 0}\0${capture}\0${member}\0${table ?? ''}`
        ),
      )
    : [];
  const uses = available && fn.handlerForm === 'module'
    ? sortedBy(
        (sourceFn?.elevatedDbCapabilities ?? []).map(({ form, tables }) => ({
          member: form,
          table: null,
          tables: clone(tables),
          source: portableSource(capturedUses[0]?.source ?? null),
          capture: 'module-declaration',
        })),
        ({ member }) => member,
      )
    : capturedUses;
  return {
    available,
    captureCompleteness: !available
      ? 'not-applicable'
      : (fn.handlerForm === 'module'
          ? 'direct-static-sites-in-selected-module-handler'
          : 'direct-static-sites-in-admitted-handler-graph'),
    uses,
  };
}

function normalizedFieldBoundary(fieldBoundary) {
  if (!fieldBoundary) return null;
  return {
    enforcement: 'handler-residual',
    fields: uniqueSorted(fieldBoundary.fields ?? []),
    condition: fieldBoundary.condition,
  };
}

export function createAuthorizationReview({
  appId,
  authMode,
  inputsHash,
  tables,
  functions,
  sourceFunctions = [],
  uncomposedReadSurfaceDiagnostics = [],
  summary,
  visibilityGovernance = null,
  writePolicyChecks = [],
}) {
  const tablePolicies = tablePolicyFacts(tables, summary);
  const policiesByTable = new Map(tablePolicies.map((policy) => [policy.table, policy]));
  const sourceByName = new Map(sourceFunctions.map((fn) => [fn.name, fn]));
  const implicitOperations = new Set(
    (summary.implicitAuthRequirements ?? []).map(({ operation }) => operation),
  );
  const operations = functions.map((fn) => {
    const sourceFn = sourceByName.get(fn.name);
    return {
      name: fn.name,
      kind: fn.kind,
      runtimeClass: fn.runtime?.IbexModule ? 'javascript-handler' : 'host-plan',
      handlerForm: fn.handlerForm ?? (fn.runtime?.IbexModule ? 'module' : 'plan'),
      authRequirement: {
        value: fn.authRequirement,
        origin: operationRequirementOrigin(fn, sourceFn, implicitOperations),
      },
      authorityIndependent: fn.authorityIndependent === true,
      authorizationDependence: uniqueSorted(fn.authorizationDependence ?? []),
      readSetSummary: normalizedReadOrWriteSummary(fn.readSetSummary),
      writeSetSummary: normalizedReadOrWriteSummary(fn.writeSetSummary),
      authorizationPredicates: authorizationPredicates(fn),
      effectCeiling: clone(fn.effectCeiling),
      standardPattern: fn.standardPattern ?? null,
      effectiveTablePolicies: effectiveTablePolicies(fn, sourceFn, policiesByTable),
      uncomposedReadSurfaces: uncomposedReadSurfaces(fn.name, uncomposedReadSurfaceDiagnostics),
      elevatedDatabase: elevatedDatabase(fn, sourceFn),
      authorityProfileIdentities: sortedBy(
        clone(fn.authorityProfileDependence ?? []),
        ({ id, generation }) => `${id}\0${generation}`,
      ),
      fieldBoundary: normalizedFieldBoundary(fn.fieldBoundary),
      ...(fn.customAuthorization === undefined
        ? {}
        : { customAuthorization: clone(fn.customAuthorization) }),
      maskedFieldUses: [],
    };
  }).sort((left, right) => compareText(left.name, right.name));

  // @ref LLP 0234#d6--projection-and-acceptance-are-load-bearing-but-not-proof-theater
  //   — census the admitted operation × read-form host channels. Inline
  //   entries retain stable source evidence; module entries are explicitly
  //   opaque capabilities and never acquire invented source spans.
  const elevatedReadSites = operations.flatMap((operation) => (
    operation.elevatedDatabase.uses.map((use) => {
      const moduleForm = operation.handlerForm === 'module';
      const core = {
        operation: operation.name,
        readForm: use.member,
        siteEvidence: moduleForm ? 'opaque-module' : 'static-inline',
        ...(moduleForm
          ? {
              modulePath: use.source?.path ?? 'functions.mjs',
              moduleDigest: governanceFactDigest(
                'snapback:elevated-module-source:v1',
                functions.find(({ name }) => name === operation.name)?.runtime?.IbexModule?.source ?? '',
              ),
              declaredForm: use.member,
            }
          : {
              sourcePath: use.source?.path ?? 'functions.mjs',
              sourceSpanId: governanceFactDigest('snapback:elevated-inline-site:v1', {
                operation: operation.name,
                source: use.source,
                readForm: use.member,
              }),
            }),
        tables: use.tables ?? (use.table === null ? 'opaque' : [use.table]),
      };
      return {
        ...core,
        capabilityId: governanceFactDigest('snapback:elevated-read-capability:v1', core),
        capabilityDigest: governanceFactDigest('snapback:elevated-read-capability-body:v1', core),
      };
    })
  )).sort((left, right) => compareText(left.capabilityId, right.capabilityId));

  // @ref LLP 0173#2-top-level-shape — G0 fills the already-reserved override
  // and transition sections. The unrelated field sibling stays empty,
  // and this emitter remains usable without any other LLP 0173 fact source.
  return {
    schemaVersion: AUTHORIZATION_REVIEW_SCHEMA_VERSION,
    appId,
    authMode,
    inputsHash,
    operations,
    tablePolicies,
    authorizationTables: authorizationTableFacts(tables),
    authorityProfiles: authorityProfileFacts(tables),
    sectionSchemas: { ...RESERVED_SECTION_SCHEMAS },
    fieldPolicies: [],
    visibilityOverrides: clone(visibilityGovernance?.visibilityOverrides ?? []),
    tablePolicyTransitions: clone(visibilityGovernance?.tablePolicyTransitions ?? []),
    quarantines: clone(visibilityGovernance?.quarantine.records.map(({ verdict }) => verdict) ?? []),
    elevatedReadSites,
    writePolicyChecks: clone(writePolicyChecks),
  };
}

export function serializeAuthorizationReview(value) {
  return `${stableArtifactJson(value)}\n`;
}

export function validateAuthorizationReview(value) {
  const problems = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['projection must be an object'];
  }
  if (value.schemaVersion !== AUTHORIZATION_REVIEW_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${AUTHORIZATION_REVIEW_SCHEMA_VERSION}`);
  }
  for (const field of ['appId', 'authMode', 'inputsHash']) {
    if (typeof value[field] !== 'string' || value[field] === '') problems.push(`${field} must be a non-empty string`);
  }
  for (const field of [
    'operations',
    'tablePolicies',
    'authorizationTables',
    'authorityProfiles',
    'fieldPolicies',
    'visibilityOverrides',
    'tablePolicyTransitions',
    'writePolicyChecks',
    'quarantines',
    'elevatedReadSites',
  ]) {
    if (!Array.isArray(value[field])) problems.push(`${field} must be an array`);
  }
  if (Array.isArray(value.fieldPolicies) && value.fieldPolicies.length !== 0) {
    problems.push('fieldPolicies must be empty in v1');
  }
  if (Array.isArray(value.writePolicyChecks)) {
    const ids = new Set();
    for (const [index, row] of value.writePolicyChecks.entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        problems.push(`writePolicyChecks[${index}] must be an object`);
      } else if (typeof row.id !== 'string' || row.id === '') {
        problems.push(`writePolicyChecks[${index}].id must be a non-empty string`);
      } else if (ids.has(row.id)) {
        problems.push(`writePolicyChecks repeats id ${row.id}`);
      } else {
        ids.add(row.id);
      }
    }
  }
  if (canonicalKey(value.sectionSchemas) !== canonicalKey(RESERVED_SECTION_SCHEMAS)) {
    problems.push('sectionSchemas must contain the current section authorities');
  }
  for (const operation of value.operations ?? []) {
    if (!Array.isArray(operation.maskedFieldUses) || operation.maskedFieldUses.length !== 0) {
      problems.push(`${operation.name ?? '<unknown>'}.maskedFieldUses must be empty in v1`);
    }
    if (operation.customAuthorization !== undefined) {
      const custom = operation.customAuthorization;
      if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
        problems.push(`${operation.name ?? '<unknown>'}.customAuthorization must be an object`);
      } else if (
        custom.offline !== 'none'
        || custom.sync !== 'coarse-global'
        || custom.inputCompleteness !== 'unproven'
        || custom.pushdown !== 'none'
        || custom.retention !== 'none'
        || custom.preciseInvalidation !== false
        || !Array.isArray(custom.inputs)
        || custom.inputs.length === 0
        || !Array.isArray(custom.coarseGlobalWakeUniverse)
      ) {
        problems.push(`${operation.name ?? '<unknown>'}.customAuthorization is not the closed coarse-global review fact`);
      }
    }
  }
  return problems;
}

function governanceFactDigest(domain, value) {
  return `sha256:${createHash('sha256').update(`${domain}\n${canonicalKey(value)}`).digest('hex')}`;
}

export function formatTableVisibilityPolicy(policy) {
  if (policy?.kind === 'public-read') return 'public-read';
  if (policy?.kind === 'owner') return `owner(${policy.field})`;
  if (policy?.kind === 'membership') {
    const roles = policy.roles?.length ? `, ${uniqueSorted(policy.roles).join('|')}` : '';
    return `membership(${policy.declaration}${roles})`;
  }
  if (policy?.kind === 'any-of') {
    return `any-of(${(policy.arms ?? []).map(formatTableVisibilityPolicy).join(' | ')})`;
  }
  return 'unknown';
}

export function classifyTableVisibilityChange(previous, current) {
  if (canonicalKey(previous) === canonicalKey(current)) return 'unchanged';
  if (previous?.kind === 'public-read') return 'narrowing';
  if (current?.kind === 'public-read') return 'broadening';
  if (
    previous?.kind === 'membership'
    && current?.kind === 'membership'
    && previous.declaration === current.declaration
    && previous.resourceField === current.resourceField
  ) {
    const oldRoles = previous.roles ?? null;
    const newRoles = current.roles ?? null;
    if (oldRoles === null && newRoles !== null) return 'narrowing';
    if (oldRoles !== null && newRoles === null) return 'broadening';
    const oldSet = new Set(oldRoles ?? []);
    const newSet = new Set(newRoles ?? []);
    if ([...newSet].every((role) => oldSet.has(role))) return 'narrowing';
    if ([...oldSet].every((role) => newSet.has(role))) return 'broadening';
  }
  return 'incomparable';
}

function operationPolicyMap(operation) {
  return new Map((operation?.effectiveTablePolicies ?? []).map((fact) => [
    `${fact.table}\0${fact.surface}`,
    fact,
  ]));
}

// @ref LLP 0173#4-human-rendering — effect words are limited to the closed
// table-policy relation; every other JSON fact is merely added, removed, or
// changed and never receives a safety/approval verdict.
export function renderAuthorizationReviewDiff(previous, current) {
  const lines = [];
  const oldOperations = new Map((previous.operations ?? []).map((op) => [op.name, op]));
  const newOperations = new Map((current.operations ?? []).map((op) => [op.name, op]));
  for (const name of uniqueSorted([...oldOperations.keys(), ...newOperations.keys()])) {
    const before = oldOperations.get(name);
    const after = newOperations.get(name);
    if (!before || !after) {
      lines.push(`${name}:`, `  operation: ${before ? 'removed' : 'added'}`);
      continue;
    }
    const operationLines = [];
    const oldPolicies = operationPolicyMap(before);
    const newPolicies = operationPolicyMap(after);
    for (const key of uniqueSorted([...oldPolicies.keys(), ...newPolicies.keys()])) {
      const oldFact = oldPolicies.get(key);
      const newFact = newPolicies.get(key);
      if (canonicalKey(oldFact) === canonicalKey(newFact)) continue;
      if (oldFact && newFact) {
        operationLines.push(
          `  visibility: ${formatTableVisibilityPolicy(oldFact.policy)} -> ${formatTableVisibilityPolicy(newFact.policy)}`,
          `  effect: ${classifyTableVisibilityChange(oldFact.policy, newFact.policy)}`,
        );
      } else {
        operationLines.push(
          `  visibility ${oldFact?.table ?? newFact.table}: ${oldFact ? 'removed' : 'added'} ${formatTableVisibilityPolicy((oldFact ?? newFact).policy)}`,
          '  effect: changed',
        );
      }
    }
    const policyNeutralBefore = { ...before, effectiveTablePolicies: [] };
    const policyNeutralAfter = { ...after, effectiveTablePolicies: [] };
    if (canonicalKey(policyNeutralBefore) !== canonicalKey(policyNeutralAfter)) {
      operationLines.push('  authorization facts: changed');
    }
    if (operationLines.length > 0) lines.push(`${name}:`, ...operationLines);
  }
  for (const table of uniqueSorted([
    ...(previous.tablePolicies ?? []).map(({ table }) => table),
    ...(current.tablePolicies ?? []).map(({ table }) => table),
  ])) {
    const before = (previous.tablePolicies ?? []).find((fact) => fact.table === table);
    const after = (current.tablePolicies ?? []).find((fact) => fact.table === table);
    if (canonicalKey(before) === canonicalKey(after)) continue;
    if ([...oldOperations.values(), ...newOperations.values()].some((operation) => (
      operation.effectiveTablePolicies?.some((fact) => fact.table === table)
    ))) continue;
    lines.push(`${table}:`, `  table policy: ${before ? formatTableVisibilityPolicy(before.policy) : 'absent'} -> ${after ? formatTableVisibilityPolicy(after.policy) : 'absent'}`);
    if (before && after) lines.push(`  effect: ${classifyTableVisibilityChange(before.policy, after.policy)}`);
    else lines.push('  effect: changed');
  }
  if (lines.length === 0 && canonicalKey(previous) !== canonicalKey(current)) {
    lines.push('authorization review:', '  facts: changed');
  }
  return lines.join('\n');
}

export function compareAuthorizationReviews(committedBytes, candidate) {
  let committed;
  try {
    committed = JSON.parse(String(committedBytes));
  } catch (error) {
    return { current: false, problems: [`committed projection is invalid JSON: ${error.message}`], diff: '' };
  }
  const problems = validateAuthorizationReview(committed);
  const candidateProblems = validateAuthorizationReview(candidate);
  problems.push(...candidateProblems.map((problem) => `candidate ${problem}`));
  if (String(committedBytes) !== serializeAuthorizationReview(committed)) {
    problems.push('committed projection is not canonical JSON');
  }
  const current = problems.length === 0
    && String(committedBytes) === serializeAuthorizationReview(candidate);
  return {
    current,
    problems,
    diff: current ? '' : renderAuthorizationReviewDiff(committed, candidate),
  };
}
