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
  startBootstrapExchange,
} from './expo-dev.mjs';
import {
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV as APP_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER as APP_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH as APP_CHECKOUT_PATH,
} from '../snapback-expo/supervised-environment.mjs';

assert.equal(APP_CHECKOUT_ENV, SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV);
assert.equal(APP_CHECKOUT_HEADER, SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER);
assert.equal(APP_CHECKOUT_PATH, SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH);

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

  // Proof (d): inherited checkout state is stripped before Metro constructs
  // the web-visible environment; no EXPO_PUBLIC_* value contains the nonce.
  const metroEnvironment = expoMetroChildEnvironment({
    env: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV]: nonce },
    bootstrapOrigin: 'http://127.0.0.1:4321',
    port: 8081,
  });
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
  const iosLaunch = launchExpoNativeCheckout(ios, nonce, { run, env: {} });
  assert.equal(iosLaunch.carrier, 'ios-simctl-environment');
  assert.deepEqual(launchCalls[0].args.slice(0, 3), [
    'simctl', 'launch', '--terminate-running-process',
  ]);
  assert.equal(
    launchCalls[0].options.env[`SIMCTL_CHILD_${SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV}`],
    nonce,
  );

  const android = createExpoRoutingPlan({
    platform: 'android',
    backendPort: 4201,
    metroPort: 4202,
    bootstrapPort: 4203,
    androidSerial: 'emulator-5554',
  });
  const androidLaunch = launchExpoNativeCheckout(android, nonce, { run, env: {} });
  assert.equal(androidLaunch.carrier, 'android-adb-activity-extra');
  assert.deepEqual(launchCalls[1].args.slice(0, 6), [
    '-s', 'emulator-5554', 'shell', 'am', 'start', '-S',
  ]);
  assert.deepEqual(launchCalls[1].args.slice(-3), [
    '--es', SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV, nonce,
  ]);

  const web = createExpoRoutingPlan({
    platform: 'web', backendPort: 4301, metroPort: 4302, bootstrapPort: 4303,
  });
  assert.equal(launchExpoNativeCheckout(web, nonce, { run, env: {} }), null);
  assert.equal(launchCalls.length, 2, 'Expo web has no native checkout launch channel');

  console.log('expo-dev-identity-checkout.test.mjs: bootstrap secrecy, generic refusal, one-shot redemption, web isolation, and native launch carriers pass');
} finally {
  await exchange.close();
  rmSync(scratch, { recursive: true, force: true });
}
