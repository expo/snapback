export const EXPO_DEV_EVENT_FORMAT: 'snapback.expo-dev.v1';
export const SUPERVISED_EXCHANGE_FORMAT: 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH: '/_snapback/expo/v1/bootstrap';

export type ExpoDevicePlatform = 'ios' | 'android';
export type AndroidExpoTransport = 'adb-reverse' | 'emulator-host-alias';

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
}>): ExpoRoutingPlan;

export function installAndroidPortForwarding(
  plan: ExpoRoutingPlan,
  options?: Readonly<{
    adbBinary?: string;
    run?: (...args: any[]) => any;
    env?: NodeJS.ProcessEnv;
  }>,
): Readonly<{ installed: ExpoRoutingPlan['forwards']; remove(): void }>;

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
  env?: NodeJS.ProcessEnv;
}>): Readonly<Record<string, unknown>>;

export interface ExpoDevSupervisor {
  readonly schemaVersion: 'snapback.expo-dev.v1';
  readonly ok: true;
  readonly state: 'ready' | 'authority-required';
  readonly correlationId: string;
  readonly supervisorGeneration: string;
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

export function runExpoDev(options?: Readonly<Record<string, unknown>>): Promise<ExpoDevSupervisor>;
