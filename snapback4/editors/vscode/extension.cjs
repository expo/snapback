// @ref LLP 3000.041#2.2 — compiler tasks on save; no language server.
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');

exports.activate = context => {
  const running = new Map();
  const queued = new Set();
  const folders = () => (vscode.workspace.workspaceFolders ?? []).filter(folder => {
    try { return fs.readdirSync(path.join(folder.uri.fsPath, 'snapback')).some(name => name.endsWith('.q')); }
    catch { return false; }
  });
  const taskFor = folder => {
    const binary = vscode.workspace.getConfiguration('quarry', folder.uri).get('binary', 'snapback4');
    const task = new vscode.Task({ type: 'quarry' }, folder, 'check', 'quarry',
      new vscode.ProcessExecution('node', [context.asAbsolutePath('scripts/check-problems.mjs'), '--workspace', folder.uri.fsPath, '--binary', binary], { cwd: folder.uri.fsPath }), '$quarry-check');
    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    return task;
  };
  const run = async folder => {
    const key = folder.uri.toString();
    if (running.has(key)) { queued.add(key); return; }
    running.set(key, null);
    try { running.set(key, await vscode.tasks.executeTask(taskFor(folder))); }
    catch (error) { running.delete(key); vscode.window.showErrorMessage(`Quarry check: ${error.message}`); }
  };
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('quarry', { provideTasks: () => folders().map(taskFor), resolveTask: task => task.scope?.uri ? taskFor(task.scope) : undefined }),
    vscode.commands.registerCommand('quarry.check', async () => {
      const available = folders();
      if (!available.length) { vscode.window.showErrorMessage('Quarry: open a workspace containing snapback/*.q.'); return; }
      for (const folder of available) await run(folder);
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.scheme !== 'file' || !document.uri.fsPath.endsWith('.q')) return;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!folder || !vscode.workspace.getConfiguration('quarry', folder.uri).get('checkOnSave', true)) return;
      const relative = path.relative(path.join(folder.uri.fsPath, 'snapback'), document.uri.fsPath);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) void run(folder);
    }),
    vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution.task.definition.type !== 'quarry' || event.exitCode === 0) return;
      vscode.window.showErrorMessage(`Quarry check failed (${event.exitCode === undefined ? 'could not start or was terminated' : `exit ${event.exitCode}`}). See Problems and the Quarry task terminal for details.`);
    }),
    vscode.tasks.onDidEndTask(event => {
      if (event.execution.task.definition.type !== 'quarry') return;
      const folder = event.execution.task.scope;
      if (!folder?.uri) return;
      const key = folder.uri.toString();
      if (running.get(key) !== event.execution) return;
      running.delete(key);
      if (queued.delete(key)) void run(folder);
    }),
  );
};
