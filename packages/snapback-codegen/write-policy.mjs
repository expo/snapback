// Phase-1 ordinary table-write policy facts.
//
// @ref LLP 0264#d1-one-table-policy-is-the-read-and-write-locus — scanning,
// admission, review projection, and transition identity consume this one
// normalized fact model; none is a second authoring policy.

import { createHash } from 'node:crypto';
import { parse as parseJavaScript } from 'acorn';

import { stableArtifactJson } from './review-surface.mjs';

export const WRITE_POLICY_SEMANTIC_VERSION = 'snapback.owner-write.v1';
export const WRITE_POLICY_CHECKS_SCHEMA_VERSION =
  'snapback.authorization-review.write-policy-checks.v2';
export const WRITE_POSTURE_MIGRATION_WARNING =
  'SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING';

const WRITE_FORMS = Object.freeze(['insert', 'insert-each', 'patch', 'delete', 'delete-where']);
const JS_WRITE_FORMS = Object.freeze(['insert', 'patch', 'delete']);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const canonical = (value) => stableArtifactJson(value);
const digest = (domain, value) => `sha256:${createHash('sha256')
  .update(`${domain}\n${canonical(value)}`).digest('hex')}`;

function canonicalPolicy(policy) {
  if (policy?.kind === 'public-read') return { kind: 'public-read' };
  if (policy?.kind === 'owner') return { kind: 'owner', field: policy.field };
  if (policy?.kind === 'membership') {
    return {
      kind: 'membership',
      declaration: policy.declaration,
      resourceField: policy.resourceField,
      ...(policy.roles === undefined ? {} : { roles: [...policy.roles].sort(compareText) }),
    };
  }
  if (policy?.kind === 'any-of') {
    return {
      kind: 'any-of',
      arms: [...(policy.arms ?? [])].map(canonicalPolicy)
        .sort((left, right) => compareText(canonical(left), canonical(right))),
    };
  }
  return null;
}

export function authorityTableClass(table) {
  if (table?.membership) return 'membership';
  if (table?.permissionBacking === true) return 'permission-backing';
  return 'ordinary';
}

function policyKind(table) {
  return table?.visibility?.kind ?? 'undeclared';
}

function ownerField(table) {
  return table?.visibility?.kind === 'owner' ? table.visibility.field : null;
}

function genericDisposition(table) {
  if (!table?.visibility) return 'legacy-undeclared';
  if (authorityTableClass(table) !== 'ordinary') return 'generic-refused';
  return table.visibility.kind === 'owner' ? 'owner-policy' : 'migration-pending';
}

export function canonicalWriteDisclosure(entry) {
  return {
    table: entry.table,
    writeForm: entry.writeForm,
    constraint: entry.constraint,
    operations: [...entry.operations].sort(compareText),
  };
}

