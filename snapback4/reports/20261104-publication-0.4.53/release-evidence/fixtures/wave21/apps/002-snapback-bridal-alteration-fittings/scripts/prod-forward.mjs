// prod:forward — move production forward to v2 over whatever it holds,
// without deleting, resetting or recreating data or the deployment. Exits 0
// when v2 is live. Repeatable from either state; stops everything it starts;
// leaves no server running.
import { rollback } from "snapback4/proof";

const DIR = "./deploy";
const log = (...args) => console.error("[prod:forward]", ...args);

async function main() {
  const r = await rollback(DIR, "latest");
  log(r.stdout.slice(-300));
  if (r.code !== 0) throw new Error(`forward to v2 failed: ${r.stderr.slice(-1000)}`);
  log("v2 live");
}

main().then(() => process.exit(0), (error) => {
  console.error("[prod:forward] FAILED:", error?.message ?? error);
  process.exit(1);
});
