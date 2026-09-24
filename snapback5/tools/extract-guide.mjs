import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// @ref LLP 4000#7.1 — extract documented forms, with evidence, rather than a hand-counted total.
// This is a recognizer, not a Quarry parser. Compiled Quarry fences and
// recognized forms in inline reference spans contribute; JS fences do not.
// Payload identifiers, literals and bounds never become entries.
export function extractGuide(root) {
  const dir = join(root, 'snapback4/crates/snapback4-lang/src/guide');
  const sources = readdirSync(dir).filter(name => /\.(rs|md)$/.test(name)
    && !['codes.rs', 'discovery.rs', 'templates.rs'].includes(name)).sort()
    .map(name => join(dir, name));
  // Three keyword cards (residency, expire, assets) are embedded in guide.rs.
  sources.push(join(root, 'snapback4/crates/snapback4-lang/src/guide.rs'));
  const entries = new Map();
  for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    const samples = [];
    for (const fence of source.matchAll(/^```quarry\r?\n([\s\S]*?)^```/gm)) {
      const lines = fence[1].split('\n');
      const start = source.slice(0, fence.index).split('\n').length + 1;
      for (let i = 0; i < lines.length; i++) {
        // Preserve a placeholder for strings; their contents cannot name forms.
        const line = lines[i].replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|--.*$/g,
          token => token.startsWith('--') ? '' : "'…'");
        samples.push({ line, at: `${relative(root, path)}:${start + i}` });
      }
    }
    // Keep line offsets, suppress every fenced block, then read inline
    // references too: e.g. the default retain policy and a plain `else:`
    // are documented even when no compiled example needs to spell them.
    const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm,
      block => block.replace(/[^\n]/g, ' '));
    for (const span of prose.matchAll(/`([^`]+)`/g)) {
      const line = span[1].replace(/\s+/g, ' ').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "'…'");
      const at = `${relative(root, path)}:${prose.slice(0, span.index).split('\n').length}`;
      samples.push({ line, at }, { line: `  ${line}`, at });
    }
    for (const { line, at } of samples) {
      for (const [form, pattern] of forms) {
        if (!pattern.test(line)) continue;
        if (!entries.has(form)) entries.set(form, new Set());
        entries.get(form).add(at);
      }
    }
  }
  if (!entries.size) throw new Error('No Quarry guide forms found');
  return { entries: [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([entry, locations]) => ({ entry, sources: [...locations].sort() })), sources };
}

// Each recognizer is one form/modifier/term/builtin, not one occurrence.
// Compound forms stay whole (e.g. "if absent"); independently authored
// modifiers also count (e.g. "once" on an image and "emit … once").
const forms = [
  ...['identity', 'personas', 'server'].map(word => [`use ${word}${word === 'identity' ? ' …' : ''}`, new RegExp(`^use ${word}\\b`)]),
  ...['guests', 'password'].map(word => [word, new RegExp(`^use identity ${word}\\b`)]),
  ...['table', 'effect', 'view', 'maintain', 'shape', 'fn', 'query', 'mutation', 'job', 'schedule', 'action', 'route']
    .map(word => [word, new RegExp(`^${word}\\s`)]),
  ...['principal', 'id', 'int', 'time', 'bool', 'decimal', 'money', 'text', 'enum', 'json', 'bytes', 'image', 'video', 'cursor']
    .map(word => [word, new RegExp(`:\\s*\\[?${word}\\b|,\\s*\\w+:\\s*${word}\\b`)]),
  ['<table> reference', /^\s+\w+:\s*(?!(?:principal|id|int|time|bool|decimal|money|text|enum|json|bytes|image|video|count|sum|max|sequence)\b)[a-z]\w*\s*\??\s*$/],
  ['[type] <=N', /:\s*\[[^\]]+\]\s*<=/],
  ['?', /:\s*[^\n]*\?/],
  ['<=N', /:\s*(?:text|json|bytes|image|video)\s*<=/],
  ['M..N', /:\s*text\s+\d+\.\.\d+/],
  ['default', /:\s*[^\n]*\bdefault\s/],
  ['once', /:\s*image\b[^\n]*\bonce\b/],
  ['format', /:\s*[^\n]*\bformat\s/],
  ['format handle', /:\s*[^\n]*\bformat handle\b/],
  ['format url', /:\s*[^\n]*\bformat url\b/],
  ['count … by', /^\s*(?:view\s+)?\w+:\s*count\s/],
  ['sum … of … by', /^\s*(?:view\s+)?\w+:\s*sum\s/],
  ['unique', /^\s+unique\s/],
  ["unique … else CODE 'message'", /^\s+unique\s.*\belse\s+[A-Z_]+\s+'/],
  ['immutable', /^\s+immutable\s/],
  ['append only', /^\s+append only\b/],
  ['cap N', /^\s+cap\s+\d+\s*$/],
  ['cap N by', /^\s+cap\s+\d+\s+by\b/],
  ['by <index>: <columns>', /^\s+by\s+\w+:/],
  ['search', /^\s+search\s/],
  ['expire at', /^\s+expire at\s/],
  ['online only', /^\s+online only\b/],
  ['sync', /^\s+sync\b/],
  ['sync to', /^\s+sync to\b/],
  ['sync public', /^\s+sync public\b/],
  ['sync last N by', /^\s+sync\b.*\blast\s+\d+\s+by\b/],
  ['sync by .col', /^\s+sync\b(?:(?!\blast\b).)*\bby\s+\.\w+/],
  ['retain delivered-history', /^\s+retain delivered-history\b/],
  ['retain until-revoked', /^\s+retain until-revoked\b/],
  ['after insert', /^\s+after insert\s*<-/],
  ['public', /^\s+public\b|<-\s*public\b/],
  ...['read', 'insert', 'update', 'delete'].map(word => [word, new RegExp(`\\b${word}\\s*(?:<-|\\(|[a-z]\\w*(?:\\[|\\s*\\{))`)]),
  ['(old, next)', /^\s+update\s*\(old,\s*next\)/],
  ...['allow', 'deny'].map(word => [word, new RegExp(`<-\\s*${word}\\b`)]),
  ...['exists', 'created', 'viewer', 'now', 'new', 'connected', 'and', 'or', 'not', 'in', 'true', 'false', 'null']
    .map(word => [word, new RegExp(`(?<![.\\w])${word}\\b(?!\\s*:)`)]),
  ['where', /\bwhere\s/],
  ['first', /\bfirst\s+\d/],
  ['last N by', /\blast\s+\d/],
  ['by .col', /\bby\s+\.\w+/],
  ['by <index>', /\b(?:first|last)\s+\d+\s+by\s+[a-z]\w*/],
  ['after c', /\bafter\s+(?!insert\b)[a-z]\w*/],
  ['matching', /\bmatching\s/],
  ['merge', /\bmerge\s/],
  ['walk … up … depth', /\bwalk\s.+\bup\s.+\bdepth\s/],
  ['[key]', /\b[a-z]\w*\[[^\]]+\]/],
  ['[column = value]', /\b[a-z]\w*\[[^\]]*\b\w+\s*=\s*[^\]]+\]/],
  ['[column < value]', /\b[a-z]\w*\[[^\]]*\b\w+\s*[<>]=?\s*[^\]]+\]/],
  ['* (shape spread)', /\{\s*\*/],
  ['...shape', /\{[^}]*\.\.\.[a-z]/],
  ['.col', /(?<!\.)\.[a-z]\w*/],
  ...['count', 'sum', 'min', 'max', 'divmod', 'sorted', 'sort', 'slice', 'tokens', 'lower', 'trim', 'join', 'group', 'first', 'last', 'at', 'range', 'sha256', 'day', 'hour', 'bucket']
    .map(word => [`${word}(…)`, new RegExp(`(?<![.\\w])${word}\\(`)]),
  ['x = expr', /^\s+[a-z]\w*\s*=(?!=)/],
  ['(a, b) = expr', /^\s*\([a-z]\w*,\s*[a-z]\w*\)\s*=/],
  ['if', /^\s+if\s/],
  ['else if', /^\s+else if\s/],
  ['else', /^\s+else:/],
  ['for', /^\s+for\s/],
  ['chunk', /^\s+chunk\s/],
  ...['break', 'continue', 'return'].map(word => [word, new RegExp(`^\\s+${word}\\b`)]),
  ['if … else', /\bif\s+.+\s+else\s+(?![A-Z_]+\b)/],
  ['upsert', /\bupsert\s/],
  ['if absent', /\bif absent\b/],
  ['update … if', /\bupdate\s.+\bif\s/],
  ['require … else', /^\s+require\s.+\belse\s/],
  ['! else CODE', /!\s*else\s+[A-Z_]+/],
  ['??', /\?\?/],
  ['server', /^(?:query|mutation)\s.+:\s*server\b/],
  ['device', /^(?:query|mutation)\s.+:\s*device\b/],
  ['predicts', /^mutation\s.+\bpredicts:/],
  ['held', /^query\s.+\bheld:/],
  ['native', /^(?:query|job)\s.+:\s*native\b/],
  ['emit', /^\s+emit\s/],
  ['emit … once', /^\s+emit\s.+\bonce\s/],
  ['every', /^schedule\s.+\bevery\s/],
  ['at HH:MM', /^schedule\s.+\bat\s+\d+:\d+/],
  ['as service', /^(?:schedule|route)\s.+\bas service:/],
  ...['returns', 'secrets', 'retry', 'backoff', 'deadline', 'cancellation', 'wait', 'post']
    .map(word => [word, new RegExp(`^(?:action|route|effect)\\s.+\\b${word}\\s`)]),
  // Operators are independent authored terms; punctuation delimiting blocks,
  // arguments and collections is syntax, not an additional concept.
  ...['=', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%']
    .map(op => [op, new RegExp(`\\s${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`)]),
];
