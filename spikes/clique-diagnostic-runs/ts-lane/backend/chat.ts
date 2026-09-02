import { max, mutation, query, t } from "snapback2";
import { convos, counters, dmPairs, members, messages, profiles, roster } from "./schema";

// Messaging. `members` is the personal inbox pointer (scan-by-viewer lane);
// `roster` is the single source of truth for member state and receipt
// watermarks (see the schema comment). Receipts are per-member watermarks
// compared against each message's global seq; the client derives ticks and
// group aggregates from the roster. Membership at send time is
// reconstructed from joinedAt/removedAt versus the message timestamp.

export const openDm = mutation({ userId: t.ref(profiles) }, ({ db, ctx, args }) => {
  db.require(args.userId !== ctx.viewer, "SELF_DM");
  const target = db.get(profiles, args.userId);
  db.require(target !== null, "TARGET_UNKNOWN");
  const me = db.get(profiles, ctx.viewer);
  db.require(me !== null, "PROFILE_REQUIRED");
  const forward = db.get(dmPairs.byPair, [ctx.viewer, args.userId]);
  if (forward !== null) return { convoId: forward.convoId, existing: true };
  const backward = db.get(dmPairs.byPair, [args.userId, ctx.viewer]);
  if (backward !== null) return { convoId: backward.convoId, existing: true };
  const convoId = ctx.newId();
  const at = ctx.now();
  db.insert(convos, {
    id: convoId,
    kind: "dm",
    name: "",
    description: "",
    creatorId: ctx.viewer,
    lastBody: "",
    lastAt: at,
    lastSeq: 0,
    memberCount: 2,
  });
  db.insert(dmPairs, { id: ctx.newId(), userA: ctx.viewer, userB: args.userId, convoId });
  db.insert(members, { id: ctx.newId(), convoId, userId: ctx.viewer });
  db.insert(members, { id: ctx.newId(), convoId, userId: args.userId });
  db.insert(roster, {
    id: ctx.newId(),
    convoId,
    userId: ctx.viewer,
    role: "member",
    active: true,
    joinedAt: at,
    removedAt: 0,
    deliveredSeq: 0,
    readSeq: 0,
  });
  db.insert(roster, {
    id: ctx.newId(),
    convoId,
    userId: args.userId,
    role: "member",
    active: true,
    joinedAt: at,
    removedAt: 0,
    deliveredSeq: 0,
    readSeq: 0,
  });
  return { convoId, existing: false };
});

export const createGroup = mutation(
  {
    name: t.text(50),
    description: t.text(200),
    memberIds: t.list(t.ref(profiles), { max: 49 }),
  },
  ({ db, ctx, args }) => {
    db.require(args.name.length >= 1, "NAME_REQUIRED");
    const me = db.get(profiles, ctx.viewer);
    db.require(me !== null, "PROFILE_REQUIRED");
    db.require(args.memberIds.length >= 1, "NEED_MEMBERS");
    const convoId = ctx.newId();
    const at = ctx.now();
    db.insert(members, { id: ctx.newId(), convoId, userId: ctx.viewer });
    db.insert(roster, {
      id: ctx.newId(),
      convoId,
      userId: ctx.viewer,
      role: "admin",
      active: true,
      joinedAt: at,
      removedAt: 0,
      deliveredSeq: 0,
      readSeq: 0,
    });
    let added = 1;
    for (const userId of args.memberIds) {
      if (userId === ctx.viewer) continue;
      const profile = db.get(profiles, userId);
      db.require(profile !== null, "MEMBER_UNKNOWN");
      const existing = db.get(roster.byConvUser, [convoId, userId]);
      if (existing !== null) continue; // duplicate in the argument list
      db.insert(members, { id: ctx.newId(), convoId, userId });
      db.insert(roster, {
        id: ctx.newId(),
        convoId,
        userId,
        role: "member",
        active: true,
        joinedAt: at,
        removedAt: 0,
        deliveredSeq: 0,
        readSeq: 0,
      });
      added = added + 1;
    }
    db.require(added >= 2, "NEED_MEMBERS");
    db.require(added <= 50, "TOO_MANY_MEMBERS");
    db.insert(convos, {
      id: convoId,
      kind: "group",
      name: args.name,
      description: args.description,
      creatorId: ctx.viewer,
      lastBody: "",
      lastAt: at,
      lastSeq: 0,
      memberCount: added,
    });
    return { convoId };
  },
);

