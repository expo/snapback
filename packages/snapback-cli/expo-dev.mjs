import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  diagnosticError,
  managedAdminToken,
  readReadyDescriptor,
  runDev,
  scrubDynamicLoaderEnvironment,
} from './index.mjs';
import { stopProcessGroup } from './process-teardown.mjs';

export const EXPO_DEV_EVENT_FORMAT = 'snapback.expo-dev.v1';
export const SUPERVISED_EXCHANGE_FORMAT = 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH = '/_snapback/expo/v1/bootstrap';
export const METRO_WATCH_BLIND_ROOTS = Object.freeze(['/private/tmp', '/tmp']);

export function expoSupervisorChildEnvironment(env = process.env) {
  const childEnv = { ...(env ?? {}) };
  // The supervisor coordinates backend and Metro processes, but it is not an
  // RQS-store owner. Inheriting the caller's file-store namespace lets a
  // supervised JS child take the app's single-writer lock before the app does.
  delete childEnv.SNAPBACK_CLIENT_RQS_DIR;
  return childEnv;
}

export function expoMetroChildEnvironment({ env, bootstrapOrigin, port }) {
  const childEnv = {
    ...(env ?? {}),
    EXPO_NO_TELEMETRY: '1',
    // @ref LLP 0223#decision — auto-inject, do not auto-write: the
    // credential-free rendezvous origin is process-scoped supervisor
    // environment; a durable .env copy is a rejected stale-lifecycle
    // configuration surface.
    EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN: bootstrapOrigin,
    SNAPBACK_EXPO_METRO_PORT: String(port),
    RCT_METRO_PORT: String(port),
    // Expo's --localhost server asks Node to listen on the hostname
    // "localhost". On IPv6-first Macs that otherwise resolves to ::1,
    // while the supervised iOS route is deliberately 127.0.0.1. Keep the
    // public and bound endpoints identical without exposing Metro on LAN.
    NODE_OPTIONS: metroNodeOptions(env?.NODE_OPTIONS),
  };
  // `snapback dev --expo` is a watch loop even when its controller has no
  // TTY. Omission therefore means ordinary Metro development mode; explicit
  // CI values remain caller-owned for genuinely hermetic invocations.
  if (env?.CI === undefined || env?.CI === null) delete childEnv.CI;
  return childEnv;
}

export function assessMetroWatchInertness({ env = process.env, directory = null } = {}) {
  const advisories = [];

  try {
    const effectiveCi = env?.CI;
    const normalizedCi = effectiveCi == null
      ? ''
      : String(effectiveCi).trim().toLowerCase();
    if (effectiveCi != null && !['', '0', 'false'].includes(normalizedCi)) {
      advisories.push(Object.freeze({
        code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
        condition: 'ci-environment',
        message: `Metro file watching is inert: CI=${effectiveCi} is set in the environment, and Expo/Metro disable file watching under CI.`,
        remediation: 'Edits will not rebuild the served bundle. Unset CI (or pass CI=0) in the supervisor environment to re-enable watching.',
        details: Object.freeze({ ci: String(effectiveCi), defaulted: false }),
      }));
    }
  } catch {
    // Assessment is advisory only and must never disturb the supervised loop.
  }

  try {
    if (typeof directory === 'string' && directory.length > 0) {
      const resolvedPath = resolve(directory);
      let resolvedDirectory = resolvedPath;
      try {
        resolvedDirectory = realpathSync(resolvedPath);
      } catch {
        // A nonexistent or inaccessible path still supports the lexical heuristic.
      }
      const root = METRO_WATCH_BLIND_ROOTS.find((candidate) => (
        resolvedDirectory === candidate || resolvedDirectory.startsWith(`${candidate}/`)
      ));
      if (root !== undefined) {
        advisories.push(Object.freeze({
          code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
          condition: 'watcher-blind-root',
          message: `Metro file watching is inert: the Expo project directory ${resolvedDirectory} is under the watcher-blind root ${root}, where file events do not reach Metro.`,
          remediation: `Edits will not rebuild the served bundle. Move the project off ${root}, or restart the supervised loop after each change.`,
          details: Object.freeze({ directory: resolvedDirectory, root }),
        }));
      }
    }
  } catch {
    // Assessment is advisory only and must never disturb the supervised loop.
  }

  // An active sentinel-touch probe is skipped because Metro's event stream has
  // no reliable rebuild-completion event to join and a probe would write into
  // the user's project; the static tiers cover the observed failure modes
  // (issues/20260808-supervisor-warn-metro-watch-blind.md).
  return Object.freeze(advisories);
}

// Unsupervised Metro (`CI=1 npx expo start`, or `snapback dev --client-command`
// inheriting that environment) never reaches the supervised readiness stream.
// Reuse the same CI normalization and emit the same diagnostic code as an
// advisory before spawn (issues/closed/20260812-guide-gap-unsupervised-metro-ci-advisory.md).
export function cliMetroWatchInertAdvisory({
  env = process.env,
  clientCommand = null,
} = {}) {
  const ciAdvisory = assessMetroWatchInertness({ env })
    .find((advisory) => advisory.condition === 'ci-environment');
  if (!ciAdvisory) return null;
  const inheritedClientCommand = typeof clientCommand === 'string' && clientCommand.length > 0
    ? clientCommand
    : null;
  const unsupervised = ' If you launch Metro/Expo yourself, do not inherit CI=1; unset CI or pass CI=0.';
  const clientArm = inheritedClientCommand === null
    ? ''
    : ` --client-command ${JSON.stringify(inheritedClientCommand)} inherits this environment.`;
  return Object.freeze({
    code: ciAdvisory.code,
    severity: 'warning',
    subsystem: 'cli',
    condition: ciAdvisory.condition,
    message: `${ciAdvisory.message}${clientArm}${unsupervised}`,
    remediation: 'Edits will not rebuild the served bundle. Prefer snapback dev --expo, or unset CI (or pass CI=0) before launching Metro/Expo yourself.',
    details: Object.freeze({
      ...ciAdvisory.details,
      unsupervised: true,
      clientCommand: inheritedClientCommand,
    }),
  });
}

export function emitCliMetroWatchInertAdvisory({
  env = process.env,
  clientCommand = null,
  json = false,
  write = (line) => console.error(line),
} = {}) {
  const advisory = cliMetroWatchInertAdvisory({ env, clientCommand });
  if (advisory === null) return null;
  if (json) {
    write(JSON.stringify({
      ok: true,
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: advisory.code,
      diagnostic: advisory,
    }));
  } else {
    write(`[warning] ${advisory.code} (${advisory.subsystem}) ${advisory.message} ${advisory.remediation}`);
  }
  return advisory;
}

export const SUPERVISED_CONTROL_PATH = '/_snapback/expo/v1/control';

