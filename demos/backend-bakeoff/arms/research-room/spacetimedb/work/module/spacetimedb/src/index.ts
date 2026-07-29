import { ScheduleAt } from 'spacetimedb';
import { schema, table, t } from 'spacetimedb/server';

// LLP 0102 Research Room / SpacetimeDB: private source tables plus
// caller-dependent views keep authority in the database while preserving
// native WebSocket subscriptions for collaborators.
const persona = table(
  { name: 'persona' },
  {
    identity: t.identity().primaryKey(),
    name: t.string().unique(),
  }
);

const room = table(
  { name: 'room' },
  {
    id: t.string().primaryKey(),
    name: t.string(),
  }
);

const membership = table(
  { name: 'membership' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
    active: t.bool(),
  }
);

const source = table(
  { name: 'source' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    owner: t.identity().index('btree'),
    filename: t.string(),
    mimeType: t.string(),
    text: t.string(),
    bytes: t.array(t.u8()),
    contentHash: t.string(),
    embedding: t.array(t.f64()),
    createdAt: t.timestamp(),
  }
);

const question = table(
  { name: 'question' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    asker: t.identity().index('btree'),
    prompt: t.string(),
    idempotencyKey: t.string().unique(),
    status: t.string(),
    createdAt: t.timestamp(),
  }
);

const answer = table(
  { name: 'answer' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    questionId: t.string().unique(),
    status: t.string(),
    body: t.string(),
    citations: t.array(t.string()),
    effectState: t.string(),
    updatedAt: t.timestamp(),
  }
);

const progressEvent = table(
  { name: 'progress_event' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    questionId: t.string().index('btree'),
    sequence: t.u32(),
    label: t.string(),
    createdAt: t.timestamp(),
  }
);

const searchResult = table(
  { name: 'search_result' },
  {
    id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    requestId: t.string().index('btree'),
    sourceId: t.string(),
    score: t.f64(),
    kind: t.string(),
  }
);

const refreshRun = table(
  { name: 'refresh_run' },
  {
    id: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    status: t.string(),
    externalHash: t.string(),
    progressCount: t.u32(),
    effectState: t.string(),
    updatedAt: t.timestamp(),
  }
);

const answerJob = table(
  { name: 'answer_job', scheduled: (): any => advanceAnswer },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomId: t.string(),
    questionId: t.string().index('btree'),
    nextSequence: t.u32(),
  }
);

const refreshJob = table(
  { name: 'refresh_job', scheduled: (): any => refreshExternalSource },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomId: t.string(),
    runId: t.string(),
    url: t.string(),
  }
);

const spacetimedb = schema({
  persona,
  room,
  membership,
  source,
  question,
  answer,
  progressEvent,
  searchResult,
  refreshRun,
  answerJob,
  refreshJob,
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

function requireMember(ctx: any, roomId: string, identity = ctx.sender) {
  const row = ctx.db.membership.id.find(`${roomId}:${identityKey(identity)}`);
  if (!row?.active) throw new Error('room membership required');
  return row;
}

function hashBytes(bytes: number[]): string {
  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function embeddingFor(index: number): number[] {
  return Array.from({ length: 32 }, (_, dimension) =>
    Number((((index + 1) * (dimension + 3)) % 37 / 37).toFixed(8))
  );
}

function scheduleNextAnswer(ctx: any, roomId: string, questionId: string, nextSequence: number) {
  ctx.db.answerJob.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 60_000n),
    roomId,
    questionId,
    nextSequence,
  });
}

export const registerPersona = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!['Alice', 'Bob', 'Mallory'].includes(name)) throw new Error('unknown frozen persona');
    const current = ctx.db.persona.identity.find(ctx.sender);
    if (current && current.name !== name) throw new Error('identity already registered');
    const claimed = ctx.db.persona.name.find(name);
    if (claimed && identityKey(claimed.identity) !== identityKey(ctx.sender)) {
      throw new Error('persona already claimed');
    }
    if (!current) ctx.db.persona.insert({ identity: ctx.sender, name });
  }
);

