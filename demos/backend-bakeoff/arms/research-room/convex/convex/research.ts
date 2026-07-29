import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const PRIMARY_ROOM = "room-primary";
const SECONDARY_ROOM = "room-secondary";
const PROGRESS_LABELS = ["retrieving", "ranking", "synthesizing", "citing"];

function embeddingFor(index: number): number[] {
  const values = Array.from({ length: 32 }, (_, dimension) =>
    dimension === index % 20 ? 1 : ((index + dimension) % 17) / 1000,
  );
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

async function identitySubject(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("UNAUTHENTICATED");
  return identity.subject;
}

async function requireMember(ctx: any, roomId: any): Promise<{ subject: string; role: string }> {
  const subject = await identitySubject(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_room_subject", (q: any) => q.eq("roomId", roomId).eq("subject", subject))
    .unique();
  if (!membership) throw new Error("FORBIDDEN");
  return { subject, role: membership.role };
}

async function deleteAll(ctx: any, table: any) {
  for (const row of await ctx.db.query(table).collect()) {
    if (table === "sources" && row.storageId) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }
}

export const resetAndSeed = mutation({
  args: {},
  handler: async (ctx) => {
    await identitySubject(ctx);
    for (const table of [
      "lateAttempts",
      "progress",
      "answers",
      "attempts",
      "questions",
      "refreshRuns",
      "signals",
      "sources",
      "memberships",
      "rooms",
    ]) {
      await deleteAll(ctx, table);
    }

    const primary = await ctx.db.insert("rooms", {
      slug: PRIMARY_ROOM,
      title: "Primary Research Room",
    });
    const secondary = await ctx.db.insert("rooms", {
      slug: SECONDARY_ROOM,
      title: "Secondary Research Room",
    });
    await ctx.db.insert("memberships", { roomId: primary, subject: "alice", role: "owner" });
    await ctx.db.insert("memberships", { roomId: primary, subject: "bob", role: "member" });
    await ctx.db.insert("memberships", { roomId: secondary, subject: "alice", role: "owner" });

    const sourceIds = [];
    for (let index = 0; index < 20; index += 1) {
      const hasKeyword = index % 3 === 0;
      sourceIds.push(
        await ctx.db.insert("sources", {
          roomId: primary,
          sourceKey: `source-${String(index).padStart(2, "0")}`,
          title: `Research source ${String(index).padStart(2, "0")}`,
          searchText: hasKeyword
            ? `quartz frozen research record ${index}`
            : `ordinary frozen research record ${index}`,
          ownerSubject: "alice",
          contentHash: `seed-hash-${String(index).padStart(2, "0")}`,
          byteLength: 65536,
          embedding: embeddingFor(index),
        }),
      );
    }
    return {
      primaryRoomId: primary,
      secondaryRoomId: secondary,
      sourceIds,
      expectedKeywordSourceKeys: Array.from({ length: 20 }, (_, index) => index)
        .filter((index) => index % 3 === 0)
        .map((index) => `source-${String(index).padStart(2, "0")}`),
    };
  },
});

export const authoritativeCounts = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireMember(ctx, roomId);
    const room = await ctx.db.get(roomId);
    const rooms = await ctx.db.query("rooms").collect();
    const sources = await ctx.db.query("sources").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const answers = await ctx.db
      .query("answers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return {
      roomSlug: room?.slug,
      roomCount: rooms.length,
      sourceCount: sources.length,
      memberSubjects: memberships.map((member) => member.subject).sort(),
      questionCount: questions.length,
      answerCount: answers.length,
    };
  },
});

export const keywordSearch = query({
  args: { roomId: v.id("rooms"), term: v.string() },
  handler: async (ctx, { roomId, term }) => {
    await requireMember(ctx, roomId);
    const rows = await ctx.db
      .query("sources")
      .withSearchIndex("search_text", (q) => q.search("searchText", term).eq("roomId", roomId))
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      sourceKey: row.sourceKey,
      title: row.title,
      contentHash: row.contentHash,
    }));
  },
});

