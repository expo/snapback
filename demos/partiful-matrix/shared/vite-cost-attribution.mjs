// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — every web
// cell emits the same CI-diffable four-layer module ledger. The ledger is a
// build asset, not executable client code, and its classifications are based
// on stable repository/package boundaries rather than minifier symbol names.

const normalized = (id) => id.replaceAll('\\', '/');

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
          id: normalized(id),
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
