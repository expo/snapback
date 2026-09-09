import { api, mutationTarget, type ImageAsset } from "snapback2/client";
import { fixture, journey } from "snapback2/test";
const postedMessage = mutationTarget(api.messages.send, "messages");

type LogRow = { kind?: string; messageId?: string; message?: { id?: string; body?: string | null } | null };

function bodies(rows: unknown): string[] {
  return Array.isArray(rows)
    ? rows.map((row: LogRow) => row.message?.body).filter((body): body is string => typeof body === "string")
    : [];
}

journey("alice posts to the room and a non-member cannot", async ({ as }) => {
  const alice = as("alice");
  const charlie = as("charlie");
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if ((before.state !== "complete" && before.state !== "capped") || !Array.isArray(before.data)) throw new Error("thread did not return rows");
  const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "hello bob" });
  if (sent.state !== "committed") throw new Error(`post was ${sent.state}`);
  const after = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in after) || !after.data?.some((row: LogRow) => row.message?.body === "hello bob")) throw new Error("posted message was not readable through the log");
  const rejected = await charlie.mutation(api.messages.send, {
    conversationId: "conversation-1",
    body: "must not cross the membership boundary",
  });
  if (rejected.state !== "rejected") throw new Error("a non-member posted into a private room");
  const sideAfter = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (sideAfter.state !== "complete") throw new Error(`thread became ${sideAfter.state}`);
  if (sideAfter.seq !== after.seq) throw new Error("rejected post committed message or delivery work");
  if (bodies(sideAfter.data).includes("must not cross the membership boundary")) {
    throw new Error("rejected post persisted its message body");
  }
  charlie.close();
});

journey("bob replies and alice's live log thread updates", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const thread = alice.subscribe(
    api.messages.thread,
    { conversationId: "conversation-1", c: null },
    () => {},
  );
  try {
    await thread.until((delivery) => delivery.state === "complete");
    const sent = await bob.mutation(api.messages.send, { conversationId: "conversation-1", body: "hello alice" });
    if (sent.state !== "committed") throw new Error(`reply was ${sent.state}`);
    await thread.until((delivery) => "data" in delivery && bodies(delivery.data).includes("hello alice"));
  } finally {
    thread.close();
  }
});

