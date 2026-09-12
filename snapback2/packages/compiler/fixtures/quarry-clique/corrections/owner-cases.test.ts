import type { Principal } from "snapback2";
import { api } from "snapback2/client";
import { subscribe } from "snapback2/internal";
import { fixture, journey } from "snapback2/test";

type TestTick = (milliseconds: number) => Promise<{ offsetMs?: number }>;

async function advanceUntil<T>(
  tick: TestTick,
  lookup: () => Promise<T | undefined>,
  failure: string,
): Promise<T> {
  // Period timers keep their install phase. Advancing by less than one full
  // period observes every logical occurrence instead of coalescing one away.
  for (let step = 0; step < 4; step += 1) {
    await tick(60_000);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const value = await lookup();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(failure);
}

journey("configured expiry is stored from owner time", async ({ as, tick }) => {
  const clock = await tick(0);
  const alice = as("alice");
  try {
    const configured = await alice.mutation(api.groups.updateChat, {
      conversationId: "conversation-1",
      disappearing: "24h",
    });
    if (configured.state !== "committed") throw new Error(`configuration was ${configured.state}`);
    const sentAt = Date.now() + Number(clock.offsetMs ?? 0);
    const sent = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "configured expiry proof",
    });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("thread was not a page");
    const message = thread.data.find((entry) => entry.message?.id === sent.data.id)?.message;
    if (typeof message?.expiresAt !== "number") throw new Error(`stored expiry was ${String(message?.expiresAt)}`);
    const delta = message.expiresAt - sentAt;
    if (delta < 179_000 || delta > 181_000) throw new Error(`configured expiry delta was ${delta}`);
  } finally {
    alice.close();
  }
});

journey("push preview stores the exact Unicode prefix", async ({ as }) => {
  const body = `${"🙂".repeat(79)}界tail`;
  const expected = `${"🙂".repeat(79)}界`;
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  } finally {
    alice.close();
  }
  const bob = as("bob");
  try {
    const pushes = await bob.query(api.messages.pushRecent, { c: null });
    if (!("data" in pushes) || !Array.isArray(pushes.data)) throw new Error("push log was not a page");
    const preview = pushes.data.find((row) => typeof row.preview === "string" && row.preview.startsWith(expected))?.preview;
    if (preview !== expected || [...preview].length !== 80) {
      throw new Error(`stored preview was ${JSON.stringify(preview)}`);
    }
  } finally {
    bob.close();
  }
});

journey("digest counts current followed posts in the completed period", async ({ as, tick }) => {
  const clock = await tick(0);
  const sourceNow = Date.now() + Number(clock.offsetMs ?? 0);
  const sourcePeriodStart = sourceNow - ((sourceNow % 120_000) + 120_000) % 120_000;
  const alice = as("alice");
  try {
    const post = await alice.mutation(api.posts.createPost, { body: "digest following proof" });
    if (post.state !== "committed") throw new Error(`post was ${post.state}`);
  } finally {
    alice.close();
  }
  const bob = as("bob");
  try {
    const digest = await advanceUntil(tick, async () => {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
    }, "following activity produced no digest");
    if (digest.periodStart !== sourcePeriodStart || digest.periodEnd !== sourcePeriodStart + 120_000) {
      throw new Error(`digest period was ${String(digest.periodStart)}..${String(digest.periodEnd)}`);
    }
    if (digest.newPostsInFollowing !== 1) {
      throw new Error(`following post count was ${String(digest.newPostsInFollowing)}`);
    }
  } finally {
    bob.close();
  }
});

journey("digest keeps the 100-membership account envelope", async ({ as, tick }) => {
  const charlie = as("charlie");
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "dev_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`profile was ${profile.state}`);
  } finally {
    charlie.close();
  }
  const bob = as("bob");
  try {
    for (let index = 0; index < 99; index += 1) {
      const group = await bob.mutation(api.groups.groupCreate, {
        title: `Digest envelope ${index}`,
        members: ["dev:charlie" as Principal],
        conversationId: `digest-envelope-${index}`,
      });
      if (group.state !== "committed") throw new Error(`group ${index} was ${group.state}`);
    }
    const refused = await bob.mutation(api.groups.groupCreate, {
      title: "Digest envelope refused 101",
      members: ["dev:charlie" as Principal],
      conversationId: "digest-envelope-refused-101",
    });
    if (refused.state !== "rejected") throw new Error(`membership 101 was ${refused.state}`);
  } finally {
    bob.close();
  }
  const alice = as("alice");
  try {
    const post = await alice.mutation(api.posts.createPost, { body: "100 membership digest proof" });
    if (post.state !== "committed") throw new Error(`post was ${post.state}`);
  } finally {
    alice.close();
  }
  const reopened = as("bob");
  try {
    const digest = await advanceUntil(tick, async () => {
      const pushes = await reopened.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
    }, "100-membership activity produced no digest");
    if (digest.newPostsInFollowing !== 1) {
      throw new Error(`100-membership following count was ${String(digest.newPostsInFollowing)}`);
    }
  } finally {
    reopened.close();
  }
});

