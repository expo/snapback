import {
  defineJsMutation,
  defineLiveQuery,
  v,
} from '@expo/snapback-codegen/define';

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