export function collectWriteDisclosures(sourceFunctions = []) {
  const entries = [];
  const seen = new Set();
  for (const fn of sourceFunctions) {
    for (const authored of fn.writePolicy?.disclosures ?? fn.discloseUniqueConflicts ?? []) {
      const entry = canonicalWriteDisclosure(authored);
      const key = canonical(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.sort((left, right) => compareText(canonical(left), canonical(right)));
}

export function deriveWritePosture(tableName, table, disclosures = []) {
  const authorityClass = authorityTableClass(table);
  const policy = policyKind(table);
  const dispositions = Object.fromEntries(WRITE_FORMS.map((form) => [
    form,
    authorityClass !== 'ordinary' || policy !== 'owner' ? 'refused' : (
      form === 'insert' || form === 'insert-each'
        ? 'owner-host-stamped'
        : form === 'delete-where'
          ? 'owner-filtered'
          : 'owner-old-row-checked'
    ),
  ]));
  return {
    semanticVersion: WRITE_POLICY_SEMANTIC_VERSION,
    dispositions,
    ownerField: ownerField(table),
    authorityTableClass: authorityClass,
    globalUniqueDisclosures: disclosures
      .filter((entry) => entry.table === tableName)
      .map(canonicalWriteDisclosure)
      .sort((left, right) => compareText(canonical(left), canonical(right))),
  };
}

function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function memberName(member) {
  if (!member || member.type !== 'MemberExpression') return null;
  if (!member.computed && member.property?.type === 'Identifier') return member.property.name;
  if (member.computed && member.property?.type === 'Literal'
    && typeof member.property.value === 'string') return member.property.value;
  return null;
}

function isCtxDbMember(member) {
  if (!member || member.type !== 'MemberExpression') return false;
  const object = member.object;
  return object?.type === 'MemberExpression' && memberName(object) === 'db';
}

function staticObjectFields(node) {
  if (node?.type !== 'ObjectExpression') return null;
  const fields = [];
  for (const property of node.properties) {
    if (property?.type !== 'Property' || property.computed || property.kind !== 'init') return null;
    const field = property.key?.type === 'Identifier'
      ? property.key.name
      : literalString(property.key);
    if (field === null) return null;
    fields.push(field);
  }
  return [...new Set(fields)].sort(compareText);
}

export function scanGenericWriteSites(source, operation, sourcePath = 'functions.mjs') {
  if (!source) return { sites: [], opaque: false, parseError: false };
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
    });
  } catch (_) {
    return { sites: [], opaque: true, parseError: true };
  }
  const sites = [];
  let opaque = false;
  let selectedOperationRoot = null;
  const findSelectedOperation = (node) => {
    if (!node || typeof node.type !== 'string' || selectedOperationRoot) return;
    if (node.type === 'AssignmentExpression'
      && memberName(node.left) === '__snapbackHandlers'
      && node.right?.type === 'ObjectExpression') {
      const property = node.right.properties.find((candidate) => {
        if (candidate?.type !== 'Property') return false;
        const name = candidate.key?.type === 'Identifier'
          ? candidate.key.name
          : literalString(candidate.key);
        return name === operation;
      });
      if (property?.value && ['FunctionExpression', 'ArrowFunctionExpression']
        .includes(property.value.type)) {
        selectedOperationRoot = property.value;
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) findSelectedOperation(child);
      } else {
        findSelectedOperation(value);
      }
    }
  };
  findSelectedOperation(program);
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && isCtxDbMember(node.callee)) {
      const writeForm = memberName(node.callee);
      if (JS_WRITE_FORMS.includes(writeForm)) {
        const table = literalString(node.arguments[0]);
        const valuesNode = writeForm === 'insert' ? node.arguments[1]
          : writeForm === 'patch' ? node.arguments[2] : null;
        const valueFields = valuesNode === null ? [] : staticObjectFields(valuesNode);
        const source = {
          path: sourcePath,
          line: node.loc?.start.line ?? null,
          column: node.loc?.start.column == null ? null : node.loc.start.column + 1,
        };
        const siteCore = { operation, writeForm, table, source };
        sites.push({
          ...siteCore,
          valueFields,
          siteId: digest('snapback:generic-write-site:v1', siteCore),
        });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') walk(child);
      } else if (value && typeof value.type === 'string') walk(value);
    }
  };
  walk(selectedOperationRoot ?? program);
  return {
    sites: sites.sort((left, right) => compareText(left.siteId, right.siteId)),
    opaque,
    parseError: false,
    selectedOperation: selectedOperationRoot !== null,
  };
}

function mutationPlan(fn) {
  return fn.runtime?.HostPlan?.Mutation
    ?? fn.runtime?.HostPlan?.WriteWithActivity?.mutation
    ?? null;
}

function hostPlanSites(fn) {
  const plan = mutationPlan(fn);
  if (!plan) return [];
  const checks = new Map((plan.ownerWriteChecks ?? plan.owner_write_checks ?? [])
    .map((check) => [check.stepIndex ?? check.step_index, check]));
  return (plan.steps ?? []).flatMap((step, stepIndex) => {
    const [kind, body] = Object.entries(step)[0] ?? [];
    const writeForm = {
      Insert: 'insert', InsertEach: 'insert-each', Patch: 'patch', Delete: 'delete',
      DeleteWhere: 'delete-where',
    }[kind];
    if (!writeForm) return [];
    const siteCore = { operation: fn.name, surface: 'host-plan', stepIndex, writeForm, table: body.table };
    return [{
      ...siteCore,
      valueFields: ['Insert', 'InsertEach', 'Patch'].includes(kind)
        ? Object.keys(body.values ?? {}).sort(compareText) : [],
      ownerExpression: ['Insert', 'InsertEach'].includes(kind) ? body.values : null,
      ownerWriteCheck: checks.get(stepIndex) ?? null,
      siteId: digest('snapback:generic-write-site:v1', siteCore),
      source: { stepIndex, stepKind: kind },
    }];
  });
}

