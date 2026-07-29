// LLP 0102 Research Room callable surface.

import {
  defineAction,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  v,
} from '../../../../../../_kit/define.mjs';

const roomShape = v.object({
  slug: v.string(),
  name: v.string(),
  createdBy: v.string(),
  createdAt: v.integer(),
});

const sourceShape = v.object({
  roomId: v.string(),
  slug: v.string(),
  title: v.string(),
  ownerId: v.string(),
  mediaType: v.string(),
  byteSize: v.integer(),
  sha256: v.string(),
  keywordText: v.string(),
  embeddingJson: v.string(),
  refreshedAt: v.integer(),
});

const questionShape = v.object({
  roomId: v.string(),
  askedBy: v.string(),
  prompt: v.string(),
  idempotencyKey: v.string(),
  attemptId: v.string(),
  createdAt: v.integer(),
});

const answerShape = v.object({
  roomId: v.string(),
  questionId: v.string(),
  attemptId: v.string(),
  content: v.string(),
  status: v.string(),
  sequence: v.integer(),
  citationsJson: v.string(),
  effectMayHaveExecuted: v.optional(v.boolean()),
  updatedAt: v.integer(),
});

const progressShape = v.object({
  roomId: v.string(),
  answerId: v.string(),
  sequence: v.integer(),
  delta: v.string(),
  recordedAt: v.integer(),
});

export const appConfig = defineConfig({
  researchProviderToken: {
    description: 'Deterministic research-provider bearer used by server-side actions',
    purpose: 'Authenticates streamed answer generation and scheduled source refresh',
    required: true,
    pool: false,
    howToGet: 'Acceptance supplies an arm-scoped deterministic canary through the admin config API.',
  },
});

export const listRooms = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  source: 'handlers.mjs',
  exportName: 'listRooms',
  reads: ['rooms', 'roomViews'],
  result: roomShape,
});

export const listSources = defineJsQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'listSources',
  reads: ['rooms', 'roomMembers', 'sources'],
  result: sourceShape,
});

export const keywordSearch = defineJsQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms'), keyword: v.string() },
  source: 'handlers.mjs',
  exportName: 'keywordSearch',
  reads: ['rooms', 'roomMembers', 'sources'],
  result: sourceShape,
});

export const listQuestions = defineJsQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'listQuestions',
  reads: ['rooms', 'roomMembers', 'questions'],
  result: questionShape,
});

export const listAnswers = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'listAnswers',
  reads: ['rooms', 'roomMembers', 'answers'],
  result: answerShape,
});

export const listProgress = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'listProgress',
  reads: ['rooms', 'roomMembers', 'progressEvents'],
  result: progressShape,
});

export const bootstrapResearchRooms = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { bobId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'bootstrapResearchRooms',
  reads: ['rooms', 'roomViews', 'sources'],
  writes: ['rooms', 'roomMembers', 'roomViews', 'sources'],
});

export const startQuestion = defineJsMutation({
  auth: 'authenticated',
  args: {
    roomId: v.id('rooms'),
    prompt: v.string(),
    idempotencyKey: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'startQuestion',
  reads: ['rooms', 'roomMembers', 'questions', 'answers'],
  writes: ['questions', 'answers'],
});

export const applyAnswerProgress = defineJsMutation({
  auth: 'authenticated',
  args: {
    attemptId: v.string(),
    sequence: v.integer(),
    delta: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'applyAnswerProgress',
  reads: ['answers', 'roomMembers', 'progressEvents'],
  writes: ['answers', 'progressEvents'],
});

export const completeAnswer = defineJsMutation({
  auth: 'authenticated',
  args: {
    attemptId: v.string(),
    sequence: v.integer(),
    tail: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'completeAnswer',
  reads: ['answers', 'roomMembers', 'sources'],
  writes: ['answers'],
});

export const settleAnswer = defineJsMutation({
  auth: 'authenticated',
  args: {
    attemptId: v.string(),
    status: v.string(),
    effectMayHaveExecuted: v.optional(v.boolean()),
  },
  source: 'handlers.mjs',
  exportName: 'settleAnswer',
  reads: ['answers', 'roomMembers'],
  writes: ['answers'],
});

export const cancelAnswer = defineJsMutation({
  auth: 'authenticated',
  args: { attemptId: v.string() },
  source: 'handlers.mjs',
  exportName: 'cancelAnswer',
  reads: ['answers', 'roomMembers'],
  writes: ['answers'],
});

export const streamAnswer = defineAction({
  auth: 'authenticated',
  args: {
    attemptId: v.string(),
    streamUrl: v.string(),
    method: v.string(),
  },
  js: { source: 'actions.mjs', exportName: 'streamAnswer' },
  uses: ['researchProviderToken'],
  writes: ['answers', 'progressEvents'],
});

export const applyScheduledRefresh = defineJsMutation({
  args: {
    slotKey: v.string(),
    sourceSlug: v.string(),
    fetchedRevision: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'applyScheduledRefresh',
  reads: ['sources', 'refreshRuns'],
  writes: ['sources', 'refreshRuns'],
});

export const refreshScheduledSource = defineAction({
  args: {},
  js: { source: 'actions.mjs', exportName: 'refreshScheduledSource' },
  uses: ['researchProviderToken'],
  writes: ['sources', 'refreshRuns'],
});

export const researchCron = defineCron({
  deterministicRefresh: {
    schedule: { everyMs: 1_000, jitter: false },
    action: 'refreshScheduledSource',
    overlapPolicy: 'NoOverlap',
  },
});
