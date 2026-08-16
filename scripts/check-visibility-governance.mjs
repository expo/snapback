#!/usr/bin/env node

// Synchronous visibility-governance admission and protected-observer worker.
//
// @ref LLP 0234#d3--widening-requires-a-remotely-prior-artifact-closed-approval-receipt
//   — the hook compares each governed ref against Git's advertised predecessor;
//   the observer separately consumes authenticated true before/after OIDs.

import * as childProcess from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifySignature,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOVERNANCE_COMPARATOR_VERSION,
  GOVERNANCE_SCHEMA_VERSIONS,
  VisibilityGovernanceError,
  approvalClosureAtRevision,
  canonicalGovernanceJson,
  compareGovernanceSnapshots,
  governanceDigest,
  installGovernanceNodeChildProcess,
  isGovernedRef,
  validateGovernedPushEnvelope,
} from '../packages/snapback-codegen/visibility-governance.mjs';

installGovernanceNodeChildProcess(childProcess);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZERO_OID = '0'.repeat(40);
const OID = /^[0-9a-f]{40}$/u;
const CONFIG_PATH = 'visibility-governance.config.json';
const BYPASS_ENV = 'SNAPBACK_DRIFT_GATES_BYPASS';

function fail(code, message, details = {}) {
  throw new VisibilityGovernanceError(code, message, details);
}

function git(root, args, options = {}) {
  return childProcess.execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function validateConfig(value, provenance) {
  const allowedKeys = [
    'schemaVersion',
    'providerProfile',
    'governedRefs',
    'backendPaths',
    'revokedObserverKeyEpochs',
    'anchorWitness',
    'protectedCreationService',
    'observerKeys',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowedKeys.includes(key))
    || value.schemaVersion !== 'snapback.visibility-governance-config.v1'
    || value.providerProfile !== 'github-push-v1'
    || !Array.isArray(value.governedRefs)
    || !value.governedRefs.includes('refs/heads/main')
    || value.governedRefs.some((ref, index) => typeof ref !== 'string'
      || !ref.startsWith('refs/') || value.governedRefs.indexOf(ref) !== index)
    || !Array.isArray(value.backendPaths)
    || value.backendPaths.some((path, index) => typeof path !== 'string'
      || path.startsWith('/') || path.split('/').includes('..')
      || value.backendPaths.indexOf(path) !== index)
    || (value.revokedObserverKeyEpochs !== undefined
      && (!Array.isArray(value.revokedObserverKeyEpochs)
        || value.revokedObserverKeyEpochs.some((epoch, index) => typeof epoch !== 'string'
          || epoch.length === 0 || value.revokedObserverKeyEpochs.indexOf(epoch) !== index)))
    || (value.anchorWitness !== undefined
      && value.anchorWitness !== null
      && (typeof value.anchorWitness !== 'object' || Array.isArray(value.anchorWitness)))
    || (value.protectedCreationService !== undefined
      && (typeof value.protectedCreationService !== 'string'
        || value.protectedCreationService.length === 0))
    || (value.observerKeys !== undefined
      && (!value.observerKeys || typeof value.observerKeys !== 'object'
        || Array.isArray(value.observerKeys)))) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      `${provenance} is malformed or omits refs/heads/main`);
  }
  return value;
}

function readConfig(path, provenance) {
  try {
    return validateConfig(JSON.parse(readFileSync(path, 'utf8')), provenance);
  } catch (error) {
    if (error instanceof VisibilityGovernanceError) throw error;
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      `${provenance} cannot be parsed`);
  }
}

function loadConfig(root) {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) {
    return validateConfig({
      schemaVersion: 'snapback.visibility-governance-config.v1',
      providerProfile: 'github-push-v1',
      governedRefs: ['refs/heads/main'],
      backendPaths: [],
      anchorWitness: null,
    }, 'default visibility governance config');
  }
  return readConfig(path, CONFIG_PATH);
}

