// Entry shim: exactVitePlugin's served-app build needs a subdir entry
// (a root-level /main.ts can't locate its route registry). The real boot is
// one level up.
//
// Keep a literal Exact app metadata call in this entry for the static exporter.
// The runtime mount path is still the Contract renderer in ../main.ts, but the
// exporter scans this metadata for the web <title> and native shell envelope.
// @ref LLP 0017#static-bundling-and-the-native-shell - the static web/native
// artifacts need app-level metadata, not only route screen metadata.
function createApp<T extends Record<string, unknown>>(config: T): T {
  return config;
}

createApp({
  title: 'Snapback Admin Console',
  themeColor: '#5e6ad2',
  viewport: {
    initialScale: 1,
    width: 'device-width',
  },
});

import '../main.ts';
