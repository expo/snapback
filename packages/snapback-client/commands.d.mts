import type { AssetFileLike, AssetTaskSnapshot, AssetUploadReferenceLike, AssetUploadTask, SnapbackAssetClient } from './assets.mjs';
import type { FunctionArgs, FunctionResult, SnapbackClient, SnapbackFunctionReference } from './index.mjs';

export type PlatformCommandAssetSource = Readonly<{
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}>;
export type CommandAssetSource = AssetFileLike | PlatformCommandAssetSource;
export type AdaptedCommandAssetSource = Readonly<{
  file: AssetFileLike;
  declaredFilename?: string | null;
  declaredContentType?: string | null;
  previewUrl?: string | null;
}>;
export type CommandAssetSourceAdapter = (
  source: PlatformCommandAssetSource,
) => AssetFileLike | AdaptedCommandAssetSource | Promise<AssetFileLike | AdaptedCommandAssetSource>;
type MediaCommandAssetInput<Input extends string, MinItems extends number> = MinItems extends 0
  ? { readonly [Field in Input]?: CommandAssetSource | readonly CommandAssetSource[] }
  : { readonly [Field in Input]: CommandAssetSource | readonly CommandAssetSource[] };
type MediaCommandPrincipalInput<Input extends string | never> = [Input] extends [never]
  ? unknown
  : { readonly [Field in Input]: readonly string[] };
type CommandAssetInput<Input extends string | never, Optional extends boolean> =
  [Input] extends [never]
    ? unknown
    : Optional extends true
      ? { readonly [Field in Input]?: CommandAssetSource }
      : { readonly [Field in Input]: CommandAssetSource };
export interface AssetBearingCommandDescriptorV1<
  Mutation extends SnapbackFunctionReference<string, 'Mutation', unknown, unknown> = SnapbackFunctionReference<string, 'Mutation', unknown, unknown>,
  AssetInput extends string | never = string,
  MutationArg extends string | never = string,
  Optional extends boolean = boolean,
  Intent = unknown,
> {
  readonly kind: 'asset-bearing-command.v1';
  readonly __snapbackReferenceKind: 'Command';
  readonly mutation: Mutation;
  readonly asset: [AssetInput] extends [never] ? null : null | Readonly<{
    readonly input: AssetInput;
    readonly intent: Intent;
    readonly mutationArg: MutationArg;
    readonly optional: Optional;
  }>;
  readonly passthroughArgs: readonly string[];
  readonly __args?: Omit<FunctionArgs<Mutation>, MutationArg> & CommandAssetInput<AssetInput, Optional>;
  readonly __result?: FunctionResult<Mutation>;
}
export interface MediaCommandDescriptorV1<
  Mutation extends SnapbackFunctionReference<string, 'Mutation', unknown, unknown> = SnapbackFunctionReference<string, 'Mutation', unknown, unknown>,
  MediaInput extends string = string,
  MutationArg extends string = string,
  MinItems extends number = number,
  MaxItems extends number = number,
  PrincipalInput extends string | never = never,
  Intent extends AssetUploadReferenceLike = AssetUploadReferenceLike,
> {
  readonly kind: 'media-command.v1';
  readonly __snapbackReferenceKind: 'Command';
  readonly mutation: Mutation;
  readonly intent: Intent;
  readonly binding: Readonly<{
    format: 'snapback.media-command-binding.v1';
    identity: string;
    command: Readonly<{ id: string; name: string }>;
    media: Readonly<{
      input: MediaInput;
      intent: string;
      mutationArg: MutationArg;
      minItems: MinItems;
      maxItems: MaxItems;
    }>;
    taskProfile: Readonly<{ concurrency: number }>;
    principalInput?: Readonly<{ input: PrincipalInput; minItems: number; maxItems: number }>;
  }>;
  readonly passthroughArgs: readonly string[];
  readonly __args?: Omit<FunctionArgs<Mutation>, MutationArg>
    & MediaCommandAssetInput<MediaInput, MinItems>
    & MediaCommandPrincipalInput<PrincipalInput>;
  readonly __result?: FunctionResult<Mutation>;
}
export type AssetBearingCommandReferenceV1 = Pick<
  AssetBearingCommandDescriptorV1,
  'kind' | '__snapbackReferenceKind' | 'mutation' | 'asset' | 'passthroughArgs'
>;
export type MediaCommandReferenceV1 = Pick<
  MediaCommandDescriptorV1<
    SnapbackFunctionReference<string, 'Mutation', unknown, unknown>,
    string,
    string,
    number,
    number,
    string,
    AssetUploadReferenceLike
  >,
  'kind' | '__snapbackReferenceKind' | 'mutation' | 'intent' | 'binding' | 'passthroughArgs'
>;
export type CommandRef = AssetBearingCommandReferenceV1 | MediaCommandReferenceV1;

export type CommandArgs<Command> = Command extends { readonly __args?: infer Args } ? Args : Record<string, unknown>;
export type CommandResult<Command> = Command extends { readonly __result?: infer Result } ? Result : unknown;

