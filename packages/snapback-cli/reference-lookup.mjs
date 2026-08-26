// Build-bound exact API lookup for the package-owned CLI seam. A checkout can
// resolve the committed Guide artifacts directly; installed native parity is
// deliberately left to the embedded-registry Rust follow-up named by LLP 0194.
// @ref LLP 0194#design — exact lookup is budgeted and identity-bound to the registry.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defaultBudget = 16_384;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function candidateGuideRoots(options) {
  if (options.guideRoot) return [resolve(options.guideRoot)];
  const roots = [];
  for (const start of [options.projectRoot, options.cwd, process.cwd(), packageRoot].filter(Boolean)) {
    let current = resolve(start);
    while (true) {
      roots.push(join(current, 'guide'));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...new Set(roots)];
}

function loadArtifacts(options = {}) {
  const explicitRegistry = options.symbolRegistryPath && resolve(options.symbolRegistryPath);
  const explicitDiagnostics = options.diagnosticsRegistryPath && resolve(options.diagnosticsRegistryPath);
  const explicitManifest = options.guideManifestPath && resolve(options.guideManifestPath);
  const candidates = explicitRegistry
    ? [{ registryPath: explicitRegistry, diagnosticsPath: explicitDiagnostics, manifestPath: explicitManifest }]
    : candidateGuideRoots(options).map((guideRoot) => ({
        registryPath: join(guideRoot, 'reference', 'registry.json'),
        diagnosticsPath: join(guideRoot, 'reference', 'diagnostics-registry.json'),
        manifestPath: join(guideRoot, 'guide-manifest.generated.json'),
      }));
  const candidate = candidates.find(({ registryPath, diagnosticsPath, manifestPath }) => (
    existsSync(registryPath) && diagnosticsPath && existsSync(diagnosticsPath) && manifestPath && existsSync(manifestPath)
  ));
  if (!candidate) return null;
  const registryBytes = readFileSync(candidate.registryPath);
  const diagnosticsBytes = readFileSync(candidate.diagnosticsPath);
  const manifest = JSON.parse(readFileSync(candidate.manifestPath, 'utf8'));
  const resource = manifest.resources?.['reference.symbol-registry'];
  if (!resource || resource.sha256 !== sha256(registryBytes)) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide manifest does not bind the selected registry bytes');
  }
  const diagnosticsResource = manifest.resources?.['reference.diagnostics-registry'];
  if (!diagnosticsResource || diagnosticsResource.sha256 !== sha256(diagnosticsBytes)) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide manifest does not bind the selected diagnostics registry bytes');
  }
  const registry = JSON.parse(registryBytes);
  const diagnostics = JSON.parse(diagnosticsBytes);
  if (resource.sourceDigest !== registry.buildIdentity?.sourceDigest) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide and registry source identities differ');
  }
  if (diagnosticsResource.sourceDigest !== diagnostics.buildIdentity?.sourceDigest) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide and diagnostics source identities differ');
  }
  return { registry, diagnostics, manifest };
}

function parseSlice(argv) {
  const index = argv.indexOf('--slice');
  if (index === -1) return 1;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('SNAPBACK_CLI_ARGUMENT_INVALID: --slice must be a positive integer');
  }
  return value;
}

function resultIdentity(registry, diagnostics, manifest) {
  return {
    guideContentHash: manifest.contentHash,
    guideBuildCommit: manifest.buildIdentity?.commit ?? 'unknown',
    registrySourceDigest: registry.buildIdentity.sourceDigest,
    diagnosticsSourceDigest: diagnostics.buildIdentity.sourceDigest,
  };
}

function registryRecordForDistribution(record, includeSites) {
  if (includeSites) return record;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'sites'),
  );
}

