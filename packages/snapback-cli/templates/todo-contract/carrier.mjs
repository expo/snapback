import { fileURLToPath } from 'node:url';

import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from '@expo/snapback-cli/carrier-kit';

// @ref LLP 0196#program — the headless kit delegates to the template's
// existing D2 profile rather than introducing another verifier.
const config = defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['npm', 'run', 'prove'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    headless: {},
  },
});

process.exitCode = await runTemplateCarrierCli(config, process.argv.slice(2), {
  root: fileURLToPath(new URL('.', import.meta.url)),
});
