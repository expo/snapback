import { api } from "snapback2/client";
import { subscribe } from "snapback2/internal";
import { fixture, journey } from "snapback2/test";

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
  await tick(120_000);
  const bob = as("bob");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
      if (digest) {
        if (digest.periodStart !== sourcePeriodStart || digest.periodEnd !== sourcePeriodStart + 120_000) {
          throw new Error(`digest period was ${String(digest.periodStart)}..${String(digest.periodEnd)}`);
        }
        if (digest.newPostsInFollowing !== 1) {
          throw new Error(`following post count was ${String(digest.newPostsInFollowing)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("following activity produced no digest");
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
        members: ["dev:charlie"],
        conversationId: `digest-envelope-${index}`,
      });
      if (group.state !== "committed") throw new Error(`group ${index} was ${group.state}`);
    }
    const refused = await bob.mutation(api.groups.groupCreate, {
      title: "Digest envelope refused 101",
      members: ["dev:charlie"],
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
  await tick(120_000);
  const reopened = as("bob");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await reopened.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
      if (digest) {
        if (digest.newPostsInFollowing !== 1) {
          throw new Error(`100-membership following count was ${String(digest.newPostsInFollowing)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("100-membership activity produced no digest");
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
  await tick(120_000);
  const bob = as("bob");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digests = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      if (digests.length === 1) {
        if (digests[0]?.unreadMessages !== 1 || digests[0]?.unreadChats !== 1) {
          throw new Error(`first digest payload was ${JSON.stringify(digests[0])}`);
        }
        break;
      }
      if (attempt === 99) throw new Error(`first period produced ${digests.length} digests`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    bob.close();
  }
  const thirdClock = await tick(120_000);
  const thirdNow = Date.now() + Number(thirdClock.offsetMs ?? 0);
  const thirdPeriodStart = thirdNow - ((thirdNow % 120_000) + 120_000) % 120_000;
  const poster = as("alice");
  try {
    const post = await poster.mutation(api.posts.createPost, { body: "activity after one quiet period" });
    if (post.state !== "committed") throw new Error(`third-period post was ${post.state}`);
  } finally {
    poster.close();
  }
  await tick(120_000);
  const reopened = as("bob");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await reopened.query(api.messages.pushRecent, { c: null });
      const digests = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      if (digests.some((row) => row.periodStart === thirdPeriodStart)) {
        if (digests.length !== 2) throw new Error(`active/quiet/active left ${digests.length} digest rows`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("third active period produced no digest");
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
        row.kind === "expired" && row.messageId === sent.data.id));
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

journey("expiry policy covers off explicit photo video and view-once sends", async ({ as, tick }) => {
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
    if (noExpiry.state !== "committed") throw new Error(`off-policy send was ${noExpiry.state}`);
    if (explicit.state !== "committed") throw new Error(`explicit-policy send was ${explicit.state}`);
    if (photoSent.state !== "committed") throw new Error(`photo send was ${photoSent.state}`);
    if (onceSent.state !== "committed") throw new Error(`view-once send was ${onceSent.state}`);
    if (clipSent.state !== "committed") throw new Error(`clip send was ${clipSent.state}`);
    const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("policy thread was not a page");
    const rows = new Map(thread.data.flatMap((row) => row.message ? [[row.message.id, row.message] as const] : []));
    if (rows.get(noExpiry.data.id)?.expiresAt !== null) throw new Error("off policy stored a deadline");
    if (rows.get(explicit.data.id)?.expiresAt !== explicitAt) throw new Error("explicit deadline lost precedence");
    for (const id of [photoSent.data.id, onceSent.data.id, clipSent.data.id]) {
      const row = rows.get(id);
      if (typeof row?.expiresAt !== "number" || typeof row.at !== "number") {
        throw new Error(`media ${id} stored ${JSON.stringify(row)}`);
      }
      if (row.expiresAt - row.at !== 300_000) {
        throw new Error(`media ${id} expiry delta was ${row.expiresAt - row.at}`);
      }
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
      const reset = await charlie.mutation(api.follows.setFollow, { target: "dev:bob", following: false });
      if (reset.state !== "committed") throw new Error(`barrier unfollow was ${reset.state}`);
    }
    signal += 1;
    const follow = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob",
      following: true,
      mutationId: `digest-barrier-${signal}`,
    });
    if (follow.state !== "committed") throw new Error(`barrier follow was ${follow.state}`);
    offset = Number((await tick(120_000)).offsetMs ?? offset);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === periodStart)
        : undefined;
      if (digest) {
        const unreadChats = unreadMessages > 0 ? 1 : 0;
        if (digest.newFollowers !== 1 || digest.newPostsInFollowing !== posts
          || digest.unreadMessages !== unreadMessages || digest.unreadChats !== unreadChats) {
          throw new Error(`period ${periodStart} payload was ${JSON.stringify(digest)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`period ${periodStart} did not finish its digest job`);
  };
  try {
    const profile = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "digest_charlie",
      bio: "",
      location: "",
    });
    if (profile.state !== "committed") throw new Error(`barrier profile was ${profile.state}`);

    const unfollowedPeriod = period();
    const dropped = await alice.mutation(api.posts.createPost, { body: "unfollowed before emission" });
    if (dropped.state !== "committed") throw new Error(`unfollowed post was ${dropped.state}`);
    const unfollow = await bob.mutation(api.follows.setFollow, { target: "dev:alice", following: false });
    if (unfollow.state !== "committed") throw new Error(`unfollow was ${unfollow.state}`);
    await finishPeriod(unfollowedPeriod);

    const readPeriod = period();
    const refollow = await bob.mutation(api.follows.setFollow, {
      target: "dev:alice",
      following: true,
      mutationId: "digest-revalidate-refollow",
    });
    if (refollow.state !== "committed") throw new Error(`refollow was ${refollow.state}`);
    const readMessage = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "read before digest",
    });
    if (readMessage.state !== "committed") throw new Error(`read message was ${readMessage.state}`);
    const read = await bob.mutation(api.messages.markRead, { conversationId: "conversation-1" });
    if (read.state !== "committed") throw new Error(`mark read was ${read.state}`);
    await finishPeriod(readPeriod);

    const unsentPeriod = period();
    const unsentMessage = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "unsent before digest",
    });
    if (unsentMessage.state !== "committed") throw new Error(`unsent message was ${unsentMessage.state}`);
    const unsent = await alice.mutation(api.messages.unsend, { messageId: unsentMessage.data.id });
    if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
    await finishPeriod(unsentPeriod);

    const leavePeriod = period();
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
      principal: "dev:bob",
    });
    if (afterLeave.state !== "committed") throw new Error(`member restore after leave was ${afterLeave.state}`);
    await finishPeriod(leavePeriod);

    const removedPeriod = period();
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
      principal: "dev:bob",
    });
    if (restored.state !== "committed") throw new Error(`member restore was ${restored.state}`);
    await finishPeriod(removedPeriod);

    const expiryPeriod = period();
    const expires = await alice.mutation(api.messages.send, {
      conversationId: "conversation-1",
      body: "expires before digest",
      expiresAt: Date.now() + offset + 1_000,
    });
    if (expires.state !== "committed") throw new Error(`expiring message was ${expires.state}`);
    offset = Number((await tick(1_001)).offsetMs ?? offset);
    await finishPeriod(expiryPeriod);

    const admittedPeriod = period();
    const admitted = await alice.mutation(api.posts.createPost, { body: "admitted after exclusions" });
    if (admitted.state !== "committed") throw new Error(`admitted post was ${admitted.state}`);
    await finishPeriod(admittedPeriod, 1);
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("period unread custody rejects peers and former authors and prunes old membership incarnations", async ({ as, tick }) => {
  const initial = await tick(0);
  let offset = Number(initial.offsetMs ?? 0);
  const periodStart = () => {
    const current = Date.now() + offset;
    return current - ((current % 120_000) + 120_000) % 120_000;
  };
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  const waitForDigest = async (expectedPeriod: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest" && row.periodStart === expectedPeriod)
        : undefined;
      if (digest) {
        if (digest.unreadMessages !== 0 || digest.unreadChats !== 0) {
          throw new Error(`stale incarnation entered digest ${JSON.stringify(digest)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`period ${expectedPeriod} did not finish its digest job`);
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
      members: ["dev:bob"],
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
      recipient: "dev:bob",
    });
    if (!("data" in authorRow) || authorRow.data?.messageId !== authored.data.id) {
      throw new Error(`current author could not inspect period custody: ${JSON.stringify(authorRow)}`);
    }
    const recipientRow = await bob.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob",
    });
    if (!("data" in recipientRow) || recipientRow.data?.messageId !== authored.data.id) {
      throw new Error(`recipient could not inspect period custody: ${JSON.stringify(recipientRow)}`);
    }
    const peerRow = await charlie.query(api["owner-inspection"].periodUnreadRow, {
      messageId: authored.data.id,
      recipient: "dev:bob",
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
      recipient: "dev:bob",
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
      principal: "dev:bob",
    });
    if (restored.state !== "committed") throw new Error(`member restore was ${restored.state}`);
    const afterRestore = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
    const stale = "data" in afterRestore && Array.isArray(afterRestore.data)
      ? afterRestore.data.find((row) => row.messageId === sent.data.id)
      : undefined;
    if (!stale || stale.membershipId === restored.data.id) {
      throw new Error(`membership incarnation was not retained distinctly: ${JSON.stringify(afterRestore)}`);
    }

    const firstBarrier = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob",
      following: true,
      mutationId: "period-prune-barrier-1",
    });
    if (firstBarrier.state !== "committed") throw new Error(`first barrier was ${firstBarrier.state}`);
    offset = Number((await tick(120_000)).offsetMs ?? offset);
    await waitForDigest(stalePeriod);
    const held = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
    if (!("data" in held) || !Array.isArray(held.data)
      || !held.data.some((row) => row.messageId === sent.data.id)) {
      throw new Error("prune raced the last completed digest bucket");
    }

    const nextPeriod = periodStart();
    const unfollow = await charlie.mutation(api.follows.setFollow, { target: "dev:bob", following: false });
    if (unfollow.state !== "committed") throw new Error(`barrier unfollow was ${unfollow.state}`);
    const secondBarrier = await charlie.mutation(api.follows.setFollow, {
      target: "dev:bob",
      following: true,
      mutationId: "period-prune-barrier-2",
    });
    if (secondBarrier.state !== "committed") throw new Error(`second barrier was ${secondBarrier.state}`);
    offset = Number((await tick(120_000)).offsetMs ?? offset);
    await waitForDigest(nextPeriod);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pruned = await bob.query(api["owner-inspection"].myPeriodUnread, { conversationId: "conversation-1", c: null });
      if ("data" in pruned && Array.isArray(pruned.data)
        && !pruned.data.some((row) => row.messageId === sent.data.id)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("old membership incarnation was not pruned");
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("replay mode skips a period and a post retry stays exactly once", async ({ as, tick }) => {
  const initial = await tick(0);
  let offset = Number(initial.offsetMs ?? 0);
  const alice = as("alice", { store: "file" });
  const bob = as("bob", { store: "file" });
  try {
    const replayPeriodNow = Date.now() + offset;
    const replayPeriod = replayPeriodNow - ((replayPeriodNow % 120_000) + 120_000) % 120_000;
    const replayOn = await alice.mutation(api.admin.setReplayMode, { enabled: true });
    if (replayOn.state !== "committed") throw new Error(`replay enable was ${replayOn.state}`);
    const skipped = await alice.mutation(api.posts.createPost, { body: "replay period" });
    if (skipped.state !== "committed") throw new Error(`replay post was ${skipped.state}`);
    offset = Number((await tick(120_000)).offsetMs ?? offset);
    const replayOff = await alice.mutation(api.admin.setReplayMode, { enabled: false });
    if (replayOff.state !== "committed") throw new Error(`replay disable was ${replayOff.state}`);
    const acceptedNow = Date.now() + offset;
    const acceptedPeriod = acceptedNow - ((acceptedNow % 120_000) + 120_000) % 120_000;
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
    if (afterFault.length !== 1 || afterFault[0]?.state !== "queued") {
      throw new Error(`post retry lost custody: ${JSON.stringify(afterFault)}`);
    }
    await retrying.outbox.drain();
    const settled = await retrying.outbox.entries();
    if (settled.length !== 1 || settled[0]?.state !== "committed") {
      throw new Error(`post retry settled as ${JSON.stringify(settled)}`);
    }
    await bob.offline();
    const cold = await bob.restart();
    await tick(120_000);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await cold.query(api.messages.pushRecent, { c: null });
      const digests = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.filter((row) => row.kind === "digest")
        : [];
      if (digests.some((row) => row.periodStart === acceptedPeriod)) {
        if (digests.some((row) => row.periodStart === replayPeriod)) throw new Error("replay period emitted");
        const final = digests.find((row) => row.periodStart === acceptedPeriod);
        if (digests.length !== 1 || final?.newPostsInFollowing !== 1) {
          throw new Error(`retry/restart payload was ${JSON.stringify(digests)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("post-replay period produced no digest");
  } finally {
    alice.close();
    bob.close();
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
  await tick(120_000);
  const bob = as("bob");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pushes = await bob.query(api.messages.pushRecent, { c: null });
      const digest = "data" in pushes && Array.isArray(pushes.data)
        ? pushes.data.find((row) => row.kind === "digest")
        : undefined;
      if (digest) {
        if (digest.newPostsInFollowing !== 6) {
          throw new Error(`six post branches counted ${String(digest.newPostsInFollowing)}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("six post branches produced no digest");
  } finally {
    bob.close();
  }
});
