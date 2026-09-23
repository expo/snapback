import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('./snapback/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.q'));
const source = files.map(name => readFileSync(new URL(name, directory), 'utf8')).join('\n');
const code = source.split('\n').map(line => line.split('--')[0]).join('\n');
const blocks = [...code.matchAll(/^(table|maintain|query|mutation) (\w+)[^\n]*\n(?:[ \t].*\n|\n)*/gm)];
const block = name => blocks.find(match => match[2] === name)?.[0];

test('the application owns only six source tables and no projection tables', () => {
  assert.deepEqual(files, ['schema.q']);
  const columns = {
    profiles: ['principal', 'name'],
    posts: ['authorId', 'body', 'at', 'removed', 'likeCount'],
    replies: ['postId', 'authorId', 'body', 'at'],
    likes: ['postId', 'principal', 'at'],
    reposts: ['actorId', 'postId', 'at'],
    follows: ['followerId', 'followedId', 'at'],
  };
  assert.deepEqual(blocks.filter(m => m[1] === 'table').map(m => m[2]), Object.keys(columns));
  for (const [table, expected] of Object.entries(columns)) {
    const actual = [...block(table).matchAll(/^  (\w+):/gm)].map(m => m[1]);
    assert.deepEqual(actual, expected, `${table}: no copied attribution fields`);
  }
  for (const match of code.matchAll(/\b(?:insert|update|upsert|delete) (\w+)(?= |\[)/g)) {
    assert.ok(Object.hasOwn(columns, match[1]), `application projection write: ${match[1]}`);
  }
  assert.doesNotMatch(code, /\b(?:verify|verification|job|schedule|helper)\b/);
  assert.doesNotMatch(code, /\bfeed\w*\(/, 'no feed helper calls');
});

test('F1, F2 and F3 are declared directly, with one ranking merge and no fill', () => {
  assert.match(block('posts'), /^  likeCount: count likes by postId$/m);
  assert.match(block('posts'), /^  by byHourLikes: hour\(at\), likeCount, at, id$/m);
  assert.deepEqual(blocks.filter(m => m[1] === 'maintain').map(m => m[2]), [
    'feed', 'receivedLikes', 'receivedReplies', 'dailyReceivedLikes', 'dailyReceivedReplies',
  ]);
  assert.match(block('feed'), /^  size authors 1008, edges 5921$/m);
  assert.doesNotMatch(block('feed'), /\breplies\b/);
  assert.match(block('receivedLikes'), /^maintain receivedLikes: count likes by postId.authorId$/m);
  assert.match(block('receivedReplies'), /^maintain receivedReplies: count replies by postId.authorId$/m);
  for (const name of ['dailyReceivedLikes', 'dailyReceivedReplies']) {
    assert.match(block(name), /by postId.authorId, day\(postId.at\)/);
  }
  assert.equal(block('like').trim(), 'mutation like(postId: posts):\n  insert likes { postId, principal: viewer, at: now } if absent');
  assert.match(block('likes'), /^  insert <- .principal = viewer$/m);
  assert.equal(block('trending').trim(), [
    'query trending(c: cursor ?):',
    '  return merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now:',
    '    [h] for h in range(hour(now) - 24, hour(now) + 1)',
  ].join('\n'));
  assert.match(block('thread'), /replies\[postId\] after c first 20 by byPost/);
  const physical = source.trimEnd().split('\n').length;
  const substantive = code.split('\n').filter(line => line.trim()).length;
  console.log(JSON.stringify({ applicationSourceLines: physical, nonblankNoncommentLines: substantive,
    sourceTables: 6, applicationProjectionTables: 0, copiedAttributionFields: 0,
    verificationClauses: 0, repairOrBackfillJobs: 0, feedHelperCalls: 0, zeroLikeFill: 0 }));
});