const LOOPBACK_HOST = '127.0.0.1';
const BROWSER_EXCHANGE_ORIGIN_PREFIXES = Object.freeze([
  'http://127.0.0.1:',
  'https://127.0.0.1:',
  'http://localhost:',
  'https://localhost:',
  'http://[::1]:',
  'https://[::1]:',
]);
const DEFAULT_BINDING_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_EMAIL = 'snapback-dev@localhost.invalid';
const CONTROL_BODY_LIMIT_BYTES = 4 * 1_024;
const SUPERVISED_CONNECT_CARRIER = 'supervisor-rendezvous';

export function admittedBrowserExchangeOrigin(originHeader) {
  if (typeof originHeader !== 'string') return null;
  return BROWSER_EXCHANGE_ORIGIN_PREFIXES.some((prefix) => originHeader.startsWith(prefix))
    ? originHeader
    : null;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function constantTimeTokenEqual(presented, expected) {
  const presentedHash = createHash('sha256').update(
    typeof presented === 'string' ? presented : '',
  ).digest();
  const expectedHash = createHash('sha256').update(
    typeof expected === 'string' ? expected : '',
  ).digest();
  const hashesEqual = timingSafeEqual(presentedHash, expectedHash);
  return typeof presented === 'string'
    && presented.length > 0
    && typeof expected === 'string'
    && expected.length > 0
    && hashesEqual;
}

function isLoopbackHost(host) {
  const normalized = String(host).toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === '::1'
    || normalized === 'localhost'
    || normalized.startsWith('127.');
}

function portFromOrigin(origin, label) {
  let parsed;
  try { parsed = new URL(origin); } catch {
    throw diagnosticError(
      'SNAPBACK_EXPO_ROUTE_INVALID',
      `${label} did not provide an absolute HTTP origin`,
      { origin },
    );
  }
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw diagnosticError('SNAPBACK_EXPO_ROUTE_INVALID', `${label} provided an invalid port`);
  }
  return { host: parsed.hostname, port, origin: parsed.origin };
}

async function freeLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });
}

function clientDiagnostic(source, fallbackCode, fallbackMessage) {
  const code = source?.code ?? fallbackCode;
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: source?.severity ?? 'error',
    message: source?.message ?? fallbackMessage,
    details: Object.freeze({ ...(source?.details ?? {}) }),
  });
}

