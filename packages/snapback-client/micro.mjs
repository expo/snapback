// The public Micro profile starts at the capability-minimal core. Generated
// entries that select a live operation add the explicit `./micro/live`
// subpath; importing `./micro` can therefore never make live/outbox code
// reachable through a dispatcher barrel.
// @ref LLP 0147#packaging-and-compatibility — additive Micro leaves the
// package root and `./online` unchanged while omitted modules stay absent.

export { createMicroCoreRuntime as createMicroRuntime } from './micro-core.mjs';
export { createMicroCoreRuntime } from './micro-core.mjs';
