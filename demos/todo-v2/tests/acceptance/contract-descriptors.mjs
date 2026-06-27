// Todo v2 — Exact project checks for generated Contract descriptors.
//
// @ref LLP 0021#phase-1-specify-contractdatamanifest - Exact should validate
//   generated descriptor module contents and row shapes before browser smoke.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import { assert, assertEqual, createSuite } from '../../../_kit/harness.mjs';
import {
  importExactContractCompiler,
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';
import {
  assertGeneratedRowShapeIsChecked,
  checkSnapbackContractDescriptors,
} from '../../../../packages/snapback-contract/exact-project-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const contractFile = join(here, '..', '..', 'surfaces', 'contract', 'todo.contract');
const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));
const demoManifest = JSON.parse(readFileSync(join(here, '..', '..', 'demo.snapback.json'), 'utf8'));

const artifactIndex = gen('artifacts.json');
const contractDataManifest = gen('contract-data.manifest.json');

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  const report = {
    title: 'todo-v2 / contract descriptors',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    requirement: expected.requirement,
    expectedDiagnostic: expected.expectedDiagnostic,
    diagnostics: exact.diagnostics,
  };
  console.log(JSON.stringify(report, null, 2));
  const valid =
    ['optional', 'expected_missing', 'blocked'].includes(expected.requirement) &&
    expected.expectedDiagnostic === 'SNAPBACK_CAPABILITY_EXACT_MISSING';
  console.log(valid ? '\nSKIP (valid, expected_missing): todo-v2 / contract descriptors' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path} (commit ${exact.commit ?? 'n/a'})`);

const compilerMod = await importExactContractCompiler({ exactRoot: exact.path });
const runtimeMod = await importExactContractRuntime({ exactRoot: exact.path });
const suite = createSuite('todo-v2 / contract descriptors');

try {
  await suite.check('Exact static import semantics resolve generated descriptor modules', async () => {
    const report = checkSnapbackContractDescriptors({
      compiler: compilerMod,
      runtime: runtimeMod,
      contractFile,
      manifest: contractDataManifest,
      expectedInputsHash: artifactIndex.inputsHash,
      exactRoot: exact.path,
    });

    const errors = [
      ...report.staticSemantics.diagnostics,
      ...report.compiled.diagnostics,
      ...report.doctorReport.diagnostics,
    ].filter((diagnostic) => diagnostic.severity === 'error');

    assertEqual(errors, [], `descriptor project-check errors: ${JSON.stringify(errors)}`);
    const listTodosUse = report.descriptorUses.find((use) => use.kind === 'query' && use.name === 'listTodos');
    assert(listTodosUse, 'missing listTodos descriptor use');
    const listTodosImport = report.compiled.file.imports?.listTodos;
    assertEqual(listTodosImport?.descriptor?.kind, 'query', 'listTodos import descriptor kind');
    assertEqual(listTodosImport?.descriptor?.result, 'ListTodosRow[]', 'listTodos result descriptor');
    assert(report.staticSemantics.descriptors.ListTodosRow, 'missing generated row shape descriptor');
    assert(report.doctorReport.ok, `data doctor failed: ${JSON.stringify(report.doctorReport.diagnostics)}`);

    return {
      descriptorUses: report.descriptorUses,
      rowShape: report.staticSemantics.descriptors.ListTodosRow,
    };
  });

  await suite.check('generated row shapes catch bad Contract field reads before browser smoke', async () => {
    const result = assertGeneratedRowShapeIsChecked({
      compiler: compilerMod,
      contractFile,
      exactRoot: exact.path,
      mutateSource: (source) => source.replace('todo.priority', 'todo.notAField'),
    });
    assert(result.ok, `expected shape_unknown_member, got ${JSON.stringify(result.diagnostics)}`);
    return { code: result.diagnostic.code, message: result.diagnostic.message };
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify({ ...report, exact: { sourceKind: exact.sourceKind, commit: exact.commit } }));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('contract descriptor acceptance crashed:', error);
  process.exit(2);
}
