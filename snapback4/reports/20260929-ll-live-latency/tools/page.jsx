import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalClient } from 'snapback4/local';
import { webDevice } from 'snapback4/web';
import { SnapbackProvider, useQuery, usePage, useAsset } from 'snapback4/react';

const queries = new Map();
const q = name => { if (!queries.has(name)) queries.set(name, { kind: 'query', name }); return queries.get(name); };
let client, expected, trial, root;
window.events = [];
const now = () => performance.timeOrigin + performance.now();
const mark = (stage, detail = {}) => window.events.push({ stage, at: now(), ...detail });
const fetchTrace = async (input, init) => {
  const path = new URL(input).pathname;
  const id = crypto.randomUUID();
  mark('request', { path, id });
  const response = await fetch(input, init);
  mark('headers', { path, id, status: response.status, timing: response.headers.get('server-timing') });
  if (!response.body || !(path === '/changes' || path === '/sync' || path.startsWith('/q/') || path.startsWith('/m/'))) return response;
  let body = '';
  const decoder = new TextDecoder();
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { body += decoder.decode(chunk, { stream: true }); controller.enqueue(chunk); },
    flush() {
      let json; try { json = JSON.parse(body + decoder.decode()); } catch {}
      mark('response', { path, id, bytes: body.length, seq: json?.seq, watermark: json?.watermark, tables: json?.tables, state: json?.state });
    },
  }));
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
};
function match(name, data) {
  if (!expected || name !== expected.query) return false;
  if (expected.query === 'profile') return data?.name === expected.value;
  if (expected.query === 'reactionRows') return expected.value === null ? Array.isArray(data) && data.length === 0 : data?.some(x => x.emoji === expected.value);
  if (expected.query === 'receipts') return data?.some(x => x.id === 'anchor' && x.seen === expected.value);
  return Array.isArray(data) && data.some(x => x.id === expected.value);
}
function publish(name, read, stage) {
  if ('data' in read && !read.revalidating && match(name, read.data)) {
    if (!trial[stage]) { trial[stage] = now(); mark(stage, { flow: expected.flow }); }
  }
}
function Asset({ row }) {
  const id = row.photo?.id ?? row.oncePhoto?.id;
  const asset = useAsset(id);
  useLayoutEffect(() => { if (asset.url && expected?.value === row.id) { trial.assetHandle ??= now(); mark('asset-handle', { row: row.id }); } }, [asset.url]);
  return asset.url ? <img src={asset.url} onLoad={() => { if (expected?.value === row.id) { trial.assetReady ??= now(); mark('asset-ready', { row: row.id }); } }} /> : null;
}
function Quote({ id, rowId }) {
  const r = useQuery(q('message'), { id });
  useLayoutEffect(() => { if (r.data?.text && expected?.value === rowId) { trial.quoteReady ??= now(); mark('quote-ready', { row: rowId }); } });
  return <a data-quote={rowId} href={'#' + id}>{r.data?.text}</a>;
}
function Bubble({ row }) {
  const reactions = useQuery(q('reactionRows'), { message: row.id, c: null });
  useLayoutEffect(() => { if (row.id === 'anchor') publish('reactionRows', reactions, 'reactCommit'); });
  return <div id={row.id}>{row.text}{JSON.stringify(reactions.data)}{row.quote && <Quote id={row.quote} rowId={row.id} />}{(row.photo || row.oncePhoto) && <Asset row={row} />}</div>;
}
function Screen({ principal }) {
  const profile = useQuery(q('profile'), { principal });
  const history = usePage(q('history'), { room: 'room' });
  const feed = usePage(q('feed'), {});
  const receipts = useQuery(q('receipts'), { room: 'room', c: null });
  useLayoutEffect(() => {
    publish('profile', profile, 'reactCommit'); publish('history', history.read, 'reactCommit');
    publish('feed', feed.read, 'reactCommit'); publish('receipts', receipts, 'reactCommit');
  });
  return <main><span>{profile.data?.name}</span>{history.items.map(row => <Bubble key={row.id} row={row} />)}{feed.items.map(row => <div key={row.id}>{row.text}{row.photo && <Asset row={row} />}</div>)}</main>;
}
window.openClient = async ({ url, session, tier, principal, receiver, retention = 'none' }) => {
  if (tier === 'process' && !receiver) {
    client = { mutate: (op, args) => window.senderBridge({ method: 'mutate', op, args }), upload: async blob => window.senderBridge({ method: 'upload', bytes: [...new Uint8Array(await blob.arrayBuffer())] }) };
    return;
  }
  const underlying = tier === 'wasm' ? webDevice() : { async open(name, backend) {
    await window.deviceBridge({ method: 'open', name, backend });
    return { call: request => window.deviceBridge({ method: 'call', request }), close: () => window.deviceBridge({ method: 'close' }) };
  } };
  const device = { async open(...args) {
    const core = await underlying.open(...args);
    const call = core.call.bind(core);
    core.call = async (request, committed) => {
      const { op, name } = request;
      mark('device-start', { op, name });
      const result = await call(request, value => { mark('device-commit', { op, name, touched: value.ok?.touched }); committed?.(value); });
      mark('device-end', { op, name, tables: result.ok?.tables, touched: result.ok?.touched, watermark: request.page?.watermark, complete: result.ok?.complete, unknown: result.ok?.unknown, args: op === 'query' ? request.args : undefined });
      return result;
    };
    return core;
  } };
  client = await createLocalClient({ url, session, device, fetch: fetchTrace, assets: { keep: retention, maxBytes: retention === 'viewed' ? 67108864 : 0 } });
  window.client = client;
  await client.sync();
  if (receiver) {
    for (const [name, args] of [['profile', { principal }], ['history', { room: 'room', c: null }], ['feed', { c: null }], ['reactionRows', { message: 'anchor', c: null }], ['receipts', { room: 'room', c: null }]]) {
      const watch = client.observe(q(name), args);
      watch.subscribe(() => publish(name, watch.getSnapshot(), 'published'));
    }
    root = createRoot(document.getElementById('root'));
    root.render(<SnapbackProvider client={client}><Screen principal={principal} /></SnapbackProvider>);
  }
};
window.prepare = value => { expected = value; trial = {}; window.events = []; };
window.trial = () => trial;
window.perform = async ({ flow, value, ordinal }) => {
  mark('sender-call', { flow });
  let name, args;
  if (flow.startsWith('reaction')) { name = 'setReaction'; args = { message: 'anchor', emoji: value }; }
  if (flow === 'profile') { name = 'editProfile'; args = { name: value }; }
  if (flow === 'receipt') { name = 'seen'; args = { room: 'room', ordinal }; }
  if (['photo', 'feed-image', 'once-photo', 'reply'].includes(flow)) {
    let photo = null;
    if (flow !== 'reply') {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(256, 256);
      for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = Math.random() * 255; pixels.data[i+1] = Math.random() * 255; pixels.data[i+2] = Math.random() * 255; pixels.data[i+3] = 255; }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      mark('upload-start', { bytes: blob.size });
      const uploaded = await client.upload(blob);
      if (!uploaded.ok) throw Error(JSON.stringify(uploaded));
      photo = uploaded.asset; mark('upload-end', { bytes: blob.size });
    }
    name = flow === 'feed-image' ? 'post' : 'send';
    args = name === 'post' ? { id: value, text: value, photo } : { id: value, room: 'room', ordinal, text: value, quote: flow === 'reply' ? 'anchor' : null, photo: flow === 'once-photo' ? null : photo, oncePhoto: flow === 'once-photo' ? photo : null };
  }
  const write = await client.mutate({ kind: 'mutation', name }, args);
  mark('sender-return', { flow, state: write.state });
  if (write.state !== 'sent') throw Error(JSON.stringify(write));
  return write;
};
