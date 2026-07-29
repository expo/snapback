import { schema, table, t } from 'spacetimedb/server';

// @ref LLP 0102#cross-application-acceptance-kernel — private source tables
// plus caller-dependent views make authority and revocation observable.
const persona = table(
  { name: 'persona' },
  {
    identity: t.identity().primaryKey(),
    name: t.string().unique(),
  }
);

const channel = table(
  { name: 'channel' },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    isPrivate: t.bool().index('btree'),
  }
);

const membership = table(
  { name: 'membership' },
  {
    id: t.string().primaryKey(),
    channelId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
    active: t.bool(),
  }
);

const message = table(
  { name: 'message' },
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.string().index('btree'),
    author: t.identity().index('btree'),
    authorName: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  }
);

const typingState = table(
  { name: 'typing_state' },
  {
    id: t.string().primaryKey(),
    channelId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    actorName: t.string(),
    generation: t.u64(),
  }
);

const presence = table(
  { name: 'presence' },
  {
    identity: t.identity().primaryKey(),
    actorName: t.string(),
    connections: t.u32(),
  }
);

const readMarker = table(
  { name: 'read_marker' },
  {
    id: t.string().primaryKey(),
    identity: t.identity().index('btree'),
    channelId: t.string(),
    lastReadId: t.u64(),
  }
);

const pageResult = table(
  { name: 'page_result' },
  {
    id: t.string().primaryKey(),
    requestId: t.string().index('btree'),
    owner: t.identity().index('btree'),
    messageId: t.u64(),
    channelId: t.string(),
    authorName: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  persona,
  channel,
  membership,
  message,
  typingState,
  presence,
  readMarker,
  pageResult,
});

export default spacetimedb;

function identityKey(identity: { toHexString(): string }): string {
  return identity.toHexString();
}

function requirePersona(ctx: any) {
  const row = ctx.db.persona.identity.find(ctx.sender);
  if (!row) throw new Error('persona registration required');
  return row;
}

function canReadChannel(ctx: any, channelId: string, identity = ctx.sender): boolean {
  const target = ctx.db.channel.id.find(channelId);
  if (!target) return false;
  if (!target.isPrivate) return true;
  const row = ctx.db.membership.id.find(`${channelId}:${identityKey(identity)}`);
  return Boolean(row?.active);
}

export const registerPersona = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!['Alice', 'Bob', 'Mallory'].includes(name)) {
      throw new Error('unknown frozen persona');
    }
    const current = ctx.db.persona.identity.find(ctx.sender);
    if (current && current.name !== name) throw new Error('identity already registered');
    const claimed = ctx.db.persona.name.find(name);
    if (claimed && identityKey(claimed.identity) !== identityKey(ctx.sender)) {
      throw new Error('persona already claimed');
    }
    if (!current) ctx.db.persona.insert({ identity: ctx.sender, name });
    const online = ctx.db.presence.identity.find(ctx.sender);
    if (online) {
      ctx.db.presence.identity.update({ ...online, actorName: name });
    } else {
      ctx.db.presence.insert({ identity: ctx.sender, actorName: name, connections: 1 });
    }
  }
);

export const seedFixtures = spacetimedb.reducer(ctx => {
  const actor = requirePersona(ctx);
  if (actor.name !== 'Alice') throw new Error('only Alice seeds the frozen fixture');
  if (ctx.db.channel.id.find('public-general')) throw new Error('fixture already seeded');

  const alice = ctx.db.persona.name.find('Alice');
  const bob = ctx.db.persona.name.find('Bob');
  const mallory = ctx.db.persona.name.find('Mallory');
  if (!alice || !bob || !mallory) throw new Error('all three personas must register first');

  const channels = [
    { id: 'public-general', name: 'General', isPrivate: false },
    { id: 'public-random', name: 'Random', isPrivate: false },
    { id: 'private-project', name: 'Project A', isPrivate: true },
    { id: 'private-ops', name: 'Ops', isPrivate: true },
  ];
  for (const row of channels) ctx.db.channel.insert(row);

  const memberships = [
    ['private-project', alice.identity, 'owner'],
    ['private-project', bob.identity, 'member'],
    ['private-ops', alice.identity, 'owner'],
    ['private-ops', bob.identity, 'member'],
  ] as const;
  for (const [channelId, identity, role] of memberships) {
    ctx.db.membership.insert({
      id: `${channelId}:${identityKey(identity)}`,
      channelId,
      identity,
      role,
      active: true,
    });
  }

  for (const target of channels) {
    for (let index = 1; index <= 125; index += 1) {
      const author = index % 2 === 0 ? bob : alice;
      ctx.db.message.insert({
        id: 0n,
        channelId: target.id,
        author: author.identity,
        authorName: author.name,
        body: `fixture:${target.id}:${String(index).padStart(3, '0')}`,
        createdAt: ctx.timestamp,
      });
    }
  }
});