function disclosureFor(disclosures, operation, table, writeForm, constraint) {
  return disclosures.find((entry) => entry.table === table
    && entry.writeForm === writeForm
    && entry.constraint === constraint
    && entry.operations.includes(operation)) ?? null;
}

function reachableUniqueIndexes(table, site, conservative = false) {
  const indexes = (table?.indexes ?? []).filter(({ unique }) => unique === true);
  if (site.writeForm === 'insert' || site.writeForm === 'insert-each') return indexes;
  if (site.writeForm !== 'patch') return [];
  if (conservative || site.valueFields === null) return indexes;
  const fields = new Set(site.valueFields);
  return indexes.filter((index) => index.fields.some((field) => fields.has(field)));
}

function refusal(err, code, operation, message, details, candidate = null) {
  err(code, 'auth', `${operation}: ${message}`, {
    function: operation,
    ...details,
    ...(candidate === null ? {} : { candidateWritePolicyCheck: candidate }),
  });
}

function migrationWarning(warn, operation, table, writeForm, candidate) {
  warn?.(
    WRITE_POSTURE_MIGRATION_WARNING,
    'auth',
    `${operation}: generic ${writeForm} on ${table.name} remains on its pre-0264 runtime posture pending write-model migration`,
    {
      function: operation,
      table: table.name,
      writeForm,
      policyKind: table.visibility.kind,
      candidateWritePolicyCheck: candidate,
    },
  );
}

function uniqueConflictFact(table, site, operation, disclosures, conservative = false) {
  const owner = ownerField(table);
  const reached = reachableUniqueIndexes(table, site, conservative);
  const global = reached.filter((index) => !index.fields.includes(owner));
  const declared = global.filter((index) => disclosureFor(
    disclosures, operation, table.name, site.writeForm, index.name,
  ));
  if (global.length === 0) return { kind: 'owner-partitioned', constraints: [] };
  return {
    kind: declared.length === global.length ? 'declared-disclosure' : 'missing-disclosure',
    constraints: declared.map(({ name }) => name).sort(compareText),
    missing: global.filter((index) => !declared.includes(index)).map(({ name }) => name)
      .sort(compareText),
  };
}