export const seedFixtures = spacetimedb.reducer(ctx => {
  const actor = requirePersona(ctx);
  if (actor.name !== 'Alice') throw new Error('only Alice seeds fixtures');
  if (ctx.db.room.id.find('research-main')) throw new Error('fixture already seeded');
  const alice = ctx.db.persona.name.find('Alice');
  const bob = ctx.db.persona.name.find('Bob');
  if (!alice || !bob || !ctx.db.persona.name.find('Mallory')) {
    throw new Error('all frozen personas must register before seed');
  }

  ctx.db.room.insert({ id: 'research-main', name: 'Backend architecture' });
  ctx.db.room.insert({ id: 'research-secondary', name: 'Launch notes' });
  for (const [roomId, identity, role] of [
    ['research-main', alice.identity, 'owner'],
    ['research-main', bob.identity, 'member'],
    ['research-secondary', alice.identity, 'owner'],
    ['research-secondary', bob.identity, 'member'],
  ] as const) {
    ctx.db.membership.insert({
      id: `${roomId}:${identityKey(identity)}`,
      roomId,
      identity,
      role,
      active: true,
    });
  }

  for (let index = 1; index <= 20; index += 1) {
    const bytes = Array.from({ length: 65_536 }, (_, offset) => (index * 17 + offset) % 256);
    const cancellationText = index <= 2
      ? 'Durable cancellation safety requires an authoritative terminal fence.'
      : `Frozen backend research source ${index}.`;
    ctx.db.source.insert({
      id: `source-${String(index).padStart(2, '0')}`,
      roomId: 'research-main',
      owner: alice.identity,
      filename: index === 1 ? 'Architecture.pdf' : index === 2 ? 'Interview notes.md' : `Source-${String(index).padStart(2, '0')}.txt`,
      mimeType: index === 1 ? 'application/pdf' : 'text/plain',
      text: cancellationText,
      bytes,
      contentHash: hashBytes(bytes),
      embedding: embeddingFor(index),
      createdAt: ctx.timestamp,
    });
  }
});

export const uploadSource = spacetimedb.reducer(
  {
    id: t.string(),
    roomId: t.string(),
    filename: t.string(),
    mimeType: t.string(),
    text: t.string(),
    bytes: t.array(t.u8()),
  },
  (ctx, args) => {
    requirePersona(ctx);
    requireMember(ctx, args.roomId);
    if (ctx.db.source.id.find(args.id)) throw new Error('source id already exists');
    ctx.db.source.insert({
      ...args,
      owner: ctx.sender,
      contentHash: hashBytes(args.bytes),
      embedding: embeddingFor(args.filename.length),
      createdAt: ctx.timestamp,
    });
  }
);

export const deleteSource = spacetimedb.reducer(
  { sourceId: t.string() },
  (ctx, { sourceId }) => {
    requirePersona(ctx);
    const row = ctx.db.source.id.find(sourceId);
    if (!row) return;
    requireMember(ctx, row.roomId);
    if (identityKey(row.owner) !== identityKey(ctx.sender)) throw new Error('source owner required');
    ctx.db.source.id.delete(sourceId);
  }
);

export const keywordSearch = spacetimedb.reducer(
  { requestId: t.string(), roomId: t.string(), query: t.string() },
  (ctx, { requestId, roomId, query }) => {
    requirePersona(ctx);
    requireMember(ctx, roomId);
    const ownedRequest = `${identityKey(ctx.sender)}:${requestId}`;
    for (const old of Array.from(ctx.db.searchResult.requestId.filter(ownedRequest))) {
      ctx.db.searchResult.id.delete(old.id);
    }
    const needle = query.toLowerCase();
    for (const row of ctx.db.source.roomId.filter(roomId)) {
      if (`${row.filename}\n${row.text}`.toLowerCase().includes(needle)) {
        ctx.db.searchResult.insert({
          id: `${ownedRequest}:${row.id}`,
          owner: ctx.sender,
          requestId: ownedRequest,
          sourceId: row.id,
          score: 1,
          kind: 'keyword',
        });
      }
    }
  }
);