journey("alice sends and reads back a JPEG photo and MP4 clip", async ({ as }) => {
  const alice = as("alice");
  const charlie = as("charlie");
  try {
    const validJpeg = await fixture("fixtures/photo.jpg");
    const photoSent = await alice.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1",
      photo: {
        uri: `data:image/jpeg;base64,${btoa(String.fromCharCode(...validJpeg))}`,
        fileSize: validJpeg.byteLength,
        mimeType: "image/jpeg",
      },
    });
    if (photoSent.state !== "committed") throw new Error(`photo send was ${photoSent.state}`);
    const clipSent = await alice.mutation(api.messages.sendClip, {
      conversationId: "conversation-1",
      clip: new File([await fixture("fixtures/clip.mp4")], "clip.mp4", { type: "video/mp4" }),
    });
    if (clipSent.state !== "committed") throw new Error(`clip send was ${clipSent.state}`);
    if (clipSent.data.duration !== 2_000) throw new Error(`clip duration was ${clipSent.data.duration}`);

    const orphan = await charlie.upload(new File(
      [validJpeg.buffer as ArrayBuffer],
      "orphan-after-rejection.jpg",
      { type: "image/jpeg" },
    ), { kind: "image" });
    const rejected = await charlie.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1",
      photo: orphan,
    });
    if (rejected.state !== "rejected") throw new Error("asset mutation unexpectedly accepted an outsider");
    // The successful upload remains unclaimed, so the server's locator-null
    // reclamation pass can collect this orphan.

    const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
    if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("asset thread did not return rows");
    const photo = thread.data.find((row) => row.messageId === photoSent.data.id)?.message?.photo;
    const clip = thread.data.find((row) => row.messageId === clipSent.data.id)?.message?.clip;
    if (!photo || photo.width !== 8 || photo.height !== 8) throw new Error("JPEG record was not readable");
    if (!clip || clip.width !== 2 || clip.height !== 2 || clip.duration !== 2_000) {
      throw new Error("MP4 record was not readable");
    }
    const photoUrl = await alice.assetUrl(photo);
    const clipUrl = await alice.assetUrl(clip, { carrier: true });
    if (!photoUrl || !clipUrl) throw new Error("asset delivery URLs were absent");
    if (new URL(photoUrl).searchParams.has("s")) throw new Error("photo URL carried a session token");
    if (!new URL(clipUrl).searchParams.has("s")) throw new Error("private clip URL lacked its persona carrier");
    if ((await alice.assetBlob(photoUrl)).size === 0) throw new Error("JPEG delivery was empty");
    const clipResponse = await fetch(clipUrl);
    if (!clipResponse.ok || (await clipResponse.blob()).size === 0) throw new Error("carried MP4 delivery was empty");
  } finally {
    alice.close();
    charlie.close();
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
  const following = bob.subscribe(api.feeds.followingFeed, { c: null }, () => {});
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
    const global = await bob.query(api.feeds.globalFeed, { c: null });
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

journey("conversation metadata stays inside membership", async ({ as }) => {
  const bob = as("bob");
  const charlie = as("charlie");
  try {
    const member = await bob.query(api.messages.conversationView, { conversationId: "conversation-1" });
    if (!("data" in member) || typeof member.data?.count !== "number") {
      throw new Error("member could not read the maintained message count");
    }

    const outsider = await charlie.query(api.messages.conversationView, { conversationId: "conversation-1" });
    if (outsider.state !== "denied") throw new Error("conversation metadata query admitted an outsider");
  } finally {
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
    const sideThread = await charlie.query(api.messages.thread, { conversationId: "conversation-2", c: null });
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
    const deniedThread = await bob.query(api.messages.thread, { conversationId: "conversation-1", c: null });
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

journey("offline drain removes an unsent body and survives a cold restart", async ({ as }) => {
  const alice = as("alice", { store: "file" });
  const drain = alice.subscribe(
    api.messages.inbox,
    { c: null },
    () => undefined,
    { drain: true },
  );
  await drain.until((value) =>
    (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  await alice.offline();
  const owner = as("alice");
  const unsent = await owner.mutation(api.messages.unsend, { messageId: "message-1" });
  if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
  owner.close();
  await alice.online();
  await drain.until((value) => "data" in value
    && Array.isArray(value.data)
    && value.data.some((row: { kind?: string; messageId?: string }) =>
      row.kind === "removed" && row.messageId === "message-1"));
  // Pin the current head for the derived cold-replay comparison. A local
  // notification may show the tombstone before the tail's decode completes.
  await alice.query(api.messages.inbox, { c: null });
  drain.close();
  await alice.offline();
  const cold = await alice.restart();
  const held = await cold.query(api.messages.inbox, { c: null });
  if ((held.state !== "complete" && held.state !== "capped" && held.state !== "partial")
    || !("connection" in held) || held.connection !== "offline" || !Array.isArray(held.data)) {
    throw new Error("cold offline inbox did not render its held answer");
  }
  if (JSON.stringify(held.data).includes("Welcome")) {
    throw new Error("unsent message body survived in the cold held inbox");
  }
});

journey("viewed photos render from the byte cache offline; a view-once photo and an unsent row do not", async ({ as }) => {
  let viewOnceId: string | undefined;
  const alice = as("alice", { store: "file" });
  const owner = as("alice");
  try {
    const validJpeg = await fixture("fixtures/photo.jpg");
    const sent: Array<{ id: string; photo: ImageAsset }> = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await owner.mutation(index === 2 ? api.messages.sendOncePhoto : api.messages.sendPhoto, {
        conversationId: "conversation-1",
        photo: {
          uri: `data:image/jpeg;base64,${btoa(String.fromCharCode(...validJpeg))}`,
          fileSize: validJpeg.byteLength,
          mimeType: "image/jpeg",
        },
      });
      if (result.state !== "committed") throw new Error(`photo ${index} send was ${result.state}`);
      const photo = result.data.photo;
      if (!photo) throw new Error(`photo ${index} record was absent`);
      sent.push({ id: result.data.id, photo });
    }
    viewOnceId = sent[2]!.id;
    const thread = alice.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => undefined);
    await thread.until((delivery) => (delivery.state === "complete" || delivery.state === "capped")
      && "data" in delivery
      && Array.isArray(delivery.data)
      && sent.every((message) => delivery.data.some((row: { messageId?: string; message?: { id?: string } | null }) => row.message?.id === message.id)));
    thread.close();
    const urls: string[] = [];
    for (const message of sent) {
      const url = await alice.assetUrl(message.photo, { width: message.photo.width });
      if (!url) throw new Error("photo delivery URL was absent");
      // Viewing fills the byte cache; the third row is view-once and is marked viewed instead.
      const viewing = {};
      if ((await alice.assetBlob(url, { viewing })).size === 0) throw new Error("photo delivery was empty");
      urls.push(url);
    }
    await alice.offline();
    const cold = await alice.restart();
    for (const url of urls.slice(0, 2)) {
      if ((await cold.assetBlob(url)).size === 0) throw new Error("a viewed photo did not render from the byte cache offline");
    }
    let viewedRefused = false;
    try {
      await cold.assetBlob(urls[2]!);
    } catch (error) {
      viewedRefused = (error as { code?: string }).code === "E_ASSET_VIEWED";
    }
    if (!viewedRefused) throw new Error("a viewed view-once photo rendered again after the restart");
    const held = await cold.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    if (!("data" in held) || !Array.isArray(held.data) || held.data.some((row: { messageId?: string; message?: { id?: string } | null } | null) => row?.message?.id === viewOnceId)) {
      throw new Error("a viewed view-once row survived in the held thread");
    }
    const mounted = cold.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => undefined);
    await mounted.until((delivery) => "data" in delivery && Array.isArray(delivery.data));
    const unsent = await owner.mutation(api.messages.unsend, { messageId: sent[0]!.id });
    if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
    await cold.online();
    await mounted.until((delivery) => delivery.live === true
      && "data" in delivery
      && Array.isArray(delivery.data)
      && !delivery.data.some((row: { messageId?: string; message?: { id?: string } | null } | null) => row?.message?.id === sent[0]!.id));
    mounted.close();
    await cold.offline();
    let gone = false;
    try {
      await cold.assetBlob(urls[0]!);
    } catch (error) {
      gone = (error as { code?: string }).code === "E_NETWORK";
    }
    if (!gone) throw new Error("an unsent row's bytes survived the resume");
    if ((await cold.assetBlob(urls[1]!)).size === 0) throw new Error("the kept photo lost its bytes on resume");
  } finally {
    owner.close();
  }
});

journey("offline sends queue, survive a restart, replay in order, and a 503 after a commit is exactly once", async ({ as }) => {
  const alice = as("alice", { store: "file" });
  const drain = alice.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  drain.close();
  await alice.offline();
  const first = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued one" });
  const second = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued two" });
  if (first.state !== "queued" || second.state !== "queued") throw new Error(`offline sends were ${first.state} and ${second.state}`);
  const cold = await alice.restart();
  const queued = await cold.outbox.entries();
  if (queued.map((entry) => `${entry.intent}:${entry.state}`).join(" ") !== `${first.intent}:queued ${second.intent}:queued`) {
    throw new Error(`the outbox did not survive the restart in order: ${JSON.stringify(queued.map((entry) => [entry.intent, entry.state]))}`);
  }
  cold.failNextResponse("/api/mutation", 503);
  await cold.online();
  await cold.settled();
  const afterFault = await cold.outbox.entries();
  if (afterFault.some((entry) => entry.state !== "queued")) throw new Error("a 503 after the commit settled an intent");
  await cold.outbox.drain();
  const settled = await cold.outbox.entries();
  if (settled.map((entry) => entry.state).join() !== "committed,committed") {
    throw new Error(`replay settled as ${settled.map((entry) => entry.state).join()}`);
  }
  const tail = cold.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await tail.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  const thread = await cold.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("thread did not return rows");
  const rows = thread.data.filter((row: LogRow) => row.message?.body === "queued one" || row.message?.body === "queued two");
  if (rows.length !== 2) throw new Error(`expected exactly one row per send, saw ${rows.length}`);
  // `last 50` pages newest-first: the second send precedes the first.
  if (rows[0]?.message?.id !== postedMessage.id(queued.find(entry => entry.intent === second.intent)!) || rows[1]?.message?.id !== postedMessage.id(queued.find(entry => entry.intent === first.intent)!)) {
    throw new Error("server rows do not carry the pinned ids in send order");
  }
  await tail.until((value) => "data" in value && bodies(value.data).includes("queued two"));
  tail.close();
});

journey("offline edits reject stale reads by trace, and past-fence edits by the program CONFLICT", async ({ as }) => {
  const alice = as("alice", { store: "file" });
  const drain = alice.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  const posted = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "original" });
  if (posted.state !== "committed") throw new Error(`post was ${posted.state}`);
  const second = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "left alone" });
  if (second.state !== "committed") throw new Error(`second post was ${second.state}`);
  await drain.until((value) => "data" in value && bodies(value.data).includes("original") && bodies(value.data).includes("left alone"));
  await alice.offline();
  const edit = await alice.mutation(api.messages.edit, { messageId: posted.data.id, body: "mine", baseBody: "original" });
  if (edit.state !== "queued") throw new Error(`offline edit was ${edit.state}`);
  // A second message nobody else touches: the same edit with a trace that still holds commits.
  const untouched = await alice.mutation(api.messages.edit, { messageId: second.data.id, body: "left alone, edited", baseBody: "left alone" });
  if (untouched.state !== "queued") throw new Error(`the second offline edit was ${untouched.state}`);
  const queued = await alice.outbox.entries();
  for (const intent of [edit.intent, untouched.intent]) {
    const item = queued.find(item => item.intent === intent);
    if (item?.state !== "queued") throw new Error(`offline edit ${intent} was not retained as queued`);
    const point = item.trace?.points.find((candidate) => candidate.table === "messages" && candidate.index === "byId");
    if (item.predicted !== true || !point || !/^[0-9a-f]{64}$/.test(point.digest ?? "")) {
      throw new Error(`the offline edit was queued without its trace: ${JSON.stringify(item.trace)}`);
    }
  }
  const owner = as("alice");
  const theirs = await owner.mutation(api.messages.edit, { messageId: posted.data.id, body: "theirs", baseBody: "original" });
  if (theirs.state !== "committed") throw new Error(`the owner's edit was ${theirs.state}`);
  owner.close();
  await alice.online();
  await alice.settled();
  const entry = (await alice.outbox.entries()).find((item) => item.intent === edit.intent);
  if (entry?.state !== "rejected") throw new Error(`the stale edit settled as ${entry?.state}`);
  const response = entry.response as { code?: string; reason?: string; site?: string };
  // Trace validation names the moved read before the program's own `CONFLICT` can.
  if (response.reason !== "conflict" || response.code !== "E_OFFLINE_CONFLICT" || typeof response.site !== "string") {
    throw new Error(`the stale edit was refused for another reason: ${JSON.stringify(response)}`);
  }
  const matching = (await alice.outbox.entries()).find((item) => item.intent === untouched.intent);
  if (matching?.state !== "committed") throw new Error(`the matching edit settled as ${matching?.state}: ${JSON.stringify(matching?.response)}`);
  await drain.until((value) => "data" in value && bodies(value.data).includes("theirs"));
  const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in thread) || !bodies(thread.data).includes("theirs") || bodies(thread.data).includes("mine")) {
    throw new Error("the conflict did not leave the owner's edit in place");
  }
  // Past the default seven-day fence the twin does not run and there is no
  // trace OCC. The certified edit's compare-and-set must reject the stale base.
  const originalNow = Date.now;
  const pastFenceNow = originalNow() + 8 * 24 * 60 * 60 * 1000;
  try {
    await alice.offline();
    Date.now = () => pastFenceNow;
    const late = await alice.mutation(api.messages.edit, { messageId: posted.data.id, body: "late edit", baseBody: "original" });
    if (late.state !== "queued") throw new Error(`past-fence edit was ${late.state}`);
    const pending = (await alice.outbox.entries()).find((item) => item.intent === late.intent);
    if (pending?.predicted !== false || pending.reason !== "fence"
      || pending.trace?.points.length !== 0 || pending.trace?.verdicts.length !== 0) {
      throw new Error(`past-fence edit was not marked unpredicted with an empty trace: ${JSON.stringify(pending)}`);
    }
    await alice.online();
    await alice.settled();
    const terminal = (await alice.outbox.entries()).find((item) => item.intent === late.intent);
    const refusal = terminal?.response as { code?: string; reason?: string };
    if (terminal?.state !== "rejected" || refusal.code !== "CONFLICT" || refusal.reason === "conflict") {
      throw new Error(`past-fence edit must fail the program's CONFLICT, not trace OCC: ${JSON.stringify(terminal)}`);
    }
  } finally {
    Date.now = originalNow;
  }
  drain.close();
});

