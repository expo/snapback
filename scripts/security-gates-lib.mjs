import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AST_MANIFEST = resolve(REPOSITORY_ROOT, 'scripts/security-gates-rust/Cargo.toml');
export const AST_TARGET = resolve(REPOSITORY_ROOT, 'target/security-gates-rust');
export const AST_BINARY = resolve(AST_TARGET, 'debug/snapback-security-gates-rust');

export class GateInfrastructureError extends Error {}

export function runCargoMetadata(manifestPath, { noDeps = true } = {}) {
  const args = ['metadata', '--format-version', '1', '--manifest-path', manifestPath];
  if (noDeps) args.push('--no-deps');
  const result = spawnSync('cargo', args, {
    cwd: dirname(manifestPath),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new GateInfrastructureError(
      `cargo metadata failed for ${manifestPath}\n${result.stderr || result.stdout}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new GateInfrastructureError(`cargo metadata returned invalid JSON: ${error.message}`);
  }
}

export function workspacePackages(metadata) {
  const members = new Set(metadata.workspace_members);
  return metadata.packages.filter((entry) => members.has(entry.id));
}

export function libraryTarget(pkg) {
  return pkg.targets.find((target) => target.kind.includes('lib'));
}

function localFeatureClosure(features, selected) {
  const active = new Set();
  const pending = [...selected];
  while (pending.length > 0) {
    const feature = pending.pop();
    if (active.has(feature) || !(feature in features)) continue;
    active.add(feature);
    for (const value of features[feature]) {
      const local = value.replace(/^dep:/u, '').split('/')[0].replace(/\?$/u, '');
      if (local in features) pending.push(local);
    }
  }
  return [...active].sort();
}

// @ref LLP 0284#44-caller-feature-predicate-coverage — the exact default cell
// is paired with a symbolic cell in which every caller feature atom is unknown.
// The AST helper therefore retains every satisfiable positive/negative feature
// predicate without enumerating an unsound additive matrix or 2^N assignments.
export function featureCells(pkg) {
  const defaults = localFeatureClosure(pkg.features, ['default']);
  return [
    { label: 'default', features: defaults },
    {
      label: 'caller-features',
      features: ['__SNAPBACK_SYMBOLIC_CALLER_FEATURES__'],
    },
  ];
}

export function ensureAstTool() {
  const newestInput = [
    AST_MANIFEST,
    resolve(dirname(AST_MANIFEST), 'Cargo.lock'),
    resolve(dirname(AST_MANIFEST), 'src', 'main.rs'),
  ].reduce((latest, path) => Math.max(latest, statSync(path).mtimeMs), 0);
  // Existence is the quick path. Cargo's own dependency fingerprints remain
  // the authority whenever a source edit invokes the gate in a fresh target.
  if (existsSync(AST_BINARY) && statSync(AST_BINARY).mtimeMs >= newestInput) return AST_BINARY;
  const result = spawnSync(
    'cargo',
    ['build', '--quiet', '--locked', '--manifest-path', AST_MANIFEST],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, CARGO_TARGET_DIR: AST_TARGET },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new GateInfrastructureError(
      `cannot build the syn security-gate helper\n${result.stderr || result.stdout}`,
    );
  }
  return AST_BINARY;
}

export function runAst(args) {
  const binary = ensureAstTool();
  const result = spawnSync(binary, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new GateInfrastructureError(
      `syn security-gate helper failed (${args.join(' ')})\n${result.stderr || result.stdout}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new GateInfrastructureError(`syn helper returned invalid JSON: ${error.message}`);
  }
}

export function repositoryPath(root, path) {
  return relative(root, path).split('\\').join('/');
}

export function parseRootArgument(defaultRoot = REPOSITORY_ROOT) {
  const index = process.argv.indexOf('--root');
  if (index === -1) return defaultRoot;
  if (!process.argv[index + 1]) throw new GateInfrastructureError('--root requires a path');
  return resolve(process.argv[index + 1]);
}

export function locationOverlaps(left, right) {
  const before = (aLine, aColumn, bLine, bColumn) =>
    aLine < bLine || (aLine === bLine && aColumn < bColumn);
  return before(left.line_start, left.column_start, right.endLine, right.endColumn)
    && before(right.startLine, right.startColumn, left.line_end, left.column_end);
}