export const startQuestion = spacetimedb.reducer(
  {
    id: t.string(),
    roomId: t.string(),
    prompt: t.string(),
    idempotencyKey: t.string(),
  },
  (ctx, args) => {
    requirePersona(ctx);
    requireMember(ctx, args.roomId);
    if (ctx.db.question.idempotencyKey.find(args.idempotencyKey)) return;
    ctx.db.question.insert({
      ...args,
      asker: ctx.sender,
      status: 'running',
      createdAt: ctx.timestamp,
    });
    ctx.db.answer.insert({
      id: `answer:${args.id}`,
      roomId: args.roomId,
      questionId: args.id,
      status: 'running',
      body: '',
      citations: [],
      effectState: 'pending',
      updatedAt: ctx.timestamp,
    });
    scheduleNextAnswer(ctx, args.roomId, args.id, 1);
  }
);

export const advanceAnswer = spacetimedb.reducer(
  { arg: answerJob.rowType },
  (ctx, { arg }) => {
    const current = ctx.db.answer.questionId.find(arg.questionId);
    if (!current || current.status !== 'running') return;
    if (arg.nextSequence <= 4) {
      const id = `${arg.questionId}:${arg.nextSequence}`;
      if (!ctx.db.progressEvent.id.find(id)) {
        ctx.db.progressEvent.insert({
          id,
          roomId: arg.roomId,
          questionId: arg.questionId,
          sequence: arg.nextSequence,
          label: ['retrieving', 'ranking', 'drafting', 'citing'][arg.nextSequence - 1],
          createdAt: ctx.timestamp,
        });
      }
      scheduleNextAnswer(ctx, arg.roomId, arg.questionId, arg.nextSequence + 1);
      return;
    }
    ctx.db.answer.id.update({
      ...current,
      status: 'complete',
      body: 'Durable attempt identity and an authoritative cancellation fence keep late work from becoming a successful patch.',
      citations: ['source-01', 'source-02'],
      effectState: 'confirmed',
      updatedAt: ctx.timestamp,
    });
    const target = ctx.db.question.id.find(arg.questionId);
    if (target) ctx.db.question.id.update({ ...target, status: 'complete' });
  }
);

export const cancelQuestion = spacetimedb.reducer(
  { questionId: t.string() },
  (ctx, { questionId }) => {
    requirePersona(ctx);
    const current = ctx.db.answer.questionId.find(questionId);
    if (!current) throw new Error('answer missing');
    requireMember(ctx, current.roomId);
    if (current.status !== 'running') return;
    ctx.db.answer.id.update({
      ...current,
      status: 'cancelled',
      effectState: 'confirmed-cancelled',
      updatedAt: ctx.timestamp,
    });
    const target = ctx.db.question.id.find(questionId);
    if (target) ctx.db.question.id.update({ ...target, status: 'cancelled' });
    for (const job of Array.from(ctx.db.answerJob.questionId.filter(questionId))) {
      ctx.db.answerJob.scheduledId.delete(job.scheduledId);
    }
  }
);

export const latePatchProbe = spacetimedb.reducer(
  { questionId: t.string() },
  (ctx, { questionId }) => {
    requirePersona(ctx);
    const current = ctx.db.answer.questionId.find(questionId);
    if (!current) throw new Error('answer missing');
    requireMember(ctx, current.roomId);
    if (current.status !== 'running') return;
    scheduleNextAnswer(ctx, current.roomId, questionId, 99);
  }
);

export const createOutcomeFixtures = spacetimedb.reducer(
  { roomId: t.string() },
  (ctx, { roomId }) => {
    requirePersona(ctx);
    requireMember(ctx, roomId);
    for (const status of ['complete', 'failed', 'cancelled', 'timed-out', 'ambiguous']) {
      const questionId = `outcome:${status}`;
      if (ctx.db.answer.questionId.find(questionId)) continue;
      ctx.db.question.insert({
        id: questionId,
        roomId,
        asker: ctx.sender,
        prompt: `fixture ${status}`,
        idempotencyKey: questionId,
        status,
        createdAt: ctx.timestamp,
      });
      ctx.db.answer.insert({
        id: `answer:${questionId}`,
        roomId,
        questionId,
        status,
        body: '',
        citations: [],
        effectState: status === 'complete' ? 'confirmed' : status === 'ambiguous' ? 'unknown' : 'terminal',
        updatedAt: ctx.timestamp,
      });
    }
  }
);