export type SnapbackCommandDiagnostic = Readonly<{
  schemaVersion: 'snapback.client-diagnostic.v1';
  code: string;
  severity: 'error';
  message: string;
  details: Readonly<Record<string, unknown>>;
}>;
export interface TypedRemediation {
  readonly kind: string;
  readonly riskClass: string;
  readonly machineApplicable: boolean;
  readonly requiresApproval: boolean;
  readonly authorityEffect: string;
  readonly precondition: Readonly<Record<string, unknown>>;
}
export interface CommandResidue {
  readonly assetId: string;
  readonly unattached: 'authoritative' | 'inferred' | 'unknown';
  readonly basis: string;
  readonly cleanupPolicy: string;
}
export interface MediaCommandResidue extends CommandResidue {
  readonly ordinal: number;
  readonly cleanupProvenance: 'asset-authoritative' | 'llp0044-policy';
}
export interface MediaCommandItemSnapshot {
  readonly ordinal: number;
  readonly status: string;
  readonly asset: AssetTaskSnapshot | null;
}
export interface MediaCommandProgress {
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  readonly finalizedItems: number;
  readonly totalItems: number;
}
export interface MutationAttemptSnapshot<Result = unknown> {
  readonly id: string;
  readonly status: 'pending' | 'confirmed' | 'rejected' | 'ambiguous';
  readonly diagnostic: SnapbackCommandDiagnostic | null;
  readonly result: Result | null;
  readonly receipt?: unknown;
}
export type CommandTaskSnapshot<Result> =
  | Readonly<{ status: 'preparing'; asset: null; mutation: null }>
  | Readonly<{ status: 'transferring'; asset: AssetTaskSnapshot; mutation: null }>
  | Readonly<{ status: 'committing'; asset: AssetTaskSnapshot | null; mutation: MutationAttemptSnapshot<Result> }>
  | Readonly<{ status: 'succeeded'; result: Result; asset: AssetTaskSnapshot | null; residue: null }>
  | Readonly<{
      status: 'failed' | 'cancelled' | 'ambiguous';
      diagnostic: SnapbackCommandDiagnostic;
      asset: AssetTaskSnapshot | null;
      mutation: MutationAttemptSnapshot<Result> | null;
      residue: CommandResidue | null;
      repairs: readonly TypedRemediation[];
    }>;
export type CommandOutcome<Result> =
  | Readonly<{ kind: 'committed'; result: Result }>
  | Readonly<{ kind: 'failed'; diagnostic: SnapbackCommandDiagnostic; residue: CommandResidue | null; repairs: readonly TypedRemediation[] }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'ambiguous'; diagnostic: SnapbackCommandDiagnostic; residue: CommandResidue | null; repairs: readonly TypedRemediation[] }>
  | Readonly<{ kind: 'notRetryable'; diagnostic: SnapbackCommandDiagnostic }>;
export interface CommandTask<Result> {
  readonly id: string;
  readonly generation: number;
  readonly done: Promise<CommandOutcome<Result>>;
  snapshot(): CommandTaskSnapshot<Result>;
  subscribe(listener: () => void): () => void;
  cancel(): Promise<void>;
  retry(): CommandTask<Result>;
}
export type MediaCommandTaskSnapshot<Result> =
  | Readonly<{
      status: 'validating' | 'uploading' | 'committing';
      items: readonly MediaCommandItemSnapshot[];
      progress: MediaCommandProgress;
      mutation: MutationAttemptSnapshot<Result> | null;
    }>
  | Readonly<{
      status: 'committed';
      result: Result;
      items: readonly MediaCommandItemSnapshot[];
      progress: MediaCommandProgress;
      mutation: MutationAttemptSnapshot<Result>;
      residue: readonly [];
    }>
  | Readonly<{
      status: 'failed' | 'cancelled' | 'ambiguous';
      diagnostic: SnapbackCommandDiagnostic;
      items: readonly MediaCommandItemSnapshot[];
      progress: MediaCommandProgress;
      mutation: MutationAttemptSnapshot<Result> | null;
      residue: readonly MediaCommandResidue[];
      repairs: readonly TypedRemediation[];
    }>;
export type MediaCommandOutcome<Result> =
  | Readonly<{ kind: 'committed'; result: Result }>
  | Readonly<{ kind: 'failed'; diagnostic: SnapbackCommandDiagnostic; residue: readonly MediaCommandResidue[]; repairs: readonly TypedRemediation[] }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'ambiguous'; diagnostic: SnapbackCommandDiagnostic; residue: readonly MediaCommandResidue[]; repairs: readonly TypedRemediation[] }>
  | Readonly<{ kind: 'notRetryable'; diagnostic: SnapbackCommandDiagnostic }>;
export interface MediaCommandTask<Result> {
  readonly id: string;
  readonly generation: number;
  readonly done: Promise<MediaCommandOutcome<Result>>;
  snapshot(): MediaCommandTaskSnapshot<Result>;
  subscribe(listener: () => void): () => void;
  cancel(): Promise<void>;
  retry(): MediaCommandTask<Result>;
}

export declare class SnapbackCommandClient {
  constructor(client: SnapbackClient, options?: Readonly<{
    assets?: SnapbackAssetClient | null;
    assetSourceAdapter?: CommandAssetSourceAdapter | null;
    invokeMutation?: ((reference: unknown, args: Record<string, unknown>, options: Readonly<{ clientMutationId: string; authorityCapture: unknown; mediaCommand?: unknown }>) => Promise<unknown>) | null;
  }>);
  readonly client: SnapbackClient;
  readonly assets: SnapbackAssetClient;
  start<Command extends CommandRef>(
    command: Command,
    input: CommandArgs<Command>,
  ): Command extends { readonly kind: 'media-command.v1' }
    ? MediaCommandTask<CommandResult<Command>>
    : CommandTask<CommandResult<Command>>;
  inspection(): Readonly<{ activeCommandTasks: number }>;
  dispose(): Promise<void>;
}
export declare function createCommandClient(
  client: SnapbackClient,
  options?: ConstructorParameters<typeof SnapbackCommandClient>[1],
): SnapbackCommandClient;

export type { AssetTaskSnapshot, AssetUploadTask };
