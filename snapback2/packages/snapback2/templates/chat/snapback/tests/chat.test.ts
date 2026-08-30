import { api } from "snapback2/client";
import { journey } from "snapback2/test";

journey("alice sends bob a message", async ({ as }) => {
  const alice = as("alice");
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!("data" in before) || !Array.isArray(before.data)) throw new Error("thread did not return rows");
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "conversation-1",
    recipientId: "profile-bob",
    body: "hello bob",
  });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const after = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
  if (!("data" in after) || !after.data.some((row: { body?: string }) => row.body === "hello bob")) throw new Error("sent message was not readable");
  const sideBefore = await alice.query(api.messages.thread, { conversationId: "conversation-2" });
  if (sideBefore.state !== "complete") throw new Error(`side thread was ${sideBefore.state}`);
  const rejected = await alice.mutation(api.messages.send, {
    conversationId: "conversation-2",
    recipientId: "profile-bob",
    body: "must not cross the conversation boundary",
  });
  if (rejected.state !== "rejected") throw new Error("outsider recipient received a private send");
  const sideAfter = await alice.query(api.messages.thread, { conversationId: "conversation-2" });
  if (sideAfter.state !== "complete") throw new Error(`side thread became ${sideAfter.state}`);
  if (sideAfter.seq !== sideBefore.seq) throw new Error("rejected private send committed message or outbox work");
  if (sideAfter.data.some((row: { body?: string }) => row.body === "must not cross the conversation boundary")) {
    throw new Error("rejected private send persisted its message body");
  }
});

journey("bob replies and alice's live thread updates", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const thread = alice.subscribe(
    api.messages.thread,
    { conversationId: "conversation-1" },
    () => {},
  );
  try {
    await thread.until((delivery) => delivery.state === "complete");
    const sent = await bob.mutation(api.messages.send, {
      conversationId: "conversation-1",
      recipientId: "profile-alice",
      body: "hello alice",
    });
    if (sent.state !== "committed") throw new Error(`reply was ${sent.state}`);
    await thread.until((delivery) =>
      "data" in delivery
      && Array.isArray(delivery.data)
      && delivery.data.some((row: { body?: string }) => row.body === "hello alice")
    );
  } finally {
    thread.close();
  }
});

journey("profile ownership, uniqueness, and live public reads", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  const profile = bob.subscribe(api.profiles.byHandle, { handle: "alice" }, () => {});
  try {
    await profile.until((delivery) =>
      delivery.state === "complete"
      && "data" in delivery
      && delivery.data?.displayName === "Alice"
    );
    const updated = await alice.mutation(api.profiles.updateMyProfile, {
      displayName: "Alice Updated",
      handle: "alice",
      avatarUrl: "https://example.com/alice.png",
      bio: "building with Snapback",
      location: "",
    });
    if (updated.state !== "committed") throw new Error(`profile update was ${updated.state}`);
    await profile.until((delivery) =>
      delivery.state === "complete"
      && "data" in delivery
      && delivery.data?.displayName === "Alice Updated"
      && delivery.data?.principal === "dev:alice"
    );
    const duplicate = await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie",
      handle: "bob",
      bio: "",
      location: "",
    });
    if (duplicate.state !== "rejected") throw new Error("duplicate public handle was admitted");
  } finally {
    profile.close();
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("unfollow changes Following selection but not Global authorization", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const alicePrincipal = (await alice.auth.me()).viewer;
  const following = bob.subscribe(api.feeds.followingFeed, {}, () => {});
  try {
    const before = await following.until((delivery) =>
      delivery.state === "complete"
      && "data" in delivery
      && delivery.data.some((item: { post?: { id?: string } }) => item.post?.id === "post-alice")
    );
    if (before.state !== "complete") throw new Error("Following did not become complete");
    const beforeSeq = before.seq;
    const unfollowed = await bob.mutation(api.follows.setFollow, {
      target: alicePrincipal,
      following: false,
    });
    if (unfollowed.state !== "committed") throw new Error(`unfollow was ${unfollowed.state}`);
    await following.until((delivery) =>
      delivery.state === "complete"
      && delivery.seq > beforeSeq
      && "data" in delivery
      && !delivery.data.some((item: { post?: { id?: string } }) => item.post?.id === "post-alice")
    );
    const global = await bob.query(api.feeds.globalFeed, {});
    if ((global.state !== "complete" && global.state !== "capped")
      || !global.data.some((item: { post?: { id?: string } }) => item.post?.id === "post-alice")) {
      throw new Error("unfollow incorrectly revoked a globally readable post");
    }
    const restored = await bob.mutation(api.follows.setFollow, {
      target: alicePrincipal,
      following: true,
    });
    if (restored.state !== "committed") throw new Error(`follow restore was ${restored.state}`);
  } finally {
    following.close();
    alice.close();
    bob.close();
  }
});