journey("a never-opened chat renders offline from the drained log and an offline send is predicted into it in order", async ({ as }) => {
  const bob = as("bob", { store: "file" });
  const drain = bob.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  drain.close();
  await bob.offline();
  const local = await bob.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (local.state !== "complete" || !("connection" in local) || local.connection !== "offline" || !Array.isArray(local.data)) {
    throw new Error(`the never-opened thread was ${local.state} offline${"reason" in local ? ` (${String(local.reason)})` : ""}`);
  }
  const sent = await bob.mutation(api.messages.send, { conversationId: "conversation-1", body: "from the train" });
  if (sent.state !== "queued") throw new Error(`offline send was ${sent.state}`);
  const [entry] = await bob.outbox.entries();
  if (entry?.predicted !== true) throw new Error("the send was queued without a prediction");
  if (!entry.trace?.points.some((point) => point.table === "memberships" && typeof point.digest === "string")) {
    throw new Error(`the trace lacks the membership read: ${JSON.stringify(entry.trace)}`);
  }
  if (JSON.stringify(entry.omitted) !== JSON.stringify(["messageCounts"])) {
    throw new Error(`the prediction did not name the omitted aggregate: ${JSON.stringify(entry.omitted)}`);
  }
  const predicted = await bob.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in predicted) || !Array.isArray(predicted.data)) throw new Error("the predicted thread did not return rows");
  // `last 50` pages newest-first: the queued send leads.
  if (predicted.data[0]?.message?.id !== postedMessage.id(entry) || predicted.data[0]?.message?.body !== "from the train") {
    throw new Error(`the queued send is not inside the thread in order: ${JSON.stringify(bodies(predicted.data))}`);
  }
  if (!("predicted" in predicted) || !predicted.predicted?.some((row) => row.intent === sent.intent)) throw new Error("the thread did not mark the send predicted");
  await bob.online();
  await bob.settled();
  const settled = (await bob.outbox.entries()).find((item) => item.intent === sent.intent);
  if (settled?.state !== "committed") throw new Error(`the predicted send settled as ${settled?.state}: ${JSON.stringify(settled?.response)}`);
  const online = await bob.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in online) || !Array.isArray(online.data)) throw new Error("the online thread did not return rows");
  if (online.data[0]?.message?.id !== postedMessage.id(entry)) throw new Error("the server row does not carry the pinned id the prediction used");
  // The offline replay before the send was the server's answer: same rows in the same order, the send aside.
  const replayed = JSON.stringify(local.data.map((row: LogRow) => [row.messageId, row.message?.body]));
  const served = JSON.stringify(online.data.slice(1).map((row: LogRow) => [row.messageId, row.message?.body]));
  if (replayed !== served) throw new Error(`the offline thread differed from the server's: ${replayed} vs ${served}`);
});

