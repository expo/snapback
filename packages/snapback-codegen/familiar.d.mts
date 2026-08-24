export {
  allow,
  defineAuth,
  defineEphemeral,
  defineSchema,
  ephemeral,
  membershipResource,
  v,
} from './define.js';

import type { AssetUploadSpec, MembershipPredicate, TableBuilder, Validator } from './define.js';

export type FamiliarAssetAuthorizeContext = Readonly<{
  auth: Readonly<{ userId: string | null }>;
}>;

export declare function defineAssetUpload(
  spec: Omit<AssetUploadSpec, 'authorize'> & Readonly<{
    authorize?: (ctx: FamiliarAssetAuthorizeContext, args?: unknown) => unknown;
  }>,
): unknown;

export declare function defineTable<const Fields extends Record<string, Validator>>(
  fields: Fields,
): TableBuilder<Fields>;

type Auth = 'public' | 'optional-user' | 'authenticated';
type Handler = (ctx: any, args: any) => unknown;
type Common = Readonly<{
  args: Readonly<Record<string, Validator>>;
  returns: Validator;
  auth: Auth;
  handler: Handler;
  refusals?: readonly string[];
  trackedRefusals?: readonly string[];
}>;

export declare function query(spec: Common & Readonly<{
  reads: readonly string[];
  delivery?: 'live' | 'read';
  retainable?: boolean;
  authScopeField?: string;
  membership?: readonly MembershipPredicate[];
}>): unknown;
export declare function mutation(spec: Common & Readonly<{
  reads: readonly string[];
  writes: readonly string[];
  membership?: readonly MembershipPredicate[];
}>): unknown;
export declare function action(spec: Common & Readonly<{
  secrets?: readonly string[];
}>): unknown;
export declare function lowerFamiliarReturns(
  kind: 'query' | 'mutation' | 'action',
  validator: Validator,
): Readonly<Record<string, unknown>>;
