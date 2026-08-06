import assert from 'node:assert/strict';
import {
  access,
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  DEFAULT_EVIDENCE_DIR,
  machineIdentity,
  sha256File,
  validateReceipt,
} from '../receipt.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb0--source-fidelity-and-anti-reduction — this gate binds the
// frozen pin and complete 10/22/19/16/9/8 demand to the landed control source.

const CONTROL_ROOT = resolve(import.meta.dirname, '../../..');
const ZERBUGS_ROOT = resolve(CONTROL_ROOT, '..');
const REPO_ROOT = resolve(CONTROL_ROOT, '../../..');
const PLAN_PATH = join(CONTROL_ROOT, 'PLAN.md');
const ACCEPTANCE_JSON_PATH = join(ZERBUGS_ROOT, 'manifest/acceptance.v1.json');
const ACCEPTANCE_MD_PATH = join(ZERBUGS_ROOT, 'manifest/acceptance.v1.md');
const INVENTORY_PATH = join(ZERBUGS_ROOT, 'stage0/inventory.v1.json');
const SOURCE_DIGESTS_PATH = join(ZERBUGS_ROOT, 'stage0/source-digests.v1.json');
const FETCH_SCRIPT_PATH = join(ZERBUGS_ROOT, 'scripts/fetch-zerobugs-pin.sh');
const SOURCE_INVENTORY_PATH = join(CONTROL_ROOT, 'source-inventory.v1.json');
const FIXTURE_DIGESTS_PATH = join(CONTROL_ROOT, 'tests/fixtures/fixture-digests.json');
const GENERATED_ROOT = join(CONTROL_ROOT, 'snapback/generated');
const ARTIFACTS_PATH = join(GENERATED_ROOT, 'artifacts.json');
const SCHEMA_MANIFEST_PATH = join(GENERATED_ROOT, 'schema.manifest.json');
const FUNCTIONS_MANIFEST_PATH = join(GENERATED_ROOT, 'functions.manifest.json');
const CAPABILITY_MANIFEST_PATH = join(GENERATED_ROOT, 'capability.manifest.json');
const CONTRACT_DATA_MANIFEST_PATH = join(GENERATED_ROOT, 'contract-data.manifest.json');
const COMPOSITION_PATH = join(CONTROL_ROOT, 'composition/zerobugs-control-composition.v1.json');
const QUERY_REGISTRY_PATH = join(CONTROL_ROOT, 'src/data/queries.ts');
const MUTATION_REGISTRY_PATH = join(CONTROL_ROOT, 'src/data/mutations.ts');

const EXPECTED_COUNTS = Object.freeze({
  tables: 10,
  relations: 22,
  queries: 19,
  mutators: 16,
  routes: 9,
  effectTriggers: 8,
});

const CHECK_IDS = Object.freeze([
  'source-pin-coverage',
  'frozen-inventory-counts',
  'generated-schema-relation-accounting',
  'generated-query-registry-accounting',
  'generated-mutation-route-effect-accounting',
  'static-route-ui-source-inventory',
  'declared-workaround-component-register',
  'generated-release-identities',
  'zero-check-receipt-refusal',
]);

