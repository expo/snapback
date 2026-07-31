// Signal Desk's workspace is one generated live-query group. Register-mode
// bundle priming evaluates these four feeds at one durable commit and creates
// their subscriptions at that same cut; React adopts the generated group
// rather than rebuilding route identity or prime/subscribe sequencing.
//
// @ref LLP 0090#d12-snapshot-bundle-fetch — one route bundle is the
// single-commit snapshot-with-registration primitive.
// @ref LLP 0114#bundle-primed-generated-query-groups — generated group
// references are the closed React composition surface.

import { defineRoutes } from '@expo/snapback-codegen/define';

export default defineRoutes([
  {
    route: '/',
    queries: [
      { function: 'listIncidents', args: {} },
      { function: 'allTasks', args: {} },
      { function: 'allComments', args: {} },
      { function: 'allActivity', args: {} },
    ],
  },
]);
