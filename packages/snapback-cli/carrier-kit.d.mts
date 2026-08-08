export type TemplateCarrierName = 'headless' | 'web-browser' | 'native-simulator';

export interface TemplateCarrierConfig {
  readonly schemaVersion: 'snapback.template-carriers.v1';
  readonly verifyCommand: readonly string[];
  readonly verifyReceipt: string;
  readonly artifactsDirectory?: string;
  readonly carriers: Readonly<Partial<Record<TemplateCarrierName, Readonly<Record<string, unknown>>>>>;
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
  options?: { readonly root?: string },
): Promise<number>;
