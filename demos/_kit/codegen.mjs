// Compatibility shim (LLP 0032 P1): the codegen product moved to
// packages/snapback-codegen. New code should import the package
// (@snapback/codegen); this re-export keeps existing demo/test imports and the
// documented `node demos/_kit/codegen.mjs <backendDir>` invocation working.

export { generate, crossCheckContractQueryBinding, runCodegenCli } from '../../packages/snapback-codegen/index.mjs';

import { pathToFileURL } from 'node:url';
import { runCodegenCli } from '../../packages/snapback-codegen/index.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runCodegenCli(process.argv);
}
