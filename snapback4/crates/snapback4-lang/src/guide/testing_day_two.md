
## Day-two proof with production accounts

Run this in a fresh `init --web` starter after installing its dependencies.
Save the block as scripts/day2-accounts.mjs and run `node scripts/day2-accounts.mjs`.
It copies the installed package's complete production recipe (teams and memberships),
compiles and builds that UI, then signs in through its production account form.
The production entry recipe is maintained on `guide production`.
Adapt the assertions to your own business model when replacing this example.

The proof keeps one live serve process and one browser page through v1 → v2 →
rollback → forward. It tests real password accounts, a rendered durable write,
existing-row defaults, a widened title, a new membership, authorization refusals,
and retained rows at every transition. The wider title needs a registered current
guarded rollback view, which also keeps the added member note. Saved sources and
deployments belong to its private scratch directory. It changes the fresh starter's working schema and UI to the
production recipe; run it in a copy when preserving an existing application.

<!-- DAY TWO ACCOUNTS BEGIN -->
```js
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { signup } from "snapback4/auth";
import { withBrowser, command, cli, deploy, rollback, startServe, startStatic,
  fillRN, bounded, renderedText, waitForFresh, waitForServer, cleanup } from "snapback4/proof";

await withBrowser({ executablePath: process.env.CHROME }, async context => {
  // Browser dependency checks happen before building or deploying anything.
  for (const [from, to] of [["schema.q", "snapback/schema.q"], ["App.tsx", "src/App.tsx"], ["client.ts", "src/client.ts"]]) {
    await copyFile(`node_modules/snapback4/dist/recipes/production/web/${from}`, to);
  }
  for (const args of [["check"]]) { const result = await cli(args); assert.equal(result.code, 0, result.stderr); }
  for (const script of ["typecheck", "build"]) {
    const result = await command("npm", ["run", script]); assert.equal(result.code, 0, result.stderr);
  }
  const work = await mkdtemp(join(process.cwd(), ".day2-accounts-"));
  let serve, web;
  try {
    const v1 = join(work, "v1"), v2 = join(work, "v2"), directory = join(work, "deployment");
    await mkdir(v1); await mkdir(v2);
    const base = await readFile("node_modules/snapback4/dist/recipes/production/web/schema.q", "utf8");
    const evolved = base.replace("table members:\n", "table members:\n  note: text <=40 default 'evolved'\n")
      .replaceAll("text 1..80", "text 1..160");
    assert.notEqual(evolved, base);
    await writeFile(join(v1, "schema.q"), base); await writeFile(join(v2, "schema.q"), evolved);
    await deploy(directory, v1);
    serve = await startServe(directory); web = await startStatic("dist");
    const password = "Proof-password-42!", email = `admin-${crypto.randomUUID()}@example.test`;
    const admin = await signup(serve.url, email, password);
    const member = await signup(serve.url, `member-${crypto.randomUUID()}@example.test`, password);
    const outsider = await signup(serve.url, `outsider-${crypto.randomUUID()}@example.test`, password);
    for (const account of [admin, member, outsider]) assert.equal(account.ok, true, JSON.stringify(account));
    const page = await context.newPage();
    await page.goto(`${web.url}/?api=${encodeURIComponent(serve.url)}`, { waitUntil: "domcontentloaded" });
    await fillRN(page.getByLabel("Email", { exact: true }), email);
    await fillRN(page.getByLabel("Password", { exact: true }), password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await waitForFresh(renderedText(page, "Teams and roles"), null);
    assert.equal(await page.getByRole("button", { name: /^Dev:/ }).count(), 0, "serve offers accounts only");
    const title = `Team ${crypto.randomUUID()}`;
    await fillRN(page.getByLabel("Team name", { exact: true }), title);
    const create = page.getByRole("button", { name: "Create team", exact: true });
    await create.evaluate((button, title) => window.__snapback4Witness.beginForm("createTeam", { title }, button), title);
    await create.click();
    const receipt = await bounded(page.evaluate(() => window.__snapback4Witness.formResult()), 30000, "team receipt");
    assert.equal(receipt.state, "sent", JSON.stringify(receipt));
    const teamId = receipt.result.id;
    async function call(account, door, name, args) {
      const response = await fetch(`${serve.url}/${door}/${name}`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${account.session.token}` },
        body: JSON.stringify({ ...(door === "m" ? { id: crypto.randomUUID() } : {}), args }) });
      assert.equal(response.status, 200); return response.json();
    }
    let wideTeamId;
    async function business(label, evolved, joined) {
      const own = await waitForServer(() => call(admin, "q", "myRole", { teamId }), read => read.complete === true, { label });
      assert.equal(own.data.principal, admin.session.principal); assert.equal(own.data.role, "admin");
      assert.equal(own.data.note, evolved ? "evolved" : undefined, label);
      if (wideTeamId) {
        // invite reads the team first: an old narrow schema would hide this team.
        const usable = await call(admin, "m", "invite", { teamId: wideTeamId, principal: member.session.principal, role: "member" });
        assert.equal(usable.state, "sent", `${label}: wider team stays usable: ${JSON.stringify(usable)}`);
      }
      const roster = await call(admin, "q", "roster", { teamId, c: null });
      assert.equal(roster.complete, true); assert.equal(roster.data.length, joined ? 2 : 1, label);
      assert.ok(roster.data.some(row => row.principal === admin.session.principal));
      if (joined) assert.ok(roster.data.some(row => row.principal === member.session.principal));
      assert.equal((await call(outsider, "q", "myRole", { teamId })).denied.code, "NOT_MEMBER", label);
      const refused = await call(outsider, "m", "invite", { teamId, principal: outsider.session.principal, role: "admin" });
      assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "NOT_ADMIN", label);
      await waitForFresh(renderedText(page, new RegExp(teamId), { within: page.locator("main") }), null);
    }
    await business("v1", false, false);
    await deploy(directory, v2);
    const wideTitle = `Team ${"x".repeat(100)}`;
    const wider = await call(admin, "m", "createTeam", { title: wideTitle });
    assert.equal(wider.state, "sent", JSON.stringify(wider));
    assert.equal(wider.result.title, wideTitle);
    wideTeamId = wider.result.id;
    const invited = await call(admin, "m", "invite", { teamId, principal: member.session.principal, role: "member" });
    assert.equal(invited.state, "sent", JSON.stringify(invited));
    await business("v2", true, true);
    // Widening needs a current guarded view; the wider team and added note remain.
    await rollback(directory, 1); await business("rollback-v1", true, true);
    await rollback(directory, "latest"); await business("forward-v2", true, true);
    console.log("day-two accounts passed: v1, hot v2, rollback, forward; business assertions at every step");
  } finally { await cleanup(() => web?.stop(), () => serve?.stop(), () => rm(work, { recursive: true, force: true })); }
});
```
<!-- DAY TWO ACCOUNTS END -->
