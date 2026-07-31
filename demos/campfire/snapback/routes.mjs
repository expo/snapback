// One room screen is one generated live-query group. Register-mode bundle
// priming evaluates both feeds at one durable commit and creates their
// subscriptions at that cut; the React arm adopts the generated group instead
// of hand-rolling prime/subscribe sequencing. Both `$param` mappings target
// declarative children whose plans give the server a schema-derived string
// type for the param (`v.id` args on `Id`-typed filter fields), so codegen
// marks the entry `registerGroupEligible` and the served admission accepts
// it.
//
// @ref LLP 0112#generated-reference — only all-LiveQuery routes whose
// `$param` mappings target string args generate a register-adoption group.
// @ref LLP 0090#d12-snapshot-bundle-fetch — one route bundle is the
// single-commit snapshot-with-registration primitive.

import { defineRoutes } from '../../_kit/define.mjs';

export default defineRoutes([
  {
    route: '/rooms/:roomId',
    queries: [
      { function: 'liveMessages', args: { roomId: { $param: 'roomId' } } },
      { function: 'liveReactions', args: { roomId: { $param: 'roomId' } } },
    ],
  },
]);