async function main() {
  const context = await loadContext();
  const observations = {};
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const generatedIdentities = await generatedIdentityRecords(context);
  const componentReleaseIdentities = [{
    id: context.composition.id,
    version: context.composition.version,
    status: context.composition.status,
    runtime: {
      name: context.composition.runtime.name,
      version: context.composition.runtime.version,
      entrypoint: context.composition.runtime.entrypoint,
    },
    snapbackRelease: context.composition.snapbackRelease,
    path: repoPath(COMPOSITION_PATH),
    sha256: await sha256File(COMPOSITION_PATH),
  }];
  const rawArtifacts = await rawArtifactRecords([
    ACCEPTANCE_JSON_PATH,
    ACCEPTANCE_MD_PATH,
    INVENTORY_PATH,
    SOURCE_DIGESTS_PATH,
    FETCH_SCRIPT_PATH,
    SOURCE_INVENTORY_PATH,
    FIXTURE_DIGESTS_PATH,
    PLAN_PATH,
    QUERY_REGISTRY_PATH,
    MUTATION_REGISTRY_PATH,
    ARTIFACTS_PATH,
    SCHEMA_MANIFEST_PATH,
    FUNCTIONS_MANIFEST_PATH,
    CAPABILITY_MANIFEST_PATH,
    CONTRACT_DATA_MANIFEST_PATH,
    COMPOSITION_PATH,
  ]);

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb0',
    attempt,
    title: 'Zerobugs control ZB0 — source fidelity and anti-reduction',
    expectedCheckIds: CHECK_IDS,
    run: async gate => {
      await gate.check('source-pin-coverage', async () => {
        const details = await verifySourcePin(context);
        observations.sourcePin = details;
        return details;
      });

      await gate.check('frozen-inventory-counts', async () => {
        const counts = inventoryCounts(context.inventory);
        assert.deepEqual(counts, EXPECTED_COUNTS);
        assertUnique(context.inventory.schemaDemand.tables.map(row => row.name), 'inventory tables');
        assertUnique(context.inventory.schemaDemand.relationships.map(row => row.name), 'inventory relationships');
        assertUnique(context.inventory.graphDemand.queries.map(row => row.name), 'inventory queries');
        assertUnique(context.inventory.mutationDemand.mutators.map(row => row.name), 'inventory mutators');
        assertUnique(context.inventory.routeDemand.endpoints.map(routeIdentity), 'inventory routes');
        assertUnique(context.inventory.effectDemand.triggers.map(effectTriggerName), 'effect triggers');
        observations.inventoryCounts = counts;
        return counts;
      });

      await gate.check('generated-schema-relation-accounting', async () => {
        const demandedTables = context.inventory.schemaDemand.tables.map(row => row.name);
        const generatedTables = context.schemaManifest.tables.map(row => row.name);
        const generatedSet = new Set(generatedTables);
        const missingTables = demandedTables.filter(name => !generatedSet.has(name));
        assert.deepEqual(missingTables, [], 'every frozen table is present in the generated schema');

        const demandSet = new Set(demandedTables);
        const badRelationEndpoints = [];
        for (const relationship of context.inventory.schemaDemand.relationships) {
          for (const table of relationshipTables(relationship)) {
            if (!demandSet.has(table) || !generatedSet.has(table)) {
              badRelationEndpoints.push(`${relationship.name}:${table}`);
            }
          }
        }
        assert.deepEqual(badRelationEndpoints, [], 'all 22 relationship endpoints remain generated');
        const details = {
          frozenTables: demandedTables.length,
          generatedTables: generatedTables.length,
          declaredSupportTables: generatedTables.filter(name => !demandSet.has(name)).length,
          staticallyCheckedRelations: context.inventory.schemaDemand.relationships.length,
        };
        observations.schemaRelations = details;
        return details;
      });

      await gate.check('generated-query-registry-accounting', async () => {
        const demanded = context.inventory.graphDemand.queries.map(row => row.name);
        const registry = parseQueryRegistry(context.queryRegistrySource);
        assert.deepEqual([...registry.keys()].sort(), [...demanded].sort());
        for (const [name, generatedName] of registry) {
          assert.equal(generatedName, name, `${name} uses its same-named generated reference`);
          assertGeneratedFunction(context.functionsManifest, generatedName, 'LiveQuery');
        }
        const details = {inventoryQueries: demanded.length, typedRegistryQueries: registry.size};
        observations.queries = details;
        return details;
      });

      await gate.check('generated-mutation-route-effect-accounting', async () => {
        const demandedMutators = context.inventory.mutationDemand.mutators.map(row => row.name);
        const registry = parseMutationRegistry(context.mutationRegistrySource);
        assert.deepEqual([...registry.keys()].sort(), [...demandedMutators].sort());
        for (const [logicalName, generatedName] of registry) {
          assertGeneratedFunction(context.functionsManifest, generatedName, 'Mutation');
          assert.equal(
            context.composition.allowlists.mutators.includes(logicalName),
            true,
            `${logicalName} is admitted by the closed composition allowlist`,
          );
        }
        assert.deepEqual(
          [...context.composition.allowlists.queries].sort(),
          context.inventory.graphDemand.queries.map(row => row.name).sort(),
        );

        const routeDemands = context.inventory.routeDemand.endpoints.map(routeIdentity);
        assert.equal(context.composition.routes.length, EXPECTED_COUNTS.routes);
        for (const route of context.inventory.routeDemand.endpoints) {
          const component = context.composition.routes.find(candidate => candidate.path === route.path);
          assert(component, `composition declares ${routeIdentity(route)}`);
          assert(
            String(component.method).split('+').includes(route.method),
            `composition ${component.method} ${component.path} includes ${route.method}`,
          );
        }
        assert.equal(new Set(routeDemands).size, routeDemands.length);

        const triggers = context.inventory.effectDemand.triggers.map(effectTriggerName);
        assert.equal(triggers.length, EXPECTED_COUNTS.effectTriggers);
        for (const trigger of triggers) {
          const generatedName = registry.get(trigger);
          assert(generatedName, `${trigger} effect trigger remains in the typed registry`);
          assertGeneratedFunction(context.functionsManifest, generatedName, 'Mutation');
        }
        const details = {
          inventoryMutators: demandedMutators.length,
          typedRegistryMutators: registry.size,
          compositionRoutes: context.composition.routes.length,
          effectTriggers: triggers.length,
        };
        observations.mutationsRoutesEffects = details;
        return details;
      });

      await gate.check('static-route-ui-source-inventory', async () => {
        const details = await verifySourceInventory(context);
        observations.sourceInventory = details;
        return details;
      });

      await gate.check('declared-workaround-component-register', async () => {
        const rows = parseRegister(context.planSource);
        assert(rows.length > 0, 'PLAN register contains rows');
        const used = rows.filter(row => row.usedByLandedLane);
        const stale = used.filter(row => row.raw.includes('TBD-before-use'));
        assert.deepEqual(stale.map(row => row.id), [], 'used register rows have measured file/line ranges');
        observations.register = {
          totalRows: rows.length,
          usedRows: used.length,
          staleUsedRows: stale.length,
        };
        observations.workarounds = rows;
        return observations.register;
      });

      await gate.check('generated-release-identities', async () => {
        const details = verifyGeneratedReleaseIdentity(context);
        observations.releaseIdentity = details;
        return details;
      });

      await gate.check('zero-check-receipt-refusal', async () => {
        const before = await directoryListing(DEFAULT_EVIDENCE_DIR);
        let refused = null;
        try {
          validateReceipt({
            arm: 'snapback-control',
            gate: 'zb0',
            attempt: 'v999999',
            checks: {
              expected: 1,
              executed: 0,
              counts: {pass: 0, gap: 0, fail: 0, missing: 1},
              rows: [{id: 'negative-zero-check', status: 'MISSING'}],
              missing: ['negative-zero-check'],
            },
          });
        } catch (error) {
          refused = error;
        }
        assert(refused, 'zero-check validation was refused');
        assert.equal(refused.diagnostic?.code, 'ZBUGS_RECEIPT_ZERO_CHECKS');
        assert.deepEqual(await directoryListing(DEFAULT_EVIDENCE_DIR), before, 'negative validation wrote no file');
        const details = {code: refused.diagnostic.code, wroteFile: false};
        observations.zeroCheckRefusal = details;
        return details;
      });
    },
    buildReceipt: async run => ({
      manifest: {
        id: context.acceptance.manifestId,
        path: repoPath(ACCEPTANCE_JSON_PATH),
        sha256: await sha256File(ACCEPTANCE_JSON_PATH),
      },
      generatedIdentities,
      componentReleaseIdentities,
      fixtureIdentity: {
        id: context.fixtureDigests.fixtureId,
        extensionId: context.fixtureDigests.extensionId,
        digest: context.fixtureDigests.overall.contentDigest,
        rowCount: context.fixtureDigests.overall.rowCount,
        mode: 'frozen-static-identity; fixture not loaded by ZB0',
      },
      actorIdentity: {
        mode: 'frozen-static-bindings; no session or principal minted by ZB0',
        declaredActors: context.acceptance.actors.map(actor => actor.id),
        fixtureBindings: context.fixtureDigests.actorBindings,
      },
      browserIdentity: {
        mode: 'not-used-offline-static-gate',
        declaredProfile: context.acceptance.browserProfile,
      },
      machineIdentity: machineIdentity(),
      network: 'loopback-only',
      targetIdentity: {
        id: 'repo-checkout-static-zb0',
        mode: 'offline-no-server',
        declaredTargetProfile: 'local-dev-sqlite-ibex',
        release: context.composition.snapbackRelease,
      },
      rawArtifacts,
      capabilityFacts: [
        {
          id: 'source-fidelity.zb0',
          status: run.outcome === 'PASS' ? 'supported' : 'refused',
          target: 'repo-checkout-static-zb0',
          evidence: CHECK_IDS,
        },
        {
          id: 'release-identity',
          status: checkStatus(run.checks, 'generated-release-identities') === 'PASS'
            ? 'supported'
            : 'refused',
          target: 'local-dev-sqlite-ibex',
        },
      ],
      refusalFacts: [
        {
          id: 'zero-check-attempt',
          status: 'refused',
          code: observations.zeroCheckRefusal?.code ?? 'ZBUGS_RECEIPT_ZERO_CHECKS',
          wroteFile: false,
        },
      ],
      assistance: [
        {
          sequence: 1,
          at: run.startedAt,
          kind: 'governing-design',
          source: 'llp/0183-zerobugs-quality-surface.rfc.md',
          purpose: 'D1 and ZB0 evidence contract',
        },
        {
          sequence: 2,
          at: run.startedAt,
          kind: 'guide',
          source: 'guide/testing/acceptance.md',
          purpose: 'non-vacuous guide-kit harness lifecycle',
        },
        {
          sequence: 3,
          at: run.startedAt,
          kind: 'landed-lane-conventions',
          source: 'demos/zerobugs/control/tests/acceptance/lane2-live.mts..lane6b-live.mts',
          purpose: 'check, identity, and cleanup receipt conventions',
        },
      ],
      workarounds: observations.workarounds ?? parseRegister(context.planSource),
      sourceAccounting: {
        frozenCounts: observations.inventoryCounts ?? inventoryCounts(context.inventory),
        generatedSchema: observations.schemaRelations ?? null,
        typedQueries: observations.queries ?? null,
        typedMutationsRoutesEffects: observations.mutationsRoutesEffects ?? null,
        sourceInventory: observations.sourceInventory ?? null,
        register: observations.register ?? null,
      },
      custodyAccounting: {
        mode: 'static-offline',
        generatedArtifactCustody: context.artifacts.custody,
        rawArtifactCount: rawArtifacts.length,
        runtimeRowsRetained: 0,
        browserFactsRetained: 0,
        externalSourceBytesCopiedIntoReceipt: 0,
      },
    }),
  });
}

