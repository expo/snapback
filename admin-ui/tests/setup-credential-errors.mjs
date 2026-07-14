// Execute the embedded setup page's real inline program against a small DOM
// and adversarial HTTP receiver. This covers the fallback operator surface,
// not a reimplementation of its redaction helpers.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MASTER = 'master-setup-credential-SENTINEL';
const DERIVED = 'sbcc_setup-derived-SENTINEL';
const CONFIG_SECRET = 'setup-config-value-SENTINEL';
const html = fs.readFileSync(new URL('../../src/admin/setup.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'setup page has one executable inline program');

const elements = new Map();
for (const id of ['posture', 'summary', 'auth', 'authmsg', 'tokenInput', 'tokenSave', 'cards']) {
  elements.set(id, element(id === 'tokenInput' ? 'input' : id === 'tokenSave' ? 'button' : 'div', id));
}
const document = {
  querySelector(selector) {
    return selector.startsWith('#') ? elements.get(selector.slice(1)) ?? null : null;
  },
  createElement(tagName) { return element(tagName); },
  createTextNode(text) {
    const node = element('#text');
    node.textContent = text;
    return node;
  },
};

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

let mode = 'initial';
const requests = [];
async function fetch(path, options = {}) {
  requests.push({ path, options });
  if (path.endsWith('/console/credential')) {
    const master = options.headers['x-snapback-admin-token'];
    if (mode === 'master-failure') {
      return response(401, {
        diagnostic: {
          code: 'SNAPBACK_ADMIN_TOKEN_REQUIRED',
          message: `receiver reflected ${master}`,
          adminToken: master,
        },
      });
    }
    return response(200, {
      credential: DERIVED,
      expiresAtMs: Date.now() + 60_000,
    });
  }
  if (path.endsWith('/config/status')) {
    const derived = options.headers?.['x-snapback-console-credential'];
    if (mode === 'initial') {
      return response(401, {
        diagnostic: {
          code: 'SNAPBACK_ADMIN_TOKEN_REQUIRED',
          message: 'Admin token required.',
        },
      });
    }
    if (mode === 'derived-failure') {
      return response(502, {
        diagnostic: {
          code: 'SNAPBACK_UPSTREAM_FAILED',
          message: `proxy reflected ${derived}`,
          consoleCredential: derived,
        },
      });
    }
    return response(200, {
      appProvisioned: true,
      requiredMissing: ['API_KEY'],
      entries: [{
        name: 'API_KEY',
        required: true,
        set: false,
        pool: false,
        verified: null,
        description: null,
        purpose: null,
        howToGet: null,
        acquisition: null,
        probe: null,
        lastChangedMs: null,
        source: null,
      }],
    });
  }
  if (path.endsWith('/config/set')) {
    const value = JSON.parse(options.body).value;
    return response(500, {
      diagnostic: {
        code: 'SNAPBACK_CONFIG_SET_FAILED',
        message: `config receiver reflected ${value}`,
        value,
      },
    });
  }
  if (path.endsWith('/inspect')) return response(200, { admin: null });
  assert.fail(`unexpected setup request: ${path}`);
}

vm.runInContext(script, vm.createContext({
  document,
  localStorage,
  fetch,
  Date,
  Number,
  JSON,
  Object,
  Array,
  String,
  Error,
  Boolean,
}), { filename: 'snapback-setup-inline.js' });
await flush();

const tokenInput = elements.get('tokenInput');
const tokenSave = elements.get('tokenSave');
mode = 'master-failure';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assertSecretAbsent(visibleText(), MASTER, 'master failure DOM');
assert.match(elements.get('authmsg').textContent, /\[REDACTED\]/);
assert.equal(storageContains(MASTER), false, 'master never enters setup storage');

mode = 'derived-failure';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(storageContains(MASTER), false, 'successful exchange still does not persist master');
assert.equal(storageContains(DERIVED), true, 'setup persists only the short-lived derived credential');
assertSecretAbsent(visibleText(), DERIVED, 'derived failure DOM');
assert.match(elements.get('summary').textContent, /\[REDACTED\]/);

// A second successful exchange drives a successful refresh and renders a real
// config card. Its submitted value becomes another request-scoped secret.
mode = 'config-failure';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
const cards = elements.get('cards');
assert.equal(cards.children.length, 1, 'successful refresh renders the config card');
const configInput = find(cards, (node) => node.tagName === 'input')[0];
const setButton = find(cards, (node) => node.tagName === 'button' && node.textContent === 'Set')[0];
assert.ok(configInput && setButton, 'config controls are present');
configInput.value = CONFIG_SECRET;
setButton.listeners.click();
await flush();
assertSecretAbsent(visibleText(), CONFIG_SECRET, 'config value failure DOM');
assert.equal(storageContains(CONFIG_SECRET), false, 'config value never enters setup storage');

assert.equal(
  requests.some(({ path, options }) => (
    path.endsWith('/config/status')
    && options.headers?.['x-snapback-console-credential'] === DERIVED
  )),
  true,
  'derived credential is intentionally carried only in the request header',
);

console.log('setup credential errors: master, derived, and config values stay out of UI errors');

function element(tagName, id = '') {
  let ownText = '';
  const node = {
    tagName,
    id,
    className: '',
    hidden: false,
    disabled: false,
    value: '',
    children: [],
    listeners: {},
    attributes: new Map(),
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'class') this.className = String(value);
      if (name === 'hidden') this.hidden = true;
      if (name === 'type') this.type = String(value);
    },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  };
  Object.defineProperty(node, 'textContent', {
    get() { return ownText; },
    set(value) {
      ownText = String(value ?? '');
      if (ownText === '') node.children = [];
    },
  });
  return node;
}

function find(root, predicate) {
  const found = predicate(root) ? [root] : [];
  for (const child of root.children) found.push(...find(child, predicate));
  return found;
}

function visibleText() {
  return [...elements.values()].map((node) => textTree(node)).join('\n');
}

function textTree(node) {
  return [node.textContent, ...node.children.map(textTree)].join(' ');
}

function storageContains(secret) {
  return JSON.stringify([...storage.entries()]).includes(secret);
}

function assertSecretAbsent(value, secret, label) {
  assert.equal(String(value).includes(secret), false, `${label} must not retain the secret`);
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
