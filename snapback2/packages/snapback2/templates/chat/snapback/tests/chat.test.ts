import { api } from "snapback2/client";
import { journey } from "snapback2/test";

function bytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value);
  return output;
}

function int32At(output: Uint8Array, offset: number, value: number): void {
  new DataView(output.buffer).setInt32(offset, value);
}

function base64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function atom(kind: string, ...payload: Uint8Array[]): Uint8Array {
  const content = bytes(...payload);
  return bytes(uint32(content.length + 8), ascii(kind), content);
}

// A structural MP4 synthesized in-process keeps the acceptance journey tiny
// while exercising the same bounded ISO-BMFF walker as an uploaded camera clip.
function synthesizedMp4(): Uint8Array {
  const ftyp = atom("ftyp", ascii("isom"), uint32(0), ascii("isom"), ascii("mp42"));
  const mvhdPayload = new Uint8Array(100);
  new DataView(mvhdPayload.buffer).setUint32(12, 1_000);
  new DataView(mvhdPayload.buffer).setUint32(16, 2_000);
  const tkhdPayload = new Uint8Array(84);
  int32At(tkhdPayload, 40, 0x0001_0000);
  int32At(tkhdPayload, 56, 0x0001_0000);
  int32At(tkhdPayload, 72, 0x4000_0000);
  new DataView(tkhdPayload.buffer).setUint32(76, 2 << 16);
  new DataView(tkhdPayload.buffer).setUint32(80, 2 << 16);
  const hdlrPayload = new Uint8Array(24);
  hdlrPayload.set(ascii("vide"), 8);
  const track = atom("trak", atom("tkhd", tkhdPayload), atom("mdia", atom("hdlr", hdlrPayload)));
  return bytes(ftyp, atom("moov", atom("mvhd", mvhdPayload), track));
}

journey("alice sends bob a message", async ({ as }) => {
  const alice = as("alice");
  const before = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  if ((before.state !== "complete" && before.state !== "capped") || !Array.isArray(before.data)) throw new Error("thread did not return rows");
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "conversation-1",
    recipientId: "profile-bob",
    body: "hello bob",
  });
  if (sent.state !== "committed") throw new Error(`send was ${sent.state}`);
  const after = await alice.query(api.messages.thread, { conversationId: "conversation-1", c: before.next });
  if (!("data" in after) || !after.data?.some((row: { body?: string }) => row.body === "hello bob")) throw new Error("sent message was not readable");
  const sideBefore = await alice.query(api.messages.thread, { conversationId: "conversation-2", c: null });
  if (sideBefore.state !== "complete") throw new Error(`side thread was ${sideBefore.state}`);
  const rejected = await alice.mutation(api.messages.send, {
    conversationId: "conversation-2",
    recipientId: "profile-bob",
    body: "must not cross the conversation boundary",
  });
  if (rejected.state !== "rejected") throw new Error("outsider recipient received a private send");
  const sideAfter = await alice.query(api.messages.thread, { conversationId: "conversation-2", c: null });
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
    { conversationId: "conversation-1", c: null },
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

journey("alice sends and reads back a JPEG photo and synthesized MP4 clip", async ({ as }) => {
  const alice = as("alice");
  const charlie = as("charlie");
  try {
    const jpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzSiiiv18+FP/Z"), (value) => value.charCodeAt(0));
    const validJpeg = bytes(jpeg.slice(0, 155), new Uint8Array([40, 40, 40]), jpeg.slice(155));
    // The encoded fixture is one baseline MCU; advertise its padded 8×8 display extent.
    validJpeg[164] = 8;
    validJpeg[166] = 8;
    const photoSent = await alice.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1",
      photo: {
        uri: `data:image/jpeg;base64,${base64(validJpeg)}`,
        fileSize: validJpeg.byteLength,
        mimeType: "image/jpeg",
      },
    });
    if (photoSent.state !== "committed") throw new Error(`photo send was ${photoSent.state}`);
    const clipSent = await alice.mutation(api.messages.sendClip, {
      conversationId: "conversation-1",
      clip: new File([synthesizedMp4().buffer as ArrayBuffer], "clip.mp4", { type: "video/mp4" }),
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
    // reclamation pass can collect this orphan (LLP 1006 §9).

    const thread = await alice.query(api.messages.thread, { conversationId: "conversation-1" });
    if (!("data" in thread) || !Array.isArray(thread.data)) throw new Error("asset thread did not return rows");
    const photo = thread.data.find((row) => row.id === photoSent.data.id)?.photo;
    const clip = thread.data.find((row) => row.id === clipSent.data.id)?.clip;
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
    const member = await bob.query(api.messages.summary, { conversationId: "conversation-1" });
    if (!("data" in member) || member.data?.conversation?.title !== "General") {
      throw new Error("member could not read the conversation shell");
    }
    if (typeof member.data.messageCount?.value !== "number") {
      throw new Error("member could not read the maintained message count");
    }

    const outsider = await charlie.query(api.messages.summary, { conversationId: "conversation-1" });
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
  const alice = as("alice", {
    store: "file",
    onTombstone: (item) => item.table === "deliveries"
      && (item.row.kind === "removed" || item.row.kind === "expired")
      && typeof item.row.messageId === "string"
      ? [{ table: "messages", id: item.row.messageId }]
      : [],
  });
  const drain = alice.subscribe(
    api.deliveries.inbox,
    { c: null },
    () => undefined,
    { drain: true },
  );
  await drain.until((value) =>
    (value.state === "complete" || value.state === "capped") && value.caughtUp === true);
  await alice.offline();
  const owner = as("alice");
  const unsent = await owner.mutation(api.deliveries.unsend, { messageId: "message-1" });
  if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
  owner.close();
  await alice.online();
  await drain.until((value) => "data" in value
    && Array.isArray(value.data)
    && value.data.some((row: { kind?: string; messageId?: string }) =>
      row.kind === "removed" && row.messageId === "message-1"));
  drain.close();
  await alice.offline();
  const cold = await alice.restart();
  const held = await cold.query(api.deliveries.inbox, { c: null });
  if ((held.state !== "complete" && held.state !== "capped" && held.state !== "partial")
    || !("connection" in held) || held.connection !== "offline" || !Array.isArray(held.data)) {
    throw new Error("cold offline inbox did not render its held answer");
  }
  if (JSON.stringify(held.data).includes("Welcome")) {
    throw new Error("unsent message body survived in the cold held inbox");
  }
});
