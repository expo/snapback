# Neutral build prompt: Linear-shaped issue tracker

Build the frozen issue-tracker shell with the assigned backend's idiomatic
schema, query, mutation, realtime, auth, search, offline, migration, and
deployment facilities. Do not introduce a shared provider abstraction.

Model organizations, teams, projects, members, issues, labels, comments, and
activity. Use Alice as organization owner, Bob as team member, and Mallory as
outsider. Seed the exact dataset in `workloads.v1.json`, including 500 issues,
then implement:

- indexed filters, stable 50-row pagination, and deterministic ordering;
- composed issue detail with project, assignee, labels, comments, and activity;
- authoritative updates to status, priority, assignee, and board position;
- a documented concurrent board-move/edit outcome;
- live comments and activity;
- provider-native full-text search or an explicit GAP;
- retained offline views and queued edits where supported; and
- an indexed-field schema evolution without losing the production-shaped seed.

Run every scenario in `acceptance/linear.v1.json`. Preserve raw commands,
timings, authoritative checks, transport and settlement attribution, migration
artifacts, target identity, and cleanup proof. A client-side filter or search
does not prove the backend capability. Stop on an LLP 0102 Stop-class defect.

The timed diagnostic budget is 480 active minutes and 400 tool calls, followed
only by a separately labeled untimed extension.
