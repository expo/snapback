export const APP_DESCRIPTOR_FORMAT: 'snapback.app.v1';
export const APP_DESCRIPTOR_MAX_BYTES: number;
export const APPLICATION_AUTH_BOOTSTRAP_FORMAT: 'snapback.application-auth-bootstrap.v1';
export const APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS: readonly [
  'guest-v1',
  'password-v1',
  'email-code-v1',
  'external-session-explicit-v1',
];
export const SURFACE_MAX_PARAMS: 8;
export const SURFACE_MAX_MEMBERS: 24;
export const SURFACE_MAX_MEMBER_BINDINGS: 32;
export const SURFACE_MAX_SCOPE_RECORD_FIELDS: 8;
export const SURFACE_MAX_PER_APP: 32;

export interface AppDescriptorValidationProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PortableAppDescriptorV1 {
  readonly format: 'snapback.app.v1';
  readonly authoringProfile: 'snapback-explicit-v1' | 'snapback-familiar-ts-v1';
  readonly authBootstrap?: Readonly<{
    format: 'snapback.application-auth-bootstrap.v1';
    appId: string;
    mode: 'sessions';
    custody: 'durable-required' | 'volatile-explicit';
    entryMechanisms: readonly ('guest-v1' | 'password-v1' | 'email-code-v1' | 'external-session-explicit-v1')[];
    anonymousPublic: 'allowed' | 'refused';
    lifecycleProtocol: 1;
  }>;
  readonly identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
  readonly api: Readonly<{
    queries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    mutations: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    assets: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    ephemeral: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    queryGroups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  }>;
  readonly commands: Readonly<Record<string, Readonly<{
    readonly kind: 'asset-bearing-command.v1';
    readonly mutation: Readonly<Record<string, unknown>>;
    readonly asset: null | Readonly<{
      readonly input: string;
      readonly intent: Readonly<Record<string, unknown>>;
      readonly mutationArg: string;
      readonly optional: boolean;
    }>;
    readonly passthroughArgs: readonly string[];
  }>>>;
  readonly surfaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly capabilities: Readonly<{ required: readonly string[] }>;
}

export function canonicalizeAppDescriptorV1(value: unknown): string;
export function appDescriptorDigestV1(candidate: PortableAppDescriptorV1): string;
export function validateAppDescriptorV1(
  candidate: unknown,
  options?: Readonly<{ maxBytes?: number; verifyDigest?: boolean }>,
): AppDescriptorValidationProblem[];
export function createAppDescriptorV1(input: Readonly<{
  app: string;
  authoringProfile: PortableAppDescriptorV1['authoringProfile'];
  schema: string;
  functions: string;
  authBootstrap?: PortableAppDescriptorV1['authBootstrap'];
  api: PortableAppDescriptorV1['api'];
  commands?: PortableAppDescriptorV1['commands'];
  surfaces?: PortableAppDescriptorV1['surfaces'];
  requiredCapabilities: readonly string[];
}>): PortableAppDescriptorV1;
export function serializeAppDescriptorV1(descriptor: PortableAppDescriptorV1): string;
