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
const schemaSource = readFileSync(new URL('./snapback/schema.mjs', import.meta.url), 'utf8');
const descriptor = JSON.parse(readFileSync(
  new URL('./snapback/generated/app.descriptor.json', import.meta.url),
  'utf8',
));
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const chatScreen = readFileSync(new URL('./src/screens/chat-screen.tsx', import.meta.url), 'utf8');
const inboxScreen = readFileSync(new URL('./src/screens/inbox-screen.tsx', import.meta.url), 'utf8');
const personaContext = readFileSync(new URL('./src/test-persona-context.tsx', import.meta.url), 'utf8');
const runtimeAcceptance = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const expoManifest = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8'));
const agentInstructions = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
const carrierSource = readFileSync(new URL('./carrier.mjs', import.meta.url), 'utf8');
assert.equal(artifacts.artifactKind, 'artifactIndex');
assert.deepEqual(
  functions.functions.map((fn) => fn.name).sort(),
  [
    'addReaction',
    'conversationDetails',
    'conversations',
    'membershipsForConversation',
    'membershipsForUser',
    'messagesForConversation',
    'reactionsForConversation',
    'removeReaction',
    'sendMessage',
    'sendReply',
    'sendText',
    'users',
  ],
);
assert.deepEqual(
  functions.assetUploadIntents.map((intent) => intent.exportedName),
  ['messageImageUpload'],
);
assert.match(schemaSource, /auth:\s*\{\s*mode:\s*'sessions'\s*\}/);
assert.match(schemaSource, /custody:\s*'volatile-explicit'/);
assert.match(schemaSource, /20260815-llp-0258-phase-2-native-custody-evidence\.md/);
assert.match(schemaSource, /kind:\s*'password'/);
assert.equal(descriptor.authBootstrap.format, 'snapback.application-auth-bootstrap.v1');
assert.equal(descriptor.authBootstrap.custody, 'volatile-explicit');
assert(descriptor.capabilities.required.includes('auth.application-bootstrap.v1'));
assert.match(schemaSource, /memberships:\s*defineTable/);
assert.match(schemaSource, /replyToId:\s*v\.optional\(v\.id\('messages'\)\)/);
assert.match(schemaSource, /reactions:\s*defineTable/);
assert.match(appSource, /registerExpoFileSystemRqsFiles\(/);
assert.match(appSource, /SnapbackExpoProvider/);
assert.match(appSource, /useSnapbackAuth/);
assert.match(appSource, /useSnapbackCurrentPrincipal/);
assert.match(appSource, /signUpWithPassword/);
assert.match(appSource, /signInWithPassword/);
assert.match(appSource, /auth\.signOut/);
assert.doesNotMatch(appSource, /new SnapbackClient|AuthCoordinator|bearer|adoptAuthority/u);
assert.match(appSource, /TestPersonaProvider/);
assert.match(appSource, /InboxScreen/);
assert.match(chatScreen, /useSurface\(/);
assert.match(chatScreen, /conversation\.commands\.send\(/);
assert.match(chatScreen, /conversation\.mutations\.sendReply\(/);
assert.match(chatScreen, /conversation\.mutations\.react\(/);
assert.match(chatScreen, /replyToId/);
assert.match(chatScreen, /useSnapbackAssetImage/);
assert.match(chatScreen, /presence\.typing/);
assert.match(inboxScreen, /TEST PERSONA/);
assert.match(inboxScreen, /membershipsForUser/);
assert.match(inboxScreen, /item\.kind === 'group'/);
assert.match(personaContext, /production identity must come from adopted authority/);
assert.deepEqual(expoManifest.expo.platforms, ['ios', 'android', 'web']);
assert.equal(packageManifest.scripts.web, 'expo start --web');
assert.equal(packageManifest.scripts.dev, 'snapback dev snapback --expo --expo-platform web');
assert.equal(packageManifest.scripts['dev:native-refusal'], 'snapback dev snapback --expo --expo-platform ios');
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.equal(packageManifest.scripts['carry:native-simulator'], 'node carrier.mjs native-simulator');
assert.match(agentInstructions, /carry:native-simulator/);
assert.match(carrierSource, /bundleId:\s*'host\.exp\.Exponent'/);
assert.match(carrierSource, /driveUrl:\s*'exp:/);
for (const dependency of ['@expo/metro-runtime', 'react-dom', 'react-native-web']) {
  assert.equal(typeof packageManifest.dependencies[dependency], 'string', `${dependency} must ship in the web-ready template`);
}
assert(!chatScreen.includes('emitG2') && !chatScreen.includes('emitG3'),
  'starter must not carry fixture proof instrumentation');
assert.match(
  runtimeAcceptance,
  /'wait', '--ready-file', readyFile/,
  'runtime acceptance must wait through the package CLI on the application-readiness receipt',
);
assert.match(runtimeAcceptance, /runExpoDev/);
assert.match(runtimeAcceptance, /createSnapbackExpoBoot/);
assert.match(runtimeAcceptance, /createSnapbackAppClient/);
assert.match(runtimeAcceptance, /createExternalSessionClient/);
assert.match(runtimeAcceptance, /authInvalidationProtocol:\s*1/u);
assert.doesNotMatch(runtimeAcceptance, /new SnapbackClient|AuthCoordinator|adoptAuthority/u);
assert.match(runtimeAcceptance, /'--level', 'application', '--timeout-ms', '60000'/);
assert.match(runtimeAcceptance, /applicationReadyObserved: true/);
assert.match(runtimeAcceptance, /firstQueryRetries: 0/);
assert.doesNotMatch(runtimeAcceptance, /generated-and-loaded/);
for (const check of [
  'zero-config-supervised-connect',
  'web-anonymous-ready',
  'password-signup-recovery',
  'reload-restores-principal',
  'authenticated-entry-refusal',
  'sign-out',
  'native-refusal',
  'membership-and-conversation-shape',
  'test-persona-membership-switch',
  'reply-and-observation',
  'reaction-and-observation',
]) {
  assert.match(runtimeAcceptance, new RegExp(check));
}
console.log('expo chat starter static coherence: web, inbox, persona, replies, reactions, and proof command are coherent');
