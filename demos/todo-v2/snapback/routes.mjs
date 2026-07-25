// Todo v2 — route→query manifest (LLP 0090 D1.4 / LLP 0092 §0C.1).
//
// The Channel C authenticated-boot declaration (LLP 0090 D4 rollout step 7):
// `/` names what the todo list needs before app JS runs, so the web surface
// can boot as shell + ONE register-mode `POST /app/bundle` — the bundle is
// the LLP 0053-mandated fresh snapshot, the live registrations are created
// at the same commit cut, and no duplicate snapshot-with-subscribe follows.
// `/priority/:priority` is the deep-link case: a cold start into a
// parameterized route fetches BOTH queries in one request (params-v1 binds
// the priority segment), replacing two per-query subscribe round trips.
//
// Both queries are auth-scoped (userId = authUserId()), so bundle entries
// carry `resume: null` in both modes and anonymous read-mode requests refuse
// SNAPBACK_BUNDLE_NOT_PUBLIC — unlike graffiti's publicInline wall, nothing
// here may reach a tokenless response. Selection only: this file can never
// widen disclosure.

import { defineRoutes, routeParam } from '../../_kit/define.mjs';

export default defineRoutes([
  {
    route: '/',
    queries: [{ function: 'listTodos', args: {} }],
  },
  {
    route: '/priority/:priority',
    queries: [
      { function: 'listTodos', args: {} },
      { function: 'listTodosByPriority', args: { priority: routeParam('priority') } },
    ],
  },
]);
