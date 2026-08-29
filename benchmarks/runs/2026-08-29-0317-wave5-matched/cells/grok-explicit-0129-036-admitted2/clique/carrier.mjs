import { fileURLToPath } from 'node:url';

import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from '@expo/snapback-cli/carrier-kit';

// @ref LLP 0196#program — the browser/native carriers make the supervised
// recipes executable while the existing D2 profile remains proof authority.
// @ref LLP 0181#web-browser — Expo web consumes its supervisor-selected origin
// from structured readiness; the generic client arm cannot publish binding.
const config = defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['npm', 'run', 'prove'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    headless: {},
    'web-browser': {
      command: [
        './node_modules/.bin/snapback', 'dev', 'snapback', '--expo',
        '--expo-platform', 'web',
        '--ready-file', '{supervisorState}/dev.ready.json',
      ],
      structuredReadiness: {
        kind: 'expo-supervisor',
        file: '{supervisorState}/expo-supervisor.json',
      },
      browserJourney: {
        readyExpression: `(() => {
          const text = document.body?.innerText ?? '';
          return text.includes('Messages')
            && text.includes('Engine Room')
            && text.includes('Live sync')
            && !text.includes('SNAPBACK_APP_BINDING_UNAVAILABLE');
        })()`,
        runExpression: `(async () => {
          const marker = globalThis.__snapbackCarrierJourneyId;
          const waitFor = async (probe, label) => {
            const deadline = Date.now() + 40000;
            while (Date.now() < deadline) {
              const value = probe();
              if (value) return value;
              await new Promise((resolveWait) => setTimeout(resolveWait, 100));
            }
            throw new Error('Timed out waiting for ' + label);
          };
          const inboxText = document.body?.innerText ?? '';
          const readObserved = inboxText.includes('Engine Room')
            && inboxText.includes('I checked the numbers twice');
          const conversation = [...document.querySelectorAll('[role="button"]')]
            .find((element) => element.textContent?.includes('Engine Room'));
          if (!conversation) throw new Error('Seeded Engine Room conversation is absent');
          conversation.click();
          const input = await waitFor(
            () => document.querySelector('[aria-label="Message"]'),
            'message composer',
          );
          const valueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            'value',
          )?.set;
          if (!valueSetter) throw new Error('Message composer has no native value setter');
          valueSetter.call(input, marker);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const send = await waitFor(() => {
            const candidate = document.querySelector('[aria-label="Send message"]');
            return candidate?.getAttribute('aria-disabled') === 'true' ? null : candidate;
          }, 'enabled send action');
          send.click();
          await waitFor(
            () => (document.body?.innerText ?? '').includes(marker),
            'live message echo',
          );
          return { marker, readObserved, writeObserved: true };
        })()`,
        requiredDomText: ['Engine Room'],
        forbiddenDomText: [
          'SNAPBACK_APP_BINDING_UNAVAILABLE',
          'SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED',
        ],
      },
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
