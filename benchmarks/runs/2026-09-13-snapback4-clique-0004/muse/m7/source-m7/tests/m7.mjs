// M7 acceptance: group polls + backfilled visible message counts.
// Run: SNAPBACK_URL=http://127.0.0.1:49310 CHOREO_BASE_URL=http://127.0.0.1:49311
//      npm run acceptance -- --milestone m7
// The suite never votes on the choreo poll (scripts/m7-ensure-poll.mjs
// creates it vote-free); vote/change/duplicate coverage uses a
// suite-owned group so the choreography's fresh-tally assumptions hold.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { check, rowsOf, api, mu, qu, newBrowserContext, uiLogin, fixture, WEB, URL } from './helpers.mjs';

const stamp = () => Date.now() % 100000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixturePasswords() {
  const p = JSON.parse(readFileSync(fixture('personas.json'), 'utf8'));
  return Object.fromEntries(p.starter.map((x) => [x.id, x.password]));
}

async function fixtureLogin(id) {
  const pw = fixturePasswords()[id];
  for (let i = 0; i < 12; i++) {
    const r = await api('/auth/login', null, { email: `${id}@example.com`, password: pw });
    if (r.json?.session) {
      return { token: r.json.session.token, principal: r.json.session.principal, email: `${id}@example.com`, password: pw };
    }
    if (!/RATE_LIMIT/i.test(JSON.stringify(r.json))) break;
    await sleep(5000);
  }
  throw new Error(`fixture login failed: ${id}`);
}

async function rawMu(u, op, args, id) {
  const r = await api(`/m/${op}`, u.token, { id, args });
  return r.json;
}

async function weekendPlans(u) {
  const inbox = await qu(u, 'inbox', {});
  const row = rowsOf(inbox).find((x) => x.chat?.kind === 'group' && x.chat?.name === 'Weekend Plans');
  if (!row) throw new Error('Weekend Plans group not found');
  return row.chatId;
}

async function visibleByPaging(u, chatId) {
  const out = [];
  let c = null;
  for (let i = 0; i < 20; i++) {
    const r = await api('/q/threadMessages', u.token, { args: c ? { chatId, c } : { chatId } });
    const rows = rowsOf(r.json);
    out.push(...rows);
    const next = r.json?.data?.next;
    if (!next) break;
    c = next;
  }
  return out.filter((m) => !m.tombstoned).length;
}

