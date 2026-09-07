import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  SnapbackRefusal,
  api,
  createClient,
  initialQueryState,
  reduceQueryState,
} from "../dist/client.mjs";
import { configureRealOwner, RealOwnerHarness } from "./owner-harness.ts";

const owner = await configureRealOwner();
after(async () => owner.close());

// @ref LLP 1018#4-move-two-efficient-execution-and-certification-that-agree — maintained cap
// rows must be acquired through ordinary reads; unheld counts are not zero.
test("public count reads enable multi-principal offline cap prediction without inventing missing counts", async (t) => {
  if (!owner.owned) return t.skip("requires an isolated self-started count owner");
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const previousUrl = process.env.SNAPBACK_URL;
  delete process.env.SNAPBACK_URL;
  const directory = await mkdtemp(join(tmpdir(), "snapback-public-counts-"));
  const fixture = join(directory, "source");
  let local: RealOwnerHarness | undefined;
  const clients: ReturnType<typeof createClient>[] = [];
  try {
    await mkdir(fixture);
    await writeFile(join(fixture, "schema.q"), `use identity

table capEntries:
  principal: principal
  author: principal
  by byPrincipal: principal, id
  cap 3 by principal
  read <- allow
  insert <- .author = viewer
  update <- deny
  delete <- deny

maintain principalCounts = count capEntries by principal:
  read <- allow
`);
    await writeFile(join(fixture, "caps.q"), `query countFor(principal: principal):
  return #principalCounts[principal]

query entriesFor(principal: principal):
  return capEntries[principal] first 50 by byPrincipal

mutation allocate(principals: [principal] <=49):
  for principal in principals:
    insert capEntries { principal, author: viewer }
  return null
`);
    const sizes = { heldA: 1, heldB: 1, unheldA: 1, unheldB: 1, rollbackA: 1, full: 3 };
    const rows = Object.entries(sizes).flatMap(([principal, size]) => Array.from({ length: size }, (_, index) => ({
      id: `${principal}-${index}`, principal: `dev:${principal}`, author: "dev:alice",
    })));
    await writeFile(join(fixture, "seed.ts"), `import { seed } from 'snapback2';\nexport default seed(${JSON.stringify({ personas: ["alice"], rows: { capEntries: rows } })});\n`);
    local = await RealOwnerHarness.create({ fixture });
    const observer = createClient({ url: local.url, as: "alice" });
    clients.push(observer);
    const count = async (client: ReturnType<typeof createClient>, principal: string) => {
      const result: any = await client.query(api.caps.countFor, { principal: `dev:${principal}` });
      assert.equal(result.state, "complete", JSON.stringify(result));
      return result.data;
    };
    const scenarios = [
      { name: "held", principals: ["heldA", "heldB"], hold: ["heldA", "heldB"], predicted: true, final: [2, 2] },
      { name: "unheld", principals: ["unheldA", "unheldB"], hold: ["unheldA"], predicted: false, final: [2, 2] },
      // A cached zero is still a scalar answer. It does not prove absence at
      // both the canonical ID and unique group address for cap prediction.
      { name: "zero", principals: ["zero"], hold: ["zero"], predicted: false, final: [1] },
      { name: "overflow", principals: ["rollbackA", "full"], hold: ["rollbackA", "full"], predicted: false, final: [1, 3] },
    ];
    for (const scenario of scenarios) {
      const reads: any[] = [];
      let mutations = 0;
      let client = createClient({ url: local.url, offline: { store: fileRangeStore(join(directory, scenario.name)) },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const path = new URL(String(input)).pathname;
          if (path === "/api/query") reads.push(await response.clone().json());
          if (path === "/api/mutation") mutations++;
          return response;
        } });
      clients.push(client);
      await client.ready;
      await client.auth.guest();
      const before = await Promise.all(scenario.hold.map(principal => count(client, principal)));
      await client.online();
      const readiness = await client.outbox.status(api.caps.allocate);
      assert.equal(readiness.ready, true, JSON.stringify(readiness));
      assert.ok(reads.every(read => (read.rows ?? []).every((row: any) => row.table !== "capEntries")), "count queries did not preload source rows");
      if (scenario.name === "zero") {
        assert.deepEqual(before, [0], "the owner proved zero through the public count query");
        t.diagnostic(`zero public query receipt: ${JSON.stringify(reads)}`);
      }
      await client.offline();
      const readsBeforeReopen = reads.length;
      client = await client.restart();
      clients.push(client);
      if (scenario.name === "zero") {
        const cold = await client.query(api.caps.countFor, { principal: "dev:zero" });
        assert.equal(cold.state, "complete", "the delivered scalar answer remains cached");
        assert.equal(cold.data, 0);
        assert.equal(cold.live, false);
        assert.ok(cold.stale, "a cached zero is a stale answer, not new group-absence authority");
      } else {
        assert.deepEqual(await Promise.all(scenario.hold.map(principal => count(client, principal))), before,
          "held count rows remain complete after a cold offline carrier reopen");
      }
      assert.equal(reads.length, readsBeforeReopen, "cold held counts do not reacquire network evidence");
      const queued = await client.mutation(api.caps.allocate, { principals: scenario.principals.map(principal => `dev:${principal}`) });
      assert.equal(queued.state, "queued");
      assert.equal(mutations, 0, "offline allocation sends no mutation bytes");
      const [entry] = await client.outbox.entries();
      assert.equal(entry.predicted === true, scenario.predicted, `${scenario.name}: ${JSON.stringify(entry)}`);
      if (!scenario.predicted) assert.deepEqual(entry.trace, { points: [], verdicts: [] });
      if (scenario.predicted) {
        for (let index = 0; index < scenario.principals.length; index++) {
          assert.equal(await count(client, scenario.principals[index]), scenario.final[index], "held count advances in the offline overlay");
        }
      }
      await client.online();
      assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
      const [settled] = await client.outbox.entries();
      assert.equal(settled.state, scenario.name === "overflow" ? "rejected" : "committed");
      if (scenario.name === "overflow") assert.equal((settled.response as any).code, "E_CONSTRAINT");
      const actual = await Promise.all(scenario.principals.map(principal => count(observer, principal)));
      assert.deepEqual(actual, scenario.final, "owner counts prove complete commit or atomic rollback");
      t.diagnostic(`${scenario.name}: ${JSON.stringify({ before, predicted: entry.predicted === true, trace: entry.trace, state: settled.state, final: actual })}`);
      await client.close();
    }
  } finally {
    for (const client of clients) await client.close();
    await local?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
    else process.env.SNAPBACK_URL = previousUrl;
  }
});
