import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  importGeneratedModule,
  readGeneratedJson,
} from '../../_kit/generated-artifacts.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const generatedRoot = join(backendDir, 'generated');
const codegenCommand = 'node packages/snapback-codegen/index.mjs demos/coterie/snapback';

function codegenRequired(cause) {
  return new Error(
    `Coterie Snapback generated artifacts are unavailable; run ${codegenCommand}`,
    { cause },
  );
}

export function loadGeneratedJson(artifactPath) {
  try {
    return readGeneratedJson(generatedRoot, artifactPath);
  } catch (error) {
    throw codegenRequired(error);
  }
}

export async function loadGeneratedApi() {
  try {
    return (await importGeneratedModule(generatedRoot, 'api.mjs')).default;
  } catch (error) {
    throw codegenRequired(error);
  }
}
