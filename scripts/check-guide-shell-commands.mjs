#!/usr/bin/env node
// issues/20260808-guide-shell-and-cli-examples-unverified: strict checker
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
//   - the native clap tree in crates/snapback-cli/src/cli.rs (every #[derive(clap::Subcommand)]
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
//   - registered command paths are validated recursively, including third-
//     level verbs (`backup create plan`, `hosted lifecycle <verb>`); commands
//     whose next token is a free-form positional stop at their registered
//     path;
//   - flags are checked against the union of packaged usage/dispatch spellings
//     and native Clap `long` declarations. This rejects nonexistent flags but
//     deliberately does not claim command-specific flag placement;
//   - inline code spans in prose are not scanned (fences only), and
//     backslash-continuation lines are treated as new lines, so a command
//     split immediately after `snapback \` would be missed;
//   - commented-out lines inside fences are skipped.
//
// Publication and starter facts are also source-bound: exact @expo/snapback-*
// versions in shell examples must equal guide/published-closure.json's newest
// published version, and non-global install commands must use the package
// manager declared by every packaged template.
//
// Exceptions use fence attributes, never prose convention:
//   ```sh shell-check=skip class="credentialed" reason="operator-only example"
// Both class and reason are mandatory and the fence remains structurally
// inspected for a well-formed exception, but its commands are not validated.
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
const NATIVE_CLI_PATH = join(ROOT, 'crates', 'snapback-cli', 'src', 'cli.rs');
const GUIDE_DIR = join(ROOT, 'guide');
const GUIDE_FLAT_PATH = join(GUIDE_DIR, 'guide-flat.generated.md');
const PUBLISHED_CLOSURE_PATH = join(GUIDE_DIR, 'published-closure.json');
const TEMPLATE_DIR = join(ROOT, 'packages', 'snapback-cli', 'templates');
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

/** Extract source-declared long flag spellings without executing the CLI. */
export function parsePackagedFlags(source) {
  return new Set([...source.matchAll(/--([a-z][a-z0-9-]*)/g)].map((match) => `--${match[1]}`));
}

/** Extract #[arg(long)] / #[arg(long = "...")] declarations from Clap source. */
export function parseClapFlags(source) {
  const flags = new Set(['--help', '--version']);
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('#[arg(')) continue;
    let attribute = lines[index].trim();
    while (!attribute.includes(')]') && index + 1 < lines.length) {
      index += 1;
      attribute += lines[index].trim();
    }
    if (!/\blong\b/.test(attribute)) continue;
    for (const alias of attribute.matchAll(/\bvisible_alias\s*=\s*"([a-z0-9-]+)"/g)) {
      flags.add(`--${alias[1]}`);
    }
    const explicit = /\blong\s*=\s*"([a-z0-9-]+)"/.exec(attribute)?.[1];
    if (explicit) {
      flags.add(`--${explicit}`);
      continue;
    }
    let fieldIndex = index + 1;
    while (fieldIndex < lines.length && /^(\s*#|\s*\/\/|\s*$)/.test(lines[fieldIndex])) fieldIndex += 1;
    const field = /\b(?:pub\s+)?([a-z][a-z0-9_]*)\s*:/.exec(lines[fieldIndex] ?? '')?.[1];
    if (field) flags.add(`--${field.replaceAll('_', '-')}`);
  }
  return flags;
}

