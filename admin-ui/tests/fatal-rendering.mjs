import assert from 'node:assert/strict';

import { renderFatal } from '../fatal.mjs';

const root = {
  children: [],
  replaceChildren(...children) {
    this.children = children;
  },
};
const document = {
  getElementById(id) {
    return id === 'exact-root' ? root : null;
  },
  createElement(tagName) {
    return { tagName, style: {}, textContent: '' };
  },
};
const hostile = '</pre><img src=x onerror="globalThis.stolen=localStorage.token">&lt;script&gt;';

assert.equal(renderFatal(document, hostile), true);
assert.equal(root.children.length, 1);
assert.equal(root.children[0].tagName, 'pre');
assert.equal(
  root.children[0].textContent,
  `Admin console failed to start:\n${hostile}`,
);
assert.equal('innerHTML' in root.children[0], false);

console.log('admin-ui fatal rendering: hostile response text stays text');
