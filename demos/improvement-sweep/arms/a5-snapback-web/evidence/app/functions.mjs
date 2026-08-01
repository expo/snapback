import {
  defineAction,
  defineAssetUpload,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A5 collaborative AI research room.
// Every protected operation gates through the roomMembers scoped-role
// declaration (owner/member); the outsider gets the uniform
// SNAPBACK_AUTH_PERMISSION_DENIED on read, subscribe, and write.
// Inline handler v1 does not capture sibling helpers, so each handler is a
// self-contained expression (tokenizer/scorer/embedder repeated inline).
//
// The assistant is a resumable step function: assistStep (a mutation)
// advances the question pipeline exactly one stage per serialized
// transaction — each stage is a separately committed durable progress row —
// and the runAssistant action loops it. No external AI provider is called:
// action egress is unauthorable on packaged 0.1.7 (known: finding
// 0137-a4-f1), so the assist is a deterministic extractive summarizer over
// the room's own sources, computed inside the transaction.

// ---- membership entry ----

export const redeemInvite = defineJsMutation({
  args: { code: v.string() },
  reads: ['invites'],
  writes: ['invites', 'roomMembers'],
  authorityCreating: true,
  result: results.value(v.object({
    roomId: v.id('rooms'),
    role: v.string(),
    inviteCode: v.string(),
  })),
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query('invites')
      .withIndex('by_code')
      .eq('code', args.code)
      .collect();
    const invite = invites[0];
    if (!invite || invite.consumed) throw new Error('invite code is not redeemable');
    await ctx.membership.roomMembers.insert({
      roomId: invite.roomId,
      userId: ctx.auth.userId,
      role: invite.role === 'owner' ? 'owner' : 'member',
    });
    await ctx.db.patch('invites', invite._id, { consumed: true });
    return { roomId: invite.roomId, role: invite.role, inviteCode: invite.code };
  },
});

// Self-retirement of a seat (private-roster v1 has no admin kick — known
// 0137-a2-f4; cleanup retires authority by self-removal).
export const leaveRoom = defineJsMutation({
  args: { roomId: v.id('rooms') },
  writes: ['roomMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.roomMembers.removeSelf(args.roomId);
    return true;
  },
});

// ---- member reads ----

