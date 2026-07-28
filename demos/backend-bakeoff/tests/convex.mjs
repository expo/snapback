import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const env = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8');
const url = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1];
if (!url) throw new Error('VITE_CONVEX_URL missing; run CONVEX_AGENT_MODE=anonymous bunx convex dev');

const client = new ConvexClient(url);
const created = [];
try {
  await client.mutation(api.incidents.seed, {});
  const first = await client.query(api.incidents.list, {});
  if (first.length < 2) throw new Error('Convex seed is incomplete');

  const update = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Convex live update timed out')), 5_000);
    const off = client.onUpdate(api.incidents.allComments, {}, (rows) => {
      if (rows.some((row) => row.body === 'Convex live witness')) {
        clearTimeout(timeout);
        off();
        resolve(rows);
      }
    });
  });
  await client.mutation(api.incidents.addComment, {
    actorId: 'user_ada',
    incidentId: first[0].id,
    body: 'Convex live witness',
    now: Date.now(),
  });
  await update;
  const brief = await client.query(api.incidents.brief, { incidentId: first[0].id });
  if (!brief.includes('tasks complete')) throw new Error('Convex brief missing task summary');
  const search = await client.query(api.incidents.search, { term: 'checkout' });
  if (!search.some((row) => row?.title === 'Checkout API latency')) {
    throw new Error('Convex search did not find checkout incident');
  }
  process.stdout.write('Convex integration: seed, transaction, native live update, search, brief — pass\n');
} finally {
  await client.close();
}
