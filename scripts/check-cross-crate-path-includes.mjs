#!/usr/bin/env node

// @ref LLP 0284#43-cross-crate-path-includes--compilation-unit-ownership —
// syn discovers module/include edges and canonical realpaths enforce ownership.

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GateInfrastructureError,
  parseRootArgument,
  repositoryPath,
  runAst,
  runCargoMetadata,
  workspacePackages,
} from './security-gates-lib.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGNOSTIC = 'SNAPBACK_CROSS_CRATE_PATH_INCLUDE';

function inside(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function realOrLexical(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function moduleDirectory(target, parentModuleDirectory, moduleName) {
  if (target.endsWith(`${sep}mod.rs`)) return dirname(target);
  return resolve(parentModuleDirectory, moduleName);
}

function addViolation(violations, root, source, line, kind, target) {
  violations.push({
    source: repositoryPath(root, source),
    line,
    kind,
    target: target ? repositoryPath(root, target) : '<unevaluable>',
  });
}

export function auditCrossCratePathIncludes(root = DEFAULT_ROOT) {
  const started = process.hrtime.bigint();
  const metadata = runCargoMetadata(resolve(root, 'Cargo.toml'));
  const violations = [];
  let sourceCount = 0;

  for (const pkg of workspacePackages(metadata)) {
    const crateRoot = realpathSync(dirname(pkg.manifest_path));
    const packageOutDir = resolve(root, 'target', pkg.name, '__security_gate_out_dir__');
    const queue = pkg.targets
      .filter((target) => ['lib', 'bin', 'test', 'example', 'bench']
        .some((kind) => target.kind.includes(kind)))
      .map((target) => ({
        source: resolve(target.src_path),
        moduleDirectory: dirname(resolve(target.src_path)),
      }));
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      const lexicalSource = resolve(current.source);
      if (!existsSync(lexicalSource)) {
        throw new GateInfrastructureError(`cargo metadata target is missing: ${lexicalSource}`);
      }
      const entry = lstatSync(lexicalSource);
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        throw new GateInfrastructureError(`Rust source is not a file: ${lexicalSource}`);
      }
      const canonicalSource = realpathSync(lexicalSource);
      if (!inside(canonicalSource, crateRoot)) {
        addViolation(violations, root, lexicalSource, 1, 'symlink-source', canonicalSource);
        continue;
      }
      if (visited.has(lexicalSource)) continue;
      visited.add(lexicalSource);
      sourceCount += 1;

      const references = runAst(['units', '--file', lexicalSource]);
      for (const reference of references) {
        if (reference.kind === 'include-unevaluable') {
          addViolation(
            violations,
            root,
            lexicalSource,
            reference.line,
            'include-unevaluable',
          );
          continue;
        }
        if (reference.kind === 'module') {
          const containingModuleDirectory = resolve(
            current.moduleDirectory,
            ...(reference.modulePath ?? []),
          );
          const flat = resolve(containingModuleDirectory, `${reference.value}.rs`);
          const nested = resolve(containingModuleDirectory, reference.value, 'mod.rs');
          const target = existsSync(flat) ? flat : nested;
          if (!existsSync(target)) continue;
          const canonicalTarget = realpathSync(target);
          if (!inside(canonicalTarget, crateRoot)) {
            addViolation(
              violations,
              root,
              target,
              reference.line,
              'symlink-source',
              canonicalTarget,
            );
            continue;
          }
          queue.push({
            source: target,
            moduleDirectory: moduleDirectory(
              target,
              containingModuleDirectory,
              reference.value,
            ),
          });
          continue;
        }

        let target;
        if (reference.outDir) {
          target = resolve(reference.value.replace('__SNAPBACK_OUT_DIR__', packageOutDir));
          if (!inside(target, resolve(root, 'target', pkg.name))) {
            addViolation(
              violations,
              root,
              lexicalSource,
              reference.line,
              'include-escape',
              target,
            );
          }
          continue;
        }
        if (reference.kind === 'path') {
          const containingModuleDirectory = resolve(
            dirname(lexicalSource),
            ...(reference.modulePath ?? []),
          );
          target = resolve(containingModuleDirectory, reference.value);
          const checkedTarget = realOrLexical(target);
          if (!inside(checkedTarget, crateRoot)) {
            addViolation(
              violations,
              root,
              lexicalSource,
              reference.line,
              'path-escape',
              checkedTarget,
            );
            continue;
          }
          if (existsSync(target) && target.endsWith('.rs')) {
            queue.push({
              source: target,
              moduleDirectory: moduleDirectory(
                target,
                containingModuleDirectory,
                reference.moduleName,
              ),
            });
          }
          continue;
        }
        target = resolve(dirname(lexicalSource), reference.value);
        const checkedTarget = realOrLexical(target);
        if (!inside(checkedTarget, crateRoot)) {
          addViolation(
            violations,
            root,
            lexicalSource,
            reference.line,
            'include-escape',
            checkedTarget,
          );
          continue;
        }
        if (existsSync(target) && target.endsWith('.rs')) {
          queue.push({ source: target, moduleDirectory: dirname(target) });
        }
      }
    }
  }
  violations.sort((left, right) =>
    [left.source, left.line, left.kind, left.target]
      .join('\0')
      .localeCompare([right.source, right.line, right.kind, right.target].join('\0')));
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { violations, sourceCount, durationMs };
}

function printResult(result) {
  if (result.violations.length > 0) {
    process.stderr.write(
      `${DIAGNOSTIC}: ${result.violations.length} cross-crate compilation-unit escape(s)\n`,
    );
    for (const violation of result.violations) {
      process.stderr.write(
        `  ${violation.source}:${violation.line} ${violation.kind} -> ${violation.target}\n`,
      );
    }
    process.stderr.write(
      `cross-crate compilation-unit ownership: scanned ${result.sourceCount} source file(s) in ${(result.durationMs / 1000).toFixed(2)}s\n`,
    );
    return 1;
  }
  process.stdout.write(
    `cross-crate compilation-unit ownership: ok (${result.sourceCount} source file(s); ${(result.durationMs / 1000).toFixed(2)}s)\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = printResult(auditCrossCratePathIncludes(parseRootArgument()));
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: infrastructure failure\n${error.message}\n`);
    process.exitCode = 2;
  }
}
