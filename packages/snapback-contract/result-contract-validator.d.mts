export const RESULT_CONTRACT_LIMITS_V1: Readonly<{
  maxDepth: number;
  maxObjectFields: number;
  maxUnionVariants: number;
  maxArrayItems: number;
  maxValueBytes: number;
  maxResultBytes: number;
  maxResultNodes: number;
  maxSafeInteger: number;
}>;

export interface ResultContractObjectFieldV1 {
  readonly name: string;
  readonly required: boolean;
  readonly value: ResultValueContractV1;
}

/** Closed Rust-owned value-contract grammar (post-JSON image). */
export type ResultValueContractV1 =
  | { readonly kind: 'null' | 'boolean' | 'principal' }
  | { readonly kind: 'string'; readonly maxBytes: number }
  | { readonly kind: 'integer' | 'finiteReal'; readonly min: number; readonly max: number }
  | { readonly kind: 'id'; readonly table: string }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'json'; readonly maxDepth: number; readonly maxBytes: number }
  | { readonly kind: 'array'; readonly element: ResultValueContractV1; readonly maxItems: number }
  | { readonly kind: 'union'; readonly variants: readonly ResultValueContractV1[] }
  | {
      readonly kind: 'object';
      readonly fields: readonly ResultContractObjectFieldV1[];
      readonly allowExtra: boolean;
    };

export type ResultContractDescriptorV1 =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'documents' | 'document';
      readonly table: string;
      readonly document: ResultValueContractV1;
    }
  | {
      readonly kind: 'records';
      readonly record: ResultValueContractV1;
      readonly rows?: { readonly minItems: number; readonly maxItems: number };
    }
  | { readonly kind: 'value'; readonly value: ResultValueContractV1 }
  | { readonly kind: 'legacyQueryRowsV0'; readonly row: ResultValueContractV1 };

export interface ResultContractValidationOutcome {
  readonly ok: boolean;
  /** `null` on success; the failing JSONPath-style locus otherwise. */
  readonly path: string | null;
  /** The admitted JSON image on success; `undefined` on failure. */
  readonly value: unknown;
}

export interface CompiledResultContractValidator {
  readonly kind: ResultContractDescriptorV1['kind'];
  validate(value: unknown): ResultContractValidationOutcome;
}

export function compileResultContractValidator(
  descriptor: ResultContractDescriptorV1,
): CompiledResultContractValidator;
