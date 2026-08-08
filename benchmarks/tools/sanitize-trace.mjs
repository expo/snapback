#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './lib/canonical-json.mjs';
import { formatFailure } from './lib/failure.mjs';
import { parseRawTraceFile, sanitizeTrace } from './lib/sanitizer.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function insideRoot(path) {
  const rel = relative(realpathSync(ROOT), realpathSync(dirname(path)));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

try {
  const inputPath = option('--input');
  const outputPath = option('--output');
  const privateStore = option('--private-store');
  if (!inputPath || !outputPath || !privateStore) {
    throw new Error('usage: node benchmarks/tools/sanitize-trace.mjs --input <private-raw.json> --output <repo-public.json> --private-store <out-of-repo-dir>');
  }
  if (outputPath.startsWith('/') || outputPath.split('/').includes('..') || !outputPath.endsWith('.json')) {
    throw new Error('--output must be a repository-relative JSON path');
  }
  const absoluteOutput = resolve(ROOT, outputPath);
  if (!insideRoot(absoluteOutput)) throw new Error('--output must stay inside the repository');
  const rawTrace = parseRawTraceFile({ root: ROOT, inputPath });
  const sanitized = sanitizeTrace({
    root: ROOT,
    rawTrace,
    privateStore,
    keyFile: process.env.SNAPBACK_BENCHMARK_HMAC_KEY_FILE,
  });
  if (existsSync(absoluteOutput)) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(absoluteOutput, 'utf8'));
    } catch {
      throw new Error(`refusing to overwrite non-sanitizer file: ${outputPath}`);
    }
    if (existing.sanitizer !== 'llp0197-rule5-v1') {
      throw new Error(`refusing to overwrite non-sanitizer file: ${outputPath}`);
    }
  }
  const temporary = resolve(dirname(absoluteOutput), `.${absoluteOutput.split('/').at(-1)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, canonicalJson(sanitized), { encoding: 'utf8', mode: 0o644 });
    renameSync(temporary, absoluteOutput);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  process.stdout.write(`[benchmark-sanitizer] wrote ${relative(ROOT, absoluteOutput)}; private originals retained under the requested store\n`);
} catch (error) {
  process.stderr.write(`${formatFailure(error)}\n`);
  process.exitCode = 1;
}
