import {access, appendFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtime = join(root, '.runtime', 'postgres');
const data = join(runtime, 'data');
const socket = join(runtime, 'socket');
const ready = join(runtime, 'ready.json');
const receipt = join(runtime, 'receipt.json');
const brewPrefix = spawnSync('brew', ['--prefix', 'postgresql@17'], {encoding: 'utf8'}).stdout.trim();
const bin = join(brewPrefix, 'bin');

const command = process.argv[2];

function run(name, args, options = {}) {
  const result = spawnSync(join(bin, name), args, {encoding: 'utf8', ...options});
  if (result.status !== 0) {
    const error = new Error(`${name} failed: ${result.stderr || result.stdout}`);
    error.code = 'ZERO_BAKEOFF_POSTGRES_COMMAND_FAILED';
    throw error;
  }
  return result.stdout.trim();
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function start() {
  await mkdir(runtime, {recursive: true});
  await mkdir(socket, {recursive: true});
  if (!(await exists(join(data, 'PG_VERSION')))) {
    run('initdb', ['-D', data, '--auth=trust', '--encoding=UTF8', '--locale=C']);
    await appendFile(join(data, 'postgresql.conf'), [
      '',
      "wal_level = 'logical'",
      'max_replication_slots = 16',
      'max_wal_senders = 16',
      "listen_addresses = '127.0.0.1'",
      ''
    ].join('\n'));
  }
  const port = await freePort();
  run('pg_ctl', [
    '-D', data,
    '-l', join(runtime, 'postgres.log'),
    '-o', `-p ${port} -k ${socket}`,
    '-w',
    'start'
  ]);
  const url = `postgresql://${process.env.USER}@127.0.0.1:${port}/postgres`;
  const pid = Number((await readFile(join(data, 'postmaster.pid'), 'utf8')).split('\n')[0]);
  const info = {
    schemaVersion: 'snapback.zero-bakeoff.postgres-runtime.v1',
    pid,
    port,
    url,
    data,
    socket,
    postgresVersion: run('postgres', ['--version'])
  };
  await writeFile(ready, JSON.stringify(info, null, 2) + '\n', {mode: 0o600});
  await writeFile(receipt, JSON.stringify({...info, observedAt: new Date().toISOString()}, null, 2) + '\n');
  process.stdout.write(JSON.stringify(info) + '\n');
}

async function stop() {
  if (await exists(join(data, 'postmaster.pid'))) {
    run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
  await rm(ready, {force: true});
  process.stdout.write(JSON.stringify({ok: true, stopped: true}) + '\n');
}

async function status() {
  if (!(await exists(ready))) {
    process.stdout.write(JSON.stringify({running: false}) + '\n');
    return;
  }
  const info = JSON.parse(await readFile(ready, 'utf8'));
  const result = spawnSync(join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(info.port)], {encoding: 'utf8'});
  process.stdout.write(JSON.stringify({running: result.status === 0, ...info}) + '\n');
}

if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else {
  process.stderr.write('usage: node scripts/postgres-local.mjs <start|stop|status>\n');
  process.exitCode = 2;
}