export const assertRoomAccess = internalQuery({
  args: { roomId: v.id("rooms"), subject: v.string() },
  handler: async (ctx, { roomId, subject }) => {
    return Boolean(
      await ctx.db
        .query("memberships")
        .withIndex("by_room_subject", (q) => q.eq("roomId", roomId).eq("subject", subject))
        .unique(),
    );
  },
});

export const sourcesByIds = internalQuery({
  args: { roomId: v.id("rooms"), ids: v.array(v.id("sources")) },
  handler: async (ctx, { roomId, ids }) => {
    const result = [];
    for (const id of ids) {
      const source = await ctx.db.get(id);
      if (source && source.roomId === roomId) {
        result.push({ id: source._id, sourceKey: source.sourceKey, title: source.title });
      }
    }
    return result;
  },
});

export const semanticSearch = action({
  args: { roomId: v.id("rooms"), embedding: v.array(v.float64()), limit: v.number() },
  handler: async (ctx, { roomId, embedding, limit }): Promise<any> => {
    const subject = await identitySubject(ctx);
    const allowed = await ctx.runQuery(internal.research.assertRoomAccess, { roomId, subject });
    if (!allowed) throw new Error("FORBIDDEN");
    const matches = await ctx.vectorSearch("sources", "by_embedding", {
      vector: embedding,
      limit,
      filter: (q) => q.eq("roomId", roomId),
    });
    const sources: any[] = await ctx.runQuery(internal.research.sourcesByIds, {
      roomId,
      ids: matches.map((match) => match._id),
    });
    return sources.map((source: any, index: number) => ({ ...source, score: matches[index]?._score }));
  },
});

export const generateUploadUrl = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireMember(ctx, roomId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachUpload = mutation({
  args: {
    roomId: v.id("rooms"),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    const id = await ctx.db.insert("sources", {
      roomId: args.roomId,
      sourceKey: "uploaded-fixture",
      title: "Uploaded deterministic fixture",
      searchText: "uploaded deterministic fixture",
      ownerSubject: member.subject,
      contentHash: args.contentHash,
      byteLength: args.byteLength,
      embedding: embeddingFor(31),
      storageId: args.storageId,
    });
    return id;
  },
});

export const sourceFile = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return null;
    await requireMember(ctx, source.roomId);
    return {
      sourceId: source._id,
      ownerSubject: source.ownerSubject,
      contentHash: source.contentHash,
      byteLength: source.byteLength,
      url: source.storageId ? await ctx.storage.getUrl(source.storageId) : null,
    };
  },
});

export const deleteUploadedSource = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return { deleted: false };
    const member = await requireMember(ctx, source.roomId);
    if (source.ownerSubject !== member.subject) throw new Error("FORBIDDEN");
    if (source.storageId) await ctx.storage.delete(source.storageId);
    await ctx.db.delete(sourceId);
    return { deleted: true };
  },
});

export const ask = mutation({
  args: {
    roomId: v.id("rooms"),
    dedupeKey: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    const prior = await ctx.db
      .query("attempts")
      .withIndex("by_room_dedupe", (q) => q.eq("roomId", args.roomId).eq("dedupeKey", args.dedupeKey))
      .first();
    if (prior) {
      await ctx.db.insert("attempts", {
        roomId: args.roomId,
        questionId: prior.questionId,
        dedupeKey: args.dedupeKey,
        attempt: prior.attempt + 1,
        disposition: "deduped",
        createdAt: Date.now(),
      });
      return { questionId: prior.questionId, deduped: true };
    }
    const questionId = await ctx.db.insert("questions", {
      roomId: args.roomId,
      askerSubject: member.subject,
      dedupeKey: args.dedupeKey,
      text: args.text,
      state: "running",
      createdAt: Date.now(),
    });
    await ctx.db.insert("attempts", {
      roomId: args.roomId,
      questionId,
      dedupeKey: args.dedupeKey,
      attempt: 1,
      disposition: "started",
      createdAt: Date.now(),
    });
    for (let step = 1; step <= 4; step += 1) {
      await ctx.scheduler.runAfter(step * 75, internal.research.streamStep, { questionId, step });
    }
    return { questionId, deduped: false };
  },
});

