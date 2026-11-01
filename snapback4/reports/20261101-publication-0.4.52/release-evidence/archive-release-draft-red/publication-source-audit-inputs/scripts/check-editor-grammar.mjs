#!/usr/bin/env node
// @ref LLP 3000.041#2.4 — freshness, the complete .q corpus, and published Quarry fences.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { generate, GRAMMAR, KEYWORDS, SCANNER_KEYWORDS, ROOT } from './generate-editor-grammar.mjs';
import { checkTreeSitter } from '../editors/tree-sitter-quarry/check.mjs';

export function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    if (['target', 'node_modules'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`editor grammar: symlink in corpus: ${path}; refusing to omit it`);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}
function fences(path) {
  const lines = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,})quarry\s*$/);
    if (!open) continue;
    const start = ++i;
    while (i < lines.length && !new RegExp(`^\\s*\x60{${open[1].length},}\\s*$`).test(lines[i])) i++;
    if (i === lines.length) throw new Error(`editor grammar: unclosed quarry fence at ${path}:${start}`);
    found.push({ path, startLine: start + 1, text: lines.slice(start, i).join('\n') });
  }
  return found;
}
export function runEditorSelfTests(binary, selfTests) {
  const env = { ...process.env, QUARRY_EDITOR_BINARY: resolve(binary) };
  // A regression invokes this runner from node:test; launch a fresh test runner.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', ...selfTests], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
}
async function main() {
  const started = performance.now();
  let binary = resolve(ROOT, 'target/debug/snapback4');
  let treeSitter = true;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tree-sitter') continue; // Explicit spelling of the default.
    if (args[i] === '--textmate-only') { treeSitter = false; continue; } // Timing/bisection, never the default fence.
    if (args[i] !== '--binary' || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('usage: check-editor-grammar.mjs [--binary <path>] [--tree-sitter | --textmate-only]');
    binary = resolve(args[++i]);
  }
  assert(!(args.includes('--tree-sitter') && args.includes('--textmate-only')), 'choose --tree-sitter or --textmate-only');
  const manifestPath = join(ROOT, 'editors/vscode/package.json');
  const require = createRequire(manifestPath);
  let textmate, oniguruma, wasm;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const name of ['vscode-textmate', 'vscode-oniguruma']) {
      const expected = manifest.devDependencies[name];
      const actual = require(`${name}/package.json`).version;
      if (!/^\d+\.\d+\.\d+$/.test(expected) || actual !== expected) throw new Error(`${name}: expected pinned ${expected}, installed ${actual}`);
    }
    textmate = require('vscode-textmate'); oniguruma = require('vscode-oniguruma');
    wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  } catch (error) { throw new Error(`editor grammar dependencies unavailable: ${error.message}; run bun install --frozen-lockfile in snapback4/editors/vscode/`); }
  const temp = mkdtempSync(join(tmpdir(), 'quarry-editor-'));
  try {
    const failures = [];
    const regenerated = join(temp, 'quarry.tmLanguage.json');
    const keywordsOutput = join(temp, 'keywords.generated.js');
    const manifestOutput = join(temp, 'package.json');
    const scannerOutput = join(temp, 'keywords.generated.h');
    generate({ binary, output: regenerated, keywordsOutput, manifestOutput, scannerOutput });
    if (readFileSync(SCANNER_KEYWORDS, 'utf8') !== readFileSync(scannerOutput, 'utf8')) failures.push('committed scanner keyword table differs: run node scripts/generate-editor-grammar.mjs');
    if (readFileSync(manifestPath, 'utf8') !== readFileSync(manifestOutput, 'utf8')) failures.push('committed firstLine differs: run node scripts/generate-editor-grammar.mjs');
    const committed = readFileSync(GRAMMAR, 'utf8');
    if (committed !== readFileSync(regenerated, 'utf8')) failures.push('committed grammar differs: run node scripts/generate-editor-grammar.mjs');
    if (readFileSync(KEYWORDS, 'utf8') !== readFileSync(keywordsOutput, 'utf8')) failures.push('committed tree-sitter keyword tables differ: run node scripts/generate-editor-grammar.mjs');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!JSON.parse(committed).comment.includes(`from snapback4 ${manifest.version} grammar --json`)) {
      failures.push('extension version differs from the generated grammar; align editors/vscode/package.json with snapback4 --version');
    }
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve({ createOnigScanner: patterns => new oniguruma.OnigScanner(patterns), createOnigString: value => new oniguruma.OnigString(value) }),
      loadGrammar: async scope => scope === 'source.quarry' ? textmate.parseRawGrammar(committed, GRAMMAR) : null,
    });
    const grammar = await registry.loadGrammar('source.quarry');
    assert(grammar, 'editor grammar: could not load source.quarry');
    function tokenize({ path, startLine = 1, text }) {
      let state = textmate.INITIAL;
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const result = grammar.tokenizeLine(lines[i], state);
        state = result.ruleStack;
        for (const token of result.tokens) {
          const value = lines[i].slice(token.startIndex, token.endIndex);
          if (value && !token.scopes.some(scope => scope !== 'source.quarry')) {
            failures.push(`${relative(ROOT, path)}:${startLine + i}:${token.startIndex + 1}: unscoped ${JSON.stringify(value)}`);
          }
        }
      }
    }
    const files = walk(ROOT).filter(path => path.endsWith('.q'));
    const sources = files.map(path => ({ path, text: readFileSync(path, 'utf8') }));
    if (!sources.some(source => source.text.trim())) throw new Error('editor grammar: empty .q corpus; refusing a vacuous pass');
    const guideDir = join(ROOT, 'crates/snapback4-lang/src/guide');
    const guideFiles = [join(ROOT, 'crates/snapback4-lang/src/guide.rs'), ...walk(guideDir).filter(path => /\.(rs|md)$/.test(path)), join(ROOT, 'packages/snapback4/README.md')];
    const snippets = guideFiles.flatMap(fences);
    if (!snippets.length || !snippets.some(snippet => snippet.text.trim())) throw new Error('editor grammar: empty quarry fence corpus; refusing a vacuous pass');
    for (const source of sources) tokenize(source);
    for (const snippet of snippets) tokenize(snippet);
    // Scope witnesses make a blanket catch-all incapable of satisfying the fence.
    for (const [text, part, scope] of [
      ['table todos:', 'table', 'keyword.declaration'], ['table todos:', 'todos', 'entity.name.type'],
      ['return todos[viewer].title', 'todos', 'entity.name.table'], ['return todos[viewer].title', 'viewer', 'variable.language'],
      ['return todos[viewer].title', 'title', 'variable.other.member'], ['text <=200', 'text', 'storage.type'],
      ['now + 5ms', '5', 'constant.numeric'], ['now + 5ms', 'ms', 'keyword.other.unit'],
      ['-- comment', 'comment', 'comment.line.double-dash'], ['"hello"', 'hello', 'string.quoted'],
      ['read <- allow', '<-', 'keyword.operator'],
    ]) {
      const at = text.indexOf(part);
      assert(grammar.tokenizeLine(text, textmate.INITIAL).tokens.some(token => token.startIndex <= at && token.endIndex > at && token.scopes.some(s => s.startsWith(scope + '.'))), `scope witness: ${text}: ${part} needs ${scope}`);
    }
    assert(grammar.tokenizeLine('§', textmate.INITIAL).tokens.some(token => token.scopes.length === 1), 'unknown punctuation must fall through');
    // Corpus-free witnesses: Rust trim_start applies only to ignored lines.
    for (const whitespace of ['\v', '\f', '\u0085', '\u00a0', '\u1680', '\u2003', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000']) {
      for (const text of [whitespace, `${whitespace}-- ignored`]) {
        assert(grammar.tokenizeLine(text, textmate.INITIAL).tokens.every(token => token.scopes.length > 1), `ignored Unicode whitespace scope witness: ${JSON.stringify(text)}`);
      }
      for (const text of [`${whitespace}return 1`, `return${whitespace}1`]) {
        assert(grammar.tokenizeLine(text, textmate.INITIAL).tokens.some(token => token.scopes.length === 1), `significant Unicode whitespace must fall through: ${JSON.stringify(text)}`);
      }
    }
    console.log('TextMate ignored-line Unicode whitespace witnesses: pass');
    // Feed one real compiler refusal through the shipped wrapper and matcher.
    const project = join(temp, 'diagnostic'); mkdirSync(join(project, 'snapback'), { recursive: true });
    writeFileSync(join(project, 'snapback/schema.q'), 'table example:\n  read: text\n');
    const result = spawnSync(process.execPath, [join(ROOT, 'editors/vscode/scripts/check-problems.mjs'), '--workspace', project, '--binary', binary], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 1, `diagnostic fixture: ${result.stderr}\n${result.stdout}`);
    const pattern = manifest.contributes.problemMatchers.find(m => m.name === 'quarry-check').pattern;
    const lines = result.stdout.trim().split('\n');
    assert(lines.length > 0, 'no wrapped compiler diagnostics');
    for (const line of lines) assert(new RegExp(pattern.regexp).test(line), `unmatched compiler diagnostic: ${line}`);
    assert(lines.some(line => line.includes(':2:3: E_QUARRY_RESERVED ') && line.includes(' | rename the column')), `missing located refusal/rewrite: ${result.stdout}`);
    registry.dispose();
    if (treeSitter) checkTreeSitter({ root: ROOT, temp, sources, snippets, binary, failures });
    const selfTests = [join(ROOT, 'scripts/check-editor-grammar.test.mjs'),
      ...walk(join(ROOT, 'editors/vscode/test')).filter(path => path.endsWith('.test.mjs')),
      ...(treeSitter ? [join(ROOT, 'editors/tree-sitter-quarry/check.test.mjs')] : [])];
    const tested = runEditorSelfTests(binary, selfTests);
    console.log(tested.stdout?.trim());
    if (tested.error || tested.status !== 0) failures.push(`editor self-tests failed: ${tested.error?.message ?? tested.signal ?? tested.status}\n${tested.stderr}`);
    for (const failure of failures) console.error(`editor grammar: ${failure}`);
    console.log(`editor grammar: ${files.length} .q files, ${snippets.length} quarry fences, ${failures.length} failures; ${(performance.now() - started).toFixed(0)} ms (${treeSitter ? 'TextMate + tree-sitter' : 'TextMate only; tree-sitter NOT checked'})`);
    if (failures.length) process.exitCode = 1;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
