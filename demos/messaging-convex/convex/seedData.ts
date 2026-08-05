import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const insert = internalMutation({
  args: {
    imageStorageIds: v.record(v.string(), v.string()),
  },
  handler: async (
    ctx,
    { imageStorageIds }
  ): Promise<{ users: number; conversations: number; note: string }> => {
    // Wipe any prior seed data so this is safe to re-run.
    for (const table of [
      "reactions",
      "typingIndicators",
      "messages",
      "conversationMembers",
      "conversations",
      "users",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    const img = (name: string) => imageStorageIds[name] as Id<"_storage">;

    const userDefs = [
      { name: "Ava Chen", avatarColor: "#F97362", avatarEmoji: "🦊" },
      { name: "Ben Ortiz", avatarColor: "#4E9F3D", avatarEmoji: "🐢" },
      { name: "Priya Nair", avatarColor: "#8E7CC3", avatarEmoji: "🦋" },
      { name: "Marcus Webb", avatarColor: "#3B82C4", avatarEmoji: "🐳" },
      { name: "Sofia Reyes", avatarColor: "#E0A526", avatarEmoji: "🐝" },
      { name: "Yuki Tanaka", avatarColor: "#C4557E", avatarEmoji: "🐨" },
    ];
    const users: Record<string, Id<"users">> = {};
    for (const u of userDefs) {
      users[u.name] = await ctx.db.insert("users", u);
    }
    const ava = users["Ava Chen"];
    const ben = users["Ben Ortiz"];
    const priya = users["Priya Nair"];
    const marcus = users["Marcus Webb"];
    const sofia = users["Sofia Reyes"];
    const yuki = users["Yuki Tanaka"];

    const now = Date.now();
    const minutesAgo = (n: number) => now - n * 60_000;

    async function makeConversation(
      kind: "dm" | "group",
      memberIds: Id<"users">[],
      title?: string
    ) {
      const conversationId = await ctx.db.insert("conversations", {
        kind,
        title,
        lastMessageAt: now,
      });
      for (const userId of memberIds) {
        await ctx.db.insert("conversationMembers", { conversationId, userId });
      }
      return conversationId;
    }

    async function sendMsg(
      conversationId: Id<"conversations">,
      authorId: Id<"users">,
      opts: {
        text?: string;
        imageStorageId?: Id<"_storage">;
        replyToId?: Id<"messages">;
      }
    ) {
      const messageId = await ctx.db.insert("messages", {
        conversationId,
        authorId,
        text: opts.text,
        imageStorageId: opts.imageStorageId,
        replyToId: opts.replyToId,
      });
      await ctx.db.patch(conversationId, { lastMessageAt: Date.now() });
      return messageId;
    }

    async function react(
      messageId: Id<"messages">,
      userId: Id<"users">,
      emoji: string
    ) {
      await ctx.db.insert("reactions", { messageId, userId, emoji });
    }

    // --- DM: Ava & Ben -------------------------------------------------
    const dm1 = await makeConversation("dm", [ava, ben]);
    await sendMsg(dm1, ava, { text: "Hey! Are we still on for coffee tomorrow?" });
    const benCoffeeReply = await sendMsg(dm1, ben, { text: "Yes! 10am at the usual place?" });
    await sendMsg(dm1, ava, { text: "Perfect, see you then 😄" });
    const dogMsg = await sendMsg(dm1, ben, {
      text: "Also look who I met on my walk",
      imageStorageId: img("dog.png"),
    });
    await react(dogMsg, ava, "❤️");
    await react(dogMsg, ava, "😂");
    const avaReplyToDog = await sendMsg(dm1, ava, {
      text: "STOP he is too cute",
      replyToId: dogMsg,
    });
    await react(avaReplyToDog, ben, "😂");
    await sendMsg(dm1, ben, { text: "Right?? I want one" });
    await sendMsg(dm1, ava, {
      text: "Coffee from this morning was so good",
      imageStorageId: img("coffee.png"),
    });
    await sendMsg(dm1, ben, {
      text: "See you at 10",
      replyToId: benCoffeeReply,
    });

    // --- DM: Priya & Marcus ---------------------------------------------
    const dm2 = await makeConversation("dm", [priya, marcus]);
    await sendMsg(dm2, priya, { text: "Did you finish the quarterly report?" });
    const marcusReport = await sendMsg(dm2, marcus, { text: "Almost, sending it over in 20 min" });
    await react(marcusReport, priya, "👍");
    await sendMsg(dm2, marcus, { text: "Actually just sent it, check your email" });
    await sendMsg(dm2, priya, { text: "Got it, looks great! Thanks for turning this around fast" });
    await sendMsg(dm2, marcus, {
      text: "No problem. Also this is the view from my desk today",
      imageStorageId: img("mountains.png"),
    });
    const priyaMtnReply = await sendMsg(dm2, priya, {
      text: "Wait where even is this",
    });
    await react(priyaMtnReply, marcus, "😮");
    await sendMsg(dm2, marcus, { text: "Working remote from Colorado this week" });

    // --- Group: Weekend Trip ---------------------------------------------
    const group1 = await makeConversation(
      "group",
      [ava, ben, priya, sofia],
      "Weekend Trip 🏖️"
    );
    await sendMsg(group1, sofia, { text: "Who's still in for the beach this weekend?" });
    await sendMsg(group1, ava, { text: "Me! What time were we thinking?" });
    await sendMsg(group1, ben, { text: "I can do Saturday morning" });
    const priyaIn = await sendMsg(group1, priya, { text: "Count me in too" });
    await react(priyaIn, sofia, "🎉");
    await react(priyaIn, ava, "🎉");
    await react(priyaIn, ben, "❤️");
    const beachPic = await sendMsg(group1, sofia, {
      text: "Found this spot, looks perfect",
      imageStorageId: img("beach.png"),
    });
    await react(beachPic, ava, "😍");
    await react(beachPic, priya, "😍");
    await react(beachPic, ben, "👍");
    const benReplyBeach = await sendMsg(group1, ben, {
      text: "This is the one, let's do this",
      replyToId: beachPic,
    });
    await react(benReplyBeach, sofia, "🔥");
    await sendMsg(group1, ava, { text: "Should we bring food or order something there?" });
    await sendMsg(group1, priya, {
      text: "I can bring snacks, maybe pizza on the way?",
    });
    const pizzaMsg = await sendMsg(group1, priya, {
      text: "Something like this",
      imageStorageId: img("pizza.png"),
    });
    await react(pizzaMsg, ben, "🤤");
    await sendMsg(group1, sofia, { text: "Sold. See everyone Saturday 9am at my place" });

    // --- Group: Team Standup ---------------------------------------------
    const group2 = await makeConversation(
      "group",
      [ava, marcus, sofia, yuki],
      "Team Standup"
    );
    await sendMsg(group2, yuki, { text: "Morning all, quick status before standup?" });
    await sendMsg(group2, ava, { text: "Frontend is done for the login flow, starting on settings today" });
    const marcusStatus = await sendMsg(group2, marcus, {
      text: "Backend API is deployed to staging, running load tests now",
    });
    await react(marcusStatus, yuki, "👍");
    await sendMsg(group2, sofia, { text: "Design review for the new onboarding is at 2pm, please join if you can" });
    const yukiReplyDesign = await sendMsg(group2, yuki, {
      text: "I'll be there",
      replyToId: marcusStatus,
    });
    await sendMsg(group2, ava, { text: "Same, see you all at 2" });
    const sunsetMsg = await sendMsg(group2, marcus, {
      text: "Load tests passed btw, celebrating with this view",
      imageStorageId: img("sunset.png"),
    });
    await react(sunsetMsg, sofia, "🎉");
    await react(sunsetMsg, ava, "🔥");
    await react(sunsetMsg, yuki, "🎉");
    await sendMsg(group2, sofia, {
      text: "Nice work team",
      replyToId: sunsetMsg,
    });

    return {
      users: Object.keys(users).length,
      conversations: 4,
      note: "Seed complete",
    };
  },
});
