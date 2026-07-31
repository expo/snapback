// Compatibility shim: the framework-neutral client is package-owned.
// Demo imports stay stable while external consumers use @expo/snapback-client.
export * from '../../packages/snapback-client/index.mjs';
