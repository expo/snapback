import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Execute the same guide-boundary witnesses against the qualification's exact packs.
export function proveRules(client, platform, directory) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync(process.execPath, ["--test", join(root, "packages/snapback4/test/wave14-rule-recipes.test.mjs")], {
    cwd: root, encoding: "utf8", timeout: 360_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SNAPBACK4_RULES_CLIENT_TARBALL: resolve(client), SNAPBACK4_RULES_PLATFORM_TARBALL: resolve(platform) },
  });
  const log = join(directory, "rule-recipes.log");
  writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.status !== 0) throw Error(`packed rule recipes failed: ${result.error?.message ?? result.status}; see ${log}`);
  return { status: "passed", log, client: resolve(client), platform: resolve(platform) };
}
