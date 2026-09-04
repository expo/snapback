import { createServer, request as proxyRequest } from "node:http";
import { cp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { binary, project, workspace, run, dist } from "../expo-project.mjs";

export async function ownerHarness(port) {
  await cp(resolve(workspace, "scripts/witness-expo/expiry.q"), resolve(project, "snapback/witness.q"));
  let url, replay503 = false, injected = 0, fresh = true;
  const replays = [];
  const server = createServer((incoming, outgoing) => {
    if (!url) { outgoing.writeHead(503); outgoing.end(); return; }
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks);
      const mutation = incoming.url === "/api/mutation" ? JSON.parse(body.toString() || "{}") : undefined;
      if (mutation?.replay) replays.push(mutation);
      const upstream = proxyRequest(new URL(incoming.url, url), { method: incoming.method, headers: incoming.headers }, (response) => {
        // Injection is host-side, after the owner's COMMIT response. The app's
        // fetch remains real Expo fetch; an SSE response still streams normally.
        if (replay503 && mutation?.replay && response.statusCode === 200) {
          replay503 = false; injected++;
          response.resume(); response.on("end", () => { outgoing.writeHead(503); outgoing.end("injected after owner commit"); });
        } else { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); }
      });
      upstream.on("error", () => { outgoing.writeHead(503); outgoing.end("owner stopped"); });
      outgoing.on("close", () => upstream.destroy());
      upstream.end(body);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const start = async () => {
    if (fresh) {
      // This is the harness's dedicated generated project. A scheduled retry
      // starts with its seed, not an interrupted earlier run's messages.
      await run(binary, ["dev", "--project", project, "--stop", "--json"]).catch((error) => {
        if (!String(error).includes('"code":"E_OWNER_NOT_RUNNING"')) throw error;
      });
      await rm(resolve(project, ".snapback"), { recursive: true, force: true });
      fresh = false;
    }
    await run(binary, ["dev", "--project", project, "--json"]);
    const info = JSON.parse(await readFile(resolve(project, ".snapback/owner.json"), "utf8"));
    url = info.url;
    return info;
  };
  const stop = async () => { await run(binary, ["dev", "--project", project, "--stop", "--json"]); url = undefined; };
  return { url: `http://127.0.0.1:${port}`, start, stop, get directUrl() { return url; }, replays,
    inject503() { replay503 = true; }, get injected() { return injected; },
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await stop().catch(() => {}); } };
}

export async function seedWitness(url) {
  const { createClient, api } = await import(resolve(dist, "client.mjs"));
  const alice = createClient({ url, as: "alice" });
  const committed = (result) => { if (result.state !== "committed") throw new Error(JSON.stringify(result)); return result.data; };
  try {
    const rooms = ["conversation-1", "conversation-2"];
    for (const title of ["Third opened room", "Never opened room"]) rooms.push(committed(await alice.mutation(api.groups.groupCreate, { title, members: ["dev:bob"] })).id);
    for (const conversationId of rooms) committed(await alice.mutation(api.deliveries.post, { conversationId, body: `witness seed ${conversationId}` }));
    const doomed = committed(await alice.mutation(api.deliveries.post, { conversationId: rooms[0], body: "expires while offline" })).id;
    // The fixture is a real PNG; upload is byte-backed on the host, as on the web witness.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const assets = [], once = [];
    for (let index = 0; index < 2; index++) {
      const photo = await alice.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
      const message = committed(await alice.mutation(api.messages.sendPhoto, { conversationId: rooms[0], photo }));
      assets.push(photo);
      if (index === 1) once.push(message.id);
    }
    return { rooms, doomed, assets, once };
  } finally { await alice.close(); }
}
