#!/usr/bin/env node
// issues/20260808-guide-shell-and-cli-examples-unverified: advisory checker
// binding documented `snapback <subcommand>` spellings to the real CLI
// surface.
//
// guide/conventions.md deliberately exempts `sh` fences from execution, so a
// documented command that does not exist is invisible to check-guide. This
// tool closes the cheapest half of that gap without executing anything: it
// extracts `snapback ...` invocations from shell-flavored code fences and
// validates the subcommand tokens against the composed CLI surface.
//
// Truth set (derived, never hand-listed):
//   - the packaged registry in packages/snapback-cli/index.mjs
//     (PACKAGED_CLI_COMMANDS `name:` entries plus nestedCliHelp([...]) paths,
//     including the `...[verbs].map((verb) => nestedCliHelp([...]))` forms);
//   - the native clap tree in src/cli.rs (every #[derive(clap::Subcommand)]
//     enum; variant names kebab-cased unless overridden by
//     #[command(name = "...")], nested one level through
//     #[command(subcommand)] fields, including subcommands routed through a
//     clap::Args struct such as AdminArgs).
// If either source fails to parse plausibly the script exits 2 loudly: an
// empty truth set would make every run a silent pass.
//
// What is scanned: fences whose info string starts with sh/bash/shell/
// console/text across guide/**/*.md (excluding eval-runs/ and generated
// *.generated.md pages) plus the two snapback-authoring SKILL.md copies.
// Additionally, EVERY scanned file plus guide/guide-flat.generated.md is
// line-scanned for the known-fictional `snapback host <verb>` spelling
// (tables and prose included), because that class historically leaked from
// the control-catalog generator rather than from a fence.
//
// Validation depth and limitations:
//   - the first token after `snapback` is always validated; the second token
//     is validated only when the first names a command with registered
//     subcommands (e.g. `store export`, `agent setup`) — commands whose
//     first positional is free-form (`guide <query>`, `run <function>`,
//     `generate <dir>`) are never second-token-checked;
//   - third-level verbs (`backup create plan`, `hosted lifecycle <verb>`)
//     are not validated;
//   - flags are not validated;
//   - inline code spans in prose are not scanned (fences only), and
//     backslash-continuation lines are treated as new lines, so a command
//     split immediately after `snapback \` would be missed;
//   - commented-out lines inside fences are skipped.
//
// Why warning-only: this is a standalone advisory harvest tool. It is
// deliberately NOT wired into check-guide, check-inventories, CI, or hooks;
// the orchestrator decides wiring. Exit 0 always by default; `--strict`
// exits 1 when findings exist. Exit 2 = the check itself could not run.
//
// Placeholders: tokens spelled `<like-this>`, `$VARS`, or listed in
// ALLOWED_FIRST_TOKENS below are treated as legitimate illustrative
// placeholders, not findings. Extend ALLOWED_FIRST_TOKENS (with a trailing
// comment saying where the spelling lives) when a legitimate schematic
// example trips the parser.
//
// Usage: node scripts/check-guide-shell-commands.mjs [--strict] [--json]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED_CLI_PATH = join(ROOT, 'packages', 'snapback-cli', 'index.mjs');
const NATIVE_CLI_PATH = join(ROOT, 'src', 'cli.rs');
const GUIDE_DIR = join(ROOT, 'guide');
const GUIDE_FLAT_PATH = join(GUIDE_DIR, 'guide-flat.generated.md');
const SKILL_PATHS = [
  join(ROOT, 'skills', 'snapback-authoring', 'SKILL.md'),
  join(ROOT, 'packages', 'snapback-cli', 'skills', 'snapback-authoring', 'SKILL.md'),
];
const FENCE_LANGS = new Set(['sh', 'bash', 'shell', 'console', 'text']);

// Exact first-token spellings accepted as deliberate schematic placeholders.
// Keep this list justified: every entry names where the spelling is used.
const ALLOWED_FIRST_TOKENS = new Set([
  // (none currently needed — placeholders in the corpus use <angle-bracket>
  // or $VAR spellings, which are skipped structurally)
]);

