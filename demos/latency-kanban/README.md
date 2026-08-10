# Latency Kanban

The Move-3 Phase-1 exit app. Every board/card mutation is a generated IR plan;
`SnapbackClient.mutate(api.someMutation)` derives its durable intent, local
evaluation inputs, and settlement claims from that reference. The app contains
no optimistic reducer: its visible rows come from `createOptimisticMutationView`,
whose layers are replayed from the retained outbox.

Run `npm test --prefix demos/latency-kanban` for static/generated checks. Run
`node tests/acceptance/latency-kanban-move3-v1.mjs` for the retained gate and
the same command with `--check` to verify source digests and receipt sections.

Not claiming: an LLP/capability-index status change, execution outside the
declared generated operations, or authoritative client-side mutation choices.
