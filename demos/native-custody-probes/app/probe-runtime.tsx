import React, { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';
import {
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackExpoBootState,
  useSnapbackQuery,
} from '@expo/snapback-expo';
import type {
  CurrentPrincipalSnapshot,
  SnapbackAuthFacade,
} from '@expo/snapback-client';
import type {
  SnapbackAuthCustodyOwner,
  SnapbackAuthCustodyOwnerKey,
  SnapbackAuthCustodyRecord,
} from '@expo/snapback-contract/auth-coordinator';

import api from '@probe/generated-api';
import { nativeCustodyStorage } from './native-platform';
import { app } from './probe-app';
import { diagnosticCode, publicCustodyFacts, publicError } from './public-projection';
import type { ProbeCommand } from './witness';

type QuerySnapshot = Readonly<Record<string, unknown>> & { status: string };

type RuntimeSnapshot = {
  auth: SnapbackAuthFacade | null;
  principal: CurrentPrincipalSnapshot | null;
  query: QuerySnapshot | null;
  boot: Readonly<Record<string, unknown>> | null;
};

const runtime: RuntimeSnapshot = { auth: null, principal: null, query: null, boot: null };
let credentialEntryCalls = 0;
let bootstrapInvoker: null | ((mode: string) => Promise<unknown>) = null;

const ownerKey: SnapbackAuthCustodyOwnerKey = Object.freeze({
  appId: app.identity.app,
  storagePartition: 'default',
});

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor<T>(read: () => T | null, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) {
      const error = new Error(`timed out waiting for ${label}`) as Error & { code: string };
      error.code = 'SNAPBACK_NATIVE_PROBE_TIMEOUT';
      throw error;
    }
    await delay(25);
  }
}

export function installBootstrapInvoker(invoke: (mode: string) => Promise<unknown>) {
  bootstrapInvoker = invoke;
}

export function ProbeRuntime() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const boot = useSnapbackExpoBootState() as Readonly<Record<string, unknown>>;
  const query = useSnapbackQuery(api.protectedProbe, {}) as unknown as QuerySnapshot;
  useEffect(() => {
    runtime.auth = auth;
    runtime.principal = principal;
    runtime.boot = boot;
    runtime.query = query;
  }, [auth, principal, boot, query]);
  return null;
}

export function resetRuntimeProjection() {
  runtime.auth = null;
  runtime.principal = null;
  runtime.query = null;
  runtime.boot = null;
}

