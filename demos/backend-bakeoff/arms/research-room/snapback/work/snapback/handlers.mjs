function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

async function requireRoom(ctx, roomId) {
  const room = await ctx.db.get('rooms', roomId);
  if (!room) fail('SNAPBACK_AUTH_PERMISSION_DENIED', 'room is unavailable');
  await ctx.permissions.roomMembers.requireRole(roomId, 'owner', 'member');
  return room;
}

async function answerByAttempt(ctx, attemptId) {
  const rows = await ctx.db
    .query('answers')
    .withIndex('by_attempt')
    .eq('attemptId', attemptId)
    .collect();
  const row = rows[0];
  if (!row) fail('SNAPBACK_AUTH_PERMISSION_DENIED', 'answer is unavailable');
  await ctx.permissions.roomMembers.requireRole(row.roomId, 'owner', 'member');
  return row;
}

function embedding(index) {
  return JSON.stringify(Array.from({ length: 32 }, (_, dimension) =>
    Number((((index + 1) * (dimension + 3)) % 97 / 97).toFixed(6))));
}

function sourceHash(index) {
  return `sha256-frozen-source-${String(index).padStart(2, '0')}-65536`;
}

function safeCode(error) {
  const match = String(error?.message ?? error).match(/SNAPBACK_[A-Z0-9_]+/);
  return match ? match[0] : 'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED';
}

