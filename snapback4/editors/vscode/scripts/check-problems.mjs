#!/usr/bin/env node
// @ref LLP 3000.041#8 — a stable problem-matcher line over the compiler's JSON envelope.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const oneLine = value => String(value ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
export function problemLine(diagnostic, schemaDir) {
  const { site, code, message, rewrite } = diagnostic;
  if (!site || typeof site.file !== 'string' || !site.file || !Number.isInteger(site.line) || site.line < 1 || !Number.isInteger(site.col) || site.col < 1) return null;
  if (/[\r\n]/.test(site.file) || !/^[A-Z][A-Z0-9_]*$/.test(code) || typeof message !== 'string') throw new Error('quarry check: malformed located diagnostic');
  return `${resolve(schemaDir, site.file)}:${site.line}:${site.col}: ${code} ${oneLine(message)} | ${oneLine(rewrite)}`;
}
function reviewSite(site) {
  const match = typeof site === 'string' && site.match(/^(.*):(\d+):(\d+)$/);
  return match ? { file: match[1], line: Number(match[2]), col: Number(match[3]) } : null;
}
function securityDiagnostics(report) {
  const diagnostics = (report.security?.notes ?? []).filter((_, i) => !report.securityReviews?.[i]?.acknowledged);
  for (const verdict of report.security?.invariants ?? []) {
    if (verdict.status !== 'refuted') continue;
    const { invariant, counterexample } = verdict;
    // Report::refuted counts only reachable fixture traces as failures. Seed
    // and synthetic observations remain available in the compiler's report.
    if (!['authored-fixture-trace', 'generated-fixture-trace'].includes(counterexample?.reachability)) continue;
    diagnostics.push({
      site: invariant.site, code: 'E_SECURITY_INVARIANT',
      message: `${invariant.table}${invariant.column ? `.${invariant.column}` : ''} ${invariant.target} ${invariant.predicate}: refuted${counterexample ? ` via ${counterexample.operation} as ${counterexample.viewer} (${counterexample.reachability})` : ''}; ${(verdict.reasons ?? []).join('; ')}`,
      rewrite: 'repair enforcement or independently verify the specification intent; run snapback4 test and snapback4 audit',
    });
  }
  for (const review of report.securityReviews ?? []) {
    if (!review.gated || review.acknowledged) continue;
    const site = reviewSite(review.site);
    const note = diagnostics.find(d => d.code === review.code && d.site?.file === site?.file && d.site?.line === site?.line && d.site?.col === site?.col);
    diagnostics.push({
      site, code: review.code,
      message: `security review required (${review.id}): ${note?.message ?? review.scope}`,
      rewrite: `${note?.rewrite ? `${note.rewrite}; ` : ''}run snapback4 check --review and answer this review from the specification`,
    });
  }
  return diagnostics;
}
export function check({ workspace = process.cwd(), binary = 'snapback4' } = {}) {
  workspace = resolve(workspace);
  const schemaDir = join(workspace, 'snapback');
  if (!existsSync(schemaDir) || !readdirSync(schemaDir, { withFileTypes: true }).some(file => file.isFile() && file.name.endsWith('.q'))) throw new Error(`quarry check: no .q files in ${schemaDir}`);
  if (!isAbsolute(binary) && /[/\\]/.test(binary)) binary = resolve(binary);
  if (binary === 'snapback4') {
    const local = join(workspace, 'node_modules', '.bin', process.platform === 'win32' ? 'snapback4.cmd' : 'snapback4');
    if (existsSync(local)) binary = local;
  }
  const child = spawnSync(binary, ['check', '--json'], { cwd: schemaDir, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error || child.signal) throw new Error(`quarry check: could not run ${binary}: ${child.error?.message ?? child.signal}`);
  let report;
  try { report = JSON.parse(child.stdout); } catch { throw new Error(`quarry check: expected one JSON object from check --json (exit ${child.status}): ${oneLine(child.stdout).slice(0, 1000)}`); }
  if (!report || typeof report.ok !== 'boolean') throw new Error('quarry check: invalid check --json envelope');
  const diagnostics = [...(report.problems ?? []), ...(report.notes ?? []), ...(report.denied ? [report.denied] : []), ...securityDiagnostics(report)];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    const line = problemLine(diagnostic, schemaDir);
    if (line) { if (!seen.has(line)) console.log(line); seen.add(line); }
    // Host/toolchain errors sometimes have no source site. Do not invent one.
    else console.error(`${oneLine(diagnostic.code)} ${oneLine(diagnostic.message)} | ${oneLine(diagnostic.rewrite)}`);
  }
  if (!report.ok && !diagnostics.length) console.error('quarry check: compiler refused without a located diagnostic; run snapback4 check --review for details');
  return child.status || (report.ok ? 0 : 1);
}
function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!['--workspace', '--binary'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('usage: check-problems.mjs [--workspace <dir>] [--binary <path>]');
    options[args[i].slice(2)] = args[++i];
  }
  process.exitCode = check(options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
