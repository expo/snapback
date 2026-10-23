
## Day-two proof with production accounts

Run this in a fresh `init --web` starter after installing its dependencies.
Save the block as scripts/day2-accounts.mjs and run `node scripts/day2-accounts.mjs`.
It copies the installed package's complete production recipe (teams and memberships),
compiles and builds that UI, then signs in through its production account form.
The production entry recipe is maintained on `guide production`.
Adapt the assertions to your own business model when replacing this example.

The proof keeps one live serve process and one browser page through v1 → v2 →
rollback → forward. It tests real password accounts, a rendered durable write,
existing-row defaults, a new membership, authorization refusals, and retained
rows at every transition. Saved sources and deployments belong to its private
scratch directory. It changes the fresh starter's working schema and UI to the
production recipe; run it in a copy when preserving an existing application.
Stage comparisons key rows by stable ids and compare only fields shared by the
two releases. They exclude ids created by the frozen v1 client because those
are new test data, allow a v2-native id to be dormant during exact-v1 rollback,
and require that v2-native row again after forwarding.

<!-- DAY TWO ACCOUNTS BEGIN -->
```js
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { signup } from "snapback4/auth";
import { withBrowser, command, cli, deploy, rollback, startServe, startStatic,
  fillRN, bounded, renderedText, waitForFresh, waitForServer, exhaustPages, cleanup } from "snapback4/proof";

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
    const v1Source = join(work, "v1"), v2Source = join(work, "v2"), directory = join(work, "deployment");
    await mkdir(v1Source); await mkdir(v2Source);
    const base = await readFile("node_modules/snapback4/dist/recipes/production/web/schema.q", "utf8");
    const evolved = base.replace("table members:\n", "table members:\n  note: text <=40 default 'evolved'\n");
    assert.notEqual(evolved, base);
    await writeFile(join(v1Source, "schema.q"), base); await writeFile(join(v2Source, "schema.q"), evolved);
    await deploy(directory, v1Source);
    serve = await startServe(directory); web = await startStatic("dist");
    const password = "Proof-password-42!", email = `admin-${crypto.randomUUID()}@example.test`;
    const admin = await signup(serve.url, email, password);
    const member = await signup(serve.url, `member-${crypto.randomUUID()}@example.test`, password);
    const native = await signup(serve.url, `native-${crypto.randomUUID()}@example.test`, password);
    const outsider = await signup(serve.url, `outsider-${crypto.randomUUID()}@example.test`, password);
    for (const account of [admin, member, native, outsider]) assert.equal(account.ok, true, JSON.stringify(account));
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
    const stable = row => ({ id: row.id, principal: row.principal, role: row.role });
    const byId = rows => new Map(rows.map(row => [row.id, stable(row)]));
    function compareById(label, expected, actualRows, { exclude = new Set(), optional = new Set() } = {}) {
      const actual = byId(actualRows);
      for (const [id, row] of expected) {
        if (exclude.has(id)) continue;
        if (!actual.has(id)) { assert.ok(optional.has(id), `${label}: missing ${id}`); continue; }
        assert.deepEqual(actual.get(id), row, `${label}: ${id}`);
      }
      for (const id of actual.keys()) {
        if (exclude.has(id)) continue;
        assert.ok(expected.has(id), `${label}: unexpected ${id}`);
      }
    }
    async function business(label, evolved, requiredPrincipals = []) {
      const own = await waitForServer(() => call(admin, "q", "myRole", { teamId }), read => read.complete === true, { label });
      assert.equal(own.data.principal, admin.session.principal); assert.equal(own.data.role, "admin");
      assert.equal(own.data.note, evolved ? "evolved" : undefined, label);
      const roster = await exhaustPages(c => call(admin, "q", "roster", { teamId, c }), { label: `${label} roster` });
      assert.ok(roster.some(row => row.principal === admin.session.principal));
      for (const principal of requiredPrincipals) assert.ok(roster.some(row => row.principal === principal), `${label}: missing ${principal}`);
      assert.equal((await call(outsider, "q", "myRole", { teamId })).denied.code, "NOT_MEMBER", label);
      const refused = await call(outsider, "m", "invite", { teamId, principal: outsider.session.principal, role: "admin" });
      assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "NOT_ADMIN", label);
      await waitForFresh(renderedText(page, new RegExp(teamId), { within: page.locator("main") }), null);
      return roster;
    }
    const v1 = byId(await business("v1", false));
    await deploy(directory, v2Source);
    await page.getByRole("button", { name: `${teamId} · admin`, exact: true }).click();
    await waitForFresh(renderedText(page, "Your role: admin"), null);
    await fillRN(page.getByLabel("Principal", { exact: true }), member.session.principal);
    const invite = page.getByRole("button", { name: "Invite", exact: true });
    await invite.evaluate((button, args) => window.__snapback4Witness.beginForm("invite", args, button), { teamId, principal: member.session.principal, role: "member" });
    await invite.click();
    const v1Write = await bounded(page.evaluate(() => window.__snapback4Witness.formResult()), 30000, "frozen-v1 invite receipt");
    assert.equal(v1Write.state, "sent", JSON.stringify(v1Write));
    const v1ClientWrites = new Set([v1Write.result.id]);
    const nativeInvite = await call(admin, "m", "invite", { teamId, principal: native.session.principal, role: "member" });
    assert.equal(nativeInvite.state, "sent", JSON.stringify(nativeInvite));
    const v2Native = new Set([nativeInvite.result.id]);
    const v2Rows = await business("v2", true, [member.session.principal, native.session.principal]), v2 = byId(v2Rows);
    compareById("v2 preserves v1", v1, v2Rows, { exclude: new Set([...v1ClientWrites, ...v2Native]) });
    await rollback(directory, 1);
    const rolledBack = await business("rollback-v1", false);
    compareById("rollback preserves v1", v1, rolledBack, { exclude: new Set([...v1ClientWrites, ...v2Native]) });
    compareById("rollback tolerates v2-native rows", v2, rolledBack, { exclude: v1ClientWrites, optional: v2Native });
    await rollback(directory, "latest");
    const forwarded = await business("forward-v2", true, [native.session.principal]);
    compareById("forward restores v2", v2, forwarded, { exclude: v1ClientWrites });
    console.log("day-two accounts passed: v1, hot v2, rollback, forward; business assertions at every step");
  } finally { await cleanup(() => web?.stop(), () => serve?.stop(), () => rm(work, { recursive: true, force: true })); }
});
```
<!-- DAY TWO ACCOUNTS END -->
