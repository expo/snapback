// @ref LLP 3000#publication-suite-under-contention — observe lifecycle events
// synchronously, before a test can monopolize JS. Node's default child serializer
// and async reporters buffer these events. The external runner already gives
// each file its own process, so run() needs no second process-isolation layer.
import { run } from 'node:test';
import { tap } from 'node:test/reporters';
import { globSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [file, options] = process.argv.slice(2);
const files = statSync(file).isDirectory() ? globSync(join(file, '**/*.test.mjs')).sort() : [file];
if (!files.length) throw Error(`TEST_FILE_RUNNER: no test files in ${file}`);
const stream = run({ files, isolation: 'none', ...JSON.parse(options), setup(stream) {
  for (const type of ['test:dequeue', 'test:complete']) stream.on(type, data => {
    if (process.connected) process.send({ progress: type, name: data.name });
  });
  stream.on('test:fail', data => { if (!data.todo && !data.skip) process.exitCode = 1; });
  stream.on('test:summary', data => {
    if (data.file) return; // only the complete run's summary
    const { tests, passed: pass, failed: fail, cancelled, skipped, todo } = data.counts;
    if (process.connected) process.send({ counts: { tests, pass, fail, cancelled, skipped, todo } });
  });
} });
stream.compose(tap).pipe(process.stdout);
