import {
  defineStarterVerifyProfile,
  defineVerifyConfig,
} from '@expo/snapback-cli/verify';
import { starterVerifyProfileOptions } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';

// @ref LLP 0196#program — the scaffold's one proof command delegates its
// existing live starter acceptance to LLP 0146 D2 and retains that receipt.
export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  context: {
    data: { kind: 'fresh-isolated-sqlite', identity: 'expo-chat-starter-acceptance.v2' },
    authority: {
      kind: 'ordinary-session',
      identity: 'acceptance@expo-chat.test',
      principalClass: 'authenticated',
    },
    seed: { kind: 'authored-seed-bytes', identity: null },
  },
  profiles: [defineStarterVerifyProfile(starterVerifyProfileOptions(acceptance, {
    id: 'expo-chat-live',
    title: 'Expo chat starter live acceptance',
    additionalTestFiles: [
      new URL('./carrier.mjs', import.meta.url),
      new URL(import.meta.resolve('@expo/snapback-cli/carrier-kit')),
    ],
  }))],
});
