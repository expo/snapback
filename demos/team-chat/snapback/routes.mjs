// Team Chat's generated React group carries the local dev persona into the
// prepared provider. Dynamic room queries then reuse that provider custody;
// the callable history pages stay outside the live group.
//
// @ref LLP 0114#bundle-primed-generated-query-groups — the provider consumes
// a declared route group instead of app-authored identity/subscription glue.

import { defineRoutes } from '../../_kit/define.mjs';

export default defineRoutes([
  {
    route: '/',
    queries: [
      { function: 'unreadDeliveries', args: {} },
    ],
  },
]);