export const streamStep = internalMutation({
  args: { questionId: v.id("questions"), step: v.number() },
  handler: async (ctx, { questionId, step }) => {
    const question = await ctx.db.get(questionId);
    if (!question || question.state !== "running") return { applied: false };
    const existing = await ctx.db
      .query("progress")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .filter((q) => q.eq(q.field("step"), step))
      .first();
    if (existing) return { applied: false };
    await ctx.db.insert("progress", {
      roomId: question.roomId,
      questionId,
      step,
      label: PROGRESS_LABELS[step - 1] ?? `step-${step}`,
      createdAt: Date.now(),
    });
    if (step === 4) {
      const sources = await ctx.db
        .query("sources")
        .withIndex("by_room", (q) => q.eq("roomId", question.roomId))
        .take(2);
      await ctx.db.insert("answers", {
        roomId: question.roomId,
        questionId,
        text: "The deterministic answer cites two authorized research records.",
        citationSourceIds: sources.map((source) => source._id),
        createdAt: Date.now(),
      });
      await ctx.db.patch(questionId, { state: "complete", terminalAt: Date.now() });
    }
    return { applied: true };
  },
});

export const questionView = query({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) return null;
    await requireMember(ctx, question.roomId);
    const progress = await ctx.db
      .query("progress")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .collect();
    const answer = await ctx.db
      .query("answers")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .unique();
    const attempts = await ctx.db
      .query("attempts")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .collect();
    const lateAttempts = await ctx.db
      .query("lateAttempts")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .collect();
    return {
      question: {
        id: question._id,
        state: question.state,
        dedupeKey: question.dedupeKey,
      },
      progress: progress.sort((a, b) => a.step - b.step).map((entry) => ({
        step: entry.step,
        label: entry.label,
      })),
      answer: answer
        ? {
            id: answer._id,
            text: answer.text,
            citationSourceIds: answer.citationSourceIds,
          }
        : null,
      attempts: attempts.map((attempt) => ({
        attempt: attempt.attempt,
        disposition: attempt.disposition,
      })),
      lateAttempts: lateAttempts.map((attempt) => ({
        rejected: attempt.rejected,
        observedState: attempt.observedState,
      })),
    };
  },
});

export const cancel = mutation({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new Error("NOT_FOUND");
    await requireMember(ctx, question.roomId);
    if (question.state !== "running") return { settled: false, state: question.state };
    await ctx.db.patch(questionId, { state: "cancelled", terminalAt: Date.now() });
    return { settled: true, state: "cancelled" };
  },
});

export const injectLatePatch = mutation({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new Error("NOT_FOUND");
    await requireMember(ctx, question.roomId);
    const rejected = question.state !== "running";
    await ctx.db.insert("lateAttempts", {
      roomId: question.roomId,
      questionId,
      rejected,
      observedState: question.state,
      createdAt: Date.now(),
    });
    if (!rejected) {
      await ctx.db.insert("progress", {
        roomId: question.roomId,
        questionId,
        step: 99,
        label: "late-injected",
        createdAt: Date.now(),
      });
    }
    return { rejected, observedState: question.state };
  },
});

export const createOutcomeFixtures = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    const states = ["failed", "cancelled", "timed_out", "ambiguous"];
    const ids = [];
    for (const state of states) {
      ids.push(
        await ctx.db.insert("questions", {
          roomId,
          askerSubject: member.subject,
          dedupeKey: `outcome-${state}`,
          text: `Fixture for ${state}`,
          state,
          createdAt: Date.now(),
          terminalAt: Date.now(),
        }),
      );
    }
    return ids;
  },
});