journey("a send queued offline into a three-member group shows one bubble, keeps its message id, leaves no duplicate delivery, and reaches both other members once", async ({ as }) => {
  const alice = as("alice");
  const charlie = as("charlie");
  const bob = as("bob", { store: "file" });
  try {
    const bobPrincipal = (await bob.auth.me()).viewer;
    const charliePrincipal = (await charlie.auth.me()).viewer;
    const trio = await alice.mutation(api.groups.groupCreate, { title: "Trio", members: [bobPrincipal, charliePrincipal] });
    if (trio.state !== "committed") throw new Error(`group creation was ${trio.state}`);
    const conversationId = trio.data.id;
    // A first message lands a delivery in bob's log, whose read rule pools his membership: the send below is predictable.
    const opener = await alice.mutation(api.messages.send, { conversationId, body: "welcome to the trio" });
    if (opener.state !== "committed") throw new Error(`the opener was ${opener.state}`);
    const drain = bob.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
    await drain.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true
      && "data" in value && bodies(value.data).includes("welcome to the trio"));
    drain.close();
    await bob.offline();
    const sent = await bob.mutation(api.messages.send, { conversationId, body: "to the trio" });
    if (sent.state !== "queued") throw new Error(`the offline send was ${sent.state}`);
    const entry = (await bob.outbox.entries()).find((item) => item.intent === sent.intent);
    if (entry?.predicted !== true) throw new Error("the group send was queued without a prediction");
    if (JSON.stringify(entry.omitted) !== JSON.stringify(["messageCounts"])) throw new Error(`omitted was ${JSON.stringify(entry.omitted)}`);
    const queued = await bob.query(api.messages.thread, { conversationId, c: null });
    if (!("data" in queued) || !Array.isArray(queued.data)) throw new Error("the predicted thread did not return rows");
    const bubbles = queued.data.filter((row: LogRow) => row.message?.id === postedMessage.id(entry));
    if (bubbles.length !== 1 || bubbles[0]?.message?.body !== "to the trio") throw new Error(`expected one bubble while queued, saw ${bubbles.length}`);
    await bob.online();
    await bob.settled();
    const settled = (await bob.outbox.entries()).find((item) => item.intent === sent.intent);
    if (settled?.state !== "committed") throw new Error(`the group send settled as ${settled?.state}: ${JSON.stringify(settled?.response)}`);
    const response = settled.response as { data?: { id?: string } };
    if (response.data?.id !== postedMessage.id(entry)) throw new Error("the server minted the message under another id than the prediction");
    const served = await bob.query(api.messages.thread, { conversationId, c: null });
    if (!("data" in served) || !Array.isArray(served.data)) throw new Error("the online thread did not return rows");
    const rows = served.data.filter((row: LogRow) => row.messageId === postedMessage.id(entry));
    if (rows.length !== 1 || rows[0]?.message?.id !== postedMessage.id(entry)) throw new Error(`expected exactly one delivery row for the send online, saw ${rows.length}`);
    // Offline again: the twin's overlay left with the settlement's tail, so the server's row is the only one.
    await bob.offline();
    const replayed = await bob.query(api.messages.thread, { conversationId, c: null });
    if (!("data" in replayed) || !Array.isArray(replayed.data)) throw new Error("the offline thread did not return rows");
    const duplicates = replayed.data.filter((row: LogRow) => row.messageId === postedMessage.id(entry));
    if (duplicates.length !== 1) throw new Error(`the prediction's delivery row survived beside the server's: ${duplicates.length} rows`);
    if ("predicted" in replayed && replayed.predicted?.some((row) => row.intent === sent.intent)) throw new Error("a settled send is still marked predicted");
    await bob.online();
    for (const [name, member] of [["alice", alice], ["charlie", charlie]] as const) {
      const inbox = await member.query(api.messages.inbox, { c: null });
      if (!("data" in inbox) || !Array.isArray(inbox.data)) throw new Error(`${name}'s inbox did not return rows`);
      const delivered = inbox.data.filter((row: LogRow) => row.messageId === postedMessage.id(entry));
      if (delivered.length !== 1 || delivered[0]?.message?.body !== "to the trio") {
        throw new Error(`${name} received ${delivered.length} deliveries of the group send`);
      }
    }
  } finally {
    alice.close();
    charlie.close();
  }
});