journey("quiet period does not repeat standing unread activity", async ({ as, tick }) => {
  await tick(0);
  const alice = as("alice");
  try {
    const sent = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "one period of unread activity",
    });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  } finally {
    alice.close();
  }
  const bob = as("bob");
  try {
    const first = await advanceUntil(tick, async () => {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digests = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      return digests.length === 1 ? digests[0] : undefined;
    }, "first active period produced no digest");
    if (first?.unreadMessages !== 1 || first?.unreadChats !== 1) {
      throw new Error(`first digest payload was ${JSON.stringify(first)}`);
    }
  } finally {
    bob.close();
  }
  await tick(60_000);
  const thirdClock = await tick(60_000);
  const thirdNow = Date.now() + Number(thirdClock.offsetMs ?? 0);
  const thirdPeriodStart = thirdNow - ((thirdNow % 120_000) + 120_000) % 120_000;
  const poster = as("alice");
  try {
    const post = await poster.mutation(api.posts.createPost, { body: "activity after one quiet period" });
    if (post.state !== "committed") throw new Error(`third-period post was ${post.state}`);
  } finally {
    poster.close();
  }
  const reopened = as("bob");
  try {
    const digests = await advanceUntil(tick, async () => {
      const pushes = await reopened.query(api.messages.pushRecent, { c: null });
      const rows = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      return rows.some((row) => row.periodStart === thirdPeriodStart) ? rows : undefined;
    }, "third active period produced no digest");
    if (digests.length !== 2) throw new Error(`active/quiet/active left ${digests.length} digest rows`);
  } finally {
    reopened.close();
  }
});

journey("scheduled expiry drains a tombstone after offline reconnect", async ({ as, tick }) => {
  const clock = await tick(0);
  const alice = as("alice");
  const body = "expires while recipients are disconnected";
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "conversation-1",
    body,
    expiresAt: Date.now() + Number(clock.offsetMs ?? 0) + 1_000,
    messageId: "scheduled-expiry-proof",
  });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in before) || !Array.isArray(before.data)
    || !before.data.some((row) => row.messageId === sent.data.id && row.message?.body === body)) {
    throw new Error("expiring body was not readable before its deadline");
  }
  alice.close();
  await tick(1_001);
  const bob = as("bob", { store: "file" });
  const drain = subscribe(bob, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  try {
    const purged = await drain.until((value) => "data" in value
      && Array.isArray(value.data)
      && value.data.some((row: { kind?: string; messageId?: string }) =>
        row.kind === "removed" && row.messageId === sent.data.id));
    if (!("data" in purged) || !Array.isArray(purged.data) || JSON.stringify(purged.data).includes(body)) {
      throw new Error("reconnect delivery retained the expired body");
    }
    await bob.query(api.messages.inbox, { c: null });
    drain.close();
    await bob.offline();
    const cold = await bob.restart();
    const held = await cold.query(api.messages.inbox, { c: null });
    if (!("data" in held) || !Array.isArray(held.data) || JSON.stringify(held.data).includes(body)) {
      throw new Error("expired body survived the cold offline inbox");
    }
  } finally {
    drain.close();
    bob.close();
  }
});

journey("expiry policy covers off explicit photo video view-once and poll sends", async ({ as, tick }) => {
  const clock = await tick(0);
  const alice = as("alice");
  try {
    const off = await alice.mutation(api.groups.updateChat, {
      conversationId: "conversation-1",
      disappearing: "off",
    });
    if (off.state !== "committed") throw new Error(`off configuration was ${off.state}`);
    const noExpiry = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "off policy",
      messageId: "off-policy-proof",
    });
    const explicitAt = Date.now() + Number(clock.offsetMs ?? 0) + 90_000;
    const explicit = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "explicit policy",
      expiresAt: explicitAt,
      messageId: "explicit-policy-proof",
    });
    const configured = await alice.mutation(api.groups.updateChat, {
      conversationId: "conversation-1",
      disappearing: "7d",
    });
    if (configured.state !== "committed") throw new Error(`7d configuration was ${configured.state}`);
    const photoBytes = await fixture("fixtures/photo.jpg");
    const photo = {
      uri: `data:image/jpeg;base64,${btoa(String.fromCharCode(...photoBytes))}`,
      fileSize: photoBytes.byteLength,
      mimeType: "image/jpeg" as const,
    };
    const photoSent = await alice.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1",
      photo,
      messageId: "photo-expiry-proof",
    });
    const onceSent = await alice.mutation(api.messages.sendOncePhoto, {
      conversationId: "conversation-1",
      photo,
      messageId: "once-expiry-proof",
    });
    const clipSent = await alice.mutation(api.messages.sendClip, {
      conversationId: "conversation-1",
      clip: new File([await fixture("fixtures/clip.mp4")], "clip.mp4", { type: "video/mp4" }),
      messageId: "clip-expiry-proof",
    });
    const pollSent = await alice.mutation(api.messages.sendPoll, {
      conversationId: "conversation-1",
      question: "Which expiry policy?",
      option1: "Configured",
      option2: "None",
      optionId1: "configured",
      optionId2: "none",
      messageId: "poll-expiry-proof",
    });
    if (noExpiry.state !== "committed") throw new Error(`off-policy send was ${noExpiry.state}`);
    if (explicit.state !== "committed") throw new Error(`explicit-policy send was ${explicit.state}`);
    if (photoSent.state !== "committed") throw new Error(`photo send was ${photoSent.state}`);
    if (onceSent.state !== "committed") throw new Error(`view-once send was ${onceSent.state}`);
    if (clipSent.state !== "committed") throw new Error(`clip send was ${clipSent.state}`);
    if (pollSent.state !== "committed") throw new Error(`poll send was ${pollSent.state}`);
    const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("policy thread was not a page");
    const rows = new Map(thread.data.flatMap((row) => row.message ? [[row.message.id, row.message] as const] : []));
    if (rows.get(noExpiry.data.id)?.expiresAt !== null) throw new Error("off policy stored a deadline");
    if (rows.get(explicit.data.id)?.expiresAt !== explicitAt) throw new Error("explicit deadline lost precedence");
    for (const id of [photoSent.data.id, onceSent.data.id, clipSent.data.id, pollSent.data.id]) {
      const row = rows.get(id);
      if (typeof row?.expiresAt !== "number" || typeof row.at !== "number") {
        throw new Error(`media ${id} stored ${JSON.stringify(row)}`);
      }
      if (row.expiresAt - row.at !== 300_000) {
        throw new Error(`media ${id} expiry delta was ${row.expiresAt - row.at}`);
      }
    }
    await tick(300_001);
    const remainingPolls = await alice.query(api.messages.pollsInChat, { conversationId: "conversation-1" });
    if (!("data" in remainingPolls) || !Array.isArray(remainingPolls.data)
      || remainingPolls.data.some((poll) => poll.messageId === pollSent.data.id)) {
      throw new Error(`expired poll content remained readable: ${JSON.stringify(remainingPolls)}`);
    }
  } finally {
    alice.close();
  }
});

