globalThis.__snapbackHandlers = {
  async scheduledReminder(ctx) {
    return await ctx.runMutation('recordReminderAttempt', {
      namespace: 'llp0102-partiful-snapback-w1', eventSlug: 'launch-party',
      deliveryKey: 'launch-party:reminder:1800000000000', trigger: 'cron',
    });
  },
};
