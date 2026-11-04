// prod:serve — serve production AS IT STANDS (whatever release is live; never
// deploys or changes anything) for the v1 client to call. Ensures two real
// users per role exist via the real sign-up path, prints ONE JSON line to
// stdout {backendUrl, users}, stays up until SIGTERM/SIGINT. All else stderr.
import { startServe, cleanup } from "snapback4/proof";
import { ensureProdUsers } from "./prod-users.mjs";

const DIR = "./deploy";
const log = (...args) => console.error("[prod:serve]", ...args);

async function main() {
  const host = await startServe(DIR);
  const stopAll = [() => host.stop()];
  try {
    const url = host.url;
    log("production", url);
    const users = await ensureProdUsers(url, await host.operatorToken());
    const out = {
      backendUrl: url,
      users: Object.fromEntries(
        Object.entries(users).map(([role, accounts]) => [
          role,
          accounts.map((a) => ({ email: a.email, password: a.password, principal: a.principal })),
        ]),
      ),
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    await new Promise((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  } finally {
    await cleanup(...stopAll);
  }
}

main().then(() => process.exit(0), (error) => {
  console.error("[prod:serve] FAILED:", error?.message ?? error);
  process.exit(1);
});
