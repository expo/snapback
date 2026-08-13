import assert from 'node:assert/strict';

import {
  createExpoRoutingPlan,
  createExpoRoutingReadiness,
  expoBackendDevAuthEnvironment,
  inspectIosForwardingTools,
  installAndroidPortForwarding,
  parseAdbDeviceInventory,
  parseDevicectlDeviceInventory,
  refuseUnsupportedIosUsbForwarding,
  runExpoDev,
  selectAndroidAdbDevice,
  selectIosUsbDevice,
} from './expo-dev.mjs';

assert.deepEqual(
  expoBackendDevAuthEnvironment(
    { SNAPBACK_DEV_AUTH_ORIGINS: 'http://localhost:5173' },
    8081,
  ).SNAPBACK_DEV_AUTH_ORIGINS.split(','),
  [
    'http://localhost:5173',
    'http://127.0.0.1:8081',
    'http://localhost:8081',
    'http://[::1]:8081',
  ],
);

function refuses(code, operation) {
  assert.throws(operation, (error) => error?.diagnostic?.code === code);
}

const androidInventory = parseAdbDeviceInventory(`
List of devices attached
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1
R58MUSB123 device usb:338821120X product:a54x model:SM_A546U transport_id:2
192.0.2.9:5555 device product:a54x model:SM_A546U transport_id:3
adb-R58MNET._adb-tls-connect._tcp device product:a54x model:SM_A546U transport_id:4
R58MOFFLINE offline usb:338821120Y transport_id:5
`);
assert.deepEqual(androidInventory.map(({ serial, state, class: deviceClass }) => ({
  serial, state, class: deviceClass,
})), [
  { serial: 'emulator-5554', state: 'device', class: 'emulator' },
  { serial: 'R58MUSB123', state: 'device', class: 'usb' },
  { serial: '192.0.2.9:5555', state: 'device', class: 'tcpip' },
  { serial: 'adb-R58MNET._adb-tls-connect._tcp', state: 'device', class: 'tcpip' },
  { serial: 'R58MOFFLINE', state: 'offline', class: 'usb' },
]);
assert.deepEqual(selectAndroidAdbDevice(androidInventory, { serial: 'emulator-5554' }), {
  serial: 'emulator-5554', class: 'emulator',
});
assert.deepEqual(selectAndroidAdbDevice(androidInventory, { serial: 'R58MUSB123' }), {
  serial: 'R58MUSB123', class: 'usb',
});
refuses(
  'SNAPBACK_EXPO_ADB_TCPIP_DEVICE_REFUSED',
  () => selectAndroidAdbDevice(androidInventory, { serial: '192.0.2.9:5555' }),
);
refuses(
  'SNAPBACK_EXPO_ADB_TCPIP_DEVICE_REFUSED',
  () => selectAndroidAdbDevice(androidInventory, { serial: 'adb-R58MNET._adb-tls-connect._tcp' }),
);
refuses(
  'SNAPBACK_EXPO_ANDROID_DEVICE_UNAVAILABLE',
  () => selectAndroidAdbDevice(androidInventory, { serial: 'R58MOFFLINE' }),
);
refuses(
  'SNAPBACK_EXPO_ANDROID_DEVICE_AMBIGUOUS',
  () => selectAndroidAdbDevice(androidInventory),
);
const tcpipEvents = [];
await assert.rejects(
  runExpoDev({
    platform: 'android',
    androidSerial: '192.0.2.9:5555',
    androidDeviceInventory: androidInventory,
    onEvent(event) { tcpipEvents.push(event); },
  }),
  (error) => error?.diagnostic?.code === 'SNAPBACK_EXPO_ADB_TCPIP_DEVICE_REFUSED',
);
assert.equal(tcpipEvents.at(-1).state, 'startup-failed');
assert.equal(
  tcpipEvents.at(-1).diagnostics[0].details.reason,
  'network-reachability-requires-llp-0168-carrier-review',
);

const usbRoute = createExpoRoutingPlan({
  platform: 'android',
  backendPort: 5101,
  metroPort: 5102,
  bootstrapPort: 5103,
  androidSerial: 'R58MUSB123',
  androidDeviceClass: 'usb',
});
assert.deepEqual(createExpoRoutingReadiness(usbRoute), {
  platform: 'android',
  device: { serial: 'R58MUSB123', class: 'usb' },
  route: {
    transport: 'adb-reverse',
    bindingRouting: 'port-forward',
    appHost: '127.0.0.1',
    fallback: { host: '10.0.2.2', requiresAdbReverse: false },
  },
});

const installed = new Map();
const adbCalls = [];
const adbRun = (_binary, args) => {
  adbCalls.push([...args]);
  assert.deepEqual(args.slice(0, 2), ['-s', 'R58MUSB123']);
  const command = args.slice(2);
  if (command[0] !== 'reverse') return { status: 1, stdout: '', stderr: 'unexpected' };
  if (command[1] === '--list') {
    return {
      status: 0,
      stdout: [...installed.entries()]
        .map(([device, host]) => `host-16 ${device} ${host}`)
        .join('\n'),
      stderr: '',
    };
  }
  if (command[1] === '--remove') {
    installed.delete(command[2]);
    return { status: 0, stdout: '', stderr: '' };
  }
  installed.set(command[1], command[2]);
  return { status: 0, stdout: '', stderr: '' };
};
const forwarding = installAndroidPortForwarding(usbRoute, { run: adbRun });
assert.equal(forwarding.installed.length, 3);
assert.equal(installed.size, 3);
forwarding.remove();
forwarding.remove();
assert.equal(installed.size, 0);
assert.equal(adbCalls.filter((args) => args[3] === '--remove').length, 3);

