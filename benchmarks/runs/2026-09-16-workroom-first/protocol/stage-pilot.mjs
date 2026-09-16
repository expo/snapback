#!/usr/bin/env node
// Stage the one 2026-09-16 Workroom diagnostic pilot. This deliberately is
// not a reusable benchmark-packet framework.
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  chmod, copyFile, lstat, mkdir, opendir, readFile, realpath, stat, statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED_NODE = 'v24.13.1';
const MIN_FREE_BYTES = 2n * 1024n * 1024n * 1024n;
const VERSION = 1;

function fail(code, detail = '') {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}

async function digest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

function pathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`);
}

function gitRoot(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? resolve(result.stdout.trim()) : null;
}

export function removeHoldoutSection(raw) {
  const heading = /^## Holdout probes[ \t]*$/gm;
  const matches = [...raw.matchAll(heading)];
  if (matches.length !== 1) fail('PILOT_BRIEF_HOLDOUT_HEADING', `expected one heading, found ${matches.length}`);
  const start = matches[0].index;
  const tail = raw.slice(start + matches[0][0].length);
  const next = /\n## [^\n]+/.exec(tail);
  if (!next) fail('PILOT_BRIEF_HOLDOUT_BOUNDARY', 'no following level-two section');
  const end = start + matches[0][0].length + next.index + 1;
  const rendered = raw.slice(0, start) + raw.slice(end);
  if (/^## Holdout probes[ \t]*$/m.test(rendered)) fail('PILOT_BRIEF_HOLDOUT_RETAINED');
  return rendered;
}

export function renderPrompt(raw, paths) {
  let rendered = raw;
  const values = {
    APP_DIR: paths.app,
    PACKET_DIR: paths.packet,
    BRIEF_PATH: paths.brief,
    FIXTURES_DIR: paths.fixtures,
    TOOLS_DIR: paths.tools,
    STARTER_DIR: paths.starter,
    CONFORMANCE_DIR: paths.conformance,
    SNAPBACK4_VERSION: '0.2.26',
  };
  for (const [name, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${name}}}`, value);
  }
  const unresolved = [...new Set(rendered.match(/{{[A-Z0-9_]+}}/g) ?? [])];
  if (unresolved.length) fail('PILOT_PROMPT_PLACEHOLDER', unresolved.join(', '));
  return rendered;
}

async function walkRegularFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = [];
    for await (const entry of await opendir(directory)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else fail('PILOT_PACKET_NON_REGULAR', relative(root, path));
    }
  }
  await visit(root);
  return files;
}

async function copyTree(sourceRoot, destinationRoot, sourceRepo, packetRoot, manifestFiles) {
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  for (const source of await walkRegularFiles(sourceRoot)) {
    const rel = relative(sourceRoot, source);
    const destination = join(destinationRoot, rel);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const original = await digest(source);
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const copied = await digest(destination);
    if (original.bytes !== copied.bytes || original.sha256 !== copied.sha256) {
      fail('PILOT_PACKET_COPY_MISMATCH', relative(sourceRepo, source));
    }
    manifestFiles.push({
      source: relative(sourceRepo, source),
      staged: relative(packetRoot, destination),
      original,
      copied,
    });
  }
}

async function readTreeDigests(root, packetRoot) {
  const result = [];
  for (const path of await walkRegularFiles(root)) {
    result.push({ path: relative(packetRoot, path), ...(await digest(path)) });
  }
  return result;
}

async function makeReadOnly(root) {
  const directories = [];
  async function visit(directory) {
    directories.push(directory);
    for await (const entry of await opendir(directory)) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) await chmod(path, 0o444);
      else fail('PILOT_PACKET_NON_REGULAR', path);
    }
  }
  await visit(root);
  for (const directory of directories.reverse()) await chmod(directory, 0o555);
}

