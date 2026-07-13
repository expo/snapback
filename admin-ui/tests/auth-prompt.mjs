import assert from 'node:assert/strict';

import {
  renderAdminTokenPrompt,
  renderSessionCredentialsPrompt,
} from '../auth-prompt.mjs';

function element(tagName) {
  return {
    tagName,
    style: {},
    textContent: '',
    value: '',
    children: [],
    listeners: {},
    append(...children) { this.children.push(...children); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() {},
    select() {},
  };
}

const root = element('root');
root.replaceChildren = (...children) => { root.children = children; };
const document = {
  getElementById(id) { return id === 'exact-root' ? root : null; },
  createElement: element,
};
const hostile = '<img src=x onerror="globalThis.stolen=localStorage.token">';
let submitted = null;
assert.equal(
  renderAdminTokenPrompt(document, {
    message: hostile,
    onSubmit: async (token) => { submitted = token; },
  }),
  true,
);
const panel = root.children[0];
const input = panel.children[2];
const error = panel.children[4];
assert.equal(error.textContent, hostile);
assert.equal('innerHTML' in panel, false);
input.value = '  secret-token  ';
await panel.listeners.submit({ preventDefault() {} });
assert.equal(submitted, 'secret-token');

let sessionCredentials = null;
assert.equal(
  renderSessionCredentialsPrompt(document, {
    message: hostile,
    onSubmit: async (credentials) => { sessionCredentials = credentials; },
  }),
  true,
);
const sessionPanel = root.children[0];
const admin = sessionPanel.children[2];
const lease = sessionPanel.children[3];
const sessionError = sessionPanel.children[5];
assert.equal(sessionError.textContent, hostile);
assert.equal('innerHTML' in sessionPanel, false);
admin.value = '  master-token  ';
lease.value = '  sbrl_memory-only  ';
await sessionPanel.listeners.submit({ preventDefault() {} });
assert.deepEqual(sessionCredentials, {
  adminToken: 'master-token',
  secretReadLease: 'sbrl_memory-only',
});
assert.equal(admin.value, '', 'master input is cleared before awaiting');
assert.equal(lease.value, '', 'lease input is cleared before awaiting');

console.log('admin-ui auth prompts keep errors as text and clear submitted secrets');