async function loadContext() {
  const [
    acceptance,
    inventory,
    sourceDigests,
    sourceInventory,
    fixtureDigests,
    artifacts,
    schemaManifest,
    functionsManifest,
    capabilityManifest,
    contractDataManifest,
    composition,
    planSource,
    fetchScriptSource,
    queryRegistrySource,
    mutationRegistrySource,
  ] = await Promise.all([
    readJson(ACCEPTANCE_JSON_PATH),
    readJson(INVENTORY_PATH),
    readJson(SOURCE_DIGESTS_PATH),
    readJson(SOURCE_INVENTORY_PATH),
    readJson(FIXTURE_DIGESTS_PATH),
    readJson(ARTIFACTS_PATH),
    readJson(SCHEMA_MANIFEST_PATH),
    readJson(FUNCTIONS_MANIFEST_PATH),
    readJson(CAPABILITY_MANIFEST_PATH),
    readJson(CONTRACT_DATA_MANIFEST_PATH),
    readJson(COMPOSITION_PATH),
    readFile(PLAN_PATH, 'utf8'),
    readFile(FETCH_SCRIPT_PATH, 'utf8'),
    readFile(QUERY_REGISTRY_PATH, 'utf8'),
    readFile(MUTATION_REGISTRY_PATH, 'utf8'),
  ]);
  return {
    acceptance,
    inventory,
    sourceDigests,
    sourceInventory,
    fixtureDigests,
    artifacts,
    schemaManifest,
    functionsManifest,
    capabilityManifest,
    contractDataManifest,
    composition,
    planSource,
    fetchScriptSource,
    queryRegistrySource,
    mutationRegistrySource,
    pinnedSource: await resolvePinnedSource(sourceInventory),
  };
}

