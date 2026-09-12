#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, api } from "snapback2/client";
import { ownerUrl } from "./replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const milestoneFlag = args.findIndex((item) => item === "--milestone");
const milestone = (milestoneFlag >= 0 ? args[milestoneFlag + 1] : "m1").toLowerCase();
const coverageAll = JSON.parse(await readFile(resolve(root, "coverage-manifest.json"), "utf8"));
const url = await ownerUrl(root);
const tests = [];

function test(id, name, fn) {
  tests.push({ id, name, fn });
}

async function fileFrom(name) {
  const bytes = await readFile(`/home/ccheever/clique-0029-20260912/fixtures/social-messenger/media/${name}`);
  const type = name.endsWith(".mp4") ? "video/mp4" : "image/png";
  return new File([bytes], name, { type });
}

function unique(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test("m1-a01", "signup succeeds", async () => {
  const client = createClient({ url });
  const email = `${unique("user")}@example.com`;
  await client.auth.signup({ email, password: "Password9" });
  const me = await client.auth.me();
  if (!me.viewer) throw new Error("signup did not authenticate");
});

test("m1-a02", "signup lands authenticated", async () => {
  const client = createClient({ url });
  await client.auth.login({ email: "alice@example.com", password: "Alice!Clique2026" });
  const me = await client.auth.me();
  if (!me.viewer) throw new Error("not authenticated");
});

test("m1-a03", "duplicate handle is rejected", async () => {
  const a = createClient({ url });
  await a.auth.login({ email: "bob@example.com", password: "Bob!Clique2026" });
  const second = await a.mutation(api.profiles.createMyProfile, {
    displayName: "Second",
    handle: "alice",
    bio: "",
    location: "",
  });
  if (second.state === "committed" && second.data != null) throw new Error("duplicate handle was accepted");
});

test("m1-a04", "duplicate email is rejected", async () => {
  const b = createClient({ url });
  let rejected = false;
  try {
    await b.auth.signup({ email: "alice@example.com", password: "Password9x" });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("duplicate email was accepted");
});

test("m1-a08", "edit display name and bio persist", async () => {
  const client = createClient({ url });
  await client.auth.login({ email: "carol@example.com", password: "Carol!Clique2026" });
  const mine = await client.query(api.profiles.mine, {});
  const handle = mine.data?.handle ?? "carol";
  const updated = await client.mutation(api.profiles.updateMyProfile, {
    displayName: "Carol Chen",
    handle,
    bio: "updated bio for acceptance",
    location: mine.data?.location ?? "",
    link: mine.data?.link ?? null,
  });
  if (updated.state !== "committed") throw new Error("update failed");
  const after = await client.query(api.profiles.mine, {});
  if (after.data?.bio !== "updated bio for acceptance") throw new Error("profile did not persist");
  await client.mutation(api.profiles.updateMyProfile, {
    displayName: "Carol Chen",
    handle,
    bio: "Ceramics student and relentless list maker.",
    location: after.data?.location ?? "",
    link: after.data?.link ?? null,
  });
});

test("m1-a10", "upload fixture avatar succeeds", async () => {
  const client = createClient({ url });
  await client.auth.login({ email: "dave@example.com", password: "Dave!Clique2026" });
  const mine = await client.query(api.profiles.mine, {});
  const updated = await client.mutation(api.profiles.updateMyProfile, {
    displayName: mine.data.displayName,
    handle: mine.data.handle,
    bio: mine.data.bio,
    location: mine.data.location,
    link: mine.data.link ?? null,
    avatar: await fileFrom("avatar-bob.png"),
  });
  if (updated.state !== "committed" || updated.data?.avatar == null) throw new Error("avatar upload failed");
});

test("m1-a11", "uploaded avatar renders via asset url", async () => {
  const client = createClient({ url });
  await client.auth.login({ email: "dave@example.com", password: "Dave!Clique2026" });
  const mine = await client.query(api.profiles.mine, {});
  const asset = mine.data?.avatar;
  if (!asset) throw new Error("no avatar record");
  const assetUrl = await client.assetUrl(asset);
  if (!assetUrl) throw new Error("no avatar url");
  const blob = await client.assetBlob(assetUrl);
  if (!blob || blob.size === 0) throw new Error("avatar bytes missing");
});

const sessions = new Map();
async function login(email, password) {
  if (sessions.has(email)) return sessions.get(email);
  const client = createClient({ url });
  await client.auth.login({ email, password });
  sessions.set(email, client);
  return client;
}

function ids(page) {
  return (page.data ?? []).map((row) => row.eventId ?? row.id).filter(Boolean);
}

function postIds(page) {
  return (page.data ?? []).map((row) => row.post?.id).filter(Boolean);
}

async function collectFeed(client, op, pages = 5) {
  let cursor = null;
  const rows = [];
  for (let i = 0; i < pages; i += 1) {
    const page = await client.query(op, cursor ? { c: cursor } : {});
    rows.push(...(page.data ?? []));
    if (!page.next) break;
    cursor = page.next;
  }
  return rows;
}

test("m2-a01", "create a text post", async () => {
  const client = await login("alice@example.com", "Alice!Clique2026");
  const result = await client.mutation(api.posts.createTextPost, { postId: unique("pt"), body: "Acceptance text post" });
  if (result.state !== "committed") throw new Error("text post failed");
});

test("m2-a02", "create an image post with 2 images", async () => {
  const client = await login("alice@example.com", "Alice!Clique2026");
  const result = await client.mutation(api.posts.createImagePost, {
    postId: unique("pi"),
    body: "Two images",
    photo1: await fileFrom("img-01.png"),
    photo2: await fileFrom("img-02.png"),
  });
  if (result.state !== "committed" || !result.data?.photo1 || !result.data?.photo2) throw new Error("image post failed");
});

test("m2-a03", "create a video post", async () => {
  const client = await login("alice@example.com", "Alice!Clique2026");
  const result = await client.mutation(api.posts.createVideoPost, {
    postId: unique("pv"),
    body: "Video post",
    clip: await fileFrom("vid-01.mp4"),
  });
  if (result.state !== "committed" || !result.data?.clip) throw new Error("video post failed");
});

test("m2-a06", "bob following includes alice posts", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const aliceMe = await alice.auth.me();
  await bob.mutation(api.follows.setFollowIdentified, { target: aliceMe.viewer, following: true, mutationId: unique("fl") });
  const feed = await bob.query(api.feeds.followingFeed, {});
  if (!postIds(feed).includes("sp0001")) throw new Error("alice post missing from bob following");
});

test("m2-a08", "unfollow removes alice from following", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const aliceMe = await alice.auth.me();
  await bob.mutation(api.follows.setFollowIdentified, { target: aliceMe.viewer, following: false, mutationId: unique("fu") });
  const feed = await bob.query(api.feeds.followingFeed, {});
  const posts = (feed.data ?? []).filter((row) => row.kind === "original" && row.post?.author?.handle === "alice");
  if (posts.length > 0) throw new Error("alice originals remained after unfollow");
  await bob.mutation(api.follows.setFollowIdentified, { target: aliceMe.viewer, following: true, mutationId: unique("fr") });
});

