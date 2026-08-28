export interface CanonicalClientValueV1Limits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectFields: number;
  readonly maxArrayEntries: number;
  readonly maxStringUtf8Bytes: number;
  readonly maxKeyUtf8Bytes: number;
}

export const CANONICAL_CLIENT_VALUE_V1_LIMITS: CanonicalClientValueV1Limits;
export function canonicalizeClientValueV1(
  value: unknown,
  options?: {
    readonly limits?: Partial<CanonicalClientValueV1Limits>;
  },
): string;
export function measureCanonicalClientValueV1(
  value: unknown,
  options?: {
    readonly limits?: Partial<CanonicalClientValueV1Limits>;
  },
): Readonly<{
  readonly canonical: string;
  readonly nodes: number;
  readonly bytes: number;
}>;
export function canonicalReactStoreKeyV1(
  providerInstanceId: string,
  reference: Readonly<Record<string, unknown>>,
  args: unknown,
): string;
