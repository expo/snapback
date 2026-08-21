// Deterministic author-facing projection of one complete codegen result.

const WRITE_POSTURE_MIGRATION_WARNING =
  'SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING';

// @ref LLP 0264#d9-authorization-review-projection — structured diagnostics
// and writePolicyChecks retain site/table facts; only the human summary groups
// repeated migration findings by their semantic repair.
// @ref LLP 0295#1d-current-source-qualification-and-developer-loop-cost — one
// grouped advisory per semantic repair keeps repeated migration findings from
// burying the useful generation summary.
function migrationAdvisoryGroups(diagnostics) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== WRITE_POSTURE_MIGRATION_WARNING
      || diagnostic.severity !== 'warning') continue;
    const repairClass = diagnostic.repairClass ?? diagnostic.details?.repairClass
      ?? 'declare-explicit-write-authority';
    const current = groups.get(repairClass) ?? {
      code: WRITE_POSTURE_MIGRATION_WARNING,
      repairClass,
      affectedTables: new Set(),
      affectedOperations: new Set(),
      occurrences: 0,
    };
    const table = diagnostic.table ?? diagnostic.details?.table;
    if (typeof table === 'string') {
      current.affectedTables.add(table);
    }
    const operation = diagnostic.function ?? diagnostic.details?.function;
    if (typeof operation === 'string') current.affectedOperations.add(operation);
    current.occurrences += 1;
    groups.set(repairClass, current);
  }
  return [...groups.values()]
    .map((group) => ({
      code: group.code,
      repairClass: group.repairClass,
      affectedTableCount: group.affectedTables.size,
      affectedTables: [...group.affectedTables].sort(),
      affectedOperationCount: group.affectedOperations.size,
      affectedOperations: [...group.affectedOperations].sort(),
      occurrences: group.occurrences,
      detailSurfaces: [
        '--json diagnostics',
        'generated/authorization-review.json#writePolicyChecks',
      ],
    }))
    .sort((left, right) => (
      left.repairClass < right.repairClass ? -1 : left.repairClass > right.repairClass ? 1 : 0
    ));
}

export function groupedCodegenSummaryDiagnosticCodes(summary) {
  return new Set((summary?.migrationAdvisories ?? []).map(({ code }) => code));
}

