const DEV_IDENTITY_CAPABILITY_PATTERN = /sbdev_[A-Za-z0-9._~-]*/u;

export function serializeSecretFreeReceipt(document, {
  secretValues = [],
  label = 'receipt',
} = {}) {
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (DEV_IDENTITY_CAPABILITY_PATTERN.test(serialized)) {
    throw new Error(`${label} attempted to retain a dev-identity capability`);
  }
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret)) {
      throw new Error(`${label} attempted to retain checkout material`);
    }
  }
  return serialized;
}
