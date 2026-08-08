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
  const explicitManifest = options.guideManifestPath && resolve(options.guideManifestPath);
  const candidates = explicitRegistry
    ? [{ registryPath: explicitRegistry, manifestPath: explicitManifest }]
    : candidateGuideRoots(options).map((guideRoot) => ({
        registryPath: join(guideRoot, 'reference', 'registry.json'),
        manifestPath: join(guideRoot, 'guide-manifest.generated.json'),
      }));
  const candidate = candidates.find(({ registryPath, manifestPath }) => (
    existsSync(registryPath) && manifestPath && existsSync(manifestPath)
  ));
  if (!candidate) return null;
  const registryBytes = readFileSync(candidate.registryPath);
  const manifest = JSON.parse(readFileSync(candidate.manifestPath, 'utf8'));
  const resource = manifest.resources?.['reference.symbol-registry'];
  if (!resource || resource.sha256 !== sha256(registryBytes)) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide manifest does not bind the selected registry bytes');
  }
  const registry = JSON.parse(registryBytes);
  if (resource.sourceDigest !== registry.buildIdentity?.sourceDigest) {
    throw new Error('SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide and registry source identities differ');
  }
  return { registry, manifest };
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

function resultIdentity(registry, manifest) {
  return {
    guideContentHash: manifest.contentHash,
    guideBuildCommit: manifest.buildIdentity?.commit ?? 'unknown',
    registrySourceDigest: registry.buildIdentity.sourceDigest,
    registrySourceCommit: registry.buildIdentity.commit,
  };
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
  };
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
  const { registry, manifest } = artifacts;
  const budget = Math.min(options.lookupBudgetBytes ?? registry.limits.lookupBytes ?? defaultBudget, defaultBudget);
  const slice = parseSlice(argv);
  const identity = resultIdentity(registry, manifest);
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
  if (result.member) {
    lines.push(`${result.symbol.module} · ${result.symbol.kind}`, '', result.member.signature);
  } else if (result.symbol) {
    lines.push(`${result.symbol.module} · ${result.symbol.kind}`);
    if (result.symbol.signature) lines.push('', result.symbol.signature);
    if (result.symbol.members?.length) {
      lines.push('', ...result.symbol.members.map((member) => `${member.name}: ${member.signature ?? member.kind}`));
    }
  } else {
    lines.push('', ...result.symbols.map((symbol) => `${symbol.name} — ${symbol.kind} — ${symbol.identity}`));
  }
  if (result.truncation) {
    lines.push('', 'TRUNCATED:', ...result.truncation.elided.map((entry) => `- ${entry}`));
    if (result.truncation.nextCommand) lines.push(`Next: ${result.truncation.nextCommand}`);
  }
  return lines.join('\n');
}
