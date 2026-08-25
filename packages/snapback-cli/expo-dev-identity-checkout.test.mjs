import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  SUPERVISED_EXCHANGE_PATH,
  createDevIdentityCheckoutRegistry,
  createExpoRoutingPlan,
  expoMetroChildEnvironment,
  launchExpoNativeCheckout,
  shouldLaunchExpoNativeCheckout,
  startBootstrapExchange,
} from './expo-dev.mjs';
import {
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV as APP_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER as APP_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH as APP_CHECKOUT_PATH,
} from '../snapback-expo/supervised-environment.mjs';
import { serializeSecretFreeReceipt } from '../../demos/expo-native-checkout-reader/scripts/receipt-safety.mjs';

assert.equal(APP_CHECKOUT_ENV, SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV);
assert.equal(APP_CHECKOUT_HEADER, SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER);
assert.equal(APP_CHECKOUT_PATH, SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH);
assert.throws(
  () => serializeSecretFreeReceipt({ capability: 'sbdev_unit_boundary_probe' }),
  /attempted to retain a dev-identity capability/u,
  'receipt serialization rejects an sbdev_ value in any report field',
);

const scratch = mkdtempSync(join(tmpdir(), 'snapback-expo-checkout-'));
const capabilityFile = join(scratch, 'dev.ready.json.dev-identity');
const capability = 'sbdev_checkout_proof_capability';
const nonce = `checkout-${'n'.repeat(40)}`;
let descriptor = {
  startupNonce: 'backend-startup-a',
  devIdentityCapabilityFile: capabilityFile,
};
writeFileSync(capabilityFile, `${capability}\n`, { mode: 0o600 });

const registry = createDevIdentityCheckoutRegistry({
  getReadyDescriptor: () => descriptor,
  mintNonce: () => nonce,
});
assert.equal(registry.issue({ platform: 'ios', device: { class: 'simulator' } }), nonce);

const bootstrapPayload = Object.freeze({
  format: 'snapback.expo-supervised-exchange.v1',
  correlationId: 'checkout-proof',
  binding: Object.freeze({ appId: 'proof-app' }),
  authority: Object.freeze({ status: 'authority-required' }),
});
const exchange = await startBootstrapExchange(() => bootstrapPayload, {
  onDevIdentityCheckout: (presented) => registry.redeem(presented),
});

