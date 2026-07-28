// @ref LLP 0092#0c1-routequery-manifest-artifact — route parameters are
// compiled into the served manifest rather than trusted as ad hoc queries.

import { defineRoutes, routeParam } from '../../_kit/define.mjs';

export default defineRoutes([
  {
    route: '/dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetrics',
        args: { dashboardId: routeParam('dashboardId') },
      },
    ],
  },
]);
