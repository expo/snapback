import type {
  ActionRef,
  FunctionArgs,
  FunctionResult,
  LiveQueryRef,
  MutationRef,
} from '@expo/snapback-client';

export { SnapbackProvider, skip, useSnapbackQuery as useQueryState } from './index.mjs';

export type FamiliarAuthoringProfile = 'snapback-familiar-ts-v1';

type FamiliarBrand = Readonly<{
  authoringProfile: FamiliarAuthoringProfile;
  readonly __snapbackAuthoringProfile?: FamiliarAuthoringProfile;
}>;

export type FamiliarLiveQueryReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result = unknown,
> = LiveQueryRef<Name, Args, Result> & FamiliarBrand;

export type FamiliarMutationReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result = unknown,
> = MutationRef<Name, Args, Result> & FamiliarBrand;

export type FamiliarActionReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result = unknown,
> = ActionRef<Name, Args, Result> & FamiliarBrand;

export type QueryReference<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  FamiliarLiveQueryReference<Name, Args, Result>;
export type MutationReference<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  FamiliarMutationReference<Name, Args, Result>;
export type ActionReference<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  FamiliarActionReference<Name, Args, Result>;

export function useQuery<Ref extends FamiliarLiveQueryReference>(
  reference: Ref,
  args: FunctionArgs<Ref> | 'skip' | typeof import('./index.mjs').skip,
): FunctionResult<Ref> | undefined;

export function useMutation<Ref extends FamiliarMutationReference>(
  reference: Ref,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;

export function useAction<Ref extends FamiliarActionReference>(
  reference: Ref,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;