function exactProjectionRow({ fn, site, table, disclosures, surface }) {
  const authorityClass = authorityTableClass(table);
  const owner = ownerField(table);
  const policy = policyKind(table);
  const disposition = genericDisposition(table);
  const point = site.writeForm === 'patch' || site.writeForm === 'delete';
  const insertion = site.writeForm === 'insert' || site.writeForm === 'insert-each';
  const absent = surface === 'ctx-db' && point
    ? 'ctx-db-false'
    : surface === 'host-plan' && point
      ? (site.ownerWriteCheck?.absent?.kind === 'refuse'
          ? 'declared-refusal'
          : 'host-plan-no-effect')
      : 'not-applicable';
  const conflict = policy === 'owner'
    ? uniqueConflictFact(table, site, fn.name, disclosures)
    : { kind: 'not-applicable', constraints: [] };
  const core = {
    operation: fn.name,
    siteId: site.siteId,
    writeForm: site.writeForm,
    table: table.name,
    policy: canonicalPolicy(table.visibility),
  };
  return {
    id: digest('snapback:write-policy-check:v1', core),
    siteId: site.siteId,
    siteResolution: site.siteResolution
      ?? (surface === 'ctx-db' ? 'exact-static' : 'exact-plan-step'),
    operation: fn.name,
    runtimeClass: surface === 'ctx-db' ? 'javascript-handler' : 'host-plan',
    surface,
    writeForm: site.writeForm,
    writeFormCeiling: site.writeForm === 'opaque' ? [...JS_WRITE_FORMS] : null,
    table: table.name,
    tableResolution: site.tableResolution ?? 'exact',
    declaredTableCeiling: site.declaredTableCeiling ?? null,
    policyKind: policy,
    policyDigest: digest('snapback:installed-table-policy:v1', canonicalPolicy(table.visibility)),
    declarationOrigin: table.visibility ? 'declared' : 'legacy-default',
    ownerField: owner,
    ownerFieldResolution: owner === null ? 'not-applicable' : 'exact',
    genericWriteDisposition: disposition,
    principalSource: disposition === 'owner-policy' ? 'auth.userId' : 'not-applicable',
    ownerInputDisposition: insertion && disposition === 'owner-policy'
      ? (surface === 'ctx-db' || !site.valueFields?.includes(owner)
          ? 'host-stamped' : 'sealed-auth-user-id-marker')
      : point && disposition === 'owner-policy' ? 'refused' : 'not-applicable',
    preflightChecks: disposition === 'owner-policy'
      ? ['target-policy', 'authority-table-class', insertion ? 'owner-input' : 'owner-immutability',
        ...(insertion || site.writeForm === 'patch' ? ['unique-disclosure'] : [])]
      : ['target-policy', 'authority-table-class'],
    authoritativeChecks: disposition === 'owner-policy'
      ? [
          'installed-policy',
          ...(insertion ? ['owner-stamp'] : []),
          ...(point ? ['old-owner', 'identical-absent'] : []),
          ...(site.writeForm === 'delete-where' ? ['owner-delete-filter'] : []),
        ]
      : disposition === 'migration-pending'
        ? ['pre-0264-runtime-behavior']
        : ['installed-policy-refusal'],
    absentDisposition: absent,
    absentDispositionDigest: absent === 'declared-refusal'
      ? site.ownerWriteCheck?.absent?.digest ?? null : null,
    uniqueConflictDisposition: conflict.kind === 'missing-disclosure'
      ? { kind: 'missing-disclosure', constraints: conflict.missing }
      : { kind: conflict.kind, constraints: conflict.constraints },
    authorityTableClass: authorityClass,
    writeElevation: 'unavailable',
    resultEgress: 'separate-phase-not-covered',
    sourceEvidence: surface === 'ctx-db'
      ? { kind: site.siteResolution === 'runtime-ceiling-member'
          ? 'static-inline-runtime-ceiling-member'
          : site.siteResolution === 'migration-pending-declared-write-set'
            ? 'migration-pending-declared-write-set'
            : 'static-inline', ...site.source }
      : { kind: 'generated-step', ...site.source },
  };
}

function migrationPendingDeclaredWriteSetRows(fn, sourceFn, tables, disclosures, moduleSource) {
  const declaredWrites = [...new Set(
    fn.declaredWrites ?? sourceFn.declaredWrites ?? fn.writeSetSummary?.tables ?? [],
  )].sort(compareText);
  if (declaredWrites.length === 0) return null;
  const candidates = declaredWrites.map((tableName) => tables[tableName]);
  if (candidates.some((table) => !table?.visibility
    || authorityTableClass(table) !== 'ordinary'
    || table.visibility.kind === 'owner')) return null;
  const moduleDigest = digest('snapback:generic-write-module-source:v1', moduleSource);
  return candidates.map((table) => exactProjectionRow({
    fn,
    table,
    disclosures,
    surface: 'ctx-db',
    site: {
      siteId: null,
      siteResolution: 'migration-pending-declared-write-set',
      tableResolution: 'exact',
      declaredTableCeiling: declaredWrites,
      writeForm: 'opaque',
      valueFields: null,
      source: {
        modulePath: sourceFn.writePolicySourcePath ?? 'functions.mjs',
        moduleDigest,
      },
    },
  }));
}

