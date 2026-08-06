import { mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Idempotent seed: creates 4 personas, 2 DMs, 1 group chat, and a starter
// history with replies and reactions. Safe to call repeatedly.
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("users").collect();
    if (existing.length > 0) {
      return { seeded: false, users: existing.length };
    }

    const personas = [
      { name: "Amara", handle: "amara", color: "#128C7E", emoji: "🦊" },
      { name: "Ben", handle: "ben", color: "#3B5BDB", emoji: "🐳" },
      { name: "Chidi", handle: "chidi", color: "#B15A00", emoji: "🦉" },
      { name: "Dana", handle: "dana", color: "#9C36B5", emoji: "🐙" },
    ];
    const ids: Record<string, Id<"users">> = {};
    for (const p of personas) {
      ids[p.handle] = await ctx.db.insert("users", p);
    }

    const makeConvo = async (
      kind: "dm" | "group",
      handles: string[],
      name?: string,
      emoji?: string
    ) => {
      const convoId = await ctx.db.insert("conversations", {
        kind,
        name,
        emoji,
      });
      for (const h of handles) {
        await ctx.db.insert("memberships", {
          conversationId: convoId,
          userId: ids[h],
        });
      }
      return convoId;
    };

    const send = async (
      convoId: Id<"conversations">,
      handle: string,
      text: string,
      replyToId?: Id<"messages">
    ) =>
      await ctx.db.insert("messages", {
        conversationId: convoId,
        authorId: ids[handle],
        kind: "text",
        text,
        replyToId,
      });

    const react = async (
      messageId: Id<"messages">,
      handle: string,
      emoji: string
    ) =>
      await ctx.db.insert("reactions", {
        messageId,
        userId: ids[handle],
        emoji,
      });

    // DM: Amara <-> Ben
    const dm1 = await makeConvo("dm", ["amara", "ben"]);
    const m1 = await send(dm1, "ben", "Hey! Did you see the venue photos?");
    const m2 = await send(dm1, "amara", "Not yet — send them over?", m1);
    await send(dm1, "ben", "Uploading now, one sec.");
    await react(m2, "ben", "👍");

    // DM: Amara <-> Chidi
    const dm2 = await makeConvo("dm", ["amara", "chidi"]);
    const c1 = await send(dm2, "chidi", "Lunch tomorrow?");
    const c2 = await send(dm2, "amara", "Yes! Noon at the usual spot.", c1);
    await react(c2, "chidi", "🎉");

    // Group: Weekend Trip
    const group = await makeConvo(
      "group",
      ["amara", "ben", "chidi", "dana"],
      "Weekend Trip",
      "🏕️"
    );
    const g1 = await send(group, "dana", "Cabin is booked for Sat–Sun 🎉");
    await react(g1, "amara", "🎉");
    await react(g1, "ben", "🎉");
    await react(g1, "chidi", "❤️");
    const g2 = await send(group, "ben", "I can drive, I fit 3 more.");
    await send(group, "amara", "Shotgun!", g2);
    const g4 = await send(
      group,
      "chidi",
      "What should I bring? Thinking board games + snacks."
    );
    await send(group, "dana", "Board games yes. Bring Codenames.", g4);
    await react(g4, "amara", "👍");

    return { seeded: true, users: personas.length };
  },
});