export async function stagePilot(sourceArgument, destinationArgument) {
  if (process.version !== REQUIRED_NODE) fail('PILOT_NODE_VERSION', `need ${REQUIRED_NODE}, got ${process.version}`);
  if (!sourceArgument || !destinationArgument) fail('PILOT_USAGE', 'stage-pilot.mjs SOURCE_REPO NEW_DESTINATION');

  const source = await realpath(resolve(sourceArgument));
  const sourceInfo = await stat(source);
  if (!sourceInfo.isDirectory() || gitRoot(source) !== source) fail('PILOT_SOURCE_REPO_ROOT', source);

  const destination = resolve(destinationArgument);
  if (pathInside(source, destination)) fail('PILOT_DESTINATION_IN_SOURCE', destination);
  const parent = await realpath(dirname(destination));
  if (gitRoot(parent)) fail('PILOT_DESTINATION_IN_REPO', parent);
  try {
    await lstat(destination);
    fail('PILOT_DESTINATION_EXISTS', destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const disk = await statfs(parent, { bigint: true });
  const freeBytes = disk.bavail * disk.bsize;
  if (freeBytes < MIN_FREE_BYTES) fail('PILOT_DISK_FLOOR', `${freeBytes} bytes available`);

  const promptSource = join(source, 'benchmarks/runs/2026-09-16-workroom-first/protocol/pilot-prompt.md');

  await mkdir(destination, { mode: 0o700 });
  const app = join(destination, 'app');
  const packet = join(destination, 'packet');
  const paths = {
    app,
    packet,
    brief: join(packet, 'brief.md'),
    fixtures: join(packet, 'benchmarks/fixtures/team-workspace'),
    tools: join(packet, 'benchmarks/tools/team-workspace'),
    starter: join(packet, 'generated/starter'),
    conformance: join(packet, 'generated/conformance'),
  };
  await mkdir(app, { mode: 0o700 });
  await mkdir(packet, { mode: 0o700 });

  const files = [];
  await copyTree(join(source, 'benchmarks/fixtures/team-workspace'), paths.fixtures, source, packet, files);
  await copyTree(join(source, 'benchmarks/tools/team-workspace'), paths.tools, source, packet, files);

  const rawBriefPath = join(source, 'benchmarks/briefs/team-workspace.md');
  const rawBrief = await readFile(rawBriefPath, 'utf8');
  const renderedBrief = removeHoldoutSection(rawBrief);
  await writeFile(paths.brief, renderedBrief, { flag: 'wx', mode: 0o600 });
  const brief = {
    source: relative(source, rawBriefPath),
    raw: { bytes: Buffer.byteLength(rawBrief), sha256: createHash('sha256').update(rawBrief).digest('hex') },
    staged: 'brief.md',
    rendered: await digest(paths.brief),
    omittedSection: 'Holdout probes',
    rawDelivered: false,
  };

  const rawPrompt = await readFile(promptSource, 'utf8');
  const renderedPrompt = renderPrompt(rawPrompt, paths);
  const promptPath = join(packet, 'pilot-prompt.md');
  await writeFile(promptPath, renderedPrompt, { flag: 'wx', mode: 0o600 });
  const prompt = {
    source: relative(source, promptSource),
    original: { bytes: Buffer.byteLength(rawPrompt), sha256: createHash('sha256').update(rawPrompt).digest('hex') },
    staged: 'pilot-prompt.md',
    copied: await digest(promptPath),
  };

  const generator = join(paths.tools, 'generate.mjs');
  const { generate, verifyGenerated } = await import(pathToFileURL(generator));
  const generatedProfiles = {};
  for (const [profile, directory] of [['starter', paths.starter], ['conformance', paths.conformance]]) {
    const generated = await generate({ profile, directory });
    const verified = await verifyGenerated(directory);
    generatedProfiles[profile] = {
      generated,
      verified,
      files: await readTreeDigests(directory, packet),
    };
  }

  files.sort((a, b) => a.staged.localeCompare(b.staged));
  const manifest = {
    version: VERSION,
    kind: 'workroom-diagnostic-pilot-packet',
    stagedAt: new Date().toISOString(),
    node: process.version,
    snapback4: '0.2.26',
    appInitiallyEmpty: true,
    rawHoldoutsDelivered: false,
    copiedRoots: ['benchmarks/fixtures/team-workspace', 'benchmarks/tools/team-workspace'],
    brief,
    prompt,
    files,
    generatedProfiles,
  };
  const manifestPath = join(packet, 'stage-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await makeReadOnly(packet);
  console.log(JSON.stringify({ destination, packet: await digest(manifestPath), profiles: {
    starter: generatedProfiles.starter.verified,
    conformance: generatedProfiles.conformance.verified,
  } }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) fail('PILOT_USAGE', 'stage-pilot.mjs SOURCE_REPO NEW_DESTINATION');
    await stagePilot(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}