export const sendMessage = spacetimedb.reducer(
  { channelId: t.string(), body: t.string() },
  (ctx, { channelId, body }) => {
    const actor = requirePersona(ctx);
    if (!canReadChannel(ctx, channelId)) throw new Error('not authorized for channel');
    if (!body || body.length > 2000) throw new Error('invalid message');
    ctx.db.message.insert({
      id: 0n,
      channelId,
      author: ctx.sender,
      authorName: actor.name,
      body,
      createdAt: ctx.timestamp,
    });
  }
);

export const setTyping = spacetimedb.reducer(
  { channelId: t.string(), generation: t.u64() },
  (ctx, { channelId, generation }) => {
    const actor = requirePersona(ctx);
    if (!canReadChannel(ctx, channelId)) throw new Error('not authorized for channel');
    const id = `${channelId}:${identityKey(ctx.sender)}`;
    const current = ctx.db.typingState.id.find(id);
    const row = { id, channelId, identity: ctx.sender, actorName: actor.name, generation };
    if (current) ctx.db.typingState.id.update(row);
    else ctx.db.typingState.insert(row);
  }
);

export const clearTyping = spacetimedb.reducer(
  { channelId: t.string() },
  (ctx, { channelId }) => {
    const id = `${channelId}:${identityKey(ctx.sender)}`;
    if (ctx.db.typingState.id.find(id)) ctx.db.typingState.id.delete(id);
  }
);

export const markRead = spacetimedb.reducer(
  { channelId: t.string(), lastReadId: t.u64() },
  (ctx, { channelId, lastReadId }) => {
    requirePersona(ctx);
    if (!canReadChannel(ctx, channelId)) throw new Error('not authorized for channel');
    const id = `${channelId}:${identityKey(ctx.sender)}`;
    const current = ctx.db.readMarker.id.find(id);
    const row = { id, identity: ctx.sender, channelId, lastReadId };
    if (current) ctx.db.readMarker.id.update(row);
    else ctx.db.readMarker.insert(row);
  }
);

export const requestPage = spacetimedb.reducer(
  { requestId: t.string(), channelId: t.string(), beforeExclusive: t.u64() },
  (ctx, { requestId, channelId, beforeExclusive }) => {
    requirePersona(ctx);
    if (!canReadChannel(ctx, channelId)) throw new Error('not authorized for channel');
    const ownedRequest = `${identityKey(ctx.sender)}:${requestId}`;
    for (const old of Array.from(ctx.db.pageResult.requestId.filter(ownedRequest))) {
      ctx.db.pageResult.id.delete(old.id);
    }
    const rows = Array.from(ctx.db.message.channelId.filter(channelId))
      .filter(row => beforeExclusive === 0n || row.id < beforeExclusive)
      .sort((left, right) => left.id > right.id ? -1 : left.id < right.id ? 1 : 0)
      .slice(0, 25);
    for (const row of rows) {
      ctx.db.pageResult.insert({
        id: `${ownedRequest}:${row.id}`,
        requestId: ownedRequest,
        owner: ctx.sender,
        messageId: row.id,
        channelId: row.channelId,
        authorName: row.authorName,
        body: row.body,
        createdAt: row.createdAt,
      });
    }
  }
);

export const revokeMember = spacetimedb.reducer(
  { channelId: t.string(), memberName: t.string() },
  (ctx, { channelId, memberName }) => {
    requirePersona(ctx);
    const owner = ctx.db.membership.id.find(`${channelId}:${identityKey(ctx.sender)}`);
    if (!owner?.active || owner.role !== 'owner') throw new Error('owner required');
    const member = ctx.db.persona.name.find(memberName);
    if (!member) throw new Error('unknown member');
    const id = `${channelId}:${identityKey(member.identity)}`;
    const row = ctx.db.membership.id.find(id);
    if (!row) throw new Error('membership missing');
    ctx.db.membership.id.update({ ...row, active: false });
  }
);

