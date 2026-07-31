// Type declarations for result-contracts.mjs — the closed result-contract
// grammar (LLP 0108): effective-contract derivation, canonical hashing, and
// the shared browser-safe validator re-exported from @snapback/contract.

import type { Validator } from './define.js';

export const RESULT_CONTRACT_VERSION: 1;
export const RESULT_MAX_BYTES: number;
export const RESULT_MAX_STRING_BYTES: number;
export const RESULT_MAX_ARRAY_ITEMS: number;
export const RESULT_MAX_DEPTH: number;
export const RESULT_MAX_NODES: number;

/**
 * Closed-vocabulary limits shared with the runtime validator (re-exported at
 * runtime from `@snapback/contract/result-contract-validator`).
 */
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

export interface ResultObjectFieldContract {
  readonly name: string;
  readonly required: boolean;
  readonly value: ResultValueContract;
}

/** The closed v1 value-contract vocabulary. */
export type ResultValueContract =
  | Readonly<{ kind: 'null' }>
  | Readonly<{ kind: 'boolean' }>
  | Readonly<{ kind: 'string'; maxBytes: number }>
  | Readonly<{ kind: 'principal' }>
  | Readonly<{ kind: 'id'; table: string }>
  | Readonly<{ kind: 'integer'; min: number; max: number }>
  | Readonly<{ kind: 'finiteReal'; min: number; max: number }>
  | Readonly<{ kind: 'literal'; value: string | number | boolean | null }>
  | Readonly<{ kind: 'json'; maxDepth: number; maxBytes: number }>
  | Readonly<{ kind: 'array'; element: ResultValueContract; maxItems: number }>
  | Readonly<{ kind: 'union'; variants: readonly ResultValueContract[] }>
  | Readonly<{ kind: 'object'; fields: readonly ResultObjectFieldContract[]; allowExtra: boolean }>;

/** The closed top-level result-contract descriptor vocabulary. */
export type ResultContractDescriptor =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'documents'; table: string; document: ResultValueContract }>
  | Readonly<{ kind: 'document'; table: string; document: ResultValueContract }>
  | Readonly<{
      kind: 'records';
      record: ResultValueContract;
      rows?: Readonly<{ minItems: number; maxItems: number }>;
    }>
  | Readonly<{ kind: 'value'; value: ResultValueContract }>
  | Readonly<{ kind: 'legacyQueryRowsV0'; row: ResultValueContract }>;

export type CompiledResultContractValidation =
  | Readonly<{ ok: true; path: null; value: unknown }>
  | Readonly<{ ok: false; path: string; value: undefined }>;

export interface CompiledResultContractValidator {
  readonly kind: ResultContractDescriptor['kind'];
  validate(value: unknown): CompiledResultContractValidation;
}

/**
 * Runtime re-export of `@snapback/contract/result-contract-validator`:
 * compiles the exact deployed descriptor into a post-JSON-image validator.
 */
export function compileResultContractValidator(
  descriptor: ResultContractDescriptor,
): CompiledResultContractValidator;

/** JSON.stringify over the recursively key-sorted image of `value`. */
export const canonicalJson: (value: unknown) => string;

export function resultContractHash(contract: ResultContractDescriptor): `sha256:${string}`;
export function argsContractHash(args?: unknown): `sha256:${string}`;

/**
 * Lowers an authoring validator (from ./define.mjs) into the closed
 * value-contract vocabulary; throws TypeError on unsupported shapes.
 */
export function validatorResultValue(
  validator: Validator,
  options?: Readonly<{ legacy?: boolean }>,
): ResultValueContract;

/** Table shapes as the effective-contract derivation observes them. */
export interface ResultContractTableField {
  readonly name: string;
  readonly field_type: unknown;
  readonly optional?: boolean;
}

export interface ResultContractTable {
  readonly fields?: readonly ResultContractTableField[];
  readonly searchIndexes?: ReadonlyArray<Readonly<{
    name: string;
    storedFields?: readonly string[];
    [fact: string]: unknown;
  }>>;
  readonly [fact: string]: unknown;
}

/**
 * Derives the schema-expanded effective result contract for one function from
 * its authored declaration, legacy `result` validator, or HostPlan runtime;
 * `{ kind: 'unknown' }` when nothing is declared or derivable.
 */
export function effectiveResultContract(options: Readonly<{
  def?: Readonly<{
    resultContract?: Readonly<{
      kind: 'documents' | 'document' | 'records' | 'value';
      table?: string;
      validator?: Validator;
      rows?: Readonly<{ minItems: number; maxItems: number }>;
    }>;
    result?: Validator;
    [fact: string]: unknown;
  }> | null;
  functionKind: string;
  runtime?: Readonly<{
    HostPlan?: Readonly<{
      Query?: Readonly<{ table?: string; [fact: string]: unknown }>;
      SearchQuery?: Readonly<{ table: string; index: string; [fact: string]: unknown }>;
      Mutation?: Readonly<{
        return_value?: Readonly<{
          Document?: Readonly<{ table?: string; [fact: string]: unknown }>;
          [fact: string]: unknown;
        }> | null;
        [fact: string]: unknown;
      }>;
      [fact: string]: unknown;
    }>;
    [fact: string]: unknown;
  }> | null;
  tables: Readonly<Record<string, ResultContractTable>>;
}>): ResultContractDescriptor;

/** Renders the TypeScript result type for a contract descriptor. */
export function resultContractType(
  contract: ResultContractDescriptor,
  tableType?: (table: string) => string,
): string;

/** Renders the `SearchPageV1<...>` type for a search records contract. */
export function searchPageResultType(
  contract: ResultContractDescriptor | null | undefined,
): string;
