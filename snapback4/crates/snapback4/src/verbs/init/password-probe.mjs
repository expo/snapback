// API signatures: snapback4 guide api proof | client | auth | generated
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeServeGuard, serveUntilSignal } from "snapback4/proof";
import { startStaging } from "./staging.mjs";

const guard = probeServeGuard(); // announce/refuse before any deploy
const host = await startStaging({ directory: process.env.SNAPBACK4_PROBE_DIRECTORY });
try {
  const credentialsFile = join(host.directory, `users-${randomUUID()}.json`);
  writeFileSync(credentialsFile, JSON.stringify(host.sessions), { flag: "wx", mode: 0o600 });
  // Sample this clock for time arguments, including after staging advances.
  const now = await host.now();
  const held = serveUntilSignal([host]);
  console.log(JSON.stringify({ backendUrl: host.url, credentialsFile, now }));
  await held;
} finally { guard.close(); await host.stop(); }
