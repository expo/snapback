import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
const tsconfig = JSON.parse(readFileSync(new URL('./tsconfig.json', import.meta.url), 'utf8'));
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
// Zero-configuration provider sign-in: declared with no credentials, served in
// development by the supervisor's local broker, and never claiming to be an
// Apple or Google login.
assert.match(schemaSource, /apple:\s*\{\s*kind:\s*'apple',\s*credentials:\s*'auto'\s*\}/);
assert.match(schemaSource, /google:\s*\{\s*kind:\s*'oidc',\s*preset:\s*'google',\s*credentials:\s*'auto'\s*\}/);
assert.match(schemaSource, /externalSessionEntry:\s*true/);
assert.deepEqual(
  descriptor.authBootstrap.providers.map(({ provider, credentials }) => [provider, credentials]),
  [['apple', 'auto'], ['google', 'auto']],
);
assert(descriptor.authBootstrap.entryMechanisms.includes('external-session-explicit-v1'));
assert.match(appSource, /auth\.providerEntry\(/);
assert.match(appSource, /auth\.signIn\(\{ provider \}\)/);
assert.match(appSource, /Continue with Apple/);
assert.match(appSource, /Continue with Google/);
assert.match(appSource, /not an\s*\n?\s*Apple or Google login/u);
for (const dependency of ['expo-web-browser', 'expo-linking']) {
  assert.equal(
    typeof packageManifest.dependencies[dependency],
    'string',
    `${dependency} must ship so the shared development Adapter resolves`,
  );
}
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
assert.deepEqual(
  tsconfig.include,
  ['App.tsx', 'snapback/generated/**/*.d.ts'],
  'typecheck roots must not retain starter screens after App.tsx is replaced',
);
assert.equal(packageManifest.type, 'module');
assert.equal(existsSync(new URL('./babel.config.js', import.meta.url)), false);
const configureBabel = require('./babel.config.cjs');
let babelCacheSetting;
assert.deepEqual(
  configureBabel({ cache(value) { babelCacheSetting = value; } }),
  { presets: ['babel-preset-expo'] },
);
assert.equal(babelCacheSetting, true);
assert.equal(packageManifest.scripts.web, 'expo start --web');
assert.equal(packageManifest.scripts.dev, 'snapback dev snapback --write-env');
assert.equal(packageManifest.scripts['dev:client'], 'expo start');
assert.equal(packageManifest.scripts['dev:supervised'], 'snapback dev snapback --expo --expo-platform web');
assert.equal(packageManifest.scripts['dev:native-refusal'], 'snapback dev snapback --expo --expo-platform ios');
assert.match(packageManifest.scripts.prove, /^snapback verify snapback /);
assert.match(agentInstructions, /only done-oracle/);
assert.equal(packageManifest.scripts['test:live'], undefined);
assert.equal(packageManifest.scripts['carry:headless'], 'node carrier.mjs headless');
assert.equal(packageManifest.scripts['carry:web-browser'], 'node carrier.mjs web-browser');
assert.equal(packageManifest.scripts['carry:native-simulator'], 'node carrier.mjs native-simulator');
assert.match(agentInstructions, /carry:native-simulator/);
assert.match(carrierSource, /bundleId:\s*'host\.exp\.Exponent'/);
assert.match(carrierSource, /driveUrl:\s*'exp:/);
assert.match(carrierSource, /'--expo-platform',\s*'web'/);
assert.match(carrierSource, /kind:\s*'expo-supervisor'/);
assert.match(carrierSource, /I checked the numbers twice/);
assert.match(carrierSource, /live message echo/);
assert.match(carrierSource, /SNAPBACK_APP_BINDING_UNAVAILABLE/);
assert.match(carrierSource, /SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED/);
assert.doesNotMatch(carrierSource, /--client-command|expo start --web --port 5173/);
for (const dependency of ['@expo/metro-runtime', 'react-dom', 'react-native-web']) {
  assert.equal(typeof packageManifest.dependencies[dependency], 'string', `${dependency} must ship in the web-ready template`);
}
assert(!chatScreen.includes('emitG2') && !chatScreen.includes('emitG3'),
  'starter must not carry fixture proof instrumentation');
assert.match(runtimeAcceptance, /from '@expo\/snapback-acceptance'/);
assert.match(runtimeAcceptance, /defineStarterAcceptance/);
assert.match(runtimeAcceptance, /runStarterAcceptanceIfMain/);
assert.doesNotMatch(
  runtimeAcceptance,
  /snapback\.starter-acceptance\.v1|expectedCheckCount|executedCheckCount|projectStarterAcceptanceReceipt|JSON\.stringify\s*\(\s*(?:receipt\b|outcome\b|\{[\s\S]{0,256}?(?:schemaVersion|checks|operations|cleanup|lifecycle)\s*:)/u,
);
assert.match(runtimeAcceptance, /runExpoDev/);
assert.match(runtimeAcceptance, /createSnapbackExpoBoot/);
assert.match(runtimeAcceptance, /createSnapbackAppClient/);
assert.match(runtimeAcceptance, /createSessionClient/);
assert.doesNotMatch(runtimeAcceptance, /offeredCapabilities/u);
assert.doesNotMatch(runtimeAcceptance, /new SnapbackClient|AuthCoordinator|adoptAuthority/u);
for (const operation of [
  'conversations',
  'membershipsForUser',
  'messagesForConversation',
  'sendMessage',
  'sendReply',
  'addReaction',
]) {
  assert.match(runtimeAcceptance, new RegExp(`operation:\\s*api\\.${operation}`));
}
for (const check of [
  'zero-config-supervised-connect',
  'web-anonymous-ready',
  'password-signup-recovery',
  'reload-clears-volatile-principal',
  'authenticated-entry-refusal',
  'sign-out',
  'native-refusal',
  'membership-dm-group-shape',
  'test-persona-membership-switch',
  "id: 'reply'",
  "id: 'reaction'",
]) {
  assert.match(runtimeAcceptance, new RegExp(check));
}
console.log('expo chat starter static coherence: web, inbox, persona, replies, reactions, and proof command are coherent');
