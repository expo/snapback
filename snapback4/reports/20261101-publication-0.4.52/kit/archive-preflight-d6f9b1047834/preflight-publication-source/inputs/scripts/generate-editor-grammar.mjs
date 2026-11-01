#!/usr/bin/env node
// @ref LLP 3000.041#2.2 — generated lexical highlighting; Rust remains the parser of record.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(import.meta.dirname, '..');
export const MANIFEST = resolve(ROOT, 'editors/vscode/package.json');
export const GRAMMAR = resolve(ROOT, 'editors/vscode/syntaxes/quarry.tmLanguage.json');
export const SCANNER_KEYWORDS = resolve(ROOT, 'editors/tree-sitter-quarry/src/keywords.generated.h');
export const KEYWORDS = resolve(ROOT, 'editors/tree-sitter-quarry/keywords.generated.js');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = words => [...new Set(words)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).map(escape).join('|');
const word = words => `(?<![A-Za-z0-9_])(?:${alternatives(words)})(?![A-Za-z0-9_])`;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function lexicalFacts(binary = resolve(ROOT, 'target/debug/snapback4')) {
  binary = resolve(binary);
  if (!existsSync(binary)) throw new Error(`editor grammar: binary absent: ${binary}; run cargo build -p snapback4 in snapback4/ or pass --binary <path>`);
  const run = args => execFileSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const facts = JSON.parse(run(['grammar', '--json']));
  for (const key of ['two_character_symbols', 'hyphenated_words', 'table_words', 'binding_words', 'declaration_words', 'type_words', 'builtin_words', 'duration_units']) {
    if (!Array.isArray(facts[key]) || !facts[key].length || facts[key].some(word => typeof word !== 'string' || !word)) throw new Error(`editor grammar: invalid/empty ${key}`);
  }
  for (const key of ['comment', 'symbols']) if (typeof facts[key] !== 'string' || !facts[key]) throw new Error(`editor grammar: invalid ${key}`);
  const version = run(['--version']).trim();
  if (!/^snapback4 \d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error(`editor grammar: invalid binary version: ${version}`);
  return { facts, version };
}
export function grammarText({ facts: f, version }) {
  const scoped = (match, name) => ({ match, name: `${name}.quarry` });
  const string = quote => ({
    begin: escape(quote), end: `${escape(quote)}|$`, name: `string.quoted.${quote === '"' ? 'double' : 'single'}.quarry`,
    patterns: [scoped('\\\\.', 'constant.character.escape')],
  });
  // Every lexical token gets an explicit scope, including whitespace. No catch-all:
  // malformed/unknown punctuation remains source.quarry and fails the fence.
  const patterns = [
    // Rust trim_start ignores Unicode White_Space only on blank/comment lines.
    scoped(`^[ \\t\\x0b\\x0c\\x{85}\\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}]+(?=${escape(f.comment)}|$)`, 'meta.whitespace'),
    scoped(`${escape(f.comment)}.*$`, 'comment.line.double-dash'),
    string('"'), string("'"),
    // Three compiler-owned .q templates contain pre-expansion names. These
    // scopes describe placeholders, not additional accepted Quarry syntax.
    scoped('@[A-Z][A-Z0-9_]*@', 'variable.other.template'),
    scoped('\\$[A-Za-z_][A-Za-z0-9_]*', 'variable.other.template-local'),
    { match: `^([ \\t]*)(${alternatives(f.declaration_words)})([ \\t]+)([A-Za-z_][A-Za-z0-9_]*)`, captures: {
      1: { name: 'meta.whitespace.quarry' }, 2: { name: 'keyword.declaration.quarry' },
      3: { name: 'meta.whitespace.quarry' }, 4: { name: 'entity.name.type.quarry' },
    } },
    { match: '(\\.)([A-Za-z_][A-Za-z0-9_]*)', captures: { 1: { name: 'punctuation.accessor.quarry' }, 2: { name: 'variable.other.member.quarry' } } },
    // Index operands use the same expression patterns; no broad meta scope that
    // could hide a fallthrough inside brackets from the coverage fence.
    scoped('[A-Za-z_][A-Za-z0-9_]*(?=\\s*\\[)', 'entity.name.table'),
    { match: `(?<![A-Za-z0-9_])([0-9]+(?:\\.[0-9]+)?)([ \\t]*)(${alternatives([...f.duration_units, ...f.binding_words.filter(w => /^[A-Z]+$/.test(w))])})(?![A-Za-z0-9_])`, captures: {
      1: { name: 'constant.numeric.quarry' }, 2: { name: 'meta.whitespace.quarry' }, 3: { name: 'keyword.other.unit.quarry' },
    } },
    scoped('[0-9]+(?:\\.[0-9]+)?', 'constant.numeric'),
    scoped(`(?<![A-Za-z0-9_])(?:${alternatives(f.hyphenated_words)})(?![A-Za-z0-9_-])`, 'keyword.other.table-line'),
    scoped(word(f.builtin_words), 'variable.language'),
    scoped(word(f.declaration_words), 'keyword.declaration'),
    scoped(word(f.type_words), 'storage.type'),
    scoped(word(f.table_words), 'keyword.other.table-line'),
    scoped(word(f.binding_words), 'keyword.control'),
    scoped(word(f.duration_units), 'keyword.other.unit'),
    scoped(alternatives(f.two_character_symbols), 'keyword.operator'),
    scoped(alternatives([...f.symbols].filter(c => '()[]{}'.includes(c))), 'punctuation.section'),
    scoped(alternatives([...f.symbols].filter(c => !'()[]{}'.includes(c))), 'keyword.operator'),
    scoped('[A-Za-z_][A-Za-z0-9_]*', 'variable.other'),
    scoped('[ \\t]+', 'meta.whitespace'),
  ];
  return JSON.stringify(stable({
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    comment: `Generated by scripts/generate-editor-grammar.mjs from ${version} grammar --json. Do not edit.`,
    name: 'Quarry', scopeName: 'source.quarry', patterns,
  }), null, 2) + '\n';
}
export function keywordsText({ facts, version }) {
  return `// Generated by scripts/generate-editor-grammar.mjs from ${version} grammar --json. Do not edit.\n`
    + `module.exports = ${JSON.stringify(stable(Object.fromEntries(Object.entries(facts).map(([key, value]) =>
      [key, Array.isArray(value) ? [...value].sort() : value]))), null, 2)};\n`;
}
export function scannerKeywordsText({ facts }) {
  return '// Generated from grammar --json by scripts/generate-editor-grammar.mjs. Do not edit.\n'
    + `static const char *const hyphenated_words[] = {${[...facts.hyphenated_words].sort().map(word => JSON.stringify(word)).join(', ')}};\n`;
}
export function manifestText({ facts }, manifest) {
  manifest = structuredClone(manifest);
  manifest.contributes.languages.find(language => language.id === 'quarry').firstLine = `^\\s*(?:${escape(facts.comment)}|(?:${alternatives(facts.declaration_words)})\\b)`;
  return JSON.stringify(manifest, null, 2) + '\n';
}
export function generate({ binary, output = GRAMMAR, keywordsOutput = KEYWORDS, manifestOutput = MANIFEST, scannerOutput = SCANNER_KEYWORDS } = {}) {
  const facts = lexicalFacts(binary);
  const text = grammarText(facts);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  mkdirSync(dirname(keywordsOutput), { recursive: true });
  writeFileSync(keywordsOutput, keywordsText(facts));
  mkdirSync(dirname(scannerOutput), { recursive: true });
  writeFileSync(scannerOutput, scannerKeywordsText(facts));
  mkdirSync(dirname(manifestOutput), { recursive: true });
  writeFileSync(manifestOutput, manifestText(facts, JSON.parse(readFileSync(MANIFEST, 'utf8'))));
  return text;
}
function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!['--binary', '--output', '--keywords-output', '--manifest-output', '--scanner-output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('usage: generate-editor-grammar.mjs [--binary <path>] [--output <TextMate path>] [--keywords-output <tree-sitter path>] [--manifest-output <package.json path>] [--scanner-output <header path>]');
    const key = args[i] === '--keywords-output' ? 'keywordsOutput' : args[i] === '--manifest-output' ? 'manifestOutput' : args[i] === '--scanner-output' ? 'scannerOutput' : args[i].slice(2);
    options[key] = resolve(args[++i]);
  }
  generate(options);
  console.log(`editor grammar: wrote ${options.output ?? GRAMMAR}`);
  console.log(`editor grammar: wrote ${options.keywordsOutput ?? KEYWORDS}`);
  console.log(`editor grammar: wrote ${options.manifestOutput ?? MANIFEST}`);
  console.log(`editor grammar: wrote ${options.scannerOutput ?? SCANNER_KEYWORDS}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
