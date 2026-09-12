import type { Principal } from "snapback3";
import { api } from "snapback3/client";
import { journey } from "snapback3/test";

function data(result: any): any {
  if (!("data" in result)) throw new Error(JSON.stringify(result));
  return result.data;
}
function committed(result: any): any {
  if (result.state !== "committed") throw new Error(JSON.stringify(result));
  return result.data;
}

// @ref LLP 1025.000#7-qualification — real-owner source, distinctness and disclosure transitions.
journey("recipient period chat totals keep distinctness and private source authority", async ({ as, tick }) => {
  const initial = await tick(0);
  const ownerNow = Date.now() + Number(initial.offsetMs ?? 0);
  const clock = await tick(120_000 - ownerNow % 120_000 + 1000);
  const now = Date.now() + Number(clock.offsetMs ?? 0);
  const periodStart = now - now % 120_000;
  const alice = as("alice"), bob = as("bob"), charlie = as("charlie"), outsider = as("outsider");
  const conversationId = "period-distinctness";
  try {
    committed(await charlie.mutation(api.profiles.createMyProfile, {
      displayName: "Charlie", handle: "period_charlie", bio: "", location: "",
    }));
    const group = committed(await alice.mutation(api.groups.groupCreate, {
      title: "Period distinctness", members: ["dev:bob" as Principal, "dev:charlie" as Principal], conversationId,
    }));
    const members = data(await alice.query(api.groups.membershipsFor, { conversationId }));
    const bobMembership = members.find((row: any) => row.principal === "dev:bob" as Principal).id;
    const chatArgs = { recipient: "dev:bob" as Principal, conversationId, membershipId: bobMembership, periodStart };
    const inspect = (client: any) => client.query(api["period-inspection"].periodChat, chatArgs);
    for (const messageId of ["period-distinct-a", "period-distinct-b"]) {
      committed(await alice.mutation(api.messages.send, { conversationId, body: "period activity", messageId }));
    }
    const sourceArgs = { messageId: "period-distinct-a", recipient: "dev:bob" as Principal };
    if (data(await charlie.query(api["owner-inspection"].periodUnreadRow, sourceArgs)) !== null) {
      throw new Error("ordinary peer read private source custody");
    }
    if (data(await inspect(charlie))?.total !== 2) throw new Error("current peer did not read the declared period aggregate");
    if (data(await inspect(outsider)) !== null) throw new Error("outsider read a period aggregate");
    const recipientTotals = data(await bob.query(api["period-inspection"].recipientPeriodTotals, {
      recipient: "dev:bob" as Principal, periodStart,
    }));
    if (recipientTotals.messages !== 0 || recipientTotals.chats !== 0) {
      throw new Error("owner-only totals were disclosed to a client");
    }
    const forged = await charlie.mutation(api["period-inspection"].forgePeriodAuthor, {
      ...chatArgs, messageId: "period-distinct-a", recipient: "dev:alice" as Principal, author: "dev:charlie" as Principal,
    });
    if (forged.state !== "rejected" || forged.code !== "E_RULE") {
      throw new Error(`shadow author was not checked against its message: ${JSON.stringify(forged)}`);
    }
    committed(await alice.mutation(api.messages.unsend, { messageId: "period-distinct-a" }));
    if (data(await inspect(bob))?.total !== 1) throw new Error("deleting one source deleted its still-active chat");
    committed(await alice.mutation(api.messages.unsend, { messageId: "period-distinct-b" }));
    if (data(await inspect(bob)) !== null) throw new Error("deleting the last source retained its chat");

    committed(await alice.mutation(api.messages.send, {
      conversationId, body: "read transition", messageId: "period-distinct-read",
    }));
    committed(await bob.mutation(api.messages.markRead, { conversationId }));
    if (data(await inspect(bob)) !== null) throw new Error("read retained chat custody");

    committed(await alice.mutation(api.messages.send, {
      conversationId, body: "admin removal transition", messageId: "period-distinct-remove",
    }));
    committed(await alice.mutation(api.groups.memberRemove, { conversationId, membershipId: bobMembership }));
    if (data(await inspect(alice)) !== null) throw new Error("admin removal retained the removed incarnation's chat");
    if (data(await bob.query(api["owner-inspection"].periodUnreadRow, {
      messageId: "period-distinct-remove", recipient: "dev:bob" as Principal,
    })) !== null) throw new Error("admin removal retained source custody");
    const rejoin = committed(await alice.mutation(api.groups.memberAdd, { conversationId, principal: "dev:bob" as Principal }));
    if (rejoin.id === bobMembership) throw new Error("rejoin reused a membership incarnation");
    committed(await alice.mutation(api.groups.memberLeave, { conversationId, membershipId: group.creatorMembershipId }));
    const charlieMembership = members.find((row: any) => row.principal === "dev:charlie" as Principal).id;
    const charlieChat = { recipient: "dev:charlie" as Principal, conversationId, membershipId: charlieMembership, periodStart };
    if (data(await alice.query(api["period-inspection"].periodChat, charlieChat)) !== null) {
      throw new Error("former member read the period aggregate");
    }
    if (data(await alice.query(api["owner-inspection"].periodUnreadRow, {
      messageId: "period-distinct-remove", recipient: "dev:charlie" as Principal,
    })) !== null) throw new Error("former author read source custody");
  } finally {
    await Promise.all([alice.close(), bob.close(), charlie.close(), outsider.close()]);
  }
});

journey("deleted and replay-admitted posts cannot enter a recipient period digest", async ({ as, tick }) => {
  const initial = await tick(0);
  const ownerNow = Date.now() + Number(initial.offsetMs ?? 0);
  const clock = await tick(120_000 - ownerNow % 120_000 + 1000);
  const now = Date.now() + Number(clock.offsetMs ?? 0);
  const periodStart = now - now % 120_000;
  const alice = as("alice"), bob = as("bob");
  try {
    committed(await alice.mutation(api.posts.createPost, { body: "deleted activity", postId: "deleted-period-post" }));
    committed(await alice.mutation(api.posts.deletePost, { postId: "deleted-period-post" }));
    committed(await alice.mutation(api.admin.setReplayMode, { enabled: true }));
    committed(await alice.mutation(api.posts.createPost, { body: "replay activity", postId: "replay-period-post" }));
    committed(await alice.mutation(api.admin.setReplayMode, { enabled: false }));
    committed(await alice.mutation(api.posts.deletePost, { postId: "replay-period-post" }));
    committed(await alice.mutation(api.posts.createPost, { body: "one live eligible post", postId: "live-period-post" }));
    await Promise.all([alice.close(), bob.close()]);
    await tick(120_000);
    const observer = as("bob");
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const rows = data(await observer.query(api.messages.pushRecent, { c: null }));
        const digest = rows.find((row: any) => row.kind === "digest" && row.periodStart === periodStart);
        if (digest) {
          if (digest.newPostsInFollowing !== 1) throw new Error(`deleted/replay activity leaked: ${JSON.stringify(digest)}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error("schedule did not emit the completed period");
    } finally { await observer.close(); }
  } finally { await Promise.all([alice.close(), bob.close()]); }
});
