import assert from 'node:assert/strict';
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { SnapbackProvider } from './index.mjs';

const loadingClient = Object.freeze({
  client: Object.freeze({
    prepareReactBinding: () => new Promise(() => {}),
  }),
  auth: Object.freeze({
    currentPrincipal: () => Object.freeze({ status: 'loading' }),
    subscribeCurrentPrincipal: () => () => {},
  }),
  bootstrapState: () => Object.freeze({ status: 'starting', stage: 'custody' }),
  subscribeBootstrap: () => () => {},
  async dispose() {},
});

const tree = React.createElement(
  SnapbackProvider,
  { appClient: loadingClient },
  React.createElement('span', null, 'ready'),
);
const html = renderToString(tree);
assert.equal(html, '', 'the official provider withholds children while its client is loading');

const noop = () => {};
const document = {
  nodeType: 9,
  addEventListener: noop,
  removeEventListener: noop,
};
const container = {
  nodeType: 1,
  nodeName: 'DIV',
  tagName: 'DIV',
  namespaceURI: 'http://www.w3.org/1999/xhtml',
  ownerDocument: document,
  addEventListener: noop,
  removeEventListener: noop,
  firstChild: null,
  lastChild: null,
};
document.documentElement = container;
document.defaultView = globalThis;

const priorWindow = globalThis.window;
const priorDocument = globalThis.document;
const priorFrame = globalThis.HTMLIFrameElement;
globalThis.window = globalThis;
globalThis.document = document;
globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};

const recoverableErrors = [];
try {
  const root = hydrateRoot(container, tree, {
    onRecoverableError(error) { recoverableErrors.push(error); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(recoverableErrors, [], 'official loading projection hydrates without mismatch');
  root.unmount();
  await new Promise((resolve) => setImmediate(resolve));
} finally {
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
  if (priorFrame === undefined) delete globalThis.HTMLIFrameElement;
  else globalThis.HTMLIFrameElement = priorFrame;
}

console.log('ssr-hydration.test.mjs: official loading provider render/hydration snapshots match');
