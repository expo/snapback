import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const directory = new URL('./snapback/', import.meta.url);
function sources(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory() ? sources(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      : entry.name.endsWith('.q') ? [[`${prefix}${entry.name}`, readFileSync(new URL(entry.name, dir), 'utf8')]] : []);
}
// Quarry strings use either quote. Preserve their tokens, including -- and escaped quotes.
function lex(source) {
  const tokens = [];
  let code = '';
  for (let i = 0; i < source.length;) {
    const start = i;
    if (/\s/.test(source[i])) { code += source[i++]; continue; }
    if (source.slice(i, i + 2) === '--') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'") {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === quote) { closed = true; break; }
      }
      assert.ok(closed, 'unterminated string');
      tokens.push({ kind: 'string', text: source.slice(start, i) });
    } else {
      const word = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*|^\d+/)?.[0];
      i += word?.length ?? 1;
      tokens.push({ kind: word && /^[A-Za-z_]/.test(word) ? 'word' : 'symbol', text: source.slice(start, i) });
    }
    code += source.slice(start, i);
  }
  return { tokens, code };
}
const normalized = text => lex(text).tokens.map(t => `${t.kind}:${t.text}`).join(' ');
const columns = {
  profiles: ['principal', 'name'], posts: ['authorId', 'body', 'at', 'removed', 'likeCount'],
  replies: ['postId', 'authorId', 'body', 'at'], likes: ['postId', 'principal', 'at'],
  reposts: ['actorId', 'postId', 'at'], follows: ['followerId', 'followedId', 'at'],
};
const maintains = {
  feed: `maintain feed: timeline
    authors profiles by principal
    events posts by authorId, at removed by removed
    reposts reposts by actorId, postId, at
    edges follows by followerId, followedId
    size authors 1008, edges 5921`,
  receivedLikes: `maintain receivedLikes: count likes by postId.authorId read <- allow`,
  receivedReplies: `maintain receivedReplies: count replies by postId.authorId read <- allow online only`,
  dailyReceivedLikes: `maintain dailyReceivedLikes: count likes by postId.authorId, day(.at) read <- allow online only`,
  dailyReceivedReplies: `maintain dailyReceivedReplies: count replies by postId.authorId, day(.at) read <- allow online only`,
};
const queries = {
  following: `query following(c: cursor ?): return feed[viewer] after c last 20 { *, post: posts[.postId], actor: profiles[.actorId], author: profiles[.authorId] }`,
  thread: `query thread(postId: posts, c: cursor ?): return replies[postId] after c first 20 by byPost`,
  trending: `query trending(c: cursor ?): return merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now and not .removed: [h] for h in range(hour(now) - 24, hour(now) + 1)`,
  insights: `query insights(authorId: principal, d: int): return { likes: receivedLikes[authorId], replies: receivedReplies[authorId], dailyLikes: dailyReceivedLikes[authorId, d], dailyReplies: dailyReceivedReplies[authorId, d] }`,
};
const mutations = {
  register: `mutation register(name: text <=80): return insert profiles { principal: viewer, name } if absent`,
  post: `mutation post(body: text <=4000): return insert posts { authorId: viewer, body, at: now }`,
  reply: `mutation reply(postId: posts, body: text <=500): require exists posts[postId] else FEED_APP_NOT_FOUND return insert replies { postId, authorId: viewer, body, at: now }`,
  like: `mutation like(postId: posts): require exists posts[postId] else FEED_APP_NOT_FOUND require posts[postId].removed = false else FEED_POST_REMOVED insert likes { postId, principal: viewer, at: now } if absent`,
  unlike: `mutation unlike(postId: posts): if exists likes[postId, viewer]: delete likes[postId, viewer]`,
  repost: `mutation repost(postId: posts): require exists posts[postId] else FEED_APP_NOT_FOUND require posts[postId].removed = false else FEED_POST_REMOVED return insert reposts { actorId: viewer, postId, at: now } if absent`,
  remove: `mutation remove(postId: posts): update posts[postId] { removed: true }`,
  unrepost: `mutation unrepost(postId: posts): if exists reposts[viewer, postId]: delete reposts[viewer, postId]`,
  follow: `mutation follow(authorId: principal): insert follows { followerId: viewer, followedId: authorId, at: now } if absent`,
  unfollow: `mutation unfollow(authorId: principal): if exists follows[viewer, authorId]: delete follows[viewer, authorId]`,
};
const allowed = { table: columns, maintain: maintains, fn: {}, query: queries, mutation: mutations, job: {}, schedule: {} };
function census(files) {
  const blocks = [];
  const lexical = files.map(([name, source]) => ({ name, source, ...lex(source) }));
  for (const { name, tokens } of lexical) {
    const starts = tokens.flatMap((t, i) => t.kind === 'word' && Object.hasOwn(allowed, t.text) ? [i] : []);
    assert.equal(starts[0], 0, `${name}: only allowlisted declarations`);
    for (const [n, start] of starts.entries()) {
      const ts = tokens.slice(start, starts[n + 1] ?? tokens.length);
      assert.equal(ts[1]?.kind, 'word');
      blocks.push({ kind: ts[0].text, name: ts[1].text, tokens: ts, normalized: ts.map(t => `${t.kind}:${t.text}`).join(' ') });
    }
  }
  const allTokens = lexical.flatMap(f => f.tokens);
  const word = (t, s) => t?.kind === 'word' && t.text === s;
  const declarations = Object.fromEntries(Object.keys(allowed).map(kind => [kind, blocks.filter(b => b.kind === kind)]));
  const tableColumns = Object.fromEntries(declarations.table.map(b => [b.name,
    b.tokens.slice(3).flatMap((t, i, ts) => t.kind === 'word' && ts[i + 1]?.text === ':' && !['by', 'unique'].includes(ts[i - 1]?.text) ? [t.text] : [])]));
  const calls = allTokens.filter((t, i) => t.kind === 'word' && allTokens[i + 1]?.text === '(' &&
    !Object.values(declarations).flat().some(b => b.name === t.text) && !['day', 'hour', 'range'].includes(t.text));
  const writeTargets = allTokens.flatMap((t, i) => ['insert', 'update', 'upsert', 'delete'].some(w => word(t, w)) && allTokens[i + 1]?.kind === 'word' ? [allTokens[i + 1].text] : []);
  const deviations = (actual, expected) => actual.filter(x => !expected.includes(x)).length;
  const counts = {
    sourceFiles: files.length,
    applicationSourceLines: lexical.reduce((n, f) => n + f.source.trimEnd().split('\n').length, 0),
    nonblankNoncommentLines: lexical.reduce((n, f) => n + f.code.split('\n').filter(l => l.trim()).length, 0),
    sourceTables: declarations.table.filter(b => Object.hasOwn(columns, b.name)).length,
    applicationProjectionTables: declarations.table.filter(b => !Object.hasOwn(columns, b.name)).length,
    columns: Object.values(tableColumns).reduce((n, cs) => n + cs.length, 0),
    copiedAttributionFields: Object.entries(tableColumns).reduce((n, [table, cs]) => n + deviations(cs, columns[table] ?? []), 0),
    verificationClauses: allTokens.filter(t => word(t, 'verify') || word(t, 'verification')).length,
    repairOrBackfillJobs: declarations.job.length + declarations.mutation.filter(b => !Object.hasOwn(mutations, b.name)).length,
    feedHelperCalls: calls.length,
    zeroLikeFill: declarations.query.filter(b => b.name === 'trending' && b.normalized !== normalized(queries.trending)).length,
    projectionWrites: deviations(writeTargets, Object.keys(columns)),
    maintains: declarations.maintain.length, helpers: declarations.fn.length,
    queries: declarations.query.length, mutations: declarations.mutation.length,
    jobs: declarations.job.length, schedules: declarations.schedule.length,
  };
  for (const key of ['applicationProjectionTables','copiedAttributionFields','verificationClauses','repairOrBackfillJobs','feedHelperCalls','zeroLikeFill','projectionWrites']) {
    assert.equal(counts[key], 0, key);
  }
  for (const [kind, manifest] of Object.entries(allowed)) {
    assert.deepEqual(declarations[kind].map(b => b.name).sort(), Object.keys(manifest).sort(), `${kind}: complete declaration allowlist`);
    for (const b of declarations[kind]) {
      if (kind === 'table') assert.deepEqual(tableColumns[b.name], columns[b.name], `${b.name}: all columns`);
      else assert.equal(b.normalized, normalized(manifest[b.name]), `${kind} ${b.name}: exact block`);
    }
  }
  const posts = declarations.table.find(b => b.name === 'posts');
  assert.ok(posts.normalized.includes(normalized('likeCount: count likes by postId')));
  assert.ok(posts.normalized.includes(normalized('by byHourLikes: hour(at), likeCount, at, id')));
  return counts;
}
const files = sources(directory);

