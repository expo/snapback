// probe:serve — serve production v2 (without resetting data): make sure v2
// is live, start the production frontend build on this machine's ports, sign
// in two real users of every role (creating them if needed), print one JSON
// line, stay up until killed.
import { existsSync } from "node:fs";
import {
  DIR, ROLES, PASSWORD, ensureProdUsers, fullSnapshot, reconcileLabels,
  deploy, rollback, startServe, startStatic, cleanup, cli, command, post,
} from "./prod-lib.mjs";
import { v1ReleaseId, releasesInfo } from "./prod-targets.mjs";

const log = (...a) => console.error(...a);

if (!existsSync(`${DIR}/store.sqlite`)) {
  log("probe:serve: no production store; deploying v1 then v2 fresh");
  const d1 = await deploy(DIR, "versions/v1");
  if (d1.code !== 0) throw Error(`deploy v1: ${d1.stderr.slice(0, 500)}`);
  const d2 = await deploy(DIR, "snapback");
  if (d2.code !== 0) throw Error(`deploy v2: ${d2.stderr.slice(0, 500)}`);
} else {
  const info = await releasesInfo();
  const v1 = await v1ReleaseId();
  if (info.current !== info.latest) {
    log(`probe:serve: production at ${info.current}, moving forward to latest ${info.latest}`);
    const r = await rollback(DIR, "latest");
    if (r.code !== 0) throw Error(`forward: ${r.stderr.slice(0, 500)}`);
  } else if (info.current === v1 && info.latest === v1) {
    log("probe:serve: only v1 ever deployed; deploying v2 now");
    const d2 = await deploy(DIR, "snapback");
    if (d2.code !== 0) throw Error(`deploy v2: ${d2.stderr.slice(0, 500)}`);
  }
}

const host = await startServe(DIR);
let web = null;
try {
  log(`probe:serve backend at ${host.url}`);
  const users = await ensureProdUsers(host.url, await host.operatorToken());
  const rec = await reconcileLabels(host.url, users.matchmaker[0]);
  log(`probe:serve: labels reconciled: ${rec.corrected} corrected of ${rec.checked} checked`);

  const build = await command("npm", ["run", "build"], { timeoutMs: 300_000 });
  if (build.code !== 0) throw Error(`build failed: ${build.stderr.slice(0, 1000)}`);
  web = await startStatic("dist");
  log(`probe:serve frontend at ${web.url}`);

  const sessions = {};
  for (const role of ROLES) {
    sessions[role] = users[role].map((u) => ({
      email: u.email,
      password: u.password,
      principal: u.principal,
      token: u.token,
      headers: { Authorization: `Bearer ${u.token}` },
    }));
  }
  const snap = await fullSnapshot().catch(() => null);
  console.log(JSON.stringify({
    backendUrl: host.url,
    frontendUrl: `${web.url}/?api=${encodeURIComponent(host.url)}`,
    sessions,
    apiNotes:
      `Production v2 of Boxing Bout Medicals (release evolution over ./deploy, real clock, password sign-in). ` +
      `REST+JSON on backendUrl with Authorization: Bearer <sessions.<role>[i].token>: ` +
      `POST /q/<query> {args} -> {data} or {denied:{code}}; POST /m/<mutation> {args} -> {state:'sent',result} or {state:'failed',why:{code}}. ` +
      `Boxers carry experience 'debut'|'previously competed' beside wins-losses-draws; only role matchmaker may POST /m/setExperience {boxer,experience} (others get NOT_MATCHMAKER); ` +
      `recordResult flips both participants to previously competed when a bout completes. ` +
      `Physician notes + suspension reason stay visible only to physician/inspector. ` +
      `Sign-in: POST /auth/login {email,password} (sessions above carry email+password); ` +
      `the printed frontendUrl already points at this backend via ?api=. ` +
      `${snap ? `Store holds ${snap.boxers.size} boxers, ${snap.bouts.size} bouts, ${snap.exams.size} exams.` : ""}`,
  }));
  await new Promise((resolve) => {
    for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, resolve);
  });
} finally {
  await cleanup(() => web?.stop(), () => host.stop());
}
