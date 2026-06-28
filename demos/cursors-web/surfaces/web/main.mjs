import { EphemeralOverlay, SnapbackClient } from '../../../_kit/client.mjs';
import { ephemeral } from '../../snapback/generated/api.mjs';

const board = document.getElementById('board');
const statusEl = document.getElementById('status');
const localBadge = document.getElementById('localBadge');
const cursorsEl = document.getElementById('cursors');
const params = new URL(location.href).searchParams;
const serverBaseUrl = params.get('server') || 'http://127.0.0.1:4411';
const roomId = params.get('room') || 'main';
const client = new SnapbackClient(serverBaseUrl);
const scope = { roomId };
const connectionId = stableSessionValue('snapback.cursor.connectionId', () => `cursor_${crypto.randomUUID()}`);
const profile = stableProfile();
let overlay = null;
let stream = null;
let latestLocal = null;
let lastPublishMs = 0;
let pendingPoint = null;
let publishTimer = 0;
let requestSeq = 0;
const latencyByKey = new Map();
const latencySamples = [];

localBadge.textContent = profile.name;
localBadge.style.borderColor = profile.color;

const ready = boot().catch((error) => {
  setStatus(`Error: ${error.diagnostic?.code || error.message}`, 'error');
  throw error;
});

window.cursorDemo = {
  ready,
  connectionId,
  profile,
  moveTo,
  state: () => ({
    connectionId,
    profile,
    entries: overlay?.currentEntries() ?? [],
    latency: latencyStats(),
    status: statusEl.dataset.state,
  }),
};

board.addEventListener('pointermove', (event) => {
  moveTo(event.clientX, event.clientY);
});

window.addEventListener('pagehide', () => {
  try {
    stream?.sendJson({
      type: 'ephemeral_delete',
      requestId: nextRequestId('delete'),
      request: requestBase(),
    });
  } catch {
    // Best effort; WebSocket close cleanup is authoritative on the server.
  }
});

async function boot() {
  setStatus('Connecting', 'booting');
  const schema = await fetch('../../snapback/generated/schema.manifest.json').then((res) => {
    if (!res.ok) throw new Error(`schema manifest fetch failed: ${res.status}`);
    return res.json();
  });
  await client.ensureEphemeralCollections(schema);

  overlay = new EphemeralOverlay(client, ephemeral.webCursors, {
    connectionId,
    scope,
    snapshot: null,
  });
  stream = client.openLiveStream(connectionId);
  await stream.ready;
  stream.sendJson({
    type: 'ephemeral_subscribe',
    requestId: nextRequestId('subscribe'),
    request: requestBase(),
  });

  readLoop();
  setStatus('Connected', 'ready');
}

async function readLoop() {
  while (stream) {
    try {
      const message = await stream.nextUpdate(30_000);
      applyServerMessage(message);
    } catch (error) {
      if (String(error.message || '').includes('timed out waiting for Snapback live stream update')) {
        continue;
      }
      if (statusEl.dataset.state !== 'error') {
        setStatus(`Stream closed: ${error.message}`, 'error');
      }
      return;
    }
  }
}

function applyServerMessage(message) {
  if (message.kind === 'ephemeral_error') {
    setStatus(message.diagnostic?.code || 'Ephemeral error', 'error');
    return;
  }
  if (message.kind === 'ephemeral_ack' && message.message) {
    overlay.apply(message.message);
    render();
    return;
  }
  if (message.kind === 'ephemeral' && message.message) {
    recordLatency(message.message);
    overlay.apply(message);
    render();
  }
}

