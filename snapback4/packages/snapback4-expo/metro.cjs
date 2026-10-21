// @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — Expo owns the wasm transform and runtime-store exclusion.
exports.withSnapback = function (config) {
  return {
    ...config,
    resolver: {
      ...config.resolver,
      unstable_enablePackageExports: true,
      blockList: [].concat(config.resolver?.blockList ?? [], /(?:^|[/\\])\.snapback4(?:[/\\]|$)/),
      assetExts: [...new Set([...(config.resolver?.assetExts ?? []), "wasm"])],
    },
    transformer: { ...config.transformer, babelTransformerPath: require.resolve("./metro-wasm-transformer.cjs") },
  };
};
