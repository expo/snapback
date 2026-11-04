// prod:forward — move production forward to v2 again over whatever
// production holds (including records v1 wrote), without deleting, resetting
// or recreating data or the deployment. Reconciles experience labels
// afterwards so bouts completed while v1 was live come back correct.
// Exits 0 when v2 is live. Works repeatedly and from either state.
import { DIR, rollback, startServe, ensureProdUsers, reconcileLabels, cleanup } from "./prod-lib.mjs";
import { releasesInfo } from "./prod-targets.mjs";

const log = (...a) => console.error(...a);
const before = await releasesInfo().catch(() => null);
if (before) log(`before: current=${before.current} latest=${before.latest} generation=${before.generation}`);
const r = await rollback(DIR, "latest");
if (r.code !== 0) {
  log(`prod:forward failed: ${r.stderr.slice(0, 1000)}`);
  process.exit(1);
}
log(r.stdout.slice(-300));
let after = await releasesInfo();
log(`after: current=${after.current} latest=${after.latest} generation=${after.generation}`);
if (after.current !== after.latest) {
  log(`prod:forward: expected current=${after.latest}, got ${after.current}`);
  process.exit(1);
}
// Self-healing: brief serve to reconcile labels written during v1 windows.
let host = null;
try {
  host = await startServe(DIR);
  const users = await ensureProdUsers(host.url, await host.operatorToken());
  const rec = await reconcileLabels(host.url, users.matchmaker[0]);
  log(`prod:forward: labels reconciled: ${rec.corrected} corrected of ${rec.checked} checked`);
} finally {
  await cleanup(() => host?.stop());
}
log("prod:forward: v2 live");
