#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGuide } from './extract-guide.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rfcPath = 'llp/4000-snapback5.rfc.md';
const fixturePath = 'snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q';
const contractPath = 'snapback4/packages/snapback4/src/contract.ts';
const appPath = 'snapback4/packages/snapback4/src/app.ts';
const normalize = text => text.replace(/\s+/g, ' ').trim();
const sorted = values => [...new Set(values)].sort();
const digest = text => createHash('sha256').update(text).digest('hex');
const read = path => readFileSync(join(root, path), 'utf8');

export function section(markdown, heading, next) {
  const start = markdown.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`Missing section: ${heading}`);
  const end = markdown.indexOf(`\n${next}`, start + heading.length);
  if (end < 0) throw new Error(`Missing section boundary: ${next}`);
  return markdown.slice(start + heading.length + 1, end);
}

// @ref LLP 4000#7-the-concept-budget — code spans in §3.1's bullet list are the frozen population.
export function proposedSurface(markdown) {
  const text = section(markdown, '### 3.1 What a program is', '### 3.2 ')
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  const entries = new Map();
  for (const bullet of text.matchAll(/^- \*\*([^*]+)\*\*([\s\S]*?)(?=^- |$(?![\s\S]))/gm)) {
    for (const span of bullet[2].matchAll(/`([^`]+)`/g)) {
      const entry = normalize(span[1]);
      if (!entries.has(entry)) entries.set(entry, new Set());
      entries.get(entry).add(`${rfcPath} §3.1 ${bullet[1]}`);
    }
  }
  if (!entries.size) throw new Error('No §3.1 bullet entries found');
  return [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([entry, sources]) => ({ entry, sources: [...sources] }));
}

function typeBody(source, name) {
  const found = source.match(new RegExp(`^export type ${name}(?:<[^\\n]*>)? =\\s*([\\s\\S]*?);(?=\\r?\\n|$)`, 'm'));
  if (!found) throw new Error(`Cannot find the ${name} union; update the extractor before counting`);
  return found[1];
}

// @ref LLP 4000#7.1 — the emitted module imports the contract; count its actual variants, including replay.
export function runtimeStates(api, contract, app) {
  if (!/from "snapback4\/contract"/.test(api)) throw new Error('api.ts does not import the expected contract');
  const entries = [];
  for (const name of ['Read', 'Write']) {
    const variants = [...typeBody(contract, name).matchAll(/\{([^{}]+)\}/g)];
    if (!variants.length) throw new Error(`No ${name} variants`);
    for (const [, body] of variants) {
      const state = body.match(/readonly state:\s*"([^"]+)"/);
      const replay = body.match(/readonly replayed\??:\s*(true|false)/);
      const first = body.match(/readonly (\w+):/);
      if (!first) throw new Error(`Unrecognized ${name} variant`);
      const entry = `${name}.${state?.[1] ?? first[1]}${replay ? ` (replayed=${replay[1]})` : ''}`;
      if (entries.some(item => item.entry === entry)) throw new Error(`Indistinguishable variants: ${entry}`);
      entries.push({ entry, sources: [contractPath] });
    }
  }
  for (const [, state] of typeBody(app, 'AuthState').matchAll(/"([^"]+)"/g)) {
    entries.push({ entry: `AuthState.${state}`, sources: [appPath] });
  }
  // E_GENERATION is explicitly required by §7 even though api.ts doesn't print it.
  const codes = new Set(['E_GENERATION']);
  for (const match of api.matchAll(/Require codes: ([^.]+)\./g)) {
    if (match[1] === 'none') continue;
    for (const code of match[1].split(',').map(normalize)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new Error(`Unrecognized refusal code: ${code}`);
      codes.add(code);
    }
  }
  for (const [code] of api.matchAll(/\bE_[A-Z0-9_]+\b/g)) codes.add(code);
  for (const code of sorted(codes)) entries.push({ entry: code, sources: [
    code === 'E_GENERATION' ? `${rfcPath} §7 (explicit runtime state)` : 'generated api.ts',
  ] });
  return entries.sort((a, b) => a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0);
}

// These populations are frozen by the commission. Distinct concepts count
// once per bucket, not once per table/operation or once per print occurrence.
export function checkConcepts(arm, rfc) {
  const removed = section(rfc, '### 3.2 What leaves, and what stays', '### 3.3 ');
  const names = arm === 'snapback4'
    ? ['sync', 'sync to', 'sync public', 'sync last N by', 'authored horizons',
      'retain delivered-history', 'cap N by', 'server', 'device',
      ...sorted(removed.match(/\bN_(?:NO_HORIZON|HORIZON_GUARD|NOW_SERVER|MAINTAIN_SYNCED|NOT_PREDICTABLE)\b/g) ?? [])]
    : ['warm set', 'depth step', 'depth-step trigger', 'eviction', 'retention', 'per-table device admission', 'outbox'];
  if (arm === 'snapback4' && names.length !== 14) throw new Error('The five residency notes changed; review the frozen rule');
  return names.map(entry => ({ entry, sources: [arm === 'snapback4'
    ? `${rfcPath} §3.2; Lane A authored-equivalent rule` : `${rfcPath} §7`] }));
}

function generateApi() {
  const scratch = join(root, 'snapback5/.work/concept-count');
  const binary = join(root, 'snapback4/target/debug/snapback4');
  const modules = join(root, 'snapback4/node_modules');
  if (!existsSync(binary) || !existsSync(join(modules, '.bin/snapback4'))
      || !existsSync(join(root, 'snapback4/packages/snapback4/dist/resolve-binary.js'))) {
    throw new Error('Build the local Snapback 4 CLI/package first; see snapback5/tools/README.md');
  }
  mkdirSync(join(scratch, 'snapback'), { recursive: true });
  const fixture = read(fixturePath);
  writeFileSync(join(scratch, 'snapback/schema.q'), fixture);
  writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n');
  if (!existsSync(join(scratch, 'node_modules'))) symlinkSync(modules, join(scratch, 'node_modules'), 'dir');
  // No registry lookup: npx uses this checkout's shim and this checkout's binary.
  // Force a fresh check for each arm; generated artifacts never enter git.
  const check = execFileSync('npx', ['--no-install', 'snapback4', 'check'], {
    cwd: scratch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SNAPBACK4_BIN: binary, NO_COLOR: '1', FORCE_COLOR: '0',
      PATH: `${dirname(process.execPath)}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  writeFileSync(join(scratch, 'check.txt'), check);
  const api = readFileSync(join(scratch, 'snapback/generated/api.ts'), 'utf8');
  return { api, fixture };
}

export function measure(arm) {
  if (!['snapback4', 'snapback5'].includes(arm)) throw new Error('Expected --arm snapback4|snapback5');
  const rfc = read(rfcPath);
  const { api, fixture } = generateApi();
  const guide = arm === 'snapback4' ? extractGuide(root) : null;
  const surface = guide?.entries ?? proposedSurface(rfc);
  const runtime = runtimeStates(api, read(contractPath), read(appPath));
  const check = checkConcepts(arm, rfc);
  const inputs = {
    [fixturePath]: digest(fixture),
    'generated api.ts': digest(api),
    [contractPath]: digest(read(contractPath)),
    [appPath]: digest(read(appPath)),
    [`${rfcPath} §3.1`]: digest(section(rfc, '### 3.1 What a program is', '### 3.2 ')),
    [`${rfcPath} §7`]: digest(section(rfc, '## 7. The concept budget',
      rfc.includes('## 7.1 The count at commission') ? '## 7.1 ' : '## 8. ')),
  };
  for (const path of guide?.sources ?? []) inputs[relative(root, path)] = digest(readFileSync(path));
  return { arm, counts: { surface: surface.length, runtime: runtime.length, check: check.length,
    total: surface.length + runtime.length + check.length }, surface, runtime, check, inputs };
}

export function markdown(result) {
  const { arm, counts } = result;
  let text = `## ${arm}\n\nSurface: **${counts.surface}**; runtime: **${counts.runtime}**; check: **${counts.check}**; total: **${counts.total}**.\n`;
  for (const bucket of ['surface', 'runtime', 'check']) {
    text += `\n### ${bucket} (${counts[bucket]})\n\n`;
    for (const { entry, sources } of result[bucket]) {
      text += `- \`${entry}\` — ${sources[0]}${sources.length > 1 ? ` (+${sources.length - 1} other source locations)` : ''}\n`;
    }
  }
  text += '\n### Input SHA-256\n\n';
  for (const [path, hash] of Object.entries(result.inputs)) text += `- \`${path}\`: \`${hash}\`\n`;
  return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--arm') throw new Error('Usage: node snapback5/tools/concept-count.mjs --arm snapback4|snapback5');
    process.stdout.write(markdown(measure(args[1])));
  } catch (error) {
    process.stderr.write(`concept-count: ${error.message}\n`);
    if (error.stderr) process.stderr.write(String(error.stderr));
    process.exitCode = 1;
  }
}
