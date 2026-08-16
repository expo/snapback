export const SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK =
  '__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__';

// @ref LLP 0262#d2-carriers-per-shipped-topology — native launch custody is
// projected into one non-enumerable, process-local hook before application
// modules evaluate. A fresh native delivery may replace an older JS-runtime
// value; a repeated delivery never installs twice.
export function installSupervisedDevIdentityCheckoutNonce(nonce, {
  globalObject = globalThis,
} = {}) {
  if ((typeof globalObject !== 'object' && typeof globalObject !== 'function')
    || globalObject === null) {
    throw new TypeError('globalObject must be an object');
  }
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return Object.freeze({ installed: false, replaced: false, value: null });
  }

  const prior = Object.getOwnPropertyDescriptor(
    globalObject,
    SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK,
  );
  const priorValue = prior?.value;
  if (priorValue === nonce) {
    return Object.freeze({ installed: false, replaced: false, value: nonce });
  }
  if (prior !== undefined && prior.configurable !== true && priorValue !== nonce) {
    const error = new Error(
      'SNAPBACK_EXPO_NATIVE_CHECKOUT_HOOK_CONFLICT: the process checkout hook is not replaceable',
    );
    error.code = 'SNAPBACK_EXPO_NATIVE_CHECKOUT_HOOK_CONFLICT';
    throw error;
  }

  Object.defineProperty(globalObject, SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: nonce,
  });
  return Object.freeze({
    installed: true,
    replaced: prior !== undefined && priorValue !== nonce,
    value: nonce,
  });
}