function moveTo(clientX, clientY) {
  const rect = board.getBoundingClientRect();
  const x = clamp((clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((clientY - rect.top) / rect.height, 0, 1);
  latestLocal = {
    key: connectionId,
    value: {
      x,
      y,
      name: profile.name,
      color: profile.color,
      updatedAt: Date.now(),
    },
    expiresAtMs: Date.now() + 5_000,
  };
  pendingPoint = latestLocal.value;
  render();
  schedulePublish();
}

function schedulePublish() {
  const now = performance.now();
  const wait = Math.max(0, 55 - (now - lastPublishMs));
  if (wait === 0) {
    publishPending();
    return;
  }
  if (!publishTimer) {
    publishTimer = window.setTimeout(() => {
      publishTimer = 0;
      publishPending();
    }, wait);
  }
}

function publishPending() {
  if (!stream || !pendingPoint) return;
  const value = pendingPoint;
  pendingPoint = null;
  lastPublishMs = performance.now();
  stream.sendJson({
    type: 'ephemeral_publish',
    requestId: nextRequestId('publish'),
    request: {
      ...requestBase(),
      value: [...new TextEncoder().encode(JSON.stringify(value))],
      ttl_ms: 5_000,
    },
  });
}

function render() {
  const entries = new Map();
  if (overlay) {
    for (const entry of overlay.currentEntries()) {
      entries.set(entry.key, entry);
    }
  }
  if (latestLocal) entries.set(connectionId, latestLocal);

  const liveKeys = new Set(entries.keys());
  for (const node of [...cursorsEl.querySelectorAll('.cursor')]) {
    if (!liveKeys.has(node.dataset.cursorKey)) node.remove();
  }

  const width = board.clientWidth;
  const height = board.clientHeight;
  for (const [key, entry] of entries) {
    const value = entry.value || {};
    const node = ensureCursorNode(key);
    const x = Math.round(clamp(Number(value.x) || 0, 0, 1) * width);
    const y = Math.round(clamp(Number(value.y) || 0, 0, 1) * height);
    const color = typeof value.color === 'string' ? value.color : '#4763d8';
    const name = typeof value.name === 'string' ? value.name : key;
    const latencyMs = latencyByKey.get(key);
    node.style.setProperty('--x', `${x}px`);
    node.style.setProperty('--y', `${y}px`);
    node.style.setProperty('--color', color);
    node.dataset.name = name;
    node.dataset.x = String(x);
    node.dataset.y = String(y);
    if (Number.isFinite(latencyMs)) {
      node.dataset.latencyMs = String(latencyMs);
      node.querySelector('.cursor-label').textContent = `${name} ${latencyMs}ms`;
    } else {
      delete node.dataset.latencyMs;
      node.querySelector('.cursor-label').textContent = name;
    }
  }
}

function recordLatency(message) {
  const upsert = message?.Upsert;
  if (!upsert?.entry) return;
  const value = decodeEntryValue(upsert.entry);
  const sentAt = Number(value?.updatedAt);
  if (!Number.isFinite(sentAt)) return;
  const latencyMs = Math.max(0, Math.round(Date.now() - sentAt));
  latencyByKey.set(upsert.entry.key, latencyMs);
  latencySamples.push(latencyMs);
  if (latencySamples.length > 200) latencySamples.shift();
}

function decodeEntryValue(entry) {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(entry.value ?? []));
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function latencyStats() {
  if (latencySamples.length === 0) {
    return { count: 0, lastMs: null, avgMs: null, p95Ms: null };
  }
  const sorted = [...latencySamples].sort((a, b) => a - b);
  const sum = latencySamples.reduce((total, value) => total + value, 0);
  return {
    count: latencySamples.length,
    lastMs: latencySamples.at(-1),
    avgMs: Math.round(sum / latencySamples.length),
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

function ensureCursorNode(key) {
  const selector = `.cursor[data-cursor-key="${CSS.escape(key)}"]`;
  let node = cursorsEl.querySelector(selector);
  if (node) return node;
  node = document.createElement('div');
  node.className = 'cursor';
  node.dataset.cursorKey = key;
  node.dataset.testid = `cursor-${key}`;
  const label = document.createElement('div');
  label.className = 'cursor-label';
  node.append(label);
  cursorsEl.append(node);
  return node;
}

function requestBase() {
  return {
    collection: ephemeral.webCursors.name,
    scope,
    connection_id: connectionId,
    session_id: null,
    user_id: null,
    custom_key: null,
    auth: SnapbackClient.auth(null),
  };
}

function stableProfile() {
  return stableSessionValue('snapback.cursor.profile', () => {
    const names = ['Ada', 'Grace', 'Linus', 'Katherine', 'Margaret', 'Donald', 'Evelyn', 'Ken'];
    const colors = ['#d94841', '#227a5f', '#2f64cf', '#a5489b', '#b36a13', '#187487', '#6847c6', '#347a24'];
    const index = Math.floor(Math.random() * names.length);
    return {
      name: `${names[index]} ${Math.floor(100 + Math.random() * 900)}`,
      color: colors[index % colors.length],
    };
  });
}

function stableSessionValue(key, create) {
  const existing = sessionStorage.getItem(key);
  if (existing) return JSON.parse(existing);
  const value = create();
  sessionStorage.setItem(key, JSON.stringify(value));
  return value;
}

function nextRequestId(operation) {
  requestSeq += 1;
  return `${connectionId}:${operation}:${requestSeq}`;
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
