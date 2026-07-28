// Deterministic author-facing projection of one complete codegen result.

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
  const degradedResults = warnings
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
      const table = definition?.declaredReads?.[0] ?? null;
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
      degradedResults: degradedResults.length,
      ...(seedArtifact ? { seedRows: seedRowCount } : {}),
    },
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
  return lines.join('\n');
}

function pascal(value) {
  const converted = value.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/gu, (_match, _separator, letter) => letter.toUpperCase());
  return /^[0-9]/u.test(converted) ? `_${converted}` : converted;
}