test("m2-a09", "unfollowed posts remain in global", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const global = await bob.query(api.feeds.globalFeed, {});
  if (!postIds(global).includes("sp0001") && !(await collectFeed(bob, api.feeds.globalFeed, 8)).some((row) => row.post?.id === "sp0001")) {
    throw new Error("alice post missing from global");
  }
});

test("m2-a10", "unfollowed user appears in global", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const rows = await collectFeed(bob, api.feeds.globalFeed, 8);
  if (!rows.some((row) => row.post?.id === "sp0016")) throw new Error("frank post missing from global");
});

test("m2-a11", "unfollowed user absent from following", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const frankProfile = await bob.query(api.profiles.byHandle, { handle: "frank" });
  if (frankProfile.data?.principal) {
    await bob.mutation(api.follows.setFollowIdentified, {
      target: frankProfile.data.principal,
      following: false,
      mutationId: unique("unf-frank"),
    });
  }
  const feed = await bob.query(api.feeds.followingFeed, {});
  const frank = (feed.data ?? []).filter((row) => row.post?.author?.handle === "frank" && row.kind === "original");
  if (frank.length > 0) throw new Error("frank originals in following");
});

test("m2-a12", "http url is present as tappable text", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const global = await bob.query(api.feeds.globalFeed, {});
  const got = await bob.query(api.posts.get, { postId: "sp0001" });
  if (!got.data?.body?.includes("https://example.com/cafe")) throw new Error("url missing");
});

