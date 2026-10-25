import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serveUntilSignal } from "snapback4/proof";
import { startStaging } from "./staging.mjs";

const host = await startStaging();
try {
  const credentialsFile = join(host.directory, "users.json");
  writeFileSync(credentialsFile, JSON.stringify(host.sessions), { flag: "wx", mode: 0o600 });
  // Sample this clock for time arguments, including after staging advances.
  const now = await host.now();
  const held = serveUntilSignal([host]);
  console.log(JSON.stringify({ backendUrl: host.url, credentialsFile, now }));
  await held;
} finally { await host.stop(); }
