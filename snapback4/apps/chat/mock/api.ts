// MOCK — the operations of snapback/schema.q as plain functions over
// in-memory tables, so the screens can be written against the card today.
// The real `api` is inferred from the compiled schema in week 2.
import type { Cursor, Mutation, Principal, Query, Refusal } from "snapback4/contract";
import { page, type Row, type Tables } from "snapback4/mock";

export type Message = Row & { conversationId: string; authorId: Principal; body: string | null; at: number; editedAt: number | null };
export type Conversation = Row & { title: string; creatorId: Principal };
export type Membership = Row & { conversationId: string; principal: Principal; role: "member" | "admin"; joinedAt: number };
export type InboxRow = { conversationId: string; conversation: Conversation | null; count: number };

const q = <A, R>(name: string): Query<A, R> => ({ kind: "query", name });
const m = <A, R>(name: string): Mutation<A, R> => ({ kind: "mutation", name });

export const api = {
  messages: {
    thread: q<{ conversationId: string; c?: Cursor | null }, Message[]>("messages.thread"),
    inbox: q<Record<string, never>, InboxRow[]>("messages.inbox"),
    send: m<{ conversationId: string; body: string }, { id: string }>("messages.send"),
    unsend: m<{ messageId: string }, null>("messages.unsend"),
  },
};

const PAGE = 50;
const isMember = (t: Tables, conversationId: string, viewer: Principal | null) =>
  viewer != null && [...(t.memberships?.values() ?? [])].some((r) => r.conversationId === conversationId && r.principal === viewer);
const refuse = (code: string, message: string): Refusal => ({ code, family: "rule", message, rule: code });

export const ops = {
  queries: {
    "messages.thread": (t: Tables, args: { conversationId: string; c?: Cursor | null }, viewer: Principal | null) => {
      if (!isMember(t, args.conversationId, viewer)) throw refuse("MEMBERSHIP_REQUIRED", "not a member of this conversation");
      const all = [...(t.messages?.values() ?? [])].filter((r) => r.conversationId === args.conversationId) as Message[];
      all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
      const start = args.c ? Number(args.c) : 0;
      const rows = all.slice(start, start + PAGE);
      const next = start + PAGE < all.length ? (String(start + PAGE) as Cursor) : null;
      return page(rows, next);
    },
    "messages.inbox": (t: Tables, _args: Record<string, never>, viewer: Principal | null): InboxRow[] =>
      [...(t.memberships?.values() ?? [])].filter((r) => r.principal === viewer).map((r) => ({
        conversationId: String(r.conversationId),
        conversation: (t.conversations?.get(String(r.conversationId)) as Conversation | undefined) ?? null,
        count: [...(t.messages?.values() ?? [])].filter((x) => x.conversationId === r.conversationId).length,
      })),
  },
  mutations: {
    "messages.send": (t: Tables, args: { conversationId: string; body: string }, viewer: Principal | null, mint: () => string) => {
      if (!viewer || !isMember(t, args.conversationId, viewer)) return refuse("NOT_MEMBER", "join this conversation before sending");
      if (args.body.length > 4000) return { code: "E_BOUND", family: "bound", message: "body is longer than 4000 characters" } satisfies Refusal;
      const id = mint();
      (t.messages ??= new Map()).set(id, { id, conversationId: args.conversationId, authorId: viewer, body: args.body, at: Date.now(), editedAt: null });
      return [id];
    },
    "messages.unsend": (t: Tables, args: { messageId: string }, viewer: Principal | null) => {
      const msg = t.messages?.get(args.messageId) as Message | undefined;
      if (!msg) return refuse("NOT_FOUND", "no such message");
      if (msg.authorId !== viewer) return refuse("NOT_AUTHOR", "only the author can unsend");
      t.messages?.delete(args.messageId);
      return [];
    },
  },
};

export function seed(viewer: Principal): Tables {
  const alice = "dev:alice" as Principal, bob = "dev:bob" as Principal;
  const t: Tables = { conversations: new Map(), memberships: new Map(), messages: new Map() };
  t.conversations!.set("c1", { id: "c1", title: "General", creatorId: alice });
  t.conversations!.set("c2", { id: "c2", title: "Side room", creatorId: alice });
  let i = 0;
  const add = (conversationId: string, principal: Principal, role: "member" | "admin") => t.memberships!.set(`mm${++i}`, { id: `mm${i}`, conversationId, principal, role, joinedAt: 0 });
  add("c1", alice, "admin"); add("c1", bob, "member"); add("c2", alice, "admin"); add("c2", viewer, "member");
  const t0 = Date.now() - 120 * 60_000;
  for (let n = 0; n < 120; n++) t.messages!.set(`msg${n}`, { id: `msg${n}`, conversationId: n % 3 === 0 ? "c2" : "c1", authorId: n % 2 ? alice : bob, body: `Message ${n}`, at: t0 + n * 60_000, editedAt: null });
  return t;
}
