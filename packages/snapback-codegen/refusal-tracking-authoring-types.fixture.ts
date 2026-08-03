import {
  defineAction,
  defineJsMutation,
  defineJsQuery,
  defineQuery,
} from './define.js';

defineQuery({
  table: 'todos',
  refusals: ['NOT_FOUND'],
  trackedRefusals: ['NOT_FOUND'],
});

defineJsQuery({
  reads: ['todos'],
  refusals: ['NOT_FOUND'],
  trackedRefusals: ['NOT_FOUND'],
  handler: async () => [],
});

defineJsMutation({
  writes: ['todos'],
  refusals: ['INVITE_CONSUMED', 'STALE_MOVE'],
  trackedRefusals: ['STALE_MOVE'],
  handler: async () => null,
});

defineAction({
  refusals: ['REMOTE_REJECTED'],
  trackedRefusals: ['REMOTE_REJECTED'],
  handler: async () => null,
});