export const addMember = mutation(
  { convoId: t.ref(convos), userId: t.ref(profiles) },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null && my.active && my.role === "admin", "NOT_ADMIN");
    const convo = db.get(convos, args.convoId);
    db.require(convo !== null && convo.kind === "group", "NOT_GROUP");
    db.require(convo!.memberCount < 50, "GROUP_FULL");
    const profile = db.get(profiles, args.userId);
    db.require(profile !== null, "MEMBER_UNKNOWN");
    const existing = db.get(roster.byConvUser, [args.convoId, args.userId]);
    db.require(existing === null || !existing.active, "ALREADY_MEMBER");
    if (existing === null) {
      db.insert(members, { id: ctx.newId(), convoId: args.convoId, userId: args.userId });
      db.insert(roster, {
        id: ctx.newId(),
        convoId: args.convoId,
        userId: args.userId,
        role: "member",
        active: true,
        joinedAt: ctx.now(),
        removedAt: 0,
        deliveredSeq: 0,
        readSeq: 0,
      });
    } else {
      db.update(roster, existing.id, {
        role: "member",
        active: true,
        joinedAt: ctx.now(),
        removedAt: 0,
      });
    }
    db.update(convos, args.convoId, { memberCount: convo!.memberCount + 1 });
    return { added: true };
  },
);

export const removeMember = mutation(
  { convoId: t.ref(convos), userId: t.ref(profiles) },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null && my.active && my.role === "admin", "NOT_ADMIN");
    db.require(args.userId !== ctx.viewer, "USE_LEAVE");
    const convo = db.get(convos, args.convoId);
    db.require(convo !== null && convo.kind === "group", "NOT_GROUP");
    const target = db.get(roster.byConvUser, [args.convoId, args.userId]);
    db.require(target !== null && target.active, "NOT_MEMBER");
    db.update(roster, target!.id, { active: false, removedAt: ctx.now() });
    db.update(convos, args.convoId, { memberCount: convo!.memberCount - 1 });
    return { removed: true };
  },
);

export const promote = mutation(
  { convoId: t.ref(convos), userId: t.ref(profiles) },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null && my.active && my.role === "admin", "NOT_ADMIN");
    const target = db.get(roster.byConvUser, [args.convoId, args.userId]);
    db.require(target !== null && target.active, "NOT_MEMBER");
    db.update(roster, target!.id, { role: "admin" });
    return { promoted: true };
  },
);

export const leave = mutation({ convoId: t.ref(convos) }, ({ db, ctx, args }) => {
  const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
  db.require(my !== null && my.active, "NOT_MEMBER");
  const convo = db.get(convos, args.convoId);
  db.require(convo !== null, "CONVO_UNKNOWN");
  db.update(roster, my!.id, { active: false, removedAt: ctx.now() });
  db.update(convos, args.convoId, { memberCount: convo!.memberCount - 1 });
  return { left: true };
});

export const send = mutation(
  {
    convoId: t.ref(convos),
    body: t.text(2000),
    hasQuote: t.bool(),
    quotedId: t.ref(messages), // any id filler when hasQuote is false (the convoId works)
  },
  ({ db, ctx, args }) => {
    db.require(args.body.length >= 1, "BODY_REQUIRED");
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null && my.active, "NOT_MEMBER");
    const convo = db.get(convos, args.convoId);
    db.require(convo !== null, "CONVO_UNKNOWN");
    if (args.hasQuote) {
      const quoted = db.get(messages, args.quotedId);
      db.require(quoted !== null, "QUOTE_UNKNOWN");
      db.require(quoted!.convoId === args.convoId, "QUOTE_OTHER_CONVO");
    }
    const counter = db.get(counters.byName, ["seq"]);
    const seq = counter === null ? 1 : counter.value + 1;
    if (counter === null) {
      db.insert(counters, { id: ctx.newId(), name: "seq", value: seq });
    } else {
      db.update(counters, counter.id, { value: seq });
    }
    const id = ctx.newId();
    const at = ctx.now();
    db.insert(messages, {
      id,
      convoId: args.convoId,
      authorId: ctx.viewer,
      body: args.body,
      at,
      seq,
      hasQuote: args.hasQuote,
      quotedId: args.hasQuote ? args.quotedId : id,
    });
    db.update(convos, args.convoId, { lastBody: args.body, lastAt: at, lastSeq: seq });
    // The sender has trivially delivered and read their own message.
    db.update(roster, my!.id, {
      deliveredSeq: max(my!.deliveredSeq, seq),
      readSeq: max(my!.readSeq, seq),
    });
    return { id, seq };
  },
);