async function verifySourcePin(context) {
  assert.equal(context.sourceDigests.schemaVersion, 'zerobugs-source-digests.v1');
  assert.equal(context.inventory.schemaVersion, 'zerobugs-inventory.v1');
  assert.equal(context.acceptance.schemaVersion, 'zerobugs-acceptance.v1');
  const pin = parseFetchPin(context.fetchScriptSource);
  const recordedPins = [
    context.acceptance.pin.commit,
    context.inventory.pin.commit,
    context.sourceDigests.pin.commit,
    pin.commit,
  ];
  assert.equal(new Set(recordedPins).size, 1, 'all frozen pin records name one commit');
  assert.equal(context.acceptance.pin.repository, context.sourceDigests.pin.repository);
  assert.equal(context.inventory.pin.repo, context.sourceDigests.pin.repository);
  assert(context.planSource.includes(`Source pin: \`rocicorp/mono@${pin.commit}\``));

  const fetchFiles = pin.files.map(normalizeFetchFile).sort();
  const digestFiles = Object.keys(context.sourceDigests.files).sort();
  assert.deepEqual(fetchFiles, digestFiles, 'fetch script contract list equals the Stage 0 digest list');
  for (const [path, digest] of Object.entries(context.sourceDigests.files)) {
    assert.match(path, /^(?:apps\/zbugs|packages\/zero)\//u);
    assert.match(digest, /^[0-9a-f]{64}$/u);
  }
  assert.equal(
    resolve(dirname(ACCEPTANCE_JSON_PATH), context.acceptance.pin.digestFile),
    SOURCE_DIGESTS_PATH,
  );
  assert.equal(
    resolve(dirname(ACCEPTANCE_JSON_PATH), context.acceptance.pin.inventoryFile),
    INVENTORY_PATH,
  );
  assert.equal(context.fixtureDigests.manifestDigests.json, await sha256File(ACCEPTANCE_JSON_PATH));
  assert.equal(context.fixtureDigests.manifestDigests.markdown, await sha256File(ACCEPTANCE_MD_PATH));
  if (process.env.ZBUGS_PIN !== undefined) {
    assert.equal(process.env.ZBUGS_PIN, pin.commit, 'ZBUGS_PIN matches the frozen commit');
  }

  assert(context.pinnedSource, 'an offline pinned source checkout is available for digest verification');
  const checkoutRoot = resolve(context.pinnedSource.path, '../../..');
  for (const [path, digest] of Object.entries(context.sourceDigests.files)) {
    assert.equal(await sha256File(join(checkoutRoot, path)), `sha256:${digest}`, `${path} matches Stage 0`);
  }
  return {
    repository: context.sourceDigests.pin.repository,
    commit: pin.commit,
    contractFiles: digestFiles.length,
    digestAlgorithms: ['sha256'],
    actualPinnedFilesVerified: digestFiles.length,
    pinnedSource: context.pinnedSource.source,
    optionalEnvironmentPin: process.env.ZBUGS_PIN === undefined ? 'not-provided' : 'matched',
  };
}

async function verifySourceInventory(context) {
  assert.equal(context.sourceInventory.format, 'zerobugs-source-inventory.v1');
  assert(context.pinnedSource, 'pinned UI source is available offline');
  const pinned = await files(context.pinnedSource.path);
  const ported = await files(join(CONTROL_ROOT, 'src'));
  const portedSet = new Set(ported);
  const replacements = new Map(context.sourceInventory.replacements.map(entry => [entry.source, entry]));
  assert.equal(replacements.size, context.sourceInventory.replacements.length, 'replacement sources are unique');
  const unexplained = [];
  for (const source of pinned) {
    if (portedSet.has(source)) continue;
    const replacement = replacements.get(source);
    if (!replacement || !portedSet.has(replacement.target) || replacement.reason.trim() === '') {
      unexplained.push(source);
    }
  }
  assert.deepEqual(unexplained, [], 'every pinned UI/route source is ported or explicitly replaced');
  for (const [source, replacement] of replacements) {
    assert(pinned.includes(source), `replacement source ${source} exists in the pin`);
    assert(portedSet.has(replacement.target), `replacement target ${replacement.target} exists`);
  }

  const pinnedAssets = (await files(join(context.pinnedSource.path, 'assets')))
    .map(path => `assets/${path}`);
  for (const asset of pinnedAssets) {
    assert.deepEqual(
      await readFile(join(CONTROL_ROOT, 'src', asset)),
      await readFile(join(context.pinnedSource.path, asset)),
      `${asset} remains byte-pinned`,
    );
  }

  const uiSources = ported.filter(path => /\.(?:ts|tsx)$/u.test(path));
  const forbidden = [];
  for (const path of uiSources) {
    const source = await readFile(join(CONTROL_ROOT, 'src', path), 'utf8');
    if (/@rocicorp\/zero|shared\/queries|shared\/mutators|Authorization\s*:\s*[`'"]Bearer/u.test(source)) {
      forbidden.push(path);
    }
  }
  assert.deepEqual(forbidden, [], 'ported UI cannot bypass the typed adapter or restore readable bearer custody');
  await assert.rejects(access(join(CONTROL_ROOT, 'src/jwt.ts')));
  assert(pinned.length > 100, 'source inventory is nontrivial');
  return {
    pinnedFiles: pinned.length,
    portedFiles: ported.length,
    declaredReplacements: replacements.size,
    bytePinnedAssets: pinnedAssets.length,
    typedUiSourcesScanned: uiSources.length,
    unexplainedOmissions: unexplained.length,
  };
}

function verifyGeneratedReleaseIdentity(context) {
  const release = context.composition.snapbackRelease;
  assert.equal(context.artifacts.appId, release.appId);
  assert.equal(context.artifacts.schemaVersion, release.schemaVersion);
  assert.equal(context.artifacts.inputsHash, release.inputsHash);
  assert.equal(context.artifacts.schemaHash, release.schemaHash);
  assert.equal(context.artifacts.bundleHash, release.bundleHash);

  assert.equal(context.schemaManifest.appId, release.appId);
  assert.equal(context.schemaManifest.schemaVersion, release.schemaVersion);
  assert.equal(context.schemaManifest.inputsHash, release.inputsHash);
  assert.equal(context.schemaManifest.schemaHash, release.schemaHash);
  assert.equal(context.schemaManifest.targetProfile, release.targetProfileId);

  assert.equal(context.functionsManifest.appId, release.appId);
  assert.equal(context.functionsManifest.schemaVersion, release.schemaVersion);
  assert.equal(context.functionsManifest.inputsHash, release.inputsHash);
  assert.equal(context.functionsManifest.bundleHash, release.bundleHash);

  assert.equal(context.contractDataManifest.schemaVersion, release.schemaVersion);
  assert.equal(context.contractDataManifest.inputsHash, release.inputsHash);
  assert.equal(context.contractDataManifest.schemaHash, release.schemaHash);
  assert.equal(context.contractDataManifest.bundleHash, release.bundleHash);
  assert.equal(context.capabilityManifest.targetProfileId, release.targetProfileId);
  assert.equal(context.composition.schemaVersion, 'zerobugs-control-composition.v1');
  assert.equal(context.composition.status, 'supported-local-control');
  assert.equal(process.versions.bun, context.composition.runtime.version);
  return {
    appId: release.appId,
    schemaVersion: release.schemaVersion,
    inputsHash: release.inputsHash,
    schemaHash: release.schemaHash,
    bundleHash: release.bundleHash,
    targetProfileId: release.targetProfileId,
    componentRuntime: `bun@${context.composition.runtime.version}`,
    generatedManifestsChecked: 4,
    componentContractsChecked: 1,
  };
}

async function generatedIdentityRecords(context) {
  const rows = [
    [SCHEMA_MANIFEST_PATH, context.schemaManifest, {
      appId: context.schemaManifest.appId,
      schemaVersion: context.schemaManifest.schemaVersion,
      inputsHash: context.schemaManifest.inputsHash,
      schemaHash: context.schemaManifest.schemaHash,
      targetProfileId: context.schemaManifest.targetProfile,
    }],
    [FUNCTIONS_MANIFEST_PATH, context.functionsManifest, {
      appId: context.functionsManifest.appId,
      schemaVersion: context.functionsManifest.schemaVersion,
      inputsHash: context.functionsManifest.inputsHash,
      bundleHash: context.functionsManifest.bundleHash,
    }],
    [CAPABILITY_MANIFEST_PATH, context.capabilityManifest, {
      targetProfileId: context.capabilityManifest.targetProfileId,
    }],
    [CONTRACT_DATA_MANIFEST_PATH, context.contractDataManifest, {
      schemaVersion: context.contractDataManifest.schemaVersion,
      inputsHash: context.contractDataManifest.inputsHash,
      schemaHash: context.contractDataManifest.schemaHash,
      bundleHash: context.contractDataManifest.bundleHash,
    }],
    [ARTIFACTS_PATH, context.artifacts, {
      appId: context.artifacts.appId,
      schemaVersion: context.artifacts.schemaVersion,
      inputsHash: context.artifacts.inputsHash,
      schemaHash: context.artifacts.schemaHash,
      bundleHash: context.artifacts.bundleHash,
    }],
  ];
  return await Promise.all(rows.map(async ([path, manifest, release]) => ({
    id: manifest.artifactKind,
    artifactSchemaVersion: manifest.schemaVersion ?? null,
    path: repoPath(path),
    sha256: await sha256File(path),
    release,
  })));
}

function parseRegister(markdown) {
  const start = markdown.indexOf('## Workaround and component register (predeclared)');
  const end = markdown.indexOf('## Later-job sequencing and lane acceptance', start);
  assert(start >= 0 && end > start, 'PLAN register section exists');
  const rows = [];
  for (const line of markdown.slice(start, end).split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
    assert.equal(cells.length, 6, 'register row has six columns');
    const match = /^`([^`]+)`\s*\/\s*(.+)$/u.exec(cells[0]);
    assert(match, 'register row has an id and class');
    const usedByLandedLane = /implemented|retained|supported local control|bespoke/iu.test(cells[3]);
    rows.push({
      id: match[1],
      class: match[2],
      reasonAndOwner: cells[1],
      plannedFilesAndLines: cells[2],
      statusAndLifecycle: cells[3],
      securityBoundary: cells[4],
      removedBy: cells[5],
      usedByLandedLane,
      raw: line,
    });
  }
  return rows;
}

function parseQueryRegistry(source) {
  const match = /const QUERY_REFS = \{([\s\S]*?)\n\} as const;/u.exec(source);
  assert(match, 'typed query registry literal exists');
  const rows = [...match[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*): api\.([A-Za-z][A-Za-z0-9]*),$/gmu)];
  const registry = new Map(rows.map(row => [row[1], row[2]]));
  assert.equal(registry.size, rows.length, 'typed query registry names are unique');
  return registry;
}

function parseMutationRegistry(source) {
  const match = /export const MUTATION_REFS = \{([\s\S]*?)\n\} as const;/u.exec(source);
  assert(match, 'typed mutation registry literal exists');
  const rows = [...match[1].matchAll(/^\s{2}'([^']+)': api\.([A-Za-z][A-Za-z0-9]*),$/gmu)];
  const registry = new Map(rows.map(row => [row[1], row[2]]));
  assert.equal(registry.size, rows.length, 'typed mutation registry names are unique');
  return registry;
}

function parseFetchPin(source) {
  const commit = /readonly PIN="([0-9a-f]{40})"/u.exec(source)?.[1];
  const remote = /readonly REMOTE="([^"]+)"/u.exec(source)?.[1];
  const block = /contract_files=\(\n([\s\S]*?)\n\)/u.exec(source)?.[1];
  assert(commit && remote && block, 'fetch script carries a fixed pin, remote, and contract list');
  assert.equal(remote, 'https://github.com/rocicorp/mono.git');
  const files = block.split('\n').map(line => line.trim()).filter(Boolean);
  assert(files.length > 0, 'fetch script contract list is nonempty');
  return {commit, remote, files};
}

function normalizeFetchFile(path) {
  return path.startsWith('../../packages/zero/')
    ? path.slice('../../'.length)
    : `apps/zbugs/${path}`;
}

function inventoryCounts(inventory) {
  const routes = inventory.routeDemand.endpoints.length;
  return {
    tables: inventory.schemaDemand.tables.length,
    relations: inventory.schemaDemand.relationships.length,
    queries: inventory.graphDemand.queries.length,
    mutators: inventory.mutationDemand.mutators.length,
    routes,
    effectTriggers: inventory.effectDemand.triggers.length,
  };
}

function relationshipTables(relationship) {
  const tables = new Set();
  const addPath = value => {
    if (typeof value === 'string' && value.includes('.')) tables.add(value.split('.', 1)[0]);
  };
  for (const value of relationship.from ?? []) addPath(value);
  for (const value of relationship.to ?? []) addPath(value);
  for (const hop of relationship.hops ?? []) for (const value of hop) addPath(value);
  addPath(relationship.name);
  return tables;
}

function assertGeneratedFunction(manifest, name, kind) {
  const candidates = manifest.functions.filter(candidate => candidate.name === name);
  assert.equal(candidates.length, 1, `${name} has exactly one generated function`);
  assert.equal(candidates[0].kind, kind, `${name} generated kind`);
}

function routeIdentity(route) {
  return `${route.method} ${route.path}`;
}

function effectTriggerName(trigger) {
  return typeof trigger === 'string' ? trigger : trigger.mutator ?? trigger.name ?? trigger.trigger;
}

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} are unique`);
}

async function resolvePinnedSource(sourceInventory) {
  const candidates = [
    process.env.ZBUGS_PINNED_SRC
      ? {path: process.env.ZBUGS_PINNED_SRC, source: 'environment'}
      : null,
    sourceInventory.pinnedRoot
      ? {path: sourceInventory.pinnedRoot, source: 'recorded-source-inventory'}
      : null,
    {path: join(ZERBUGS_ROOT, '.pin'), source: 'repo-local-pin'},
  ].filter(Boolean);
  for (const candidate of candidates) {
    for (const path of [
      candidate.path,
      join(candidate.path, 'src'),
      join(candidate.path, 'apps/zbugs/src'),
    ]) {
      try {
        if ((await stat(path)).isDirectory() && (await stat(join(path, 'routes.tsx'))).isFile()) {
          return {path: resolve(path), source: candidate.source};
        }
      } catch {
        // Try the next offline candidate. ZB0 never fetches a missing pin.
      }
    }
  }
  return null;
}

async function files(root, current = root) {
  const output = [];
  for (const entry of await readdir(current, {withFileTypes: true})) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) output.push(...await files(root, absolute));
    else if (entry.isFile()) output.push(relative(root, absolute).split(sep).join('/'));
  }
  return output.sort();
}

async function directoryListing(path) {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function rawArtifactRecords(paths) {
  return await Promise.all([...paths].sort().map(async path => ({
    path: repoPath(path),
    sha256: await sha256File(path),
  })));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function repoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

function checkStatus(checks, id) {
  return checks.rows.find(row => row.id === id)?.status ?? 'MISSING';
}

const result = await main();
if (result.exitCode !== 0) process.exitCode = result.exitCode;
