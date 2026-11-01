// @ref LLP 3000#publication-suite-under-contention — live keeper custody;
// command descendants inherit this private group, including after driver exit.
import { spawn } from 'node:child_process';
import { signalSelf } from './test-owned-command.mjs';

const [graceText, command, ...args] = process.argv.slice(2);
const grace = Number(graceText);
if (!Number.isFinite(grace) || grace < 0 || !command) throw Error('invalid owned command');
process.on('SIGTERM', () => {});
let releasing = false;
const release = (mode = 'TERM') => {
  if (releasing) return;
  releasing = true;
  const kill = () => signalSelf('SIGKILL', { group: true });
  if (mode === 'KILL') return kill();
  setTimeout(kill, grace);
  signalSelf('SIGTERM', { group: true });
};
// EOF/disconnect also covers caller death. No compiler/identity inspection is
// required to signal the executing keeper's own group.
process.stdin.on('data', bytes => release(bytes.toString() === 'KILL' ? 'KILL' : 'TERM'));
process.stdin.on('end', () => release());
process.stdin.on('error', () => release());
process.on('disconnect', () => release());
process.stdin.resume();
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const send = message => {
  if (process.connected) process.send(message, error => { if (error) release(); });
  else release();
};
child.once('error', error => send({ error: error.message, errorCode: error.code }));
child.once('exit', (status, signal) => send({ exited: true, status, signal }));
// Never exit naturally: even a completed driver can leave a frontend alive.