journey("digest revalidates follow membership read and expiry before emission", async ({ as, tick }) => {
  const initial = await tick(0);
  let offset = Number(initial.offsetMs ?? 0);
  const period = () => {
    const current = Date.now() + offset;
    return current - ((current % 120_000) + 120_000) % 120_000;
  };
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  let signal = 0;
  const finishPeriod = async (periodStart: number, posts = 0, unreadMessages = 0) => {
    if (signal > 0) {
      const reset = await charlie.mutation(api.follows.setFollow, { target: "dev:bob" as Principal, following: false });
      if (reset.state !== "committed") throw new Error(`barrier unfollow was ${reset.state}`);
    }
    signal += 1;
    const follow = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob" as Principal,
      following: true,
      mutationId: `digest-barrier-${signal}`,
    });
    if (follow.state !== "committed") throw new Error(`barrier follow was ${follow.state}`);
    const digest = await advanceUntil(tick, async () => {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === periodStart)
        : undefined;
    }, `period ${periodStart} did not finish its digest job`);
    offset = Number((await tick(0)).offsetMs ?? offset);
    const unreadChats = unreadMessages > 0 ? 1 : 0;
    if (digest.newFollowers !== 1 || digest.newPostsInFollowing !== posts
      || digest.unreadMessages !== unreadMessages || digest.unreadChats !== unreadChats) {
      throw new Error(`period ${periodStart} payload was ${JSON.stringify(digest)}`);
    }
  };
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "digest_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`barrier profile was ${profile.state}`);

    const beforePeriod = Date.now() + offset;
    const remainder = ((beforePeriod % 120_000) + 120_000) % 120_000;
    offset = Number((await tick(120_000 - remainder + 1_000)).offsetMs ?? offset);
    const excludedPeriod = period();
    const dropped = await alice.mutation(api.posts.createPost, { body: "unfollowed before emission" });
    if (dropped.state !== "committed") throw new Error(`unfollowed post was ${dropped.state}`);
    const unfollow = await bob.mutation(api.follows.setFollow, { target: "dev:alice" as Principal, following: false });
    if (unfollow.state !== "committed") throw new Error(`unfollow was ${unfollow.state}`);

    const readMessage = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "read before digest",
    });
    if (readMessage.state !== "committed") throw new Error(`read message was ${readMessage.state}`);
    const read = await bob.mutation(api.messages.markRead, { conversationId: "conversation-1" });
    if (read.state !== "committed") throw new Error(`mark read was ${read.state}`);

    const unsentMessage = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "unsent before digest",
    });
    if (unsentMessage.state !== "committed") throw new Error(`unsent message was ${unsentMessage.state}`);
    const unsent = await alice.mutation(api.messages.unsend, { messageId: unsentMessage.data.id });
    if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
    const currentFollow = await bob.mutation(api.follows.setFollow, {
      target: "dev:charlie" as Principal,
      following: true,
      mutationId: "digest-revalidate-current-follow",
    });
    if (currentFollow.state !== "committed") throw new Error(`current follow was ${currentFollow.state}`);
    const expiresAway = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "expires while member is away",
      expiresAt: Date.now() + offset + 1_000,
    });
    if (expiresAway.state !== "committed") throw new Error(`away expiry message was ${expiresAway.state}`);
    const left = await bob.mutation(api.groups.memberLeave, {
      conversationId: "conversation-1",
      membershipId: "membership-2",
    });
    if (left.state !== "committed") throw new Error(`member leave was ${left.state}`);
    offset = Number((await tick(1_001)).offsetMs ?? offset);
    const afterLeave = await alice.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: "dev:bob" as Principal,
    });
    if (afterLeave.state !== "committed") throw new Error(`member restore after leave was ${afterLeave.state}`);

    const removedMessage = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "member removed before digest",
    });
    if (removedMessage.state !== "committed") throw new Error(`remove message was ${removedMessage.state}`);
    const removed = await alice.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: afterLeave.data.id,
    });
    if (removed.state !== "committed") throw new Error(`member removal was ${removed.state}`);
    const restored = await alice.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: "dev:bob" as Principal,
    });
    if (restored.state !== "committed") throw new Error(`member restore was ${restored.state}`);

    const expires = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "expires before digest",
      expiresAt: Date.now() + offset + 1_000,
    });
    if (expires.state !== "committed") throw new Error(`expiring message was ${expires.state}`);
    offset = Number((await tick(1_001)).offsetMs ?? offset);

    const admitted = await charlie.mutation(api.posts.createPost, { body: "admitted after exclusions" });
    if (admitted.state !== "committed") throw new Error(`admitted post was ${admitted.state}`);
    await finishPeriod(excludedPeriod, 1);
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("period unread custody rejects peers and former authors and removes old incarnations atomically", async ({ as, tick }) => {
  const initial = await tick(0);
  let offset = Number(initial.offsetMs ?? 0);
  const periodStart = () => {
    const current = Date.now() + offset;
    return current - ((current % 120_000) + 120_000) % 120_000;
  };
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  const waitForDigest = async (expectedPeriod: number, expectedUnread = 0) => {
    const digest = await advanceUntil(tick, async () => {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === expectedPeriod)
        : undefined;
    }, `period ${expectedPeriod} did not finish its digest job`);
    offset = Number((await tick(0)).offsetMs ?? offset);
    if (digest.unreadMessages !== expectedUnread || digest.unreadChats !== expectedUnread) {
      throw new Error(`unexpected incarnation totals ${JSON.stringify(digest)}`);
    }
  };
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "custody_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`profile was ${profile.state}`);

    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Former author custody",
      members: ["dev:bob" as Principal, "dev:charlie" as Principal],
      conversationId: "former-author-custody",
    });
    if (group.state !== "committed") throw new Error(`group was ${group.state}`);
    const authored = await alice.mutation(api.messages.send, {
      conversationId: "former-author-custody",
      body: "former author cannot clear recipient custody",
      messageId: "former-author-period-unread",
    });
    if (authored.state !== "committed") throw new Error(`authored message was ${authored.state}`);
    const authorRow = await alice.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob" as Principal,
    });
    if (!("data" in authorRow) || authorRow.data?.messageId !== authored.data.id) {
      throw new Error(`current author could not inspect period custody: ${JSON.stringify(authorRow)}`);
    }
    const recipientRow = await bob.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob" as Principal,
    });
    if (!("data" in recipientRow) || recipientRow.data?.messageId !== authored.data.id) {
      throw new Error(`recipient could not inspect period custody: ${JSON.stringify(recipientRow)}`);
    }
    const peerRow = await charlie.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob" as Principal,
    });
    if (!("data" in peerRow) || peerRow.data !== null) {
      throw new Error(`ordinary peer observed period custody: ${JSON.stringify(peerRow)}`);
    }
    const peerAttempt = await charlie.mutation(api.messages.unsend, { messageId: authored.data.id });
    if (peerAttempt.state !== "rejected") throw new Error(`ordinary peer unsend was ${peerAttempt.state}`);
    const left = await alice.mutation(api.groups.memberLeave, {
      conversationId: "former-author-custody",
      membershipId: group.data.creatorMembershipId,
    });
    if (left.state !== "committed") throw new Error(`author leave was ${left.state}`);
    const formerAuthorRow = await alice.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob" as Principal,
    });
    if (!("data" in formerAuthorRow) || formerAuthorRow.data !== null) {
      throw new Error(`former author observed period custody: ${JSON.stringify(formerAuthorRow)}`);
    }
    const formerAttempt = await alice.mutation(api.messages.unsend, { messageId: authored.data.id });
    if (formerAttempt.state !== "rejected") throw new Error(`former author unsend was ${formerAttempt.state}`);
    const clearedFormerChat = await bob.mutation(api.messages.markRead, { conversationId: "former-author-custody" });
    if (clearedFormerChat.state !== "committed") {
      throw new Error(`former-author chat clear was ${clearedFormerChat.state}`);
    }

    const stalePeriod = periodStart();
    const sent = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "stale membership incarnation",
      messageId: "stale-membership-period-unread",
    });
    if (sent.state !== "committed") throw new Error(`stale-row send was ${sent.state}`);
    const before = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
    if (!("data" in before) || !Array.isArray(before.data)
      || !before.data.some((row) => row.messageId === sent.data.id)) {
      throw new Error(`recipient did not own period row ${JSON.stringify(before)}`);
    }
    const removed = await alice.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: "membership-2",
    });
    if (removed.state !== "committed") throw new Error(`member removal was ${removed.state}`);
    const restored = await alice.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: "dev:bob" as Principal,
    });
    if (restored.state !== "committed") throw new Error(`member restore was ${restored.state}`);
    const afterRestore = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
    const stale = "data" in afterRestore && Array.isArray(afterRestore.data)
      ? afterRestore.data.find((row) => row.messageId === sent.data.id)
      : undefined;
    if (stale) {
      throw new Error(`removed membership retained custody: ${JSON.stringify(afterRestore)}`);
    }
    const current = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1", body: "current incarnation bucket", messageId: "current-incarnation-period-unread",
    });
    if (current.state !== "committed") throw new Error(`current send was ${current.state}`);

    const firstBarrier = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob" as Principal,
      following: true,
      mutationId: "period-prune-barrier-1",
    });
    if (firstBarrier.state !== "committed") throw new Error(`first barrier was ${firstBarrier.state}`);
    await waitForDigest(stalePeriod, 1);
    const held = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
    if (!("data" in held) || !Array.isArray(held.data)
      || !held.data.some((row) => row.messageId === current.data.id)) {
      throw new Error("prune raced the last completed digest bucket");
    }

    const nextPeriod = periodStart();
    const unfollow = await charlie.mutation(api.follows.setFollow, { target: "dev:bob" as Principal, following: false });
    if (unfollow.state !== "committed") throw new Error(`barrier unfollow was ${unfollow.state}`);
    const secondBarrier = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob" as Principal,
      following: true,
      mutationId: "period-prune-barrier-2",
    });
    if (secondBarrier.state !== "committed") throw new Error(`second barrier was ${secondBarrier.state}`);
    await waitForDigest(nextPeriod);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pruned = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
      if ("data" in pruned && Array.isArray(pruned.data)
        && !pruned.data.some((row) => row.messageId === current.data.id)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("old current-incarnation bucket was not pruned");
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("same-period replay activity stays silent and a post retry counts exactly once", async ({ as, tick }) => {
  let clock = await tick(0);
  let offset = Number(clock.offsetMs ?? 0);
  const initialNow = Date.now() + offset;
  const initialRemainder = ((initialNow % 120_000) + 120_000) % 120_000;
  clock = await tick(120_000 - initialRemainder + 1_000);
  offset = Number(clock.offsetMs ?? offset);
  const alice = as("alice", { store: "file" });
  const bob = as("bob", { store: "file" });
  const charlie = as("charlie");
  try {
    const grant = subscribe(alice, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    await grant.until((value) =>
      (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
    grant.close();
    const replayPeriodNow = Date.now() + offset;
    const replayPeriod = replayPeriodNow - ((replayPeriodNow % 120_000) + 120_000) % 120_000;
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "replay_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`profile was ${profile.state}`);
    const replayOn = await alice.mutation(api.admin.setReplayMode, { enabled: true });
    if (replayOn.state !== "committed") throw new Error(`replay enable was ${JSON.stringify(replayOn)}`);
    const skipped = await alice.mutation(api.posts.createPost, { body: "replay period" });
    if (skipped.state !== "committed") throw new Error(`replay post was ${skipped.state}`);
    const replayFollow = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob" as Principal,
      following: true,
      mutationId: "replay-follow-bob",
    });
    if (replayFollow.state !== "committed") throw new Error(`replay follow was ${replayFollow.state}`);
    const replayOff = await alice.mutation(api.admin.setReplayMode, { enabled: false });
    if (replayOff.state !== "committed") throw new Error(`replay disable was ${replayOff.state}`);
    await alice.offline();
    const queued = await alice.mutation(api.posts.createPost, {
      body: "idempotent period post",
      postId: "idempotent-period-post",
    });
    if (queued.state !== "queued") throw new Error(`offline post was ${queued.state}`);
    const retrying = await alice.restart();
    retrying.failNextResponse("/api/mutation", 503);
    await retrying.online();
    await retrying.settled();
    const afterFault = await retrying.outbox.entries();
    if (afterFault.find((entry) => entry.intent === queued.intent)?.state !== "queued") {
      throw new Error(`post retry lost custody: ${JSON.stringify(afterFault)}`);
    }
    await retrying.outbox.drain();
    const settled = await retrying.outbox.entries();
    if (settled.find((entry) => entry.intent === queued.intent)?.state !== "committed") {
      throw new Error(`post retry settled as ${JSON.stringify(settled)}`);
    }
    await bob.offline();
    const cold = await bob.restart();
    await cold.online();
    const digests = await advanceUntil(tick, async () => {
      const pushes = await cold.query(api.messages.pushRecent, { c: null });
      const rows = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      return rows.some((row) => row.periodStart === replayPeriod) ? rows : undefined;
    }, "post-replay period produced no digest");
    const final = digests.find((row) => row.periodStart === replayPeriod);
    if (digests.length !== 1 || final?.newPostsInFollowing !== 1 || final?.newFollowers !== 0) {
      throw new Error(`retry/restart payload was ${JSON.stringify(digests)}`);
    }
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("an ordinary member author unsends period custody without receipt access", async ({ as, tick }) => {
  let clock = await tick(0);
  let offset = Number(clock.offsetMs ?? 0);
  const initialNow = Date.now() + offset;
  const initialRemainder = ((initialNow % 120_000) + 120_000) % 120_000;
  clock = await tick(120_000 - initialRemainder + 1_000);
  offset = Number(clock.offsetMs ?? offset);
  const periodNow = Date.now() + offset;
  const periodStart = periodNow - ((periodNow % 120_000) + 120_000) % 120_000;
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "unsend_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`profile was ${profile.state}`);
    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Ordinary author unsend",
      members: ["dev:bob" as Principal, "dev:charlie" as Principal],
      conversationId: "ordinary-author-unsend",
    });
    if (group.state !== "committed") throw new Error(`group was ${group.state}`);
    const sent = await bob.mutation(api.messages.send, {
      conversationId: "ordinary-author-unsend",
      body: "remove my ordinary-member message",
      messageId: "ordinary-author-message",
    });
    if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
    const before = await bob.query(api["owner-inspection"].periodUnreadRow, {
      messageId: sent.data.id,
      recipient: "dev:alice" as Principal,
    });
    if (!("data" in before) || before.data?.messageId !== sent.data.id) {
      throw new Error(`ordinary author could not inspect period custody: ${JSON.stringify(before)}`);
    }
    const unsent = await bob.mutation(api.messages.unsend, { messageId: sent.data.id });
    if (unsent.state !== "committed") throw new Error(`ordinary author unsend was ${JSON.stringify(unsent)}`);
    const message = await alice.query(api["owner-inspection"].messageRow, { messageId: sent.data.id });
    if (message.state !== "complete" || !("data" in message) || message.data !== null) {
      throw new Error(`unsent message was not a successful explicit absence: ${JSON.stringify(message)}`);
    }
    const after = await alice.query(api["owner-inspection"].periodUnreadRow, {
      messageId: sent.data.id,
      recipient: "dev:alice" as Principal,
    });
    if ("data" in after && after.data != null) {
      throw new Error(`period custody survived ordinary-author unsend: ${JSON.stringify(after)}`);
    }
    const barrier = await charlie.mutation(api.follows.setFollow, {
      target: "dev:alice" as Principal,
      following: true,
      mutationId: "ordinary-author-unsend-barrier",
    });
    if (barrier.state !== "committed") throw new Error(`barrier follow was ${barrier.state}`);
    const digest = await advanceUntil(tick, async () => {
      const pushes = await alice.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === periodStart)
        : undefined;
    }, "ordinary-author unsend period produced no digest");
    if (digest.newFollowers !== 1 || digest.unreadMessages !== 0 || digest.unreadChats !== 0) {
      throw new Error(`ordinary-author unsend entered digest: ${JSON.stringify(digest)}`);
    }
  } finally {
    await Promise.all([alice.close(), bob.close(), charlie.close()]);
  }
});

journey("only a current message author can remove a poll while unsending", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Poll peer",
      handle: "poll_unsend_peer",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`profile was ${profile.state}`);
    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Poll unsend authority",
      members: ["dev:bob" as Principal, "dev:charlie" as Principal],
      conversationId: "poll-unsend-authority",
    });
    if (group.state !== "committed") throw new Error(`group was ${group.state}`);
    const sent = await bob.mutation(api.messages.sendPoll, {
      conversationId: "poll-unsend-authority",
      question: "Remove this poll?",
      option1: "Yes",
      option2: "No",
      option3: null,
      option4: null,
      optionId1: "poll-unsend-yes",
      optionId2: "poll-unsend-no",
      optionId3: null,
      optionId4: null,
      messageId: "poll-unsend-message",
    });
    if (sent.state !== "committed") throw new Error(`poll send was ${JSON.stringify(sent)}`);
    const peerDelete = await charlie.mutation(api["owner-inspection"].deletePollForTest, {
      messageId: sent.data.id,
    });
    if (
      peerDelete.state !== "rejected"
      || peerDelete.code !== "E_RULE"
      || peerDelete.family !== "rule"
    ) {
      throw new Error(`ordinary member removed another author's poll: ${JSON.stringify(peerDelete)}`);
    }
    const before = await alice.query(api["owner-inspection"].pollRow, { messageId: sent.data.id });
    if (before.state !== "complete" || !("data" in before) || before.data?.messageId !== sent.data.id) {
      throw new Error(`peer refusal did not preserve the poll: ${JSON.stringify(before)}`);
    }
    const unsent = await bob.mutation(api.messages.unsend, { messageId: sent.data.id });
    if (unsent.state !== "committed") throw new Error(`poll author unsend was ${JSON.stringify(unsent)}`);
    const [message, poll] = await Promise.all([
      alice.query(api["owner-inspection"].messageRow, { messageId: sent.data.id }),
      alice.query(api["owner-inspection"].pollRow, { messageId: sent.data.id }),
    ]);
    for (const [kind, result] of [["message", message], ["poll", poll]] as const) {
      if (result.state !== "complete" || !("data" in result) || result.data !== null) {
        throw new Error(`${kind} was not a successful explicit absence: ${JSON.stringify(result)}`);
      }
    }
  } finally {
    await Promise.all([alice.close(), bob.close(), charlie.close()]);
  }
});

