import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { correctionLoops, measureSchema, quarryFiles } from './ceremony-metrics.mjs';
export const WORDS = ['bound', 'cap', 'ceiling', 'meter', 'complete', 'incomplete', 'cursor', 'cut', 'batch', 'horizon', 'lanes',
  'N_WIDE_MERGE', 'N_NO_CURSOR', 'N_NEVER_COMPLETE', 'N_SPARSE_FILTER', 'E_STRUCTURAL_FANOUT', 'E_BOUND'];
// Only product page sizes and the 24-hour window are exempt, not seed cardinalities or implementation bounds.
const CONSTANTS = new Set([10, 20, 24, 86400000]);
export const strip = (text) => text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|--[^\n]*/g, (s) => s.replace(/[^\n]/g, ' '));
export function literals(sources) {
  return sources.flatMap(({path, source}) => strip(source).split('\n').flatMap((line, i) =>
    [...line.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g)].filter(([token]) => !token.includes('.') && !CONSTANTS.has(Number(token)))
      .map(([token]) => ({ file: path, line: i + 1, token }))));
}
export const vocabulary = (text) => Object.fromEntries(WORDS.map((word) => [word, [...text.matchAll(new RegExp(`\\b${word}\\b`, 'gi'))].length]));
export function record(log, name) {
  const lines = log.split('\n').filter((line) => line.startsWith(`${name}=`));
  if (lines.length !== 1) throw new Error(`expected exactly one ${name}= line`);
  return JSON.parse(lines[0].slice(name.length + 1));
}
export function searchProtocol(log) {
  const p = record(log, 'search-protocol');
  if (!['one-cursor', 'two-cursor', 'held-only', 'other'].includes(p.kind)) throw new Error('invalid search protocol kind');
  const n = p.kind === 'two-cursor' ? 2 : 1;
  for (const field of ['operations', 'cursorArgs']) if (!Array.isArray(p[field]) || p[field].length !== n ||
    p[field].some((s) => typeof s !== 'string' || !/^[\w.]+$/.test(s))) throw new Error(`invalid search ${field}`);
  if (new Set(p.cursorArgs).size !== n) throw new Error('search cursor arguments must be distinct');
  return p;
}
const read = (path) => existsSync(path) ? readFileSync(path, 'utf8') : '';
export function measureBounds(directory) {
  const log = read(join(directory, 'run-log.md')), report = read(join(directory, 'final-report.md'));
  const sources = quarryFiles(join(directory, 'snapback')).map((path) => ({ path: relative(directory, path), source: read(path) }));
  const schemaShape = measureSchema(sources, log), errors = [];
  let protocol = null, shape = null, ranges = {}, derived = [];
  for (const [name, set] of [['search-protocol', (v) => { protocol = searchProtocol(log); }],
    ['following-shape', (v) => { if (!['merge-on-read', 'recipe', 'other'].includes(v.kind)) throw new Error('invalid kind'); shape = v.kind; }],
    ['task-lines', (v) => { ranges = v; }], ['derived-columns', (v) => { if (!Array.isArray(v)) throw new Error('expected array'); derived = v; }]]) {
    try { set(record(log, name)); } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  const quarryLines = {};
  for (const task of ['search', 'following', 'rosterUnread', 'trending']) {
    const lines = new Set();
    if (!Array.isArray(ranges[task]) || !ranges[task].length) errors.push(`missing task-lines ${task}`);
    for (const range of ranges[task] ?? []) {
      const source = sources.find((s) => s.path === range.file);
      if (!source || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start ||
        range.end > source.source.trimEnd().split('\n').length) { errors.push(`invalid range ${task}: ${JSON.stringify(range)}`); continue; }
      for (let i = range.start; i <= range.end; i++) lines.add(`${range.file}:${i}`);
    }
    quarryLines[task] = lines.size;
  }
  const notes = {}, checkFiles = [], evidence = join(directory, 'evidence/checks');
  if (existsSync(evidence)) for (const name of readdirSync(evidence).sort()) {
    if (!name.endsWith('.log')) continue;
    checkFiles.push(`evidence/checks/${name}`);
    for (const [code] of read(join(evidence, name)).matchAll(/\b[NE]_[A-Z][A-Z0-9_]*\b/g)) notes[code] = (notes[code] ?? 0) + 1;
  }
  if (!checkFiles.length) errors.push('missing saved check output');
  const cards = {};
  for (const match of log.matchAll(/^.*\bknowledge-lookup card=([\w-]+) lines=(\d+)\b.*$/gm)) {
    const row = cards[match[1]] ??= { lookups: 0, lines: 0 }; row.lookups++; row.lines += Number(match[2]);
  }
  // Keep every permissive rule on declared derived tables AND inferred maintain tables, with provenance.
  const publicDerivedRules = [];
  const derivedTables = new Set([...schemaShape.maintainNames, ...derived.map((v) => v.table)]);
  for (const {path, source} of sources) {
    let table;
    strip(source).split('\n').forEach((line, i) => {
      if (/^\S/.test(line)) table = line.match(/^(?:table|maintain)\s+(\w+)/)?.[1];
      if (table && derivedTables.has(table) && /^\s+(?:public\b|(?:read|insert|update|delete)(?:\s*\([^)]*\))?\s*<-\s*(?:allow|public)\b)/.test(line))
        publicDerivedRules.push({ table, file: path, line: i + 1, text: source.split('\n')[i].trim() });
    });
  }
  for (const d of derived) if (!schemaShape.tableNames.includes(d.table) && !schemaShape.maintainNames.includes(d.table)) errors.push(`unknown derived table ${d.table}`);
  const start = Number(log.match(/^start=(\d+)$/m)?.[1]), green = Number(log.match(/^green=(\d+)$/m)?.[1]);
  const milestones = [...log.matchAll(/^milestone=([\w-]+) at=(\d+)$/gm)].map((m) => ({name: m[1], at: Number(m[2]), seconds: Number(m[2]) - start}));
  if (schemaShape.reportingError) errors.push(schemaShape.reportingError);
  const loops = correctionLoops(log);
  if (loops.malformed.length) errors.push('malformed correction loops');
  return { reportedGreen: Number.isFinite(start) && Number.isFinite(green) && green >= start, agentSeconds: green >= start ? green - start : null,
    builderSeedSeconds: Number(log.match(/^seed-seconds=(\d+(?:\.\d+)?)$/m)?.[1]) || null,
    milestones, correctionLoops: loops, schemaShape, quarryLines, numericLiterals: literals(sources), notes, checkFiles, cardsRead: cards,
    boundVocabulary: { runLog: vocabulary(log), finalReport: vocabulary(report), total: vocabulary(`${log}\n${report}`) },
    searchProtocol: protocol?.kind ?? 'other', protocol, followingShape: shape ?? 'other', tables: schemaShape.tables,
    tablesIncludingMaintains: schemaShape.tablesIncludingMaintains, jobs: schemaShape.operationsByKind.job,
    publicDerivedRules: { count: publicDerivedRules.length, lines: publicDerivedRules, declaredColumns: derived }, measurementErrors: errors };
}
