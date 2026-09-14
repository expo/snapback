// @ref LLP 3000.007#20.2 — Metro must discover the web device's wasm as an asset, including web exports.
const upstream = require("@expo/metro-config/babel-transformer");
module.exports.transform = function (args) {
  // Expo's web asset transformer returns a URL string for wasm. Native
  // selects its native device (or the online tier in Expo Go).
  const src = args.options.platform === "web"
    ? args.src.replace(/new URL\(("\.\/wasm\/snapback4_device_bg\.wasm"), import\.meta\.url\)/g, "require($1)")
    : args.src;
  return upstream.transform({ ...args, src });
};