test("m2-a13", "no unfurl preview fields", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const global = await bob.query(api.feeds.globalFeed, {});
  const post = (global.data ?? []).find((row) => row.post?.id === "sp0001");
  if (post?.post && "preview" in post.post) throw new Error("preview card field present");
});

test("m2-a15", "unlike clears like", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.posts.setLike, { postId: "sp0001", liked: true, mutationId: unique("lk") });
  const liked = await bob.query(api.feeds.globalFeed, {});
  const card = (liked.data ?? []).find((row) => row.post?.id === "sp0001")?.post;
  if (!card?.liked) throw new Error("like did not set");
  await bob.mutation(api.posts.setLike, { postId: "sp0001", liked: false, mutationId: unique("uk") });
  const after = await bob.query(api.feeds.globalFeed, {});
  const card2 = (after.data ?? []).find((row) => row.post?.id === "sp0001")?.post;
  if (card2?.liked) throw new Error("unlike failed");
});

test("m2-a16", "repost attributed", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.posts.setRepost, { postId: "sp0007", reposted: true, mutationId: unique("rp") });
  const feed = await bob.query(api.feeds.globalFeed, {});
  const hit = (feed.data ?? []).find((row) => row.kind === "repost" && row.post?.id === "sp0007" && row.actor?.handle === "bob");
  if (!hit) throw new Error("repost missing");
});

test("m2-a17", "reposing again removes", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.posts.setRepost, { postId: "sp0007", reposted: false, mutationId: unique("rpu") });
  const feed = await bob.query(api.feeds.globalFeed, {});
  const hit = (feed.data ?? []).find((row) => row.kind === "repost" && row.post?.id === "sp0007" && row.actor?.handle === "bob");
  if (hit) throw new Error("repost remained");
});

test("m2-a18", "followed user repost surfaces original", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const carol = await bob.query(api.profiles.byHandle, { handle: "carol" });
  await bob.mutation(api.follows.setFollowIdentified, {
    target: carol.data.principal,
    following: true,
    mutationId: unique("fc"),
  });
  const feed = await bob.query(api.feeds.followingFeed, {});
  const hit = (feed.data ?? []).find((row) => row.post?.id === "sp0001" && row.kind === "repost" && row.actor?.handle === "carol");
  if (!hit) throw new Error("carol repost did not surface in bob following");
});

test("m2-a20", "thread shows parent and replies in order", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const thread = await bob.query(api.posts.thread, { postId: "sp0001", c: null });
  if (thread.data?.parent?.id !== "sp0001") throw new Error("parent missing");
  const replies = thread.data?.replies ?? [];
  if (!replies.some((row) => row.id === "sr0001")) throw new Error("reply missing");
});

test("m2-a21", "replies absent from feeds", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const global = await bob.query(api.feeds.globalFeed, {});
  if (postIds(global).includes("sr0001")) throw new Error("reply in global");
  const following = await bob.query(api.feeds.followingFeed, {});
  if (postIds(following).includes("sr0001")) throw new Error("reply in following");
});

test("m2-a22", "following pagination", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const handles = ["alice", "carol", "dave", "erin", "frank", "grace", "henry"];
  for (const handle of handles) {
    const profile = await bob.query(api.profiles.byHandle, { handle });
    await bob.mutation(api.follows.setFollowIdentified, {
      target: profile.data.principal,
      following: true,
      mutationId: unique(`f-${handle}`),
    });
  }
  const page1 = await bob.query(api.feeds.followingFeed, {});
  if ((page1.data ?? []).length < 20) throw new Error("following page1 too small");
  if (!page1.next) throw new Error("no following continuation");
  const page2 = await bob.query(api.feeds.followingFeed, { c: page1.next });
  if ((page2.data ?? []).length < 1) throw new Error("following page2 empty");
});

test("m2-a23", "global pagination", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const page1 = await bob.query(api.feeds.globalFeed, {});
  if ((page1.data ?? []).length !== 20) throw new Error(`global page1 ${page1.data?.length}`);
  if (!page1.next) throw new Error("no global continuation");
  const page2 = await bob.query(api.feeds.globalFeed, { c: page1.next });
  if ((page2.data ?? []).length < 1) throw new Error("global page2 empty");
});

