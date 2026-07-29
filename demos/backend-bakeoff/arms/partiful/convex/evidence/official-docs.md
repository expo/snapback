# Convex primary-source notes

Accessed 2026-07-28 during the timed Partiful/Convex arm.

- [Local deployments](https://docs.convex.dev/cli/local-deployments): the
  anonymous local backend is an official beta path and persists project-local
  state under `.convex`.
- [Agent mode](https://docs.convex.dev/cli/agent-mode): non-interactive agents
  can select anonymous local development with
  `CONVEX_AGENT_MODE=anonymous`.
- [Functions](https://docs.convex.dev/functions): queries, mutations, and
  actions are the native server-function surface.
- [Queries](https://docs.convex.dev/functions/query-functions): queries are
  deterministic reads and automatically become reactive when subscribed to by
  a client.
- [Mutations](https://docs.convex.dev/functions/mutation-functions): mutations
  are transactional and use optimistic concurrency control with automatic
  retries.
- [Actions](https://docs.convex.dev/functions/actions): actions can perform
  nondeterministic network effects and call internal queries and mutations.
- [Authentication in functions](https://docs.convex.dev/auth/functions-auth):
  `ctx.auth.getUserIdentity()` is the native authorization boundary used by
  every protected function in this arm.
- [File storage](https://docs.convex.dev/file-storage/upload-files): upload URLs,
  storage IDs, authorized metadata, delivery URLs, and deletion use Convex's
  native storage API.
- [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions):
  `ctx.scheduler.runAfter` returns an inspectable scheduled-function ID.
- [Scheduled-function system table](https://docs.convex.dev/database/advanced/system-tables):
  `_scheduled_functions` exposes completion state for scheduler evidence.
- [Convex client](https://docs.convex.dev/client/javascript): the JavaScript
  clients provide one-shot calls and native WebSocket subscriptions.
- [Deployments](https://docs.convex.dev/production/overview) and
  [`convex deploy`](https://docs.convex.dev/cli/reference/deploy): these define
  the hosted path. It was not exercised because the supplied deployment key was
  empty.

The CLI package source was also inspected after the documented high-level
guidance proved insufficient for collision-safe parallel execution. It exposed
the worktree-critical `--local-cloud-port` and `--local-site-port` options, even
though `convex dev --help` did not list them. The installed client source showed
the development-only local-admin acting identity method that its public
TypeScript declaration omits. Both inspections are recorded as assistance
events rather than silently treated as ordinary documentation.