const redeem = (presented, headers = {}) => fetch(
  `${exchange.origin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
  {
    method: 'POST',
    headers: {
      ...headers,
      ...(presented === undefined
        ? {}
        : { [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: presented }),
    },
  },
);

try {
  // Proof (a): the bare, CORS-readable bootstrap GET contains neither secret.
  const bootstrapResponse = await fetch(`${exchange.origin}${SUPERVISED_EXCHANGE_PATH}`, {
    headers: { Origin: 'http://localhost:8081' },
  });
  const bootstrapText = await bootstrapResponse.text();
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapResponse.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal(bootstrapText.includes(capability), false);
  assert.equal(bootstrapText.includes(nonce), false);
  assert.equal(bootstrapText.includes('devIdentityCapability'), false);
  assert.equal(bootstrapText.includes('checkoutNonce'), false);

  // Proof (b): absent, wrong, and browser-origin redemption all collapse to
  // one generic refusal. The browser response receives no CORS grant.
  for (const attempt of [
    await redeem(undefined),
    await redeem(`wrong-${'x'.repeat(40)}`),
    await redeem(nonce, { Origin: 'http://localhost:8081' }),
  ]) {
    assert.equal(attempt.status, 403);
    assert.equal(attempt.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await attempt.json(), {
      ok: false,
      code: 'SNAPBACK_DEV_IDENTITY_REFUSED',
    });
  }

  const first = await redeem(nonce);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, devIdentityCapability: capability });

  // Proof (c): successful redemption consumes the nonce.
  const second = await redeem(nonce);
  assert.equal(second.status, 403);
  assert.deepEqual(await second.json(), {
    ok: false,
    code: 'SNAPBACK_DEV_IDENTITY_REFUSED',
  });

  // Backend startup rotation invalidates an otherwise unspent checkout.
  registry.issue({ platform: 'ios', device: { class: 'simulator' } });
  descriptor = { ...descriptor, startupNonce: 'backend-startup-b' };
  const rotated = await redeem(nonce);
  assert.equal(rotated.status, 403);

  registry.issue({ platform: 'android', device: { class: 'emulator' } });
  assert.equal(registry.pending, 1);
  registry.invalidate();
  assert.equal(registry.pending, 0, 'backend rotation clears every issued nonce');
  const invalidated = await redeem(nonce);
  assert.equal(invalidated.status, 403);

  // Proof (d): inherited checkout state is stripped before Metro constructs
  // the web-visible environment; no EXPO_PUBLIC_* value contains the nonce.
  const metroEnvironment = expoMetroChildEnvironment({
    env: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV]: nonce },
    bootstrapOrigin: 'http://127.0.0.1:4321',
    backendOrigin: 'http://127.0.0.1:4287',
    port: 8081,
  });
  assert.equal(
    metroEnvironment.EXPO_PUBLIC_SNAPBACK_URL,
    'http://127.0.0.1:4287',
    'supervised web exposes the backend data/auth origin separately from the control plane',
  );
  assert.equal(
    metroEnvironment.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN,
    'http://127.0.0.1:4321',
    'the supervisor origin remains the rendezvous control plane',
  );
  assert.equal(metroEnvironment[SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV], undefined);
  assert.equal(
    Object.entries(metroEnvironment).some(([key, value]) => (
      key.startsWith('EXPO_PUBLIC_') && value === nonce
    )),
    false,
  );

  const launchCalls = [];
  const run = (binary, args, options) => {
    launchCalls.push({ binary, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  const ios = createExpoRoutingPlan({
    platform: 'ios', backendPort: 4101, metroPort: 4102, bootstrapPort: 4103,
  });
  const iosBundleIdentifier = 'dev.snapback.checkoutwitness';
  const androidComponent = 'dev.snapback.checkoutwitness/.MainActivity';
  const expoAppScheme = 'snapback-checkout-witness';
  assert.equal(
    shouldLaunchExpoNativeCheckout(ios),
    false,
    'ordinary sessions never issue or launch native checkout by default',
  );
  assert.equal(
    shouldLaunchExpoNativeCheckout(ios, {
      metroCommand: { command: 'custom-expo' },
    }),
    false,
    '--expo-command does not implicitly opt into native checkout',
  );
  assert.equal(
    shouldLaunchExpoNativeCheckout(ios, {
      nativeCheckout: true,
      iosBundleIdentifier,
      expoAppScheme,
      metroCommand: { command: 'custom-expo' },
    }),
    true,
    'explicit checkout opt-in is coherent with --expo-command',
  );
  assert.equal(
    shouldLaunchExpoNativeCheckout(ios, {
      nativeLaunchRun: run, iosBundleIdentifier, expoAppScheme,
    }),
    true,
    'the typed test runner remains an explicit protocol-test opt-in',
  );
  for (const options of [
    { nativeCheckout: true },
    { nativeCheckout: true, iosBundleIdentifier: 'host.exp.Exponent', expoAppScheme },
  ]) {
    assert.throws(
      () => shouldLaunchExpoNativeCheckout(ios, options),
      (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
      'Expo Go or an absent own bundle refuses before issuance',
    );
  }
  assert.throws(
    () => shouldLaunchExpoNativeCheckout(ios, { nativeCheckout: true, iosBundleIdentifier }),
    (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
    'the own-bundle target still requires its development-client URL scheme',
  );

  // Command construction names the witness development client's own bundle;
  // the live native reader result remains receipt-gated outside this unit test.
  const iosLaunch = launchExpoNativeCheckout(ios, nonce, {
    run, env: {}, iosBundleIdentifier, expoAppScheme,
  });
  assert.equal(iosLaunch.carrier, 'ios-simctl-environment');
  assert.deepEqual(launchCalls[0].args, [
    'simctl', 'launch', '--terminate-running-process',
    'booted', iosBundleIdentifier,
    '--initialUrl',
    'snapback-checkout-witness://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A4102',
  ]);
  assert.equal(
    launchCalls[0].options.env[`SIMCTL_CHILD_${SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV}`],
    nonce,
  );
  assert.equal(launchCalls[0].args.some((arg) => arg.includes(nonce)), false);
  assert.equal(iosLaunch.developmentClientUrl.includes(nonce), false);

  const android = createExpoRoutingPlan({
    platform: 'android',
    backendPort: 4201,
    metroPort: 4202,
    bootstrapPort: 4203,
    androidSerial: 'emulator-5554',
  });
  assert.equal(shouldLaunchExpoNativeCheckout(android), false);
  assert.equal(
    shouldLaunchExpoNativeCheckout(android, {
      nativeCheckout: true, androidComponent, expoAppScheme,
    }),
    true,
  );
  assert.throws(
    () => shouldLaunchExpoNativeCheckout(android, {
      nativeCheckout: true,
      androidComponent: 'host.exp.exponent/.experience.HomeActivity',
      expoAppScheme,
    }),
    (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
  );
  const androidLaunch = launchExpoNativeCheckout(android, nonce, {
    run, env: {}, androidComponent, expoAppScheme,
  });
  assert.equal(androidLaunch.carrier, 'android-adb-activity-extra');
  assert.deepEqual(launchCalls[1].args.slice(0, 7), [
    '-s', 'emulator-5554', 'shell', 'am', 'start', '-S', '-W',
  ]);
  assert.deepEqual(launchCalls[1].args.slice(-3), [
    '--es', SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV, nonce,
  ]);
  assert.deepEqual(launchCalls[2].args, [
    '-s', 'emulator-5554',
    'shell', 'am', 'start',
    '-a', 'android.intent.action.VIEW',
    '-d', 'snapback-checkout-witness://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A4202',
  ]);
  assert.equal(launchCalls[2].args.some((arg) => arg.includes(nonce)), false);
  assert.equal(androidLaunch.developmentClientUrl.includes(nonce), false);

  const failedSequenceCalls = [];
  assert.throws(
    () => launchExpoNativeCheckout(android, nonce, {
      androidComponent,
      expoAppScheme,
      env: {},
      run(binary, args, options) {
        failedSequenceCalls.push({ binary, args, options });
        return failedSequenceCalls.length === 1
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 1, stdout: '', stderr: 'open failed' };
      },
    }),
    (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_LAUNCH_FAILED'
      && error?.diagnostic?.details?.phase === 'metro-development-client-url',
    'the launch sequence completes only after the Metro development-client URL opens',
  );
  assert.equal(failedSequenceCalls.length, 2);

  const web = createExpoRoutingPlan({
    platform: 'web', backendPort: 4301, metroPort: 4302, bootstrapPort: 4303,
  });
  assert.equal(
    shouldLaunchExpoNativeCheckout(web, { nativeCheckout: true, nativeLaunchRun: run }),
    false,
  );
  assert.equal(launchExpoNativeCheckout(web, nonce, { run, env: {} }), null);
  assert.equal(launchCalls.length, 3, 'Expo web has no native checkout launch channel');

  console.log('expo-dev-identity-checkout.test.mjs: supervised web backend URL/control-plane separation, default-off issuance, bootstrap secrecy, one-shot/rotation invalidation, browser-origin refusal, and complete opt-in native launch sequencing pass');
} finally {
  await exchange.close();
  rmSync(scratch, { recursive: true, force: true });
}