journey("a recipient acknowledges an unsent first row before the next live delivery", async ({ as }) => {
  let alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  const conversationId = "unsent-before-ack";
  try {
    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Unsent before acknowledgement",
      members: ["dev:bob" as Principal],
      conversationId,
    });
    if (group.state !== "committed") throw new Error(`group was ${JSON.stringify(group)}`);
    const removedId = "ack-cursor-00-removed";
    const removed = await bob.mutation(api.messages.send, {
      conversationId,
      body: "remove before recipient acknowledgement",
      messageId: removedId,
    });
    if (removed.state !== "committed") throw new Error(`removed send was ${JSON.stringify(removed)}`);
    const unsent = await bob.mutation(api.messages.unsend, { messageId: removedId });
    if (unsent.state !== "committed") throw new Error(`unsend was ${JSON.stringify(unsent)}`);
    const removedMessage = await alice.query(api["owner-inspection"].messageRow, { messageId: removedId });
    if (removedMessage.state !== "complete" || !("data" in removedMessage) || removedMessage.data !== null) {
      throw new Error(`unsent message was not an explicit absence: ${JSON.stringify(removedMessage)}`);
    }
    const stale = await alice.query(api.messages.nextPendingDelivery, {});
    if (!("data" in stale) || !Array.isArray(stale.data) || stale.data[0]?.messageId !== removedId) {
      throw new Error(`removed row was not first: ${JSON.stringify(stale)}`);
    }
    const outsider = await charlie.mutation(api.messages.markDelivered, { messageId: removedId });
    if (outsider.state !== "committed") throw new Error(`outsider no-op was ${JSON.stringify(outsider)}`);
    const afterOutsider = await alice.query(api.messages.nextPendingDelivery, {});
    if (!("data" in afterOutsider) || afterOutsider.data?.[0]?.messageId !== removedId) {
      throw new Error(`outsider cleared the recipient's row: ${JSON.stringify(afterOutsider)}`);
    }
    const dismissed = await alice.mutation(api.messages.markDelivered, { messageId: removedId });
    if (dismissed.state !== "committed") {
      throw new Error(`recipient could not dismiss removed row: ${JSON.stringify(dismissed)}`);
    }
    const duplicate = await alice.mutation(api.messages.markDelivered, { messageId: removedId });
    if (duplicate.state !== "committed") throw new Error(`duplicate ack was ${JSON.stringify(duplicate)}`);
    const missing = await alice.mutation(api.messages.markDelivered, { messageId: "ack-cursor-never-present" });
    if (missing.state !== "committed") throw new Error(`missing ack was ${JSON.stringify(missing)}`);

    await alice.close();
    alice = as("alice");
    const successorGroup = await alice.mutation(api.groups.groupCreate, {
      title: "Delivery after reopen",
      members: ["dev:bob" as Principal],
      conversationId: "delivery-after-reopen",
    });
    if (successorGroup.state !== "committed") {
      throw new Error(`successor group was ${JSON.stringify(successorGroup)}`);
    }

    const liveId = "ack-cursor-01-live";
    const live = await bob.mutation(api.messages.send, {
      conversationId: "delivery-after-reopen",
      body: "live after removed pending row",
      messageId: liveId,
    });
    if (live.state !== "committed") throw new Error(`live send was ${JSON.stringify(live)}`);
    const pending = await alice.query(api.messages.nextPendingDelivery, {});
    if (!("data" in pending) || !Array.isArray(pending.data) || pending.data[0]?.messageId !== liveId) {
      throw new Error(`live row was stranded: ${JSON.stringify(pending)}`);
    }
    const acknowledged = await alice.mutation(api.messages.markDelivered, { messageId: liveId });
    if (acknowledged.state !== "committed") throw new Error(`live ack was ${JSON.stringify(acknowledged)}`);
    const empty = await alice.query(api.messages.nextPendingDelivery, {});
    if (empty.state !== "complete" || !Array.isArray(empty.data) || empty.data.length !== 0) {
      throw new Error(`delivery cursor did not empty: ${JSON.stringify(empty)}`);
    }

    const formerGroup = await bob.mutation(api.groups.groupCreate, {
      title: "Former recipient boundary",
      members: ["dev:alice" as Principal],
      conversationId: "former-recipient-boundary",
    });
    if (formerGroup.state !== "committed") throw new Error(`former group was ${JSON.stringify(formerGroup)}`);
    const formerId = "ack-cursor-02-former";
    const former = await bob.mutation(api.messages.send, {
      conversationId: "former-recipient-boundary",
      body: "remove recipient before acknowledgement",
      messageId: formerId,
    });
    if (former.state !== "committed") throw new Error(`former send was ${JSON.stringify(former)}`);
    const members = await bob.query(api.groups.membershipsFor, { conversationId: "former-recipient-boundary" });
    const aliceMembership = "data" in members && Array.isArray(members.data)
      ? members.data.find((row) => row.principal === "dev:alice" as Principal)
      : undefined;
    if (!aliceMembership?.id) throw new Error(`Alice membership was absent: ${JSON.stringify(members)}`);
    const removedMember = await bob.mutation(api.groups.memberRemove, {
      conversationId: "former-recipient-boundary",
      membershipId: aliceMembership.id,
    });
    if (removedMember.state !== "committed") {
      throw new Error(`recipient removal was ${JSON.stringify(removedMember)}`);
    }
    const formerAck = await alice.mutation(api.messages.markDelivered, { messageId: formerId });
    if (formerAck.state !== "committed") throw new Error(`former recipient ack was ${JSON.stringify(formerAck)}`);
    const afterRemoval = await alice.query(api.messages.nextPendingDelivery, {});
    if (afterRemoval.state !== "complete" || !Array.isArray(afterRemoval.data) || afterRemoval.data.length !== 0) {
      throw new Error(`former recipient retained a row: ${JSON.stringify(afterRemoval)}`);
    }
  } finally {
    await Promise.all([alice.close(), bob.close(), charlie.close()]);
  }
});

