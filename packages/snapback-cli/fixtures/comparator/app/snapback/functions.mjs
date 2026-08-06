import {
  bind,
  defineJsMutation,
  defineLiveQuery,
  defineSurface,
  input,
  param,
  v,
} from '@expo/snapback-codegen/define';
import { fixturePresence } from './surface-model.mjs';

export const liveRows = defineLiveQuery({ table: 'liveRows', args: {} });
export const primaryRows = defineLiveQuery({ table: 'primaryRows', args: {} });
export const activityRows = defineLiveQuery({ table: 'activityRows', args: {} });
export const rejectionRows = defineLiveQuery({ table: 'rejectionRows', args: {} });

export const publishLiveRow = defineJsMutation({
  args: { body: v.string() },
  source: 'handlers.mjs',
  exportName: 'publishLiveRow',
  writes: ['liveRows'],
});

// @ref LLP 0179#lifecycle-identity-and-composition — this real-runtime E1
// fixture composes the same live store and presence room exercised through
// the low-level projection in expo-dev-loop.test.mjs.
export const fixtureSurface = defineSurface({
  params: { roomId: v.string() },
  reads: { rows: bind(liveRows) },
  mutations: { publish: bind(publishLiveRow, { body: input('body') }) },
  presence: {
    fixture: bind(fixturePresence, {
      scope: { roomId: param('roomId') },
    }),
  },
});

export const writePrimaryAndActivity = defineJsMutation({
  args: { primary: v.string(), activity: v.string() },
  source: 'handlers.mjs',
  exportName: 'writePrimaryAndActivity',
  writes: ['primaryRows', 'activityRows'],
});

export const rejectInvalidWrite = defineJsMutation({
  args: { value: v.string() },
  source: 'handlers.mjs',
  exportName: 'rejectInvalidWrite',
  writes: ['rejectionRows'],
});
