import assert from 'node:assert/strict';

const [platform = 'mac', backend = 'sqlite'] = process.argv.slice(2);
const origin = process.env.EXACT_DEV_URL ?? 'http://127.0.0.1:8083';
const token = process.env.EXACT_AGENT_TOKEN;
const agentBase = `${origin}/__exact/agent`;

async function json(path, init = {}) {
  const response = await fetch(`${agentBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const value = await response.json();
  if (!response.ok || value.error) {
    throw new Error(`${path}: ${response.status} ${JSON.stringify(value.error ?? value)}`);
  }
  return value;
}

const targets = await json('/targets');
const candidates = targets.targets.filter((target) =>
  target.live && target.platform === platform && target.agentUrl
);
assert.equal(candidates.length, 1, `expected one live ${platform} Acto target`);
const target = candidates[0];
const route = (path) => `${path}${path.includes('?') ? '&' : '?'}target=${encodeURIComponent(target.targetId)}`;
const post = (path, body) => json(route(path), {
  method: 'POST',
  body: JSON.stringify(body),
});
const waitFor = (testId) => post('/wait', {
  condition: 'viewExists',
  params: { testId },
  timeout: 10_000,
});

let snapshot = await post('/snapshot', {
  include: ['tree', 'diagnostics'],
  treeFormat: 'dense',
});
let tree = snapshot.data.tree.tree;
if (!tree.includes('testId=open-event_swim')) {
  assert.match(tree, /testId=back/, 'expected feed or event detail');
  const back = await post('/tap', { testId: 'back' });
  assert.equal(back.data.dispatched, true, 'back action did not dispatch');
  assert.equal((await waitFor('open-event_swim')).data.matched, true);
  snapshot = await post('/snapshot', { include: ['tree'], treeFormat: 'dense' });
  tree = snapshot.data.tree.tree;
}

assert.match(tree, new RegExp(`EXACT \\+ CONTRACT · ${backend}`));
assert.match(tree, /testId=event-title-event_sunset/);
assert.match(tree, /testId=open-event_swim/);

const opened = await post('/tap', {
  testId: 'open-event_swim',
  observeAfter: { include: ['tree'] },
});
assert.equal(opened.data.dispatched, true, 'open action did not dispatch');
assert.equal(opened.data.nativeReachability?.reachesTarget, true, 'open action is not reachable through native hit testing');
assert.equal((await waitFor('rsvp-going')).data.matched, true, 'detail did not load');

const detail = await post('/snapshot', { include: ['tree'], treeFormat: 'dense' });
const wasGoing = detail.data.tree.tree.includes('testId=my-rsvp-going');
const targetStatus = wasGoing ? 'maybe' : 'going';

const responded = await post('/tap', {
  testId: `rsvp-${targetStatus}`,
  observeAfter: { include: ['tree'] },
});
assert.equal(responded.data.dispatched, true, 'RSVP action did not dispatch');
assert.equal(responded.data.nativeReachability?.reachesTarget, true, 'RSVP action is not reachable through native hit testing');
assert.equal((await waitFor(`my-rsvp-${targetStatus}`)).data.matched, true, 'RSVP did not change state');

console.log(
  `EXACT_ACTO platform=${platform} backend=${backend} result=pass target=${target.targetId}`,
);
