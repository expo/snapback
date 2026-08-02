const writeRoles = ['commander', 'responder'];

globalThis.__snapbackHandlers = {
  async createIncident(ctx, args) {
    const incidentId = await ctx.membership.incidentMembers.bootstrap({
      title: String(args.title).trim(), severity: args.severity,
      createdBy: ctx.auth.userId, nextSequence: 2,
    });
    await ctx.db.insert('messages', {
      incidentId, sequence: 1, authorId: ctx.auth.userId, body: 'Incident opened',
    });
    return incidentId;
  },
  async addParticipant(ctx, args) {
    await ctx.permissions.incidentMembers.requireRole(args.incidentId, 'commander');
    if (!['responder', 'observer'].includes(args.role)) throw new Error('invalid participant role');
    await ctx.membership.incidentMembers.insert({
      incidentId: args.incidentId, userId: args.userId, role: args.role,
    });
    return null;
  },
  async removeParticipant(ctx, args) {
    if (args.userId !== ctx.auth.userId) throw new Error('v1 removal is self-service');
    await ctx.membership.incidentMembers.removeSelf(args.incidentId);
    return null;
  },
  async postMessage(ctx, args) {
    await ctx.permissions.incidentMembers.requireRole(args.incidentId, ...writeRoles);
    const incident = await ctx.db.get('incidents', args.incidentId);
    if (!incident) throw new Error('incident not found');
    const sequence = incident.nextSequence;
    await ctx.db.insert('messages', {
      incidentId: args.incidentId, sequence, authorId: ctx.auth.userId,
      body: String(args.body).trim(),
    });
    await ctx.db.patch('incidents', args.incidentId, {nextSequence: sequence + 1});
    return sequence;
  },
};
