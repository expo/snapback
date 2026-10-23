import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runToolchainCommand } from "./publication-starters.mjs";
import { chromiumExecutable } from "../witness/lib.mjs";

export async function proveDX8Ergonomics(directory, client, platform) {
  const parent = resolve(directory), scratch = mkdtempSync(join(parent, "dx8-ergonomics-"));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const env = { ...process.env, CHROME: chromiumExecutable() };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  try {
    writeFileSync(join(scratch, "consumer.mjs"), readFileSync(join(root, "scripts/dx8-ergonomics-consumer.mjs")));
    await runToolchainCommand(process.execPath, ["consumer.mjs"], { cwd: scratch, env, timeout: 300_000 });
    return {
      status: "passed", installedSDK: true, client: resolve(client), platform: resolve(platform),
      dayTwo: "stable ids with v1-write exclusion and optional rollback-only v2-native rows",
      text: "null defaults and lane-031 full line in a scrollable RN-style root",
      paging: "opaque cursor exhaustion and terminal completeness",
      starters: "newest-first board lists", rules: "independent mutation intent and table authority",
    };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