/**
 * Parse the clap derive tree in crates/snapback-cli/src/cli.rs: every Subcommand enum's variant
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

/** Compose both truth sources into a recursive command path and flag surface. */
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
  const pathChildren = new Map();
  const addPath = (path) => {
    for (let index = 1; index < path.length; index += 1) {
      const parent = path.slice(0, index).join(' ');
      if (!pathChildren.has(parent)) pathChildren.set(parent, new Set(['help']));
      pathChildren.get(parent).add(path[index]);
    }
  };

  const visitClap = (enumName, prefix = [], visited = new Set()) => {
    const visitKey = `${enumName}:${prefix.join(' ')}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    for (const variant of clap.enums.get(enumName) ?? []) {
      const path = [...prefix, variant.cliName];
      topLevel.add(path[0]);
      addPath(path);
      const nestedEnum = variant.nestedType ?? (variant.tupleType ? clap.structNested.get(variant.tupleType) : null);
      if (nestedEnum && clap.enums.has(nestedEnum)) visitClap(nestedEnum, path, visited);
    }
  };
  visitClap(clap.topEnumName);
  for (const path of packaged.paths) {
    topLevel.add(path[0]);
    addPath(path);
  }
  topLevel.add('help'); // clap's implicit help subcommand

  const flags = new Set([
    ...parsePackagedFlags(packagedSource),
    ...parseClapFlags(nativeSource),
  ]);

  if (
    topLevel.size < 25 || !topLevel.has('dev') ||
    !pathChildren.get('store')?.has('export') ||
    !pathChildren.get('backup create')?.has('plan') ||
    flags.size < 50 || !flags.has('--json')
  ) {
    abort('composed CLI surface failed sanity spot-checks (size, dev, store export) — parser drift');
  }
  return { topLevel, pathChildren, flags };
}

export function loadSourceFacts() {
  let closure;
  try {
    closure = JSON.parse(readFileSync(PUBLISHED_CLOSURE_PATH, 'utf8'));
  } catch (error) {
    abort(`could not read ${PUBLISHED_CLOSURE_PATH}: ${error.message}`);
  }
  if (
    closure?.schemaVersion !== 'snapback-published-closure.v1' ||
    !/^\d+\.\d+\.\d+$/.test(closure?.newestPublished ?? '')
  ) {
    abort(`${PUBLISHED_CLOSURE_PATH} does not carry a valid newestPublished version`);
  }

  const declarations = [];
  for (const template of readdirSync(TEMPLATE_DIR).sort()) {
    const packagePath = join(TEMPLATE_DIR, template, 'package.json');
    if (!existsSync(packagePath)) continue;
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (typeof manifest.packageManager !== 'string') {
      abort(`${relative(ROOT, packagePath)} must declare packageManager`);
    }
    declarations.push({ template, packageManager: manifest.packageManager });
  }
  const packageManagers = new Set(declarations.map(({ packageManager }) => packageManager));
  if (declarations.length < 3 || packageManagers.size !== 1) {
    abort(`template packageManager declarations disagree: ${[...packageManagers].join(', ')}`);
  }
  const packageManager = declarations[0].packageManager;
  const match = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/.exec(packageManager);
  if (!match) abort(`template packageManager must be an exact name@version declaration: ${packageManager}`);
  return {
    newestPublished: closure.newestPublished,
    packageManager: match[1],
    packageManagerVersion: match[2],
  };
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

export function auditFiles({
  commandSurface = buildCommandSurface(),
  sourceFacts = loadSourceFacts(),
  files = null,
} = {}) {
  const { topLevel, pathChildren, flags } = commandSurface;
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
    let fenceException = null;
    lines.forEach((line, index) => {
      const fence = /^\s*```(.*)$/.exec(line);
      if (fence) {
        if (fenceLang === null) {
          const info = fence[1].trim();
          fenceLang = info.split(/\s+/)[0] || '';
          if (/\bshell-check=skip\b/.test(info)) {
            const cls = /\bclass="([^"]+)"/.exec(info)?.[1];
            const reason = /\breason="([^"]+)"/.exec(info)?.[1];
            if (!cls || !reason) {
              addFinding(file, index + 1, 'invalid-exception', 'shell-check=skip requires class="..." and reason="..."', line);
            } else {
              fenceException = { class: cls, reason };
            }
          }
        } else {
          fenceLang = null;
          fenceException = null;
        }
        return;
      }
      if (fenceLang === null || !FENCE_LANGS.has(fenceLang)) return;
      if (fenceException) return;
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
        let path = first;
        for (let tokenIndex = 2; pathChildren.has(path) && tokenIndex < tokens.length; tokenIndex += 1) {
          const token = tokens[tokenIndex].replace(/[,)]$/, '');
          if (token.startsWith('-') || PLACEHOLDER.test(token) || token.includes('/') || token.includes('.')) break;
          if (!pathChildren.get(path).has(token)) {
            addFinding(file, index + 1, 'unknown-subcommand', `snapback ${path} ${token}`, line);
            break;
          }
          path = `${path} ${token}`;
        }
        for (const token of tokens.slice(2)) {
          if (!token.startsWith('--') || token === '--') continue;
          const flag = token.split('=')[0].replace(/[,)]$/, '');
          if (!flags.has(flag)) {
            addFinding(file, index + 1, 'unknown-flag', flag, line);
          }
        }
      }

      for (const match of line.matchAll(/@expo\/snapback-[a-z0-9-]+@(latest|\d+\.\d+\.\d+)/g)) {
        if (match[1] === 'latest') {
          addFinding(file, index + 1, 'unbound-closure-version', match[0], line);
        } else if (match[1] !== sourceFacts.newestPublished) {
          addFinding(
            file,
            index + 1,
            'stale-closure-version',
            `${match[0]} (newest published: ${sourceFacts.newestPublished})`,
            line,
          );
        }
      }

      const install = /^\s*(?:[$>]\s+)?(npm|pnpm|yarn|bun)\s+install\b(?!.*\s-g\b)/.exec(line);
      if (install && install[1] !== sourceFacts.packageManager) {
        addFinding(
          file,
          index + 1,
          'package-manager-mismatch',
          `${install[1]} install (templates declare ${sourceFacts.packageManager}@${sourceFacts.packageManagerVersion})`,
          line,
        );
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
      `${commandSurface.pathChildren.size} registered command paths, ` +
      `${commandSurface.flags.size} source-declared flags)`,
    );
    if (findings.length > 0) {
      log('repair each spelling or add a classed, reasoned shell-check exception');
    }
  }

  if (strict && findings.length > 0) process.exit(1);
  process.exit(0);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
