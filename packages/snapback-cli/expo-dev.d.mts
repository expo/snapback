export const EXPO_DEV_EVENT_FORMAT: 'snapback.expo-dev.v1';
export const SUPERVISED_EXCHANGE_FORMAT: 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH: '/_snapback/expo/v1/bootstrap';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH: '/_snapback/expo/v1/dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER: 'x-snapback-dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV: 'SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE';
export const METRO_WATCH_BLIND_ROOTS: readonly string[];

export function expoSupervisorChildEnvironment(
  env?: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined>;

export function expoBackendDevAuthEnvironment(
  env: Readonly<Record<string, string | undefined>> | null | undefined,
  metroPort: number,
): Record<string, string | undefined>;

export function expoMetroChildEnvironment(options: Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  bootstrapOrigin: string;
  port: number;
}>): Record<string, string | undefined>;

export interface MetroWatchAdvisory {
  readonly code: 'SNAPBACK_EXPO_METRO_WATCH_INERT';
  readonly condition: 'ci-environment' | 'watcher-blind-root';
  readonly message: string;
  readonly remediation: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export function assessMetroWatchInertness(options?: Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  directory?: string | null;
}>): readonly MetroWatchAdvisory[];

export interface CliMetroWatchInertAdvisory {
  readonly code: 'SNAPBACK_EXPO_METRO_WATCH_INERT';
  readonly severity: 'warning';
  readonly subsystem: 'cli';
  readonly condition: 'ci-environment';
  readonly message: string;
  readonly remediation: string;
  readonly details: Readonly<{
    readonly ci: string;
    readonly defaulted: false;
    readonly unsupervised: true;
    readonly clientCommand: string | null;
  }>;
}

/** Map a truthy process `CI` through `assessMetroWatchInertness` to the
 * unsupervised CLI advisory. Returns null when CI is unset/empty/`0`/`false`. */
export function cliMetroWatchInertAdvisory(options?: Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  clientCommand?: string | null;
}>): CliMetroWatchInertAdvisory | null;

/** Print the unsupervised Metro-watch advisory to stderr (or `write`).
 * Advisory only — never refuses. */
export function emitCliMetroWatchInertAdvisory(options?: Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  clientCommand?: string | null;
  json?: boolean;
  write?: (line: string) => void;
}>): CliMetroWatchInertAdvisory | null;
export const SUPERVISED_CONTROL_PATH: '/_snapback/expo/v1/control';

export function admittedBrowserExchangeOrigin(originHeader: unknown): string | null;

