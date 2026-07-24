async function listMessages(ctx, args) {
  return await ctx.db
    .query('messages')
    .withIndex('by_owner_conversation')
    .eq('ownerId', ctx.auth.userId)
    .eq('conversationId', args.conversationId)
    .order('pageKey', 'asc')
    .collect();
}

globalThis.__snapbackHandlers = { listMessages };
