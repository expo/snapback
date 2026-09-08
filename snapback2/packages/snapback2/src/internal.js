// First-party journeys and witnesses inspect transport deliveries and shared readers.
// Symbols keep those diagnostics off the application client's named surface.
export const internalSubscribe = Symbol.for('snapback2.internal.subscribe');
export const internalConsumers = Symbol.for('snapback2.internal.consumers');
export function subscribe(client, ref, args, listener, options) {
  return client[internalSubscribe](ref, args, listener, options);
}
export function sharedConsumers(client, ref, args, drain) {
  return client[internalConsumers](ref, args, drain);
}
