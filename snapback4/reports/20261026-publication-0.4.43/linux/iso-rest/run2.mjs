// Diagnostic only (determinism repeat): dx8, staging and starters alone once more on the same bytes.
// binary), (1) the DX7 old-CLI upgrade proof alone x2 with its upgrade transcript printed, then (2) every consumer proof
// linux-1 never reached after proveDX7 threw, in qualify-linux.mjs order, each isolated by try/catch.
import { proveDX7Upgrades } from "/home/ccheever/sb4-pub-0443-kit/iso-rest/dx7-upgrade-diag.mjs";
import { proveDX7 } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-dx7.mjs";
import { proveDX8 } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-dx8.mjs";
import { proveDX5 } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-dx5.mjs";
import { proveExpoUpgrades } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-regressions.mjs";
import { proveDay4 } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-day4.mjs";
import { proveReleaseTransitions } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-release-transitions.mjs";
import { proveDormant } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-dormant.mjs";
import { proveDay5 } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-day5.mjs";
import { proveProduction } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-production.mjs";
import { proveProofKit } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-proof-kit.mjs";
import { proveClientRecipes } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-client-recipes.mjs";
import { proveSecurity } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-security.mjs";
import { proveMigrations } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-migrations.mjs";
import { proveStaging } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-staging.mjs";
import { proveRules } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-rules.mjs";
import { proveGeneratedProofs } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-frontend-proofs.mjs";
import { proveStarters } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-starters.mjs";
import { validateStarterProofs } from "/home/ccheever/sb4-pub-0441/snapback4/scripts/publication-artifacts.mjs";
import { writeFileSync } from "node:fs";
const [client, tarball, expo, out, day2] = process.argv.slice(2);
const results = {};
const steps = [["dx8-2", () => proveDX8(day2, client, tarball)], ["staging-2", () => proveStaging(client, tarball, out)], ["starters-2", async () => { const r = await proveStarters(client, tarball, expo, out); validateStarterProofs(r); return r; }]];
const unused = [
  ["dx7", () => proveDX7(day2, client, tarball)],
  ["dx8", () => proveDX8(day2, client, tarball)], ["dx5", () => proveDX5(day2, client, tarball, expo)],
  ["regressions", () => proveExpoUpgrades(client, tarball, expo, out)], ["day4", () => proveDay4(day2)],
  ["release-transitions", () => proveReleaseTransitions(day2)], ["dormant", () => proveDormant(day2)], ["day5", () => proveDay5(day2)],
  ["production", () => proveProduction(client, tarball, expo, out)], ["proof-kit", () => proveProofKit(client, tarball, out)],
  ["client-recipes", () => proveClientRecipes(client, tarball, out)], ["security", () => proveSecurity(client, tarball, out)],
  ["migrations", () => proveMigrations(client, tarball, out)], ["staging", () => proveStaging(client, tarball, out)],
  ["rules", () => proveRules(client, tarball, out)], ["frontend", () => proveGeneratedProofs(client, tarball, expo, out)],
  ["starters", async () => { const r = await proveStarters(client, tarball, expo, out); validateStarterProofs(r); return r; }]];
for (const [name, f] of steps) {
  const t = Date.now();
  try { const r = await f(); results[name] = { ok: true, seconds: (Date.now() - t) / 1000 }; writeFileSync(`${out}/${name}.json`, JSON.stringify(r, null, 2)); console.log(`ISO-REST ${name} PASSED ${(Date.now() - t) / 1000}s`); }
  catch (e) { results[name] = { ok: false, seconds: (Date.now() - t) / 1000, error: String(e.stack).slice(0, 2000) }; console.log(`ISO-REST ${name} FAILED ${(Date.now() - t) / 1000}s ${String(e.stack).split("\n").slice(0, 4).join(" | ")}`); }
  writeFileSync(`${out}/results-2.json`, JSON.stringify(results, null, 2));
}
