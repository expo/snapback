// Graffiti wall — Contract/Exact acceptance (run with bun; imports Exact TS).
//
// Proves the generated Contract bindings the wall imports — the durable
// listCells/paintCell pair AND the generated ephemeral read (`ephemeral`
// binding over boardCursors.ephemeral.ts) and rated publish
// (boardCursors.publish.ts) — compile against the real Exact compiler and
// resolve to the generated descriptor modules, with row-shape checking honored
// through the helper shapes.
//
// @ref LLP 0015#exact-dependency-policy — when Exact's capability is absent, the
//   Contract surface is an explicit expected-missing skip with a structured
//   diagnostic, never a silent pass.
// @ref LLP 0013#client-overlay-store — presence reaches Contract as a generated
//   read binding over the client overlay; this verifies that projection.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import {
  importExactContractCompiler,
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';
import {
  assertGeneratedRowShapeIsChecked,
  checkSnapbackContractDescriptors,
} from '../../../../packages/snapback-contract/exact-project-check.mjs';
import { assert, assertEqual, createSuite } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const contractDir = join(here, '..', '..', 'surfaces', 'contract');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const demoManifest = JSON.parse(readFileSync(join(here, '..', '..', 'demo.snapback.json'), 'utf8'));

const artifactIndex = gen('artifacts.json');
const contractDataManifest = gen('contract-data.manifest.json');

// Resolve with the demo's full declared capability set (ephemeralBinding +
// valueChannels beyond the baseline) so an older checkout that would fail deep
// in the compile instead skips with the coded capability diagnostic.
const exact = resolveExact({ repoRoot, requiredCapabilities: demoManifest.surfaces.contract.exact.requiredCapabilities });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  console.log(JSON.stringify({ title: 'graffiti / contract', skipped: true, reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING', diagnostics: exact.diagnostics }, null, 2));
  const valid = ['optional', 'expected_missing', 'blocked'].includes(expected.requirement) && expected.expectedDiagnostic === 'SNAPBACK_CAPABILITY_EXACT_MISSING';
  console.log(valid ? '\nSKIP (valid, expected_missing): graffiti / contract' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path}`);
const compiler = await importExactContractCompiler({ exactRoot: exact.path });
const runtime = await importExactContractRuntime({ exactRoot: exact.path });
const contractFile = join(contractDir, 'graffiti.contract');
const suite = createSuite('graffiti / contract');

try {
  await suite.check('graffiti.contract compiles against generated descriptors (honest compile)', async () => {
    const result = checkSnapbackContractDescriptors({
      compiler,
      runtime,
      contractFile,
      manifest: contractDataManifest,
      expectedInputsHash: artifactIndex.inputsHash,
      exactRoot: exact.path,
    });
    const errors = [
      ...result.staticSemantics.diagnostics,
      ...result.compiled.diagnostics,
      ...result.doctorReport.diagnostics,
    ].filter((d) => d.severity === 'error');
    assertEqual(errors, [], `compile errors: ${JSON.stringify(errors)}`);
    const used = result.descriptorUses.map((u) => `${u.name}:${u.kind}`).sort();
    return { descriptorUses: used };
  });

  await suite.check('generated ephemeral read binding + rated publish resolve through Exact', async () => {
    const source = readFileSync(contractFile, 'utf8');
    for (const [name, module] of [
      ['listCells', 'listCells.query.ts'],
      ['paintCell', 'paintCell.mutation.ts'],
      ['boardCursors', 'boardCursors.ephemeral.ts'],
      ['boardCursorsPublish', 'boardCursors.publish.ts'],
    ]) {
      assert(new RegExp(`^use ${name} from`, 'm').test(source), `missing use ${name}`);
      assert(source.includes(`../../snapback/generated/contract/${module}`), `${name} not imported from generated module ${module}`);
    }
    assert(/^  ephemeral cursors = boardCursors\(/m.test(source), 'presence must bind through the ephemeral grammar');
    assert(/^ {8}publish pointer\.self -> boardCursorsPublish rate=15 /m.test(source), 'pointer must leave through the authored rated publish line');
    // Manifest facts (LLP 0034 D3): the read descriptor is an always-live
    // ephemeral map; the publish budget rides the ephemeral section — presence
    // publish is NOT a durable mutation.
    const read = contractDataManifest.queries.boardCursors;
    assert(read, 'manifest lacks the generated boardCursors read descriptor');
    assertEqual(read.ephemeral, true, 'boardCursors descriptor is ephemeral');
    assertEqual([read.mode, read.livePush, read.coalesce], ['live', true, true], 'ephemeral read is live-push + coalesced');
    const facts = contractDataManifest.ephemeral.boardCursors;
    assertEqual(
      [facts.publishBudget.sustainedHz, facts.publishBudget.burst, facts.publishBudget.maxValueBytes],
      [20, 12, 1024],
      'publish budget facts',
    );
    assert(!contractDataManifest.mutations.boardCursorsPublish, 'presence publish must not appear as a durable mutation');
    assertEqual(contractDataManifest.mutations.paintCell.writes, ['cells'], 'paintCell is the durable write');
    return { ephemeralBindings: ['boardCursors', 'boardCursorsPublish'], maxDeltaRateHz: facts.maxDeltaRateHz };
  });

  await suite.check('Exact row-shape analysis catches a bad presence field', async () => {
    const result = assertGeneratedRowShapeIsChecked({
      compiler,
      contractFile,
      exactRoot: exact.path,
      mutateSource: (src) => src.replace('initial(person)', 'person.notAField'),
    });
    assert(result.ok, `expected shape_unknown_member, got ${JSON.stringify(result.diagnostics)}`);
    return { code: result.diagnostic.code };
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify({ ...report, exact: { sourceKind: exact.sourceKind, commit: exact.commit } }));
  runtime.reset?.();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('graffiti contract acceptance crashed:', error);
  process.exit(2);
}
