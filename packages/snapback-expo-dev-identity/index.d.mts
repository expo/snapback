export declare const SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK:
  '__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__';

export declare function installSupervisedDevIdentityCheckoutNonce(
  nonce: unknown,
  options?: Readonly<{ globalObject?: typeof globalThis }>,
): Readonly<{
  installed: boolean;
  replaced: boolean;
  value: string | null;
}>;