function loadProtectedConfig(env) {
  const path = env.SNAPBACK_VISIBILITY_GOVERNANCE_PROTECTED_CONFIG;
  const expectedDigest = env.SNAPBACK_VISIBILITY_GOVERNANCE_PROTECTED_CONFIG_DIGEST;
  if (!path || !expectedDigest || !existsSync(path)) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'protected observer verifier configuration and its external digest pin are unavailable');
  }
  const value = readConfig(path, 'protected visibility governance config');
  const actualDigest = governanceDigest('snapback:visibility-governance-config:v1', value);
  if (actualDigest !== expectedDigest) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'protected observer verifier configuration does not match its external digest pin');
  }
  return value;
}

export function parsePrePushCommands(input) {
  if (input.trim() === '') return [];
  return input.trim().split(/\r?\n/u).map((line) => {
    const [localRef, afterOid, ref, beforeOid, ...extra] = line.trim().split(/\s+/u);
    if (extra.length > 0 || !localRef || !ref || !OID.test(afterOid) || !OID.test(beforeOid)) {
      fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
        `invalid pre-push command: ${line}`);
    }
    return { localRef, ref, beforeOid, afterOid };
  });
}

export function runPrePushAdmission({ input, root = ROOT, env = process.env }) {
  if (env[BYPASS_ENV] !== undefined && env[BYPASS_ENV] !== '') {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
      `${BYPASS_ENV} is not accepted by the synchronous visibility-governance class`);
  }
  const config = loadConfig(root);
  const commands = parsePrePushCommands(input);
  const governed = commands.filter(({ ref }) => isGovernedRef(ref, config.governedRefs));
  if (governed.length === 0) return { checked: 0, exempt: commands.length };
  if (governed.length > 1) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
      'the GitHub provider profile refuses multi-ref governed updates without an atomic envelope');
  }
  for (const command of governed) {
    if (command.afterOid === ZERO_OID) continue;
    if (command.beforeOid === ZERO_OID) {
      fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
        `new governed ref ${command.ref} requires the protected single-ref creation service`);
    }
    compareGovernanceSnapshots({
      root,
      beforeOid: command.beforeOid,
      afterOid: command.afterOid,
      backendPaths: config.backendPaths,
    });
  }
  return { checked: governed.length, exempt: commands.length - governed.length };
}

function eventInput(event) {
  const payload = {
    providerProfile: event.providerProfile,
    eventId: event.eventId,
    repository: event.repository,
    commands: event.commands,
    authenticated: event.authenticated,
    deliveredAt: event.deliveredAt,
  };
  return {
    payload,
    digest: governanceDigest('snapback:visibility-governance-event-input:v1', payload),
  };
}

function observerKey(env, config) {
  const path = env.SNAPBACK_VISIBILITY_OBSERVER_PRIVATE_KEY;
  const epoch = env.SNAPBACK_VISIBILITY_OBSERVER_KEY_EPOCH;
  const digest = env.SNAPBACK_VISIBILITY_OBSERVER_KEY_DIGEST;
  if (!path || !epoch || !digest || !existsSync(path)) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'protected observer signing key, epoch, and externally pinned digest are unavailable');
  }
  const key = createPrivateKey(readFileSync(path, 'utf8'));
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const actualDigest = governanceDigest('snapback:visibility-observer-key:v1', publicKeyPem);
  if (actualDigest !== digest || (config.revokedObserverKeyEpochs ?? []).includes(epoch)) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'protected observer key does not match its external digest pin or its epoch is revoked');
  }
  return { key, epoch, digest };
}

function signed(value, key) {
  const signedPayload = {
    ...value,
    observerKeyEpoch: key.epoch,
    observerKeyDigest: key.digest,
  };
  const payload = canonicalGovernanceJson(signedPayload);
  return {
    ...signedPayload,
    signature: signBytes(null, Buffer.from(payload, 'utf8'), key.key).toString('base64'),
  };
}

