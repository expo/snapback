// Browsers and native hosts run socket pools outside the application's JS
// loop. Fetch exposes neither reuse nor pre-response byte counts, so an opaque
// rejection cannot safely qualify for Node's narrowly bounded socket retry.
// @ref LLP 3000#http-overload-diagnostics — native/browser pooling and recovery remain the host's; do not replay ambiguous fetch failures here.
export const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
