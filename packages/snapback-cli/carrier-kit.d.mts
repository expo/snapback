export type TemplateCarrierName = 'headless' | 'web-browser' | 'native-simulator';

export type TemplateWebBrowserCarrier = Readonly<{
  command: readonly string[];
  startupTimeoutMs?: number;
  browserJourney?: Readonly<{
    /** Returns truthy only after application UI and its first live read are ready. */
    readyExpression: string;
    /** Async expression returning {marker, readObserved: true, writeObserved: true}. */
    runExpression: string;
    /** Application-ready UI text that must remain in the captured DOM. */
    requiredDomText: readonly string[];
    forbiddenDomText: readonly string[];
  }>;
} & (
  | { origin: string; structuredReadiness?: never }
  | {
      origin?: never;
      structuredReadiness: Readonly<{
        kind: 'expo-supervisor';
        file: `{artifacts}/${string}`;
      }>;
    }
)>;

export interface TemplateCarrierConfig {
  readonly schemaVersion: 'snapback.template-carriers.v1';
  readonly verifyCommand: readonly string[];
  readonly verifyReceipt: string;
  readonly artifactsDirectory?: string;
  readonly carriers: Readonly<{
    headless?: Readonly<Record<string, never>>;
    'web-browser'?: TemplateWebBrowserCarrier;
    'native-simulator'?: Readonly<Record<string, unknown>>;
  }>;
}

export const TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION: 'snapback.template-carriers.v1';
export const TEMPLATE_CARRIER_LOG_SCHEMA_VERSION: 'snapback.template-carrier-director.v1';
export function defineTemplateCarrierConfig(config: TemplateCarrierConfig): TemplateCarrierConfig;
export function updateSimulatorSchemeApproval(options: {
  readonly plistPath: string;
  readonly scheme: string;
  readonly bundleId: string;
}): Readonly<{ literalKey: string; bundleId: string }>;
export function selfCheckTemplateCarrierConfig(config: TemplateCarrierConfig): Promise<Readonly<Record<string, unknown>>>;
export function runTemplateCarrierCli(
  config: TemplateCarrierConfig,
  argv: readonly string[],
  options?: {
    readonly root?: string;
    /** Test seam for the post-descriptor HTTP probe. */
    readonly fetch?: typeof globalThis.fetch;
  },
): Promise<number>;
