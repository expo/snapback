export const APP_DESCRIPTOR_FORMAT: 'snapback.app.v1';
export const APP_DESCRIPTOR_MAX_BYTES: number;

export interface AppDescriptorValidationProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PortableAppDescriptorV1 {
  readonly format: 'snapback.app.v1';
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
  readonly commands: Readonly<Record<string, never>>;
  readonly surfaces: Readonly<Record<string, never>>;
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
  schema: string;
  functions: string;
  api: PortableAppDescriptorV1['api'];
  requiredCapabilities: readonly string[];
}>): PortableAppDescriptorV1;
export function serializeAppDescriptorV1(descriptor: PortableAppDescriptorV1): string;