const rollbackInstalled = new Map();
const rollbackRemovals = [];
const failingVerifyRun = (_binary, args) => {
  const command = args.slice(2);
  if (command[1] === '--list') {
    const [first] = rollbackInstalled.entries();
    return {
      status: 0,
      stdout: first ? `R58MUSB123 ${first[0]} ${first[1]}` : '',
      stderr: '',
    };
  }
  if (command[1] === '--remove') {
    rollbackInstalled.delete(command[2]);
    rollbackRemovals.push(command[2]);
    return { status: 0, stdout: '', stderr: '' };
  }
  rollbackInstalled.set(command[1], command[2]);
  return { status: 0, stdout: '', stderr: '' };
};
refuses(
  'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
  () => installAndroidPortForwarding(usbRoute, { run: failingVerifyRun }),
);
assert.equal(rollbackInstalled.size, 0, 'failed verification rolls back every installed rule');
assert.equal(rollbackRemovals.length, 3);

const iosInventory = parseDevicectlDeviceInventory({
  result: {
    devices: [
      {
        connectionProperties: {
          pairingState: 'paired', transportType: 'wired', tunnelState: 'connected',
        },
        deviceProperties: { name: 'USB iPhone' },
        hardwareProperties: {
          platform: 'iOS', reality: 'physical', serialNumber: 'HW-USB', udid: 'IOS-USB-UDID',
        },
        identifier: 'CORE-USB',
      },
      {
        connectionProperties: {
          pairingState: 'paired', transportType: 'localNetwork', tunnelState: 'connected',
        },
        deviceProperties: { name: 'Network iPhone' },
        hardwareProperties: {
          platform: 'iOS', reality: 'physical', serialNumber: 'HW-NET', udid: 'IOS-NET-UDID',
        },
        identifier: 'CORE-NET',
      },
    ],
  },
});
assert.deepEqual(selectIosUsbDevice(iosInventory, { udid: 'IOS-USB-UDID' }), {
  serial: 'IOS-USB-UDID', class: 'usb',
});
refuses(
  'SNAPBACK_EXPO_IOS_NETWORK_DEVICE_REFUSED',
  () => selectIosUsbDevice(iosInventory, { udid: 'IOS-NET-UDID' }),
);
const iosNetworkEvents = [];
await assert.rejects(
  runExpoDev({
    platform: 'ios',
    iosUdid: 'IOS-NET-UDID',
    iosDeviceInventory: iosInventory,
    onEvent(event) { iosNetworkEvents.push(event); },
  }),
  (error) => error?.diagnostic?.code === 'SNAPBACK_EXPO_IOS_NETWORK_DEVICE_REFUSED',
);
assert.equal(iosNetworkEvents.at(-1).state, 'startup-failed');

const toolRun = (binary, args) => {
  if (binary === 'xcrun' && args[1] === '--version') {
    return { status: 0, stdout: '518.33\n', stderr: '' };
  }
  if (binary === 'xcrun') {
    return { status: 0, stdout: 'SUBCOMMANDS:\n  copy\n  install\n  process\n', stderr: '' };
  }
  if (binary === 'iproxy') {
    return {
      status: 0,
      stdout: 'iproxy [OPTIONS] LOCAL_PORT:DEVICE_PORT\n--local Connect to USB device\n',
      stderr: '',
    };
  }
  return { status: 1, stdout: '', stderr: 'unexpected' };
};
const tools = inspectIosForwardingTools({ run: toolRun });
assert.deepEqual(tools, {
  devicectl: { available: true, version: '518.33', supportsTcpForward: false },
  iproxy: {
    available: true,
    direction: 'host-loopback-to-ios-service',
    supportsRequiredReverseDirection: false,
  },
  requiredDirection: 'ios-device-loopback-to-host-loopback',
});
refuses(
  'SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE',
  () => refuseUnsupportedIosUsbForwarding(
    { serial: 'IOS-USB-UDID', class: 'usb' },
    { tools },
  ),
);
const iosUsbEvents = [];
await assert.rejects(
  runExpoDev({
    platform: 'ios',
    iosUdid: 'IOS-USB-UDID',
    iosDeviceInventory: iosInventory,
    iosForwardingTools: tools,
    onEvent(event) { iosUsbEvents.push(event); },
  }),
  (error) => error?.diagnostic?.code === 'SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE',
);
assert.equal(iosUsbEvents.at(-1).state, 'startup-failed');
assert.equal(iosUsbEvents.at(-1).diagnostics[0].details.tools.requiredDirection,
  'ios-device-loopback-to-host-loopback');

console.log('expo-device-forwarding.test.mjs: Android emulator/USB/TCP-IP selection, exact reverse verify/rollback/remove, readiness shape, iOS USB/network inventory, and honest tool-direction refusal pass');
