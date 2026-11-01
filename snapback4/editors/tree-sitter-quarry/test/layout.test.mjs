// Layout is the hand-written boundary with Rust; exercise recovery and edits too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
const grammar = resolve(import.meta.dirname, '..');
const cli = process.env.QUARRY_TREE_SITTER_CLI ?? join(grammar, 'node_modules/tree-sitter-cli/tree-sitter');
const temp = mkdtempSync(join(tmpdir(), 'quarry-layout-'));
const config = join(temp, 'config.json');
writeFileSync(config, JSON.stringify({ 'parser-directories': [resolve(grammar, '..')] }));
after(() => rmSync(temp, { recursive: true, force: true }));
let sequence = 0;
function parse(text, edits = []) {
  const path = join(temp, `${sequence++}.q`); writeFileSync(path, text);
  const result = spawnSync(cli, ['parse', '--config-path', config, path, ...edits.flatMap(e => ['--edits', e])], {
    cwd: grammar, env: { ...process.env, XDG_CACHE_HOME: join(temp, 'cache') }, encoding: 'utf8', timeout: 10000,
  });
  assert(!result.error && [0, 1].includes(result.status), result.error?.message ?? result.stderr);
  return { ok: result.status === 0 && !result.stdout.includes('(missing_delimiter '), tree: result.stdout.split(/\n[^\n]*\tParse:/)[0].trim() };
}
function clean(text) { const result = parse(text); assert(result.ok, result.tree); return result.tree; }
const blocks = tree => (tree.match(/\(block \[/g) ?? []).length;
for (const [name, text] of [
  ['blank and comment lines ignore their indentation', 'query q():\n\t-- ignored tab on comment\n \t\n  return 1\n    -- ignored deeper comment\n\nquery r():\n  return 2\n'],
  ['all grouping kinds suppress layout; strings and comments do not alter grouping', 'query q():\n  return (\n[\n{ value: "([{}])", other: 1 -- )]}\n}\n]\n)\n'],
  ['Unicode whitespace on ignored lines matches Rust trim_start', '\u00a0-- comment\n\u2003\nquery q():\n  return 1\n\u2028-- tail\n'],
  ['inline tabs are allowed', 'query q():\n  return\t1\n'],
  ['empty and comment-only files', '-- hello\n\t-- world\n\t\n'],
  ['final significant line without LF', 'query q():\n  if true:\n    return 1'],
  ['CRLF normalization', 'query q():\r\n  return 1\r\n'],
  ['lone CR normalization', 'query q():\r  return 1\r'],
]) test(name, () => clean(text));
test('deeper shape, and-space and or-space continue across blank/comments', () => {
  for (const suffix of ['{ value: 1 }', 'and true', 'or false']) {
    const tree = clean(`query q():\n  return true\n-- comment\n\n    ${suffix}\n  return false\n`);
    assert.equal(blocks(tree), 1, tree);
  }
});
test('same-depth and/or, prefixes and tab separators do not continue', () => {
  for (const suffix of ['andrew', 'orbit', 'and\ttrue', 'or\tfalse', '-{ value: 1 }']) {
    assert.equal(blocks(clean(`query q():\n  return true\n    ${suffix}\n`)), 2, suffix);
  }
  assert.equal((clean('query q():\n  return true\n  and false\n').match(/\(statement \[/g) ?? []).length, 2);
});
for (const [name, text] of [
  ['Unicode whitespace is not indentation', 'query q():\n\u00a0return 1\n'],
  ['unclosed string', 'query q():\n  return "x\n'],
  ['unknown punctuation at multiple sites', 'query q():\n  return @x\n  return $y\n'],
]) test(`${name} produces a parse error`, () => assert(!parse(text).ok));
test('scanner serialization survives incremental changes to layout and grouping', () => {
  for (const [before, needle, replacement] of [
    ['query q():\n  return true\n    and false\n', 'and false', 'other'],
    ['query q():\n  return (1)\n  return 2\n', '1', '\n    1\n  '],
    ['query q():\n  if true:\n    return 1\n  return 2\n', '    return 1', '  return 1'],
  ]) {
    const pos = before.indexOf(needle);
    const after = before.slice(0, pos) + replacement + before.slice(pos + needle.length);
    const edited = parse(before, [`${pos} ${needle.length} ${replacement}`]);
    assert(edited.ok, edited.tree);
    assert.equal(edited.tree, clean(after));
  }
});
test('CR grouping recovers leading tabs like LF', () => {
  for (const eol of ['\r', '\r\n', '\n']) clean(`query q():${eol}  return (${eol}\t1)${eol}`);
});
test('CR grouping ignores Unicode blank and comment lines', () => {
  for (const eol of ['\r', '\r\n', '\n']) {
    clean(`query q():${eol}  return (${eol}\u00a0-- ignored${eol}\u2003${eol}    1)${eol}`);
  }
});
test('logical CR line starts survive incremental serialization', () => {
  const before = 'query q():\r  return (\r\u00a0-- ignored\r    1)\r';
  const pos = Buffer.byteLength(before.slice(0, before.indexOf('1')));
  const edited = parse(before, [`${pos} 1 22`]);
  assert(edited.ok, edited.tree);
  assert.equal(edited.tree, clean(before.replace('1', '22')));
});
test('hyphenated keywords require the complete lexer boundary', () => {
  for (const value of ['until-revoked-extra', 'until-revoked1', 'until-revoked_', 'until-revoked-', 'delivered-history-extra']) {
    const tree = clean(`return ${value}\n`);
    assert(!/\(keyword \[0, 7\]/.test(tree), `${value}\n${tree}`);
    assert.match(tree, /\(operator /, 'the refused hyphenated word falls back to ordinary lexer tokens');
  }
  for (const value of ['until-revoked', 'delivered-history']) {
    assert.match(clean(`return ${value}\n`), /\(keyword \[0, 7\]/);
  }
});

test('leading tabs recover indent and preserve the following declaration', () => {
  const tree = clean('query q():\n\treturn 1\nquery r():\n  return 2\n');
  assert.equal(blocks(tree), 2, tree);
  assert.equal((tree.match(/\(declaration \[/g) ?? []).length, 2, tree);
  assert.equal(blocks(clean('\t-1\n')), 1, 'a tab before an initial negative value still emits Indent');
});
test('off-stack dedent pops to the enclosing level without inventing a new block', () => {
  const tree = clean('query q():\n    if true:\n        return 1\n      return 2\n    return 3\nquery r():\n  return 4\n');
  assert.equal(blocks(tree), 3, tree);
  assert.equal((tree.match(/\(declaration \[/g) ?? []).length, 2, tree);
});
for (const [name, ignored] of [['comment', '-- ignored\n'], ['blank', '\n'], ['mixed', '-- ignored\n \t\n\u00a0-- ignored too\n']]) {
  test(`off-stack dedent survives ${name} extras and incremental edits`, () => {
    for (const eol of ['\n', '\r', '\r\n']) {
      const source = `query q():\n    return 1\n${ignored}  return 2\nquery r():\n  return 3\n`.replaceAll('\n', eol);
      const tree = clean(source);
      assert.equal(blocks(tree), 2, tree);
      assert.equal((tree.match(/\(number \[/g) ?? []).length, 3, tree);
      const pos = Buffer.byteLength(source.slice(0, source.indexOf('2')));
      assert.equal(parse(source, [`${pos} 1 22`]).tree, clean(source.replace('2', '22')));
    }
  });
}
test('unclosed group recovers locally and flushes the enclosing block at EOF', () => {
  const result = parse('query q():\n  return (1\n    + 2\n');
  assert(!result.ok, result.tree);
  assert.equal(blocks(result.tree), 1, result.tree);
  assert.equal((result.tree.match(/\(number \[/g) ?? []).length, 2, result.tree);
  assert(!/\(ERROR \[0,/.test(result.tree), result.tree);
  assert.match(result.tree, /MISSING|missing_delimiter/, result.tree);
});

test('unclosed brackets and braces retain local recovery through an edit', () => {
  for (const [start, end] of [['(', ')'], ['[', ']'], ['{ value: ', '}'], ['([{ value: ', '}])']]) {
    const before = `query q():\n  return ${start}1\n`;
    const broken = parse(before);
    assert.equal(blocks(broken.tree), 1, broken.tree);
    assert.match(broken.tree, /missing_delimiter/);
    const repaired = parse(before, [`${Buffer.byteLength(before)} 0 ${end}`]);
    assert(repaired.ok, repaired.tree);
    assert.equal(repaired.tree, clean(before + end));
  }
});