function opaqueProjectionRow(fn, sourceFn, moduleSource) {
  const declaredTableCeiling = [...(sourceFn.writePolicy?.declaredTableCeiling
    ?? sourceFn.declaredTableCeiling ?? [])].sort(compareText);
  const opaqueWritePosture = sourceFn.writePolicy?.opaqueWritePosture
    ?? sourceFn.opaqueWritePosture;
  const core = {
    operation: fn.name,
    opaqueWritePosture: opaqueWritePosture ?? null,
    declaredTableCeiling,
    moduleDigest: digest('snapback:generic-write-module-source:v1', moduleSource),
  };
  return {
    id: digest('snapback:write-policy-check:v1', core),
    siteId: null,
    siteResolution: 'opaque-module',
    operation: fn.name,
    runtimeClass: 'javascript-handler',
    surface: 'ctx-db',
    writeForm: 'opaque',
    writeFormCeiling: [...JS_WRITE_FORMS],
    table: null,
    tableResolution: 'opaque-module',
    declaredTableCeiling,
    policyKind: 'runtime-resolved',
    policyDigest: null,
    declarationOrigin: 'runtime-resolved',
    ownerField: null,
    ownerFieldResolution: 'runtime-resolved',
    genericWriteDisposition: 'runtime-resolved',
    principalSource: 'runtime-resolved',
    ownerInputDisposition: 'runtime-resolved',
    preflightChecks: ['closed-table-ceiling', 'conservative-all-form-census', 'unique-disclosure'],
    authoritativeChecks: ['installed-policy-runtime-dispatch'],
    absentDisposition: 'runtime-resolved',
    absentDispositionDigest: null,
    uniqueConflictDisposition: { kind: 'runtime-resolved', constraints: [] },
    authorityTableClass: 'runtime-resolved',
    writeElevation: 'unavailable',
    resultEgress: 'separate-phase-not-covered',
    sourceEvidence: {
      kind: 'opaque-module',
      modulePath: sourceFn.writePolicySourcePath ?? 'functions.mjs',
      moduleDigest: core.moduleDigest,
      opaqueWritePosture: opaqueWritePosture ?? null,
    },
  };
}

function validateExactSite({
  fn,
  sourceFn,
  site,
  table,
  disclosures,
  surface,
  err,
  warn,
  declaredNonOwnerDisposition,
  row,
}) {
  const authorityClass = authorityTableClass(table);
  if (authorityClass !== 'ordinary') {
    refusal(err, 'SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE', fn.name,
      `generic ${site.writeForm} cannot target authority table ${site.table}`,
      { table: site.table, writeForm: site.writeForm, authorityTableClass: authorityClass }, row);
    return;
  }
  if (!table.visibility) {
    refusal(err, 'SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED', fn.name,
      `generic ${site.writeForm} requires an installed table policy`,
      { table: site.table, writeForm: site.writeForm }, row);
    return;
  }
  if (table.visibility.kind !== 'owner') {
    if (declaredNonOwnerDisposition === 'migration-pending') {
      migrationWarning(warn, fn.name, table, site.writeForm, row);
      return;
    }
    refusal(err, 'SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE', fn.name,
      `the installed ${table.visibility.kind} policy does not admit generic ${site.writeForm}`,
      { table: site.table, writeForm: site.writeForm, policyKind: table.visibility.kind }, row);
    return;
  }
  const owner = table.visibility.field;
  const insertion = site.writeForm === 'insert' || site.writeForm === 'insert-each';
  if ((insertion || site.writeForm === 'patch')
    && site.valueFields === null
    && site.opaqueConservative !== true) {
    refusal(err, 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE', fn.name,
      `owner-policy ${site.writeForm} requires a classifiable value shape`,
      { table: site.table, writeForm: site.writeForm, ownerField: owner }, row);
    return;
  }
  if (insertion && site.valueFields?.includes(owner)) {
    const sealed = surface === 'host-plan' && site.ownerExpression?.[owner] === 'AuthUserId';
    if (!sealed) {
      refusal(err, 'SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED', fn.name,
        `generic ${site.writeForm} cannot author owner field ${site.table}.${owner}`,
        { table: site.table, writeForm: site.writeForm, ownerField: owner }, row);
      return;
    }
  }
  if (site.writeForm === 'patch' && site.valueFields?.includes(owner)) {
    refusal(err, 'SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE', fn.name,
      `generic patch cannot change owner field ${site.table}.${owner}`,
      { table: site.table, writeForm: site.writeForm, ownerField: owner }, row);
    return;
  }
  const conflict = uniqueConflictFact(table, site, fn.name, disclosures);
  if (conflict.kind === 'missing-disclosure') {
    refusal(err, 'SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED', fn.name,
      `generic ${site.writeForm} reaches global unique constraint(s) without an operation-bound disclosure`,
      { table: site.table, writeForm: site.writeForm, constraints: conflict.missing }, row);
  }
  for (const entry of sourceFn.writePolicy?.disclosures
    ?? sourceFn.discloseUniqueConflicts ?? []) {
    if (!entry.operations.includes(fn.name)) {
      refusal(err, 'SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED', fn.name,
        'a conflict disclosure carrier does not name its own operation identity',
        { table: entry.table, writeForm: entry.writeForm, constraint: entry.constraint,
          operations: entry.operations }, row);
    }
  }
}

