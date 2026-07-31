// Regenerates search-contract.generated.mjs from the descriptor pipeline.
//
// @ref LLP 0131#identity-and-hashing — cascade item 2: the client's search
// request pin is a generated artifact emitted from the same descriptor
// pipeline as the manifests (regenerate, never hand-keep). The codegen test
// suite's search-pin conformance test asserts the committed constant equals
// the codegen-computed hash of defineSearchQuery's contract.
//
// Run from the workspace root:
//   node packages/snapback-client/generate-search-contract.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { searchContractPinSource } from './search-contract-pin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, 'search-contract.generated.mjs');
writeFileSync(target, await searchContractPinSource());
console.log(`wrote ${target}`);
