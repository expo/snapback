// @ref LLP 0028#execution-the-action-class — egress stays in the Action and
// every durable reservation/settlement crosses an ordinary mutation.
// @ref LLP 0036#runtime-exposure-d5-d8 — the provider token is exposed only through
// this action's declared config grant and never enters client/evidence rows.
globalThis.__snapbackHandlers = {
  async sendNotification(ctx, args) {
    const reservation = await ctx.runMutation('reserveNotification', {
      eventId: args.eventId, idempotencyKey: args.idempotencyKey,
    });
    if (reservation.terminal) {
      return { replayedWinner: true, status: reservation.status, attemptCount: reservation.attemptCount };
    }
    const bearer = ctx.secrets.get('notificationToken').asBearer();
    try {
      const response = await fetch(args.providerUrl, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json', 'idempotency-key': args.idempotencyKey },
        body: JSON.stringify({ eventId: args.eventId }),
      });
      if (!response.ok) {
        await ctx.runMutation('settleNotification', {
          idempotencyKey: args.idempotencyKey, status: 'failed', certainty: 'known-not-delivered',
        });
        throw new Error(`provider refused ${response.status}`);
      }
      const body = await response.json();
      await ctx.runMutation('settleNotification', {
        idempotencyKey: args.idempotencyKey, status: 'succeeded', certainty: 'delivered',
        providerReceipt: String(body.receipt),
      });
      return { replayedWinner: false, status: 'succeeded', receipt: String(body.receipt) };
    } catch (error) {
      if (!String(error?.message ?? error).includes('provider refused')) {
        await ctx.runMutation('settleNotification', {
          idempotencyKey: args.idempotencyKey, status: 'ambiguous', certainty: 'may-have-delivered',
        });
      }
      throw error;
    }
  },
};