function verifyProtectedArtifact(value, config) {
  const registry = config.observerKeys;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !registry || !Array.isArray(registry.keys)) return false;
  const key = registry.keys.find(({ epoch }) => epoch === value.observerKeyEpoch);
  if (!key || key.revoked !== false
    || (config.revokedObserverKeyEpochs ?? []).includes(key.epoch)) return false;
  const keyDigest = governanceDigest('snapback:visibility-observer-key:v1', key.publicKeyPem);
  if (key.keyDigest !== keyDigest || value.observerKeyDigest !== keyDigest
    || typeof value.signature !== 'string') return false;
  const { signature, ...payload } = value;
  try {
    return verifySignature(
      null,
      Buffer.from(canonicalGovernanceJson(payload), 'utf8'),
      createPublicKey(key.publicKeyPem),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function verifyAnchorWitness(root, config, witness, creation) {
  const allowed = [
    'schemaVersion', 'providerProfile', 'governedRef', 'anchorOid', 'observedAt',
    'observerKeyEpoch', 'observerKeyDigest', 'signature',
  ];
  if (Object.keys(witness).some((key) => !allowed.includes(key))
    || allowed.some((key) => witness[key] === undefined)
    || witness.schemaVersion !== 'snapback.visibility-governance-anchor-witness.v1'
    || witness.providerProfile !== 'github-push-v1'
    || witness.governedRef !== creation.ref
    || witness.anchorOid !== creation.mergeBaseOid
    || !OID.test(witness.anchorOid ?? '')
    || !verifyProtectedArtifact(witness, config)) return false;
  try {
    return git(root, ['merge-base', witness.anchorOid, creation.afterOid]) === witness.anchorOid;
  } catch {
    return false;
  }
}

function normalizedViolation(error, fallbackCode) {
  const code = typeof error.code === 'string' && error.code.startsWith('SNAPBACK_')
    ? error.code
    : fallbackCode;
  return {
    code,
    signature: governanceDigest('snapback:visibility-governance-violation:v1', {
      code,
      message: error.message,
      details: error.details ?? {},
    }),
    details: error.details ?? {},
  };
}

function quarantineVerdicts(verdicts, key, env) {
  const red = verdicts.filter(({ disposition }) => disposition === 'red');
  if (red.length === 0) return [];
  let predecessorHead = env.SNAPBACK_VISIBILITY_QUARANTINE_HEAD;
  if (!predecessorHead) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'the protected append-only quarantine head is unavailable');
  }
  return red.map((verdict) => {
    const governedRecordId = verdict.violation.details?.overrideId
      ?? verdict.violation.details?.transitionId
      ?? verdict.violation.details?.headId
      ?? verdict.violation.signature;
    const quarantineId = governanceDigest('snapback:visibility-quarantine-id:v1', {
      eventId: verdict.eventId,
      governedRef: verdict.governedRef,
      afterOid: verdict.afterOid,
      governedRecordId,
    });
    const successorExactSetDigest = governanceDigest(
      'snapback:visibility-quarantine-successor-exact-set:v1',
      { predecessorHead, quarantineId, governedRecordId },
    );
    const candidate = signed({
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineVerdict,
      quarantineId,
      governedRecordId,
      authorityKind: verdict.violation.details?.tableId ? 'table-policy-transition' : 'visibility-override',
      governedRef: verdict.governedRef,
      beforeOid: verdict.beforeOid,
      afterOid: verdict.afterOid,
      eventId: verdict.eventId,
      externalVerdictDigest: governanceDigest('snapback:visibility-governance-red-verdict:v1', verdict),
      offendingLedgerHead: verdict.violation.details?.headId ?? null,
      violationSignature: verdict.violation.signature,
      predecessorQuarantineHead: predecessorHead,
      successorExactSetDigest,
      observedAt: verdict.observedAt,
    }, key);
    predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', {
      predecessorHead,
      quarantineId,
      governedRecordId,
      digest: governanceDigest('snapback:visibility-quarantine-verdict:v1', candidate),
    });
    return candidate;
  });
}

function changedPaths(root, beforeOid, afterOid) {
  return git(root, ['diff', '--name-only', '--diff-filter=ACMRT', beforeOid, afterOid])
    .trim().split('\n').filter(Boolean).sort();
}

function showJson(root, oid, path) {
  return JSON.parse(git(root, ['show', `${oid}:${path}`]));
}

function backendArtifactPath(backend, path) {
  return backend === '' ? path : `${backend}/${path}`;
}

