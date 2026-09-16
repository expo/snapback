import type { Client, Cursor, Read, ResultOf } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// Held search remains the UI path; this optional walk searches server history.
// For an existing app, wire search.q to its authorized membership/message
// tables and indexes. No message copying or second write API is installed.
// Pages are newest first within each batch. Group by roomId, dedupe by id;
// do not call the first batch a globally newest page across all chats.
// Restart on membership changes; live requests do not share a snapshot.
// @ref LLP 3000.007#18.1 — two cursors, and no advancement past an unfinished matching lane.
export async function* searchServer(client: Client, q: string) {
  let batch: Cursor | null = null;
  for (;;) {
    const chats: Read<ResultOf<typeof api.search.searchChats>> = await client.query(api.search.searchChats, { c: batch });
    if (!("data" in chats) || !chats.complete || !chats.fresh || chats.cut) {
      yield { phase: "memberships" as const, read: chats, batch, finished: false };
      return;
    }
    let c: Cursor | null = null;
    for (;;) {
      const read: Read<ResultOf<typeof api.search.searchChatBatch>> = await client.query(api.search.searchChatBatch, { q, batch, c });
      const ready = "data" in read && read.complete && read.fresh && !read.cut;
      const finished = ready && !read.next && !chats.next;
      yield { phase: "results" as const, read, batch, finished };
      // Narrow the term or reduce BOTH membership bounds in search.q and
      // restart. A cut batch has no safe continuation; never skip its rest.
      if (!("data" in read) || !read.complete || !read.fresh || read.cut) return;
      c = read.next ?? null;
      if (c === null) break;
    }
    batch = chats.next ?? null;
    if (batch === null) return;
  }
}
