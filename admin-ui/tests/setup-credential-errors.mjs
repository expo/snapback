// Execute the embedded setup page's real inline program against a small DOM
// and adversarial HTTP receiver. This covers the fallback operator surface,
// not a reimplementation of its redaction helpers.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MASTER = 'master-setup-credential-SENTINEL';
const DERIVED = 'sbcc_setup-derived-SENTINEL';
const CONFIG_SECRET = 'setup-config-value-SENTINEL';
const UNKNOWN_ISSUED = 'sbcc_setup-unknown-non-2xx-successor-SENTINEL';
const UNKNOWN_FETCH_REJECTION = 'sbcc_setup-unknown-fetch-rejection-successor-SENTINEL';
const ORDINARY_FETCH_REJECTION = 'setup-ordinary-fetch-rejection-SENTINEL';
const SHORT_SECRETS = ['Q', 'QZ', 'QZX'];
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
let mintedCredential = DERIVED;
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
          [`reflected_${master}`]: 'property-name poison',
          adminToken: master,
        },
      });
    }
    if (mode === 'master-read-failure') {
      return {
        ok: true,
        status: 200,
        async text() {
          throw new Error(`reader exposed ${DERIVED}`);
        },
      };
    }
    if (mode === 'master-fetch-rejection') {
      const cause = new Error(`cause exposed ${UNKNOWN_FETCH_REJECTION}`);
      cause.code = `CAUSE_${UNKNOWN_FETCH_REJECTION}`;
      const error = new Error(
        `fetch rejected with ${master} and ${UNKNOWN_FETCH_REJECTION}`,
        { cause },
      );
      error.name = `Issuer${UNKNOWN_FETCH_REJECTION}`;
      error.code = `ISSUER_${UNKNOWN_FETCH_REJECTION}`;
      error.diagnostic = {
        code: `DIAGNOSTIC_${UNKNOWN_FETCH_REJECTION}`,
        message: UNKNOWN_FETCH_REJECTION,
        details: { successorCredential: UNKNOWN_FETCH_REJECTION },
      };
      error[`credential_${UNKNOWN_FETCH_REJECTION}`] = UNKNOWN_FETCH_REJECTION;
      throw error;
    }
    if (mode === 'master-non2xx-unknown') {
      return response(503, {
        diagnostic: {
          code: 'UPSTREAM_MINT_FAILED',
          message: `mint failed after issuing ${UNKNOWN_ISSUED}`,
          details: {
            successorCredential: UNKNOWN_ISSUED,
            [`credential_${UNKNOWN_ISSUED}`]: 'property-name poison',
          },
        },
      });
    }
    if (mode === 'master-key-poison') {
      return response(200, {
        credential: DERIVED,
        expiresAtMs: Date.now() + 60_000,
        [`reflected_${master}`]: 'property-name poison',
      });
    }
    if (mode === 'master-derived-collision') {
      return response(200, {
        credential: mintedCredential,
        expiresAtMs: Date.now() + 60_000,
      });
    }
    if (mode === 'master-expiry-collision') {
      return response(200, {
        credential: DERIVED,
        expiresAtMs: Number(master),
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
    if (mode === 'status-fetch-rejection') {
      const error = new Error(
        `ordinary fetch rejected with ${derived} and ${ORDINARY_FETCH_REJECTION}`,
      );
      error.code = `ORDINARY_${derived}_${ORDINARY_FETCH_REJECTION}`;
      throw error;
    }
    const status = {
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
    };
    if (mode === 'status-key-poison') {
      status[`reflected_${derived}`] = 'property-name poison';
    }
    return response(200, status);
  }
  if (path.endsWith('/config/set')) {
    const value = JSON.parse(options.body).value;
    if (mode === 'config-key-poison') {
      return response(200, { [`reflected_${value}`]: 'property-name poison' });
    }
    return response(500, {
      diagnostic: {
        code: 'SNAPBACK_CONFIG_SET_FAILED',
        message: `config receiver reflected ${value}`,
        [`reflected_${value}`]: 'property-name poison',
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
assert.equal(
  elements.get('authmsg').textContent,
  'Credential issuer returned an invalid response.',
);
assert.equal(storageContains(MASTER), false, 'master never enters setup storage');

for (const shortSecret of SHORT_SECRETS) {
  tokenInput.value = shortSecret;
  tokenSave.listeners.click();
  await flush();
  assertSecretAbsent(
    visibleText(),
    shortSecret,
    `${shortSecret.length}-byte master failure DOM`,
  );
  assert.equal(storageContains(shortSecret), false, 'short master never enters setup storage');
  assert.equal(
    elements.get('authmsg').textContent,
    'Credential issuer returned an invalid response.',
  );
}

mode = 'master-non2xx-unknown';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(
  elements.get('authmsg').textContent,
  'Credential issuer returned an invalid response.',
);
assertSecretAbsent(visibleText(), UNKNOWN_ISSUED, 'non-2xx mint successor DOM');
assertSecretAbsent(visibleText(), MASTER, 'non-2xx mint master DOM');
assert.equal(storage.has('snapback_console_credential_v1'), false);

// The exact credential response also rejects a successful property name that
// contains the submitted master token; only a fixed protocol error reaches DOM.
mode = 'master-key-poison';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assertSecretAbsent(visibleText(), MASTER, 'master success property-key DOM');
assert.match(elements.get('authmsg').textContent, /invalid response/i);
assert.equal(storageContains(MASTER), false, 'poisoned master key never enters setup storage');

mode = 'master-read-failure';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(
  elements.get('authmsg').textContent,
  'Credential issuer returned an invalid response.',
);
assertSecretAbsent(visibleText(), DERIVED, 'reader successor DOM');
assertSecretAbsent(visibleText(), MASTER, 'reader master DOM');
assert.equal(storage.has('snapback_console_credential_v1'), false);

mode = 'master-fetch-rejection';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(
  elements.get('authmsg').textContent,
  'Credential issuer returned an invalid response.',
);
assertSecretAbsent(visibleText(), UNKNOWN_FETCH_REJECTION, 'fetch rejection successor DOM');
assertSecretAbsent(visibleText(), MASTER, 'fetch rejection master DOM');
assert.equal(storage.has('snapback_console_credential_v1'), false);

for (const collision of [
  { master: 'QZX', minted: 'sbcc_QZX' },
  { master: 's', minted: 'sbcc_clean-console' },
]) {
  mode = 'master-derived-collision';
  mintedCredential = collision.minted;
  tokenInput.value = collision.master;
  tokenSave.listeners.click();
  await flush();
  assert.equal(
    elements.get('authmsg').textContent,
    'Console credential exchange returned an invalid response.',
  );
  assert.equal(
    storage.has('snapback_console_credential_v1'),
    false,
    'a derived credential containing its submitted master is never persisted',
  );
}
mintedCredential = DERIVED;

// ENG-24986: an all-numeric master reflected as the exact valid future
// `expiresAtMs` of an otherwise clean exchange is rejected before persistence;
// only the fixed protocol error reaches the DOM.
const NUMERIC_MASTER = String(Date.now() + 3_600_000);
mode = 'master-expiry-collision';
tokenInput.value = NUMERIC_MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(
  elements.get('authmsg').textContent,
  'Console credential exchange returned an invalid response.',
);
assert.equal(
  storage.has('snapback_console_credential_v1'),
  false,
  'a record whose expiresAtMs reflects the numeric master is never persisted',
);
assert.equal(storageContains(NUMERIC_MASTER), false, 'numeric master never enters setup storage');
assertSecretAbsent(visibleText(), NUMERIC_MASTER, 'numeric master expiry DOM');

mode = 'derived-failure';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assert.equal(storageContains(MASTER), false, 'successful exchange still does not persist master');
assert.equal(storageContains(DERIVED), true, 'setup persists only the short-lived derived credential');
assertSecretAbsent(visibleText(), DERIVED, 'derived failure DOM');
assert.match(elements.get('summary').textContent, /\[REDACTED\]/);

// Ordinary, non-issuer fetch rejections keep the request-secret sanitizer:
// redact the active credential, preserve unrelated diagnostics, and do not
// collapse to the credential issuer's fixed opaque error.
mode = 'status-fetch-rejection';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assertSecretAbsent(visibleText(), DERIVED, 'ordinary fetch rejection DOM');
assert.match(elements.get('summary').textContent, /\[REDACTED\]/);
assert.match(elements.get('summary').textContent, new RegExp(ORDINARY_FETCH_REJECTION));
assert.doesNotMatch(
  elements.get('summary').textContent,
  /Console credential exchange returned an invalid response\./,
);

// Successful arbitrary objects are also rejected when a property name carries
// the active derived credential. This is distinct from exact credential DTOs.
mode = 'status-key-poison';
tokenInput.value = MASTER;
tokenSave.listeners.click();
await flush();
assertSecretAbsent(visibleText(), DERIVED, 'derived success property-key DOM');
assert.match(elements.get('summary').textContent, /invalid response/i);

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

for (const shortSecret of SHORT_SECRETS) {
  configInput.value = shortSecret;
  setButton.listeners.click();
  await flush();
  assertSecretAbsent(
    visibleText(),
    shortSecret,
    `${shortSecret.length}-byte config failure DOM`,
  );
  assert.equal(storageContains(shortSecret), false, 'short config value never enters setup storage');
}

// ENG-24986: an all-numeric config value reflected by the receiver stays out
// of the DOM and setup storage like every other submitted config value.
const NUMERIC_CONFIG = '246813579';
configInput.value = NUMERIC_CONFIG;
setButton.listeners.click();
await flush();
assertSecretAbsent(visibleText(), NUMERIC_CONFIG, 'numeric config value failure DOM');
assert.equal(storageContains(NUMERIC_CONFIG), false, 'numeric config value never enters setup storage');

// A 200 response whose property name reflects the submitted config value is
// malformed success, not data the setup page may reinterpret or render.
mode = 'config-key-poison';
for (const shortSecret of SHORT_SECRETS) {
  configInput.value = shortSecret;
  setButton.listeners.click();
  await flush();
  assertSecretAbsent(
    visibleText(),
    shortSecret,
    `${shortSecret.length}-byte config success property-key DOM`,
  );
  const message = find(cards, (node) => String(node.className).includes('msg'))[0];
  assert.match(message.textContent, /invalid response/i);
}

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