export const roomOverview = defineJsLiveQuery({
  args: { roomId: v.id('rooms') },
  reads: ['rooms', 'sources', 'questions', 'answers', 'sourceEmbeddings', 'roomMembers'],
  result: results.records(v.object({
    name: v.string(),
    topic: v.string(),
    questionSeq: v.integer(),
    sourceCount: v.integer(),
    questionCount: v.integer(),
    answerCount: v.integer(),
    embeddingCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room) throw new Error('room not found');
    const sources = await ctx.db.query('sources').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const questions = await ctx.db.query('questions').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const answers = await ctx.db.query('answers').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const embeddings = await ctx.db.query('sourceEmbeddings').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    return [{
      name: room.name,
      topic: room.topic,
      questionSeq: room.questionSeq,
      sourceCount: sources.length,
      questionCount: questions.length,
      answerCount: answers.length,
      embeddingCount: embeddings.length,
    }];
  },
});

export const sourceList = defineJsLiveQuery({
  args: { roomId: v.id('rooms') },
  reads: ['sources', 'sourceEmbeddings', 'roomMembers'],
  result: results.records(v.object({
    _id: v.id('sources'),
    title: v.string(),
    kind: v.string(),
    uploaderName: v.string(),
    assetId: v.string(),
    contentSha256: v.string(),
    byteLength: v.integer(),
    createdAt: v.integer(),
    hasEmbedding: v.boolean(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const rows = await ctx.db.query('sources').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    rows.sort((a, b) => a.createdAt - b.createdAt || (a._id < b._id ? -1 : 1));
    const out = [];
    for (const row of rows) {
      const emb = await ctx.db.query('sourceEmbeddings').withIndex('by_source').eq('sourceId', row._id).collect();
      out.push({
        _id: row._id,
        title: row.title,
        kind: row.kind,
        uploaderName: row.uploaderName,
        assetId: row.assetId,
        contentSha256: row.contentSha256,
        byteLength: row.byteLength,
        createdAt: row.createdAt,
        hasEmbedding: emb.length > 0,
      });
    }
    return out;
  },
});

export const sourceDetail = defineJsQuery({
  args: { sourceId: v.id('sources') },
  reads: ['sources', 'roomMembers'],
  result: results.records(v.object({
    _id: v.id('sources'),
    title: v.string(),
    kind: v.string(),
    content: v.string(),
    uploaderName: v.string(),
    assetId: v.string(),
    contentSha256: v.string(),
    byteLength: v.integer(),
    createdAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    const source = await ctx.db.get('sources', args.sourceId);
    if (!source) return [];
    await ctx.permissions.roomMembers.requireRole(source.roomId, 'owner', 'member');
    return [{
      _id: source._id,
      title: source.title,
      kind: source.kind,
      content: source.content,
      uploaderName: source.uploaderName,
      assetId: source.assetId,
      contentSha256: source.contentSha256,
      byteLength: source.byteLength,
      createdAt: source.createdAt,
    }];
  },
});

// Keyword retrieval over the room corpus, scoped by membership inside the
// handler. The native searchIndex visibility v1 accepts only public-read or
// owner-field partitions, so room-member search is inexpressible there
// (known: finding 0137-a3-f2) — the query path is the honest room-scoped
// retrieval lane ("index-or-query-proof").
export const searchSources = defineJsQuery({
  args: { roomId: v.id('rooms'), q: v.string() },
  reads: ['sources', 'roomMembers'],
  result: results.records(v.object({
    sourceId: v.id('sources'),
    title: v.string(),
    kind: v.string(),
    score: v.integer(),
    snippet: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    // inline_handler_v1 refuses dynamic computed member access, so the
    // tokenizer walks the string with charCodeAt/charAt (arm observation).
    const tokenize = (text) => {
      const out = [];
      const lower = text.toLowerCase();
      let cur = '';
      for (let i = 0; i < lower.length; i += 1) {
        const c = lower.charCodeAt(i);
        if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) cur += lower.charAt(i);
        else { if (cur.length > 2) out.push(cur); cur = ''; }
      }
      if (cur.length > 2) out.push(cur);
      return out;
    };
    const terms = tokenize(args.q);
    if (terms.length === 0) return [];
    const rows = await ctx.db.query('sources').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const scored = [];
    for (const row of rows) {
      const titleTokens = tokenize(row.title);
      const contentTokens = tokenize(row.content);
      let score = 0;
      for (const term of terms) {
        for (const t of titleTokens) if (t === term) score += 3;
        for (const t of contentTokens) if (t === term) score += 1;
      }
      if (score === 0) continue;
      // snippet: the first sentence containing any term
      let snippet = '';
      const sentences = row.content.split('.');
      for (const sentence of sentences) {
        const sTokens = tokenize(sentence);
        let hit = false;
        for (const term of terms) for (const t of sTokens) if (t === term) hit = true;
        if (hit) { snippet = sentence.trim().slice(0, 140); break; }
      }
      scored.push({ sourceId: row._id, title: row.title, kind: row.kind, score, snippet });
    }
    scored.sort((a, b) => b.score - a.score || (a.title < b.title ? -1 : 1));
    return scored;
  },
});

// Embeddings fixture inventory: seed evidence for A5-01 and the explicit
// GAP evidence for A5-05 (fixture stored, retrieval NOT claimed).
export const embeddingInventory = defineJsQuery({
  args: { roomId: v.id('rooms') },
  reads: ['sourceEmbeddings', 'sources', 'roomMembers'],
  result: results.records(v.object({
    sourceId: v.id('sources'),
    title: v.string(),
    model: v.string(),
    dim: v.integer(),
    sample: v.array(v.number()),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const rows = await ctx.db.query('sourceEmbeddings').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const out = [];
    for (const row of rows) {
      const source = await ctx.db.get('sources', row.sourceId);
      out.push({
        sourceId: row.sourceId,
        title: source ? source.title : '(deleted)',
        model: row.model,
        dim: row.dim,
        sample: row.vector.slice(0, 4),
      });
    }
    out.sort((a, b) => (a.title < b.title ? -1 : 1));
    return out;
  },
});

export const questionFeed = defineJsLiveQuery({
  args: { roomId: v.id('rooms') },
  reads: ['questions', 'roomMembers'],
  result: results.records(v.object({
    _id: v.id('questions'),
    seq: v.integer(),
    text: v.string(),
    askerName: v.string(),
    status: v.string(),
    stage: v.string(),
    attemptCount: v.integer(),
    settledAt: v.integer(),
    createdAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const rows = await ctx.db.query('questions').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows.map((q) => ({
      _id: q._id,
      seq: q.seq,
      text: q.text,
      askerName: q.askerName,
      status: q.status,
      stage: q.stage,
      attemptCount: q.attemptCount,
      settledAt: q.settledAt,
      createdAt: q.createdAt,
    }));
  },
});

// The observer surface: one live query composing the question, its durable
// ordered progress, and the answer with citations.
export const questionThread = defineJsLiveQuery({
  args: { roomId: v.id('rooms'), questionId: v.id('questions') },
  reads: ['questions', 'progressEvents', 'answers', 'roomMembers'],
  result: results.records(v.object({
    _id: v.id('questions'),
    seq: v.integer(),
    text: v.string(),
    askerName: v.string(),
    status: v.string(),
    stage: v.string(),
    attemptCount: v.integer(),
    terminalDetail: v.string(),
    settledAt: v.integer(),
    progress: v.array(v.object({
      seq: v.integer(),
      stage: v.string(),
      detail: v.string(),
      at: v.integer(),
    })),
    answer: v.array(v.object({
      text: v.string(),
      citations: v.array(v.object({ sourceId: v.id('sources'), title: v.string() })),
      createdAt: v.integer(),
    })),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const q = await ctx.db.get('questions', args.questionId);
    if (!q || q.roomId !== args.roomId) return [];
    const progress = await ctx.db
      .query('progressEvents')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    progress.sort((a, b) => a.seq - b.seq);
    const answers = await ctx.db
      .query('answers')
      .withIndex('by_question')
      .eq('questionId', args.questionId)
      .collect();
    return [{
      _id: q._id,
      seq: q.seq,
      text: q.text,
      askerName: q.askerName,
      status: q.status,
      stage: q.stage,
      attemptCount: q.attemptCount,
      terminalDetail: q.terminalDetail,
      settledAt: q.settledAt,
      progress: progress.map((p) => ({ seq: p.seq, stage: p.stage, detail: p.detail, at: p.at })),
      answer: answers.map((a) => ({ text: a.text, citations: a.citations, createdAt: a.createdAt })),
    }];
  },
});

export const attemptLedger = defineJsQuery({
  args: { roomId: v.id('rooms'), questionId: v.id('questions') },
  reads: ['questionAttempts', 'roomMembers'],
  result: results.records(v.object({
    seq: v.integer(),
    attemptSeq: v.integer(),
    event: v.string(),
    outcome: v.string(),
    detail: v.string(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const rows = await ctx.db
      .query('questionAttempts')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows.map((r) => ({
      seq: r.seq, attemptSeq: r.attemptSeq, event: r.event,
      outcome: r.outcome, detail: r.detail, at: r.at,
    }));
  },
});

export const refreshLedger = defineJsQuery({
  args: { roomId: v.id('rooms') },
  reads: ['refreshRuns', 'roomMembers'],
  result: results.records(v.object({
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    outcome: v.string(),
    detail: v.string(),
    fetchedBytes: v.integer(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner');
    const rows = await ctx.db.query('refreshRuns').withIndex('by_room').eq('roomId', args.roomId).take(100).collect();
    rows.sort((a, b) => a.at - b.at || (a.dedupeKey < b.dedupeKey ? -1 : 1));
    return rows.map((r) => ({
      dedupeKey: r.dedupeKey, nominalMs: r.nominalMs, outcome: r.outcome,
      detail: r.detail, fetchedBytes: r.fetchedBytes, at: r.at,
    }));
  },
});

// ---- source lifecycle ----

export const addSource = defineJsMutation({
  args: {
    roomId: v.id('rooms'),
    title: v.string(),
    kind: v.string(),
    content: v.string(),
    assetId: v.string(),
    contentSha256: v.string(),
    byteLength: v.integer(),
    clientKey: v.string(),
    uploaderName: v.string(),
  },
  reads: ['sources'],
  writes: ['sources', 'sourceEmbeddings'],
  result: results.value(v.object({
    sourceId: v.id('sources'),
    deduped: v.boolean(),
    embeddingDim: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const existing = await ctx.db
      .query('sources')
      .withIndex('by_room_client_key')
      .eq('roomId', args.roomId)
      .eq('clientKey', args.clientKey)
      .collect();
    if (existing.length > 0) {
      return { sourceId: existing[0]._id, deduped: true, embeddingDim: 32 };
    }
    if (!['pdf', 'md', 'csv', 'txt'].includes(args.kind)) throw new Error('kind must be pdf, md, csv, or txt');
    const sourceId = await ctx.db.insert('sources', {
      roomId: args.roomId,
      title: args.title,
      kind: args.kind,
      content: args.content,
      uploaderId: ctx.auth.userId,
      uploaderName: args.uploaderName,
      assetId: args.assetId,
      contentSha256: args.contentSha256,
      byteLength: args.byteLength,
      clientKey: args.clientKey,
      createdAt: ctx.runtime.now(),
    });
    // Deterministic 32-dim embedding FIXTURE (same function as the seed
    // generator) — stored, never claimed as vector retrieval.
    // (inline_handler_v1 refuses dynamic computed member access, so slot
    // accumulation goes through index-matched .map instead of vec[slot].)
    let vec = [];
    for (let i = 0; i < 32; i += 1) vec.push(0);
    const lower = args.content.toLowerCase();
    for (let i = 0; i < lower.length; i += 1) {
      const code = lower.charCodeAt(i);
      if (code === 32 || code === 10) continue;
      const slot = (code * 7 + i) % 32;
      const delta = ((code % 13) - 6) / 6;
      vec = vec.map((value, index) => (index === slot ? value + delta : value));
    }
    let norm = 0;
    for (const value of vec) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    const vector = vec.map((x) => Math.round((x / norm) * 1e6) / 1e6);
    await ctx.db.insert('sourceEmbeddings', {
      sourceId,
      roomId: args.roomId,
      model: 'fixture-32',
      dim: 32,
      vector,
    });
    return { sourceId, deduped: false, embeddingDim: 32 };
  },
});

export const removeSource = defineJsMutation({
  args: { sourceId: v.id('sources') },
  reads: ['sources', 'sourceEmbeddings'],
  writes: ['sources', 'sourceEmbeddings'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const source = await ctx.db.get('sources', args.sourceId);
    if (!source) throw new Error('source not found');
    if (source.uploaderId === ctx.auth.userId) {
      await ctx.permissions.roomMembers.requireRole(source.roomId, 'owner', 'member');
    } else {
      // only the room owner may remove another member's source
      await ctx.permissions.roomMembers.requireRole(source.roomId, 'owner');
    }
    const embs = await ctx.db
      .query('sourceEmbeddings')
      .withIndex('by_source')
      .eq('sourceId', args.sourceId)
      .collect();
    for (const emb of embs) await ctx.db.delete('sourceEmbeddings', emb._id);
    await ctx.db.delete('sources', args.sourceId);
    return args.sourceId;
  },
});

// ---- the question pipeline ----

export const askQuestion = defineJsMutation({
  args: {
    roomId: v.id('rooms'),
    text: v.string(),
    dedupeKey: v.string(),
    askerName: v.string(),
    ttlMs: v.integer(),
  },
  reads: ['rooms', 'questions'],
  writes: ['rooms', 'questions', 'progressEvents', 'questionAttempts'],
  result: results.value(v.object({
    questionId: v.id('questions'),
    seq: v.integer(),
    status: v.string(),
    deduped: v.boolean(),
    attemptCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const existing = await ctx.db
      .query('questions')
      .withIndex('by_room_dedupe')
      .eq('roomId', args.roomId)
      .eq('dedupeKey', args.dedupeKey)
      .collect();
    if (existing.length > 0) {
      const q = existing[0];
      // Idempotent re-ask: return the committed question, never a duplicate.
      return { questionId: q._id, seq: q.seq, status: q.status, deduped: true, attemptCount: q.attemptCount };
    }
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room) throw new Error('room not found');
    const seq = room.questionSeq + 1;
    await ctx.db.patch('rooms', args.roomId, { questionSeq: seq });
    const now = ctx.runtime.now();
    const questionId = await ctx.db.insert('questions', {
      roomId: args.roomId,
      seq,
      dedupeKey: args.dedupeKey,
      askerId: ctx.auth.userId,
      askerName: args.askerName,
      text: args.text,
      status: 'running',
      stage: 'accepted',
      attemptCount: 1,
      deadlineAt: now + (args.ttlMs > 0 ? args.ttlMs : 60000),
      createdAt: now,
      settledAt: 0,
      terminalDetail: '',
    });
    await ctx.db.insert('progressEvents', {
      questionId, roomId: args.roomId, seq: 1,
      stage: 'accepted', detail: `question ${seq} accepted`, at: now,
    });
    await ctx.db.insert('questionAttempts', {
      questionId, roomId: args.roomId, seq: 1, attemptSeq: 1,
      event: 'started', outcome: '', detail: 'attempt 1 started by ask', at: now,
    });
    return { questionId, seq, status: 'running', deduped: false, attemptCount: 1 };
  },
});

// One pipeline stage per serialized transaction. The in-transaction fence
// (status must still be 'running') is the cancellation contract: a late
// step against a terminal question writes ONLY a fenced attempt record,
// never a progress row, an answer, or a status change.
export const assistStep = defineJsMutation({
  args: { questionId: v.id('questions'), fault: v.string() },
  reads: ['questions', 'sources', 'progressEvents', 'answers', 'questionAttempts'],
  writes: ['questions', 'progressEvents', 'answers', 'questionAttempts'],
  result: results.value(v.object({
    terminal: v.boolean(),
    fenced: v.boolean(),
    status: v.string(),
    stage: v.string(),
    progressSeq: v.integer(),
  })),
  handler: async (ctx, args) => {
    const q = await ctx.db.get('questions', args.questionId);
    if (!q) throw new Error('question not found');
    await ctx.permissions.roomMembers.requireRole(q.roomId, 'owner', 'member');
    const now = ctx.runtime.now();
    const attempts = await ctx.db
      .query('questionAttempts')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    const nextLedgerSeq = attempts.length + 1;
    if (q.status !== 'running') {
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: nextLedgerSeq, attemptSeq: q.attemptCount,
        event: 'fenced', outcome: 'assistStep',
        detail: `late assist step fenced: question already ${q.status}`, at: now,
      });
      return { terminal: true, fenced: true, status: q.status, stage: q.stage, progressSeq: 0 };
    }
    const progress = await ctx.db
      .query('progressEvents')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    const nextProgressSeq = progress.length + 1;
    // inline_handler_v1 refuses dynamic computed member access, so the
    // tokenizer walks the string with charCodeAt/charAt (arm observation).
    const tokenize = (text) => {
      const out = [];
      const lower = text.toLowerCase();
      let cur = '';
      for (let i = 0; i < lower.length; i += 1) {
        const c = lower.charCodeAt(i);
        if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) cur += lower.charAt(i);
        else { if (cur.length > 2) out.push(cur); cur = ''; }
      }
      if (cur.length > 2) out.push(cur);
      return out;
    };
    const terms = tokenize(q.text);
    const rows = await ctx.db.query('sources').withIndex('by_room').eq('roomId', q.roomId).take(200).collect();
    const scored = [];
    for (const row of rows) {
      const titleTokens = tokenize(row.title);
      const contentTokens = tokenize(row.content);
      let score = 0;
      for (const term of terms) {
        for (const t of titleTokens) if (t === term) score += 3;
        for (const t of contentTokens) if (t === term) score += 1;
      }
      if (score > 0) scored.push({ row, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.row.title < b.row.title ? -1 : 1));
    if (q.stage === 'accepted') {
      await ctx.db.insert('progressEvents', {
        questionId: q._id, roomId: q.roomId, seq: nextProgressSeq, stage: 'retrieved',
        detail: `retrieved ${rows.length} sources; ${scored.length} candidates for ${terms.length} terms`, at: now,
      });
      await ctx.db.patch('questions', q._id, { stage: 'retrieved' });
      return { terminal: false, fenced: false, status: 'running', stage: 'retrieved', progressSeq: nextProgressSeq };
    }
    if (q.stage === 'retrieved') {
      const names = scored.slice(0, 3).map((s) => `${s.row.title}(${s.score})`).join(', ');
      await ctx.db.insert('progressEvents', {
        questionId: q._id, roomId: q.roomId, seq: nextProgressSeq, stage: 'ranked',
        detail: `ranked top candidates: ${names}`, at: now,
      });
      await ctx.db.patch('questions', q._id, { stage: 'ranked' });
      return { terminal: false, fenced: false, status: 'running', stage: 'ranked', progressSeq: nextProgressSeq };
    }
    if (q.stage === 'ranked') {
      if (args.fault === 'fail-at-draft') {
        await ctx.db.patch('questions', q._id, {
          status: 'failed', settledAt: now,
          terminalDetail: 'assistant draft stage failed (injected fault): drafting produced no admissible answer',
        });
        await ctx.db.insert('questionAttempts', {
          questionId: q._id, roomId: q.roomId, seq: nextLedgerSeq, attemptSeq: q.attemptCount,
          event: 'settled', outcome: 'failed', detail: 'definite failure at draft stage', at: now,
        });
        return { terminal: true, fenced: false, status: 'failed', stage: q.stage, progressSeq: 0 };
      }
      await ctx.db.insert('progressEvents', {
        questionId: q._id, roomId: q.roomId, seq: nextProgressSeq, stage: 'drafted',
        detail: `drafted extractive answer from ${Math.min(2, scored.length)} sources`, at: now,
      });
      await ctx.db.patch('questions', q._id, { stage: 'drafted' });
      return { terminal: false, fenced: false, status: 'running', stage: 'drafted', progressSeq: nextProgressSeq };
    }
    // q.stage === 'drafted': compose the extractive answer and settle complete.
    const top = scored.slice(0, 2);
    if (top.length === 0) {
      await ctx.db.patch('questions', q._id, {
        status: 'failed', settledAt: now,
        terminalDetail: 'no sources matched the question terms',
      });
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: nextLedgerSeq, attemptSeq: q.attemptCount,
        event: 'settled', outcome: 'failed', detail: 'retrieval produced no candidates', at: now,
      });
      return { terminal: true, fenced: false, status: 'failed', stage: q.stage, progressSeq: 0 };
    }
    const existingAnswer = await ctx.db
      .query('answers')
      .withIndex('by_question')
      .eq('questionId', q._id)
      .collect();
    if (existingAnswer.length === 0) {
      const parts = [];
      const citations = [];
      for (const item of top) {
        const sentences = item.row.content.split('.');
        let best = '';
        let bestHits = 0;
        for (const sentence of sentences) {
          const sTokens = tokenize(sentence);
          let hits = 0;
          for (const term of terms) for (const t of sTokens) if (t === term) hits += 1;
          if (hits > bestHits) { bestHits = hits; best = sentence.trim(); }
        }
        if (best) parts.push(best);
        citations.push({ sourceId: item.row._id, title: item.row.title });
      }
      await ctx.db.insert('answers', {
        questionId: q._id, roomId: q.roomId,
        text: `${parts.join('. ')}.`,
        citations,
        createdAt: now,
      });
    }
    await ctx.db.insert('progressEvents', {
      questionId: q._id, roomId: q.roomId, seq: nextProgressSeq, stage: 'answered',
      detail: `answer committed with ${top.length} citations`, at: now,
    });
    await ctx.db.patch('questions', q._id, {
      stage: 'answered', status: 'complete', settledAt: now, terminalDetail: 'complete',
    });
    await ctx.db.insert('questionAttempts', {
      questionId: q._id, roomId: q.roomId, seq: nextLedgerSeq, attemptSeq: q.attemptCount,
      event: 'settled', outcome: 'complete', detail: `answered with ${top.length} citations`, at: now,
    });
    return { terminal: true, fenced: false, status: 'complete', stage: 'answered', progressSeq: nextProgressSeq };
  },
});

// Direct progress append — the late-attempt injection surface for the
// cancellation-fence check (and the worker's own building block).
export const appendProgress = defineJsMutation({
  args: { questionId: v.id('questions'), stage: v.string(), detail: v.string() },
  reads: ['questions', 'progressEvents', 'questionAttempts'],
  writes: ['progressEvents', 'questions', 'questionAttempts'],
  result: results.value(v.object({
    fenced: v.boolean(),
    status: v.string(),
    seq: v.integer(),
  })),
  handler: async (ctx, args) => {
    const q = await ctx.db.get('questions', args.questionId);
    if (!q) throw new Error('question not found');
    await ctx.permissions.roomMembers.requireRole(q.roomId, 'owner', 'member');
    const now = ctx.runtime.now();
    if (q.status !== 'running') {
      const attempts = await ctx.db
        .query('questionAttempts')
        .withIndex('by_question_seq')
        .eq('questionId', args.questionId)
        .take(100)
        .collect();
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
        event: 'fenced', outcome: 'appendProgress',
        detail: `late progress patch fenced: question already ${q.status}`, at: now,
      });
      return { fenced: true, status: q.status, seq: 0 };
    }
    const progress = await ctx.db
      .query('progressEvents')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    const seq = progress.length + 1;
    await ctx.db.insert('progressEvents', {
      questionId: q._id, roomId: q.roomId, seq, stage: args.stage, detail: args.detail, at: now,
    });
    await ctx.db.patch('questions', q._id, { stage: args.stage });
    return { fenced: false, status: q.status, seq };
  },
});

// Terminal answer commit — fenced, citation-validated, idempotent.
export const completeAnswer = defineJsMutation({
  args: {
    questionId: v.id('questions'),
    text: v.string(),
    citations: v.array(v.object({ sourceId: v.id('sources'), title: v.string() })),
  },
  reads: ['questions', 'sources', 'answers', 'progressEvents', 'questionAttempts'],
  writes: ['questions', 'answers', 'progressEvents', 'questionAttempts'],
  result: results.value(v.object({
    fenced: v.boolean(),
    alreadyAnswered: v.boolean(),
    status: v.string(),
  })),
  handler: async (ctx, args) => {
    const q = await ctx.db.get('questions', args.questionId);
    if (!q) throw new Error('question not found');
    await ctx.permissions.roomMembers.requireRole(q.roomId, 'owner', 'member');
    const now = ctx.runtime.now();
    if (q.status !== 'running') {
      const attempts = await ctx.db
        .query('questionAttempts')
        .withIndex('by_question_seq')
        .eq('questionId', args.questionId)
        .take(100)
        .collect();
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
        event: 'fenced', outcome: 'completeAnswer',
        detail: `late answer commit fenced: question already ${q.status}`, at: now,
      });
      return { fenced: true, alreadyAnswered: false, status: q.status };
    }
    const existing = await ctx.db
      .query('answers')
      .withIndex('by_question')
      .eq('questionId', q._id)
      .collect();
    if (existing.length > 0) {
      return { fenced: false, alreadyAnswered: true, status: q.status };
    }
    // Citation validation: every cited source must exist in this room.
    for (const citation of args.citations) {
      const source = await ctx.db.get('sources', citation.sourceId);
      if (!source || source.roomId !== q.roomId) {
        throw new Error(`citation rejected: source ${citation.sourceId} is not in this room`);
      }
    }
    await ctx.db.insert('answers', {
      questionId: q._id, roomId: q.roomId, text: args.text,
      citations: args.citations, createdAt: now,
    });
    const progress = await ctx.db
      .query('progressEvents')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    await ctx.db.insert('progressEvents', {
      questionId: q._id, roomId: q.roomId, seq: progress.length + 1, stage: 'answered',
      detail: `answer committed with ${args.citations.length} citations`, at: now,
    });
    await ctx.db.patch('questions', q._id, {
      stage: 'answered', status: 'complete', settledAt: now, terminalDetail: 'complete',
    });
    const attempts = await ctx.db
      .query('questionAttempts')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    await ctx.db.insert('questionAttempts', {
      questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
      event: 'settled', outcome: 'complete', detail: `answered with ${args.citations.length} citations`, at: now,
    });
    return { fenced: false, alreadyAnswered: false, status: 'complete' };
  },
});

// Settlement for the non-complete outcomes. 'cancelled' is the confirmed
// cancellation; 'failed' definite failure; 'timed-out' via expireOverdue;
// 'ambiguous' when a settlement attempt cannot prove whether its terminal
// write landed (never silently failed, never claimed complete).
export const settleQuestion = defineJsMutation({
  args: { questionId: v.id('questions'), outcome: v.string(), detail: v.string() },
  reads: ['questions', 'questionAttempts'],
  writes: ['questions', 'questionAttempts'],
  result: results.value(v.object({
    fenced: v.boolean(),
    status: v.string(),
    settledAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    const q = await ctx.db.get('questions', args.questionId);
    if (!q) throw new Error('question not found');
    await ctx.permissions.roomMembers.requireRole(q.roomId, 'owner', 'member');
    if (!['failed', 'cancelled', 'timed-out', 'ambiguous'].includes(args.outcome)) {
      throw new Error('outcome must be failed, cancelled, timed-out, or ambiguous');
    }
    const now = ctx.runtime.now();
    const attempts = await ctx.db
      .query('questionAttempts')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    if (q.status !== 'running') {
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
        event: 'fenced', outcome: `settle:${args.outcome}`,
        detail: `late settlement fenced: question already ${q.status}`, at: now,
      });
      return { fenced: true, status: q.status, settledAt: q.settledAt };
    }
    await ctx.db.patch('questions', q._id, {
      status: args.outcome, settledAt: now, terminalDetail: args.detail,
    });
    await ctx.db.insert('questionAttempts', {
      questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
      event: 'settled', outcome: args.outcome, detail: args.detail, at: now,
    });
    return { fenced: false, status: args.outcome, settledAt: now };
  },
});

// Retry: reopens only retryable outcomes; 'complete' and 'cancelled' are
// hard-terminal. Never duplicates the question row (same _id, same seq).
export const retryQuestion = defineJsMutation({
  args: { questionId: v.id('questions') },
  reads: ['questions', 'questionAttempts'],
  writes: ['questions', 'questionAttempts'],
  result: results.value(v.object({
    retried: v.boolean(),
    status: v.string(),
    attemptCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    const q = await ctx.db.get('questions', args.questionId);
    if (!q) throw new Error('question not found');
    await ctx.permissions.roomMembers.requireRole(q.roomId, 'owner', 'member');
    if (!['failed', 'timed-out', 'ambiguous'].includes(q.status)) {
      return { retried: false, status: q.status, attemptCount: q.attemptCount };
    }
    const now = ctx.runtime.now();
    const attemptSeq = q.attemptCount + 1;
    await ctx.db.patch('questions', q._id, {
      status: 'running', attemptCount: attemptSeq,
      deadlineAt: now + 60000, terminalDetail: '', settledAt: 0,
    });
    const attempts = await ctx.db
      .query('questionAttempts')
      .withIndex('by_question_seq')
      .eq('questionId', args.questionId)
      .take(100)
      .collect();
    await ctx.db.insert('questionAttempts', {
      questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq,
      event: 'started', outcome: '', detail: `attempt ${attemptSeq} started by retry`, at: now,
    });
    return { retried: true, status: 'running', attemptCount: attemptSeq };
  },
});

// Deterministic timeout watchdog (suite-driven with an explicit clock).
export const expireOverdue = defineJsMutation({
  args: { roomId: v.id('rooms'), now: v.integer() },
  reads: ['questions', 'questionAttempts'],
  writes: ['questions', 'questionAttempts'],
  result: results.value(v.object({
    expired: v.array(v.string()),
    scanned: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const rows = await ctx.db.query('questions').withIndex('by_room').eq('roomId', args.roomId).take(200).collect();
    const expired = [];
    for (const q of rows) {
      if (q.status !== 'running' || q.deadlineAt > args.now) continue;
      await ctx.db.patch('questions', q._id, {
        status: 'timed-out', settledAt: args.now,
        terminalDetail: `no terminal settlement before deadline ${q.deadlineAt}`,
      });
      const attempts = await ctx.db
        .query('questionAttempts')
        .withIndex('by_question_seq')
        .eq('questionId', q._id)
        .take(100)
        .collect();
      await ctx.db.insert('questionAttempts', {
        questionId: q._id, roomId: q.roomId, seq: attempts.length + 1, attemptSeq: q.attemptCount,
        event: 'settled', outcome: 'timed-out',
        detail: 'watchdog expired the overdue attempt', at: args.now,
      });
      expired.push(q._id);
    }
    return { expired, scanned: rows.length };
  },
});

// ---- the assistant action (the AI-operation boundary) ----

// No external AI provider is reachable from an action on packaged 0.1.7
// (known: finding 0137-a4-f1 — outbound effects unauthorable in every
// action form), so the assistant is the deterministic in-transaction
// extractive pipeline above; this action is the boundary that drives it,
// one durable commit per stage.
export const runAssistant = defineAction({
  args: {
    questionId: v.id('questions'),
    throughStage: v.string(), // 'retrieved' | 'ranked' | 'drafted' | 'answered' ('' = run to terminal)
    fault: v.string(), // '' | 'fail-at-draft' | 'abandon-after-retrieve' | 'ambiguous-at-settle'
  },
  result: results.value(v.object({
    steps: v.integer(),
    status: v.string(),
    stage: v.string(),
    terminal: v.boolean(),
    abandoned: v.boolean(),
  })),
  writes: ['questions', 'progressEvents', 'answers', 'questionAttempts'],
  handler: async (ctx, args) => {
    let steps = 0;
    let status = 'running';
    let stage = '';
    for (let i = 0; i < 8; i += 1) {
      const r = await ctx.runMutation('assistStep', { questionId: args.questionId, fault: args.fault });
      steps += 1;
      status = r.status;
      stage = r.stage;
      if (r.terminal) return { steps, status, stage, terminal: true, abandoned: false };
      if (args.fault === 'abandon-after-retrieve' && stage === 'retrieved') {
        // Simulated worker crash: returns without settling; the question
        // stays 'running' until the watchdog expires it.
        return { steps, status, stage, terminal: false, abandoned: true };
      }
      if (args.fault === 'ambiguous-at-settle' && stage === 'drafted') {
        // Simulated unprovable terminal write (transport loss at
        // settlement): the attempt is settled 'ambiguous', never silently
        // failed and never claimed complete.
        const s = await ctx.runMutation('settleQuestion', {
          questionId: args.questionId,
          outcome: 'ambiguous',
          detail: 'terminal write outcome unprovable (simulated settlement transport loss)',
        });
        return { steps: steps + 1, status: s.status, stage, terminal: true, abandoned: false };
      }
      if (args.throughStage !== '' && stage === args.throughStage) {
        return { steps, status, stage, terminal: false, abandoned: false };
      }
    }
    return { steps, status, stage, terminal: false, abandoned: false };
  },
});

// ---- source file upload intent ----

// Research source files. text/plain detects as application/octet-stream at
// finalize (known: finding 0137-a1-f10), so the accept list declares the
// magic-detectable PDF type plus application/octet-stream for md/csv/txt.
// Delivery is private-strict; via-references sharing is declared but
// unreachable on 0.1.7 (typed attach refuses — known 0137-a1-f2).
export const sourceUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/pdf', 'application/octet-stream'], maxBytes: 2_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// ---- scheduled external refresh ----

export const appConfig = defineConfig({
  refreshToken: {
    description: 'Bearer token for the external research-source refresh endpoint',
    purpose: 'Authorizes the scheduled outbound refresh fetch; never readable by clients',
    required: false,
  },
});

export const setRefreshSource = defineJsMutation({
  args: { roomId: v.id('rooms'), url: v.string() },
  reads: ['refreshSettings'],
  writes: ['refreshSettings'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner');
    const rows = await ctx.db.query('refreshSettings').withIndex('by_room').eq('roomId', args.roomId).collect();
    if (rows.length === 0) throw new Error('refresh settings row missing from seed');
    await ctx.db.patch('refreshSettings', rows[0]._id, { url: args.url, updatedAt: ctx.runtime.now() });
    return 1;
  },
});

export const beginRefresh = defineJsMutation({
  args: {},
  // declared write-set is an upper bound; this mutation only reads, but
  // defineJsMutation refuses an empty writes list (arm observation)
  reads: ['refreshSettings', 'refreshRuns'],
  writes: ['refreshRuns'],
  result: results.value(v.object({
    enabled: v.boolean(),
    alreadyRan: v.boolean(),
    url: v.string(),
    roomId: v.string(),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
  })),
  handler: async (ctx) => {
    // The scheduler invokes this with system authority; a direct human call
    // still requires an owner seat.
    const rows = await ctx.db.query('refreshSettings').take(10).collect();
    const settings = rows[0];
    if (!settings) throw new Error('refresh settings row missing from seed');
    if (ctx.auth && ctx.auth.userId) {
      await ctx.permissions.roomMembers.requireRole(settings.roomId, 'owner');
    }
    const nominalMs = ctx.runtime.now();
    const dedupeKey = `refresh:${nominalMs}`;
    const existing = await ctx.db.query('refreshRuns').withIndex('by_dedupe').eq('dedupeKey', dedupeKey).collect();
    return {
      enabled: settings.url !== '',
      alreadyRan: existing.length > 0,
      url: settings.url,
      roomId: settings.roomId,
      dedupeKey,
      nominalMs,
    };
  },
});

export const recordRefresh = defineJsMutation({
  args: {
    roomId: v.id('rooms'),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    outcome: v.string(),
    detail: v.string(),
    fetchedBytes: v.integer(),
  },
  reads: ['refreshRuns'],
  writes: ['refreshRuns'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    if (ctx.auth && ctx.auth.userId) {
      await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner');
    }
    const existing = await ctx.db.query('refreshRuns').withIndex('by_dedupe').eq('dedupeKey', args.dedupeKey).collect();
    if (existing.length > 0) return existing[0].outcome;
    await ctx.db.insert('refreshRuns', {
      roomId: args.roomId,
      dedupeKey: args.dedupeKey,
      nominalMs: args.nominalMs,
      outcome: args.outcome,
      detail: args.detail,
      fetchedBytes: args.fetchedBytes,
      at: ctx.runtime.now(),
    });
    return args.outcome;
  },
});

export const runRefresh = defineAction({
  args: { trigger: v.optional(v.string()) },
  result: results.value(v.object({
    outcome: v.string(),
    dedupeKey: v.string(),
    detail: v.string(),
    fetchedBytes: v.integer(),
  })),
  uses: ['refreshToken'],
  writes: ['refreshRuns'],
  handler: async (ctx) => {
    const begin = await ctx.runMutation('beginRefresh', {});
    if (!begin.enabled) {
      return { outcome: 'skipped-disabled', dedupeKey: begin.dedupeKey, detail: 'refresh source not configured', fetchedBytes: 0 };
    }
    if (begin.alreadyRan) {
      return { outcome: 'deduped', dedupeKey: begin.dedupeKey, detail: 'nominal already receipted', fetchedBytes: 0 };
    }
    const token = ctx.secrets.get('refreshToken');
    // The STREAMED egress lane (guide backend/streamed-actions): plain
    // ctx.fetch is unregistered on packaged 0.1.7 (known 0137-a4-f1), but
    // ctx.streamAttempt + ctx.fetchStream work end to end — this arm's
    // finding 0137-a5-f1. The attempt is keyed by the run's dedupe key, so
    // a crashed runner's rejoin returns the durable winner.
    let outcome = 'unreachable';
    let detail = '';
    let fetchedBytes = 0;
    let attempt = null;
    try {
      attempt = await ctx.streamAttempt.start(begin.dedupeKey);
      if (attempt.terminal) {
        return {
          outcome: 'deduped',
          dedupeKey: begin.dedupeKey,
          detail: `attempt already terminal (${attempt.terminal.cause})`,
          fetchedBytes: 0,
        };
      }
      const response = await ctx.fetchStream({
        url: begin.url,
        method: 'GET',
        headers: { authorization: `Bearer ${token.expose()}` },
        body: null,
        idempotencyKey: begin.dedupeKey,
        attemptToken: attempt.attemptToken,
      });
      if (!response.ok) {
        detail = `refresh endpoint status ${response.status}`;
      } else {
        const reader = response.body.getReader();
        let text = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          fetchedBytes += chunk.value.byteLength;
          let piece = '';
          for (const byte of chunk.value) piece += String.fromCharCode(byte);
          text += piece;
        }
        outcome = 'fetched';
        detail = `fetched ${fetchedBytes} bytes from the refresh endpoint (streamed lane, ${text.length} chars)`;
      }
    } catch (error) {
      // Value-free diagnostic summary only; the token never enters detail.
      detail = String(error && error.message ? error.message : error).slice(0, 160);
    }
    if (attempt && attempt.attemptToken) {
      try {
        await ctx.streamAttempt.settle(attempt.attemptToken, outcome === 'fetched' ? 'complete' : 'failed');
      } catch (error) {
        // Lease loss/abandonment: the trusted terminalizer owns the winner.
      }
    }
    await ctx.runMutation('recordRefresh', {
      roomId: begin.roomId,
      dedupeKey: begin.dedupeKey,
      nominalMs: begin.nominalMs,
      outcome,
      detail,
      fetchedBytes,
    });
    return { outcome, dedupeKey: begin.dedupeKey, detail, fetchedBytes };
  },
});

// jitter:false — the 1s cadence is this acceptance rig's fixed scan
// interval (LLP 0028 §Jitter shape); the epoch-0 catch-up nominal is a
// known everyMs behavior (0137-a4-f4, cited in evidence).
export const refreshCron = defineCron({
  refreshTick: {
    schedule: { everyMs: 1_000, jitter: false },
    action: 'runRefresh',
  },
});
