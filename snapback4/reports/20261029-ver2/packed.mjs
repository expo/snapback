// Affected packed consumers, plus the exact direct-phases -> verify lane shape.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { proveStarters, runToolchainCommand } from '../../scripts/publication-starters.mjs';
import { proveGeneratedProofs } from '../../scripts/publication-frontend-proofs.mjs';
const [client, platform, expo, output] = process.argv.slice(2).map(p => resolve(p));
mkdirSync(output, { recursive: true });
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const evidence = { source: process.env.VER2_SOURCE, artifacts: [client, platform, expo].map(p => ({ path: p, sha256: digest(p) })), qualification: false, loops: [] };
const run = (cmd, args, cwd, env) => runToolchainCommand(cmd, args, { cwd, env, timeout: 300000 });
for (const [kind, flags] of [['web', ['--web']], ['password', ['--web', '--online', '--password']], ['expo', ['--expo']]]) {
  const cwd = join(output, `loop-${kind}`); mkdirSync(cwd);
  const counts = join(output, `counts-${kind}.txt`);
  const env = { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', VER2_COUNTS: counts };
  delete env.SNAPBACK4_BIN;
  writeFileSync(join(cwd, 'package.json'), '{"private":true}');
  await run('npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', client, platform], cwd, env);
  const cli = join(cwd, 'node_modules/.bin/snapback4');
  await run(cli, ['init', '--no-install', ...flags], cwd, env);
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json')));
  pkg.dependencies.snapback4 = `file:${client}`;
  pkg.optionalDependencies = { 'snapback4-linux-x64': `file:${platform}` };
  if (kind === 'expo') pkg.dependencies['snapback4-expo'] = `file:${expo}`;
  const original = Object.fromEntries(['acceptance', 'frontend:proof'].map(p => [p, pkg.scripts[p]]));
  writeFileSync(join(cwd, 'scripts/count-phase.mjs'), `import{appendFileSync}from'node:fs';import{spawn}from'node:child_process';const phase=process.argv[2];appendFileSync(process.env.VER2_COUNTS,phase+'\\n');const commands=${JSON.stringify(original)};const c=spawn(commands[phase],{shell:true,stdio:'inherit'});c.on('exit',code=>process.exitCode=code??1);`);
  for (const phase of Object.keys(original)) pkg.scripts[phase] = `node scripts/count-phase.mjs ${phase}`;
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2));
  await run(process.execPath, ['scripts/install.mjs', '--prefer-offline', '--no-audit', '--no-fund'], cwd, env);
  await run(cli, ['check'], cwd, env);
  // All phases run under this persistent Codex builder's actual PID identity.
  await run('npm', ['run', '--silent', 'acceptance'], cwd, env);
  await run('npm', ['run', '--silent', 'frontend:proof'], cwd, env);
  const start = Date.now();
  const child = spawn('npm', ['run', '--silent', 'verify'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { text += b; chunks.push({ ms: Date.now() - start, text: String(b) }); process.stdout.write(b); });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  const phases = readFileSync(counts, 'utf8').trim().split('\n');
  const result = { kind, code, ms: Date.now() - start, phases, output: text, chunks };
  evidence.loops.push(result); writeFileSync(join(output, 'verify-loops.json'), JSON.stringify(evidence, null, 2));
  assert.equal(code, 0, text); assert.deepEqual(phases, ['acceptance', 'frontend:proof']);
  assert.match(text, /acceptance \(reused\), frontend:proof \(reused\)/);
  rmSync(cwd, { recursive: true, force: true });
}
// These are the actual publication consumers, not source-tree substitutes.
const frontend = await proveGeneratedProofs(client, platform, expo, output);
writeFileSync(join(output, 'frontend-proofs.json'), JSON.stringify(frontend, null, 2));
for (const kind of ['web', 'web-online', 'expo', 'web-chat', 'expo-chat', 'expo-social']) rmSync(join(output, `frontend-${kind}`), { recursive: true, force: true });
const starters = await proveStarters(client, platform, expo, output);
writeFileSync(join(output, 'starter-proofs.json'), JSON.stringify(starters, null, 2));
writeFileSync(join(output, 'passed.json'), JSON.stringify({ ...evidence, frontend, starters, publicationQualified: false }, null, 2));
for (const item of starters) if (item.directory) rmSync(item.directory, { recursive: true, force: true });
console.log('VER2 affected packed consumer proofs passed');
