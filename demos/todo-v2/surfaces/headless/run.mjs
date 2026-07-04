// Todo v2 — headless surface walkthrough (no UI framework).
//
// @ref LLP 0015#headless — the headless surface proves the backend contract:
//   schema load, generated function references, query, mutation, live
//   subscription, reset/seed, and diagnostics — the fastest acceptance fixture
//   and the way to keep Snapback runnable without Exact installed.
//
// Run: node demos/todo-v2/surfaces/headless/run.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));

const server = await startServer({ port: 4402, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo-v2', artifactsPath: join(repoRoot, 'demos', 'todo-v2', 'snapback', 'generated', 'artifacts.json') } });
const db = new SnapbackClient(server.baseUrl);
const ADA = 'user_ada';
const print = (rows) => rows.map((r) => `   [${r.completed ? 'x' : ' '}] ${r.priority.padEnd(6)} ${r.title}`).join('\n');

try {
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  const live = await db.liveQuery('listTodos', { connectionId: 'cli', userId: ADA });
  console.log(`Ada's todos (live snapshot, v${live.version}):\n${print(live.rows)}`);

  console.log('\n> createTodo "Ship Todo v2" high');
  await db.mutate('createTodo', { args: { title: 'Ship Todo v2', priority: 'high' }, userId: ADA });
  console.log(`Live query after mutation:\n${print(await live.poll())}`);

  const id = live.rows.find((r) => r.title === 'Ship Todo v2')._id;
  console.log('\n> setPriority normal, then setCompleted true');
  await db.mutate('setPriority', { args: { id, priority: 'normal' }, userId: ADA });
  await db.mutate('setCompleted', { args: { id, completed: true }, userId: ADA });
  console.log(`Final:\n${print(await live.poll())}`);
} finally {
  await server.stop();
}
