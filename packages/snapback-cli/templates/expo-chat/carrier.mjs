import { fileURLToPath } from 'node:url';

import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from '@expo/snapback-cli/carrier-kit';

// @ref LLP 0196#program — the native carrier makes the headless simulator
// recipe executable while the existing D2 profile remains proof authority.
const config = defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['npm', 'run', 'prove'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    headless: {},
    'web-browser': {
      command: [
        './node_modules/.bin/snapback', 'dev', 'snapback', '--client', '.',
        '--client-command', 'expo start --web --port 5173',
      ],
      origin: 'http://127.0.0.1:5173',
    },
    'native-simulator': {
      command: [
        './node_modules/.bin/snapback', 'dev', 'snapback', '--expo',
        '--expo-platform', 'ios', '--ios-udid', '{udid}',
      ],
      scheme: 'exp',
      bundleId: 'host.exp.Exponent',
      driveUrl: 'exp://127.0.0.1:8081/--/proof/carrier-ready',
      expoGo: true,
    },
  },
});

process.exitCode = await runTemplateCarrierCli(config, process.argv.slice(2), {
  root: fileURLToPath(new URL('.', import.meta.url)),
});
