import type { Op } from './api.js';
import type { Subscription, SubscriptionDelivery } from './types.js';
export type { StoreSwap } from './store/range-store.js';

export const internalSubscribe: unique symbol = Symbol.for('snapback2.internal.subscribe');
export const internalConsumers: unique symbol = Symbol.for('snapback2.internal.consumers');

/** Raw deliveries for first-party journeys and witnesses only. */
export function subscribe<Args, Result>(client: object, ref: Op<Args, Result>, args: NoInfer<Args>,
  listener: (delivery: SubscriptionDelivery<Result>) => void, options?: { drain?: boolean }): Subscription<SubscriptionDelivery<Result>> {
  return (client as any)[internalSubscribe](ref, args, listener, options);
}
export function sharedConsumers(client: object, ref: object, args: unknown, drain?: boolean): number {
  return (client as any)[internalConsumers](ref, args, drain);
}
