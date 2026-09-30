// Node 24.18's bundled writer can throw setTypeOfService EINVAL outside the
// fetch promise on macOS (undici#5544). Keep the host Fetch API and pass a
// private fixed dispatcher, including through a host's fetch instrumentation.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Import the pinned implementation directly: undici's root import installs a
// process-wide dispatcher as a side effect. SDK requests need no global change.
const Agent: typeof import("undici").Agent = require("undici/lib/dispatcher/agent.js");
const Dispatcher1Wrapper: typeof import("undici").Dispatcher1Wrapper = require("undici/lib/dispatcher/dispatcher1-wrapper.js");
const dispatcher = new Dispatcher1Wrapper(new Agent());
export const defaultFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, dispatcher } as RequestInit);
