// The same published helper an application builder imports. No gated fetch,
// store close/reopen substitute, or benchmark-specific receipt schema.
import * as SecureStore from "expo-secure-store";
import { isReady, type Client, type Write } from "snapback4/contract";
import type { Witness } from "snapback4-expo/witness";
import { api } from "../../chat/snapback/generated/api";
import { openClient, tier, url } from "./client";

const key = "snapback4.witness.plan";
interface Plan { conversationId: string; bodies: string[]; writes: string[] }
const assert: (ok: unknown, message: string) => asserts ok = (ok, message) => { if (!ok) throw new Error(message); };
const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + 100_000;
  for (;;) {
    const value = await read(); if (value !== null) return value;
    if (Date.now() > end) throw new Error("chat witness observation timed out");
    await pause();
  }
}

export async function runWitness(w: Witness, ready: (client: Client, conversationId: string) => void, status: (text: string) => void): Promise<void> {
  assert(tier === "native", "the witness requires the native device");
  status(`Witness ${w.segment}: opening`);
  if (w.segment === "prime") {
    await w.step("primed", async () => {
      const started = Date.now();
      const conversationId = `w${started}`;
      const plan: Plan = { conversationId, bodies: [`offline first ${started}`, `offline second ${started}`], writes: [] };
      const seed = [
        { table: "conversations", row: { id: conversationId, title: "Simulator witness", creatorId: "dev:alice" } },
        { table: "memberships", row: { id: `${conversationId}a`, conversationId, principal: "dev:alice", role: "admin", joinedAt: 1 } },
        { table: "memberships", row: { id: `${conversationId}b`, conversationId, principal: "dev:bob", role: "member", joinedAt: 2 } },
        ...Array.from({ length: 300 }, (_, n) => ({ table: "messages", row: {
          id: `${conversationId}s${n}`, conversationId, authorId: n % 2 ? "dev:alice" : "dev:bob",
          body: `history ${n}`, at: 1_700_000_000_000 + n, editedAt: null, photo: null,
        } })),
      ];
      const response = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify(seed) });
      const result = await response.json();
      assert(response.ok && result.seeded === 303, `seed refused: ${JSON.stringify(result)}`);
      await SecureStore.setItemAsync(key, JSON.stringify(plan));
      const client = await openClient({ persona: "bob" });
      ready(client, conversationId);
      const r = await client.query(api.thread, { conversationId });
      assert(isReady(r) && r.fresh && r.data.length === 50, "prime did not acquire history");
      await pause(750); // Let the same query render on the real chat screen.
      await w.receipt({ event: "primed", rows: r.data.length, seeded: 303, ms: Date.now() - started, conversationId });
    });
    return; // The driver terminates the process; the store stays open until then.
  }
  const stored = await SecureStore.getItemAsync(key);
  assert(stored, "run with --prime before the offline witness");
  const plan: Plan = JSON.parse(stored);
  const started = Date.now();
  const client = await openClient({ persona: "bob" });
  ready(client, plan.conversationId);
  const sent: Extract<Write, { state: "sent" }>[] = [];
  let failed: unknown;
  const off = client.onWrite(write => {
    if (!plan.writes.includes(write.id)) return;
    if (write.state === "failed") failed = write;
    else sent.push(write);
    void w.receipt({ event: "settlement", write });
  });
  try {
    await w.step("history", async () => {
      const r = await client.query(api.thread, { conversationId: plan.conversationId });
      assert(client.link() === "offline" && isReady(r) && !r.fresh && r.data.length === 50, "cold history was not readable offline");
      status(`Cold offline: ${r.data.length} history rows`);
      await pause(750);
      await w.receipt({ event: "cold-history", rows: r.data.length, fresh: r.fresh, link: client.link(), ms: Date.now() - started });
    });
    const relaunched = plan.writes.length === 2;
    const milestone = w.segment === "restart" && !relaunched ? "relaunch" : "offline-done";
    await w.step(milestone, async () => {
      if (!relaunched) {
        for (const body of plan.bodies) {
          const write = await client.mutate(api.send, { conversationId: plan.conversationId, body });
          assert(write.state === "pending", `offline send was ${write.state}`);
          plan.writes.push(write.id);
          await SecureStore.setItemAsync(key, JSON.stringify(plan));
        }
      }
      const r = await client.query(api.thread, { conversationId: plan.conversationId });
      assert(isReady(r), "pending query was refused");
      const pending = r.data.filter(m => plan.bodies.includes(m.body ?? "")).reverse();
      assert(pending.length === 2 && pending.every((m, i) => m.pending && m.body === plan.bodies[i]), "the two exact pending rows were not present once each in compose order");
      status(relaunched ? "Relaunched offline: both sends still pending" : "Offline: both sends pending");
      await pause(1000);
      await w.receipt({ event: "pending", relaunched, bodies: pending.map(m => m.body), ids: plan.writes, rows: pending });
    });
    await w.waitFor("reconnect");
    await w.step("done", async () => {
      const reconnect = Date.now();
      await until(async () => {
        assert(!failed, `send failed: ${JSON.stringify(failed)}`);
        return sent.length === 2 ? sent : null;
      });
      assert(sent.every((write, i) => write.id === plan.writes[i]) && sent[0]!.seq < sent[1]!.seq, "sends did not settle in compose order");
      const rows = await until(async () => {
        const r = await client.query(api.thread, { conversationId: plan.conversationId });
        if (!isReady(r)) return null;
        const mine = r.data.filter(m => plan.bodies.includes(m.body ?? "")).reverse();
        return mine.length === 2 && mine.every((m, i) => !m.pending && m.body === plan.bodies[i]) ? mine : null;
      });
      status("Both sends sent, in order");
      await pause(1000);
      await w.receipt({ event: "done", writes: sent, bodies: rows.map(m => m.body), rows, ms: Date.now() - reconnect });
    });
  } finally { off(); }
}
