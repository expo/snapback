// Qualify the actual npm probe script, including its process group and store lock.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serveCheck } from "snapback4/proof";
const directory = mkdtempSync(join(tmpdir(), "snapback4-probe-check-"));
try {
  const report = await serveCheck({ script: "probe:serve", deployment: join(directory, "release"),
    env: { SNAPBACK4_PROBE_DIRECTORY: directory } });
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