journey("group creation bootstraps one creator admin atomically", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  try {
    const alicePrincipal = (await alice.auth.me()).viewer;
    const bobPrincipal = (await bob.auth.me()).viewer;
    const charliePrincipal = (await charlie.auth.me()).viewer;
    const tooSmall = await alice.mutation(api.groups.groupCreate, {
      title: "Nobody else",
      members: [],
    });
    if (tooSmall.state !== "rejected") throw new Error("one-person group was admitted");
    const duplicate = await alice.mutation(api.groups.groupCreate, {
      title: "Duplicate seats",
      members: [bobPrincipal, bobPrincipal],
    });
    if (duplicate.state !== "rejected") throw new Error("duplicate group seats committed partially");
    const created = await alice.mutation(api.groups.groupCreate, {
      title: "Project room",
      members: [bobPrincipal],
    });
    if (created.state !== "committed") throw new Error(`group creation was ${created.state}`);
    const selfReseat = await alice.mutation(api.groups.memberAdd, {
      conversationId: created.data.id,
      principal: alicePrincipal,
    });
    if (selfReseat.state !== "rejected") throw new Error("creator acquired a second seat");
    const added = await alice.mutation(api.groups.memberAdd, {
      conversationId: created.data.id,
      principal: charliePrincipal,
    });
    if (added.state !== "committed") throw new Error("creator admin could not add a member");
    const left = await alice.mutation(api.groups.memberLeave, {
      conversationId: created.data.id,
      membershipId: created.data.creatorMembershipId,
    });
    if (left.state !== "committed") throw new Error("sole admin could not leave explicitly");
    const rebootstrap = await alice.mutation(api.groups.memberAdd, {
      conversationId: created.data.id,
      principal: alicePrincipal,
    });
    if (rebootstrap.state !== "rejected") {
      throw new Error("departed creator reused bootstrap authority in an adminless group");
    }
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

journey("scoped roles reject non-admin and stale membership authority", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const charlie = as("charlie");
  try {
    const bobPrincipal = (await bob.auth.me()).viewer;
    const charliePrincipal = (await charlie.auth.me()).viewer;
    const deniedAdd = await bob.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: charliePrincipal,
    });
    if (deniedAdd.state !== "rejected") throw new Error("non-admin added a member");
    const deniedRemove = await bob.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: "membership-1",
    });
    if (deniedRemove.state !== "rejected") throw new Error("non-admin removed a member");
    const crossScopePromote = await alice.mutation(api.groups.memberPromote, {
      conversationId: "conversation-1",
      membershipId: "membership-4",
    });
    if (crossScopePromote.state !== "rejected") throw new Error("promote trusted a caller-selected scope");
    const crossScopeRemove = await alice.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: "membership-4",
    });
    if (crossScopeRemove.state !== "rejected") throw new Error("remove trusted a caller-selected scope");
    const charlieEscalated = await charlie.mutation(api.groups.memberAdd, {
      conversationId: "conversation-2",
      principal: bobPrincipal,
    });
    if (charlieEscalated.state !== "rejected") throw new Error("cross-scope promote changed the target role");
    const sideThread = await charlie.query(api.messages.thread, { conversationId: "conversation-2" });
    if (sideThread.state !== "complete") throw new Error("cross-scope remove deleted the target seat");
    const selfRemove = await alice.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: "membership-1",
    });
    if (selfRemove.state !== "rejected") throw new Error("admin bypassed the named leave path");
    const added = await alice.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: charliePrincipal,
    });
    if (added.state !== "committed") throw new Error(`admin add was ${added.state}`);
    const promoted = await alice.mutation(api.groups.memberPromote, {
      conversationId: "conversation-1",
      membershipId: added.data.id,
    });
    if (promoted.state !== "committed") throw new Error(`admin promote was ${promoted.state}`);
    const removed = await charlie.mutation(api.groups.memberRemove, {
      conversationId: "conversation-1",
      membershipId: "membership-2",
    });
    if (removed.state !== "committed") throw new Error(`admin removal was ${removed.state}`);
    const deniedThread = await bob.query(api.messages.thread, { conversationId: "conversation-1" });
    if (deniedThread.state !== "denied") throw new Error("removed member retained thread access");
    const replacement = await alice.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: bobPrincipal,
    });
    if (replacement.state !== "committed") throw new Error("member could not be re-added");
    const charlieLeft = await charlie.mutation(api.groups.memberLeave, {
      conversationId: "conversation-1",
      membershipId: added.data.id,
    });
    if (charlieLeft.state !== "committed") throw new Error("member could not leave");
    const staleReplay = await alice.mutation(api.groups.memberPromote, {
      conversationId: "conversation-1",
      membershipId: "membership-2",
    });
    if (staleReplay.state !== "rejected") throw new Error("stale membership id retargeted its replacement");
    const bobStillMember = await bob.mutation(api.groups.memberAdd, {
      conversationId: "conversation-1",
      principal: charliePrincipal,
    });
    if (bobStillMember.state !== "rejected") throw new Error("stale promote changed the successor seat");
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});
