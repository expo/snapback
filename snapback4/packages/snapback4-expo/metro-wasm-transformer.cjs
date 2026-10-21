// Metro resolves the consumer's Expo toolchain, including isolated installs.
const { createRequire } = require("node:module");
const { join } = require("node:path");
exports.transform = function (args) {
  const requireApp = createRequire(join(args.options.projectRoot, "package.json"));
  const expoRequire = createRequire(requireApp.resolve("expo/metro-config"));
  const upstream = expoRequire("@expo/metro-config/babel-transformer");
  const src = args.options.platform === "web"
    ? args.src.replace(/new URL\(("\.\/wasm\/snapback4_device_bg\.wasm"), import\.meta\.url\)/g, "require($1)")
    : args.src;
  return upstream.transform({ ...args, src });
};
