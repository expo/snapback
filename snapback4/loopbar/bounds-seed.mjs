// Frozen input data, not an application model. Builders map these rows into their own mutations.
export const ANCHOR = 1789668000000, DAY = 86400000;
export const HUB = Object.freeze({ hub: 1000, extra: 90, perChat: 99, hidden: 200, sparse: 100, hits: 5, roster: 50,
  authors: 1000, posts: 50, wide: 500, celebrity: 900 });
export const TINY = Object.freeze({ hub: 24, extra: 1, perChat: 3, hidden: 2, sparse: 26, hits: 2, roster: 5,
  authors: 8, posts: 3, wide: 7, celebrity: 9 });
export const key = (prefix, n) => `${prefix}${String(n).padStart(6, '0')}`;
export function generateSeed(size = HUB) {
  const out = { chats: [], members: [], messages: [], authors: [], follows: [], posts: [], likes: [] };
  function chat(roomId, principal, count, matches, newer = false) {
    out.chats.push({ roomId });
    out.members.push({ roomId, principal, readOrdinal: Math.floor(count / 2) });
    for (let j = 0; j < count; j++) out.messages.push({ key: `${roomId}-${key('m', j)}`, roomId,
      body: matches ? 'coffee' : 'tea', ordinal: j + 1, at: ANCHOR + (newer ? 1000000 : -1000000) + j });
  }
  for (let i = 0; i < size.hub; i++) chat(key('h', i), 'dev:hub', size.perChat + (i < size.extra ? 1 : 0), true);
  for (let i = 0; i < size.hidden; i++) chat(key('x', i), 'dev:outsider', 1, true, true);
  for (let i = 0; i < size.sparse; i++) chat(key('s', i), 'dev:sparse', 1, i < size.hits);
  for (let i = 1; i < size.roster; i++) out.members.push({ roomId: key('h', 0), principal: `dev:roster${i}`, readOrdinal: 0 });
  const follow = (followerId, i) => out.follows.push({ followerId: `dev:${followerId}`, followedId: `dev:${key('a', i)}` });
  for (let i = 1; i <= 5; i++) follow('small', i);
  for (let i = 0; i < size.wide; i++) follow('wide', i);
  for (const i of [0, 2, 3, 4, 5]) follow('celebrity', i);
  for (let i = 0; i < size.celebrity - 2; i++) follow(`fan${i}`, 0);
  for (let i = 0; i < 3; i++) follow(`quietFan${i}`, 1);
  for (let i = 0; i < size.authors; i++) out.authors.push({ principal: `dev:${key('a', i)}` });
  const total = size.authors * size.posts;
  for (let i = 0; i < total; i++) {
    const post = { key: key('p', i), authorId: `dev:${key('a', i % size.authors)}`, body: 'post',
      at: ANCHOR - Math.floor(i * 30 * 3600000 / total) };
    out.posts.push(post);
    const likes = i < 12 ? 12 - i : i === total - 1 ? 20 : 0;
    for (let j = 0; j < likes; j++) out.likes.push({ postKey: post.key, principal: `dev:liker${j}` });
  }
  return out;
}
export const seedCounts = (seed) => Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.length]));