journey("the pending-read head distinguishes equal-time coalesced unread-one snapshots", async ({ as, tick }) => {
  await tick(0);
  const alice = as("alice");
  const bob = as("bob");
  const conversationId = "coalesced-unread-one";
  try {
    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Coalesced unread one",
      members: ["dev:bob" as Principal],
      conversationId,
    });
    if (group.state !== "committed") throw new Error(`group was ${JSON.stringify(group)}`);
    const fixedAt = 1_789_017_600_000;
    const first = await alice.mutation(api["owner-inspection"].sendAtForTest, {
      conversationId,
      recipient: "dev:bob" as Principal,
      body: "first unread one",
      messageId: "coalesced-unread-z",
      deliveryId: "coalesced-delivery-z",
      at: fixedAt,
    });
    if (first.state !== "committed") throw new Error(`first send was ${JSON.stringify(first)}`);
    const before = await bob.query(api.messages.conversationView, { conversationId, c: null });
    if (!("data" in before) || before.data?.unread?.count !== 1
      || before.data.preview?.[0]?.messageId !== first.data.id
      || before.data.nextUnread?.[0]?.messageId !== first.data.id) {
      throw new Error(`first unread snapshot was ${JSON.stringify(before)}`);
    }
    const read = await bob.mutation(api.messages.markRead, { conversationId });
    if (read.state !== "committed") throw new Error(`read was ${JSON.stringify(read)}`);
    const second = await alice.mutation(api["owner-inspection"].sendAtForTest, {
      conversationId,
      recipient: "dev:bob" as Principal,
      body: "second unread one without observing zero",
      messageId: "coalesced-unread-a",
      deliveryId: "coalesced-delivery-a",
      at: fixedAt,
    });
    if (second.state !== "committed") throw new Error(`second send was ${JSON.stringify(second)}`);
    const after = await bob.query(api.messages.conversationView, { conversationId, c: null });
    if (!("data" in after) || after.data?.unread?.count !== 1
      || after.data.preview?.[0]?.messageId !== first.data.id
      || after.data.nextUnread?.[0]?.messageId !== second.data.id) {
      throw new Error(`second unread snapshot was ${JSON.stringify(after)}`);
    }
  } finally {
    await Promise.all([alice.close(), bob.close()]);
  }
});