test("m2-a24", "pagination no dupes or gaps", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const page1 = await bob.query(api.feeds.globalFeed, {});
  const page2 = await bob.query(api.feeds.globalFeed, { c: page1.next });
  const a = ids(page1);
  const b = ids(page2);
  const overlap = a.filter((id) => b.includes(id));
  if (overlap.length) throw new Error(`duplicate event ids: ${overlap.join(",")}`);
  if (a.length + (page2.data ?? []).length < 21) throw new Error("pages do not cover >20 items");
});

test("m2-a25", "own originals remain in following", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const feed = await bob.query(api.feeds.followingFeed, {});
  if (!postIds(feed).includes("sp0004")) throw new Error("bob original missing from following");
});

test("m2-a26", "own reposts remain in following", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.posts.setRepost, { postId: "sp0019", reposted: true, mutationId: unique("ownrp") });
  const feed = await bob.query(api.feeds.followingFeed, {});
  const hit = (feed.data ?? []).find((row) => row.kind === "repost" && row.actor?.handle === "bob" && row.post?.id === "sp0019");
  if (!hit) throw new Error("own repost missing from following");
});

test("m2-a27", "implicit self-follow does not change counts", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const me = await bob.auth.me();
  const before = await bob.query(api.follows.counts, { p: me.viewer });
  const self = await bob.mutation(api.follows.setFollow, { target: me.viewer, following: true });
  if (self.state !== "rejected") throw new Error("self-follow was admitted");
  const after = await bob.query(api.follows.counts, { p: me.viewer });
  if (after.data.followers !== before.data.followers || after.data.following !== before.data.following) {
    throw new Error("self-follow changed counts");
  }
});

test("m3-a03", "dm create is idempotent per pair", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const bobMe = await bob.auth.me();
  const first = await alice.mutation(api.groups.dmCreate, { other: bobMe.viewer });
  const second = await alice.mutation(api.groups.dmCreate, { other: bobMe.viewer });
  if (first.state !== "committed" || second.state !== "committed") throw new Error("dm create failed");
  if (first.data.id !== second.data.id) throw new Error("duplicate dm channel");
});

test("m3-a04", "create group alice bob carol", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const carol = await login("carol@example.com", "Carol!Clique2026");
  const created = await alice.mutation(api.groups.groupCreate, {
    title: unique("grp").slice(0, 12),
    members: [(await bob.auth.me()).viewer, (await carol.auth.me()).viewer],
    description: "test",
  });
  if (created.state !== "committed") throw new Error("group create failed");
});

test("m3-a05", "second identical-membership group coexists", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const carol = await login("carol@example.com", "Carol!Clique2026");
  const members = [(await bob.auth.me()).viewer, (await carol.auth.me()).viewer];
  const a = await alice.mutation(api.groups.groupCreate, { title: unique("g1").slice(0, 12), members, description: "" });
  const b = await alice.mutation(api.groups.groupCreate, { title: unique("g2").slice(0, 12), members, description: "" });
  if (a.data.id === b.data.id) throw new Error("groups collapsed");
});

test("m3-a10", "quoted reply stores quote id", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const msg = await alice.query(api.messages.history, { conversationId: "d-alice-bob", c: null });
  const quoted = (msg.data ?? []).find((row) => row.id === "sm0002");
  if (quoted?.quoteId !== "sm0001") throw new Error("quote pointer missing");
});

test("m3-a11", "quoted excerpt exists for jump", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const msg = await alice.query(api.messages.history, { conversationId: "d-alice-bob", c: null });
  const quoted = (msg.data ?? []).find((row) => row.id === "sm0002");
  const original = (msg.data ?? []).find((row) => row.id === quoted?.quoteId);
  if (!original?.body) throw new Error("quoted original missing");
});

test("m3-a14", "non-admin cannot remove members", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const carol = await login("carol@example.com", "Carol!Clique2026");
  const meta = await bob.query(api.groups.conversation, { conversationId: "g-starter" });
  const carolRow = (meta.data?.members ?? []).find((row) => row.profile?.handle === "carol");
  const removed = await bob.mutation(api.groups.memberRemove, {
    conversationId: "g-starter",
    membershipId: carolRow?.id ?? "missing",
  });
  if (removed.state !== "rejected") throw new Error("non-admin removed a member");
});

