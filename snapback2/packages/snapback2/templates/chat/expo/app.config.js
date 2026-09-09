const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

module.exports = ({ config }) => {
  const file = join(__dirname, ".snapback/dev-url");
  const snapbackUrl = process.env.EXPO_PUBLIC_SNAPBACK_URL
    ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : undefined);
  return { ...config, extra: { ...config.extra, snapbackUrl } };
};