function approvalReceipts({ root, command, event, eventDigest, key, observedAt, backendPaths }) {
  const paths = changedPaths(root, command.beforeOid, command.afterOid)
    .filter((path) => /(?:^|\/)visibility-override-approvals\/[^/]+\.json$/u.test(path)
      || /(?:^|\/)table-visibility-policy-approvals\/[^/]+\.json$/u.test(path));
  if (paths.length === 0) return [];
  const comparison = compareGovernanceSnapshots({
    root,
    beforeOid: command.beforeOid,
    afterOid: command.afterOid,
    backendPaths,
  });
  if (comparison.growth.length > 0 || comparison.policyGrowth.length > 0) {
    return [];
  }
  return paths.map((path) => {
    const marker = path.includes('visibility-override-approvals/')
      ? 'visibility-override-approvals/'
      : 'table-visibility-policy-approvals/';
    const markerIndex = path.indexOf(marker);
    const backend = path.slice(0, markerIndex).replace(/\/$/u, '');
    const closure = approvalClosureAtRevision({
      root,
      revision: command.afterOid,
      backendPath: backend,
      approvalPath: path.slice(markerIndex),
    });
    const { approval, ownerMapDigest, approvalClosureDigest } = closure;
    return signed({
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.separationReceipt,
      providerProfile: event.providerProfile,
      eventId: event.eventId,
      governedRef: command.ref,
      eventInputDigest: eventDigest,
      beforeOid: command.beforeOid,
      afterOid: command.afterOid,
      observedAt,
      approvalKind: approval.approvalKind ?? 'table-policy-transition',
      approvalId: approval.id,
      scopeDigest: approval.scopeDigest ?? approval.transitionDigest,
      approvalClosureDigest,
      predecessorOwnerMapDigest: ownerMapDigest,
      comparatorVersion: GOVERNANCE_COMPARATOR_VERSION,
      approvalOnly: true,
    }, key);
  });
}

function deploymentIdentities(root, afterOid, backendPaths) {
  return backendPaths.map((backend) => {
    const schema = showJson(root, afterOid, backendArtifactPath(backend, 'generated/schema.manifest.json'));
    const functions = showJson(root, afterOid, backendArtifactPath(backend, 'generated/functions.manifest.json'));
    const governance = schema.visibilityGovernance;
    if (!governance) {
      fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
        `${backend} does not carry a staged visibility governance program`);
    }
    return {
      backend,
      appId: schema.appId,
      schemaHash: schema.schemaHash,
      functionBundleHash: functions.bundleHash,
      generationInputsHash: governance.generationInputsHash,
      visibilityAuthorizationProgramDigest: governance.visibilityAuthorizationProgramDigest,
      visibilityGovernanceActivationDigest: governanceDigest(
        'snapback:visibility-governance-activation-carrier:v1',
        governance,
      ),
      quarantineHeadDigest: governance.quarantineHeadDigest,
    };
  });
}