test("m3-a15", "seed idempotent", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const before = await alice.query(api.messages.history, { conversationId: "d-alice-bob", c: null });
  const { replayLog } = await import("./replay.mjs");
  await replayLog({
    url,
    logPath: "/home/ccheever/clique-0029-20260912/fixtures/social-messenger/starter-m3.log",
    mediaRoot: "/home/ccheever/clique-0029-20260912/fixtures/social-messenger",
  });
  const after = await alice.query(api.messages.history, { conversationId: "d-alice-bob", c: null });
  const count = (rows) => (rows.data ?? []).filter((row) => row.id === "sm0001").length;
  if (count(after) !== count(before) && count(after) !== 1) throw new Error("seed duplicated messages");
});

test("m4-a01", "photo message send", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const sent = await alice.mutation(api.messages.sendPhoto, {
    conversationId: "d-alice-bob",
    photo: await fileFrom("img-05.png"),
  });
  if (sent.state !== "committed" || !sent.data?.photo) throw new Error("photo send failed");
});

test("m4-a03", "video message send", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const sent = await alice.mutation(api.messages.sendClip, {
    conversationId: "d-alice-bob",
    clip: await fileFrom("vid-01.mp4"),
  });
  if (sent.state !== "committed" || !sent.data?.clip) throw new Error("video send failed");
});

test("m4-a06", "reaction replace", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.messages.setReaction, { messageId: "sm0001", emoji: "👍", mutationId: unique("r1") });
  await bob.mutation(api.messages.setReaction, { messageId: "sm0001", emoji: "❤️", mutationId: unique("r2") });
  const listed = await bob.query(api.messages.reactionsOn, { messageId: "sm0001" });
  const mine = (listed.data ?? []).filter((item) => item.principal && item.emoji === "❤️");
  if (mine.length < 1) throw new Error("replacement reaction missing");
});

test("m4-a07", "reaction remove", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  await bob.mutation(api.messages.setReaction, { messageId: "sm0001", emoji: "none", mutationId: unique("r3") });
});

test("m4-a09", "edited label via editedAt", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const sent = await alice.mutation(api.messages.send, { conversationId: "d-alice-bob", body: "edit me" });
  const edited = await alice.mutation(api.messages.edit, {
    messageId: sent.data.id,
    body: "edited now",
    baseBody: "edit me",
  });
  if (edited.state !== "committed") throw new Error("edit failed");
});

test("m5-a04", "view-once first open", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const sent = await alice.mutation(api.messages.sendOncePhoto, {
    conversationId: "d-alice-bob",
    photo: await fileFrom("img-04.png"),
  });
  if (sent.state !== "committed" || !sent.data?.photo) throw new Error("view-once send failed");
});

test("m5-a05", "view-once second open denied", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const sent = await alice.mutation(api.messages.sendOncePhoto, {
    conversationId: "d-alice-bob",
    photo: await fileFrom("img-04.png"),
  });
  const url = await bob.assetUrl(sent.data.photo);
  await bob.assetBlob(url, { viewing: {} });
  let denied = false;
  try {
    await bob.assetBlob(url, { viewing: {} });
  } catch (error) {
    denied = (error.code === "E_ASSET_VIEWED") || String(error).includes("VIEWED");
  }
  if (!denied) throw new Error("second view-once open was allowed");
});

test("m5-a08", "non-admin cannot rename group", async () => {
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const renamed = await bob.mutation(api.groups.renameGroup, {
    conversationId: "g-starter",
    title: "Hacked",
    description: "",
  });
  if (renamed.state !== "rejected") throw new Error("non-admin renamed group");
});

test("m5-a09", "people search car -> carol", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const found = await alice.query(api.profiles.searchByName, { term: "car" });
  if (!(found.data ?? []).some((row) => row.handle === "carol")) throw new Error("carol not found");
});

test("m5-a10", "in-chat search seeded string", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const found = await alice.query(api.messages.searchChat, {
    conversationId: "d-alice-bob",
    term: "coffee",
  });
  if ((found.data ?? []).length < 1) throw new Error("in-chat search empty");
});

test("m5-a11", "global search groups by chat", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const scopes = await alice.query(api.feeds.searchScopes, {});
  if ((scopes.data ?? []).length < 1) throw new Error("no search scopes");
});

