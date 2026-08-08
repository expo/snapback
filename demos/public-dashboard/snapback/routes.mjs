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
  // @ref LLP 0092#dated-amendment-structured-route-group-arguments-2026-08-08 —
  // object-reachable route bindings and literal context are lowered together.
  {
    route: '/context-dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetricsByContext',
        args: {
          context: {
            dashboardId: routeParam('dashboardId'),
            cursor: null,
            sort: 'asc',
            tags: ['current', 'critical'],
          },
        },
      },
    ],
  },
]);
