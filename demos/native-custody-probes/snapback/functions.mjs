import {
  asc,
  defineLiveQuery,
} from '../../../packages/snapback-codegen/define.mjs';

// A deliberately small authenticated read. Anonymous bootstrap must not
// publish it; restored session custody must make the same query succeed.
export const protectedProbe = defineLiveQuery({
  table: 'probeDocuments',
  args: {},
  auth: 'authenticated',
  order: [asc('_createdAt')],
});