function budgetedDiagnostic(query, diagnostic, identity, slice, budget) {
  const complete = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'diagnostic',
    identity,
    diagnostic,
    truncation: null,
  };
  if (Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
  const sites = Array.isArray(diagnostic.sites) ? diagnostic.sites : [];
  const pageSize = 24;
  const start = (slice - 1) * pageSize;
  const visible = sites.slice(start, start + pageSize);
  const hasMore = start + pageSize < sites.length;
  const result = {
    ...complete,
    match: 'diagnostic-slice',
    diagnostic: { ...diagnostic, sites: visible },
    truncation: {
      truncated: true,
      slice,
      elided: [`diagnostic sites outside ${start + 1}-${Math.min(start + pageSize, sites.length)} of ${sites.length}`],
      nextSlice: hasMore ? slice + 1 : null,
      nextCommand: hasMore ? `snapback guide ${query} --slice ${slice + 1}` : null,
    },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: diagnostic slice ${query} exceeds ${budget} bytes`);
  }
  return result;
}

function budgetedEnvironment(query, environment, identity, slice, budget) {
  const complete = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'environment',
    identity,
    environment,
    truncation: null,
  };
  if (Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
  const sites = Array.isArray(environment.sites) ? environment.sites : [];
  const pageSize = 24;
  const start = (slice - 1) * pageSize;
  const visible = sites.slice(start, start + pageSize);
  const hasMore = start + pageSize < sites.length;
  const result = {
    ...complete,
    match: 'environment-slice',
    environment: { ...environment, sites: visible },
    truncation: {
      truncated: true,
      slice,
      elided: [`environment sites outside ${start + 1}-${Math.min(start + pageSize, sites.length)} of ${sites.length}`],
      nextSlice: hasMore ? slice + 1 : null,
      nextCommand: hasMore ? `snapback guide ${query} --slice ${slice + 1}` : null,
    },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: environment slice ${query} exceeds ${budget} bytes`);
  }
  return result;
}