export const scheduleRefresh = spacetimedb.reducer(
  { roomId: t.string(), runId: t.string(), url: t.string() },
  (ctx, { roomId, runId, url }) => {
    requirePersona(ctx);
    const member = requireMember(ctx, roomId);
    if (member.role !== 'owner') throw new Error('room owner required');
    if (ctx.db.refreshRun.id.find(runId)) return;
    ctx.db.refreshRun.insert({
      id: runId,
      roomId,
      status: 'queued',
      externalHash: '',
      progressCount: 0,
      effectState: 'pending',
      updatedAt: ctx.timestamp,
    });
    ctx.db.refreshJob.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 50_000n),
      roomId,
      runId,
      url,
    });
  }
);

export const refreshExternalSource = spacetimedb.procedure(
  { arg: refreshJob.rowType },
  t.unit(),
  (ctx, { arg }) => {
    const response = ctx.http.fetch(arg.url, { method: 'GET' });
    const body = response.text();
    ctx.withTx(txCtx => {
      const run = txCtx.db.refreshRun.id.find(arg.runId);
      if (!run || run.status !== 'queued') return;
      const bytes = Array.from(new TextEncoder().encode(body));
      txCtx.db.refreshRun.id.update({
        ...run,
        status: response.status === 200 ? 'complete' : 'failed',
        externalHash: hashBytes(bytes),
        progressCount: 1,
        effectState: response.status === 200 ? 'confirmed' : 'terminal',
        updatedAt: txCtx.timestamp,
      });
    });
    return {};
  }
);

function visibleRooms(ctx: any) {
  const rows = [];
  for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
    if (!member.active) continue;
    const target = ctx.db.room.id.find(member.roomId);
    if (target) rows.push(target);
  }
  return rows;
}

export const myRooms = spacetimedb.view(
  { name: 'my_rooms', public: true },
  t.array(room.rowType),
  ctx => visibleRooms(ctx)
);

export const mySources = spacetimedb.view(
  { name: 'my_sources', public: true },
  t.array(source.rowType),
  ctx => {
    const rows = [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (member.active) rows.push(...Array.from(ctx.db.source.roomId.filter(member.roomId)));
    }
    return rows;
  }
);

export const myQuestions = spacetimedb.view(
  { name: 'my_questions', public: true },
  t.array(question.rowType),
  ctx => {
    const rows = [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (member.active) rows.push(...Array.from(ctx.db.question.roomId.filter(member.roomId)));
    }
    return rows;
  }
);

export const myAnswers = spacetimedb.view(
  { name: 'my_answers', public: true },
  t.array(answer.rowType),
  ctx => {
    const rows = [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (member.active) rows.push(...Array.from(ctx.db.answer.roomId.filter(member.roomId)));
    }
    return rows;
  }
);

export const myProgress = spacetimedb.view(
  { name: 'my_progress', public: true },
  t.array(progressEvent.rowType),
  ctx => {
    const rows = [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (member.active) rows.push(...Array.from(ctx.db.progressEvent.roomId.filter(member.roomId)));
    }
    return rows;
  }
);

export const mySearchResults = spacetimedb.view(
  { name: 'my_search_results', public: true },
  t.array(searchResult.rowType),
  ctx => Array.from(ctx.db.searchResult.owner.filter(ctx.sender))
);

export const myRefreshRuns = spacetimedb.view(
  { name: 'my_refresh_runs', public: true },
  t.array(refreshRun.rowType),
  ctx => {
    const rows = [];
    for (const member of ctx.db.membership.identity.filter(ctx.sender)) {
      if (member.active) rows.push(...Array.from(ctx.db.refreshRun.roomId.filter(member.roomId)));
    }
    return rows;
  }
);
