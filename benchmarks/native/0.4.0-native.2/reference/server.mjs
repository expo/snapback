import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [store, portText] = process.argv.slice(2), port = Number(portText);
fs.mkdirSync(store, { recursive: true });
const file = path.join(store, 'db.json');
let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { users: {}, rows: [], assets: {}, conversations: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(db));
const sessions = new Map();
const fault = process.env.NI_FAULT ?? 'none'; // Qualification only; each fault alters ordinary app/server behavior.
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let text = ''; for await (const chunk of req) text += chunk;
    const data = text ? JSON.parse(text) : {};
    const reply = (value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(new URL('bob.html', import.meta.url))); return; }
    if (url.pathname === '/health') return reply({ alive: true });
    if (url.pathname === '/register') {
      if (db.users[data.email]) return reply({ error: 'exists' }, 409);
      const id = crypto.randomUUID(); db.users[data.email] = { id, hash: hash(data.password) }; save(); return reply({ id });
    }
    if (url.pathname === '/login') {
      const user = db.users[data.email];
      if (!user || user.hash !== hash(data.password)) return reply({ error: 'credentials' }, 401);
      const token = crypto.randomUUID(); sessions.set(token, user.id);
      return reply({ token, principal: user.id, fault });
    }
    const principal = sessions.get(req.headers.authorization?.replace('Bearer ', ''));
    if (!principal) return reply({ error: 'unauthorized' }, 401);
    if (url.pathname === '/conversations' && req.method === 'POST') {
      const conversationId = crypto.randomUUID(); db.conversations.push({ conversationId, members: [principal, data.bob], value: 'dm:bob', counter: 0 }); save(); return reply({ conversationId });
    }
    if (url.pathname === '/conversations') return reply(db.conversations.filter(x => x.members.includes(principal)));
    const conversationId = data.conversationId || url.searchParams.get('conversationId');
    const convo = db.conversations.find(x => x.conversationId === conversationId && x.members.includes(principal));
    if (!convo) return reply({ error: 'conversation' }, 403);
    if (url.pathname === '/assets' && req.method === 'POST') {
      const assetId = crypto.randomUUID(); db.assets[assetId] = { bytes: data.bytes, once: !!data.once, consumed: false, conversationId }; save(); return reply({ assetId });
    }
    if (url.pathname === '/asset') {
      const asset = db.assets[url.searchParams.get('id')];
      if (!asset || asset.conversationId !== conversationId || (asset.once && asset.consumed)) return reply({ error: 'denied' }, 403);
      if (asset.once) { asset.consumed = true; save(); }
      return reply({ bytes: asset.bytes });
    }
    if (url.pathname === '/send') {
      if (data.assetId != null && db.assets[data.assetId]?.conversationId !== conversationId) return reply({ error: 'denied' }, 403);
      let row = db.rows.find(x => x.messageId === data.messageId && x.conversationId === conversationId && x.author === principal);
      if (!row) {
        row = { messageId: data.messageId || crypto.randomUUID(), conversationId, body: data.body, author: principal,
          assetId: data.assetId ?? null, once: !!data.once, receiptState: 'sent', orderKey: [++convo.counter] };
        if (fault === 'reversed-sends' && data.body.includes(':')) row.orderKey = [-convo.counter];
        db.rows.push(row);
        if (fault === 'duplicate-sends' && data.body.includes(':')) db.rows.push({ ...row, messageId: crypto.randomUUID(), orderKey: [++convo.counter] });
        save();
      }
      return reply(row);
    }
    if (url.pathname === '/history') {
      const all = db.rows.filter(x => x.conversationId === conversationId).sort((a,b) => a.orderKey[0] - b.orderKey[0]);
      const offset = Number(url.searchParams.get('offset') || 0), limit = 100;
      const rows = all.slice(offset, offset + limit).map(row => ({...row, consumed: row.once && db.assets[row.assetId]?.conversationId === conversationId ? !!db.assets[row.assetId].consumed : false}));
      return reply({ principal, conversationId, rows, next: offset + limit < all.length ? offset + limit : null });
    }
    if (url.pathname === '/read') {
      for (const row of db.rows) if (fault !== 'wrong-receipts' && row.conversationId === conversationId && row.author !== principal) row.receiptState = 'read';
      save(); return reply({ conversationId });
    }
    return reply({ error: 'not-found' }, 404);
  } catch { res.writeHead(500); res.end('{}'); }
});
server.listen(port, '127.0.0.1');
