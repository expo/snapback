export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@exact' || specifier.startsWith('@exact/')) {
    throw new Error(`SNAPBACK_NO_EXACT_CORE_IMPORT: core attempted to load ${specifier}`);
  }
  return nextResolve(specifier, context);
}