export function runProtectedObserver({ event, root = ROOT, outDir, env = process.env, now = new Date() }) {
  const config = loadProtectedConfig(env);
  if (event.authenticated !== true || !event.eventId || !event.repository
    || !Array.isArray(event.commands) || !event.deliveredAt) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'observer event input is not an authenticated retained provider envelope');
  }
  const { payload, digest: eventDigest } = eventInput(event);
  const commands = validateGovernedPushEnvelope({
    commands: event.commands,
    governedRefs: config.governedRefs,
    providerProfile: event.providerProfile,
    anchorWitness: config.anchorWitness ?? null,
    verifyAnchorWitness: (witness, creation) => (
      verifyAnchorWitness(root, config, witness, creation)
    ),
    eventId: event.eventId,
  });
  const key = observerKey(env, config);
  const observedAt = now.toISOString();
  const receipts = [];
  const verdicts = [];
  for (const command of commands) {
    if (command.afterOid === ZERO_OID) continue;
    let disposition = 'green';
    let violation = null;
    try {
      const comparisonBeforeOid = command.beforeOid === ZERO_OID
        ? config.anchorWitness.anchorOid
        : command.beforeOid;
      compareGovernanceSnapshots({
        root,
        beforeOid: comparisonBeforeOid,
        afterOid: command.afterOid,
        backendPaths: config.backendPaths,
      });
      if (command.beforeOid !== ZERO_OID) {
        receipts.push(...approvalReceipts({
          root,
          command,
          event,
          eventDigest,
          key,
          observedAt,
          backendPaths: config.backendPaths,
        }));
      }
    } catch (error) {
      disposition = 'red';
      violation = normalizedViolation(
        error,
        'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
      );
    }
    let identities = [];
    if (disposition === 'green') {
      try {
        identities = deploymentIdentities(root, command.afterOid, config.backendPaths);
      } catch (error) {
        disposition = 'red';
        violation = normalizedViolation(
          error,
          'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
        );
      }
    }
    const quarantineHeadDigest = identities.length === 0
      ? governanceDigest('snapback:visibility-quarantine-head:v1', [])
      : governanceDigest('snapback:visibility-governance-quarantine-checkpoint:v1',
          identities.map(({ backend, quarantineHeadDigest: head }) => ({ backend, head })));
    verdicts.push(signed({
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.governedUpdateVerdict,
      verdictKind: 'governedUpdateVerdict',
      disposition,
      providerProfile: event.providerProfile,
      eventId: event.eventId,
      eventInputDigest: eventDigest,
      governedRef: command.ref,
      beforeOid: command.beforeOid,
      afterOid: command.afterOid,
      observedAt,
      comparatorVersion: GOVERNANCE_COMPARATOR_VERSION,
      deploymentIdentities: identities,
      quarantineHeadDigest,
      violation,
    }, key));
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'event-input.json'), `${canonicalGovernanceJson(payload)}\n`);
  writeFileSync(join(outDir, 'governed-update-verdicts.json'), `${canonicalGovernanceJson({
    schemaVersion: 'snapback.visibility-governance-verdict-set.v1',
    eventInputDigest: eventDigest,
    verdicts,
  })}\n`);
  writeFileSync(join(outDir, 'separation-receipts.json'), `${canonicalGovernanceJson({
    schemaVersion: 'snapback.visibility-governance-separation-receipt-set.v1',
    eventInputDigest: eventDigest,
    receipts,
  })}\n`);
  const red = verdicts.filter(({ disposition }) => disposition === 'red');
  if (red.length > 0) {
    const quarantines = quarantineVerdicts(verdicts, key, env);
    writeFileSync(join(outDir, 'quarantine-verdicts.json'), `${canonicalGovernanceJson({
      schemaVersion: 'snapback.visibility-governance-quarantine-verdict-set.v1',
      eventInputDigest: eventDigest,
      verdicts: quarantines,
    })}\n`);
    writeFileSync(join(outDir, 'quarantine-ticket-request.json'), `${canonicalGovernanceJson({
      schemaVersion: 'snapback.visibility-governance-ticket-request.v1',
      priority: 'P1',
      eventId: event.eventId,
      violations: red.map(({ governedRef, beforeOid, afterOid, violation }) => ({ governedRef, beforeOid, afterOid, violation })),
    })}\n`);
  }
  return { receipts, verdicts, red: red.length };
}