function publicPrincipal(principal: CurrentPrincipalSnapshot | null) {
  if (principal === null) return Object.freeze({ status: 'unavailable' });
  if (principal.status === 'refreshing') {
    return Object.freeze({
      status: principal.status,
      userId: principal.principal.userId,
      sessionId: principal.principal.sessionId,
    });
  }
  if (principal.status === 'authenticated') {
    return Object.freeze({
      status: principal.status,
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }
  if (principal.status === 'blocked') {
    return Object.freeze({ status: principal.status, diagnostic: publicError(principal.diagnostic) });
  }
  return Object.freeze({ status: principal.status });
}

async function readRecord(): Promise<SnapbackAuthCustodyRecord | null> {
  return nativeCustodyStorage.withOwnership(ownerKey, (owner) => owner.read());
}

function nextRevision(record: SnapbackAuthCustodyRecord): SnapbackAuthCustodyRecord {
  return { ...record, revision: record.revision + 1 };
}

async function replaceFrom(record: SnapbackAuthCustodyRecord) {
  return nativeCustodyStorage.withOwnership(ownerKey, (owner) => (
    owner.replace(record.revision, nextRevision(record))
  ));
}

async function custodyFacts() {
  const record = await readRecord();
  return Object.freeze({
    ...publicCustodyFacts(record),
    platformGrade: nativeCustodyStorage.platformGrade(),
  });
}

export const readPublicCustodyFacts = custodyFacts;

async function casProbe(iterations: number) {
  const outcomes = [];
  let previousRevision = (await readRecord())?.revision ?? null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const baseline = await readRecord();
    if (baseline === null) throw Object.assign(new Error('CAS probe requires an existing custody record'), {
      code: 'SNAPBACK_AUTH_CUSTODY_RECORD_MISSING',
    });
    const attempts = await Promise.allSettled([replaceFrom(baseline), replaceFrom(baseline)]);
    const winners = attempts.filter((entry) => entry.status === 'fulfilled').length;
    const conflicts = attempts
      .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      .map((entry) => diagnosticCode(entry.reason));
    const final = await readRecord();
    outcomes.push({
      iteration,
      baselineRevision: baseline.revision,
      winners,
      conflicts,
      finalRevision: final?.revision ?? null,
    });
    if (
      winners !== 1
      || conflicts.length !== 1
      || conflicts[0] !== 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'
      || final?.revision !== baseline.revision + 1
      || (previousRevision !== null && final.revision <= previousRevision)
    ) {
      throw Object.assign(new Error(`CAS fencing failed at iteration ${iteration}`), {
        code: 'SNAPBACK_NATIVE_PROBE_CAS_FENCING_FAILED',
      });
    }
    previousRevision = final.revision;
  }
  return Object.freeze({ iterations, outcomes, finalRevision: previousRevision, monotonic: true });
}

async function staleCasProbe() {
  const baseline = await readRecord();
  if (baseline === null) throw Object.assign(new Error('stale CAS probe requires custody'), {
    code: 'SNAPBACK_AUTH_CUSTODY_RECORD_MISSING',
  });
  const accepted = await replaceFrom(baseline);
  try {
    await replaceFrom(baseline);
  } catch (error) {
    return Object.freeze({
      baselineRevision: baseline.revision,
      acceptedRevision: accepted.revision,
      staleDiagnostic: diagnosticCode(error),
    });
  }
  throw Object.assign(new Error('stale CAS unexpectedly succeeded'), {
    code: 'SNAPBACK_NATIVE_PROBE_STALE_CAS_ACCEPTED',
  });
}

async function tightWriteLoop() {
  const emit = (globalThis as {
    __nativeCustodyProbeEmit?: (event: string, details: Readonly<Record<string, unknown>>) => Promise<void>;
  }).__nativeCustodyProbeEmit;
  void (async () => {
    for (;;) {
      const record = await readRecord();
      if (record === null) throw Object.assign(new Error('tight write loop requires custody'), {
        code: 'SNAPBACK_AUTH_CUSTODY_RECORD_MISSING',
      });
      try {
        const written = await replaceFrom(record);
        await emit?.('tight-write-heartbeat', { revision: written.revision });
      } catch (error) {
        if (diagnosticCode(error) !== 'SNAPBACK_AUTH_CUSTODY_CAS_STALE') throw error;
      }
    }
  })().catch(async (error) => {
    await emit?.('tight-write-failed', publicError(error));
  });
  return Object.freeze({ started: true });
}

async function corruptionProbe() {
  const hooks = nativeCustodyStorage.testHooks;
  if (typeof hooks?.corruptCiphertext !== 'function') {
    return Object.freeze({
      supported: false,
      diagnostic: {
        code: 'SNAPBACK_AUTH_CUSTODY_TEST_HOOK_UNAVAILABLE',
        message: 'Lane A must expose the debug-only corruptCiphertext(ownerKey) hook.',
      },
    });
  }
  await hooks.corruptCiphertext(ownerKey);
  try {
    await readRecord();
  } catch (error) {
    return Object.freeze({ supported: true, readAccepted: false, diagnostic: publicError(error) });
  }
  return Object.freeze({ supported: true, readAccepted: true, diagnostic: null });
}

async function refusalProbe() {
  if (Platform.OS === 'ios') {
    return Object.freeze({
      attempted: false,
      context: 'ios-extension',
      diagnostic: {
        code: 'SNAPBACK_AUTH_CUSTODY_EXTENSION_NATIVE_UNIT_FALLBACK_REQUIRED',
        message: 'The committed v1 probe app has no extension target; use Lane A native-unit refusal evidence.',
      },
    });
  }
  const harness = NativeModules.CustodyProbeHarness as undefined | {
    runSecondaryProcessProbe(): Promise<Readonly<Record<string, unknown>>>;
  };
  if (typeof harness?.runSecondaryProcessProbe !== 'function') {
    return Object.freeze({
      attempted: false,
      context: 'android-secondary-process',
      diagnostic: { code: 'SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_PROBE_UNAVAILABLE' },
    });
  }
  return harness.runSecondaryProcessProbe();
}

export async function executeProbeCommand(command: ProbeCommand): Promise<unknown> {
  const args = command.args ?? {};
  switch (command.name) {
    case 'bootstrap': {
      if (bootstrapInvoker === null) throw new Error('bootstrap invoker is not installed');
      return bootstrapInvoker(typeof args.mode === 'string' ? args.mode : 'native');
    }
    case 'signup': {
      const auth = await waitFor(() => runtime.auth, 'auth facade');
      credentialEntryCalls += 1;
      const result = await auth.signUpWithPassword({
        email: String(args.email),
        password: String(args.password),
      });
      const recoveryCodes = (result as { recoveryCodes?: unknown }).recoveryCodes;
      return Object.freeze({
        principal: publicPrincipal(auth.currentPrincipal()),
        recoveryCodeCount: Array.isArray(recoveryCodes) ? recoveryCodes.length : 0,
        credentialEntryCalls,
      });
    }
    case 'signin': {
      const auth = await waitFor(() => runtime.auth, 'auth facade');
      credentialEntryCalls += 1;
      await auth.signInWithPassword({ email: String(args.email), password: String(args.password) });
      return Object.freeze({ principal: publicPrincipal(auth.currentPrincipal()), credentialEntryCalls });
    }
    case 'signout': {
      const auth = await waitFor(() => runtime.auth, 'auth facade');
      await auth.signOut();
      return Object.freeze({ principal: publicPrincipal(auth.currentPrincipal()), credentialEntryCalls });
    }
    case 'protectedRead': {
      const query = await waitFor(() => (
        runtime.query !== null && ['ready', 'error', 'blocked'].includes(runtime.query.status)
          ? runtime.query
          : null
      ), 'protected query');
      return Object.freeze({
        status: query.status,
        rowCount: Array.isArray(query.data) ? query.data.length : 0,
        diagnostic: query.status === 'error' ? publicError(query.error) : null,
      });
    }
    case 'custodyFacts': return custodyFacts();
    case 'casProbe': return casProbe(Number.isSafeInteger(args.iterations) ? Number(args.iterations) : 8);
    case 'staleCasProbe': return staleCasProbe();
    case 'tightWriteLoop': return tightWriteLoop();
    case 'corruptionProbe': return corruptionProbe();
    case 'refusalProbe': return refusalProbe();
    default: throw Object.assign(new Error(`unknown probe command ${command.name}`), {
      code: 'SNAPBACK_NATIVE_PROBE_COMMAND_UNKNOWN',
    });
  }
}

export function bootstrapPublicProjection(state: Readonly<Record<string, unknown>>) {
  const diagnostic = state.diagnostic as unknown;
  return Object.freeze({
    status: state.status,
    authoritySource: state.authoritySource ?? null,
    custody: state.custody ?? null,
    principal: publicPrincipal(runtime.principal),
    diagnostic: diagnostic === undefined ? null : publicError(diagnostic),
    credentialEntryCalls,
  });
}
