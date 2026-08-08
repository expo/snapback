import { fileURLToPath } from 'node:url';

import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from '@expo/snapback-cli/carrier-kit';

// @ref LLP 0196#program — the scaffold registers its executable environments
// with the shared carrier director and its existing D2 proof profile.
const config = defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['npm', 'run', 'prove'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    headless: {},
    'web-browser': {
      command: [
        './node_modules/.bin/snapback', 'dev', 'snapback', '--client', '.',
        '--client-command', 'vite --host 127.0.0.1 --port 5173 --strictPort',
      ],
      origin: 'http://127.0.0.1:5173',
    },
  },
});

process.exitCode = await runTemplateCarrierCli(config, process.argv.slice(2), {
  root: fileURLToPath(new URL('.', import.meta.url)),
});
