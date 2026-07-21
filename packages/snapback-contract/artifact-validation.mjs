// Generated Contract artifact coherence checks shared by the full adapter and
// capability-scoped entrypoints. Keeping this seam standalone lets Online-only
// applications validate the same generated references without importing the
// retained/offline and authority-custody implementation.
//
// @ref LLP 0012#contract-artifacts — every client arm consumes one coherent
//   generated artifact set, including schema/function hash identity.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — capability
//   entrypoints remain independently tree-shakeable without weakening checks.

import { createSnapbackProviderDiagnostic } from './diagnostics.mjs';

// Contract data manifest versions this adapter accepts. v2 (LLP 0034 D3) is an
// additive extension of v1 per Exact LLP 0284 §2.4: old fields remain valid
// inputs, so v1 manifests keep working unmodified.
export const SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS = [1, 2];

function artifactDiagnostic(code, message, details = {}) {
  const {
    severity = 'error',
    provider = 'snapback',
    owner = 'provider',
    source,
    queryName = details.query,
    mutationName = details.mutation,
    table,
    suggestedFix,
    target_surface: targetSurface = 'Contract/Exact',
    ...providerDetails
  } = details;
  return createSnapbackProviderDiagnostic(code, message, {
    severity,
    provider,
    owner,
    source,
    queryName,
    mutationName,
    table,
    suggestedFix,
    targetSurface,
    details: providerDetails,
  });
}

export function validateSnapbackContractArtifacts({
  manifest,
  contractDataManifest,
  artifactIndex = null,
  schemaManifest = null,
  functionManifest = null,
  expectedManifestVersion = null,
  expectedSchemaVersion = null,
  expectedInputsHash = null,
  expectedSchemaHash = null,
  expectedBundleHash = null,
} = {}) {
  const contractManifest = manifest ?? contractDataManifest;
  const diagnostics = [];
  const diag = (code, message, details = {}) => {
    diagnostics.push(artifactDiagnostic(code, message, details));
  };

  if (!contractManifest) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_MISSING', 'Missing generated Contract data manifest.');
    return diagnostics;
  }

  if (contractManifest.artifactKind !== 'contractDataManifest') {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_KIND', 'Generated Contract data manifest has the wrong artifact kind.', {
      expectedArtifactKind: 'contractDataManifest',
      actualArtifactKind: contractManifest.artifactKind ?? null,
    });
  }

  const acceptedManifestVersions = expectedManifestVersion === null
    ? SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS
    : [expectedManifestVersion];
  if (!acceptedManifestVersions.includes(contractManifest.manifestVersion)) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_MANIFEST_VERSION', 'Generated Contract data manifest has the wrong manifest version.', {
      expectedManifestVersion: acceptedManifestVersions.length === 1 ? acceptedManifestVersions[0] : acceptedManifestVersions,
      actualManifestVersion: contractManifest.manifestVersion ?? null,
    });
  }

  const schemaVersion = expectedSchemaVersion ?? schemaManifest?.schemaVersion ?? artifactIndex?.schemaVersion ?? null;
  if (schemaVersion && contractManifest.schemaVersion !== schemaVersion) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_VERSION', 'Generated Contract data manifest schema version does not match the generated Snapback artifacts.', {
      expectedSchemaVersion: schemaVersion,
      actualSchemaVersion: contractManifest.schemaVersion ?? null,
    });
  }

  const inputsHash = expectedInputsHash ?? artifactIndex?.inputsHash ?? schemaManifest?.inputsHash ?? functionManifest?.inputsHash ?? null;
  if (inputsHash && contractManifest.inputsHash !== inputsHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH', 'Generated Contract data manifest inputs hash does not match the generated Snapback artifacts.', {
      expectedInputsHash: inputsHash,
      actualInputsHash: contractManifest.inputsHash ?? null,
    });
  }

  const schemaHash = expectedSchemaHash ?? schemaManifest?.schemaHash ?? artifactIndex?.schemaHash ?? null;
  if (schemaHash && contractManifest.schemaHash !== schemaHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_SCHEMA_HASH', 'Generated Contract data manifest schema hash does not match the generated schema manifest.', {
      expectedSchemaHash: schemaHash,
      actualSchemaHash: contractManifest.schemaHash ?? null,
    });
  }

  const bundleHash = expectedBundleHash ?? functionManifest?.bundleHash ?? artifactIndex?.bundleHash ?? null;
  if (bundleHash && contractManifest.bundleHash !== bundleHash) {
    diag('SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH', 'Generated Contract data manifest bundle hash does not match the generated function manifest.', {
      expectedBundleHash: bundleHash,
      actualBundleHash: contractManifest.bundleHash ?? null,
    });
  }

  if (artifactIndex?.functions) {
    validateBindingSet(contractManifest, artifactIndex.functions, diag);
  }

  if (artifactIndex?.artifacts) {
    validateDescriptorSet(contractManifest, artifactIndex.artifacts, diag);
  }

  return diagnostics;
}

function validateBindingSet(manifest, functions, diag) {
  const queries = manifest.queries ?? {};
  const mutations = manifest.mutations ?? {};
  const expectedQueryNames = new Set();
  const expectedMutationNames = new Set();

  for (const fn of functions) {
    // Actions are not Contract data bindings (codegen skips them when
    // emitting descriptors) — cron-run functions must not be demanded as
    // query bindings.
    if (fn.kind === 'Action') continue;
    if (fn.kind === 'Mutation') expectedMutationNames.add(fn.name);
    else expectedQueryNames.add(fn.name);
  }

  for (const name of expectedQueryNames) {
    if (!queries[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a query binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of expectedMutationNames) {
    if (!mutations[name]) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest is missing a mutation binding declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
  for (const name of Object.keys(queries)) {
    if (queries[name]?.ephemeral === true) continue;
    if (!expectedQueryNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a query binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'query',
      });
    }
  }
  for (const name of Object.keys(mutations)) {
    if (!expectedMutationNames.has(name)) {
      diag('SNAPBACK_STALE_CONTRACT_DATA_BINDINGS', 'Generated Contract data manifest has a mutation binding not declared by the function manifest.', {
        binding: name,
        bindingKind: 'mutation',
      });
    }
  }
}

function validateDescriptorSet(manifest, artifacts, diag) {
  const artifactSet = new Set(artifacts);
  for (const name of Object.keys(manifest.queries ?? {})) {
    const expectedFiles = manifest.queries[name]?.ephemeral === true
      ? [
          `contract/${name}.ephemeral.ts`,
          `contract/${name}.ephemeral.contract-meta.ts`,
          `contract/${name}.publish.ts`,
          `contract/${name}.publish.contract-meta.ts`,
        ]
      : [`contract/${name}.query.ts`, `contract/${name}.query.contract-meta.ts`];
    for (const file of expectedFiles) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'query',
          artifact: file,
        });
      }
    }
  }
  for (const name of Object.keys(manifest.mutations ?? {})) {
    for (const file of [`contract/${name}.mutation.ts`, `contract/${name}.mutation.contract-meta.ts`]) {
      if (!artifactSet.has(file)) {
        diag('SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET', 'Generated Contract descriptor artifact is missing from the artifact index.', {
          binding: name,
          bindingKind: 'mutation',
          artifact: file,
        });
      }
    }
  }
}
