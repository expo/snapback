import { mutation } from './_generated/server';

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query('users').first()) !== null) return { seeded: false };
    const users = [
      { key: 'user_ada', displayName: 'Ada', handle: 'ada', color: '#7C5CFC' },
      { key: 'user_mina', displayName: 'Mina', handle: 'mina', color: '#EC6B82' },
      { key: 'user_ravi', displayName: 'Ravi', handle: 'ravi', color: '#2D9C89' },
      { key: 'user_noor', displayName: 'Noor', handle: 'noor', color: '#E79B3B' },
    ];
    const conversations = [
      { key: 'conv_mina', isGroup: false, accent: '#EC6B82' },
      { key: 'conv_crew', title: 'Design Crew', isGroup: true, accent: '#6C56E7' },
      { key: 'conv_ravi', isGroup: false, accent: '#2D9C89' },
    ];
    const members = [
      ['member_mina_ada', 'conv_mina', 'user_ada', 1785942120000], ['member_mina_mina', 'conv_mina', 'user_mina', 1785942120000],
      ['member_crew_ada', 'conv_crew', 'user_ada', 1785937200000], ['member_crew_mina', 'conv_crew', 'user_mina', 1785942120000],
      ['member_crew_ravi', 'conv_crew', 'user_ravi', 1785942120000], ['member_crew_noor', 'conv_crew', 'user_noor', 1785942120000],
      ['member_ravi_ada', 'conv_ravi', 'user_ada', 1785855600000], ['member_ravi_ravi', 'conv_ravi', 'user_ravi', 1785942120000],
    ] as const;
    const messages = [
      { key: 'msg_mina_1', conversationKey: 'conv_mina', senderKey: 'user_mina', text: 'Morning! I mocked the launch card.', createdAt: 1785939600000 },
      { key: 'msg_mina_2', conversationKey: 'conv_mina', senderKey: 'user_mina', text: 'The warmer crop feels much more human.', seedImageUrl: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=1200&q=80', createdAt: 1785939780000 },
      { key: 'msg_mina_3', conversationKey: 'conv_mina', senderKey: 'user_ada', text: 'The type rhythm is perfect. Let’s ship that one.', replyToKey: 'msg_mina_2', createdAt: 1785940200000 },
      { key: 'msg_mina_4', conversationKey: 'conv_mina', senderKey: 'user_mina', text: 'Done. I’ll export the remaining sizes after lunch ✨', createdAt: 1785942120000 },
      { key: 'msg_crew_1', conversationKey: 'conv_crew', senderKey: 'user_ravi', text: 'Picnic check: blanket, peaches, tiny speaker?', createdAt: 1785934200000 },
      { key: 'msg_crew_2', conversationKey: 'conv_crew', senderKey: 'user_noor', text: 'And the absurdly good lemonade.', createdAt: 1785934800000 },
      { key: 'msg_crew_3', conversationKey: 'conv_crew', senderKey: 'user_mina', text: 'This is the spot I was thinking of.', seedImageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80', createdAt: 1785936000000 },
      { key: 'msg_crew_4', conversationKey: 'conv_crew', senderKey: 'user_ada', text: 'Perfect. I can be there around five.', replyToKey: 'msg_crew_3', createdAt: 1785936600000 },
      { key: 'msg_crew_5', conversationKey: 'conv_crew', senderKey: 'user_ravi', text: 'I’ll bring cups and a backup layer for sunset.', createdAt: 1785939000000 },
      { key: 'msg_crew_6', conversationKey: 'conv_crew', senderKey: 'user_noor', text: 'Calendar invite is out. No decks allowed.', createdAt: 1785940800000 },
      { key: 'msg_ravi_1', conversationKey: 'conv_ravi', senderKey: 'user_ada', text: 'Did the build finish cleanly?', createdAt: 1785852000000 },
      { key: 'msg_ravi_2', conversationKey: 'conv_ravi', senderKey: 'user_ravi', text: 'Yep — both platforms green. I left notes in the diary.', createdAt: 1785855600000 },
    ];
    const reactions = [
      ['reaction_1', 'conv_mina', 'msg_mina_2', 'user_ada', '❤️'], ['reaction_2', 'conv_mina', 'msg_mina_3', 'user_mina', '👍'],
      ['reaction_3', 'conv_crew', 'msg_crew_3', 'user_ada', '❤️'], ['reaction_4', 'conv_crew', 'msg_crew_3', 'user_ravi', '❤️'],
      ['reaction_5', 'conv_crew', 'msg_crew_6', 'user_mina', '😂'], ['reaction_6', 'conv_crew', 'msg_crew_6', 'user_ravi', '😂'],
    ] as const;
    for (const row of users) await ctx.db.insert('users', row);
    for (const row of conversations) await ctx.db.insert('conversations', row);
    for (const [key, conversationKey, userKey, lastReadAt] of members) await ctx.db.insert('conversationMembers', { key, conversationKey, userKey, lastReadAt });
    for (const row of messages) await ctx.db.insert('messages', row);
    for (const [key, conversationKey, messageKey, userKey, emoji] of reactions) await ctx.db.insert('reactions', { key, conversationKey, messageKey, userKey, emoji });
    return { seeded: true, users: users.length, conversations: conversations.length, messages: messages.length };
  },
});