export function createCodegenSummary({
  appId,
  inputsHash,
  tables,
  functions,
  ephemeralCollections,
  fileRecords,
  diagnostics,
  sourceSpans = {},
  schemaFieldSpans = {},
  outputDirectory = 'generated',
  seedArtifact = null,
  seedRowCount = null,
}) {
  const operationCounts = { total: functions.length, query: 0, liveQuery: 0, mutation: 0, action: 0, live: 0 };
  for (const fn of functions) {
    const key = fn.kind[0].toLowerCase() + fn.kind.slice(1);
    if (Object.hasOwn(operationCounts, key)) operationCounts[key] += 1;
    if (fn.kind === 'LiveQuery') operationCounts.live += 1;
  }
  const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
  const migrationAdvisories = migrationAdvisoryGroups(diagnostics);
  const implicitAuthRequirements = diagnostics
    .filter(({ code }) => code === 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT')
    .map((diagnostic) => {
      const operation = diagnostic.details?.function ?? diagnostic.function;
      const source = diagnostic.sourceSpan
        ? {
            path: diagnostic.sourceSpan.file,
            line: diagnostic.sourceSpan.line,
            column: diagnostic.sourceSpan.column,
          }
        : (sourceSpans[operation] ?? { path: 'functions.mjs', line: 1, column: 1 });
      return {
        code: diagnostic.code,
        operation,
        source,
        effectiveLegacyRequirement: diagnostic.details?.effectiveLegacyRequirement ?? 'optional-user',
        allowed: [...(diagnostic.details?.allowed ?? [])],
        guideAnchor: diagnostic.details?.guideAnchor,
      };
    })
    .filter(({ operation }) => typeof operation === 'string')
    .sort((left, right) => (
      left.operation < right.operation ? -1 : left.operation > right.operation ? 1 : 0
    ));
  const declaredTableVisibility = Object.entries(tables)
    .filter(([, table]) => table.visibility !== undefined)
    .map(([table, definition]) => ({ table, kind: definition.visibility.kind }))
    .sort((left, right) => (
      left.table < right.table ? -1 : left.table > right.table ? 1 : 0
    ));
  const implicitTableVisibility = Object.entries(tables)
    .filter(([, table]) => table.visibility === undefined)
    .map(([table]) => table)
    .sort();
  const tableVisibility = {
    declared: declaredTableVisibility,
    implicit: implicitTableVisibility,
    counts: {
      total: Object.keys(tables).length,
      declared: declaredTableVisibility.length,
      implicit: implicitTableVisibility.length,
      publicRead: declaredTableVisibility.filter(({ kind }) => kind === 'public-read').length,
      owner: declaredTableVisibility.filter(({ kind }) => kind === 'owner').length,
      membership: declaredTableVisibility.filter(({ kind }) => kind === 'membership').length,
      anyOf: declaredTableVisibility.filter(({ kind }) => kind === 'any-of').length,
    },
  };
  const fieldBoundaries = functions
    .filter((fn) => fn.fieldBoundary !== undefined)
    .map((fn) => ({
      function: fn.name,
      fields: [...fn.fieldBoundary.fields],
      condition: fn.fieldBoundary.condition,
    }))
    .sort((left, right) => (
      left.function < right.function ? -1 : left.function > right.function ? 1 : 0
    ));
  const degradedByOperation = new Map();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== 'SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED') continue;
    const operation = diagnostic.details?.function ?? diagnostic.function;
    if (typeof operation !== 'string') continue;
    const definition = functions.find(({ name }) => name === operation);
    const kind = definition?.kind ?? 'Unknown';
    const table = definition?.readSetSummary?.[0]
      ?? definition?.declaredReads?.[0]
      ?? definition?.writeSetSummary?.[0]
      ?? definition?.declaredWrites?.[0]
      ?? null;
    const query = kind === 'Query' || kind === 'LiveQuery';
    degradedByOperation.set(operation, {
      code: diagnostic.code,
      operation,
      kind,
      source: sourceSpans[operation] ?? { path: 'functions.mjs', line: 1, column: 1 },
      output: {
        path: `${outputDirectory}/api.d.ts`,
        symbol: `GeneratedApi[${JSON.stringify(operation)}]`,
      },
      remediation: query
        ? `Add \`result: results.documents(${JSON.stringify(table ?? 'table')})\` for complete stored rows or \`result: results.records(v.object({ ... }))\` for computed rows to \`${operation}\` in functions.mjs and regenerate.`
        : `Add \`result: results.document(${JSON.stringify(table ?? 'table')})\` for one complete stored row or \`result: results.value(v.object({ ... }))\` for a direct payload to \`${operation}\` in functions.mjs and regenerate.`,
    });
  }
  const providerDegradations = warnings
    .filter(({ code }) => code === 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED')
    .map((diagnostic) => ({
      diagnostic,
      match: /^queries\.([^.]+)\.result\.row(?:\.([^.]+))?(?:\.|$)/u.exec(diagnostic.path ?? ''),
    }))
    .filter(({ match }) => match !== null)
    .map(({ diagnostic, match }) => {
      const operation = match[1];
      const degradedField = match[2] ?? null;
      const definition = functions.find(({ name }) => name === operation);
      const table = definition?.readSetSummary?.[0] ?? definition?.declaredReads?.[0] ?? null;
      return {
        code: diagnostic.code,
        operation,
        kind: definition?.kind ?? 'Unknown',
        source: degradedField
          ? (
              schemaFieldSpans[table ? `${table}.${degradedField}` : degradedField]
              ?? schemaFieldSpans[degradedField]
              ?? { path: 'schema.mjs', line: 1, column: 1 }
            )
          : (sourceSpans[operation] ?? { path: 'functions.mjs', line: 1, column: 1 }),
        output: {
          path: `${outputDirectory}/provider-bindings.d.ts`,
          symbol: `${pascal(operation)}Result`,
        },
        remediation: degradedField
          ? `Replace the unknown validator for \`${degradedField}\` in schema.mjs with a concrete scalar or \`v.object({ ... })\` validator and regenerate.`
          : `Add a \`result: v.object({ ... })\` declaration to \`${operation}\` in functions.mjs and regenerate.`,
      };
    });
  for (const degradation of providerDegradations) {
    if (!degradedByOperation.has(degradation.operation)) {
      degradedByOperation.set(degradation.operation, degradation);
    }
  }
  const degradedResults = [...degradedByOperation.values()]
    .sort((left, right) => (
      left.operation < right.operation ? -1 : left.operation > right.operation ? 1 : 0
    ));
  const custody = {
    reviewManifest: 1,
    consumerCommitted: fileRecords.filter(({ custody }) => custody === 'consumer-committed').length,
    regenerableCache: fileRecords.filter(({ custody }) => custody === 'regenerable-cache').length,
    total: fileRecords.length + 1,
  };
  return {
    schemaVersion: 'snapback.codegen-summary.v1',
    appId,
    inputsHash,
    counts: {
      tables: Object.keys(tables).length,
      operations: operationCounts,
      ephemeralCollections: ephemeralCollections.length,
      custody,
      warnings: warnings.length,
      migrationAdvisories: migrationAdvisories.length,
      implicitAuthRequirements: implicitAuthRequirements.length,
      degradedResults: degradedResults.length,
      fieldBoundaries: fieldBoundaries.length,
      ...(seedArtifact ? { seedRows: seedRowCount } : {}),
    },
    tableVisibility,
    migrationAdvisories,
    fieldBoundaries,
    implicitAuthRequirements,
    degradedResults,
    ...(seedArtifact
      ? {
          seed: {
            version: seedArtifact.seedVersion,
            digest: seedArtifact.seedDigest,
            rows: seedRowCount,
          },
        }
      : {}),
  };
}

