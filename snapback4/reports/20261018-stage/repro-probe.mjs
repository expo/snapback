// Installed only into private copies of the three wave-16 evidence lanes.
import { readFileSync } from "node:fs";
import { deploy, startServe, startStatic, command, cleanup } from "snapback4/proof";
const roles = JSON.parse(readFileSync("stage-roles.json", "utf8"));
let host, web;
const stop = () => cleanup(() => web?.stop(), () => host?.stop());
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
try {
  await deploy("stage-deployment", "snapback", { args: ["--staging"] });
  host = await startServe("stage-deployment", { seedUsers: { roles, provision: { name: "stagingProvision" } } });
  const config = await fetch(host.url + "/auth/config").then(r => r.json());
  if (config.development || config.environment !== "staging") throw Error("serve staging required");
  const post = async (name, account, args) => {
    const response = await fetch(host.url + "/m/" + name, { method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${account.token}`,
    }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (result.state !== "sent") throw Error(`${name}: ${JSON.stringify(result)}`);
    return result.result;
  };
  // Preserve each probe's application data setup through its actual mutations.
  if (roles.applicator) {
    const manager = host.sessions.manager[0];
    await post("addProduct", manager, { name: "OrchardGuard 25W", reiHours: 48, allowsEarlyEntry: true });
    await post("addBlock", manager, { name: "Staging orchard" });
  } else if (roles.researcher) {
    const manager = host.sessions.manager[0];
    const freezer = await post("addFreezer", manager, { name: "Staging freezer" });
    await post("addBox", manager, { freezer: freezer.id, rack: "R1", position: "P1", groupName: "alpha", description: "Staging box", photo: null });
  } else {
    const librarian = host.sessions.librarian[0];
    await post("addInstrument", librarian, { kind: "Violin", serial: "STAGING-1", detail: "Staging instrument" });
    await post("createSeason", librarian, { name: "Staging season", endsAt: Date.now() + 86400000 });
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const build = await command("npm", ["run", pkg.scripts["build:web"] ? "build:web" : "build"], {
    timeoutMs: 300000, env: { VITE_SNAPBACK_URL: host.url, EXPO_PUBLIC_SNAPBACK_URL: host.url },
  });
  if (build.code !== 0) throw Error(`frontend build: ${build.stderr}`);
  web = await startStatic("dist");
  const sessions = Object.fromEntries(Object.entries(host.sessions).map(([role, users]) => [role, users.map(user => ({
    email: user.email, password: user.password, principal: user.principal, token: user.token,
    headers: { Authorization: `Bearer ${user.token}` },
  }))]));
  console.log(JSON.stringify({ backendUrl: host.url, frontendUrl: web.url + "/?api=" + encodeURIComponent(host.url), sessions,
    apiNotes: "Real password sessions on serve staging. POST /q/<op> or /m/<op> with {args} and the user's bearer. No dev seed/persona/clock doors." }));
  await new Promise(() => {});
} catch (error) { console.error(error); await stop(); process.exitCode = 1; }
