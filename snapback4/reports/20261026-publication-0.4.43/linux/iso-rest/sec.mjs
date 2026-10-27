// Flake rule step 1 (linux-4 red): proveSecurity alone on linux-4's packed bytes (Mac client/Expo at 6f3ef3b0d0 + repacked production binary).
import { proveSecurity } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-security.mjs";
import { mkdirSync } from "node:fs";
const [client, tarball, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const t = Date.now();
try { const r = await proveSecurity(client, tarball, out); console.log(`ISO-SEC PASSED ${(Date.now()-t)/1000}s starters=${JSON.stringify(r.starters?.map(s=>s.id))}`); }
catch (e) { console.log(`ISO-SEC FAILED ${(Date.now()-t)/1000}s ${String(e.stack).split("\n").slice(0,3).join(" | ")}`); process.exitCode = 1; }
