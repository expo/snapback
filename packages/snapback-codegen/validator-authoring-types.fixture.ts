import {
  defineJsQuery,
  defineTable,
  results,
  v,
} from './define.js';

const media = v.media({
  intent: 'attachPhoto',
  policy: 'messagePhoto.v1',
  kinds: ['image'],
});

// Admitted spellings: one value is a literal, unions have 2–8 alternatives,
// top-level media belongs to schema, and ID arrays remain valid arguments.
defineTable({
  state: v.literal('ready'),
  visibility: v.union([v.literal('private'), v.literal('public')]),
  media,
  recipientSnapshots: v.array(v.principal(), { maxItems: 32 }),
});
defineJsQuery({
  args: { ids: v.array(v.id('messages'), { maxItems: 32 }) },
  reads: ['messages'],
  result: results.value(v.literal('ready')),
  handler: async () => 'ready',
});
v.union([
  v.literal('a'), v.literal('b'), v.literal('c'), v.literal('d'),
  v.literal('e'), v.literal('f'), v.literal('g'), v.literal('h'),
]);

// @ts-expect-error one value is v.literal(value), not a one-member union
v.union([v.literal('only')]);
// @ts-expect-error the closed union grammar admits at most eight alternatives
v.union([
  v.literal('a'), v.literal('b'), v.literal('c'), v.literal('d'),
  v.literal('e'), v.literal('f'), v.literal('g'), v.literal('h'),
  v.literal('i'),
]);

defineJsQuery({
  // @ts-expect-error v.media() is a stored top-level schema field, not an argument
  args: { media },
  reads: [],
  handler: async () => null,
});
defineJsQuery({
  args: {},
  reads: [],
  // @ts-expect-error v.media() is not an anonymous result validator
  result: results.value(media),
  handler: async () => null,
});
defineJsQuery({
  // @ts-expect-error schema-only media stays rejected through composite validators
  args: { envelope: v.object({ media }) },
  reads: [],
  handler: async () => null,
});
defineJsQuery({
  // @ts-expect-error v.doc() is result-contract vocabulary, not an argument validator
  args: { document: v.doc('messages') },
  reads: ['messages'],
  handler: async () => null,
});
defineJsQuery({
  // @ts-expect-error tuple arguments are not admitted by the runtime argument grammar
  args: { pair: v.tuple([v.string(), v.string()]) },
  reads: [],
  handler: async () => null,
});

defineTable({
  // @ts-expect-error lifecycle-bearing IDs cannot hide in a structured array
  messageIds: v.array(v.id('messages'), { maxItems: 32 }),
});
defineTable({
  // @ts-expect-error the ID-interior fact propagates through nested objects
  receipt: v.object({ messageIds: v.array(v.id('messages'), { maxItems: 32 }) }),
});
