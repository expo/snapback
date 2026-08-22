// Type declarations for result-contracts.mjs — the closed result-contract
// grammar (LLP 0108): effective-contract derivation, canonical hashing, and
// the shared browser-safe validator re-exported from @expo/snapback-contract.

import type { Validator } from './define.js';

export const RESULT_CONTRACT_VERSION: 1;
export const RESULT_MAX_BYTES: number;
export const RESULT_MAX_STRING_BYTES: number;
export const RESULT_MAX_ARRAY_ITEMS: number;
export const VECTOR_MAX_DIMENSIONS: number;
export const VECTOR_COMPONENT_ABS_MAX: number;
export const RESULT_MAX_DEPTH: number;
export const RESULT_MAX_NODES: number;

/**
 * Closed-vocabulary limits shared with the runtime validator (re-exported at
 * runtime from `@expo/snapback-contract/result-contract-validator`).
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

/**
 * The closed v1 value-contract vocabulary. `assetRef` is result-only;
 * `platformSchemaRef` is the argument-lane addition (LLP 0131): a reference
 * into the closed platform-owned registry of exported Rust-owned schemas,
 * valid only in argument contracts.
 */
export type ResultValueContract =
  | Readonly<{ kind: 'null' }>
  | Readonly<{ kind: 'boolean' }>
  | Readonly<{ kind: 'string'; maxBytes: number }>
  | Readonly<{ kind: 'principal' }>
  | Readonly<{ kind: 'assetRef' }>
  | Readonly<{
      kind: 'mediaRef.v1';
      sourceTable: string;
      sourceField: string;
      sourceFieldGeneration: `sha256:${string}`;
      optional: boolean;
      classMTreatment: string;
      uploadIntent: string;
      policyGeneration: string;
      kinds: readonly ('image' | 'video' | 'audio' | 'file')[];
      delivery: string | null;
      variants: readonly string[];
      classificationProfile: 'detected-content-type.v1';
      retentionClass: 'media-reference.v1';
    }>
  | Readonly<{ kind: 'id'; table: string }>
  | Readonly<{ kind: 'integer'; min: number; max: number }>
  | Readonly<{ kind: 'finiteReal'; min: number; max: number }>
  | Readonly<{ kind: 'literal'; value: string | number | boolean | null }>
  | Readonly<{ kind: 'json'; maxDepth: number; maxBytes: number }>
  | Readonly<{ kind: 'array'; element: ResultValueContract; maxItems: number }>
  | Readonly<{ kind: 'vector'; dimensions: number }>
  | Readonly<{ kind: 'union'; variants: readonly ResultValueContract[] }>
  | Readonly<{ kind: 'object'; fields: readonly ResultObjectFieldContract[]; allowExtra: boolean }>
  | Readonly<{ kind: 'platformSchemaRef'; authority: 'platform'; schema: string }>;

/**
 * FunctionArgsContractV1 (LLP 0131): one closed object contract over a
 * function's declared arguments — declaration-ordered entries carrying the
 * shared node vocabulary, bounds always materialized.
 */
export interface FunctionArgsContract {
  readonly fields: readonly ResultObjectFieldContract[];
}

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
 * Runtime re-export of `@expo/snapback-contract/result-contract-validator`:
 * compiles the exact deployed descriptor into a post-JSON-image validator.
 */
export function compileResultContractValidator(
  descriptor: ResultContractDescriptor,
): CompiledResultContractValidator;

/** JSON.stringify over the recursively key-sorted image of `value`. */
export const canonicalJson: (value: unknown) => string;

export function resultContractHash(contract: ResultContractDescriptor): `sha256:${string}`;

/**
 * The v2 argument-contract witness (LLP 0131 §Identity and hashing): SHA-256
 * under the `snapback:function-args:v2` domain over the canonical (JCS) form
 * of the carried descriptor itself.
 */
export function argsContractHash(contract?: FunctionArgsContract | null): `sha256:${string}`;

/**
 * Builds FunctionArgsContractV1 from a function's authored argument
 * validators (declaration order preserved, `v.optional` becomes
 * `required: false`, legacy spellings normalized, bounds materialized) and
 * validates it under the shared node/bounds profile.
 */
export function effectiveArgsContract(
  args?: Readonly<Record<string, Validator>> | null,
): FunctionArgsContract;

/**
 * Lowers an authoring validator (from ./define.mjs) into the closed
 * value-contract vocabulary; throws TypeError on unsupported shapes.
 * `args: true` selects the argument lane (admits `platformSchemaRef`,
 * normalizes relation incarnations to the profile-max string node). `tables`
 * admits and immediately expands result-side app document references.
 */
export function validatorResultValue(
  validator: Validator,
  options?: Readonly<{
    legacy?: boolean;
    args?: boolean;
    tables?: Readonly<Record<string, ResultContractTable>>;
    mediaSource?: Readonly<{ table: string; field: string; optional?: boolean }>;
  }>,
): ResultValueContract;

/** Closed recursive descriptor persisted by StoredStructuredContractV1. */
export function storedStructuredContractDescriptor(
  validator: Validator,
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
  readonly vectorIndexes?: ReadonlyArray<Readonly<{
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
      VectorQuery?: Readonly<{ table: string; index: string; [fact: string]: unknown }>;
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

export type ResultContractProvenance =
  | 'authored'
  | 'authored-compatible-plan-derived'
  | 'plan-derived'
  | 'platform-derived'
  | 'unknown';

/** The effective descriptor together with the authority that established it. */
export function effectiveResultContractFacts(options: Parameters<typeof effectiveResultContract>[0]): Readonly<{
  contract: ResultContractDescriptor;
  provenance: ResultContractProvenance;
}>;

/** Renders the TypeScript result type for a contract descriptor. */
export function resultContractType(
  contract: ResultContractDescriptor,
): string;

/** Renders the `SearchPageV1<...>` type for a search records contract. */
export function searchPageResultType(
  contract: ResultContractDescriptor | null | undefined,
): string;

/** Renders the items-only `VectorPageV1<...>` type. */
export function vectorPageResultType(
  contract: ResultContractDescriptor | null | undefined,
): string;
