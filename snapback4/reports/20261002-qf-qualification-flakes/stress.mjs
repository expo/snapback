// Run from snapback4 after the publication host guard releases.
// One repeated worker-file slot plus 23 ordinary client-file slots. The latter
// cycle the entire ordinary inventory so the worker never finishes unloaded.
import { readdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir, availableParallelism, loadavg } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runFile } from '../../scripts/run-client-tests.mjs';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
process.chdir(root);
const [phase, destination, requestedRuns = '200', target = 'worker'] = process.argv.slice(2);
const targetRuns = Number(requestedRuns);
if (!['worker', 'replacement', 'both'].includes(target) || (target !== 'worker' && phase !== 'after') || !['before', 'after'].includes(phase) || !destination || !Number.isInteger(targetRuns) || targetRuns < 1)
  throw Error('stress.mjs before|after <output-directory> [runs=200] [worker|replacement|both]');
const out = resolve(destination), testDir = join(root, 'packages/snapback4/test');
const { mkdirSync } = await import('node:fs'); mkdirSync(out, { recursive: true });
const file = phase === 'before' ? join(testDir, '.qf-worker-before.mjs') : join(testDir, target !== 'replacement' ? 'worker-regressions.test.mjs' : 'web-admission-review.test.mjs');
const sourceCommit = '850fea99574d969331f68b0df1417ad1f942d2a9';
if (phase === 'before') {
  const temporary = mkdtempSync(join(tmpdir(), 'qf-before-source-'));
  try {
    const path = join(temporary, 'worker-regressions.test.mjs');
    writeFileSync(path, execFileSync('git', ['show', `${sourceCommit}:snapback4/packages/snapback4/test/worker-regressions.test.mjs`]));
    // Run from the repository root: git apply otherwise filters paths outside
    // the current subdirectory even with --unsafe-paths and --directory.
    execFileSync('git', ['apply', '--unsafe-paths', '--directory', temporary, fileURLToPath(new URL('./before-diagnostics.patch', import.meta.url))], { cwd: resolve(root, '..') });
    const source = readFileSync(path, 'utf8');
    if (!source.includes('WORKER_FIXTURE')) throw Error('baseline diagnostics patch did not apply');
    writeFileSync(file, source);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
const files = readdirSync(testDir).filter(path => path.endsWith('.test.mjs') && !['app-session-model.test.mjs', 'online-client-model.test.mjs'].includes(path)).sort();
const runs = [], load = [], timeline = [];
let finished = false, next = 0, active = 0, maxActive = 0;
const aborted = new AbortController();
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { finished = true; aborted.abort(); });
const metadata = { phase, target, sourceCommit, workerSourceSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  binary: process.env.SNAPBACK4_BIN ?? join(root,'target/debug/snapback4'), node: process.version,
  workerBinary: process.env.SNAPBACK4_QF_WORKER_BIN ?? null,
  wrapperSha256: process.env.SNAPBACK4_QF_WORKER_BIN ? createHash('sha256').update(readFileSync(process.env.SNAPBACK4_QF_WORKER_BIN)).digest('hex') : null,
  pid: process.pid,
  cpus: availableParallelism(), concurrency: 24, targetRuns, started: new Date().toISOString(), files };
writeFileSync(join(out, 'metadata.json'), JSON.stringify(metadata, null, 2)+'\n');
const ticker = setInterval(() => timeline.push({ at: new Date().toISOString(), load: loadavg(), active, completed: runs.length }), 1000);
async function execute(path, label, nodeArgs) {
  let output = '';
  const env = label.startsWith('worker-') && metadata.workerBinary ? { SNAPBACK4_BIN: metadata.workerBinary } : {};
  if (label.startsWith('replacement-')) env.SNAPBACK4_WEB_ADMISSION_FOCUS = '^a hide during the startup probe waits for its observed-replacement decision$';
  const result = await runFile(path, { nodeArgs, env, signal: aborted.signal, onOutput: text => { output = (output+text).slice(-65536); } });
  const row = { label, ...result, file: path.replace(testDir+'/', ''), at: new Date().toISOString(), load: loadavg(), active };
  appendFileSync(join(out, 'runs.jsonl'), JSON.stringify(row)+'\n');
  if (!row.passed) writeFileSync(join(out, `${label}.log`), output);
  return row;
}
let backgrounds = [];
try {
  backgrounds = Array.from({ length: 23 }, async (_, lane) => {
    while (!finished) {
      const index = next++, path = join(testDir, files[index % files.length]);
      active++; maxActive = Math.max(maxActive, active);
      try { load.push(await execute(path, `load-${index}`, [])); }
      finally { active--; }
    }
  });
  for (let i = 0; i < targetRuns && !aborted.signal.aborted; i++) {
    for (const kind of target === 'both' ? ['worker', 'replacement'] : [target]) {
      const targetFile = kind === 'replacement' ? join(testDir, 'web-admission-review.test.mjs') : file;
      runs.push(await execute(targetFile, `${kind}-${i}`, kind === 'worker' ? ['--test-name-pattern=new declarations retry failed admission'] : []));
    }
    if ((i+1)%10===0 || !runs.at(-1).passed) console.log(`${phase}: ${i+1}/${targetRuns}; failures ${runs.filter(row=>!row.passed).length}; load slots ${active}`);
  }
  finished = true;
  await Promise.all(backgrounds);
  const summary = { ...metadata, finished: new Date().toISOString(), workerRuns: runs.filter(row=>row.label.startsWith('worker-')).length, workerFailures: runs.filter(row=>row.label.startsWith('worker-') && !row.passed).length,
    replacementRuns: runs.filter(row=>row.label.startsWith('replacement-')).length, replacementFailures: runs.filter(row=>row.label.startsWith('replacement-') && !row.passed).length,
    targetRunsCompleted: runs.length, targetFailures: runs.filter(row=>!row.passed).length,
    loadFiles: load.length, loadFailures: load.filter(row=>!row.passed).map(row=>({file:row.file,label:row.label,reason:row.reason})), maxActive,
    slowest: [...load].sort((a,b)=>b.elapsed-a.elapsed).slice(0,10).map(row=>({file:row.file,elapsed:row.elapsed,passed:row.passed})) };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary,null,2)+'\n');
  writeFileSync(join(out, 'load.json'), JSON.stringify(timeline)+'\n');
  console.log(JSON.stringify(summary));
  process.exitCode = summary.targetFailures || summary.loadFailures.length || runs.length!==targetRuns*(target === 'both' ? 2 : 1) ? 1 : 0;
} finally {
  finished = true;
  aborted.abort();
  await Promise.allSettled(backgrounds);
  clearInterval(ticker);
  if (phase === 'before') rmSync(file, { force: true });
}
