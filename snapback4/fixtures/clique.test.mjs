import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, main, defaultOut } from './clique.mjs';
import { fixtureRoot, parseAction, readJSON } from './grammar.mjs';
import { State, replay, tables } from './replay.mjs';
import { assertFacts, summarize, tableCounts, verifyFixtures } from './audit.mjs';

const directory = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('./clique.mjs', import.meta.url));
const combined = readJSON('invariant-manifest-combined.json');
const starter = readJSON('invariant-manifest-starter.json');
const temp = t => {
  const path = mkdtempSync(join(directory, '.test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: directory });
const loadRows = out => Object.fromEntries(tables.map(table => {
  const content = readFileSync(join(out, `${table}.jsonl`), 'utf8');
  assert.ok(content === '' || content.endsWith('\n'));
  const rows = content ? content.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${table} ids are unique`);
  assert.deepEqual(rows.map(row => row.id), rows.map(row => row.id).sort(), `${table} is sorted`);
  for (const row of rows) assert.ok(Number.isSafeInteger(row.at), `${table}.${row.id}.at`);
  return [table, rows];
}));

function checkReferences(rows) {
  const users = new Set(rows.users.map(row => row.id));
  const posts = new Set([...rows.posts, ...rows.replies].map(row => row.id));
  const conversations = new Set(rows.conversations.map(row => row.id));
  const messages = new Map(rows.messages.map(row => [row.id, row]));
  const members = new Set(rows.memberships.map(row => `${row.conversationId}:${row.userId}`));
  for (const [table, entries] of Object.entries(rows)) for (const row of entries) {
    for (const key of ['userId', 'authorId', 'senderId', 'creatorId', 'targetUserId']) {
      if (row[key]) assert.ok(users.has(row[key]), `${table}.${row.id}.${key}`);
    }
    if (row.conversationId) assert.ok(conversations.has(row.conversationId));
    if (row.postId) assert.ok(posts.has(row.postId));
    if (row.parentPostId) assert.ok(posts.has(row.parentPostId));
    if (row.messageId) assert.ok(messages.has(row.messageId));
    if (table === 'profiles') assert.ok(users.has(row.id));
    if (table === 'messages') {
      assert.ok(members.has(`${row.conversationId}:${row.senderId}`));
      if (row.quoteId) assert.equal(messages.get(row.quoteId)?.conversationId, row.conversationId);
      if (row.media) {
        assert.deepEqual(Object.keys(row.media).sort(), ['byteSize', 'path']);
        assert.equal(row.media.byteSize, statSync(new URL(row.media.path, fixtureRoot)).size);
      }
    }
  }
}

test('all combined, starter, checkpoint, spot and artifact manifest facts match', () => {
  assert.deepEqual(verifyFixtures(), combined);
});

test('scale hub facts come from the manifest, with the starter contribution removed', () => {
  const state = replay();
  const summary = summarize(state);
  assert.equal(summary.perUserConversationCounts.u0001, combined.expectedState.perUserConversationCounts.u0001);
  assert.equal(summary.perUserFollowingCounts.u0500, combined.expectedState.namedO5Fixtures.u0500.followingCount);
  for (const field of Object.keys(summary.perEntityCounts)) {
    assert.equal(summary.perEntityCounts[field], combined.expectedState.perEntityCounts[field] -
      starter.expectedState.perEntityCounts[field], field);
  }
  const largest = Object.entries(summary.perChatMessageCounts).sort((a, b) => b[1] - a[1])[0];
  assert.deepEqual(largest, ['g0001', combined.expectedState.namedO5Fixtures.g0001.messageCount]);
  const line = readFileSync(new URL('scale.log', fixtureRoot), 'utf8').split('\n').find(line => line.includes(' send mg0001-00001 '));
  assert.equal(state.messages.get('mg0001-00001').at, Date.parse(line.split(' ')[0]));
});

test('two full CLI builds are byte-identical, and every output reference resolves', t => {
  const root = temp(t);
  const first = join(root, 'one');
  const second = join(root, 'two');
  for (const out of [first, second]) {
    const result = run(['build', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(readdirSync(first).sort(), tables.map(table => `${table}.jsonl`).sort());
  for (const name of readdirSync(first)) assert.deepEqual(readFileSync(join(first, name)), readFileSync(join(second, name)), name);
  checkReferences(loadRows(first));
  assert.equal(defaultOut, join(directory, 'out/'));
});

test('sample-50 round trip preserves all verb intents, media, quotes, ids and timestamps', t => {
  const out = temp(t);
  const state = build({ log: 'sample', out });
  const rows = loadRows(out);
  checkReferences(rows);
  assert.deepEqual(tableCounts(state), { users: 4, profiles: 4, follows: 2, posts: 8, likes: 2,
    reposts: 1, replies: 4, reactions: 2, conversations: 2, memberships: 6, messages: 10 });
  for (const table of tables) assert.deepEqual(rows[table], [...state[table].values()].sort((a, b) => a.id < b.id ? -1 : 1));
  const ids = table => rows[table].map(row => row.id);
  assert.deepEqual(ids('follows'), ['sample-mut-follow-01', 'sample-mut-follow-04']);
  assert.deepEqual(ids('likes'), ['sample-mut-like-02', 'sample-mut-like-04']);
  assert.deepEqual(ids('reposts'), ['sample-mut-repost-03']);
  assert.deepEqual(ids('reactions'), ['sample-mut-react-04', 'sample-mut-react-05']);
  assert.deepEqual(rows.reactions.map(row => row.emoji), ['🎉', '🎉']);
  assert.deepEqual(rows.profiles[0], { id: 'sample-a', displayName: 'Sample Ada', handle: 'sama',
    bio: 'Conformance profile sample-a.', location: 'Fixture City', link: 'https://example.com/sample-a',
    avatar: 'media/avatar-alice.png', at: Date.parse('2026-01-01T00:00:01Z') });
  assert.deepEqual(rows.posts.map(row => row.postType), ['text', 'images', 'images', 'video', 'text', 'text', 'images', 'video']);
  assert.equal(rows.posts[2].media.length, 4);
  assert.deepEqual(rows.replies.map(row => row.parentPostId), ['sample-post-01', 'sample-post-01', 'sample-post-04', 'sample-post-06']);
  assert.deepEqual(rows.conversations.map(row => row.kind), ['dm', 'group']);
  assert.equal(rows.memberships.filter(row => row.role === 'admin').length, 1);
  const messages = Object.fromEntries(rows.messages.map(row => [row.id, row]));
  assert.deepEqual(messages['sample-msg-02'], { id: 'sample-msg-02', conversationId: 'sample-dm-01', senderId: 'sample-b',
    messageType: 'text', text: 'DM quoted.', media: null, caption: null, viewOnce: false,
    quoteId: 'sample-msg-01', at: Date.parse('2026-01-01T00:00:36Z') });
  assert.equal(messages['sample-msg-09'].viewOnce, true);
  assert.equal(messages['sample-msg-09'].caption, 'View once.');
  assert.equal(messages['sample-msg-10'].media.path, 'media/vid-01.mp4');
  assert.equal(messages['sample-msg-10'].messageType, 'video');
  const actions = readFileSync(new URL('sample-50.log', fixtureRoot), 'utf8').trimEnd().split('\n').map(parseAction);
  assert.equal(actions.length, 50);
  assert.deepEqual([...new Set(actions.map(action => action.verb))].sort(), readJSON('action-schema.json').verbs.map(verb => verb.name).sort());
});

test('--scale 2 keeps registration order and drops actors and cascading dependencies', t => {
  const root = temp(t);
  const result = run(['build', '--log', 'scale', '--scale', '2', '--out', root]);
  assert.equal(result.status, 0, result.stderr);
  const rows = loadRows(root);
  checkReferences(rows);
  assert.deepEqual(rows.users.map(row => row.id), ['u0001', 'u0002']);
  assert.deepEqual(rows.conversations.map(row => row.id), ['d0001', 'g0001']);
  assert.equal(rows.memberships.length, 4);
  assert.equal(rows.messages.length, 500);
  assert.ok(!rows.messages.some(row => row.id.startsWith('md0002-')));
  const fullSample = replay('sample');
  const small = replay('sample', 2);
  assert.deepEqual([...small.messages.keys()], ['sample-msg-01', 'sample-msg-02', 'sample-msg-03', 'sample-msg-06', 'sample-msg-07', 'sample-msg-08', 'sample-msg-09']);
  assert.equal(small.posts.size, 4);
  assert.equal(small.replies.size, 2);
  const all = replay('sample', 100);
  for (const table of tables) assert.deepEqual(all[table], fullSample[table]);
});

test('grammar decodes JSON escapes and enforces schema variants and constraints', () => {
  const line = (body, timestamp = '2026-01-01T00:00:00Z') => `${timestamp}\tsample-a  ${body}`;
  assert.equal(parseAction(line('post post-a text "line\\nquote \\" and \\u2764"')).args.text, 'line\nquote " and ❤');
  assert.equal(parseAction(line('send msg-a chat-a "" quote=msg-b')).args.quote, 'msg-b');
  assert.deepEqual(parseAction('# checkpoint 10%'), { checkpoint: '10%' });
  for (const body of ['send msg-a chat-a unquoted', 'send msg-a chat-a "ok" extra',
    'follow sample-b toggle mut-a', 'post post-a text "ok" media/img-01.png',
    'post post-a images "ok" media/vid-01.mp4', 'post post-a images "ok" ' + Array(5).fill('media/img-01.png').join(','),
    'send-media msg-a chat-a video media/vid-01.mp4 "" view-once',
    'send-media msg-a chat-a image media/vid-01.mp4 "" normal', 'register a@example.com "short"',
    'post post-a text "a"junk', 'post post-a text "bad\\q"', 'mystery arg', 'post post-a text "' + 'x'.repeat(501) + '"']) {
    assert.throws(() => parseAction(line(body)), undefined, body);
  }
  for (const bad of ['', ' ', '# checkpoint 90%', line('post post-a text ""', '2026-02-30T00:00:00Z')]) assert.throws(() => parseAction(bad));
});

test('set-state retries, DM pair reuse and filtered quote chains retain their meaning', () => {
  const full = new State();
  const selected = new State(2);
  let at = 0;
  const apply = (actor, body) => {
    const action = parseAction(`${new Date(Date.UTC(2026, 0, 1) + at++ * 1000).toISOString().replace('.000Z', 'Z')} ${actor} ${body}`);
    full.apply(action); selected.apply(action, true);
  };
  for (const actor of ['user-z', 'user-a', 'user-b']) apply(actor, `register ${actor}@example.com "password1"`);
  apply('user-z', 'group-create group-a user-a "Group" ""');
  apply('user-z', 'member-add group-a user-b mut-member');
  apply('user-b', 'send msg-a group-a "excluded"');
  apply('user-z', 'send msg-b group-a "depends" quote=msg-a');
  apply('user-a', 'send msg-c group-a "transitive" quote=msg-b');
  assert.equal(selected.messages.size, 0);
  assert.deepEqual([...selected.users.keys()], ['user-z', 'user-a']);
  apply('user-z', 'dm-create dm-a user-a');
  apply('user-a', 'dm-create dm-b user-z');
  apply('user-a', 'send msg-d dm-b "same pair"');
  assert.equal(full.messages.get('msg-d').conversationId, 'dm-a');
  assert.equal(full.conversations.size, 2);
  apply('user-z', 'react msg-d "👍" react-a');
  apply('user-z', 'react msg-d "❤️" react-b');
  assert.equal([...full.reactions.values()][0].emoji, '❤️');
  apply('user-z', 'react msg-d "none" react-c');
  apply('user-z', 'react msg-d "👍" react-a');
  assert.equal(full.reactions.size, 0, 'an old mutation retry must not undo a later clear');
  assert.throws(() => full.apply(parseAction('2026-01-01T00:00:00Z user-z send bad group-a "" quote=msg-d')), /same conversation/);
  assert.throws(() => full.apply(parseAction('2026-01-01T00:00:00Z user-z like missing set mut-bad')), /missing post/);
});

test('stats CLI verifies manifests and reports the selected dataset', () => {
  const result = run(['stats', '--log', 'scale']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`u0001.memberships: ${combined.expectedState.perUserConversationCounts.u0001}\\n`));
  assert.match(result.stdout, /text-sends: 99090\nmedia-sends: 910\n/);
  assert.match(result.stdout, /manifest: PASS/);
  assertFacts(summarize(replay('starter')), starter.expectedState);
});

test('mismatches name the field and both values, and CLI failures exit 1', () => {
  const actual = structuredClone(combined.expectedState);
  actual.perUserConversationCounts.u0001--;
  assert.throws(() => assertFacts(actual, combined.expectedState, 'combined.expectedState'),
    /combined.expectedState.perUserConversationCounts.u0001: expected 1000, actual 999/);
  const code = `import { main } from './clique.mjs'; import { State } from './replay.mjs';
    const apply = State.prototype.apply; State.prototype.apply = function(a, f) {
      apply.call(this, a, f);
      if (a.verb === 'profile-set' && a.actorId === 'alice') this.profiles.get('alice').bio = 'wrong'; };
    try { main(['stats']); } catch (e) { console.error(e.message); process.exitCode = 1; }`;
  const bad = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /starter.namedSpotEntities.profiles.alice.bio: expected .*actual "wrong"/);
  for (const args of [['build', '--scale', '0'], ['build', '--scale', '1.5'], ['build', '--scale', '-1'],
    ['build', '--scale', '9007199254740992'], ['build', '--log', 'bad'], ['build', '--out'],
    ['build', '--log', 'sample', '--log', 'scale'], ['stats', '--scale', '2'], ['nope']]) {
    assert.throws(() => main(args));
  }
  assert.equal(run(['build', '--scale', '0']).status, 1);
});