journey("an expiring message is purged by the owner's schedule with every client closed", async ({ as, tick }) => {
  const clock = await tick(0);
  const alice = as("alice");
  const expiresAt = Date.now() + Number(clock.offsetMs ?? 0) + 3_600_000;
  const sent = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: "gone in an hour", expiresAt });
  if (sent.state !== "committed") throw new Error(`expiring post was ${sent.state}`);
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if (!("data" in before) || !bodies(before.data).includes("gone in an hour")) throw new Error("expiring message was not delivered before its deadline");
  alice.close();
  await tick(3_600_001);
  const bob = as("bob");
  const thread = bob.subscribe(api.messages.inbox, { c: null }, () => {});
  try {
    const purged = await thread.until((delivery) => "data" in delivery && Array.isArray(delivery.data)
      && delivery.data.some((row: LogRow) => row.kind === "expired" && row.messageId === sent.data.id));
    const rows: LogRow[] = "data" in purged && Array.isArray(purged.data) ? purged.data : [];
    if (bodies(rows).includes("gone in an hour")) throw new Error("expired body survived the purge");
    if (rows.some((row) => row.messageId === sent.data.id && row.message !== null)) {
      throw new Error("expired message row survived the purge");
    }
  } finally {
    thread.close();
    bob.close();
  }
});
