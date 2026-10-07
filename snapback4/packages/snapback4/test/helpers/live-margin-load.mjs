// Linux qualification runner: one recorded process group owns all busy loops.
// Invocation: node .../live-margin-load.mjs OUTPUT_PREFIX [WORKERS=0] [CPUS=80-83]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
const [prefix, count = '0', cpus = '80-83'] = process.argv.slice(2);
if (!prefix || !/^\d+$/.test(count) || !/^[0-9,-]+$/.test(cpus)) throw Error('expected OUTPUT_PREFIX [WORKERS] [CPUS]');
const log = openSync(prefix + '.log', 'w');
let burners, test;
const metadata = { cpus, workers: Number(count), started: new Date().toISOString(), loadBefore: readFileSync('/proc/loadavg', 'utf8').trim(), pid: process.pid };
// Pipe ownership survives arbitrary dispatch delays; never cache a group ID
// for signalling. The test keeper signals only its own still-live group.
const stop = () => { burners?.stdin.end(); test?.stdin.end(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  if (Number(count)) {
    burners = spawn('taskset', ['-c', cpus, 'python3', '-u', '-c', `
import subprocess, sys
workers=[]
try:
    for _ in range(${Number(count)}):
        workers.append(subprocess.Popen([sys.executable, '-c', 'import os,sys,threading; threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\\nwhile True: pass'], stdin=subprocess.PIPE))
    print(','.join(str(w.pid) for w in workers), flush=True)
    sys.stdin.read()
finally:
    for w in workers:
        w.stdin.close()
    for w in workers: w.wait()
`], { detached: true, stdio: ['pipe', 'pipe', 'inherit'] });
    metadata.loadGroup = burners.pid;
    const output = createInterface({ input: burners.stdout });
    try { metadata.workerPids = (await once(output, 'line', { signal: AbortSignal.timeout(30000) }))[0].split(',').map(Number); }
    finally { output.close(); }
  }
  metadata.command = ['taskset', '-c', cpus, process.execPath, new URL('../../../../scripts/test-file-owner.mjs', import.meta.url).pathname, '--test', process.env.LM_TEST ?? 'packages/snapback4/test/live-margin-browser.test.mjs'];
  metadata.runs = [];
  for (let run = 0; run < Number(process.env.LM_REPEAT ?? 1); run++) {
    test = spawn(metadata.command[0], metadata.command.slice(1), { detached: true, stdio: ['pipe', log, log, 'ipc'], env: { ...process.env, LM_N: process.env.LM_N ?? '20', LM_OUT: prefix + '.json', LM_LABEL: prefix } });
    const exited = once(test, 'exit');
    let result;
    test.on('message', message => { if ('code' in message) { result = message; test.stdin.end(); } });
    await exited;
    const { code = null, signal = null } = result ?? {};
    metadata.runs.push({ run, code, signal, testGroup: test.pid });
    if (code !== 0) process.exitCode = 1;
  }
} finally {
  if (burners?.exitCode === null && burners?.signalCode === null) { const exited = once(burners, 'exit'); burners.stdin.end(); await exited; }
  metadata.ended = new Date().toISOString(); metadata.loadAfter = readFileSync('/proc/loadavg', 'utf8').trim();
  metadata.reaped = !burners || burners.exitCode !== null;
  writeFileSync(prefix + '.host.json', JSON.stringify(metadata, null, 2)); closeSync(log);
}