export const restoreMember = spacetimedb.reducer(
  { channelId: t.string(), memberName: t.string() },
  (ctx, { channelId, memberName }) => {
    requirePersona(ctx);
    const owner = ctx.db.membership.id.find(`${channelId}:${identityKey(ctx.sender)}`);
    if (!owner?.active || owner.role !== 'owner') throw new Error('owner required');
    const member = ctx.db.persona.name.find(memberName);
    if (!member) throw new Error('unknown member');
    const id = `${channelId}:${identityKey(member.identity)}`;
    const row = ctx.db.membership.id.find(id);
    if (!row) throw new Error('membership missing');
    ctx.db.membership.id.update({ ...row, active: true });
  }
);

export const clearFixture = spacetimedb.reducer(ctx => {
  const actor = requirePersona(ctx);
  if (actor.name !== 'Alice') throw new Error('only Alice cleans the frozen fixture');
  for (const row of ctx.db.pageResult.iter()) ctx.db.pageResult.id.delete(row.id);
  for (const row of ctx.db.readMarker.iter()) ctx.db.readMarker.id.delete(row.id);
  for (const row of ctx.db.typingState.iter()) ctx.db.typingState.id.delete(row.id);
  for (const row of ctx.db.message.iter()) ctx.db.message.id.delete(row.id);
  for (const row of ctx.db.membership.iter()) ctx.db.membership.id.delete(row.id);
  for (const row of ctx.db.channel.iter()) ctx.db.channel.id.delete(row.id);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const actor = ctx.db.persona.identity.find(ctx.sender);
  if (!actor) return;
  const row = ctx.db.presence.identity.find(ctx.sender);
  if (row) ctx.db.presence.identity.update({ ...row, connections: row.connections + 1 });
  else ctx.db.presence.insert({ identity: ctx.sender, actorName: actor.name, connections: 1 });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const row = ctx.db.presence.identity.find(ctx.sender);
  if (!row) return;
  if (row.connections <= 1) ctx.db.presence.identity.delete(ctx.sender);
  else ctx.db.presence.identity.update({ ...row, connections: row.connections - 1 });
});

export const myChannels = spacetimedb.view(
  { name: 'my_channels', public: true },
  t.array(channel.rowType),
  ctx => {
    const result = Array.from(ctx.db.channel.isPrivate.filter(false));
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (!member.active) continue;
      const row = ctx.db.channel.id.find(member.channelId);
      if (row) result.push(row);
    }
    return result;
  }
);

export const myMessages = spacetimedb.view(
  { name: 'my_messages', public: true },
  t.array(message.rowType),
  ctx => {
    const result = [];
    for (const target of ctx.db.channel.isPrivate.filter(false)) {
      result.push(...Array.from(ctx.db.message.channelId.filter(target.id)));
    }
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (!member.active) continue;
      result.push(...Array.from(ctx.db.message.channelId.filter(member.channelId)));
    }
    return result;
  }
);

export const myTyping = spacetimedb.view(
  { name: 'my_typing', public: true },
  t.array(typingState.rowType),
  ctx => {
    const result = [];
    for (const target of ctx.db.channel.isPrivate.filter(false)) {
      result.push(...Array.from(ctx.db.typingState.channelId.filter(target.id)));
    }
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (!member.active) continue;
      result.push(...Array.from(ctx.db.typingState.channelId.filter(member.channelId)));
    }
    return result;
  }
);

export const visiblePresence = spacetimedb.view(
  { name: 'visible_presence', public: true },
  t.array(presence.rowType),
  ctx => {
    const own = ctx.db.presence.identity.find(ctx.sender);
    const rows = own ? [own] : [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (!member.active) continue;
      for (const peer of ctx.db.membership.channelId.filter(member.channelId)) {
        if (!peer.active || identityKey(peer.identity) === identityKey(ctx.sender)) continue;
        const row = ctx.db.presence.identity.find(peer.identity);
        if (row && !rows.some(item => identityKey(item.identity) === identityKey(row.identity))) {
          rows.push(row);
        }
      }
    }
    return rows;
  }
);

export const myReadMarkers = spacetimedb.view(
  { name: 'my_read_markers', public: true },
  t.array(readMarker.rowType),
  ctx => Array.from(ctx.db.readMarker.identity.filter(ctx.sender))
);

export const myPageResults = spacetimedb.view(
  { name: 'my_page_results', public: true },
  t.array(pageResult.rowType),
  ctx => Array.from(ctx.db.pageResult.owner.filter(ctx.sender))
);