export async function runM7(browser) {
  const alice = await fixtureLogin('alice');
  const bob = await fixtureLogin('bob');
  const dave = await fixtureLogin('dave');
  const groupId = await weekendPlans(alice);
  const s = stamp();

  // m7-a01: the choreo poll exists (created idempotently), well-formed.
  execFileSync('node', ['scripts/m7-ensure-poll.mjs', '--url', URL], { stdio: 'inherit' });
  let p = await qu(alice, 'pollOf', { messageId: 'm7-choreo-poll' });
  const card = p.data;
  check('m7-a01-exists', card?.messageId === 'm7-choreo-poll', card?.question ?? '');
  check(
    'm7-a01-options',
    Array.isArray(card?.options) && card.options.length === 2 &&
      card.options[0]?.optionId === 'm7-option-a' && card.options[1]?.optionId === 'm7-option-b',
    JSON.stringify(card?.options?.map((o) => o.optionId)),
  );
  // Structural coherence only: the choreography votes on this poll, so a
  // rerun after choreo must not demand zero tallies here. Strict
  // zero/mine checks run below against the fresh per-run test poll.
  check(
    'm7-a01-coherent',
    Number.isInteger(card?.total) && (card?.total ?? -1) >= 0 &&
      card?.options?.every((o) => Number.isInteger(o.tally) && o.tally >= 0) &&
      card?.options?.reduce((a, o) => a + o.tally, 0) === card?.total,
    `total=${card?.total}`,
  );
  const tp = await qu(bob, 'threadPolls', { chatId: groupId });
  check('m7-a01-listed', rowsOf(tp).some((x) => x.messageId === 'm7-choreo-poll'), `polls=${rowsOf(tp).length}`);
  // The poll is an ordinary message: visible in history with the question.
  let seen = null;
  {
    let c = null;
    for (let i = 0; i < 10 && !seen; i++) {
      const r = await api('/q/threadMessages', bob.token, { args: c ? { chatId: groupId, c } : { chatId: groupId } });
      seen = rowsOf(r.json).find((m) => m.id === 'm7-choreo-poll') ?? null;
      c = r.json?.data?.next;
      if (!c) break;
    }
  }
  check('m7-a01-message', seen?.body === card?.question && seen?.kind === 'text', seen?.body ?? 'absent');
  // Idempotent re-create settles without duplicating options.
  {
    const r = await rawMu(alice, 'createPoll', {
      chatId: groupId, msgId: 'm7-choreo-poll', question: 'Saturday plan: coffee first or trail first?',
      optIdA: 'm7-option-a', optA: 'Coffee first', optIdB: 'm7-option-b', optB: 'Trail first',
    }, `m7-a01-retry-${s}`);
    const again = await qu(alice, 'pollOf', { messageId: 'm7-choreo-poll' });
    check('m7-a01-idempotent', r?.state !== 'failed' && again.data?.options?.length === 2, r?.state ?? '');
  }

  // m7-a01 validation: shape refusals.
  {
    const dupIds = await rawMu(alice, 'createPoll', {
      chatId: groupId, msgId: `m7-bad-dup-${s}`, question: 'Q?', optIdA: 'x', optA: 'A', optIdB: 'x', optB: 'B',
    }, `m7-bad-dup-${s}`);
    check('m7-a01-dupids', dupIds?.state === 'failed', dupIds?.why?.code ?? '');
    const long = await rawMu(alice, 'createPoll', {
      chatId: groupId, msgId: `m7-bad-long-${s}`, question: `Q${'u'.repeat(200)}`, optIdA: 'a', optA: 'A', optIdB: 'b', optB: 'B',
    }, `m7-bad-long-${s}`);
    check('m7-a01-longq', long?.state === 'failed', long?.why?.code ?? '');
    const emptyLabel = await rawMu(alice, 'createPoll', {
      chatId: groupId, msgId: `m7-bad-empty-${s}`, question: 'Q?', optIdA: 'a', optA: '', optIdB: 'b', optB: 'B',
    }, `m7-bad-empty-${s}`);
    check('m7-a01-emptylabel', emptyLabel?.state === 'failed', emptyLabel?.why?.code ?? '');
    const dmPoll = await rawMu(alice, 'createPoll', {
      chatId: 'd-alice-bob', msgId: `m7-bad-dm-${s}`, question: 'Q?', optIdA: 'a', optA: 'A', optIdB: 'b', optB: 'B',
    }, `m7-bad-dm-${s}`);
    check('m7-a01-dmonly', dmPoll?.state === 'failed' && dmPoll?.why?.code === 'POLL_GROUP_ONLY', dmPoll?.why?.code ?? '');
    const nonMember = await rawMu(dave, 'setVote', { messageId: 'm7-choreo-poll', optionId: 'm7-option-a', mutId: `m7-nm-${s}` }, `m7-nm-${s}`);
    check('m7-a01-nonmember', nonMember?.state === 'failed', nonMember?.why?.code ?? '');
    const badOption = await rawMu(bob, 'setVote', { messageId: 'm7-choreo-poll', optionId: 'nope', mutId: `m7-bo-${s}` }, `m7-bo-${s}`);
    check('m7-a01-badoption', badOption?.state === 'failed' && badOption?.why?.code === 'UNKNOWN_OPTION', badOption?.why?.code ?? '');
  }

  // Suite-owned group + 3-option test poll for vote/change/duplicate/counts.
  const tg = `m7tg-${s}`;
  let r = await rawMu(alice, 'groupCreate', { chatId: tg, title: `M7 Test ${s}`, description: 'poll lab', second: bob.principal }, `m7tg-${s}`);
  check('m7-setup-group', !!r?.result?.id, r?.state ?? '');
  const testPoll = `m7-testpoll-${s}`;
  r = await rawMu(alice, 'createPoll', {
    chatId: tg, msgId: testPoll, question: 'Lab: red, green, or blue?',
    optIdA: `m7t-${s}-a`, optA: 'Red', optIdB: `m7t-${s}-b`, optB: 'Green',
    optIdC: `m7t-${s}-c`, optC: 'Blue',
  }, `m7-testpoll-${s}`);
  check('m7-a01-three', r?.state !== 'failed', r?.state ?? '');
  p = await qu(alice, 'pollOf', { messageId: testPoll });
  check('m7-a01-threeopts', p.data?.options?.length === 3, `${p.data?.options?.length}`);
  check('m7-a01-freshzero', p.data?.total === 0 && p.data?.mine == null, `total=${p.data?.total}`);

  // m7-a03: members vote; changing a vote adjusts counts (one per user).
  const tallies = async () => (await qu(alice, 'pollOf', { messageId: testPoll })).data;
  await rawMu(bob, 'setVote', { messageId: testPoll, optionId: `m7t-${s}-a`, mutId: `m7t-v1-${s}` }, `m7t-v1-${s}`);
  await rawMu(alice, 'setVote', { messageId: testPoll, optionId: `m7t-${s}-b`, mutId: `m7t-v2-${s}` }, `m7t-v2-${s}`);
  let t = await tallies();
  check('m7-a03-votes', JSON.stringify(t.options.map((o) => o.tally)) === '[1,1,0]' && t.total === 2, JSON.stringify(t.options.map((o) => o.tally)));
  check('m7-a03-mine', t.mine?.optionId === `m7t-${s}-b`, t.mine?.optionId ?? '');
  await rawMu(bob, 'setVote', { messageId: testPoll, optionId: `m7t-${s}-b`, mutId: `m7t-v3-${s}` }, `m7t-v3-${s}`);
  t = await tallies();
  check('m7-a03-change', JSON.stringify(t.options.map((o) => o.tally)) === '[0,2,0]' && t.total === 2, JSON.stringify(t.options.map((o) => o.tally)));

  // m7-a04: duplicate/retried vote intents do not flip state.
  const dupOp = await rawMu(bob, 'setVote', { messageId: testPoll, optionId: `m7t-${s}-b`, mutId: `m7t-v3-${s}` }, `m7t-v3-${s}`);
  t = await tallies();
  check('m7-a04-retry', dupOp?.replayed === true && JSON.stringify(t.options.map((o) => o.tally)) === '[0,2,0]', `replayed=${dupOp?.replayed}`);
  const dupMut = await rawMu(bob, 'setVote', { messageId: testPoll, optionId: `m7t-${s}-b`, mutId: `m7t-v3-${s}` }, `m7t-v4-${s}`);
  t = await tallies();
  check('m7-a04-samemut', dupMut?.state !== 'failed' && JSON.stringify(t.options.map((o) => o.tally)) === '[0,2,0]', JSON.stringify(t.options.map((o) => o.tally)));

  // m7-a06: backfill — pre-existing conversations count visible messages.
  const dmDetail = await qu(alice, 'chatDetail', { chatId: 'd-alice-bob' });
  check('m7-a06-dm', dmDetail.data?.count === 6, `count=${dmDetail.data?.count}`);
  const gDetail = await qu(alice, 'chatDetail', { chatId: groupId });
  const gVisible = await visibleByPaging(alice, groupId);
  check('m7-a06-group', gDetail.data?.count === 10 && gVisible === 10, `count=${gDetail.data?.count} paged=${gVisible}`);
  const dmVisible = await visibleByPaging(alice, 'd-alice-bob');
  check('m7-a06-selfconsistent', dmVisible === dmDetail.data?.count, `paged=${dmVisible}`);

  // m7-a06 expiry exclusion: disappearing message stops counting after the sweep.
  {
    await rawMu(alice, 'setDisappearing', { chatId: tg, value: '24h' }, `m7-dis-${s}`);
    const before = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    const ephemeral = `m7-eph-${s}`;
    await rawMu(alice, 'sendText', { chatId: tg, msgId: ephemeral, body: 'this will vanish' }, ephemeral);
    const withMsg = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    check('m7-a06-ephemeral-counted', withMsg === before + 1, `${before} -> ${withMsg}`);
    let after = withMsg;
    for (let i = 0; i < 36 && after !== before; i++) {
      await sleep(10000);
      after = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    }
    check('m7-a06-expired', after === before, `${withMsg} -> ${after}`);
    await rawMu(alice, 'setDisappearing', { chatId: tg, value: 'off' }, `m7-disoff-${s}`);
  }

  // m7-a07: counts increment with new messages; polls count; shown in settings (UI).
  {
    const base = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    const extra = `m7-inc-${s}`;
    await rawMu(bob, 'sendText', { chatId: tg, msgId: extra, body: 'increment probe' }, extra);
    const afterSend = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    check('m7-a07-send', afterSend === base + 1, `${base} -> ${afterSend}`);
    const extraPoll = `m7-incpoll-${s}`;
    await rawMu(bob, 'createPoll', {
      chatId: tg, msgId: extraPoll, question: 'Count me?',
      optIdA: `m7i-${s}-a`, optA: 'Yes', optIdB: `m7i-${s}-b`, optB: 'No',
    }, extraPoll);
    const afterPoll = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    check('m7-a07-pollcounts', afterPoll === base + 2, `${base} -> ${afterPoll}`);
    await rawMu(bob, 'deleteMessage', { messageId: extra }, `m7-incdel-${s}`);
    const afterDel = (await qu(alice, 'chatDetail', { chatId: tg })).data?.count;
    check('m7-a07-delete', afterDel === base + 1, `${afterPoll} -> ${afterDel}`);

    // Chat-settings UI shows the same count.
    const { context, page } = await newBrowserContext(browser);
    try {
      await uiLogin(page, alice.email, alice.password);
      await page.goto(`${WEB}/conversation/group/${encodeURIComponent(`M7 Test ${s}`)}/settings`, { waitUntil: 'domcontentloaded' });
      const node = page.getByTestId('sm-chatsettings-messagecount');
      await node.waitFor({ timeout: 30000 });
      let shown = '';
      for (let i = 0; i < 30; i++) {
        shown = ((await node.innerText().catch(() => '')) || '').trim();
        if (shown === String(afterDel)) break;
        await page.waitForTimeout(1000);
      }
      check('m7-a07-settings', shown === String(afterDel), `shown=${shown} want=${afterDel}`);
    } finally {
      await context.close();
    }

    // Poll UI: options + tallies render in the conversation; a UI vote lands.
    const { context: ctx2, page: bp } = await newBrowserContext(browser);
    try {
      await uiLogin(bp, bob.email, bob.password);
      await bp.goto(`${WEB}/conversation/group/${encodeURIComponent(`M7 Test ${s}`)}/settings`, { waitUntil: 'domcontentloaded' });
      await bp.getByTestId('sm-chatsettings-member').first().waitFor({ timeout: 30000 });
      await bp.goto(`${WEB}/conversation/group/${encodeURIComponent(`M7 Test ${s}`)}`, { waitUntil: 'domcontentloaded' });
      const opt = bp.getByTestId('sm-poll-option').filter({ hasText: 'Red' });
      await opt.waitFor({ timeout: 30000 });
      // Bob already voted Green via API; a UI click must move his vote to
      // Red (Red 0 -> 1, Green 2 -> 1). Assert the settled server state,
      // retrying the tap: a rejected write rolls back optimistic UI, so a
      // bare tally flash without server state would be a false pass.
      let votedRed = false;
      for (let attempt = 0; attempt < 3 && !votedRed; attempt++) {
        await opt.click();
        for (let i = 0; i < 10 && !votedRed; i++) {
          await bp.waitForTimeout(2000);
          const cur = await qu(bob, 'pollOf', { messageId: testPoll });
          if (cur.data?.mine?.optionId === `m7t-${s}-a`) votedRed = true;
        }
      }
      const fin = await qu(bob, 'pollOf', { messageId: testPoll });
      const redTally = fin.data?.options?.[0]?.tally;
      check('m7-a07-uivote', votedRed && redTally === 1, `mine=${fin.data?.mine?.optionId} red=${redTally}`);
    } finally {
      await ctx2.close();
    }
  }
}