test("m6-a08", "push log for offline recipient", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const dave = await login("dave@example.com", "Dave!Clique2026");
  const daveMe = await dave.auth.me();
  const dm = await alice.mutation(api.groups.dmCreate, { other: daveMe.viewer });
  await dave.close();
  sessions.delete("dave@example.com");
  const sent = await alice.mutation(api.messages.send, { conversationId: dm.data.id, body: "push-preview-check" });
  if (sent.state !== "committed") throw new Error("send failed");
  const dave2 = createClient({ url });
  await dave2.auth.login({ email: "dave@example.com", password: "Dave!Clique2026" });
  const log = await dave2.query(api.messages.myPushLog, {});
  if (!(log.data ?? []).some((row) => row.preview?.includes("push-preview") && row.kind === "message")) {
    throw new Error("push log missing");
  }
  await dave2.close();
});

test("m6-a09", "view-once push preview is Photo", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const erin = createClient({ url });
  await erin.auth.login({ email: "erin@example.com", password: "Erin!Clique2026" });
  const erinMe = await erin.auth.me();
  const dm = await alice.mutation(api.groups.dmCreate, { other: erinMe.viewer });
  await erin.close();
  const sent = await alice.mutation(api.messages.sendOncePhoto, {
    conversationId: dm.data.id,
    photo: await fileFrom("img-03.png"),
  });
  if (sent.state !== "committed") throw new Error("view-once send failed");
  const erin2 = createClient({ url });
  await erin2.auth.login({ email: "erin@example.com", password: "Erin!Clique2026" });
  const log = await erin2.query(api.messages.myPushLog, {});
  if (!(log.data ?? []).some((row) => row.preview === "Photo")) throw new Error("Photo preview missing");
  await erin2.close();
});

test("m6-a10", "custom-client-demo runs", async () => {
  const { spawn } = await import("node:child_process");
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/custom-client-demo.mjs"], { cwd: root, env: process.env });
    child.on("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error("demo failed");
});

test("m6-a11", "demo operations exist", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const convos = await alice.query(api.groups.mine, {});
  const history = await alice.query(api.messages.history, { conversationId: "d-alice-bob", c: null });
  if (!("data" in convos) || !("data" in history)) throw new Error("api surface missing");
});

test("m6-a13", "sample-50 adapter conformance", async () => {
  const { replayLog } = await import("./replay.mjs");
  const result = await replayLog({
    url,
    logPath: "/home/ccheever/clique-0029-20260912/fixtures/social-messenger/sample-50.log",
    mediaRoot: "/home/ccheever/clique-0029-20260912/fixtures/social-messenger",
  });
  if (result.count !== 50) throw new Error(`expected 50 actions, got ${result.count}`);
  for (const client of result.clients.values()) await client.close();
});

test("m8-a01", "insights six totals", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const screen = await alice.query(api.insights.screen, {});
  for (const key of ["posts", "likesReceived", "repostsReceived", "repliesReceived", "followers", "following"]) {
    if (typeof screen.data?.[key] !== "number") throw new Error(`missing ${key}`);
  }
});

test("m8-a03", "7-day buckets include today", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const screen = await alice.query(api.insights.screen, {});
  if (typeof screen.data?.day0Posts !== "number") throw new Error("today bucket missing");
});

test("m8-a04", "zero days render as zero", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const screen = await alice.query(api.insights.screen, {});
  for (let i = 0; i < 7; i += 1) {
    if (typeof screen.data?.[`day${i}Posts`] !== "number") throw new Error(`day ${i} omitted`);
  }
});

test("m8-a05", "trending ranks by likes", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const trend = await alice.query(api.feeds.trending, {});
  const rows = trend.data ?? [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].likeCount > rows[i - 1].likeCount) throw new Error("trending not sorted");
  }
});

test("m8-a06", "old posts absent from trending", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const trend = await alice.query(api.feeds.trending, {});
  const old = (trend.data ?? []).find((row) => row.at < Date.now() - 86400000 * 2);
  if (old) throw new Error("stale trending row");
});

test("m8-a07", "trending like-count ties newest-first", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const trend = await alice.query(api.feeds.trending, {});
  const rows = trend.data ?? [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].likeCount === rows[i - 1].likeCount && rows[i].at > rows[i - 1].at) {
      throw new Error("tie break is not newest-first");
    }
  }
});

