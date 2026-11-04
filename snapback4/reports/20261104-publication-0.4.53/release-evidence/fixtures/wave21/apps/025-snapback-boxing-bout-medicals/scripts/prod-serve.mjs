// prod:serve — serve production as it stands (whatever release is live;
// never deploys or changes anything) on this machine's ports, ensure two
// real users of every role exist, print one JSON line, stay up until killed.
import { DIR, ROLES, ensureProdUsers, startServe, cleanup } from "./prod-lib.mjs";

const log = (...a) => console.error(...a);
let host;
try {
  host = await startServe(DIR);
} catch (error) {
  log(`prod:serve: cannot serve ${DIR}: ${error?.message ?? error}`);
  process.exit(2);
}
try {
  log(`prod:serve live at ${host.url}`);
  const users = await ensureProdUsers(host.url, await host.operatorToken());
  const pub = {};
  for (const role of ROLES) {
    pub[role] = users[role].map((u) => ({ email: u.email, password: u.password }));
  }
  console.log(JSON.stringify({ backendUrl: host.url, users: pub }));
  await new Promise((resolve) => {
    for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, resolve);
  });
} finally {
  await cleanup(() => host?.stop());
}
