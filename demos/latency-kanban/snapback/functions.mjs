// Latency Kanban authors every write exactly once as generated HostPlan IR.
// There is intentionally no application optimistic reducer.
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
// these plans replay with the shipping D5 Insert/Get/Guard/Patch semantics.
// @ref LLP 0155#execution-contract — operation and activation identity ride
// the generated reference used by both local prediction and settlement.

import {
  add,
  arg,
  asc,
  bindingRef,
  defineLiveQuery,
  defineMutation,
  eqv,
  field,
  get,
  guard,
  insert,
  lit,
  patch,
  returnDocument,
  v,
} from '@expo/snapback-codegen/define';

export const boardList = defineLiveQuery({
  table: 'boards',
  args: {},
  order: [asc('name')],
  auth: 'public',
  authorityIndependent: true,
});

// No filter or limit: M2 can truthfully use this as table-complete point-read
// coverage. Board selection is presentation only, never an inferred prefix.
export const boardCards = defineLiveQuery({
  table: 'cards',
  args: {},
  order: [asc('rank')],
  auth: 'public',
  authorityIndependent: true,
});

export const createBoard = defineMutation({
  args: { name: v.string() },
  plan: insert('boards', { name: arg('name') }, { bindIdAs: 'boardId' }),
  returns: returnDocument('boards', bindingRef('boardId')),
});

export const createCard = defineMutation({
  args: {
    boardId: v.id('boards'), title: v.string(), column: v.string(), rank: v.integer(),
    assignee: v.string(), locked: v.boolean(),
  },
  plan: insert('cards', {
    boardId: arg('boardId'), title: arg('title'), column: arg('column'), rank: arg('rank'),
    assignee: arg('assignee'), archived: lit(false), locked: arg('locked'), revision: lit(0),
  }, { bindIdAs: 'cardId' }),
  returns: returnDocument('cards', bindingRef('cardId')),
});

const guardedPatch = (values) => [
  get('cards', arg('cardId'), 'card', { elseError: 'KANBAN_CARD_NOT_FOUND' }),
  guard(eqv(field(bindingRef('card'), 'locked'), lit(false)), 'KANBAN_CARD_LOCKED'),
  patch('cards', arg('cardId'), {
    ...values,
    revision: add(field(bindingRef('card'), 'revision'), lit(1)),
  }),
];

const guardedPatchRefusals = [
  'KANBAN_CARD_NOT_FOUND',
  'KANBAN_CARD_LOCKED',
];

export const editCard = defineMutation({
  args: { cardId: v.id('cards'), title: v.string() },
  refusals: guardedPatchRefusals,
  plan: guardedPatch({ title: arg('title') }),
  returns: returnDocument('cards', arg('cardId')),
});

export const assignCard = defineMutation({
  args: { cardId: v.id('cards'), assignee: v.string() },
  refusals: guardedPatchRefusals,
  plan: guardedPatch({ assignee: arg('assignee') }),
  returns: returnDocument('cards', arg('cardId')),
});

export const archiveCard = defineMutation({
  args: { cardId: v.id('cards') },
  refusals: guardedPatchRefusals,
  plan: guardedPatch({ archived: lit(true) }),
  returns: returnDocument('cards', arg('cardId')),
});

export const reorderCard = defineMutation({
  args: { cardId: v.id('cards'), column: v.string(), rank: v.integer() },
  refusals: guardedPatchRefusals,
  plan: guardedPatch({ column: arg('column'), rank: arg('rank') }),
  returns: returnDocument('cards', arg('cardId')),
});
