import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
  createSnapbackExpoBoot,
} from './provider.mjs';
import {
  authStoragePartitionIdentityHash,
} from '@expo/snapback-client/app-client-internal';

const TEST_NOW_MS = Date.parse('2026-08-16T22:00:00.000Z');
const SENTINEL = Object.freeze({ kind: 'expo-native-phase-2-evidence-required' });
const generatedRoot = new URL(
  '../snapback-cli/templates/react/snapback/generated/',
  import.meta.url,
);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', generatedRoot)));
app.authBootstrap.custody = 'durable-required';
app.capabilities.required = [...new Set([
  ...app.capabilities.required,
  APPLICATION_AUTH_BOOTSTRAP_CAPABILITY,
])];

const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4911',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({
    offered: Object.freeze([...app.capabilities.required, 'auth.passwords']),
  }),
  provenance: Object.freeze({
    supervisorGeneration: 'provider-native-custody-test',
    issuedAt: new Date(TEST_NOW_MS - 60_000).toISOString(),
    expiresAt: new Date(TEST_NOW_MS + 60_000).toISOString(),
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});

function gradeFor(os, grade = 'single-runtime') {
  return Object.freeze({
    os,
    grade,
    carrier: `${os}-provider-test`,
    mechanism: `${os}-provider-test-cas`,
    moduleVersion: '0.1.0',
    storageFormatVersion: 1,
  });
}

function fakeStorage({ os = 'android', grade = 'single-runtime', probeError = null } = {}) {
  let gradeCalls = 0;
  const storage = Object.freeze({
    ownerKeyCapability: 'owner-key-v1',
    async withOwnership() {},
    async platformGrade() {
      gradeCalls += 1;
      if (probeError) throw probeError;
      return gradeFor(os, grade);
    },
  });
  return Object.freeze({ storage, gradeCalls: () => gradeCalls });
}

function fakeAppClient() {
  const bootstrap = Object.freeze({
    status: 'ready',
    authoritySource: 'fresh-anonymous',
    custody: Object.freeze({ grade: 'single-runtime' }),
    principal: Object.freeze({ status: 'anonymous' }),
    advisories: Object.freeze([]),
  });
  return Object.freeze({
    client: Object.freeze({
      async prepareReactBinding() { return Object.freeze({ source: 'deployment' }); },
    }),
    bootstrapState: () => bootstrap,
    subscribeBootstrap: () => () => {},
    async dispose() {},
  });
}

function environmentFor({
  moduleResolver,
  digestModuleResolver = async () => Object.freeze({
    CryptoDigestAlgorithm: Object.freeze({ SHA256: 'SHA-256' }),
    digest: (algorithm, input) => webcrypto.subtle.digest(algorithm, input),
  }),
  operatingSystem = 'android',
  platformOverride,
} = {}) {
  return Object.freeze({
    format: 'snapback.expo-environment.v1',
    appState: Object.freeze({
      currentState: 'active',
      addEventListener() { return Object.freeze({ remove() {} }); },
    }),
    resolveBinding: async () => Object.freeze({
      binding,
      admission: Object.freeze({
        productionCondition: false,
        delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
      }),
    }),
    adoptAuthority: async () => { throw new Error('first-party bootstrap owns authority'); },
    resolveNativeAuthCustodyOperatingSystem: async () => operatingSystem,
    ...(moduleResolver === undefined
      ? {}
      : { resolveNativeAuthCustodyModule: moduleResolver }),
    resolveNativeAuthDigestModule: digestModuleResolver,
    ...(platformOverride === undefined
      ? {}
      : { resolveAppClientPlatform: platformOverride }),
  });
}

async function runBoot(environment, {
  realApplicationClient = false,
  exercisePartitionDigest = false,
} = {}) {
  const applicationClientInputs = [];
  const boot = createSnapbackExpoBoot({
    app,
    environment,
    now: () => TEST_NOW_MS,
    ...(realApplicationClient
      ? {}
      : {
          async createApplicationClient(input) {
            applicationClientInputs.push(input);
            if (exercisePartitionDigest) {
              await authStoragePartitionIdentityHash(
                app.identity.app,
                'default',
                input.platform,
              );
            }
            return fakeAppClient();
          },
        }),
    createProvider: () => Object.freeze({
      start() {},
      async dispose() {},
      inspection: () => Object.freeze({ hostPaused: false }),
    }),
    bindLifecycle: () => Object.freeze({ dispose() {} }),
  });
  const state = await boot.start();
  return { boot, state, applicationClientInputs };
}

function moduleFor(storage, factory = () => storage) {
  return Object.freeze({ createNativeAuthCustodyStorage: factory });
}

