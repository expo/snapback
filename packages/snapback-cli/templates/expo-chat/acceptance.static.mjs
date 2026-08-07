import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifacts = JSON.parse(readFileSync(
  new URL('./snapback/generated/artifacts.json', import.meta.url),
  'utf8',
));
const functions = JSON.parse(readFileSync(
  new URL('./snapback/generated/functions.manifest.json', import.meta.url),
  'utf8',
));
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const chatScreen = readFileSync(new URL('./src/screens/chat-screen.tsx', import.meta.url), 'utf8');
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(
  functions.functions.map((fn) => fn.name).sort(),
  ['conversationDetails', 'messagesForConversation', 'sendMessage', 'sendText', 'users'],
);
assert.deepEqual(
  functions.assetUploadIntents.map((intent) => intent.exportedName),
  ['messageImageUpload'],
);
assert.match(appSource, /SnapbackExpoProvider/);
assert.match(chatScreen, /useSurface\(/);
assert.match(chatScreen, /conversation\.commands\.send\(/);
assert.match(chatScreen, /useSnapbackAssetImage/);
assert.match(chatScreen, /presence\.typing/);
assert(!chatScreen.includes('emitG2') && !chatScreen.includes('emitG3'),
  'starter must not carry fixture proof instrumentation');
assert.match(
  runtimeAcceptance,
  /event\.state === 'generated-and-loaded' && event\.managed === true/,
  'runtime acceptance must wait for the managed CLI load lifecycle, not only the ready file',
);
console.log('expo chat starter static coherence: generated refs, surface client, and command send are coherent');