// @ref LLP 0181#provider — E1 automates the already-shipped native session
// mint primitive. The operator token stays supervisor-held and is passed only
// to the native wrapper; the app-facing result contains only the ordinary
// session envelope.
export function mintSupervisedOrdinarySession({
  runtimeBinary,
  readyFile,
  email = DEFAULT_EMAIL,
  operatorToken,
  cwd,
  env = process.env,
} = {}) {
  const result = spawnSync(runtimeBinary, [
    'session', 'mint',
    '--email', email,
    '--ready-file', readyFile,
  ], {
    cwd,
    env: {
      ...scrubDynamicLoaderEnvironment(env),
      ...(typeof operatorToken === 'string' && operatorToken.length > 0
        ? { SNAPBACK_ADMIN_TOKEN: operatorToken }
        : {}),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    const error = diagnosticError(
      'SNAPBACK_EXPO_SESSION_MINT_FAILED',
      'the supervised ordinary-session mint could not run',
      { cause: result.error.code ?? result.error.message },
    );
    error.cause = result.error;
    throw error;
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_EXPO_SESSION_MINT_FAILED',
      'the native session mint did not return one hostOpsResult JSON document',
      { status: result.status, signal: result.signal },
    );
    error.cause = cause;
    throw error;
  }
  if (envelope?.ok === true
    && envelope?.operation === 'auth.mintSession'
    && envelope?.data?.tokenType === 'Bearer'
    && typeof envelope?.data?.token === 'string'
    && envelope.data.token.length > 0) {
    return Object.freeze({
      status: 'ready',
      tokenType: 'Bearer',
      token: envelope.data.token,
    });
  }
  const source = envelope?.diagnostics?.[0] ?? envelope?.diagnostic ?? null;
  const projected = clientDiagnostic(
    source,
    'SNAPBACK_EXPO_SESSION_MINT_FAILED',
    'The supervised ordinary-session mint was refused.',
  );
  if (
    projected.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
    || projected.code === 'SNAPBACK_AUTHORITY_REQUIRED'
  ) {
    return Object.freeze({
      status: 'authority-required',
      diagnostic: projected,
      remediations: Object.freeze([]),
    });
  }
  throw diagnosticError(projected.code, projected.message, projected.details);
}

function appOrigin(host, port) {
  const renderedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${renderedHost}:${port}`;
}

function commandResultDetails(result) {
  return Object.freeze({
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    ...(result?.error ? { cause: result.error.code ?? result.error.message } : {}),
  });
}

function adbSerialClass(serial, fields) {
  if (/^emulator-\d+$/u.test(serial)) return 'emulator';
  if (
    /:\d+$/u.test(serial)
    || /^adb-.+\._adb-tls-(?:connect|pairing)\._tcp\.?$/u.test(serial)
  ) return 'tcpip';
  if (fields.some((field) => field.startsWith('usb:'))) return 'usb';
  // ADB's USB serial is otherwise opaque. Unknown non-network, non-emulator
  // serials stay on the local USB class; selection still requires state=device.
  return 'usb';
}

// @ref LLP 0176#open-questions — OQ4 admits Android emulators and physical
// USB devices through the same per-serial adb reverse discipline, while TCP/IP
// adb is a network carrier and therefore remains outside this supervisor.
export function parseAdbDeviceInventory(stdout) {
  const devices = [];
  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line || /^List of devices attached\b/u.test(line) || line.startsWith('*')) continue;
    const fields = line.split(/\s+/u);
    if (fields.length < 2) continue;
    const [serial, state, ...details] = fields;
    const deviceClass = adbSerialClass(serial, details);
    devices.push(Object.freeze({
      serial,
      state,
      class: deviceClass,
      transport: deviceClass === 'tcpip' ? 'network' : 'local',
      details: Object.freeze([...details]),
    }));
  }
  return Object.freeze(devices);
}

export function enumerateAndroidAdbDevices({
  adbBinary = 'adb',
  run = spawnSync,
  env = process.env,
} = {}) {
  const result = run(adbBinary, ['devices', '-l'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  if (result?.error || result?.status !== 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ADB_INVENTORY_FAILED',
      'adb could not enumerate Android devices for supervised routing',
      commandResultDetails(result),
    );
  }
  return parseAdbDeviceInventory(result.stdout);
}

function publicDeviceInventory(devices) {
  return devices.map((device) => Object.freeze({
    serial: device.serial,
    class: device.class,
    state: device.state,
  }));
}

function refuseTcpAdbDevice(device) {
  throw diagnosticError(
    'SNAPBACK_EXPO_ADB_TCPIP_DEVICE_REFUSED',
    'TCP/IP-connected adb devices are not admitted by the USB/port-forward supervisor',
    {
      serial: device.serial,
      class: device.class,
      reason: 'network-reachability-requires-llp-0168-carrier-review',
      admittedClasses: ['emulator', 'usb'],
    },
  );
}

export function selectAndroidAdbDevice(devices, { serial = null } = {}) {
  const inventory = Array.isArray(devices) ? devices : [];
  let selected = null;
  if (serial !== null) {
    selected = inventory.find((device) => device.serial === serial) ?? null;
    if (selected === null) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_NOT_FOUND',
        `adb did not report the requested Android device ${serial}`,
        { serial, devices: publicDeviceInventory(inventory) },
      );
    }
  } else {
    const admitted = inventory.filter((device) => (
      device.state === 'device' && (device.class === 'emulator' || device.class === 'usb')
    ));
    if (admitted.length > 1) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_AMBIGUOUS',
        'more than one emulator/USB Android device is available; select one with --android-serial',
        { devices: publicDeviceInventory(admitted) },
      );
    }
    if (admitted.length === 1) selected = admitted[0];
    else {
      const tcpip = inventory.find((device) => device.state === 'device' && device.class === 'tcpip');
      if (tcpip) refuseTcpAdbDevice(tcpip);
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_NOT_FOUND',
        'no ready Android emulator or USB device is attached',
        { devices: publicDeviceInventory(inventory) },
      );
    }
  }
  if (selected.class === 'tcpip') refuseTcpAdbDevice(selected);
  if (selected.state !== 'device') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_UNAVAILABLE',
      `the requested Android device is ${selected.state}, not ready`,
      { serial: selected.serial, class: selected.class, state: selected.state },
    );
  }
  return Object.freeze({ serial: selected.serial, class: selected.class });
}

export function parseDevicectlDeviceInventory(document) {
  let parsed = document;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (cause) {
      throw diagnosticError(
        'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_INVALID',
        'devicectl did not produce valid JSON device inventory',
        { cause: cause.message },
      );
    }
  }
  if (!Array.isArray(parsed?.result?.devices)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_INVALID',
      'devicectl JSON did not contain result.devices',
    );
  }
  return Object.freeze(parsed.result.devices
    .filter((entry) => (
      entry?.hardwareProperties?.reality === 'physical'
      && String(entry?.hardwareProperties?.platform ?? '').toLowerCase() === 'ios'
    ))
    .map((entry) => {
      const transportType = String(entry?.connectionProperties?.transportType ?? 'unknown');
      const paired = entry?.connectionProperties?.pairingState === 'paired';
      const tunnelState = String(entry?.connectionProperties?.tunnelState ?? 'unknown');
      const deviceClass = /^(?:wired|usb)$/iu.test(transportType) ? 'usb' : 'network';
      const available = paired
        && deviceClass === 'usb'
        && !/^(?:disconnected|unavailable)$/iu.test(tunnelState);
      return Object.freeze({
        serial: entry?.hardwareProperties?.udid ?? entry?.identifier ?? null,
        hardwareSerial: entry?.hardwareProperties?.serialNumber ?? null,
        name: entry?.deviceProperties?.name ?? null,
        class: deviceClass,
        state: paired ? (available ? 'device' : 'unavailable') : 'unpaired',
        transportType,
        tunnelState,
      });
    })
    .filter((device) => typeof device.serial === 'string' && device.serial.length > 0));
}

export function enumerateIosDevices({
  xcrunBinary = 'xcrun',
  run = spawnSync,
  env = process.env,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-expo-devicectl-'));
  const output = join(scratch, 'devices.json');
  try {
    const result = run(xcrunBinary, [
      'devicectl', 'list', 'devices', '--json-output', output, '--quiet',
    ], { encoding: 'utf8', env, timeout: 30_000 });
    if (result?.error || result?.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_FAILED',
        'xcrun devicectl could not enumerate iOS devices',
        commandResultDetails(result),
      );
    }
    return parseDevicectlDeviceInventory(readFileSync(output, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function selectIosUsbDevice(devices, { udid } = {}) {
  const inventory = Array.isArray(devices) ? devices : [];
  const selected = inventory.find((device) => (
    device.serial === udid || device.hardwareSerial === udid
  ));
  if (!selected) {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_NOT_FOUND',
      `devicectl did not report the requested iOS device ${udid}`,
      { udid, devices: publicDeviceInventory(inventory) },
    );
  }
  if (selected.class !== 'usb') {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_NETWORK_DEVICE_REFUSED',
      'the selected iOS device is reachable through a network transport, not USB',
      {
        serial: selected.serial,
        class: selected.class,
        transportType: selected.transportType,
        reason: 'network-reachability-requires-llp-0168-carrier-review',
      },
    );
  }
  if (selected.state !== 'device') {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_UNAVAILABLE',
      'the selected iOS USB device is not paired and connected',
      { serial: selected.serial, state: selected.state, tunnelState: selected.tunnelState },
    );
  }
  return Object.freeze({ serial: selected.serial, class: 'usb' });
}

export function inspectIosForwardingTools({
  xcrunBinary = 'xcrun',
  iproxyBinary = 'iproxy',
  run = spawnSync,
  env = process.env,
} = {}) {
  const version = run(xcrunBinary, ['devicectl', '--version'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  const help = run(xcrunBinary, ['devicectl', 'help', 'device'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  const iproxy = run(iproxyBinary, ['--help'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  return Object.freeze({
    devicectl: Object.freeze({
      available: !version?.error && version?.status === 0,
      version: version?.status === 0 ? String(version.stdout ?? '').trim() : null,
      supportsTcpForward: help?.status === 0
        && /\b(?:forward|port-forward|reverse)\b/iu.test(String(help.stdout ?? '')),
    }),
    iproxy: Object.freeze({
      available: !iproxy?.error && iproxy?.status === 0,
      direction: 'host-loopback-to-ios-service',
      supportsRequiredReverseDirection: false,
    }),
    requiredDirection: 'ios-device-loopback-to-host-loopback',
  });
}

export function refuseUnsupportedIosUsbForwarding(device, options = {}) {
  const tools = options.tools ?? inspectIosForwardingTools(options);
  throw diagnosticError(
    'SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE',
    'neither devicectl nor iproxy can forward iOS device loopback to host loopback',
    {
      device,
      tools,
      reason: 'devicectl-has-no-tcp-forward-and-iproxy-is-host-to-device-only',
      recovery: 'use the iOS simulator; a physical iOS carrier needs a device-side bridge or a separately accepted posture',
    },
  );
}

// @ref LLP 0181#web-browser — same-host Expo carriers consume the supervisor's
// resolved loopback origins; application code never supplies one.
// @ref LLP 0181#android-emulator — adb reverse is the preferred Android route
// and maps all three supervised ports to loopback from the app's perspective.
export function createExpoRoutingPlan({
  platform = 'ios',
  backendPort,
  metroPort,
  bootstrapPort,
  androidTransport = 'adb-reverse',
  androidSerial = null,
  androidDeviceClass = null,
} = {}) {
  const ports = Object.freeze([
    Object.freeze({ owner: 'backend', devicePort: backendPort, hostPort: backendPort }),
    Object.freeze({ owner: 'metro', devicePort: metroPort, hostPort: metroPort }),
    Object.freeze({ owner: 'bootstrap', devicePort: bootstrapPort, hostPort: bootstrapPort }),
  ]);
  if (ports.some(({ hostPort }) => !Number.isSafeInteger(hostPort) || hostPort < 1)) {
    throw diagnosticError('SNAPBACK_EXPO_ROUTE_INVALID', 'every supervised route needs a valid port');
  }
  if (platform === 'ios' || platform === 'web') {
    return Object.freeze({
      platform,
      transport: 'same-host-loopback',
      bindingRouting: 'loopback',
      appHost: LOOPBACK_HOST,
      ports,
      forwards: Object.freeze([]),
      fallback: null,
      device: Object.freeze({
        serial: null,
        class: platform === 'web' ? 'browser' : 'simulator',
      }),
    });
  }
  if (platform !== 'android') {
    throw diagnosticError(
      'SNAPBACK_EXPO_DEVICE_UNSUPPORTED',
      'supervised Expo development supports only iOS, Android, and web',
      { platform },
    );
  }
  if (androidTransport === 'emulator-host-alias') {
    return Object.freeze({
      platform,
      transport: 'emulator-host-alias',
      bindingRouting: 'port-forward',
      appHost: '10.0.2.2',
      ports,
      forwards: Object.freeze([]),
      fallback: Object.freeze({ host: '10.0.2.2', requiresAdbReverse: false }),
      device: Object.freeze({
        serial: androidSerial,
        class: androidDeviceClass ?? 'emulator',
      }),
    });
  }
  if (androidTransport !== 'adb-reverse') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ROUTE_INVALID',
      'Android transport must be adb-reverse or emulator-host-alias.',
      { androidTransport },
    );
  }
  if (typeof androidSerial !== 'string' || androidSerial.length === 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_REQUIRED',
      'adb reverse requires one enumerated emulator or USB device serial',
    );
  }
  return Object.freeze({
    platform,
    transport: 'adb-reverse',
    bindingRouting: 'port-forward',
    appHost: LOOPBACK_HOST,
    ports,
    forwards: Object.freeze(ports.map(({ owner, devicePort, hostPort }) => Object.freeze({
      owner,
      device: `tcp:${devicePort}`,
      host: `tcp:${hostPort}`,
    }))),
    fallback: Object.freeze({ host: '10.0.2.2', requiresAdbReverse: false }),
    androidSerial,
    device: Object.freeze({
      serial: androidSerial,
      class: androidDeviceClass ?? (/^emulator-\d+$/u.test(androidSerial) ? 'emulator' : 'usb'),
    }),
  });
}

export function createExpoRoutingReadiness(route) {
  return Object.freeze({
    platform: route.platform,
    device: Object.freeze({
      serial: route.device?.serial ?? null,
      class: route.device?.class ?? null,
    }),
    route: Object.freeze({
      transport: route.transport,
      bindingRouting: route.bindingRouting,
      appHost: route.appHost,
      fallback: route.fallback,
    }),
  });
}

export function installAndroidPortForwarding(plan, {
  adbBinary = 'adb',
  run = spawnSync,
  env = process.env,
} = {}) {
  if (plan?.platform !== 'android' || plan.transport !== 'adb-reverse') {
    return Object.freeze({ installed: Object.freeze([]), remove() {} });
  }
  if (typeof plan.androidSerial !== 'string' || plan.androidSerial.length === 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_REQUIRED',
      'adb reverse ownership requires an exact selected device serial',
    );
  }
  const prefix = ['-s', plan.androidSerial];
  const installed = [];
  const invoke = (args) => run(adbBinary, [...prefix, ...args], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  try {
    for (const forward of plan.forwards) {
      const result = invoke(['reverse', forward.device, forward.host]);
      if (result.error || result.status !== 0) {
        throw diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
          `adb reverse failed for ${forward.owner}`,
          { owner: forward.owner, status: result.status, signal: result.signal },
        );
      }
      installed.push(forward);
    }
    const listed = invoke(['reverse', '--list']);
    if (listed.error || listed.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
        'adb reverse rules could not be verified',
        { status: listed.status, signal: listed.signal },
      );
    }
    const reported = String(listed.stdout ?? '').split('\n').map((line) => {
      const fields = line.trim().split(/\s+/u).filter(Boolean);
      if (fields.length < 2) return null;
      // `adb -s <serial> reverse --list` is already selected-device scoped.
      // Current adb can label each three-column row with a transport token
      // such as `host-16` instead of echoing the user-facing device serial.
      // @ref LLP 0176#g4--external-distribution-proof — public-package Android
      // proof must verify real reverse rules without confusing transport ids
      // for the selected emulator/device identity.
      return fields.length >= 3
        ? {
            serial: plan.androidSerial,
            transport: fields[0],
            device: fields.at(-2),
            host: fields.at(-1),
          }
        : { serial: plan.androidSerial, device: fields[0], host: fields[1] };
    }).filter(Boolean);
    for (const forward of installed) {
      if (!reported.some((rule) => (
        rule.serial === plan.androidSerial
        && rule.device === forward.device
        && rule.host === forward.host
      ))) {
        throw diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
          `adb did not report the installed ${forward.owner} reverse rule`,
          {
            owner: forward.owner,
            serial: plan.androidSerial,
            device: forward.device,
            host: forward.host,
          },
        );
      }
    }
  } catch (error) {
    const removalFailures = [];
    for (const forward of installed.reverse()) {
      const result = invoke(['reverse', '--remove', forward.device]);
      if (result.error || result.status !== 0) {
        removalFailures.push(diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_REMOVE_FAILED',
          `adb reverse rollback failed for ${forward.owner}`,
          { owner: forward.owner, status: result.status, signal: result.signal },
        ));
      }
    }
    if (removalFailures.length > 0) {
      throw new AggregateError(
        [error, ...removalFailures],
        'Android port-forward setup and rollback failed',
      );
    }
    throw error;
  }
  let removed = false;
  return Object.freeze({
    installed: Object.freeze([...installed]),
    remove() {
      if (removed) return;
      removed = true;
      const failures = [];
      for (const forward of [...installed].reverse()) {
        const result = invoke(['reverse', '--remove', forward.device]);
        if (result.error || result.status !== 0) {
          failures.push(diagnosticError(
            'SNAPBACK_EXPO_ADB_REVERSE_REMOVE_FAILED',
            `adb reverse removal failed for ${forward.owner}`,
            { owner: forward.owner, status: result.status, signal: result.signal },
          ));
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Android port-forward cleanup failed');
    },
  });
}

function processTable() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'the supervisor could not enumerate its process tree',
    );
  }
  return result.stdout.trim().split('\n').map((line) => {
    const [pid, ppid] = line.trim().split(/\s+/u).map(Number);
    return { pid, ppid };
  }).filter(({ pid, ppid }) => Number.isInteger(pid) && Number.isInteger(ppid));
}

function descendants(rootPid, table) {
  const found = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { pid, ppid } of table) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        changed = true;
      }
    }
  }
  return found;
}

function listenerAddress(name) {
  const trimmed = name.replace(/\s+\(LISTEN\)$/u, '');
  if (trimmed.startsWith('[')) {
    const closing = trimmed.lastIndexOf(']:');
    if (closing === -1) return null;
    return { host: trimmed.slice(1, closing), port: Number(trimmed.slice(closing + 2)) };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) return null;
  return { host: trimmed.slice(0, colon), port: Number(trimmed.slice(colon + 1)) };
}

function parseLsofListeners(stdout) {
  const listeners = [];
  let pid = null;
  let command = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n') && Number.isInteger(pid)) {
      const address = listenerAddress(line.slice(1));
      if (address && Number.isInteger(address.port)) listeners.push({ pid, command, ...address });
    }
  }
  return listeners;
}

function lsofBinary() {
  for (const path of ['/usr/sbin/lsof', '/usr/bin/lsof']) if (existsSync(path)) return path;
  return null;
}

// Enumerate, rather than merely restate configuration: the backend process
// tree, Metro process tree, and supervisor exchange socket are joined to the
// OS listener table and every observed address must be loopback.
// @ref LLP 0181#physical-device-lan-relay-separately-gated — a wildcard/LAN
// Metro listener is the same forbidden front even when the backend is local.
export function enumerateExpoOwnedListeners({ backendPid, metroPid, supervisorPid = process.pid }) {
  const binary = lsofBinary();
  if (binary === null) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'lsof is required to verify every supervised listener before readiness',
    );
  }
  const table = processTable();
  const backend = descendants(backendPid, table);
  const metro = descendants(metroPid, table);
  const pids = new Set([supervisorPid, ...backend, ...metro]);
  const result = spawnSync(binary, [
    '-nP', '-a', '-p', [...pids].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpcn',
  ], { encoding: 'utf8', timeout: 10_000 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'lsof could not inspect the supervised process listeners',
      { status: result.status, signal: result.signal },
    );
  }
  return Object.freeze(parseLsofListeners(result.stdout).map((listener) => {
    const owner = listener.pid === supervisorPid
      ? 'bootstrap'
      : backend.has(listener.pid)
        ? 'backend'
        : 'metro';
    return Object.freeze({
      owner,
      pid: listener.pid,
      command: listener.command,
      host: listener.host,
      port: listener.port,
      loopback: isLoopbackHost(listener.host),
    });
  }));
}

async function waitForListenerInventory({
  backendPid,
  metroPid,
  expected,
  metroProcess,
  timeoutMs = 30_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    if (metroProcess.exitCode !== null || metroProcess.signalCode !== null) {
      throw diagnosticError(
        'SNAPBACK_EXPO_METRO_EXITED',
        'Expo/Metro exited before its listeners were admitted',
        { status: metroProcess.exitCode, signal: metroProcess.signalCode },
      );
    }
    last = enumerateExpoOwnedListeners({ backendPid, metroPid });
    const complete = expected.every(({ owner, port }) => (
      last.some((listener) => listener.owner === owner && listener.port === port)
    ));
    if (complete) {
      const exposed = last.filter((listener) => !listener.loopback);
      if (exposed.length > 0) {
        throw diagnosticError(
          'SNAPBACK_EXPO_LISTENER_EXPOSED',
          'a supervised listener is reachable beyond loopback',
          { listeners: exposed },
        );
      }
      return last;
    }
    await delay(75);
  }
  throw diagnosticError(
    'SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE',
    'the supervisor could not enumerate every expected backend, Metro, and bootstrap listener',
    { expected, observed: last },
  );
}

export async function startBootstrapExchange(getPayload, { onControl } = {}) {
  const sockets = new Set();
  const handleRequest = async (request, response) => {
    const admittedOrigin = admittedBrowserExchangeOrigin(request.headers.origin);
    response.setHeader('cache-control', 'no-store, max-age=0');
    response.setHeader('pragma', 'no-cache');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-type', 'application/json; charset=utf-8');

    // @ref LLP 0176#security-claims-follow-reachability — loopback-only origin
    // admission, matching src/server.rs local_dev_cors, remains the security
    // boundary; only the exchange's response headers widen.
    if (admittedOrigin !== null) {
      response.setHeader('access-control-allow-origin', admittedOrigin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
      response.setHeader('access-control-allow-headers', 'accept');
    }
    if (request.method === 'OPTIONS' && request.url === SUPERVISED_EXCHANGE_PATH) {
      response.setHeader('access-control-max-age', '600');
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'POST' && request.url === SUPERVISED_CONTROL_PATH) {
      if (typeof onControl !== 'function') {
        response.statusCode = 404;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND' }));
        return;
      }
      let body;
      try {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > CONTROL_BODY_LIMIT_BYTES) {
            oversized = true;
            continue;
          }
          chunks.push(chunk);
        }
        if (oversized) throw new SyntaxError('control request body exceeded the size limit');
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new SyntaxError('control request body must be a JSON object');
        }
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_CONTROL_BODY_INVALID',
        }));
        return;
      }
      try {
        const result = await onControl({
          operatorToken: request.headers['x-snapback-operator-token'],
          body,
        });
        response.statusCode = result?.statusCode ?? 500;
        response.end(JSON.stringify(result?.body ?? {
          ok: false,
          code: 'SNAPBACK_EXPO_CONTROL_FAILED',
        }));
      } catch {
        response.statusCode = 500;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_CONTROL_FAILED' }));
      }
      return;
    }
    if (request.method !== 'GET' || request.url !== SUPERVISED_EXCHANGE_PATH) {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND' }));
      return;
    }
    const payload = getPayload();
    if (payload === null) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
      return;
    }
    response.statusCode = 200;
    response.end(JSON.stringify(payload));
  };
  const server = createHttpServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (response.writableEnded) return;
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, LOOPBACK_HOST, resolveListen);
  });
  const address = server.address();
  return Object.freeze({
    origin: `http://${LOOPBACK_HOST}:${address.port}`,
    port: address.port,
    async close() {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  });
}

