// Extend an already-private copy of calibration #23, never its evidence store.
// Adds 900 two-person conversations with 100 messages each for u0500.
// node witness/sync-scale-extend.mjs http://127.0.0.1:49372
import assert from 'node:assert/strict';
import { login } from '../packages/snapback4/dist/auth.js';
import { createClient, idFrom } from '../packages/snapback4/dist/client.js';
const url = process.argv[2];
assert.ok(url, 'pass the URL serving your private copy');
const q = name => ({ kind: 'query', name });
const signed = await login(url, 'u0500@example.com', 'CliqueScale!20260808');
assert.ok(signed.ok);
const client = createClient({ url, session: signed.session });
try {
  const group = await client.query(q('messaging.groupByTitle'), { title: 'Busy Group 0001' });
  const roster = await client.query(q('messaging.roster'), { conversation: group.data.id });
  const me = signed.session.principal, other = roster.data.find(row => row.principal !== me).principal;
  let seeded = 0;
  for (let n = 0; n < 900; n++) {
    const conversation = idFrom(`ss-scale-conversation-${n}`);
    const rows = [{ table: 'conversations', row: { id: conversation, title: `SS scale group ${n}`, kind: 'group', creatorId: me, lastOrdinal: 100 } },
      ...[me, other].map((principal, i) => ({ table: 'members', row: {
        id: idFrom(`ss-scale-member-${n}-${i}`), conversation, principal, role: 'admin', joinedOrdinal: 0,
      } })),
      ...Array.from({ length: 100 }, (_, ordinal) => ({ table: 'messages', row: {
        id: idFrom(`ss-scale-message-${n}-${ordinal}`), conversation, sender: other, ordinal: ordinal + 1,
        recipients: 1, text: `Synthetic conversation ${n}, message ${ordinal + 1}`, at: Date.now(),
      } }))];
    const result = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
    assert.equal(result.seeded, rows.length, JSON.stringify(result));
    seeded += rows.length;
    if (n % 100 === 99) console.log(JSON.stringify({ groups: n + 1, seeded }));
  }
  let cursor, count = 0;
  do {
    const read = await client.query(q('messaging.inbox'), { c: cursor });
    assert.ok(read.data, JSON.stringify(read)); count += read.data.length; cursor = read.next;
  } while (cursor);
  assert.equal(count, 1000);
  console.log(JSON.stringify({ memberships: count, addedConversations: 900, messagesPerAddedConversation: 100, addedRows: seeded }));
} finally { await client.close(); }