function validateOpaque({
  fn,
  sourceFn,
  tables,
  disclosures,
  err,
  warn,
  declaredNonOwnerDisposition,
  row,
}) {
  const ceiling = sourceFn.writePolicy?.declaredTableCeiling
    ?? sourceFn.declaredTableCeiling;
  const opaqueWritePosture = sourceFn.writePolicy?.opaqueWritePosture
    ?? sourceFn.opaqueWritePosture;
  if (opaqueWritePosture !== 'conservative-v1'
    || !Array.isArray(ceiling) || ceiling.length === 0) {
    refusal(err, 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE', fn.name,
      'opaque JavaScript generic writes require opaqueWritePosture: conservative-v1 and a closed table ceiling',
      { opaqueWritePosture: opaqueWritePosture ?? null,
        declaredTableCeiling: ceiling ?? null }, row);
    return;
  }
  const declaredWrites = new Set(
    fn.declaredWrites ?? sourceFn.declaredWrites ?? fn.writeSetSummary?.tables ?? [],
  );
  if ([...declaredWrites].some((table) => !ceiling.includes(table))
    || ceiling.some((table) => !declaredWrites.has(table))) {
    refusal(err, 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE', fn.name,
      'opaque JavaScript table ceiling must exactly match the declared generic write set',
      { declaredWrites: [...declaredWrites].sort(compareText), declaredTableCeiling: ceiling }, row);
    return;
  }
  for (const tableName of ceiling) {
    const table = tables[tableName];
    for (const writeForm of JS_WRITE_FORMS) {
      const candidate = {
        writeForm,
        table: tableName,
        valueFields: null,
        opaqueConservative: true,
      };
      const exact = exactProjectionRow({ fn, site: {
        ...candidate,
        siteId: digest('snapback:opaque-ceiling-member:v1', { operation: fn.name, writeForm, table: tableName }),
        source: { opaqueCeilingMember: true },
      }, table, disclosures, surface: 'ctx-db' });
      validateExactSite({ fn, sourceFn, site: candidate, table, disclosures,
        surface: 'ctx-db', err, warn, declaredNonOwnerDisposition, row: exact });
    }
  }
}