journey("the private delivery cursor drains more than 50 chats", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const expected = new Set<string>();
  try {
    for (let index = 0; index < 51; index += 1) {
      const conversationId = `delivery-cursor-chat-${String(index).padStart(2, "0")}`;
      const group = await alice.mutation(api.groups.groupCreate, {
        title: `Delivery cursor ${index}`,
        members: ["dev:bob" as Principal],
        conversationId,
      });
      if (group.state !== "committed") throw new Error(`group ${index} was ${JSON.stringify(group)}`);
      const messageId = `delivery-cursor-message-${String(index).padStart(2, "0")}`;
      const sent = await alice.mutation(api.messages.send, {
        conversationId,
        body: `delivery cursor ${index}`,
        messageId,
      });
      if (sent.state !== "committed") throw new Error(`send ${index} was ${JSON.stringify(sent)}`);
      expected.add(messageId);
    }

    const acknowledged = new Set<string>();
    while (acknowledged.size < expected.size) {
      const pending = await bob.query(api.messages.nextPendingDelivery, {});
      if (
        (pending.state !== "complete" && pending.state !== "capped")
        || !Array.isArray(pending.data)
        || pending.data.length !== 1
      ) {
        throw new Error(`delivery cursor stopped at ${acknowledged.size}: ${JSON.stringify(pending)}`);
      }
      const messageId = pending.data[0]?.messageId;
      if (typeof messageId !== "string" || !expected.has(messageId) || acknowledged.has(messageId)) {
        throw new Error(`delivery cursor returned an unexpected row: ${JSON.stringify(pending)}`);
      }
      const result = await bob.mutation(api.messages.markDelivered, { messageId });
      if (result.state !== "committed") throw new Error(`ack ${messageId} was ${JSON.stringify(result)}`);
      acknowledged.add(messageId);
    }
    const empty = await bob.query(api.messages.nextPendingDelivery, {});
    if (empty.state !== "complete" || !Array.isArray(empty.data) || empty.data.length !== 0) {
      throw new Error(`delivery cursor retained a row: ${JSON.stringify(empty)}`);
    }
  } finally {
    await Promise.all([alice.close(), bob.close()]);
  }
});

