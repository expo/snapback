import {
  concat,
  deterministicShare,
  mentionTokens,
  mutation,
  query,
  recurse,
  t,
  type Context,
  type Db,
} from "snapback2";
import {
  accounts,
  cardCounts,
  cards,
  columns,
  conversations,
  dmKeys,
  expenses,
  memberships,
  messages,
  owed,
  secretDocs,
  shares,
  unreads,
  users,
  waitCounts,
  waitlist,
} from "./schema";

function threadMentionUser(db: Db, handle: any) {
  return db.scan(users.byHandle, [handle], { take: 1 });
}

function conversationShape(value: any) {
  return ({ value }).value;
}

function sendMembers(db: Db, conversationId: any) {
  return db.scan(memberships.byConversation, [conversationShape(conversationId)], { take: 256 });
}

function sendMembership(db: Db, ctx: Context["ctx"], conversationId: any) {
  return db.exists(memberships.byConvUser, [conversationId, ctx.viewer]);
}

function sendUnread(db: Db, conversationId: any, member: any) {
  return db.get(unreads.byConvUser, [conversationId, member.userId]);
}

function inboxMemberships(db: Db, ctx: Context["ctx"]) {
  return db.scan(memberships.byUserActivity, [ctx.viewer], { order: "desc", take: 50 });
}

function inboxLatest(db: Db, membership: any) {
  return db.scan(messages.byConvTime, [membership.conversationId], { order: "desc", take: 1 });
}

function inboxUnreadMessages(db: Db, membership: any) {
  return db.scan(messages.byConvTime, [membership.conversationId], {
    order: "asc",
    take: 100,
    after: membership.lastReadAt,
  });
}

function inboxUnreadMaintained(db: Db, ctx: Context["ctx"], membership: any) {
  return db.get(unreads.byConvUser, [membership.conversationId, ctx.viewer]);
}

function startDmUnique(db: Db, lo: any, hi: any) {
  return db.get(dmKeys.byPair, [lo, hi]);
}

function boardColumns(db: Db, boardId: any) {
  return db.scan(columns.byParentOrder, [boardId], { order: "asc", take: 20 });
}

function boardViewCards(db: Db, column: any) {
  return db.scan(cards.byParentOrder, [column.id], { order: "asc", take: 50 });
}

function boardSummaryCount(db: Db, column: any) {
  return db.get(cardCounts, column.id);
}

function ledgerOwed(db: Db, groupId: any) {
  return db.scan(owed.byGroup, [groupId], { order: "asc", take: 50 });
}

function helperCards(db: Db, columnId: any) {
  return db.scan(cards.byParentOrder, [columnId], { order: "asc", take: 37 });
}

function waitlistMaintainedDepth(db: Db, resourceId: any) {
  return db.get(waitCounts, resourceId);
}

function secretDocument(db: Db, id: any) {
  return db.get(secretDocs, id);
}

function normalizeHandle(value: any) {
  return `${value}`;
}

function mentionScanUsers(db: Db, handle: any) {
  return db.scan(users.byHandle, [normalizeHandle(handle)], { order: "asc", take: 20 });
}

export const thread = query({ conversationId: t.id() }, ({ db, args }) => {
  let result: any[] = [];
  for (const message of db.scan(messages.byConvTime, [args.conversationId], { order: "desc", take: 3 })) {
    let author = db.get(users, message.authorId);
    let mentions: any[] = [];
    for (const handle of mentionTokens(message.body)) {
      mentions.push(threadMentionUser(db, handle));
    }
    result.push({ message, author, mentions });
  }
  return result;
});

export const send = mutation(
  { conversationId: t.id(), body: t.text(256), at: t.time() },
  ({ db, ctx, args }) => {
    db.require(
      sendMembership(db, ctx, args.conversationId),
      "NOT_MEMBER",
    );
    const messageId = ctx.newId();
    db.insert(messages, {
      id: messageId,
      conversationId: args.conversationId,
      authorId: ctx.viewer,
      body: args.body,
      at: args.at,
    });
    return messageId;
  },
);

