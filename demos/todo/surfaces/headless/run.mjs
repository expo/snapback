// Todo demo — headless surface walkthrough (no UI framework).
//
// @ref LLP 0015#headless — the headless surface proves the backend contract:
//   schema load, generated function references, query, mutation, live
//   subscription, reset/seed, and diagnostics — the fastest acceptance fixture
//   and the way to keep Snapback runnable without Exact installed.
//
// Run: node demos/todo/surfaces/headless/run.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const gen = (f) => readGeneratedJson(generatedRoot, f);
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const server = await startServer({ port: 4400, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo', artifactsPath: join(repoRoot, 'demos', 'todo', 'snapback', 'generated', 'artifacts.json') } });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const ADA = 'user_ada';
const print = (rows) => rows.map((r) => `   [${r.completed ? 'x' : ' '}] ${r.title}`).join('\n');

try {
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  const live = await db.liveQuery(api.listTodos, { connectionId: 'cli', userId: ADA });
  console.log(`Ada's todos (live snapshot, v${live.version}):\n${print(live.rows)}`);

  console.log('\n> createTodo "Ship the demo"');
  await db.mutate(api.createTodo, { args: { title: 'Ship the demo' }, userId: ADA });
  console.log(`Live query after mutation:\n${print(await live.poll())}`);

  const id = live.rows.find((r) => r.title === 'Ship the demo')._id;
  console.log('\n> setCompleted true');
  await db.mutate(api.setCompleted, { args: { id, completed: true }, userId: ADA });
  console.log(`Final:\n${print(await live.poll())}`);
} finally {
  await server.stop();
}
