// Keep the detached process group's identity alive after node:test exits.
// @ref LLP 3000#publication-suite-under-contention — group custody survives
// intermediate-parent exit; only the external runner releases this keeper.
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
child.once('error', error => process.send({ error: error.message }));
child.once('exit', (code, signal) => process.send({ code, signal }));
process.on('message', message => { if (message === 'release') process.exit(0); });
// If the runner itself disappears, this still only signals its own group.
process.on('disconnect', () => process.kill(-process.pid, 'SIGKILL'));
