// @ref LLP 0317.000#wave-3--prevention-re-sized-2026-08-28-no-longer-the-bulk —
// Keep the Babel config in CommonJS while package.json places .js files in
// ESM scope, so Expo Router conversions can extend it without breaking Metro.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