export function formatCodegenSummary(summary) {
  const { counts } = summary;
  const operations = counts.operations;
  const lines = [
    `Codegen summary for ${summary.appId}`,
    `  tables ${counts.tables}; operations ${operations.total} (query ${operations.query}, live query ${operations.liveQuery}, mutation ${operations.mutation}, action ${operations.action}); live ${operations.live}; ephemeral ${counts.ephemeralCollections}`,
    `  files ${counts.custody.total} (review manifest ${counts.custody.reviewManifest}, consumer committed ${counts.custody.consumerCommitted}, ignored cache ${counts.custody.regenerableCache}); warnings ${counts.warnings}`,
  ];
  for (const item of summary.degradedResults) {
    lines.push(
      `  degraded ${item.operation}: ${item.source.path}:${item.source.line}:${item.source.column} -> ${item.output.path}#${item.output.symbol}`,
      `    ${item.remediation}`,
    );
  }
  for (const item of summary.implicitAuthRequirements ?? []) {
    lines.push(
      `  auth ${item.operation}: ${item.source.path}:${item.source.line}:${item.source.column} omits auth and currently uses ${item.effectiveLegacyRequirement}`,
      `    Add auth: 'public', auth: 'optional-user', or auth: 'authenticated'; see ${item.guideAnchor}`,
    );
  }
  for (const advisory of summary.migrationAdvisories ?? []) {
    lines.push(
      `  migration ${advisory.repairClass}: ${advisory.affectedTableCount} affected table${advisory.affectedTableCount === 1 ? '' : 's'} across ${advisory.occurrences} finding${advisory.occurrences === 1 ? '' : 's'}`,
      '    Choose one explicit table write posture or replace generic writes with a declaration-owned operation.',
      `    Per-table detail: ${advisory.detailSurfaces.join('; ')}`,
    );
  }
  const visibility = summary.tableVisibility;
  if (visibility) {
    lines.push(
      `  table visibility ${visibility.counts.declared} declared; ${visibility.counts.implicit} implicit`,
    );
    for (const table of visibility.implicit) {
      lines.push(
        `    ${table}: add .visibility(...) to the table definition; see guide/auth/protecting-data.md#declare-who-can-read-each-table`,
      );
    }
  }
  for (const boundary of summary.fieldBoundaries ?? []) {
    lines.push(
      `  field boundary ${boundary.function}: ${boundary.fields.join(', ')} — handler-enforced (not proven)`,
      `    condition: ${boundary.condition}`,
    );
  }
  return lines.join('\n');
}

function pascal(value) {
  const converted = value.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/gu, (_match, _separator, letter) => letter.toUpperCase());
  return /^[0-9]/u.test(converted) ? `_${converted}` : converted;
}
