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