function log(msg) {
  process.stdout.write(`[guide-shell-commands] ${msg}\n`);
}
function abort(msg) {
  process.stderr.write(`[guide-shell-commands] ERROR: ${msg}\n`);
  process.exit(2);
}

function kebabCase(ident) {
  return ident.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Parse the packaged registry: top-level names plus nested verb paths. */
export function parsePackagedRegistry(source) {
  const top = new Set();
  const paths = [];

  const blockStart = source.indexOf('export const PACKAGED_CLI_COMMANDS');
  const blockEnd = source.indexOf(']);', blockStart);
  if (blockStart === -1 || blockEnd === -1) return { top, paths };
  const block = source.slice(blockStart, blockEnd);
  for (const match of block.matchAll(/name: '([a-z][a-z0-9-]*)'/g)) top.add(match[1]);

  // Literal nestedCliHelp(['a', 'b', ...]) paths. Arrays that end in a bare
  // identifier (the map forms) are handled below.
  for (const match of source.matchAll(/nestedCliHelp\(\s*\[([^\]]*)\]/g)) {
    const quoted = [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((item) => item[1]);
    const hasIdentifier = /(?:^|,)\s*[a-z_$][\w$]*\s*(?:,|$)/i.test(
      match[1].replace(/'[^']*'/g, ''),
    );
    if (quoted.length >= 2 && !hasIdentifier) paths.push(quoted);
  }

  // ...['show', 'doctor'].map((verb) => nestedCliHelp(['target', verb] ...
  for (const match of source.matchAll(
    /\.\.\.\[((?:'[a-z0-9-]+'(?:,\s*)?)+)\]\.map\(\(verb\) => nestedCliHelp\(\[([^\]]*?)verb/g,
  )) {
    const verbs = [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((item) => item[1]);
    const prefix = [...match[2].matchAll(/'([a-z0-9-]+)'/g)].map((item) => item[1]);
    for (const verb of verbs) paths.push([...prefix, verb]);
  }

  return { top, paths };
}

/**
 * Parse the clap derive tree in src/cli.rs: every Subcommand enum's variant
 * CLI names, nested one level via #[command(subcommand)] fields (directly in
 * a variant body or routed through a tuple variant's clap::Args struct).
 */
export function parseClapTree(source) {
  const enums = new Map(); // enum name -> [{ cliName, nestedType }]
  const enumPattern = /#\[derive\([^)]*Subcommand[^)]*\)\][^\n]*\n(?:#\[[^\n]*\n)*pub enum (\w+) \{\n([\s\S]*?)\n\}/g;
  for (const match of source.matchAll(enumPattern)) {
    const [, enumName, body] = match;
    const variants = [];
    let depth = 0;
    let pendingName = null;
    let attrBalance = 0;
    let attrText = '';
    let awaitingNested = false;
    let current = null;
    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('//')) continue; // doc + ordinary comments
      if (attrBalance > 0) {
        attrText += trimmed;
        attrBalance += (trimmed.match(/\[/g) ?? []).length - (trimmed.match(/\]/g) ?? []).length;
        if (attrBalance === 0 && depth === 0) {
          const name = /name\s*=\s*"([a-z0-9-]+)"/.exec(attrText);
          if (name && attrText.startsWith('#[command')) pendingName = name[1];
        }
        continue;
      }
      if (trimmed.startsWith('#[')) {
        attrText = trimmed;
        attrBalance = (trimmed.match(/\[/g) ?? []).length - (trimmed.match(/\]/g) ?? []).length;
        if (attrBalance === 0) {
          if (depth === 0) {
            const name = /name\s*=\s*"([a-z0-9-]+)"/.exec(trimmed);
            if (name && trimmed.startsWith('#[command')) pendingName = name[1];
          } else if (trimmed === '#[command(subcommand)]') {
            awaitingNested = true;
          }
        }
        continue;
      }
      if (depth === 0) {
        const variant = /^([A-Z][A-Za-z0-9]*)\s*(?:\(\s*([A-Za-z0-9_]+)\s*\))?\s*(\{)?\s*,?\s*$/.exec(trimmed);
        if (variant) {
          current = {
            cliName: pendingName ?? kebabCase(variant[1]),
            tupleType: variant[2] ?? null,
            nestedType: null,
          };
          variants.push(current);
          pendingName = null;
        }
      } else if (awaitingNested) {
        const field = /^(?:pub\s+)?\w+:\s*(?:Option<)?([A-Za-z0-9_]+)>?,?$/.exec(trimmed);
        if (field) {
          if (current) current.nestedType = field[1];
          awaitingNested = false;
        }
      }
      depth += (rawLine.match(/\{/g) ?? []).length - (rawLine.match(/\}/g) ?? []).length;
      if (depth < 0) depth = 0;
    }
    enums.set(enumName, variants);
  }

  // clap::Args structs that route a subcommand (e.g. AdminArgs -> AdminCommand).
  const structNested = new Map();
  for (const match of source.matchAll(/pub struct (\w+) \{\n([\s\S]*?)\n\}/g)) {
    const routed = /#\[command\(subcommand\)\]\s*(?:pub\s+)?\w+:\s*(?:Option<)?(\w+)>?,/.exec(match[2]);
    if (routed) structNested.set(match[1], routed[1]);
  }

  const cliStruct = /pub struct Cli \{\n([\s\S]*?)\n\}/.exec(source);
  const topEnumName = cliStruct
    ? /#\[command\(subcommand\)\]\s*(?:pub\s+)?\w+:\s*Option<(\w+)>/.exec(cliStruct[1])?.[1]
    : null;

  return { enums, structNested, topEnumName };
}

/** Compose both truth sources into { topLevel: Set, children: Map<name, Set> }. */
export function buildCommandSurface() {
  const packagedSource = readFileSync(PACKAGED_CLI_PATH, 'utf8');
  const nativeSource = readFileSync(NATIVE_CLI_PATH, 'utf8');

  const packaged = parsePackagedRegistry(packagedSource);
  const clap = parseClapTree(nativeSource);

  if (packaged.top.size < 10) {
    abort(`packaged registry parse drifted: only ${packaged.top.size} top-level names from ${PACKAGED_CLI_PATH}`);
  }
  if (!clap.topEnumName || !clap.enums.has(clap.topEnumName)) {
    abort(`clap parse drifted: could not resolve the top-level Subcommand enum in ${NATIVE_CLI_PATH}`);
  }

  const topLevel = new Set(packaged.top);
  const children = new Map();
  const addChild = (parent, child) => {
    if (!children.has(parent)) children.set(parent, new Set(['help']));
    children.get(parent).add(child);
  };

  for (const variant of clap.enums.get(clap.topEnumName)) {
    topLevel.add(variant.cliName);
    const nestedEnum = variant.nestedType ?? (variant.tupleType ? clap.structNested.get(variant.tupleType) : null);
    if (nestedEnum && clap.enums.has(nestedEnum)) {
      for (const child of clap.enums.get(nestedEnum)) addChild(variant.cliName, child.cliName);
    }
  }
  for (const path of packaged.paths) {
    topLevel.add(path[0]);
    if (path.length >= 2) addChild(path[0], path[1]);
  }
  topLevel.add('help'); // clap's implicit help subcommand

  if (topLevel.size < 25 || !topLevel.has('dev') || !children.get('store')?.has('export')) {
    abort('composed CLI surface failed sanity spot-checks (size, dev, store export) — parser drift');
  }
  return { topLevel, children };
}

function listScanFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'eval-runs') walk(path);
      } else if (entry.endsWith('.md') && !entry.endsWith('.generated.md')) {
        files.push(path);
      }
    }
  };
  walk(GUIDE_DIR);
  for (const path of SKILL_PATHS) {
    if (existsSync(path)) files.push(path);
    else abort(`expected SKILL.md copy missing: ${path}`);
  }
  return files;
}

