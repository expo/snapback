// prod:rollback — put the saved v1 backend live in production over whatever
// production holds (including records v2 wrote), without deleting, resetting
// or recreating data or the deployment. Exits 0 when v1 is live.
import { DIR, rollback, cleanup, cli } from "./prod-lib.mjs";
import { v1ReleaseId, releasesInfo } from "./prod-targets.mjs";

const log = (...a) => console.error(...a);
const target = await v1ReleaseId();
log(`prod:rollback target: release ${target}`);
const before = await releasesInfo().catch(() => null);
if (before) log(`before: current=${before.current} latest=${before.latest} generation=${before.generation}`);
const r = await rollback(DIR, target);
if (r.code !== 0) {
  log(`prod:rollback failed: ${r.stderr.slice(0, 1000)}`);
  process.exit(1);
}
log(r.stdout.slice(-300));
const after = await releasesInfo();
log(`after: current=${after.current} latest=${after.latest} generation=${after.generation}`);
if (after.current !== target) {
  log(`prod:rollback: expected current=${target}, got ${after.current}`);
  process.exit(1);
}
log("prod:rollback: v1 live");
await cleanup(() => {});