function assertTypedUnavailable(result, expectedCauseCode) {
  assert.equal(result.state.status, 'error');
  assert.equal(result.state.diagnostic.code, 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE');
  assert.equal(result.state.diagnostic.details.causeCode, expectedCauseCode);
  assert.equal(result.applicationClientInputs.length, 0);
}

test('native custody provider admits only the evidenced tuple and refuses every other cell', async (t) => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  delete globalThis.crypto;
  delete globalThis.indexedDB;

  try {
    for (const operatingSystem of ['android', 'ios']) {
      await t.test(`${operatingSystem} + single-runtime is admitted and its validated grade is threaded`, async () => {
        const probe = fakeStorage({ os: operatingSystem });
        let factoryCalls = 0;
        const result = await runBoot(environmentFor({
          operatingSystem,
          moduleResolver: async () => moduleFor(probe.storage, () => {
            factoryCalls += 1;
            return probe.storage;
          }),
        }), { exercisePartitionDigest: true });
        assert.equal(result.state.status, 'ready');
        assert.equal(factoryCalls, 1);
        assert.equal(probe.gradeCalls(), 1, 'provider evaluates platformGrade exactly once');
        assert.equal(result.applicationClientInputs.length, 1);
        assert.equal(result.applicationClientInputs[0].platform.kind, 'expo-native');
        assert.equal(result.applicationClientInputs[0].platform.authCustodyStorage, probe.storage);
        assert.equal(result.applicationClientInputs[0].platform.cryptoObject, undefined);
        assert.equal(
          result.applicationClientInputs[0].platform.digestAdapter?.format,
          'snapback.sha256-digest.v1',
        );
        assert.equal(
          await authStoragePartitionIdentityHash(
            app.identity.app,
            'default',
            result.applicationClientInputs[0].platform,
          ),
          'sha256:5e9f14b295a427ded1ac177e96c96258c40bc56858689a8069ae01788bd86ed1',
        );
        await result.boot.dispose();
      });
    }

    for (const cell of [
      { name: 'android + durable grade', operatingSystem: 'android', gradeOs: 'android', grade: 'durable' },
      { name: 'android + other grade', operatingSystem: 'android', gradeOs: 'android', grade: 'volatile' },
      { name: 'android host + iOS report', operatingSystem: 'android', gradeOs: 'ios', grade: 'single-runtime' },
      { name: 'android host + unknown report', operatingSystem: 'android', gradeOs: 'unknown', grade: 'single-runtime' },
      { name: 'iOS + durable grade', operatingSystem: 'ios', gradeOs: 'ios', grade: 'durable' },
      { name: 'iOS + other grade', operatingSystem: 'ios', gradeOs: 'ios', grade: 'volatile' },
      { name: 'iOS host + Android report', operatingSystem: 'ios', gradeOs: 'android', grade: 'single-runtime' },
      { name: 'iOS host + unknown report', operatingSystem: 'ios', gradeOs: 'unknown', grade: 'single-runtime' },
    ]) {
      await t.test(`${cell.name} returns the byte-identical sentinel`, async () => {
        const probe = fakeStorage({ os: cell.gradeOs, grade: cell.grade });
        const result = await runBoot(environmentFor({
          operatingSystem: cell.operatingSystem,
          moduleResolver: async () => moduleFor(probe.storage),
        }));
        assert.equal(probe.gradeCalls(), 1);
        assert.deepEqual(result.applicationClientInputs[0].platform, SENTINEL);
        await result.boot.dispose();
      });
    }

    for (const operatingSystem of ['web', 'unknown']) {
      await t.test(`${operatingSystem} host returns the sentinel without loading native custody`, async () => {
        let moduleCalls = 0;
        const result = await runBoot(environmentFor({
          operatingSystem,
          moduleResolver: async () => {
            moduleCalls += 1;
            throw new Error('non-member hosts must not load custody');
          },
        }));
        assert.equal(moduleCalls, 0);
        assert.deepEqual(result.applicationClientInputs[0].platform, SENTINEL);
        await result.boot.dispose();
      });
    }

    for (const operatingSystem of ['android', 'ios']) {
      for (const cell of [
        {
          name: 'malformed module export',
          expectedCauseCode: 'SNAPBACK_AUTH_CUSTODY_MODULE_INVALID',
          moduleResolver: async () => Object.freeze({}),
        },
        {
          name: 'factory throw',
          expectedCauseCode: 'SNAPBACK_NATIVE_FACTORY_FAILED',
          moduleResolver: async () => moduleFor(null, () => {
            throw Object.assign(new Error('factory failed'), { code: 'SNAPBACK_NATIVE_FACTORY_FAILED' });
          }),
        },
        {
          name: 'platformGrade throw (package present, native module unlinked)',
          expectedCauseCode: 'ERR_NATIVE_MODULE_NOT_FOUND',
          moduleResolver: async () => moduleFor(fakeStorage({
            os: operatingSystem,
            probeError: Object.assign(
              new Error('Cannot find native module SnapbackExpoCustody'),
              { code: 'ERR_NATIVE_MODULE_NOT_FOUND' },
            ),
          }).storage),
        },
        {
          name: 'package absent',
          expectedCauseCode: 'ERR_MODULE_NOT_FOUND',
          moduleResolver: async () => {
            throw Object.assign(new Error('module absent'), { code: 'ERR_MODULE_NOT_FOUND' });
          },
        },
      ]) {
        await t.test(`${operatingSystem} ${cell.name} refuses typed before client construction`, async () => {
          const result = await runBoot(environmentFor({
            operatingSystem,
            moduleResolver: cell.moduleResolver,
          }));
          assertTypedUnavailable(result, cell.expectedCauseCode);
        });
      }
    }

    for (const operatingSystem of ['android', 'ios']) {
      await t.test(`${operatingSystem} missing digest module stays distinct from custody`, async () => {
        const probe = fakeStorage({ os: operatingSystem });
        const result = await runBoot(environmentFor({
          operatingSystem,
          moduleResolver: async () => moduleFor(probe.storage),
          digestModuleResolver: async () => {
            throw Object.assign(new Error('expo-crypto package absent'), {
              code: 'ERR_MODULE_NOT_FOUND',
            });
          },
        }));
        assert.equal(result.state.status, 'unsupported');
        assert.equal(
          result.state.diagnostic.code,
          'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE',
        );
        assert.equal(result.applicationClientInputs.length, 0);
      });

      await t.test(`${operatingSystem} unlinked native digest module is an unavailable module`, async () => {
        const probe = fakeStorage({ os: operatingSystem });
        const result = await runBoot(environmentFor({
          operatingSystem,
          moduleResolver: async () => moduleFor(probe.storage),
          digestModuleResolver: async () => Object.freeze({
            CryptoDigestAlgorithm: Object.freeze({ SHA256: 'SHA-256' }),
            async digest() {
              throw Object.assign(new Error('Cannot find native module ExpoCrypto'), {
                code: 'ERR_NATIVE_MODULE_NOT_FOUND',
              });
            },
          }),
        }), { exercisePartitionDigest: true });
        assert.equal(result.state.status, 'unsupported');
        assert.equal(
          result.state.diagnostic.code,
          'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE',
        );
        assert.equal(result.applicationClientInputs.length, 1);
      });

      await t.test(`${operatingSystem} digest execution failure is not module absence`, async () => {
        const probe = fakeStorage({ os: operatingSystem });
        const result = await runBoot(environmentFor({
          operatingSystem,
          moduleResolver: async () => moduleFor(probe.storage),
          digestModuleResolver: async () => Object.freeze({
            CryptoDigestAlgorithm: Object.freeze({ SHA256: 'SHA-256' }),
            async digest() {
              throw Object.assign(new Error('native SHA-256 execution failed'), {
                code: 'ERR_CRYPTO_DIGEST',
              });
            },
          }),
        }), { exercisePartitionDigest: true });
        assert.equal(result.state.status, 'error');
        assert.equal(result.state.diagnostic.code, 'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED');
        assert.equal(result.applicationClientInputs.length, 1);
      });
    }

    await t.test('platform override has precedence over OS and module seams', async () => {
      let overrideCalls = 0;
      let operatingSystemCalls = 0;
      let moduleCalls = 0;
      const overridePlatform = Object.freeze({ kind: 'memory', cryptoObject: webcrypto });
      const environment = {
        ...environmentFor({
          moduleResolver: async () => {
            moduleCalls += 1;
            throw new Error('override must win');
          },
          platformOverride: async () => {
            overrideCalls += 1;
            return overridePlatform;
          },
        }),
        resolveNativeAuthCustodyOperatingSystem: async () => {
          operatingSystemCalls += 1;
          return 'android';
        },
      };
      const result = await runBoot(Object.freeze(environment));
      assert.equal(result.state.status, 'ready');
      assert.equal(overrideCalls, 1);
      assert.equal(operatingSystemCalls, 0);
      assert.equal(moduleCalls, 0);
      assert.equal(result.applicationClientInputs[0].platform, overridePlatform);
      await result.boot.dispose();
    });

  } finally {
    if (previousCrypto === undefined) delete globalThis.crypto;
    else Object.defineProperty(globalThis, 'crypto', previousCrypto);
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else Object.defineProperty(globalThis, 'indexedDB', previousIndexedDb);
  }
});
