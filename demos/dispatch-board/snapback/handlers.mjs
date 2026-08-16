// @ref LLP 0051#d1-the-ctx-answer-ledger-recordable-replayable-deterministic-ops
// — one frozen invocation time spans both writes while each logical event gets
// a fresh host-recorded identifier.

globalThis.__snapbackHandlers = {
  async reportIncident(ctx, args) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('incident title is required');
    const occurredAt = ctx.runtime.now();
    const eventId = ctx.runtime.id();
    const incidentId = await ctx.db.insert('incidents', {
      title,
      status: 'open',
      eventId,
      reportedAt: occurredAt,
    });
    await ctx.db.insert('auditEntries', {
      incidentId,
      eventId: ctx.runtime.id(),
      kind: 'incident.reported',
      occurredAt,
    });
    return { incidentId, eventId, occurredAt };
  },
};