export const sendMaintainedUnread = mutation(
  { conversationId: t.id(), body: t.text(256), at: t.time() },
  ({ db, ctx, args }) => {
    db.require(
      sendMembership(db, ctx, args.conversationId),
      "NOT_MEMBER",
    );
    const messageId = ctx.newId();
    db.insert(messages, {
      id: messageId,
      conversationId: args.conversationId,
      authorId: ctx.viewer,
      body: args.body,
      at: args.at,
    });
    for (const member of sendMembers(db, args.conversationId)) {
      let unread = sendUnread(db, args.conversationId, member);
      if (unread === null) {
        db.insert(unreads, {
          id: concat(args.conversationId, member.userId),
          conversationId: args.conversationId,
          userId: member.userId,
          value: 1,
        });
      } else {
        db.update(unreads, unread.id, { value: unread.value + 1 });
      }
    }
    return messageId;
  },
);

export const markRead = mutation({ membershipId: t.id(), at: t.time() }, ({ db, args }) => {
  db.update(memberships, args.membershipId, { lastReadAt: args.at });
  return true;
});

export const inboxCountCapped = query({}, ({ db, ctx }) => {
  let result: any[] = [];
  for (const membership of inboxMemberships(db, ctx)) {
    result.push({
      latest: inboxLatest(db, membership),
      unread: inboxUnreadMessages(db, membership).countCapped(),
    });
  }
  return result;
});

export const inboxMaintained = query({}, ({ db, ctx }) => {
  let result: any[] = [];
  for (const membership of inboxMemberships(db, ctx)) {
    result.push({
      latest: inboxLatest(db, membership),
      unread: inboxUnreadMaintained(db, ctx, membership),
    });
  }
  return result;
});

export const startDm = mutation({ lo: t.id(), hi: t.id() }, ({ db, ctx, args }) => {
  let existing = startDmUnique(db, args.lo, args.hi);
  if (existing === null) {
    let conversationId = ctx.newId();
    let dmId = ctx.newId();
    let loMembershipId = ctx.newId();
    let hiMembershipId = ctx.newId();
    db.insert(conversations, { id: conversationId, title: "DM" });
    db.insert(dmKeys, { id: dmId, lo: args.lo, hi: args.hi, conversationId });
    db.insert(memberships, {
      id: loMembershipId,
      conversationId,
      userId: args.lo,
      lastReadAt: 0,
      activity: 0,
    });
    db.insert(memberships, {
      id: hiMembershipId,
      conversationId,
      userId: args.hi,
      lastReadAt: 0,
      activity: 0,
    });
    return conversationId;
  } else {
    return existing.conversationId;
  }
});

export const boardView = query({ boardId: t.id() }, ({ db, args }) => {
  let result: any[] = [];
  for (const column of boardColumns(db, args.boardId)) {
    result.push({ column, child: boardViewCards(db, column) });
  }
  return result;
});

export const boardSummary = query({ boardId: t.id() }, ({ db, args }) => {
  let result: any[] = [];
  for (const column of boardColumns(db, args.boardId)) {
    result.push({ column, child: boardSummaryCount(db, column) });
  }
  return result;
});

export const ledger = query({ groupId: t.id() }, ({ db, args }) =>
  ledgerOwed(db, args.groupId),
);

export const addExpense = mutation(
  { groupId: t.id(), amount: t.int(), recipients: t.list(t.ref(users), { max: 50 }) },
  ({ db, ctx, args }) => {
    let expenseId = ctx.newId();
    db.insert(expenses, {
      id: expenseId,
      groupId: args.groupId,
      amount: args.amount,
      payerId: ctx.viewer,
    });
    for (const recipient of args.recipients) {
      let shareId = ctx.newId();
      db.insert(shares, {
        id: shareId,
        expenseId,
        groupId: args.groupId,
        userId: recipient,
        amount: deterministicShare(args.amount, args.recipients, recipient),
      });
    }
    return expenseId;
  },
);

export const ancestors = query({ accountId: t.id() }, ({ db, args }) => {
  let result: any[] = [];
  for (const account of recurse(
    args.accountId,
    (current) => db.get(accounts, current.parentId),
    { depth: 8, fanout: 1 },
  )) {
    result.push(account);
  }
  return result;
});

export const mentionScan = query({ handle: t.text(32) }, ({ db, args }) =>
  mentionScanUsers(db, args.handle),
);

export const helperWrappedScan = query({ columnId: t.id() }, ({ db, args }) =>
  helperCards(db, args.columnId),
);

export const maintainedWaitlistDepth = query({ resourceId: t.id() }, ({ db, args }) =>
  waitlistMaintainedDepth(db, args.resourceId),
);

export const hiddenRuleDocument = query({ id: t.id() }, ({ db, args }) =>
  secretDocument(db, args.id),
);

export const deleteMessage = mutation({ id: t.id() }, ({ db, args }) => {
  db.delete(messages, args.id);
});
