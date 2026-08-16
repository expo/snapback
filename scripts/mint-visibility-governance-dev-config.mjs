#!/usr/bin/env node

// @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
//   — this is the named repository-local producer; the package helper owns
//   the exact signature, registration, profile, and target-class fences.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintVisibilityGovernanceDevConfig } from '../packages/snapback-codegen/visibility-governance-dev-config.mjs';

function usage() {
  return 'usage: node scripts/mint-visibility-governance-dev-config.mjs <backend-root> [--out <path>] [--target-class repository-local]';
}

export function runVisibilityGovernanceDevMintCli(argv = process.argv.slice(2)) {
  let backendRoot = null;
  let outputPath = null;
  let targetClass = 'repository-local';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') {
      outputPath = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === '--target-class') {
      targetClass = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('-') || backendRoot !== null) {
      throw new TypeError(usage());
    } else {
      backendRoot = argument;
    }
  }
  if (backendRoot === null || (outputPath === null && argv.includes('--out'))) {
    throw new TypeError(usage());
  }
  const minted = mintVisibilityGovernanceDevConfig({
    backendRoot: resolve(backendRoot),
    ...(outputPath === null ? {} : { outputPath: resolve(outputPath) }),
    targetClass,
  });
  if (minted === null) {
    throw new TypeError('backend has no visibility governance activation carrier to mint');
  }
  return {
    schemaVersion: 'snapback.visibility-governance-dev-mint-result.v1',
    ok: true,
    path: minted.path,
    sourceOid: minted.config.sourceOid,
    targetClass: minted.config.targetClass,
    appIds: minted.config.verdict.deploymentIdentities.map(({ appId }) => appId),
  };
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    process.stdout.write(`${JSON.stringify(runVisibilityGovernanceDevMintCli())}\n`);
  } catch (error) {
    const code = error?.code ?? 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED';
    process.stderr.write(`${code}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
