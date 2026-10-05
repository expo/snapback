// @ref LLP 3000.028#3.3.1 — internal publication and scheduling cannot drop value deadlines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.deepEqual(parsed.errors, []);
function check(file, source) {
  const host = ts.createCompilerHost(parsed.options), read = host.readFile.bind(host);
  if (file) host.readFile = path => path === file ? source : read(path);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options, host));
  return { diagnostics, text: ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }) };
}
test('value deadline compiler control: the unmodified package is valid', () => {
  const result = check();
  assert.equal(result.diagnostics.length, 0, result.text);
});
function rejects(name, file, before, after) {
  test(`value deadline compiler rejects ${name}`, () => {
    const path = join(root, 'src', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(before).length, 2, 'mutation must match exactly one production site');
    const result = check(path, source.replace(before, after));
    assert.ok(result.diagnostics.some(d => d.file?.fileName === path
      && [2322, 2345, 2741, 2554].includes(d.code)
      && /valueDevice|valueServer|undefined|arguments/.test(ts.flattenDiagnosticMessageText(d.messageText, '\n'))), result.text);
  });
}

// Keep the three round-3 omitted-constructor controls, for each authority.
for (const field of ['valueDevice', 'valueServer']) {
  for (const [file, before] of [
    ['local-query.ts', 'const loading: Result<R> = { read: { loading: true }, tables, nextExpiry: null, valueDevice: null, valueServer: null };'],
    ['local-search.ts', 'const loading: SearchResult = { read: { loading: true }, nextExpiry: null, valueDevice: null, valueServer: null, searchAttempt: true };'],
    ['client.ts', 'if (closed || storeRefusal || changesRefusal) return { read: { denied: storeRefusal ?? changesRefusal ?? ended() }, tables: [], seq: minimumReadSeq, epoch, valueDevice: null, valueServer: null, nextExpiry: null };'],
  ]) rejects(`${file} omitting ${field}`, file, before, before.replace(`, ${field}: null`, ''));
}
// Astra's exact final-publication mutation used to compile and disable refreshes.
const publication = 'if (watch || (revision === incarnation && (authority === answers.revision || result.publicationCurrent?.())) || closed) return { ...result, incarnation: revision, authority };';
rejects('Astra final local publication with undefined deadlines', 'local.ts', publication,
  publication.replace('...result,', '...result, valueDevice: undefined, valueServer: undefined,'));
rejects('runLocal forwarding undefined deadlines', 'local.ts',
  'active.add(work); void work.finally(() => active.delete(work)).catch(() => {}); return work;',
  'active.add(work); void work.finally(() => active.delete(work)).catch(() => {}); return work.then(result => ({ ...result, valueDevice: undefined, valueServer: undefined }));');
rejects('local fallback with undefined deadlines', 'local-query.ts',
  'placeholder() ? loading : latest?.result ?? loading;',
  '({ ...(placeholder() ? loading : latest?.result ?? loading), valueDevice: undefined, valueServer: undefined });');
rejects('device evaluation forwarding undefined deadlines', 'local-query.ts',
  'return latest;\n  };', 'return { ...latest, result: { ...latest.result, valueDevice: undefined, valueServer: undefined } };\n  };');
rejects('watch candidate forwarding undefined deadlines', 'local-query.ts',
  'return { ...candidate, read: candidate.result.read };',
  'return { ...candidate, result: { ...candidate.result, valueDevice: undefined, valueServer: undefined }, read: candidate.result.read };');
rejects('search overlap refusal with undefined deadlines', 'local-search.ts',
  'const invalidOverlap = (): SearchResult => ({ ...loading,',
  'const invalidOverlap = (): SearchResult => ({ ...loading, valueDevice: undefined, valueServer: undefined,');
rejects('online publication with undefined deadlines', 'client.ts',
  'return { ...result, deadlineWithdrawn:',
  'return { ...result, valueDevice: undefined, valueServer: undefined, deadlineWithdrawn:');
rejects('local scheduler receiving undefined deadlines', 'local.ts',
  'scheduleExpiry(watch, d.device, d.server, d.localWakeup, d.valueDevice, d.valueServer);',
  'scheduleExpiry(watch, d.device, d.server, d.localWakeup, undefined, undefined);');
rejects('online scheduler receiving undefined deadlines', 'client.ts',
  'scheduleExpiry(watch, d.server, d.valueServer, d.valueRetry)',
  'scheduleExpiry(watch, d.server, undefined, d.valueRetry)');
rejects('shared scheduler receiving undefined deadlines', 'client.ts',
  'localWakeup: false, valueDevice: null, valueServer, valueRetry',
  'localWakeup: false, valueDevice: undefined, valueServer: undefined, valueRetry');
