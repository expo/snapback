const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

module.exports = ({ config }) => {
  const file = join(__dirname, ".snapback/dev-url");
  const owner = existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
  const snapbackUrl = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? owner;
  // An inherited variable wins the URL, which is how another project's backend
  // gets a silent vote. Say so instead of serving the wrong owner.
  if (owner !== undefined && snapbackUrl !== owner) {
    console.warn(`snapback2: EXPO_PUBLIC_SNAPBACK_URL=${snapbackUrl} overrides this project's owner at ${owner}; unset it to use the local backend.`);
  }
  return { ...config, extra: { ...config.extra, snapbackUrl } };
};
