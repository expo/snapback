import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { loadMedia } from './services.mjs';
import { createWorkroomUI } from '../../fixtures/team-workspace/ui/kit.mjs';

test('committed media are structurally valid PNG and PDF, not just hash-matching bytes', async () => {
  const [pdf, png] = await loadMedia();
  const text = pdf.data.toString();
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n/gm)].map(m => Number(m[1]));
  for (let i = 0; i < offsets.length; i++) assert.ok(text.slice(offsets[i]).startsWith(`${i + 1} 0 obj`));
  assert.equal(png.data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const chunks = [];
  for (let i = 8; i < png.data.length;) {
    const length = png.data.readUInt32BE(i), type = png.data.toString('ascii', i + 4, i + 8);
    assert.equal(crc32(png.data.subarray(i + 4, i + 8 + length)), png.data.readUInt32BE(i + 8 + length));
    if (type === 'IDAT') chunks.push(png.data.subarray(i + 8, i + 8 + length));
    i += length + 12;
  }
  assert.equal(inflateSync(Buffer.concat(chunks)).length, 3);
});

test('UI forwards controlled values and row order without filtering, storage or auth state', () => {
  // Inspect React element props directly; React DOM rendering is checked separately when installed.
  const React = { createElement(type, props, ...children) {
    return typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(Infinity) };
  }};
  const ui = createWorkroomUI(React), flatten = node => [node, ...(node?.children ?? []).flatMap(flatten)];
  const calls = [];
  const tree = ui.Tasks({ tasks: [{ id: 'b', title: 'Second', status: 'blocked' }, { id: 'a', title: 'First', status: 'open' }],
    status: 'blocked', assignee: 'owner', statusOptions: [{ value: 'blocked', label: 'Blocked' }], assigneeOptions: [],
    onStatus: value => calls.push(value), onAssignee() {}, onOpen: id => calls.push(id), onNext() {}, onPrevious() {},
    hasNext: true, hasPrevious: false, onCreate() {} });
  const nodes = flatten(tree), byId = id => nodes.find(n => n?.props?.['data-testid'] === id);
  assert.equal(byId('task-filter-status').props.value, 'blocked');
  byId('task-filter-status').props.onChange({ target: { value: 'open' } });
  byId('open-task-a').props.onClick();
  assert.deepEqual(calls, ['open', 'a']);
  assert.equal(byId('tasks-previous').props.disabled, true);
  assert.ok(nodes.indexOf(byId('task-list-row-b')) < nodes.indexOf(byId('task-list-row-a')));
});

test('React DOM server renders real kit components when the application React peer is available', async t => {
  const require = createRequire(resolve(process.env.WORKROOM_REACT_ROOT ?? '.', 'package.json'));
  let React, render;
  try { React = require('react'); render = require('react-dom/server').renderToStaticMarkup; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; t.skip('React peer not installed; set WORKROOM_REACT_ROOT to an existing React application'); return; }
  const { Shell, Report } = createWorkroomUI(React);
  const html = render(React.createElement(Shell, { organizationName: 'Acme', accountName: 'Owner', sections: [], activeSection: '', onNavigate() {}, onSignOut() {} },
    React.createElement(Report, { rows: [{ id: 'owner', name: 'Owner', open: 3, overdue: 2, attachmentBytes: 601 }], onExport() {} })));
  assert.match(html, /data-testid="report-table"/); assert.match(html, /601/); assert.match(html, /Export CSV/);
});
