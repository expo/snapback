import assert from 'node:assert/strict';

import { renderAdminTokenPrompt } from '../auth-prompt.mjs';

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

console.log('admin-ui auth prompt keeps errors as text and submits the token');