function budgetedDiagnosticEnvironment(
  query,
  diagnostic,
  environment,
  identity,
  slice,
  budget,
) {
  const complete = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'diagnostic-environment',
    identity,
    diagnostic,
    environment,
    truncation: null,
  };
  if (Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;

  const diagnosticSites = Array.isArray(diagnostic.sites) ? diagnostic.sites : [];
  const environmentSites = Array.isArray(environment.sites) ? environment.sites : [];
  const sites = Array.from(
    { length: Math.max(diagnosticSites.length, environmentSites.length) },
    (_, index) => [
      ...(diagnosticSites[index] === undefined
        ? []
        : [{ owner: 'diagnostic', site: diagnosticSites[index] }]),
      ...(environmentSites[index] === undefined
        ? []
        : [{ owner: 'environment', site: environmentSites[index] }]),
    ],
  ).flat();
  const pageSize = 23;
  const start = (slice - 1) * pageSize;
  const visible = sites.slice(start, start + pageSize);
  const hasMore = start + pageSize < sites.length;
  const result = {
    ...complete,
    match: 'diagnostic-environment-slice',
    diagnostic: {
      ...diagnostic,
      ...(diagnostic.sites === undefined
        ? {}
        : { sites: visible.filter(({ owner }) => owner === 'diagnostic').map(({ site }) => site) }),
    },
    environment: {
      ...environment,
      sites: visible.filter(({ owner }) => owner === 'environment').map(({ site }) => site),
    },
    truncation: {
      truncated: true,
      slice,
      elided: [`diagnostic/environment sites outside ${start + 1}-${Math.min(start + pageSize, sites.length)} of ${sites.length}`],
      nextSlice: hasMore ? slice + 1 : null,
      nextCommand: hasMore ? `snapback guide ${query} --slice ${slice + 1}` : null,
    },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: diagnostic/environment slice ${query} exceeds ${budget} bytes`);
  }
  return result;
}

function memberMatch(symbol, query) {
  const prefix = `${symbol.name}.`;
  if (!query.startsWith(prefix)) return null;
  return symbol.members.find((member) => member.name === query.slice(prefix.length)) ?? null;
}

function symbolSummary(symbol) {
  return {
    identity: symbol.identity,
    originIdentity: symbol.originIdentity,
    name: symbol.name,
    package: symbol.package,
    module: symbol.module,
    kind: symbol.kind,
    runtime: symbol.runtime,
    anchor: symbol.anchor,
    documentation: symbol.documentation,
    source: symbol.source,
    lifecycle: symbol.lifecycle ?? null,
  };
}

function formattedLifecycle(facts) {
  if (!facts) return [];
  return [
    ...(facts.replaces ? [`Replaces ${facts.replaces}.`] : []),
    ...(facts.replacedBy ? [`Replaced by ${facts.replacedBy}.`] : []),
  ];
}

function budgetedSymbol(query, symbol, member, identity, slice, budget) {
  if (member) {
    const result = {
      schemaVersion: 'snapback.guide-symbol-lookup.v1',
      ok: true,
      query,
      match: 'member',
      identity,
      symbol: symbolSummary(symbol),
      member,
      truncation: null,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > budget) {
      throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: exact member ${query} exceeds ${budget} bytes`);
    }
    return result;
  }
  const complete = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'symbol',
    identity,
    symbol: { ...symbolSummary(symbol), signature: symbol.signature, overloads: symbol.overloads, members: symbol.members },
    truncation: null,
  };
  if (Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;

  const pageSize = 8;
  const start = (slice - 1) * pageSize;
  const visible = symbol.members.slice(start, start + pageSize);
  const remaining = symbol.members.slice(start + pageSize);
  const elided = [];
  if (symbol.signature) elided.push(`complete signature (${Buffer.byteLength(symbol.signature)} bytes)`);
  if (start > 0) elided.push(`members 1-${start}: ${symbol.members.slice(0, start).map(({ name }) => name).join(', ')}`);
  if (remaining.length > 0) {
    elided.push(`members ${start + pageSize + 1}-${symbol.members.length}: ${remaining.map(({ name }) => name).join(', ')}`);
  }
  const result = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'symbol-slice',
    identity,
    symbol: { ...symbolSummary(symbol), signature: null, members: visible },
    truncation: {
      truncated: true,
      slice,
      elided,
      nextSlice: remaining.length > 0 ? slice + 1 : null,
      nextCommand: remaining.length > 0 ? `snapback guide ${query} --slice ${slice + 1}` : null,
      exactMemberCommand: `snapback guide ${query}.<member>`,
    },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    result.symbol.members = visible.map(({ identity: memberIdentity, name, kind, sources }) => ({
      identity: memberIdentity,
      name,
      kind,
      sources,
    }));
  }
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: symbol slice ${query} exceeds ${budget} bytes`);
  }
  return result;
}

function budgetedModule(query, symbols, identity, slice, budget) {
  const pageSize = 12;
  const start = (slice - 1) * pageSize;
  const visible = symbols.slice(start, start + pageSize).map(symbolSummary);
  const remaining = symbols.slice(start + pageSize);
  const result = {
    schemaVersion: 'snapback.guide-symbol-lookup.v1',
    ok: true,
    query,
    match: 'module-slice',
    identity,
    module: query,
    symbols: visible,
    truncation: remaining.length === 0 && start === 0
      ? null
      : {
          truncated: true,
          slice,
          elided: [
            ...(start > 0 ? [`symbols 1-${start}: ${symbols.slice(0, start).map(({ name }) => name).join(', ')}`] : []),
            ...(remaining.length > 0 ? [`symbols ${start + pageSize + 1}-${symbols.length}: ${remaining.map(({ name }) => name).join(', ')}`] : []),
          ],
          nextSlice: remaining.length > 0 ? slice + 1 : null,
          nextCommand: remaining.length > 0 ? `snapback guide ${query} --slice ${slice + 1}` : null,
          exactSymbolCommand: 'snapback guide <ExactSymbolName>',
        },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    result.symbols = visible.map((symbol) => ({
      identity: symbol.identity,
      originIdentity: symbol.originIdentity,
      name: symbol.name,
      module: symbol.module,
      kind: symbol.kind,
      runtime: symbol.runtime,
      anchor: symbol.anchor,
      source: symbol.source,
      lifecycle: symbol.lifecycle,
    }));
  }
  if (Buffer.byteLength(JSON.stringify(result)) > budget) {
    throw new Error(`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: module slice ${query} exceeds ${budget} bytes`);
  }
  return result;
}

/** Return null when the query is not an exact registry/module hit so the
 * existing native Guide search remains the fuzzy fallback. */
export function lookupGuideReference(argv, options = {}) {
  const query = argv.find((argument, index) => (
    !argument.startsWith('-') && (index === 0 || argv[index - 1] !== '--slice')
  ));
  if (!query) return null;
  const artifacts = loadArtifacts(options);
  if (!artifacts) return null;
  const { registry, diagnostics, manifest } = artifacts;
  const budget = Math.min(options.lookupBudgetBytes ?? registry.limits.lookupBytes ?? defaultBudget, defaultBudget);
  const slice = parseSlice(argv);
  const identity = resultIdentity(registry, diagnostics, manifest);
  // @ref LLP 0193#program — stable diagnostic codes route exactly before API
  // symbols and the native command's Markdown fallback.
  if (diagnostics.diagnostics?.[query]) {
    const includeSites = options.includeDiagnosticSites === true;
    const diagnostic = registryRecordForDistribution(
      diagnostics.diagnostics[query],
      includeSites,
    );
    if (diagnostics.environment?.[query]) {
      return budgetedDiagnosticEnvironment(
        query,
        diagnostic,
        registryRecordForDistribution(diagnostics.environment[query], includeSites),
        identity,
        slice,
        budget,
      );
    }
    return budgetedDiagnostic(query, diagnostic, identity, slice, budget);
  }
  if (diagnostics.environment?.[query]) {
    return budgetedEnvironment(
      query,
      registryRecordForDistribution(
        diagnostics.environment[query],
        options.includeDiagnosticSites === true,
      ),
      identity,
      slice,
      budget,
    );
  }
  const byIdentity = new Map(registry.symbols.map((symbol) => [symbol.identity, symbol]));
  const matchedIds = registry.lookup.exact[query] ?? [];
  const matched = matchedIds.map((id) => byIdentity.get(id)).filter(Boolean);
  const uniqueByOrigin = new Map();
  for (const symbol of matched) {
    if (!uniqueByOrigin.has(symbol.originIdentity)) uniqueByOrigin.set(symbol.originIdentity, symbol);
  }
  const unique = [...uniqueByOrigin.values()];
  if (unique.length === 1) {
    return budgetedSymbol(query, unique[0], memberMatch(unique[0], query), identity, slice, budget);
  }
  if (unique.length > 1) return budgetedModule(query, unique, identity, slice, budget);
  const moduleSymbols = registry.symbols.filter((symbol) => symbol.module === query);
  if (moduleSymbols.length > 0) return budgetedModule(query, moduleSymbols, identity, slice, budget);
  return null;
}

export function formatGuideReferenceLookup(result) {
  const lines = [
    `${result.query} — ${result.match}`,
    `guide ${result.identity.guideContentHash} · registry ${result.identity.registrySourceDigest}`,
  ];
  if (result.diagnostic) {
    const status = result.diagnostic.httpStatus ? ` · HTTP ${result.diagnostic.httpStatus}` : '';
    lines.push(`${result.diagnostic.subsystem}${status}`);
    // @ref LLP 0223#tickets — shared codes route per emitting context, so a
    // code lookup must surface every associated anchor, not just the first.
    const anchors = result.diagnostic.guideAnchors?.length
      ? result.diagnostic.guideAnchors
      : (result.diagnostic.guideAnchor ? [result.diagnostic.guideAnchor] : []);
    if (anchors.length === 1) lines.push(`Guide: ${anchors[0]}`);
    else if (anchors.length > 1) lines.push('Guide anchors:', ...anchors.map((anchor) => `- ${anchor}`));
    if (result.diagnostic.sites?.length) {
      const siteGroups = [
        ['Emitting sites:', result.diagnostic.sites.filter((site) => site.kind === undefined || site.kind === 'emission')],
        ['Declaration sites:', result.diagnostic.sites.filter((site) => site.kind === 'declaration')],
        ['Received sites:', result.diagnostic.sites.filter((site) => site.kind === 'received')],
        ['Reserved sites:', result.diagnostic.sites.filter((site) => site.kind === 'reserved')],
      ];
      for (const [heading, sites] of siteGroups) {
        if (sites.length) lines.push('', heading, ...sites.map((site) => `- ${site.file}:${site.line}:${site.column}`));
      }
    }
  }
  if (result.environment) {
    lines.push('environment variable');
    if (result.environment.sites?.length) {
      lines.push(
        '',
        'Environment sites:',
        ...result.environment.sites.map((site) => (
          `- ${site.kind}: ${site.file}:${site.line}:${site.column}`
        )),
      );
    }
  } else if (!result.diagnostic && result.member) {
    lines.push(`${result.symbol.module} · ${result.symbol.kind}`, '', result.member.signature);
    // @ref LLP 0194#amendment-2026-08-09-authored-symbol-lifecycle-facts —
    // exact lookup projects registry lifecycle facts without reparsing declarations.
    lines.push(...formattedLifecycle(result.symbol.lifecycle), ...formattedLifecycle(result.member.lifecycle));
  } else if (!result.diagnostic && result.symbol) {
    lines.push(`${result.symbol.module} · ${result.symbol.kind}`);
    lines.push(...formattedLifecycle(result.symbol.lifecycle));
    if (result.symbol.signature) lines.push('', result.symbol.signature);
    if (result.symbol.members?.length) {
      lines.push('', ...result.symbol.members.map((member) => `${member.name}: ${member.signature ?? member.kind}`));
    }
  } else if (!result.diagnostic) {
    lines.push('', ...result.symbols.map((symbol) => `${symbol.name} — ${symbol.kind} — ${symbol.identity}`));
  }
  if (result.truncation) {
    lines.push('', 'TRUNCATED:', ...result.truncation.elided.map((entry) => `- ${entry}`));
    if (result.truncation.nextCommand) lines.push(`Next: ${result.truncation.nextCommand}`);
  }
  return lines.join('\n');
}