journey("unread state advances a capped 50-row thread after history was acknowledged", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const conversationId = "capped-thread-unread";
  try {
    const group = await alice.mutation(api.groups.groupCreate, {
      title: "Capped thread unread",
      members: ["dev:bob" as Principal],
      conversationId,
    });
    if (group.state !== "committed") throw new Error(`group was ${JSON.stringify(group)}`);
    for (let index = 0; index < 50; index += 1) {
      const sent = await alice.mutation(api.messages.send, {
        conversationId,
        body: `acknowledged history ${index}`,
        messageId: `capped-history-${String(index).padStart(2, "0")}`,
      });
      if (sent.state !== "committed") throw new Error(`history send ${index} was ${JSON.stringify(sent)}`);
    }
    const firstRead = await bob.mutation(api.messages.markRead, { conversationId });
    if (firstRead.state !== "committed") throw new Error(`first read was ${JSON.stringify(firstRead)}`);

    const newestId = "capped-history-50";
    const newest = await alice.mutation(api.messages.send, {
      conversationId,
      body: "new unread after full page",
      messageId: newestId,
    });
    if (newest.state !== "committed") throw new Error(`newest send was ${JSON.stringify(newest)}`);
    const [thread, before] = await Promise.all([
      bob.query(api.messages.thread, { conversationId, c: null }),
      bob.query(api.messages.conversationView, { conversationId, c: null }),
    ]);
    if (thread.state !== "capped" || !Array.isArray(thread.data) || thread.data.length !== 50) {
      throw new Error(`thread was not a capped page: ${JSON.stringify(thread)}`);
    }
    if (!thread.data.some((row) => row.messageId === newestId)) {
      throw new Error(`the 51st message did not enter the capped page: ${JSON.stringify(thread)}`);
    }
    if (before.state !== "capped" || before.data?.unread?.count !== 1) {
      throw new Error(`certified unread state was not one: ${JSON.stringify(before)}`);
    }
    const secondRead = await bob.mutation(api.messages.markRead, { conversationId });
    if (secondRead.state !== "committed") throw new Error(`second read was ${JSON.stringify(secondRead)}`);
    const after = await bob.query(api.messages.conversationView, { conversationId, c: null });
    if (after.state !== "capped" || after.data?.unread?.count !== 0) {
      throw new Error(`unread state did not clear: ${JSON.stringify(after)}`);
    }
  } finally {
    await Promise.all([alice.close(), bob.close()]);
  }
});

