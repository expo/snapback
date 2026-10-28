// API signatures: snapback4 guide api proof | client | auth | generated
// EDIT REGION: readiness/business setup below; keep guard, hosts and cleanup.
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
  // EDIT REGION: readiness; include sessions for an app harness, keep credentials out of diaries.
  console.log(JSON.stringify({ backendUrl: host.url, credentialsFile, now }));
  // KEEP REGION: referenced lifetime and shutdown.
  await held;
} finally { guard.close(); await host.stop(); }