export function runMissingEventReconciler({ ledger, root = ROOT, env = process.env }) {
  const config = loadProtectedConfig(env);
  if (ledger?.schemaVersion !== 'snapback.visibility-governance-external-event-ledger.v1'
    || !Array.isArray(ledger.verdicts)
    || ledger.externallyAttested !== true
    || ledger.ledgerHeadDigest !== governanceDigest(
      'snapback:visibility-governance-external-event-ledger:v1',
      ledger.verdicts,
    )) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'missing-event reconciliation requires the externally attested append-only event ledger');
  }
  const registry = config.observerKeys;
  if (registry?.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.observerKeys
    || !Array.isArray(registry.keys) || registry.keys.length === 0) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'missing-event reconciliation requires externally pinned retained observer keys');
  }
  const seenVerdicts = new Set();
  for (const verdict of ledger.verdicts) {
    const key = registry.keys.find(({ epoch }) => epoch === verdict.observerKeyEpoch);
    const keyDigest = key && governanceDigest(
      'snapback:visibility-observer-key:v1',
      key.publicKeyPem,
    );
    const identity = `${verdict.eventId ?? ''}\n${verdict.governedRef ?? ''}\n${verdict.afterOid ?? ''}`;
    const { signature, ...payload } = verdict ?? {};
    let verified = false;
    try {
      verified = key?.revoked === false
        && !(config.revokedObserverKeyEpochs ?? []).includes(key.epoch)
        && key.keyDigest === keyDigest
        && verdict.observerKeyDigest === keyDigest
        && verdict.schemaVersion === GOVERNANCE_SCHEMA_VERSIONS.governedUpdateVerdict
        && verdict.verdictKind === 'governedUpdateVerdict'
        && ['green', 'red'].includes(verdict.disposition)
        && config.governedRefs.includes(verdict.governedRef)
        && OID.test(verdict.beforeOid ?? '')
        && OID.test(verdict.afterOid ?? '')
        && typeof signature === 'string'
        && verifySignature(
          null,
          Buffer.from(canonicalGovernanceJson(payload), 'utf8'),
          createPublicKey(key.publicKeyPem),
          Buffer.from(signature, 'base64'),
        );
    } catch {
      verified = false;
    }
    if (!verified || seenVerdicts.has(identity)) {
      fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
        'external event ledger contains an untrusted, rebound, or duplicate verdict');
    }
    seenVerdicts.add(identity);
  }
  const missing = [];
  for (const ref of config.governedRefs) {
    let tip;
    try {
      tip = git(root, ['rev-parse', '--verify', ref]);
    } catch {
      continue;
    }
    const matching = ledger.verdicts.filter(({ governedRef, disposition }) => (
      governedRef === ref && disposition === 'green'
    ));
    if (!matching.some(({ afterOid }) => afterOid === tip)) missing.push({ ref, tip });
  }
  if (missing.length > 0) {
    fail('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'provider delivery ledger has no exact-tip green verdict for a governed ref', { missing });
  }
  return { governedRefs: config.governedRefs, missing: [], checkedAt: 'external-ledger-cut' };
}

function option(args, name, required = false) {
  const index = args.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(index, 2);
  return value;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pre-push') {
    const root = option(args, '--root') ?? ROOT;
    if (args.length > 0) throw new Error(`unknown arguments: ${args.join(' ')}`);
    const result = runPrePushAdmission({ input: readFileSync(0, 'utf8'), root });
    console.log(`[visibility-governance] ALLOWED: ${result.checked} governed ref update(s); ${result.exempt} exempt`);
    return;
  }
  if (command === 'observe') {
    const eventPath = option(args, '--event', true);
    const outDir = option(args, '--out', true);
    const root = option(args, '--root') ?? ROOT;
    if (args.length > 0) throw new Error(`unknown arguments: ${args.join(' ')}`);
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const result = runProtectedObserver({ event, root, outDir });
    console.log(`[visibility-governance] observed ${result.verdicts.length} governed update(s); ${result.red} red`);
    if (result.red > 0) process.exitCode = 1;
    return;
  }
  if (command === 'reconcile') {
    const ledgerPath = option(args, '--ledger', true);
    const outPath = option(args, '--out', true);
    const root = option(args, '--root') ?? ROOT;
    if (args.length > 0) throw new Error(`unknown arguments: ${args.join(' ')}`);
    const result = runMissingEventReconciler({
      ledger: JSON.parse(readFileSync(ledgerPath, 'utf8')),
      root,
    });
    writeFileSync(outPath, `${canonicalGovernanceJson(result)}\n`);
    console.log(`[visibility-governance] reconciled ${result.governedRefs.length} governed ref(s)`);
    return;
  }
  throw new Error('usage: check-visibility-governance.mjs pre-push [--root PATH] | observe --event FILE --out DIR [--root PATH] | reconcile --ledger FILE --out FILE [--root PATH]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[visibility-governance] REFUSED ${error.code ?? 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION'}: ${error.message}`);
    if (error.details && Object.keys(error.details).length > 0) console.error(canonicalGovernanceJson(error.details));
    process.exitCode = 1;
  });
}
