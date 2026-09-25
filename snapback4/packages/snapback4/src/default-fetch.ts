// Browsers and native hosts keep their own Fetch implementation.
export const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
