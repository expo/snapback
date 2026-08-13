export const ARGUMENT_NORMALIZATION_VERSION: 'snapback.argument-normalization.v1';

export type ExactArgumentContractV1 = Readonly<Record<string, unknown>>;

export function exactArgumentContract(reference: unknown): ExactArgumentContractV1 | null;
export function normalizeArgumentsAgainstContractV1<T>(
  value: T,
  contract: ExactArgumentContractV1,
  options?: { readonly path?: string },
): T;
export function normalizeGeneratedArgumentsV1<T>(reference: unknown, args: T): T;
export function optionalPropertyPathsV1(
  contract: ExactArgumentContractV1,
  prefix?: string,
): readonly string[];