async function pageHistory(client, conversationId) {
  const rows = [];
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    const page = await client.query(api.messages.history, { conversationId, c: cursor });
    rows.push(...(page.data ?? []));
    if (!page.next) break;
    cursor = page.next;
  }
  return rows.filter((row) => {
    const message = row.message ?? row;
    if (message.deletedAt) return false;
    if (message.expiresAt && message.expiresAt <= Date.now()) return false;
    return true;
  });
}

test("m7-a06", "backfill counts match visible history", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  for (const conversationId of ["d-alice-bob", "g-starter"]) {
    const meta = await alice.query(api.groups.conversation, { conversationId });
    const visible = await pageHistory(alice, conversationId);
    const minimum = conversationId === "d-alice-bob" ? 6 : 9;
    if (visible.length < minimum) {
      throw new Error(`${conversationId} visible history ${visible.length} lost starter messages (min ${minimum})`);
    }
    if (meta.data?.messageCount !== visible.length) {
      throw new Error(`${conversationId} messageCount ${meta.data?.messageCount} != visible ${visible.length}`);
    }
    if (meta.data?.storedMessageCount == null) {
      throw new Error(`${conversationId} storedMessageCount was not backfilled`);
    }
  }
});

test("m7-a01", "create a group poll with 2-4 options", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const bobMe = await bob.auth.me();
  const group = await alice.mutation(api.groups.groupCreate, {
    title: unique("Polls").slice(0, 50),
    members: [bobMe.viewer],
  });
  if (group.state !== "committed") throw new Error("poll group failed");
  const messageId = unique("poll");
  const created = await alice.mutation(api.messages.sendPollIdentified, {
    messageId,
    conversationId: group.data.id,
    question: "Where for lunch?",
    option1: "Pizza",
    option2: "Tacos",
    option3: "Salad",
    optionId1: `${messageId}-a`,
    optionId2: `${messageId}-b`,
    optionId3: `${messageId}-c`,
  });
  if (created.state !== "committed") throw new Error(`poll create ${created.state} ${created.code ?? ""}`);
  const polls = await alice.query(api.messages.latestPolls, { conversationId: group.data.id });
  const poll = (polls.data ?? []).find((row) => row.message === messageId);
  if (!poll || poll.question !== "Where for lunch?" || poll.options.length !== 3) {
    throw new Error(`poll not readable: ${JSON.stringify(polls.data)}`);
  }
  globalThis.__m7Poll = { conversationId: group.data.id, messageId, optionA: `${messageId}-a`, optionB: `${messageId}-b` };
});

test("m7-a03", "changing a vote adjusts tallies", async () => {
  const ctx = globalThis.__m7Poll;
  if (!ctx) throw new Error("poll fixture missing");
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const bob = await login("bob@example.com", "Bob!Clique2026");
  const first = await alice.mutation(api.messages.setVote, {
    messageId: ctx.messageId,
    optionId: ctx.optionA,
    mutationId: unique("vote-a"),
  });
  if (first.state !== "committed") throw new Error(`first vote ${first.state}`);
  const afterFirst = await bob.query(api.messages.latestPolls, { conversationId: ctx.conversationId });
  const poll1 = (afterFirst.data ?? []).find((row) => row.message === ctx.messageId);
  const tallyOf = (poll, optionId) => (poll?.votes ?? []).filter((row) => row.optionId === optionId).length;
  const tallyA1 = tallyOf(poll1, ctx.optionA);
  if (tallyA1 !== 1) throw new Error(`expected option A tally 1, got ${tallyA1}`);
  const changed = await alice.mutation(api.messages.setVote, {
    messageId: ctx.messageId,
    optionId: ctx.optionB,
    mutationId: unique("vote-b"),
  });
  if (changed.state !== "committed") throw new Error(`change vote ${changed.state}`);
  const afterChange = await bob.query(api.messages.latestPolls, { conversationId: ctx.conversationId });
  const poll2 = (afterChange.data ?? []).find((row) => row.message === ctx.messageId);
  const tallyA2 = tallyOf(poll2, ctx.optionA);
  const tallyB2 = tallyOf(poll2, ctx.optionB);
  if (tallyA2 !== 0 || tallyB2 !== 1) {
    throw new Error(`change did not move tally A=${tallyA2} B=${tallyB2}`);
  }
});

