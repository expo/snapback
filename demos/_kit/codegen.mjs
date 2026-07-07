// Compatibility shim (LLP 0032 P1): the codegen product moved to
// packages/snapback-codegen. New code should import the package
// (@snapback/codegen); this re-export keeps existing demo/test imports and the
// documented `node demos/_kit/codegen.mjs <backendDir>` invocation working.

export { generate, crossCheckContractQueryBinding, runCodegenCli } from '../../packages/snapback-codegen/index.mjs';

import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { runCodegenCli } from '../../packages/snapback-codegen/index.mjs';

function isDirectCliInvocation(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return metaUrl === pathToFileURL(argv1).href;
  }
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  await runCodegenCli(process.argv);
}
