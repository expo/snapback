// @ref LLP 3000.030#15 — keep a verifiable group leader until the driver drains every member.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [result, command, ...args] = process.argv.slice(2);
// No worker can write before the driver durably records our group/birth time.
process.stdin.once('data', () => {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.once('error', () => {});
  child.once('close', (status, signal) => {
    fs.writeFileSync(result + '.tmp', JSON.stringify({ status: status ?? 1, signal }));
    fs.renameSync(result + '.tmp', result);
  });
  setInterval(() => {}, 60_000);
});
