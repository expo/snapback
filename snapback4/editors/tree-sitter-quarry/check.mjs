// @ref LLP 3000.041#2.4 — a total corpus census, not Rust AST conformance.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export function checkTreeSitter({ root, temp, sources, snippets, binary, failures }) {
  const started = performance.now();
  assert(sources.length && sources.some(source => source.text.trim()), 'tree-sitter: empty .q corpus; refusing a vacuous pass');
  const home = join(root, 'editors/tree-sitter-quarry');
  const build = join(temp, 'tree-sitter-quarry');
  mkdirSync(build);
  const require = createRequire(join(home, 'package.json'));
  let cli;
  try {
    const pin = JSON.parse(readFileSync(join(home, 'package.json'))).devDependencies['tree-sitter-cli'];
    const installed = require('tree-sitter-cli/package.json').version;
    assert(/^\d+\.\d+\.\d+$/.test(pin) && installed === pin, `expected pinned ${pin}, installed ${installed}`);
    cli = join(dirname(require.resolve('tree-sitter-cli/package.json')), process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter');
    assert(existsSync(cli), 'tree-sitter-cli native executable absent (install script must run)');
  } catch (error) {
    throw new Error(`tree-sitter-cli unavailable: ${error.message}; run bun install --frozen-lockfile in snapback4/editors/tree-sitter-quarry/`);
  }
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, XDG_CACHE_HOME: join(temp, 'cache'), NO_COLOR: '1', QUARRY_TREE_SITTER_CLI: cli };
  function run(command, args, allowed = [0], input, collect = false, cwd = build) {
    const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error || !allowed.includes(result.status)) {
      const message = `tree-sitter: ${command} ${args.join(' ')} failed (${result.error?.message ?? result.signal ?? result.status})\n${result.stderr}\n${result.stdout}`;
      if (!collect || result.error || result.signal) throw new Error(message);
      failures.push(message);
    }
    return result.stdout;
  }
  const version = run(cli, ['--version']);
  assert(version.startsWith(`tree-sitter ${require('tree-sitter-cli/package.json').version} `), 'tree-sitter executable does not match pinned package');
  // Probe an actual compile, not just `cc --version`. Cache/build output stays in temp.
  try { run(process.env.CC || 'cc', ['-x', 'c', '-', '-o', join(build, 'compiler-probe')], [0], 'int main(void) { return 0; }\n'); }
  catch (error) { throw new Error(`tree-sitter: C compiler unavailable or cannot build; refusing to skip: ${error.message}`); }
  for (const path of ['grammar.js', 'tree-sitter.json', 'package.json', 'src/scanner.c', 'queries', 'test']) {
    cpSync(join(home, path), join(build, path), { recursive: true });
  }
  // Fresh keyword bytes, already compared with the committed file by the caller.
  cpSync(join(temp, 'keywords.generated.js'), join(build, 'keywords.generated.js'));
  cpSync(join(temp, 'keywords.generated.h'), join(build, 'src/keywords.generated.h'));
  const config = join(temp, 'tree-sitter-config.json');
  writeFileSync(config, JSON.stringify({ 'parser-directories': [temp] }));
  run(cli, ['generate']);
  console.log('tree-sitter generate: exit 0 (temporary build)');
  // Test reds must not prevent the complete corpus from reporting its sites.
  const test = run(cli, ['test', '--config-path', config], [0], undefined, true);
  if (!/Total parses: [1-9]\d*;/.test(test)) failures.push('tree-sitter: empty or missing test census; refusing a vacuous pass');
  console.log(test.trim());
  console.log(run(process.execPath, ['--test', 'test/layout.test.mjs'], [0], undefined, true).trim());
  // Compile every query, including optional folding/indent captures.
  for (const query of ['highlights', 'folds', 'indents']) {
    run(cli, ['query', '--quiet', '--config-path', config, join(build, `queries/${query}.scm`), sources[0].path]);
  }
  const templates = new Set(['crates/snapback4-lang/src/bind/receipts.q', 'crates/snapback4-lang/src/bind/timeline.q', 'crates/snapback4-lang/src/recipe/bridge.q']);
  const exceptions = new Map();
  for (const [i, line] of readFileSync(join(home, 'expected-errors.txt'), 'utf8').split('\n').entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+#\s+(template: .+|syntax (E_QUARRY_[A-Z_]+): .+)$/);
    assert(match, `expected-errors.txt:${i + 1}: path and classified reason required`);
    const [, path, reason, code] = match;
    assert(!exceptions.has(path), `duplicate tree-sitter exception: ${path}`);
    assert(sources.some(source => relative(root, source.path) === path), `tree-sitter exception absent from corpus: ${path}`);
    if (reason.startsWith('template:')) assert(templates.has(path), `not a compiler-owned template: ${path}`);
    else {
      assert(/^crates\/[^/]+\/tests\/(fixtures|security)\//.test(path), `not a refusal fixture: ${path}`);
      // Rust acceptance never qualifies as an exception. E_QUARRY_SYNTAX is the
      // lexer's/parser's syntax family; binder/semantic diagnostics do not count.
      assert.equal(code, 'E_QUARRY_SYNTAX', `exception must name a syntax diagnostic: ${path}`);
      const project = join(temp, `syntax-${i}`);
      mkdirSync(join(project, 'snapback'), { recursive: true });
      cpSync(join(root, path), join(project, 'snapback/schema.q'));
      const checked = run(binary, ['check', '--json'], [0, 1], undefined, false, project);
      const diagnostics = JSON.parse(checked).problems;
      assert(diagnostics?.some(d => d.code === code), `Rust no longer refuses ${path} with ${code}`);
    }
    exceptions.set(path, reason);
  }
  const templateDir = join(temp, 'templates'); mkdirSync(templateDir);
  const inputs = new Map(sources.map((source, i) => {
    let path = source.path;
    if (exceptions.get(relative(root, source.path))?.startsWith('template:')) {
      // Preserve byte positions while replacing only the declared placeholders.
      const vocabulary = exceptions.get(relative(root, source.path)).slice('template: '.length).split(/\s+/);
      assert(vocabulary.every(value => /^@[A-Z][A-Z0-9_]*@$/.test(value) || value === '$locals'), `invalid template vocabulary: ${source.path}`);
      let expanded = source.text;
      // receipts.rs expands all ASCII alphanumeric/underscore dollar locals;
      // timeline.rs and bridge.rs perform only their enumerated replacements.
      if (vocabulary.includes('$locals')) expanded = expanded.replace(/\$[A-Za-z0-9_]*/g, value => value.replace('$', '_'));
      for (const placeholder of vocabulary.filter(value => value !== '$locals')) {
        expanded = expanded.replaceAll(placeholder, placeholder.replaceAll('@', '_'));
      }
      assert.notEqual(expanded, source.text, `stale template exception (no placeholders): ${source.path}`);
      path = join(templateDir, `${i}.q`); writeFileSync(path, expanded);
    }
    return [path, { ...source, startLine: 1 }];
  }));
  const snippetDir = join(temp, 'snippets'); mkdirSync(snippetDir);
  snippets.forEach((snippet, i) => {
    const path = join(snippetDir, `${i}.q`); writeFileSync(path, snippet.text);
    inputs.set(path, snippet);
  });
  assert(sources.length && [...inputs.values()].some(source => source.text.trim()), 'tree-sitter: empty .q corpus');
  const paths = join(temp, 'quarry-paths.txt');
  writeFileSync(paths, [...inputs.keys()].join('\n') + '\n');
  const parsed = run(cli, ['parse', '--quiet', '--json', '--config-path', config, '--paths', paths], [0, 1]);
  // CLI 0.25 prints a human error summary before its JSON; successful is based
  // on traversal of is_error OR is_missing, not just the first ERROR string.
  const jsonStart = parsed.indexOf('{\n  "parse_summaries":');
  assert(jsonStart >= 0, 'tree-sitter: missing parse summary');
  const summaries = JSON.parse(parsed.slice(jsonStart)).parse_summaries;
  assert.equal(summaries.length, inputs.size, 'tree-sitter did not parse the entire corpus');
  const seen = new Set();
  const errorQuery = join(temp, 'errors.scm');
  writeFileSync(errorQuery, '(ERROR) @error\n(MISSING) @missing\n(missing_delimiter) @missing\n');
  // Query the complete census once, including explicit local EOF recovery nodes
  // which tree-sitter's built-in successful flag does not count as MISSING.
  const located = new Map([...inputs.keys()].map(path => [path, []]));
  const output = run(cli, ['query', '--config-path', config, errorQuery, '--paths', paths]);
  let current;
  for (const line of output.split('\n')) {
    if (inputs.has(line)) { current = line; continue; }
    const site = line.match(/^\s+capture: (?:\d+ - )?(error|missing), start: \((\d+), (\d+)\), end:/);
    if (site) { assert(current, 'tree-sitter query returned a site without a corpus path'); located.get(current).push(site); }
  }
  for (const summary of summaries) {
    assert(inputs.has(summary.file) && !seen.has(summary.file), `tree-sitter: unexpected/duplicate file ${summary.file}`);
    seen.add(summary.file);
    assert.equal(typeof summary.successful, 'boolean');
    const source = inputs.get(summary.file);
    const path = relative(root, source.path);
    const expected = exceptions.get(path)?.startsWith('syntax ') && summary.file === source.path;
    const sites = located.get(summary.file);
    if (summary.successful && !sites.length) {
      if (expected) failures.push(`${path}:1:1: stale tree-sitter exception (parses cleanly)`);
      continue;
    }
    // The CLI parse summary reports only the first site. Query the entire tree
    // for BOTH classes, including unnamed missing terminals, to print them all.
    assert(sites.length, `tree-sitter: unsuccessful parse with no located ERROR/MISSING: ${path}`);
    if (!expected) for (const [, kind, row, col] of sites) {
      failures.push(`${path}:${source.startLine + Number(row)}:${Number(col) + 1}: tree-sitter ${kind.toUpperCase()}`);
    }
  }
  console.log(`tree-sitter: ${sources.length} .q files, ${snippets.length} quarry fences, ${exceptions.size} verified expected-error files; ${(performance.now() - started).toFixed(0)} ms`);
}
