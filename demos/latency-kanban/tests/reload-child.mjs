// Process-boundary leg for the Move-3 loss-free reload receipt. The parent
// intentionally SIGKILLs `queue`; `inspect` is a fresh process that only opens
// retained base + outbox and observes boot replay (no network call).

import { readFile } from 'node:fs/promises';
import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import { createFileRqsResumeStore } from '../../../packages/snapback-client/rqs-store-file.mjs';
import api from '../snapback/generated/api.mjs';

const mode = process.argv[2];
const [directory, basePath] = process.argv.slice(3);
const base = JSON.parse(await readFile(basePath, 'utf8'));
const store = createFileRqsResumeStore({
  directory,
  clientStoreId: 'latency-kanban-kill-reload',
});
await store.whenLockSettled();
const client = new SnapbackClient('http://127.0.0.1:1', {
  rqsStore: store,
  offlineQueue: true,
});
const view = await client.createOptimisticMutationView({ authoritativeRows: base });

if (mode === 'queue') {
  const boardId = base.boards[0]._id;
  const queued = await client.mutate(api.createCard, {
    args: {
      boardId,
      title: 'Retained after SIGKILL',
      column: 'ready',
      rank: 9_999,
      assignee: 'Grace',
      locked: false,
    },
  });
  process.send?.({
    kind: 'queued',
    outcome: queued,
    layers: view.getSnapshot().layers.length,
    titles: view.getSnapshot().visibleRows.cards.map((card) => card.title),
  });
  setInterval(() => {}, 60_000);
} else if (mode === 'inspect') {
  process.send?.({
    kind: 'inspected',
    layers: view.getSnapshot().layers.length,
    layerIds: view.getSnapshot().layers.map((layer) => layer.clientMutationId),
    titles: view.getSnapshot().visibleRows.cards.map((card) => card.title),
  });
  view.close();
  await store.close();
} else {
  throw new Error(`unknown reload-child mode ${mode}`);
}