export function resolveExpoMetroCommand(command, port, platform = 'ios') {
  if (Array.isArray(command) && command.length > 0) {
    return { executable: command[0], args: command.slice(1), shell: false, display: command.join(' ') };
  }
  if (command && typeof command === 'object' && typeof command.command === 'string') {
    return {
      executable: command.command,
      args: Array.isArray(command.args) ? command.args : [],
      shell: false,
      display: [command.command, ...(command.args ?? [])].join(' '),
    };
  }
  if (typeof command === 'string' && command.trim()) {
    return { executable: command, args: [], shell: true, display: command };
  }
  return {
    executable: 'npx',
    args: [
      '--no-install',
      'expo',
      'start',
      '--localhost',
      '--port',
      String(port),
      ...(platform === 'web' ? ['--web'] : []),
    ],
    shell: false,
    display: `npx --no-install expo start --localhost --port ${port}${platform === 'web' ? ' --web' : ''}`,
  };
}

function metroNodeOptions(nodeOptions) {
  return [String(nodeOptions ?? '').trim(), '--dns-result-order=ipv4first']
    .filter(Boolean)
    .join(' ');
}

function startMetro({ command, directory, port, platform, bootstrapOrigin, env, emit, onExit }) {
  const resolved = resolveExpoMetroCommand(command, port, platform);
  const child = spawn(resolved.executable, resolved.args, {
    shell: resolved.shell,
    detached: process.platform !== 'win32',
    cwd: directory,
    env: expoMetroChildEnvironment({ env, bootstrapOrigin, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const forward = (stream, streamName) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        logs.push(Object.freeze({ stream: streamName, line }));
        if (logs.length > 512) logs.shift();
        emit({ ok: true, state: 'metro-output', stream: streamName, line });
      }
    });
  };
  forward(child.stdout, 'stdout');
  forward(child.stderr, 'stderr');
  let terminalReported = false;
  const reportTerminal = (code, signal, error) => {
    if (terminalReported) return;
    terminalReported = true;
    onExit?.(code, signal, error);
  };
  child.once('error', (error) => reportTerminal(null, null, error));
  child.once('exit', (code, signal) => reportTerminal(code, signal, null));
  return { child, logs, command: resolved.display };
}

