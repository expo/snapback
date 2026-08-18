export default async function dynamicAuthorityProbe() {
  const loaded = require('@vendor/sdk');
  return WebAssembly ? loaded : null;
}

