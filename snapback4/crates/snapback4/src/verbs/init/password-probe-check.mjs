// Qualify the actual npm probe script, including its process group and store lock.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serveCheck } from "snapback4/proof";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--then" || !args[1].trim())) throw Error("usage: npm run probe:check -- [--then '<command>']");
const directory = mkdtempSync(join(tmpdir(), "snapback4-probe-check-"));
try {
  const report = await serveCheck({ script: "probe:serve", deployment: join(directory, "release"),
    env: { SNAPBACK4_PROBE_DIRECTORY: directory }, ...(args.length ? { then: args[1] } : {}) });
  console.log(JSON.stringify(report));
  process.exitCode = report.commandCode !== undefined && report.commandCode !== 0 ? report.commandCode : report.ok ? 0 : 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
