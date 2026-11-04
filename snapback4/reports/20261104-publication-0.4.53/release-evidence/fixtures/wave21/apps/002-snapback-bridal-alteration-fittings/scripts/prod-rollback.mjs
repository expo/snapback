// prod:rollback — put the saved v1 backend live in production over whatever
// production holds (including records v2 wrote), without deleting, resetting
// or recreating data or the deployment. Exits 0 when v1 is live. Repeatable
// from either state; stops everything it starts; leaves no server running.
import { rollback } from "snapback4/proof";

const DIR = "./deploy";
const log = (...args) => console.error("[prod:rollback]", ...args);

async function main() {
  const r = await rollback(DIR, 1);
  log(r.stdout.slice(-300));
  if (r.code !== 0) throw new Error(`rollback to v1 failed: ${r.stderr.slice(-1000)}`);
  log("v1 live");
}

main().then(() => process.exit(0), (error) => {
  console.error("[prod:rollback] FAILED:", error?.message ?? error);
  process.exit(1);
});
