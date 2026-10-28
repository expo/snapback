/** Await every test and cleanup inside this finite suite. Exits with its status
 * after draining output, naming any lingering resource types without contents.
 * Do not use for service entry points or unawaited background tests. */
export declare function runProofSuite(suite: () => void | Promise<void>): Promise<never>;
