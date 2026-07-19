// Compatibility shim: the framework-neutral client is package-owned.
// Demo imports stay stable while external consumers use @snapback/client.
export * from '../../packages/snapback-client/index.mjs';