function ascii(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

async function reconciled(ctx, name, args) {
  for (let remaining = 3; ; remaining -= 1) {
    try {
      return await ctx.runMutation(name, args);
    } catch (error) {
      if (remaining <= 1 || safeCode(error) !== 'SNAPBACK_MUTATION_CONFLICT') throw error;
    }
  }
}

globalThis.__snapbackHandlers = {
  async listRooms(ctx) {
    const views = await ctx.db
      .query('roomViews')
      .withIndex('by_user_room')
      .eq('userId', ctx.auth.userId)
      .collect();
    const rooms = [];
    for (const view of views) {
      const room = await ctx.db.get('rooms', view.roomId);
      if (room) rooms.push(room);
    }
    return rooms.sort((a, b) => a.slug.localeCompare(b.slug));
  },

  async listSources(ctx, args) {
    await requireRoom(ctx, args.roomId);
    return await ctx.db
      .query('sources')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
  },

  async keywordSearch(ctx, args) {
    await requireRoom(ctx, args.roomId);
    const keyword = String(args.keyword).trim().toLowerCase();
    const rows = await ctx.db
      .query('sources')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
    return rows
      .filter((row) => row.keywordText.toLowerCase().split(/\s+/).includes(keyword))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  },

  async listQuestions(ctx, args) {
    await requireRoom(ctx, args.roomId);
    return await ctx.db
      .query('questions')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
  },

  async listAnswers(ctx, args) {
    await requireRoom(ctx, args.roomId);
    return await ctx.db
      .query('answers')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
  },

  async listProgress(ctx, args) {
    await requireRoom(ctx, args.roomId);
    return await ctx.db
      .query('progressEvents')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
  },

  async bootstrapResearchRooms(ctx, args) {
    const existing = await ctx.db.query('rooms').withIndex('by_slug').collect();
    if (existing.length > 0) {
      return Object.fromEntries(existing.map((row) => [row.slug, row._id]));
    }
    const result = {};
    for (const [slug, name] of [
      ['primary-room', 'Primary Research Room'],
      ['secondary-room', 'Secondary Research Room'],
    ]) {
      const roomId = await ctx.membership.roomMembers.bootstrap({
        slug,
        name,
        createdBy: ctx.auth.userId,
        createdAt: ctx.runtime.now(),
      });
      await ctx.membership.roomMembers.insert({
        roomId,
        userId: args.bobId,
        role: 'member',
      });
      await ctx.db.insert('roomViews', { roomId, userId: ctx.auth.userId });
      await ctx.db.insert('roomViews', { roomId, userId: args.bobId });
      result[slug] = roomId;
    }
    for (let index = 1; index <= 20; index += 1) {
      const slug = `source-${String(index).padStart(2, '0')}`;
      const keywords = [
        'research',
        index % 2 === 0 ? 'aurora' : 'harbor',
        index % 5 === 0 ? 'quartz' : 'paper',
      ];
      await ctx.db.insert('sources', {
        roomId: result['primary-room'],
        slug,
        title: `Frozen source ${String(index).padStart(2, '0')}`,
        ownerId: ctx.auth.userId,
        mediaType: 'text/plain',
        byteSize: 65_536,
        sha256: sourceHash(index),
        keywordText: keywords.join(' '),
        embeddingJson: embedding(index),
        refreshedAt: 0,
      });
    }
    return result;
  },

  async startQuestion(ctx, args) {
    await requireRoom(ctx, args.roomId);
    const prior = await ctx.db
      .query('questions')
      .withIndex('by_room_idempotency')
      .eq('roomId', args.roomId)
      .eq('idempotencyKey', args.idempotencyKey)
      .collect();
    if (prior.length === 1) {
      const answers = await ctx.db
        .query('answers')
        .withIndex('by_question')
        .eq('questionId', prior[0]._id)
        .collect();
      return {
        questionId: prior[0]._id,
        answerId: answers[0]._id,
        attemptId: prior[0].attemptId,
        replayed: true,
      };
    }
    const attemptId = ctx.runtime.id();
    const questionId = await ctx.db.insert('questions', {
      roomId: args.roomId,
      askedBy: ctx.auth.userId,
      prompt: String(args.prompt).trim(),
      idempotencyKey: args.idempotencyKey,
      attemptId,
      createdAt: ctx.runtime.now(),
    });
    const answerId = await ctx.db.insert('answers', {
      roomId: args.roomId,
      questionId,
      attemptId,
      content: '',
      status: 'running',
      sequence: 0,
      citationsJson: '[]',
      updatedAt: ctx.runtime.now(),
    });
    return { questionId, answerId, attemptId, replayed: false };
  },

  async applyAnswerProgress(ctx, args) {
    const answer = await answerByAttempt(ctx, args.attemptId);
    if (answer.status !== 'running') {
      return { applied: false, terminal: true, status: answer.status, sequence: answer.sequence };
    }
    if (args.sequence <= answer.sequence) {
      return { applied: false, terminal: false, status: answer.status, sequence: answer.sequence };
    }
    if (args.sequence !== answer.sequence + 1) {
      fail('SNAPBACK_ACTION_STREAM_INVALID', 'progress sequence is not contiguous');
    }
    await ctx.db.patch('answers', answer._id, {
      content: answer.content + args.delta,
      sequence: args.sequence,
      updatedAt: ctx.runtime.now(),
    });
    await ctx.db.insert('progressEvents', {
      roomId: answer.roomId,
      answerId: answer._id,
      sequence: args.sequence,
      delta: args.delta,
      recordedAt: ctx.runtime.now(),
    });
    return { applied: true, terminal: false, status: 'running', sequence: args.sequence };
  },

  async completeAnswer(ctx, args) {
    const answer = await answerByAttempt(ctx, args.attemptId);
    if (answer.status === 'complete') return { status: answer.status, sequence: answer.sequence };
    if (answer.status !== 'running') {
      return { status: answer.status, sequence: answer.sequence, terminal: true };
    }
    const expected = answer.sequence + (args.tail.length > 0 ? 1 : 0);
    if (args.sequence !== expected) fail('SNAPBACK_ACTION_STREAM_INVALID', 'terminal sequence is not contiguous');
    const sources = await ctx.db
      .query('sources')
      .withIndex('by_room')
      .eq('roomId', answer.roomId)
      .collect();
    const citations = sources
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(0, 2)
      .map((source) => source._id);
    await ctx.db.patch('answers', answer._id, {
      content: answer.content + args.tail,
      sequence: args.sequence,
      status: 'complete',
      citationsJson: JSON.stringify(citations),
      updatedAt: ctx.runtime.now(),
    });
    return { status: 'complete', sequence: args.sequence, citations };
  },

  async settleAnswer(ctx, args) {
    const allowed = ['failed', 'cancelled', 'timed_out', 'ambiguous'];
    if (!allowed.includes(args.status)) fail('SNAPBACK_ACTION_STREAM_INVALID', 'unknown settlement');
    const answer = await answerByAttempt(ctx, args.attemptId);
    if (answer.status !== 'running') {
      if (args.effectMayHaveExecuted != null && answer.effectMayHaveExecuted == null) {
        await ctx.db.patch('answers', answer._id, {
          effectMayHaveExecuted: args.effectMayHaveExecuted === true,
        });
      }
      return { status: answer.status, sequence: answer.sequence };
    }
    await ctx.db.patch('answers', answer._id, {
      status: args.status,
      effectMayHaveExecuted: args.effectMayHaveExecuted === true,
      updatedAt: ctx.runtime.now(),
    });
    return { status: args.status, sequence: answer.sequence };
  },

  async cancelAnswer(ctx, args) {
    const answer = await answerByAttempt(ctx, args.attemptId);
    if (answer.status !== 'running') return { status: answer.status, sequence: answer.sequence };
    await ctx.db.patch('answers', answer._id, {
      status: 'cancelled',
      updatedAt: ctx.runtime.now(),
    });
    return { status: 'cancelled', sequence: answer.sequence };
  },

  async applyScheduledRefresh(ctx, args) {
    const prior = await ctx.db
      .query('refreshRuns')
      .withIndex('by_slot')
      .eq('slotKey', args.slotKey)
      .collect();
    if (prior.length === 1) return { replayed: true, runId: prior[0]._id };
    const sources = await ctx.db
      .query('sources')
      .withIndex('by_room_slug')
      .collect();
    const source = sources.find((row) => row.slug === args.sourceSlug);
    if (!source) fail('SNAPBACK_ROW_NOT_FOUND', 'scheduled source unavailable');
    await ctx.db.patch('sources', source._id, { refreshedAt: ctx.runtime.now() });
    const runId = await ctx.db.insert('refreshRuns', {
      slotKey: args.slotKey,
      sourceSlug: args.sourceSlug,
      status: 'complete',
      fetchedRevision: args.fetchedRevision,
      recordedAt: ctx.runtime.now(),
    });
    return { replayed: false, runId };
  },
};