journey("all six original-post branches feed one follower-independent counter", async ({ as, tick }) => {
  await tick(0);
  const alice = as("alice");
  try {
    const photoBytes = await fixture("fixtures/photo.jpg");
    const photo = {
      uri: `data:image/jpeg;base64,${btoa(String.fromCharCode(...photoBytes))}`,
      fileSize: photoBytes.byteLength,
      mimeType: "image/jpeg" as const,
    };
    const results = [
      await alice.mutation(api.posts.createPost, { body: "text generated id" }),
      await alice.mutation(api.posts.createPost, { body: "text explicit id", postId: "counter-text-explicit" }),
      await alice.mutation(api.posts.createImagePost, { body: "image generated id", image1: photo }),
      await alice.mutation(api.posts.createImagePost, { body: "image explicit id", image1: photo, postId: "counter-image-explicit" }),
      await alice.mutation(api.posts.createVideoPost, {
        body: "video generated id",
        clip: new File([await fixture("fixtures/clip.mp4")], "generated.mp4", { type: "video/mp4" }),
      }),
      await alice.mutation(api.posts.createVideoPost, {
        body: "video explicit id",
        clip: new File([await fixture("fixtures/clip.mp4")], "explicit.mp4", { type: "video/mp4" }),
        postId: "counter-video-explicit",
      }),
    ];
    for (const result of results) {
      if (result.state !== "committed") throw new Error(`post branch was ${result.state}`);
    }
  } finally {
    alice.close();
  }
  const bob = as("bob");
  try {
    const digest = await advanceUntil(tick, async () => {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      return "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
    }, "six post branches produced no digest");
    if (digest.newPostsInFollowing !== 6) {
      throw new Error(`six post branches counted ${String(digest.newPostsInFollowing)}`);
    }
  } finally {
    bob.close();
  }
});
