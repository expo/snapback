import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { runFile } from '../../../scripts/run-client-tests.mjs';
const out = resolve(import.meta.dirname, 'runs');
mkdirSync(out, { recursive: true });
const files = [
  ...['per-row-react','answers-stay-react','asset-avatars','asset-buffered','keep-authority-react','live-margin-browser','ordinary-search','page-observation','react','read-presentation-react','social-browser','subscription-pressure-e2e','typing-expiry','screen-lifetimes-react','browser-navigation'].map(name => `packages/snapback4/test/${name}.test.mjs`),
  'experiments/p19-one-query/equality/browser.test.mjs',
  'scripts/qualify-revocation-retention.mjs',
];
const receiptFile = resolve(out, 'receipts.jsonl');
const previous = existsSync(receiptFile) ? readFileSync(receiptFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const completed = new Set(previous.map(r => r.run + ':' + r.file));
const phase = process.argv[2] ?? '1';
const queue = Array.from({ length: 30 }, (_, i) => files.map(file => ({ run: i + 1, file }))).flat().filter(job => !completed.has(job.run + ':' + job.file));
const cpus = (await import('node:os')).availableParallelism();
const hogs = Array.from({ length: cpus }, () => spawn('python3', ['-c', 'while True: pass'], { stdio: 'ignore' }));
writeFileSync(resolve(import.meta.dirname, `hogs-phase${phase}.json`), JSON.stringify({ cpus, pids: hogs.map(p => p.pid), started: new Date().toISOString() }, null, 2));
let failures = previous.filter(r => !r.passed).length;
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
try {
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length && !abort.signal.aborted) {
      const job = queue.shift();
      const log = resolve(out, `${String(job.run).padStart(2, '0')}-${basename(job.file)}.log`);
      const started = new Date().toISOString();
      const result = await runFile(job.file, { signal: abort.signal, onOutput: text => appendFileSync(log, text) });
      const row = { ...job, started, ...result };
      appendFileSync(resolve(out, 'receipts.jsonl'), JSON.stringify(row) + '\n');
      console.log(JSON.stringify({ run: job.run, file: job.file, passed: result.passed, elapsed: result.elapsed, counts: result.counts }));
      if (!result.passed) failures++;
    }
  }));
} finally {
  const closed = hogs.map(p => once(p, 'close'));
  for (const hog of hogs) hog.kill('SIGTERM');
  await Promise.all(closed);
  writeFileSync(resolve(import.meta.dirname, `hog-cleanup-phase${phase}.json`), JSON.stringify(hogs.map(p => ({ pid: p.pid, exitCode: p.exitCode, signalCode: p.signalCode })), null, 2));
}
console.log(JSON.stringify({ failures, remaining: queue.length }));
process.exitCode = failures || queue.length ? 1 : 0;
