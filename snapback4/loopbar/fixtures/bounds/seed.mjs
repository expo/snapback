import { generateSeed, HUB } from '../../bounds-seed.mjs';
export async function seedReference(call, size = HUB) {
  const data = generateSeed(size), times = new Map(data.posts.map((p) => [p.key,p.at]));
  const counts = {};
  for (const table of ['members', 'messages', 'follows', 'posts', 'likes']) {
    const rows = data[table].map((r) => table === 'likes' ? {...r, postAt:times.get(r.postKey)} : r);
    for (let i=0; i<rows.length; i+=100) {
      const batch=rows.slice(i,i+100), args=Object.fromEntries(Object.keys(batch[0]).map((k) => [`${k}s`,batch.map((r) => r[k])]));
      await call('m', `seed_${table}`, args, 'seed');
    }
    counts[table] = rows.length;
  }
  return counts;
}
export const ONE = {kind:'one-cursor', operations:['grouped'], cursorArgs:['c']};
export const TWO = {kind:'two-cursor', operations:['chats','batches'], cursorArgs:['batch','c']};