export const markDelivered = mutation(
  { convoId: t.ref(convos), seq: t.int() },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null, "NOT_MEMBER");
    db.update(roster, my!.id, { deliveredSeq: max(my!.deliveredSeq, args.seq) });
    return { deliveredSeq: max(my!.deliveredSeq, args.seq) };
  },
);

export const markRead = mutation(
  { convoId: t.ref(convos), seq: t.int() },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    db.require(my !== null, "NOT_MEMBER");
    db.update(roster, my!.id, {
      deliveredSeq: max(my!.deliveredSeq, args.seq),
      readSeq: max(my!.readSeq, args.seq),
    });
    return { readSeq: max(my!.readSeq, args.seq) };
  },
);

export const list = query({}, ({ db, ctx }) => {
  // Certified-output ceiling: the conversation list covers the viewer's 40
  // most conversations (documented bound).
  const mine = db.scan(members.byUser, [ctx.viewer], { take: 40 });
  const rows = [];
  for (const pointer of mine) {
    const convo = db.get(convos, pointer.convoId);
    if (convo === null) continue;
    const my = db.get(roster.byConvUser, [pointer.convoId, ctx.viewer]);
    if (my === null) continue;
    let title = convo.name;
    if (convo.kind === "dm") {
      const pair = db.scan(roster.byConvUser, [pointer.convoId], { take: 2 });
      for (const other of pair) {
        if (other.userId !== ctx.viewer) {
          const profile = db.get(profiles, other.userId);
          if (profile === null) {
            title = "?";
          } else {
            title = profile.displayName;
          }
        }
      }
    }
    rows.push({
      convoId: pointer.convoId,
      kind: convo.kind,
      name: convo.name,
      title,
      lastBody: convo.lastBody,
      lastAt: convo.lastAt,
      lastSeq: convo.lastSeq,
      memberCount: convo.memberCount,
      myRole: my.role,
      active: my.active,
      myDeliveredSeq: my.deliveredSeq,
    });
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt);
});

export const thread = query(
  { convoId: t.ref(convos), cursorSeq: t.int() },
  ({ db, ctx, args }) => {
    const my = db.get(roster.byConvUser, [args.convoId, ctx.viewer]);
    if (my === null) return null;
    const convo = db.get(convos, args.convoId);
    if (convo === null) return null;
    const rosterOut = [];
    const memberRows = db.scan(roster.byConvUser, [args.convoId], { take: 50 });
    for (const row of memberRows) {
      const profile = db.get(profiles, row.userId);
      rosterOut.push({
        userId: row.userId,
        name: profile === null ? "?" : profile.displayName,
        handle: profile === null ? "?" : profile.handle,
        role: row.role,
        active: row.active,
        joinedAt: row.joinedAt,
        removedAt: row.removedAt,
        deliveredSeq: row.deliveredSeq,
        readSeq: row.readSeq,
      });
    }
    const rows = db.scan(messages.byConvSeq, [args.convoId], {
      order: "desc",
      take: 25,
      before: args.cursorSeq,
    });
    const page = [];
    let oldestSeq = -1;
    for (const row of rows) {
      // Removed members keep history up to their removal but receive
      // nothing sent after it.
      if (!my.active && row.at > my.removedAt) continue;
      let quotedBody = "";
      let quotedAuthorId = "";
      if (row.hasQuote) {
        const quoted = db.get(messages, row.quotedId);
        if (quoted !== null) {
          quotedBody = quoted.body;
          quotedAuthorId = quoted.authorId;
        }
      }
      page.push({
        id: row.id,
        seq: row.seq,
        at: row.at,
        authorId: row.authorId,
        body: row.body,
        hasQuote: row.hasQuote,
        quotedId: row.quotedId,
        quotedBody,
        quotedAuthorId,
      });
      oldestSeq = row.seq;
    }
    return {
      convo: {
        convoId: args.convoId,
        kind: convo.kind,
        name: convo.name,
        description: convo.description,
        memberCount: convo.memberCount,
        myRole: my.role,
        myActive: my.active,
        myDeliveredSeq: my.deliveredSeq,
        myReadSeq: my.readSeq,
      },
      roster: rosterOut,
      messages: page.sort((a, b) => a.seq - b.seq),
      nextCursor: rows.length === 25 && oldestSeq >= 0 ? oldestSeq : null,
    };
  },
);
