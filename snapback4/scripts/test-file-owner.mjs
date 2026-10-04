// @ref LLP 3000#publication-suite-under-contention — only a live member can
// safely signal its group. The runner owns this stdin pipe, never a PGID lease.
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
let releasing = false;
const release = () => {
  if (releasing) return;
  releasing = true;
  const die = () => process.kill(0, 'SIGKILL');
  // The acknowledgement diagnoses unexpected keeper death; it authorizes no
  // signal in the runner. If the runner died, kill even without a working IPC.
  if (process.connected) process.send({ releasing: true }, die);
  else die();
};
process.stdin.on('data', release);
process.stdin.on('end', release);
process.stdin.on('error', release);
process.stdin.resume();
const child = spawn(process.execPath, process.argv.slice(2), { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const send = message => {
  if (process.connected) process.send(message, error => { if (error) release(); });
};
child.on('message', send);
child.once('error', error => send({ error: error.message, code: null, signal: null }));
child.once('exit', (code, signal) => send({ code, signal }));
// No natural exit on test completion. EOF also handles a dead runner.
