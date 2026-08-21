import {
  defineStarterVerifyProfile,
  defineVerifyConfig,
} from '@expo/snapback-cli/verify';

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
  profiles: [defineStarterVerifyProfile({
    id: 'expo-chat-live',
    title: 'Expo chat starter live acceptance',
    acceptanceFile: new URL('./acceptance.mjs', import.meta.url),
    additionalTestFiles: [
      new URL('./carrier.mjs', import.meta.url),
      new URL(import.meta.resolve('@expo/snapback-cli/carrier-kit')),
    ],
    paths: [
      { id: 'zero-config-supervised-connect', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'membership-dm-group-shape', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'test-persona-membership-switch', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'conversation-surface-read', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'expo-chat:messagesForConversation' },
      { id: 'send-message', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'expo-chat:sendMessage' },
      { id: 'reply', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'reaction', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
    ],
  })],
});
