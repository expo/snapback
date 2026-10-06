// @ref LLP 3000.033#3 — faithful Phase-2 SB4 oracle: fresh Bob login,
// generated history query, full pagination, receipt state and chronological output.
// The protocol loop matches the Apartment mini's native-oracle.mjs (2026-10-05).
import { login } from 'snapback4/auth';
import { createClient } from 'snapback4/client';
import { pathToFileURL } from 'node:url';
const input = JSON.parse(await new Promise(resolve => {
  let data = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; }); process.stdin.on('end', () => resolve(data));
}));
if (input.protocol !== 'clique-native/1') throw Error('Unknown protocol');
const result = await login(input.origin, process.env.CLIQUE_BOB_EMAIL, process.env.CLIQUE_BOB_PASSWORD, { scope: 'read' });
if (!result.ok) throw Error(`${result.why.code}: ${result.why.message}`);
const session = result.session, client = createClient({ url: input.origin, session, readOnly: true });
const { api } = await import(pathToFileURL(process.env.CLIQUE_GENERATED_API));
try {
  const rows = []; let c = null, complete = true;
  do {
    const r = await client.query(api.apiHistory, { conversation: input.conversationId, c });
    if (!('data' in r)) throw Error(JSON.stringify(r));
    complete &&= r.complete;
    for (const m of r.data) rows.push({ messageId: m.id, body: m.text, orderKey: [m.ordinal, m.id], receiptState: m.receiptState });
    c = r.next ?? null;
  } while (c);
  rows.reverse();
  console.log(JSON.stringify({ principal: session.principal, origin: input.origin, conversationId: input.conversationId, complete, rows }));
} finally { await client.close(); }
