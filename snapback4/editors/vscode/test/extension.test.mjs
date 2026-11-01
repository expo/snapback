import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
function extension() {
  const events = {}, messages = [], executions = [];
  const subscribe = name => callback => { events[name] = callback; return { dispose() {} }; };
  const folder = { uri: { fsPath: '/workspace', toString: () => 'workspace' } };
  const vscode = {
    workspace: { workspaceFolders: [folder], getConfiguration: () => ({ get: (_, fallback) => fallback }), getWorkspaceFolder: () => folder, onDidSaveTextDocument: subscribe('save') },
    commands: { registerCommand: (_, callback) => subscribe('command')(callback) },
    tasks: { registerTaskProvider: () => ({ dispose() {} }), onDidEndTask: subscribe('end'), onDidEndTaskProcess: subscribe('process'), executeTask: async task => { const execution = { task }; executions.push(execution); return execution; } },
    window: { showErrorMessage: message => messages.push(message) },
    Task: class { constructor(definition, scope) { this.definition = definition; this.scope = scope; } },
    ProcessExecution: class {}, TaskGroup: { Build: 1 }, TaskRevealKind: { Silent: 1 }, TaskPanelKind: { Dedicated: 1 },
  };
  const exports = {};
  vm.runInNewContext(readFileSync(new URL('../extension.cjs', import.meta.url), 'utf8'), { exports, require: name => name === 'vscode' ? vscode : name === 'node:path' ? path : { readdirSync: () => ['schema.q'] } });
  exports.activate({ subscriptions: [], asAbsolutePath: name => name });
  return { events, messages, executions };
}
for (const [name, code] of [['missing node', undefined], ['missing snapback4', 2], ['compiler refusal', 1]]) test(`on-save surfaces ${name} task failure`, async () => {
  const { events, messages, executions } = extension();
  events.save({ uri: { scheme: 'file', fsPath: '/workspace/snapback/schema.q' } });
  await Promise.resolve();
  events.process?.({ execution: executions[0], exitCode: code });
  assert.equal(messages.length, 1, 'task failure was silent');
  assert.match(messages[0], /Quarry.*task terminal/);
});
test('successful and unrelated tasks stay quiet; queued saves still run', async () => {
  const { events, messages, executions } = extension();
  await events.command(); await events.command();
  assert.equal(executions.length, 1);
  events.process?.({ execution: executions[0], exitCode: 0 });
  events.process?.({ execution: { task: { definition: { type: 'other' } } }, exitCode: 2 });
  assert.equal(messages.length, 0);
  events.end({ execution: executions[0] }); await Promise.resolve();
  assert.equal(executions.length, 2);
});
