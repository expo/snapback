// @ref LLP 0295#1a-published-package-and-compilerruntime-parity — Metro may evaluate
// the app-client through a framework entrypoint before the client root barrel.
// Initialization-time constants therefore live in a leaf with no barrel edge.
export const DEFAULT_AUTH_STORAGE_PARTITION = 'default';