function bindingFromDescriptor({ descriptor, origin, routing, generation, now, ttlMs }) {
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: descriptor.identity.descriptor,
    target: Object.freeze({
      app: descriptor.identity.app,
      schema: descriptor.identity.schema,
      functions: descriptor.identity.functions,
      origin,
      routing,
    }),
    capabilities: Object.freeze({ offered: Object.freeze([...descriptor.capabilities.required]) }),
    provenance: Object.freeze({
      supervisorGeneration: generation,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

function publicBinding(binding) {
  return structuredClone(binding);
}

function resolveExpoDeviceSelection(options) {
  const platform = options.platform ?? 'ios';
  if (platform === 'web') {
    return Object.freeze({ serial: null, class: 'browser' });
  }
  if (platform === 'ios') {
    if (options.iosUdid === undefined || options.iosUdid === null) {
      return Object.freeze({ serial: null, class: 'simulator' });
    }
    const inventory = options.iosDeviceInventory
      ?? enumerateIosDevices({
        xcrunBinary: options.xcrunBinary,
        run: options.devicectlRun,
        env: options.env,
      });
    const device = selectIosUsbDevice(inventory, { udid: options.iosUdid });
    refuseUnsupportedIosUsbForwarding(device, {
      ...(options.iosForwardingTools ? { tools: options.iosForwardingTools } : {}),
      xcrunBinary: options.xcrunBinary,
      iproxyBinary: options.iproxyBinary,
      run: options.iosToolRun,
      env: options.env,
    });
  }
  if (platform !== 'android') {
    throw diagnosticError(
      'SNAPBACK_EXPO_DEVICE_UNSUPPORTED',
      'supervised Expo development supports only iOS, Android, and web',
      { platform },
    );
  }
  const inventory = options.androidDeviceInventory
    ?? enumerateAndroidAdbDevices({
      adbBinary: options.adbBinary,
      run: options.adbRun,
      env: options.env,
    });
  const device = selectAndroidAdbDevice(inventory, {
    serial: options.androidSerial ?? null,
  });
  if (options.androidTransport === 'emulator-host-alias' && device.class !== 'emulator') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_HOST_ALIAS_DEVICE_INVALID',
      '10.0.2.2 is admitted only for an Android emulator, never a USB device',
      { serial: device.serial, class: device.class },
    );
  }
  return device;
}

// @ref LLP 0181#supervised-development-baseline — one owner coordinates the
// backend, Metro, expiring binding, transient session exchange, correlated
// readiness stream, signal-ready close operation, and complete cleanup.
export async function runExpoDev(options = {}) {
  const correlationId = options.correlationId ?? `snapback-expo-${randomUUID()}`;
  const generation = options.supervisorGeneration ?? `supervisor-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const childEnv = expoSupervisorChildEnvironment(options.env ?? process.env);
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const database = resolve(options.database ?? join(projectRoot, '.snapback', 'dev.sqlite3'));
  const expoDirectory = resolve(options.expoDirectory ?? projectRoot);
  const events = [];
  const emit = (event) => {
    const projected = Object.freeze({
      ...event,
      schemaVersion: EXPO_DEV_EVENT_FORMAT,
      correlationId,
    });
    events.push(projected);
    if (events.length > 1_024) events.shift();
    options.onEvent?.(projected);
    return projected;
  };
  emit({ ok: true, state: 'starting', platform: options.platform ?? 'ios' });

  let dev = null;
  let bootstrap = null;
  let metro = null;
  let forwarding = null;
  let binding = null;
  let authority = null;
  let listeners = Object.freeze([]);
  let closed = false;
  let closePromise = null;
  let closeSupervisor = null;
  let supervisorDescriptorFile = null;
  try {
    const selectedDevice = resolveExpoDeviceSelection({ ...options, env: childEnv });
    emit({
      ok: true,
      state: 'device-selected',
      platform: options.platform ?? 'ios',
      device: selectedDevice,
    });
    dev = await runDev({
      ...options.devOptions,
      backendDirectory: backendRoot,
      projectRoot,
      readyFile: options.readyFile,
      applicationReadyFile: options.applicationReadyFile,
      database,
      runtimeBinary: options.runtimeBinary,
      env: childEnv,
      attach: options.attach === true,
      watch: true,
      serverStdio: options.serverStdio ?? ['ignore', 'ignore', 'ignore'],
      onEvent(event) {
        emit({ ok: event.ok !== false, state: 'backend-event', backend: event });
      },
      onServerExit(code, signal) {
        if (closed) return;
        const error = diagnosticError(
          'SNAPBACK_DEV_SERVER_EXITED',
          'the supervised Snapback backend exited',
          { code, signal },
        );
        try { options.onCriticalExit?.(error); } finally {
          void closeSupervisor?.().catch(() => {});
        }
      },
    });
    if (dev.ok === false) return dev;
    let backendRoute = portFromOrigin(dev.serverUrl, 'Snapback backend');
    if (!isLoopbackHost(backendRoute.host)) {
      throw diagnosticError(
        'SNAPBACK_EXPO_LISTENER_EXPOSED',
        'the supervised Snapback backend is not loopback-bound',
        { host: backendRoute.host, port: backendRoute.port },
      );
    }
    const appDescriptorPath = join(backendRoot, 'generated', 'app.descriptor.json');
    let descriptor = JSON.parse(readFileSync(appDescriptorPath, 'utf8'));
    const readyDescriptor = readReadyDescriptor(dev.readyFile);
    const mintAndSwapAuthority = (email, { emitReplacement = true } = {}) => {
      let operatorToken = managedAdminToken(readReadyDescriptor(dev.readyFile), database);
      try {
        authority = mintSupervisedOrdinarySession({
          runtimeBinary: dev.runtime.binary,
          readyFile: dev.readyFile,
          email,
          operatorToken,
          cwd: projectRoot,
          env: childEnv,
        });
      } finally {
        operatorToken = null;
      }
      if (emitReplacement) {
        emit({
          ok: authority.status === 'ready',
          state: authority.status === 'ready' ? 'authority-replaced' : 'authority-required',
          authority: authority.status === 'ready'
            ? { status: 'ready', kind: 'session', authMode: 'sessions' }
            : authority,
        });
      }
      return authority.status;
    };
    mintAndSwapAuthority(options.email ?? DEFAULT_EMAIL, { emitReplacement: false });
    const metroPort = options.metroPort ?? await freeLoopbackPort();
    let route = null;
    bootstrap = await startBootstrapExchange(() => (
      binding === null || authority === null
        ? null
        : Object.freeze({
            format: SUPERVISED_EXCHANGE_FORMAT,
            correlationId,
            binding,
            authority,
          })
    ), {
      onControl: async ({ operatorToken, body }) => {
        let expectedOperatorToken = null;
        try {
          expectedOperatorToken = managedAdminToken(
            readReadyDescriptor(dev.readyFile),
            database,
          );
          // @ref LLP 0181#provider — the operator capability remains
          // supervisor-held; the control route authenticates it without ever
          // projecting either it or the ordinary replacement bearer.
          if (!constantTimeTokenEqual(operatorToken, expectedOperatorToken)) {
            return {
              statusCode: 401,
              body: { ok: false, code: 'SNAPBACK_EXPO_CONTROL_UNAUTHORIZED' },
            };
          }
        } finally {
          expectedOperatorToken = null;
        }
        if (body?.verb !== 'dev-fresh') {
          return {
            statusCode: 400,
            body: {
              ok: false,
              code: 'SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN',
              supported: ['dev-fresh'],
            },
          };
        }
        const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
        const event = await dev.verbs['dev-fresh']({ requestId });
        if (event?.ok !== true) {
          return {
            statusCode: 200,
            body: {
              schemaVersion: 'snapback.reset-dev-fresh.v1',
              ok: false,
              mode: 'supervised',
              diagnostics: event?.diagnostics ?? [{
                code: 'SNAPBACK_DEV_FRESH_FAILED',
                severity: 'error',
                subsystem: 'cli',
                message: 'the managed dev-fresh operation did not complete',
              }],
              ...(requestId === undefined ? {} : { requestId }),
            },
          };
        }

        try {
          const refreshedReady = readReadyDescriptor(dev.readyFile);
          backendRoute = portFromOrigin(refreshedReady.serverUrl, 'Snapback backend');
          if (!isLoopbackHost(backendRoute.host)) {
            throw diagnosticError(
              'SNAPBACK_EXPO_LISTENER_EXPOSED',
              'the refreshed supervised backend is not loopback-bound',
            );
          }
          descriptor = JSON.parse(readFileSync(appDescriptorPath, 'utf8'));
          route = createExpoRoutingPlan({
            platform: options.platform ?? 'ios',
            backendPort: backendRoute.port,
            metroPort,
            bootstrapPort: bootstrap.port,
            androidTransport: options.androidTransport ?? 'adb-reverse',
            androidSerial: selectedDevice.serial,
            androidDeviceClass: selectedDevice.class,
          });
          binding = bindingFromDescriptor({
            descriptor,
            origin: appOrigin(route.appHost, backendRoute.port),
            routing: route.bindingRouting,
            generation,
            now: options.now?.() ?? Date.now(),
            ttlMs: options.bindingTtlMs ?? DEFAULT_BINDING_TTL_MS,
          });
          forwarding?.remove?.();
          forwarding = installAndroidPortForwarding(route, {
            adbBinary: options.adbBinary,
            run: options.adbRun,
            env: childEnv,
          });
          listeners = await waitForListenerInventory({
            backendPid: refreshedReady.pid,
            metroPid: metro.child.pid,
            metroProcess: metro.child,
            expected: [
              { owner: 'backend', port: backendRoute.port },
              { owner: 'metro', port: metroPort },
              { owner: 'bootstrap', port: bootstrap.port },
            ],
            timeoutMs: options.metroReadyTimeoutMs ?? 30_000,
          });
          emit({ ok: true, state: 'listeners-verified', listeners });
          mintAndSwapAuthority(options.email ?? DEFAULT_EMAIL);
          return {
            statusCode: 200,
            body: {
              schemaVersion: 'snapback.reset-dev-fresh.v1',
              ok: true,
              mode: 'supervised',
              correlationId,
              database: 'fresh',
              seed: 'applied',
              authority: {
                status: authority.status,
                authMode: 'sessions',
              },
              backend: { origin: backendRoute.origin },
              ...(requestId === undefined ? {} : { requestId }),
            },
          };
        } catch (error) {
          return {
            statusCode: 200,
            body: {
              schemaVersion: 'snapback.reset-dev-fresh.v1',
              ok: false,
              mode: 'supervised',
              diagnostics: [error?.diagnostic ?? clientDiagnostic(
                error,
                'SNAPBACK_EXPO_CONTROL_FAILED',
                'the supervised dev-fresh refresh did not complete',
              )],
              ...(requestId === undefined ? {} : { requestId }),
            },
          };
        }
      },
    });
    route = createExpoRoutingPlan({
      platform: options.platform ?? 'ios',
      backendPort: backendRoute.port,
      metroPort,
      bootstrapPort: bootstrap.port,
      androidTransport: options.androidTransport ?? 'adb-reverse',
      androidSerial: selectedDevice.serial,
      androidDeviceClass: selectedDevice.class,
    });
    binding = bindingFromDescriptor({
      descriptor,
      origin: appOrigin(route.appHost, backendRoute.port),
      routing: route.bindingRouting,
      generation,
      now: options.now?.() ?? Date.now(),
      ttlMs: options.bindingTtlMs ?? DEFAULT_BINDING_TTL_MS,
    });
    metro = startMetro({
      command: options.metroCommand,
      directory: expoDirectory,
      port: metroPort,
      platform: options.platform ?? 'ios',
      bootstrapOrigin: appOrigin(route.appHost, bootstrap.port),
      env: childEnv,
      emit,
      onExit(code, signal, cause) {
        if (!closed) {
          const error = diagnosticError(
            'SNAPBACK_EXPO_METRO_EXITED',
            cause
              ? 'Expo/Metro could not be started'
              : 'Expo/Metro exited while supervised development was active',
            { code, signal, ...(cause ? { cause: cause.code ?? cause.message } : {}) },
          );
          try { options.onCriticalExit?.(error); } finally {
            void closeSupervisor?.().catch(() => {});
          }
        }
      },
    });
    const backendPid = dev.child?.pid ?? readyDescriptor.pid;
    listeners = await waitForListenerInventory({
      backendPid,
      metroPid: metro.child.pid,
      metroProcess: metro.child,
      expected: [
        { owner: 'backend', port: backendRoute.port },
        { owner: 'metro', port: metroPort },
        { owner: 'bootstrap', port: bootstrap.port },
      ],
      timeoutMs: options.metroReadyTimeoutMs ?? 30_000,
    });
    emit({ ok: true, state: 'listeners-verified', listeners });
    // Advisory only — never fails the loop. Metro silently disables file
    // watching under an explicit CI environment and cannot see edits under
    // watcher-blind roots such as /private/tmp; without this warning,
    // stale bundles get misread as application bugs
    // (issues/20260808-supervisor-warn-metro-watch-blind.md).
    const watchAdvisories = assessMetroWatchInertness({
      env: childEnv,
      directory: expoDirectory,
    });
    if (watchAdvisories.length > 0) {
      emit({
        ok: true,
        state: 'metro-watch-advisory',
        code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
        advisories: watchAdvisories,
      });
    }
    forwarding = installAndroidPortForwarding(route, {
      adbBinary: options.adbBinary,
      run: options.adbRun,
      env: childEnv,
    });
    const finalState = authority.status === 'ready' ? 'ready' : 'authority-required';
    emit({
      ok: authority.status === 'ready',
      state: finalState,
      connectCarrier: SUPERVISED_CONNECT_CARRIER,
      ...createExpoRoutingReadiness(route),
      binding: publicBinding(binding),
      authority: authority.status === 'ready'
        ? { status: 'ready', kind: 'session', authMode: 'sessions' }
        : authority,
      backend: { pid: dev.child?.pid ?? null, origin: backendRoute.origin },
      metro: { pid: metro.child.pid, origin: appOrigin(route.appHost, metroPort) },
      bootstrap: { origin: appOrigin(route.appHost, bootstrap.port) },
      adminConsoleCommand: `snapback admin --ready-file ${JSON.stringify(dev.readyFile)}`,
    });
    supervisorDescriptorFile = join(dirname(dev.readyFile), 'expo-supervisor.json');
    writeFileSync(supervisorDescriptorFile, `${JSON.stringify({
      formatVersion: 1,
      correlationId,
      supervisorGeneration: generation,
      pid: process.pid,
      exchangeOrigin: bootstrap.origin,
      controlPath: SUPERVISED_CONTROL_PATH,
      startedAt,
    }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(supervisorDescriptorFile, 0o600);

    const close = () => {
      if (closePromise !== null) return closePromise;
      closePromise = (async () => {
        closed = true;
        const failures = [];
        try {
          if (supervisorDescriptorFile !== null) {
            rmSync(supervisorDescriptorFile, { force: true });
          }
        } catch (error) { failures.push(error); }
        try { forwarding?.remove?.(); } catch (error) { failures.push(error); }
        try { await stopProcessGroup(metro?.child, { processGroup: true }); } catch (error) { failures.push(error); }
        try { await bootstrap?.close?.(); } catch (error) { failures.push(error); }
        try { await dev?.close?.(); } catch (error) { failures.push(error); }
        authority = null;
        binding = null;
        emit({ ok: failures.length === 0, state: 'closed', reclaimed: {
          backend: dev?.managed === true,
          metro: metro !== null,
          bootstrap: bootstrap !== null,
          portForwards: forwarding?.installed?.length ?? 0,
        } });
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Expo supervisor cleanup failed');
        }
      })();
      return closePromise;
    };
    closeSupervisor = close;

    return Object.freeze({
      schemaVersion: EXPO_DEV_EVENT_FORMAT,
      ok: true,
      get state() {
        return authority?.status === 'ready' ? 'ready' : 'authority-required';
      },
      correlationId,
      supervisorGeneration: generation,
      connectCarrier: SUPERVISED_CONNECT_CARRIER,
      device: route.device,
      get binding() { return publicBinding(binding); },
      exchangeOrigin: bootstrap.origin,
      metroOrigin: `http://${LOOPBACK_HOST}:${metroPort}`,
      get listeners() { return listeners; },
      verbs: dev.verbs,
      async replaceAuthority(email) {
        if (closed) {
          throw diagnosticError('SNAPBACK_EXPO_SUPERVISOR_CLOSED', 'the Expo supervisor is closed');
        }
        return mintAndSwapAuthority(email);
      },
      inspection() {
        return Object.freeze({
          correlationId,
          listeners,
          binding: binding === null ? null : publicBinding(binding),
          metro: Object.freeze({
            pid: metro.child.pid,
            origin: `http://${LOOPBACK_HOST}:${metroPort}`,
            logs: Object.freeze([...metro.logs]),
          }),
          readiness: Object.freeze([...events]),
        });
      },
      reportControlEvent(event) {
        return emit({
          ok: event?.ok !== false,
          state: 'control-event',
          control: event,
        });
      },
      close,
    });
  } catch (error) {
    closed = true;
    try {
      if (supervisorDescriptorFile !== null) {
        rmSync(supervisorDescriptorFile, { force: true });
      }
    } catch { /* original startup refusal wins */ }
    try { forwarding?.remove?.(); } catch { /* original startup refusal wins */ }
    try { await stopProcessGroup(metro?.child, { processGroup: true }); } catch { /* original startup refusal wins */ }
    try { await bootstrap?.close?.(); } catch { /* original startup refusal wins */ }
    try { await dev?.close?.(); } catch { /* original startup refusal wins */ }
    authority = null;
    binding = null;
    emit({
      ok: false,
      state: 'startup-failed',
      diagnostics: [error?.diagnostic ?? clientDiagnostic(
        error,
        'SNAPBACK_EXPO_DEV_FAILED',
        error?.message ?? String(error),
      )],
    });
    throw error;
  }
}