/** Validate every generic write site and return the deterministic D9 rows. */
export function buildWritePolicyChecks({
  tables,
  functions,
  sourceFunctions,
  err,
  warn,
  declaredNonOwnerDisposition = 'migration-pending',
}) {
  if (!['migration-pending', 'refused'].includes(declaredNonOwnerDisposition)) {
    throw new TypeError(`unsupported declared non-owner disposition ${declaredNonOwnerDisposition}`);
  }
  const sourceByName = new Map(sourceFunctions.map((fn) => [fn.name, fn]));
  const disclosures = collectWriteDisclosures(sourceFunctions);
  const operationNames = new Set(functions.map(({ name }) => name));
  for (const entry of disclosures) {
    for (const operation of entry.operations) {
      if (!operationNames.has(operation)) {
        refusal(err, 'SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED', operation,
          'conflict disclosure names an unknown operation identity', entry);
      }
    }
  }
  const rows = [];
  for (const fn of functions) {
    if (fn.kind !== 'Mutation') continue;
    const sourceFn = sourceByName.get(fn.name) ?? {};
    if (fn.runtime?.IbexModule) {
      const moduleSource = fn.runtime.IbexModule.source ?? '';
      const census = scanGenericWriteSites(
        moduleSource,
        fn.name,
        sourceFn.writePolicySourcePath ?? 'functions.mjs',
      );
      // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
      // — generated roster transitions execute through the specialized
      // authority-profile host seam. They are not generic ctx.db writers and
      // must not inherit the ordinary owner-write classifier merely because
      // their exact authority-table effects are declared in the manifest.
      if (sourceFn.authorityProfileOperation !== undefined) {
        if (census.opaque || census.sites.length > 0) {
          refusal(err, 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE', fn.name,
            'generated authority-profile operations cannot contain generic ctx.db writes',
            { authorityProfileOperation: sourceFn.authorityProfileOperation });
        }
        continue;
      }
      if (fn.handlerForm !== 'inline' && !census.selectedOperation) {
        const stagedRows = declaredNonOwnerDisposition === 'migration-pending'
          ? migrationPendingDeclaredWriteSetRows(
              fn, sourceFn, tables, disclosures, moduleSource,
            )
          : null;
        if (stagedRows) {
          rows.push(...stagedRows);
          for (const row of stagedRows) {
            migrationWarning(warn, fn.name, tables[row.table], row.writeForm, row);
          }
          continue;
        }
        const row = opaqueProjectionRow(fn, sourceFn, moduleSource);
        rows.push(row);
        validateOpaque({
          fn, sourceFn, tables, disclosures, err, warn,
          declaredNonOwnerDisposition, row,
        });
        continue;
      }
      if (census.opaque) {
        const stagedRows = declaredNonOwnerDisposition === 'migration-pending'
          ? migrationPendingDeclaredWriteSetRows(
              fn, sourceFn, tables, disclosures, moduleSource,
            )
          : null;
        if (stagedRows) {
          rows.push(...stagedRows);
          for (const row of stagedRows) {
            migrationWarning(warn, fn.name, tables[row.table], row.writeForm, row);
          }
          continue;
        }
        const row = opaqueProjectionRow(fn, sourceFn, moduleSource);
        rows.push(row);
        validateOpaque({
          fn, sourceFn, tables, disclosures, err, warn,
          declaredNonOwnerDisposition, row,
        });
        continue;
      }
      if (census.sites.some((site) => site.table === null)) {
        const stagedRows = declaredNonOwnerDisposition === 'migration-pending'
          ? migrationPendingDeclaredWriteSetRows(
              fn, sourceFn, tables, disclosures, moduleSource,
            )
          : null;
        if (stagedRows) {
          rows.push(...stagedRows);
          for (const row of stagedRows) {
            migrationWarning(warn, fn.name, tables[row.table], row.writeForm, row);
          }
          continue;
        }
      }
      for (const site of census.sites) {
        if (site.table === null) {
          const ceiling = sourceFn.writePolicy?.declaredTableCeiling
            ?? sourceFn.declaredTableCeiling;
          const declaredWrites = [...(
            fn.declaredWrites ?? sourceFn.declaredWrites ?? fn.writeSetSummary?.tables ?? []
          )].sort(compareText);
          if (!Array.isArray(ceiling) || ceiling.length === 0
            || canonical([...ceiling].sort(compareText)) !== canonical(declaredWrites)) {
            const row = opaqueProjectionRow(fn, sourceFn, moduleSource);
            rows.push(row);
            refusal(err, 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE', fn.name,
              'a classifiable runtime table target requires a closed ceiling equal to the declared write set',
              { declaredWrites, declaredTableCeiling: ceiling ?? null }, row);
            continue;
          }
          for (const tableName of [...ceiling].sort(compareText)) {
            const table = tables[tableName];
            if (!table) continue;
            const memberSite = {
              ...site,
              table: tableName,
              siteResolution: 'runtime-ceiling-member',
              tableResolution: 'runtime-ceiling-member',
              declaredTableCeiling: [...ceiling].sort(compareText),
            };
            const row = exactProjectionRow({
              fn, site: memberSite, table, disclosures, surface: 'ctx-db',
            });
            rows.push(row);
            validateExactSite({
              fn, sourceFn, site: memberSite, table, disclosures,
              surface: 'ctx-db', err, warn, declaredNonOwnerDisposition, row,
            });
          }
          continue;
        }
        const table = tables[site.table];
        if (!table) continue;
        const row = exactProjectionRow({ fn, site, table, disclosures, surface: 'ctx-db' });
        rows.push(row);
        validateExactSite({
          fn, sourceFn, site, table, disclosures,
          surface: 'ctx-db', err, warn, declaredNonOwnerDisposition, row,
        });
      }
      continue;
    }
    for (const site of hostPlanSites(fn)) {
      const table = tables[site.table];
      if (!table) continue;
      const row = exactProjectionRow({ fn, site, table, disclosures, surface: 'host-plan' });
      rows.push(row);
      validateExactSite({
        fn, sourceFn, site, table, disclosures,
        surface: 'host-plan', err, warn, declaredNonOwnerDisposition, row,
      });
    }
  }
  return {
    disclosures,
    rows: rows.sort((left, right) => compareText(left.id, right.id)),
  };
}
