import { api } from "snapback2/client";
import { journey } from "snapback2/test";

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
