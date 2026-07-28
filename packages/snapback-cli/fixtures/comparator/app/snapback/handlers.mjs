async function publishLiveRow(ctx, args) {
  return ctx.db.insert('liveRows', { body: args.body });
}

async function writePrimaryAndActivity(ctx, args) {
  const primary = await ctx.db.insert('primaryRows', { value: args.primary });
  const activity = await ctx.db.insert('activityRows', { value: args.activity });
  return { primary, activity };
}

async function rejectInvalidWrite(ctx, args) {
  await ctx.db.insert('rejectionRows', { value: args.value });
  const error = new Error('fixture mutation deliberately rejected');
  error.code = 'FIXTURE_REJECTED';
  throw error;
}

globalThis.__snapbackHandlers = {
  publishLiveRow,
  writePrimaryAndActivity,
  rejectInvalidWrite,
};
