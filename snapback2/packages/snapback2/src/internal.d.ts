export const internalSubscribe: unique symbol;
export const internalConsumers: unique symbol;
/** Raw deliveries for first-party journeys and witnesses only. */
export function subscribe<Args, Result>(client: object,
  ref: { readonly __args?: (args: Args) => void; readonly __result?: Result }, args: NoInfer<Args>,
  listener: (delivery: any) => void, options?: { drain?: boolean }): {
    close(): void;
    until(predicate: (delivery: any) => boolean, timeoutMs?: number): Promise<any>;
  };
export function sharedConsumers(client: object, ref: object, args: unknown, drain?: boolean): number;