test('complete recursive declaration census and exact derived/query/mutation blocks', () => {
  const counts = census(files);
  console.log('CLIQUE_CENSUS ' + JSON.stringify({ ...counts,
    files: files.map(([file, source]) => ({ file, sha256: createHash('sha256').update(source).digest('hex') })) }));
});

test('whitespace, strings with comment markers, and nested source files stay visible', () => {
  const source = files.map(([,s]) => s).join('\n');
  const variant = source.replace(/table /g, 'table\t ').replace(/insert /g, 'insert   ')
    .replace(/^  (\w+:)/gm, '\t    $1').replace("'public likes'", "'public -- likes'");
  assert.deepEqual(census([['nested/schema.q', variant]]).sourceTables, Object.keys(columns).length);
  assert.deepEqual(lex(`'escaped \\' -- not a comment' -- comment\n"also -- quoted"`).tokens.map(t=>t.kind), ['string','string']);
});

test('each forbidden mechanism is rejected by an in-memory negative fixture', () => {
  const source = files.map(([,s]) => s).join('\n');
  const fixtures = {
    projectionTable: source + '\ntable  cachedFeed:\n\tpostId: posts\n',
    projectionWrite: source.replace('return insert posts', 'insert  cachedFeed { body }\n  return insert posts'),
    copiedAttribution: source.replace('table likes:', 'table likes:\n\t authorId: principal'),
    verification: source.replace('table likes:', 'table likes:\n  verify postId.authorId = viewer'),
    repairMutation: source + '\nmutation repairCounts():\n  return null\n',
    backfillJob: source + '\njob backfill():\n  return null\n',
    feedHelper: source.replace('return insert posts', 'rememberPost(body)\n  return insert posts'),
    helperDeclaration: source + '\nfn rememberPost(body: text):\n  return body\n',
    schedule: source + '\nschedule repair every 1m: repairCounts\n',
    extraQuery: source + '\nquery cached():\n  return null\n',
    zeroLikeFill: source.replace('return merge posts', 'zeros = posts first 10\n  return merge posts'),
    feedMapping: source.replace('events posts by authorId, at removed by removed', 'events posts by authorId, at'),
    dailyLikePostDay: source.replace('count likes by postId.authorId, day(.at)', 'count likes by postId.authorId, day(postId.at)'),
    dailyReplyPostDay: source.replace('count replies by postId.authorId, day(.at)', 'count replies by postId.authorId, day(postId.at)'),
  };
  let rejected = 0;
  for (const [name, variant] of Object.entries(fixtures)) {
    assert.throws(() => census([['schema.q',variant]]), { name: 'AssertionError' }, name);
    rejected++;
  }
  assert.throws(() => census([...files, ['nested/hidden.q','table  cachedFeed:\n  postId: posts\n']]), { name: 'AssertionError' });
  rejected++;
  assert.equal(rejected, Object.keys(fixtures).length + 1);
  console.log('CLIQUE_CENSUS_NEGATIVE ' + JSON.stringify({ fixtures: [...Object.keys(fixtures), 'nestedProjection'], rejected }));
});