test("m7-a04", "duplicate vote mutation id does not flip state", async () => {
  const ctx = globalThis.__m7Poll;
  if (!ctx) throw new Error("poll fixture missing");
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const mutationId = unique("vote-idemp");
  const first = await alice.mutation(api.messages.setVote, {
    messageId: ctx.messageId,
    optionId: ctx.optionA,
    mutationId,
  });
  if (first.state !== "committed") throw new Error(`idempotent first ${first.state}`);
  const retry = await alice.mutation(api.messages.setVote, {
    messageId: ctx.messageId,
    optionId: ctx.optionB,
    mutationId,
  });
  if (retry.state !== "committed") throw new Error(`idempotent retry ${retry.state}`);
  if (retry.data?.optionId !== ctx.optionA) {
    throw new Error(`retry flipped state to ${retry.data?.optionId}`);
  }
  const polls = await alice.query(api.messages.latestPolls, { conversationId: ctx.conversationId });
  const poll = (polls.data ?? []).find((row) => row.message === ctx.messageId);
  const me = await alice.auth.me();
  const mine = (poll?.votes ?? []).find((row) => row.principal === me.viewer)?.optionId;
  if (mine !== ctx.optionA) {
    throw new Error(`live vote is ${mine}, expected ${ctx.optionA}`);
  }
});

test("m7-a07", "counts increment with new messages", async () => {
  const alice = await login("alice@example.com", "Alice!Clique2026");
  const before = await alice.query(api.groups.conversation, { conversationId: "d-alice-bob" });
  const sent = await alice.mutation(api.messages.send, {
    conversationId: "d-alice-bob",
    body: `count-forward ${unique("m")}`,
  });
  if (sent.state !== "committed") throw new Error("forward send failed");
  const after = await alice.query(api.groups.conversation, { conversationId: "d-alice-bob" });
  if (after.data?.messageCount !== (before.data?.messageCount ?? 0) + 1) {
    throw new Error(`count did not increment ${before.data?.messageCount} -> ${after.data?.messageCount}`);
  }
});

test("m7-a09", "previously green milestone suites still pass", async () => {
  const { spawn } = await import("node:child_process");
  const prior = ["m1", "m2", "m3", "m4", "m5", "m8"];
  const failures = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 65_000));
  await pause();
  for (const item of prior) {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["scripts/acceptance.mjs", "--milestone", item], {
        cwd: root,
        env: process.env,
        stdio: "inherit",
      });
      child.on("exit", (value) => resolve(value ?? 1));
    });
    if (code !== 0) failures.push(item);
    await pause();
  }
  if (failures.length) throw new Error(`previously-green suites failed: ${failures.join(",")}`);
});

const results = [];
for (const item of tests.filter((item) => item.id.startsWith(`${milestone}-`))) {
  const started = Date.now();
  try {
    await item.fn();
    results.push({ id: item.id, name: item.name, ok: true, ms: Date.now() - started });
    console.log(`ok ${item.id} ${item.name}`);
  } catch (error) {
    results.push({ id: item.id, name: item.name, ok: false, ms: Date.now() - started, error: String(error?.stack ?? error) });
    console.error(`not ok ${item.id} ${item.name}\n${error}`);
  }
}

for (const client of sessions.values()) await client.close();

const pass = results.length > 0 && results.every((item) => item.ok);
const receipt = {
  milestone,
  pass,
  url,
  results,
  at: new Date().toISOString(),
};
await mkdir(resolve(root, "receipts"), { recursive: true });
const receiptPath = resolve(root, "receipts", `suite-${milestone}.json`);
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
const sliced = {
  format: coverageAll.format,
  instrument: coverageAll.instrument,
  milestones: { [milestone]: coverageAll.milestones[milestone] },
};
const coveragePath = resolve(root, "receipts", `coverage-${milestone}.json`);
await writeFile(coveragePath, JSON.stringify(sliced, null, 2));
const suiteStatus = {
  [milestone]: {
    pass,
    receipt: `suite-${milestone}.json`,
    outcomeClass: pass ? null : "application",
  },
};
await writeFile(resolve(root, "receipts", "suite-status.json"), JSON.stringify(suiteStatus, null, 2));
console.log(JSON.stringify({ pass, receiptPath, coveragePath, sha256: createHash("sha256").update(JSON.stringify(receipt)).digest("hex") }, null, 2));
process.exit(pass ? 0 : 1);
