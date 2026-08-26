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
          return text.includes('Shared journal')
            && text.includes('Notes from the paper model.')
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
          const initialText = document.body?.innerText ?? '';
          const readObserved = initialText.includes('Notes from the paper model.');
          const actionForText = (text) => {
            const label = [...document.querySelectorAll('body *')]
              .find((element) => element.children.length === 0
                && element.textContent?.trim() === text);
            return label?.closest('button,[role="button"],[tabindex]:not([tabindex="-1"])') ?? null;
          };
          const setValue = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(input),
              'value',
            )?.set;
            if (!setter) throw new Error('Composer input has no native value setter');
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const caption = document.querySelector('[aria-label="Caption"]');
          if (!caption) throw new Error('Caption composer is absent');
          setValue(caption, marker);

          let pickerInput = null;
          const originalInputDispatch = HTMLInputElement.prototype.dispatchEvent;
          HTMLInputElement.prototype.dispatchEvent = function carrierFileChoice(event) {
            if (this.type === 'file' && event.type === 'click') {
              pickerInput = this;
              return true;
            }
            return originalInputDispatch.call(this, event);
          };
          try {
            const choosePhoto = actionForText('Choose photo');
            if (!choosePhoto) throw new Error('Choose photo action is absent');
            choosePhoto.click();
            const selectedInput = await waitFor(() => pickerInput, 'web image picker');
            const png = Uint8Array.from(
              atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
              (character) => character.charCodeAt(0),
            );
            const file = new File([png], marker + '.png', { type: 'image/png' });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            Object.defineProperty(selectedInput, 'files', {
              configurable: true,
              value: transfer.files,
            });
            selectedInput.dispatchEvent(new Event('change', { bubbles: true }));
          } finally {
            HTMLInputElement.prototype.dispatchEvent = originalInputDispatch;
          }
          const publish = await waitFor(() => {
            const candidate = actionForText('Publish');
            return candidate?.getAttribute('aria-disabled') === 'true' ? null : candidate;
          }, 'enabled publish action');
          publish.click();
          await waitFor(
            () => (document.body?.innerText ?? '').includes(marker),
            'live published field note',
          );
          return { marker, readObserved, writeObserved: true };
        })()`,
        requiredDomText: ['Shared journal'],
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