export interface BootstrapExchangeControlRequest {
  readonly operatorToken: string | readonly string[] | undefined;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface BootstrapExchangeControlResult {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface BootstrapExchangeHandle {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface DevIdentityCheckoutRegistry {
  issue(input?: Readonly<{ platform?: string; device?: unknown }>): string | null;
  redeem(presented: unknown): string | null;
  invalidate(): void;
  readonly pending: number;
}

export function createDevIdentityCheckoutRegistry(options: Readonly<{
  getReadyDescriptor: () => Readonly<Record<string, unknown>>;
  readCapabilityFile?: (path: string, encoding: 'utf8') => string | Uint8Array;
  mintNonce?: () => string;
}>): DevIdentityCheckoutRegistry;

export function startBootstrapExchange(
  getPayload: () => unknown | null,
  options?: Readonly<{
    onControl?: (
      request: BootstrapExchangeControlRequest,
    ) => BootstrapExchangeControlResult | Promise<BootstrapExchangeControlResult>;
    onDevIdentityCheckout?: (nonce: unknown) => string | null | Promise<string | null>;
  }>,
): Promise<BootstrapExchangeHandle>;

export type ExpoDevicePlatform = 'ios' | 'android';
export type AndroidExpoTransport = 'adb-reverse' | 'emulator-host-alias';
export type AndroidAdbDeviceClass = 'emulator' | 'usb' | 'tcpip';
export type ExpoDeviceClass = 'simulator' | 'emulator' | 'usb';

export interface ExpoDeviceIdentity {
  readonly serial: string | null;
  readonly class: ExpoDeviceClass;
}

export interface AndroidAdbDevice {
  readonly serial: string;
  readonly state: string;
  readonly class: AndroidAdbDeviceClass;
  readonly transport: 'local' | 'network';
  readonly details: readonly string[];
}

export interface IosDeviceInventoryEntry {
  readonly serial: string;
  readonly hardwareSerial: string | null;
  readonly name: string | null;
  readonly class: 'usb' | 'network';
  readonly state: 'device' | 'unavailable' | 'unpaired';
  readonly transportType: string;
  readonly tunnelState: string;
}

export interface ExpoRoutingPlan {
  readonly platform: ExpoDevicePlatform;
  readonly transport: 'same-host-loopback' | AndroidExpoTransport;
  readonly bindingRouting: 'loopback' | 'port-forward';
  readonly appHost: string;
  readonly ports: readonly Readonly<{
    owner: 'backend' | 'metro' | 'bootstrap';
    devicePort: number;
    hostPort: number;
  }>[];
  readonly forwards: readonly Readonly<{
    owner: 'backend' | 'metro' | 'bootstrap';
    device: string;
    host: string;
  }>[];
  readonly fallback: Readonly<{ host: '10.0.2.2'; requiresAdbReverse: false }> | null;
  readonly androidSerial?: string | null;
  readonly device: ExpoDeviceIdentity;
}

export interface ExpoOwnedListener {
  readonly owner: 'backend' | 'metro' | 'bootstrap';
  readonly pid: number;
  readonly command: string | null;
  readonly host: string;
  readonly port: number;
  readonly loopback: boolean;
}

export function createExpoRoutingPlan(options: Readonly<{
  platform?: ExpoDevicePlatform;
  backendPort: number;
  metroPort: number;
  bootstrapPort: number;
  androidTransport?: AndroidExpoTransport;
  androidSerial?: string | null;
  androidDeviceClass?: 'emulator' | 'usb' | null;
}>): ExpoRoutingPlan;

export function createExpoRoutingReadiness(plan: ExpoRoutingPlan): Readonly<{
  platform: ExpoDevicePlatform;
  device: ExpoDeviceIdentity;
  route: Readonly<{
    transport: ExpoRoutingPlan['transport'];
    bindingRouting: ExpoRoutingPlan['bindingRouting'];
    appHost: string;
    fallback: ExpoRoutingPlan['fallback'];
  }>;
}>;

export function parseAdbDeviceInventory(stdout: string): readonly AndroidAdbDevice[];

export function enumerateAndroidAdbDevices(options?: Readonly<{
  adbBinary?: string;
  run?: (...args: any[]) => any;
  env?: Readonly<Record<string, string | undefined>>;
}>): readonly AndroidAdbDevice[];

export function selectAndroidAdbDevice(
  devices: readonly AndroidAdbDevice[],
  options?: Readonly<{ serial?: string | null }>,
): Readonly<{ serial: string; class: 'emulator' | 'usb' }>;

export function parseDevicectlDeviceInventory(
  document: string | Readonly<Record<string, unknown>>,
): readonly IosDeviceInventoryEntry[];

export function enumerateIosDevices(options?: Readonly<{
  xcrunBinary?: string;
  run?: (...args: any[]) => any;
  env?: Readonly<Record<string, string | undefined>>;
}>): readonly IosDeviceInventoryEntry[];

export function selectIosUsbDevice(
  devices: readonly IosDeviceInventoryEntry[],
  options: Readonly<{ udid: string }>,
): Readonly<{ serial: string; class: 'usb' }>;

export function inspectIosForwardingTools(options?: Readonly<{
  xcrunBinary?: string;
  iproxyBinary?: string;
  run?: (...args: any[]) => any;
  env?: Readonly<Record<string, string | undefined>>;
}>): Readonly<Record<string, unknown>>;

export function refuseUnsupportedIosUsbForwarding(
  device: Readonly<{ serial: string; class: 'usb' }>,
  options?: Readonly<Record<string, unknown>>,
): never;

export function installAndroidPortForwarding(
  plan: ExpoRoutingPlan,
  options?: Readonly<{
    adbBinary?: string;
    run?: (...args: any[]) => any;
    env?: Readonly<Record<string, string | undefined>>;
  }>,
): Readonly<{ installed: ExpoRoutingPlan['forwards']; remove(): void }>;

export function launchExpoNativeCheckout(
  plan: ExpoRoutingPlan,
  nonce: string | null,
  options?: Readonly<{
    xcrunBinary?: string;
    adbBinary?: string;
    iosSimulator?: string;
    iosBundleIdentifier?: string;
    androidComponent?: string;
    run?: (...args: any[]) => any;
    env?: Readonly<Record<string, string | undefined>>;
  }>,
): Readonly<{
  platform: ExpoDevicePlatform;
  device: ExpoDeviceIdentity;
  carrier: 'ios-simctl-environment' | 'android-adb-activity-extra';
}> | null;

export function shouldLaunchExpoNativeCheckout(
  plan: ExpoRoutingPlan,
  options?: Readonly<{
    /** Explicit protocol opt-in for an application-owned development client. */
    nativeCheckout?: boolean;
    /** Test-only command runner; its presence opts protocol tests into launch. */
    nativeLaunchRun?: (...args: any[]) => any;
    iosBundleIdentifier?: string;
    androidComponent?: string;
  }>,
): boolean;

export function enumerateExpoOwnedListeners(options: Readonly<{
  backendPid: number;
  metroPid: number;
  supervisorPid?: number;
}>): readonly ExpoOwnedListener[];

export function mintSupervisedOrdinarySession(options: Readonly<{
  runtimeBinary: string;
  readyFile: string;
  email?: string;
  operatorToken?: string;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}>): Readonly<Record<string, unknown>>;

export interface ExpoDevSupervisor {
  readonly schemaVersion: 'snapback.expo-dev.v1';
  readonly ok: true;
  readonly state: 'ready' | 'authority-required';
  readonly correlationId: string;
  readonly supervisorGeneration: string;
  readonly connectCarrier: 'supervisor-rendezvous';
  readonly device: ExpoDeviceIdentity;
  readonly binding: Readonly<Record<string, unknown>>;
  readonly exchangeOrigin: string;
  readonly metroOrigin: string;
  readonly listeners: readonly ExpoOwnedListener[];
  readonly verbs: Readonly<Record<string, (...args: any[]) => Promise<unknown>>>;
  replaceAuthority(email: string): Promise<'ready' | 'authority-required'>;
  inspection(): Readonly<Record<string, unknown>>;
  reportControlEvent(event: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface RunExpoDevOptions extends Readonly<Record<string, unknown>> {
  /** Explicit protocol opt-in for an application-owned development client. */
  readonly nativeCheckout?: boolean;
  /** Required own-bundle target when nativeCheckout selects iOS. */
  readonly iosBundleIdentifier?: string;
  /** Required own-bundle activity target when nativeCheckout selects Android. */
  readonly androidComponent?: string;
  /** Test-only command runner; its presence opts protocol tests into launch. */
  readonly nativeLaunchRun?: (...args: any[]) => any;
}

export function runExpoDev(options?: RunExpoDevOptions): Promise<ExpoDevSupervisor>;

export declare function resolveExpoMetroCommand(
  command: unknown,
  port: number,
  platform?: string,
): {
  executable: string;
  args: string[];
  shell: boolean;
  display: string;
};
