import { journey } from "snapback2/test";
// These imports inspect only this isolated test owner's control credential;
// it is never printed, retained in evidence, or copied into application code.
// @ts-ignore -- the journey runs under Node.
import { readFile } from "node:fs/promises";
// @ts-ignore -- the journey runs under Node.
import { dirname, resolve } from "node:path";
// @ts-ignore -- the journey runs under Node.
import { fileURLToPath } from "node:url";

const periodStart = 2_100_000_000_000;
const periodMs = 120_000;

// Use with the retained compressed static seed and owner-hub.q in a copied app. No SDK client or
// subscription is attached; only the owner's schedule can enqueue the digest.
journey("recipient digest emits exactly at 100 groups 900 DMs and 500 follows", async ({ url, tick }) => {
  const ownerPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  const control = async (path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-snapback-control": owner.secret },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok && result.state !== "rejected") throw new Error(`${path}: ${JSON.stringify(result)}`);
    return result;
  };
  const setup = await control("/control/job", { name: "hub.populate", args: { periodStart }, as: "system" });
  for (;;) {
    const state = await control(`/control/job/${setup.id}`);
    if (state.state === "done") break;
    if (state.state === "parked" || state.state === "cancelled") throw new Error(`hub population: ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // The operator transport explicitly executes this write as the hub persona,
  // preserving the application's client rules as well as its storage cap.
  const overflow = await control("/control/execute", {
    op: "groups.groupCreate", as: "u0001", args: {
      conversationId: "hub-overflow", title: "Membership 1001", members: ["dev:hubpeer0"],
    },
  });
  if (overflow.state !== "rejected" || overflow.code !== "E_CONSTRAINT") {
    throw new Error(`membership 1001 did not hit the data cap: ${JSON.stringify(overflow)}`);
  }
  const clock = await tick(0);
  await tick(periodStart + periodMs + 1000 - Date.now() - Number(clock.offsetMs ?? 0));
  const readDigests = async () => (await control("/control/data", {
    table: "digests", index: "byPrincipalPeriod", prefix: ["dev:u0001"], limit: 10, as: "system",
  })).data as Array<Record<string, unknown>>;
  let rows: Array<Record<string, unknown>> = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    rows = (await readDigests()).filter((row) => row.periodStart === periodStart);
    if (rows.length !== 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (rows.length !== 1) throw new Error(`expected one hub digest, found ${JSON.stringify(rows)}`);
  const digest = rows[0]!;
  for (const [field, expected] of Object.entries({
    periodStart, periodEnd: periodStart + periodMs, newFollowers: 1,
    newPostsInFollowing: 500, unreadMessages: 1000, unreadChats: 1000,
  })) {
    if (digest[field] !== expected) throw new Error(`${field}: ${JSON.stringify(digest[field])}, expected ${expected}`);
  }
  if ((await readDigests()).filter((row) => row.periodStart === periodStart).length !== 1) {
    throw new Error("hub's period receipt changed on observation");
  }
});