const SEGMENT_SPLIT = /\|\||&&|;|\|(?!\|)|\$\(|`/;
const PLACEHOLDER = /^<[^>]*>?$|^\$|^\{/;

/** Extract `snapback ...` invocations from one shell-ish line. */
function invocationsInLine(line) {
  let text = line.replace(/^\s*[$>]\s+/, '');
  if (text.trim().startsWith('#')) return [];
  text = text.replace(/\s#\s.*$/, ''); // trailing comment
  const found = [];
  for (const segment of text.split(SEGMENT_SPLIT)) {
    let tokens = segment.trim().split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
    while (tokens.length > 0 && ['sudo', 'time', 'exec', 'command', 'env', 'npx', 'bunx'].includes(tokens[0])) tokens.shift();
    if (tokens.length === 0) continue;
    if (tokens[0] !== 'snapback' && !tokens[0].endsWith('/snapback')) continue;
    found.push(tokens);
  }
  return found;
}

export function auditFiles({ commandSurface = buildCommandSurface(), files = null } = {}) {
  const { topLevel, children } = commandSurface;
  const findings = [];
  const seen = new Set();
  let invocationCount = 0;
  const addFinding = (file, lineNumber, cls, detail, excerpt) => {
    const key = `${file}:${lineNumber}:${cls}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: relative(ROOT, file), line: lineNumber, class: cls, detail, excerpt: excerpt.trim().slice(0, 160) });
  };

  const scanFiles = files ?? listScanFiles();
  for (const file of scanFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let fenceLang = null;
    lines.forEach((line, index) => {
      const fence = /^\s*```(.*)$/.exec(line);
      if (fence) {
        fenceLang = fenceLang === null ? (fence[1].trim().split(/\s+/)[0] || '') : null;
        return;
      }
      if (fenceLang === null || !FENCE_LANGS.has(fenceLang)) return;
      for (const tokens of invocationsInLine(line)) {
        invocationCount += 1;
        const first = tokens[1];
        if (first === undefined || first.startsWith('-')) continue;
        if (PLACEHOLDER.test(first) || ALLOWED_FIRST_TOKENS.has(first)) continue;
        if (first === 'host') {
          addFinding(file, index + 1, 'fictional-host', tokens.slice(0, 3).join(' '), line);
          continue;
        }
        if (!topLevel.has(first)) {
          addFinding(file, index + 1, 'unknown-command', `snapback ${first}`, line);
          continue;
        }
        const verbs = children.get(first);
        const second = tokens[2];
        if (
          verbs && second !== undefined && !second.startsWith('-') &&
          !PLACEHOLDER.test(second) && !second.includes('/') && !second.includes('.') &&
          !verbs.has(second)
        ) {
          addFinding(file, index + 1, 'unknown-subcommand', `snapback ${first} ${second}`, line);
        }
      }
    });
  }

  // Fictional `snapback host <verb>` line scan over everything, including the
  // generated flat guide (its control-catalog tables carried this class).
  for (const file of [...scanFiles, GUIDE_FLAT_PATH]) {
    if (!existsSync(file)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/\bsnapback host\b/.test(line)) {
        addFinding(file, index + 1, 'fictional-host', /\bsnapback host\b[^|`]*/.exec(line)[0].trim(), line);
      }
    });
  }

  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { findings, invocationCount, fileCount: scanFiles.length + 1 };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg !== '--strict' && arg !== '--json');
  if (unknown.length > 0) {
    process.stderr.write(`[guide-shell-commands] unknown argument(s): ${unknown.join(' ')}\n`);
    process.stderr.write('usage: node scripts/check-guide-shell-commands.mjs [--strict] [--json]\n');
    process.exit(2);
  }

  const commandSurface = buildCommandSurface();
  const { findings, invocationCount, fileCount } = auditFiles({ commandSurface });

  if (json) {
    process.stdout.write(`${JSON.stringify({ findings, invocationCount, fileCount }, null, 2)}\n`);
  } else {
    for (const finding of findings) {
      log(`${finding.file}:${finding.line}: ${finding.class}: ${finding.detail}`);
      log(`  ${finding.excerpt}`);
    }
    log(
      `scanned ${fileCount} file(s), ${invocationCount} snapback invocation(s) in shell fences; ` +
      `${findings.length} finding(s) ` +
      `(known CLI surface: ${commandSurface.topLevel.size} top-level commands, ` +
      `${commandSurface.children.size} with validated subcommand verbs)`,
    );
    if (findings.length > 0) {
      log('advisory only: verify each spelling against `snapback --help` / the clap tree before editing docs');
    }
  }

  if (strict && findings.length > 0) process.exit(1);
  process.exit(0);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
