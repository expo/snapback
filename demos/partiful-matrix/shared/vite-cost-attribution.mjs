// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — every web
// cell emits the same CI-diffable four-layer module ledger. The ledger is a
// build asset, not executable client code, and its classifications are based
// on stable repository/package boundaries rather than minifier symbol names.

import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const normalized = (id) => id.replaceAll('\\', '/');

function repositoryRelativePath(id, repoRoot) {
  const path = normalized(id);
  const normalizedRoot = normalized(repoRoot).replace(/\/$/u, '');
  const rootIndex = path.indexOf(normalizedRoot);
  if (rootIndex < 0 || !/^\0?$/u.test(path.slice(0, rootIndex))) return null;
  const prefix = path.slice(0, rootIndex);
  const remainder = path.slice(rootIndex + normalizedRoot.length).replace(/^\//u, '');
  return remainder ? `${prefix}${remainder}` : `${prefix}.`;
}

export function portablePartitimeCostModuleId(id, { repoRoot = REPO_ROOT } = {}) {
  const path = normalized(id);
  const relativePath = repositoryRelativePath(path, repoRoot);
  if (relativePath !== null) return relativePath;
  const virtualPrefix = path.startsWith('\0') ? '\0' : '';
  const diskPath = virtualPrefix ? path.slice(1) : path;
  if (/^(?:\/?[A-Za-z]:\/|\/)/u.test(diskPath)) {
    const basename = diskPath.split('/').filter(Boolean).at(-1) ?? 'module';
    return `${virtualPrefix}[external]/${basename}`;
  }
  return path;
}

export function portablePartitimeArtifactProvenance(value, { repoRoot = REPO_ROOT } = {}) {
  if (typeof value === 'string') {
    return repositoryRelativePath(value, repoRoot) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => portablePartitimeArtifactProvenance(entry, { repoRoot }));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      portablePartitimeArtifactProvenance(entry, { repoRoot }),
    ]));
  }
  return value;
}

export function classifyPartitimeCostModule(id) {
  const path = normalized(id);
  if (
    /\/(?:generated|data\/generated)\//.test(path)
    || /\/data\/provider\.generated\.[^/]+$/.test(path)
    || /\/(?:seed|artifacts|schema\.manifest|functions\.manifest|contract-data\.manifest)\.json(?:\?|$)/.test(path)
  ) return 'generated-app-data';
  if (
    /\/packages\/snapback-(?:client|contract)\//.test(path)
    || /\/surfaces\/(?:react|contract|vanilla)\/(?:src\/)?(?:provider|convex-provider|convex-direct|supabase-direct|production-hydration)\.[^/]+$/.test(path)
    || /\/node_modules\/(?:@supabase|convex)\//.test(path)
  ) return 'provider-runtime';
  // A package manager may install framework dependencies below the measured
  // surface itself. Classify the dependency boundary before the broader
  // surface-path rule so `surfaces/contract/node_modules/@exact/*` does not
  // become application code merely because of its install location.
  if (/\/node_modules\//.test(path)) return 'framework-runtime';
  if (/\/surfaces\/(?:react|contract|vanilla)\//.test(path)) return 'application-code';
  return 'framework-runtime';
}

export function partitimeCostAttribution() {
  return {
    name: 'partitime-cost-attribution',
    generateBundle(_options, bundle) {
      const modules = Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .flatMap((chunk) => Object.entries(chunk.modules).map(([id, value]) => ({
          id: portablePartitimeCostModuleId(id),
          layer: classifyPartitimeCostModule(id),
          renderedBytes: value.renderedLength,
          chunk: chunk.fileName,
        })))
        .sort((left, right) => right.renderedBytes - left.renderedBytes || left.id.localeCompare(right.id));
      const layers = Object.fromEntries(
        ['framework-runtime', 'provider-runtime', 'generated-app-data', 'application-code']
          .map((layer) => [layer, modules.filter((entry) => entry.layer === layer)
            .reduce((sum, entry) => sum + entry.renderedBytes, 0)]),
      );
      this.emitFile({
        type: 'asset',
        fileName: 'partitime-cost-attribution.json',
        source: `${JSON.stringify({
          schemaVersion: 'partitime.web-cost-attribution.v2',
          layers,
          modules,
        }, null, 2)}\n`,
      });
    },
  };
}
