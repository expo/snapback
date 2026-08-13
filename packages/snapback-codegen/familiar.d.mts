export {
  allow,
  defineSchema,
  v,
} from './define.js';

export declare function defineTable(
  fields: Parameters<typeof import('./define.js').defineTable>[0],
): ReturnType<typeof import('./define.js').defineTable>;

type Auth = 'public' | 'optional-user' | 'authenticated';
type Validator = Readonly<Record<string, unknown>>;
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
}>): unknown;
export declare function mutation(spec: Common & Readonly<{
  reads: readonly string[];
  writes: readonly string[];
}>): unknown;
export declare function action(spec: Common & Readonly<{
  secrets?: readonly string[];
}>): unknown;
export declare function lowerFamiliarReturns(
  kind: 'query' | 'mutation' | 'action',
  validator: Validator,
): Readonly<Record<string, unknown>>;