export const outcomeStates = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireMember(ctx, roomId);
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return Array.from(new Set(rows.map((row) => row.state))).sort();
  },
});

export const scheduleRefresh = mutation({
  args: { roomId: v.id("rooms"), dedupeKey: v.string(), externalUrl: v.string() },
  handler: async (ctx, args): Promise<any> => {
    await requireMember(ctx, args.roomId);
    const scheduledId: any = await ctx.scheduler.runAfter(75, internal.research.refreshAction, args);
    return { scheduledId };
  },
});

export const refreshAction = internalAction({
  args: { roomId: v.id("rooms"), dedupeKey: v.string(), externalUrl: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const response = await fetch(args.externalUrl);
    if (!response.ok) throw new Error(`EXTERNAL_FETCH_${response.status}`);
    const payload = await response.json();
    return await ctx.runMutation(internal.research.recordRefresh, {
      roomId: args.roomId,
      dedupeKey: args.dedupeKey,
      externalRecordId: String(payload.recordId),
      payloadHash: String(payload.payloadHash),
    });
  },
});

export const recordRefresh = internalMutation({
  args: {
    roomId: v.id("rooms"),
    dedupeKey: v.string(),
    externalRecordId: v.string(),
    payloadHash: v.string(),
  },
  handler: async (ctx, args) => {
    const prior = await ctx.db
      .query("refreshRuns")
      .withIndex("by_room_dedupe", (q) => q.eq("roomId", args.roomId).eq("dedupeKey", args.dedupeKey))
      .unique();
    if (prior) return { runId: prior._id, deduped: true };
    const runId = await ctx.db.insert("refreshRuns", {
      roomId: args.roomId,
      dedupeKey: args.dedupeKey,
      status: "complete",
      externalRecordId: args.externalRecordId,
      payloadHash: args.payloadHash,
      progress: "fetched-and-recorded",
      createdAt: Date.now(),
    });
    return { runId, deduped: false };
  },
});

export const refreshRuns = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireMember(ctx, roomId);
    return await ctx.db
      .query("refreshRuns")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
  },
});

export const secretProbe = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const subject = await identitySubject(ctx);
    const allowed = await ctx.runQuery(internal.research.assertRoomAccess, { roomId, subject });
    if (!allowed) throw new Error("FORBIDDEN");
    const canary = (globalThis as any).process?.env?.RESEARCH_CANARY;
    return { configured: typeof canary === "string" && canary.length >= 24 };
  },
});

export const writeSignal = mutation({
  args: { roomId: v.id("rooms"), seq: v.number() },
  handler: async (ctx, { roomId, seq }) => {
    const member = await requireMember(ctx, roomId);
    const id = await ctx.db.insert("signals", {
      roomId,
      seq,
      actorSubject: member.subject,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const latestSignal = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireMember(ctx, roomId);
    return await ctx.db
      .query("signals")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .first();
  },
});

export const cleanup = mutation({
  args: {},
  handler: async (ctx) => {
    await identitySubject(ctx);
    const before: Record<string, number> = {};
    const tables = [
      "lateAttempts",
      "progress",
      "answers",
      "attempts",
      "questions",
      "refreshRuns",
      "signals",
      "sources",
      "memberships",
      "rooms",
    ] as const;
    for (const table of tables) {
      before[table] = (await ctx.db.query(table).collect()).length;
      await deleteAll(ctx, table);
    }
    return { before, deletedTables: tables };
  },
});

export const cleanupProbe = query({
  args: {},
  handler: async (ctx) => {
    await identitySubject(ctx);
    const counts: Record<string, number> = {};
    for (const table of [
      "lateAttempts",
      "progress",
      "answers",
      "attempts",
      "questions",
      "refreshRuns",
      "signals",
      "sources",
      "memberships",
      "rooms",
    ] as const) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return counts;
  },
});
