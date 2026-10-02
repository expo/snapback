// Linux qualification runner: one recorded process group owns all busy loops.
// Invocation: node .../live-margin-load.mjs OUTPUT_PREFIX [WORKERS=0] [CPUS=80-83]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { once } from 'node:events';
const [prefix, count = '0', cpus = '80-83'] = process.argv.slice(2);
if (!prefix || !/^\d+$/.test(count) || !/^[0-9,-]+$/.test(cpus)) throw Error('expected OUTPUT_PREFIX [WORKERS] [CPUS]');
const log = openSync(prefix + '.log', 'w');
let burners, test;
const metadata = { cpus, workers: Number(count), started: new Date().toISOString(), loadBefore: readFileSync('/proc/loadavg', 'utf8').trim(), pid: process.pid };
const stop = () => { if (burners?.exitCode === null) process.kill(-burners.pid, 'SIGTERM'); if (test?.exitCode === null) process.kill(-test.pid, 'SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  if (Number(count)) {
    burners = spawn('taskset', ['-c', cpus, 'python3', '-u', '-c', `
import os, signal, subprocess, sys
workers=[]
def stop(sig, frame):
    for w in workers:
        if w.poll() is None: w.terminate()
    for w in workers: w.wait()
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
for _ in range(${Number(count)}):
    workers.append(subprocess.Popen([sys.executable, '-c', 'while True: pass']))
print(','.join(str(w.pid) for w in workers), flush=True)
signal.pause()
`], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    metadata.loadGroup = burners.pid;
    metadata.workerPids = (await once(burners.stdout, 'data'))[0].toString().trim().split(',').map(Number);
  }
  metadata.command = ['taskset', '-c', cpus, process.execPath, '--test', process.env.LM_TEST ?? 'packages/snapback4/test/live-margin-browser.test.mjs'];
  metadata.runs = [];
  for (let run = 0; run < Number(process.env.LM_REPEAT ?? 1); run++) {
    test = spawn(metadata.command[0], metadata.command.slice(1), { detached: true, stdio: ['ignore', log, log], env: { ...process.env, LM_N: process.env.LM_N ?? '20', LM_OUT: prefix + '.json', LM_LABEL: prefix } });
    const [code, signal] = await once(test, 'exit'); metadata.runs.push({ run, code, signal, testGroup: test.pid });
    if (code !== 0) process.exitCode = 1;
  }
} finally {
  if (burners?.exitCode === null) { const exited = once(burners, 'exit'); process.kill(-burners.pid, 'SIGTERM'); await exited; }
  metadata.ended = new Date().toISOString(); metadata.loadAfter = readFileSync('/proc/loadavg', 'utf8').trim();
  metadata.reaped = !burners || burners.exitCode !== null;
  writeFileSync(prefix + '.host.json', JSON.stringify(metadata, null, 2)); closeSync(log);
}
