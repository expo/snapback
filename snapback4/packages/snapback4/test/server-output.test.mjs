import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { captureStdout } from './helpers/server-output.mjs';

for (const ending of ['\n', '\r\n']) test(`readiness survives stderr inside stdout chunks (${JSON.stringify(ending)})`, () => {
  const address = 'http://127.0.0.1:34567';
  for (const split of [address.length - 3, address.length]) {
    const child = { stdout: new PassThrough(), stderr: new PassThrough() };
    const readStdout = captureStdout(child);
    let diagnostics = '', ready;
    child.stdout.on('data', bytes => {
      diagnostics += bytes;
      ready = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];
    });
    child.stderr.on('data', bytes => { diagnostics += bytes; });
    try {
      child.stdout.write(address.slice(0, split));
      child.stderr.write('snapback4 host: startup diagnostic\nhttp://127.0.0.1:9\n');
      assert.equal(ready, undefined, 'neither a partial port nor stderr is readiness');
      child.stdout.write(address.slice(split) + ending);
      assert.equal(ready, address, 'the complete stdout record supplies the full port');
      assert.equal(readStdout(), address + ending);
      assert.ok(diagnostics.includes('startup diagnostic'), 'diagnostics remain observable');
    } finally { child.stdout.destroy(); child.stderr.destroy(); }
  }
});
