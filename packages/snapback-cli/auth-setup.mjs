// `snapback auth enable | configure | status` — the provider setup group.
//
// The division of labour, and why it is drawn here:
//
// - **enable** edits the app's own auth declaration, because the declaration is
//   the source of provider policy. Nothing else may decide which providers an
//   app has. The edit is stale-safe: it reads the file, computes its digest,
//   and refuses to write if the bytes moved underneath it.
// - **configure** records *public* identifiers and *references* to secrets. It
//   never accepts or writes a secret value, and it never claims readiness from
//   an environment flag. The parts a provider console must do by hand come back
//   as a deterministic walkthrough with the app's own exact values filled in.
// - **status** resolves each declared provider with the same first-party
//   resolver the client uses, and names one next action.
//
// @ref LLP 0151#setup-and-status — one replacement task per provider; secret
// values never enter source, generated artifacts, client bundles, logs, status
// output, or receipts.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

import { resolveProviderEntry } from '@expo/snapback-client/provider-entry';

import { maskInitSourceCommentsAndStrings } from './source-mask.mjs';

export const AUTH_SETUP_PROVIDERS = Object.freeze(['apple', 'google']);
export const AUTH_PROVIDER_CONFIG_FILE = 'auth-providers.json';
export const AUTH_PROVIDER_CONFIG_FORMAT = 'snapback.app-owned-auth-providers.v1';

const PROVIDER_DECLARATIONS = Object.freeze({
  apple: "apple: { kind: 'apple', credentials: 'auto' },",
  google: "google: { kind: 'oidc', preset: 'google', credentials: 'auto' },",
});

// The native integration each app-owned provider needs in its own build. These
// are installed only when app-owned configuration exists; the shared
// development profile is a browser flow and needs none of them.
export const AUTH_PROVIDER_NATIVE_INTEGRATIONS = Object.freeze({
  apple: Object.freeze({
    dependency: 'expo-apple-authentication',
    plugin: 'expo-apple-authentication',
  }),
  google: Object.freeze({
    dependency: '@react-native-google-signin/google-signin',
    plugin: '@react-native-google-signin/google-signin',
  }),
});

// Public identifiers only. Every secret is a *reference* to an LLP 0036 config
// entry, written with `snapback config set --entry <name> --value-stdin`.
const PROVIDER_CONFIG_FIELDS = Object.freeze({
  apple: Object.freeze({
    public: Object.freeze(['servicesId', 'teamId', 'keyId', 'bundleIdentifier']),
    secretReferences: Object.freeze(['auth.apple.privateKey']),
  }),
  google: Object.freeze({
    public: Object.freeze(['iosClientId', 'androidClientId', 'webClientId']),
    secretReferences: Object.freeze(['auth.google.clientSecret']),
  }),
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function refuse(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = Object.freeze({
    code,
    severity: 'error',
    subsystem: 'cli',
    message,
    details: Object.freeze({ ...details }),
  });
  return error;
}

function digestOf(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

/// Find the `defineAuth({ ... })` call and return its interior span. Comments
/// and strings are masked first, so a `defineAuth(` inside either is not a
/// candidate and a `}` inside either does not close the object.
function locateAuthDeclaration(source) {
  const masked = maskInitSourceCommentsAndStrings(source);
  const calls = [...masked.matchAll(/\bdefineAuth\s*\(\s*\{/gu)];
  if (calls.length !== 1) {
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED',
      calls.length === 0
        ? 'no defineAuth({ ... }) call was found in this app\'s authored declaration'
        : `${calls.length} defineAuth({ ... }) calls were found; snapback auth edits exactly one`,
      { calls: calls.length },
    );
  }
  const open = calls[0].index + calls[0][0].length - 1;
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')') {
      depth -= 1;
      if (depth === 0) return { open, close: index, masked };
    }
  }
  throw refuse(
    'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED',
    'the defineAuth({ ... }) call in this app\'s authored declaration is unbalanced',
    {},
  );
}

/// Top-level property keys of the declaration object, with their offsets.
function declarationProperties(source) {
  const { open, close, masked } = locateAuthDeclaration(source);
  const properties = new Map();
  let depth = 0;
  for (let index = open; index < close; index += 1) {
    const character = masked[index];
    if (character === '{' || character === '[' || character === '(') {
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']' || character === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 1) continue;
    const match = /^([A-Za-z_$][\w$]*)\s*:/u.exec(masked.slice(index, index + 64));
    if (match === null) continue;
    const before = masked[index - 1];
    if (before !== undefined && !/[\s{,]/u.test(before)) continue;
    properties.set(match[1], index);
    index += match[0].length - 1;
  }
  return { open, close, properties };
}

function lineIndentAt(source, offset) {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[\t ]*/u.exec(source.slice(lineStart, offset))[0];
}

/**
 * Add provider declarations and the external-session seam their completion path
 * uses, returning the next source text.
 *
 * @ref LLP 0151#default-development-provider-profiles — the declaration is the
 * one place provider policy lives, so this is a source edit rather than a
 * side-channel file the declaration would not agree with.
 */
export function enableProvidersInDeclaration(source, providers) {
  for (const provider of providers) {
    if (!AUTH_SETUP_PROVIDERS.includes(provider)) {
      throw refuse(
        'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
        `snapback auth does not support the provider ${JSON.stringify(provider)}`,
        { provider, supported: AUTH_SETUP_PROVIDERS },
      );
    }
  }
  const { properties } = declarationProperties(source);
  if (properties.has('providers')) {
    // A hand-written providers block is the author's; naming the exact edit is
    // more useful than reserializing a declaration we did not write.
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_PROVIDERS_PRESENT',
      'this declaration already carries a providers block; add the missing provider entries by hand',
      {
        providers,
        manualSeam: providers.map((provider) => PROVIDER_DECLARATIONS[provider]),
      },
    );
  }
  const anchorName = ['assuranceRequirements', 'recoveryPolicy', 'guestPolicy', 'secretReferences']
    .find((name) => properties.has(name));
  if (anchorName === undefined) {
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED',
      'this declaration has none of assuranceRequirements, recoveryPolicy, guestPolicy, or secretReferences to anchor the providers block',
      { observed: [...properties.keys()] },
    );
  }
  const anchor = properties.get(anchorName);
  const indent = lineIndentAt(source, anchor);
  const nested = `${indent}${indent.includes('\t') ? '\t' : '  '}`;
  const block = [
    `${indent}providers: {`,
    ...providers.map((provider) => `${nested}${PROVIDER_DECLARATIONS[provider]}`),
    `${indent}},`,
    '',
  ].join('\n');
  let next = `${source.slice(0, anchor - indent.length)}${block}${indent}${source.slice(anchor)}`;

  // @ref LLP 0151#shared-development-browser-adapter — redemption issues the
  // ordinary Snapback session through the common completion path, which is the
  // explicit external-session seam. Enabling a provider without it would
  // declare a provider the client could never complete.
  if (!properties.has('externalSessionEntry')) {
    const reanchored = declarationProperties(next).properties.get(anchorName);
    const reindent = lineIndentAt(next, reanchored);
    next = `${next.slice(0, reanchored - reindent.length)}${reindent}externalSessionEntry: true,\n${reindent}${next.slice(reanchored)}`;
  } else if (!/externalSessionEntry\s*:\s*true/u.test(source)) {
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_EXTERNAL_SESSION_CONFLICT',
      'provider entry redeems one short-lived external completion, so externalSessionEntry must be the literal true',
      {},
    );
  }
  return next;
}

function writeAtomically(path, contents) {
  const temporary = `${path}.snapback-auth-setup.tmp`;
  writeFileSync(temporary, contents, { mode: 0o644 });
  try {
    renameSync(temporary, path);
  } catch (cause) {
    try { unlinkSync(temporary); } catch { /* the rename failure is the outcome */ }
    throw cause;
  }
}

function declarationFileFor(backendDirectory) {
  const candidates = ['schema.mjs', 'schema.ts', 'schema.js', 'auth.mjs', 'auth.ts'];
  const found = candidates
    .map((name) => join(backendDirectory, name))
    .filter((path) => existsSync(path) && /\bdefineAuth\s*\(/u.test(readFileSync(path, 'utf8')));
  if (found.length !== 1) {
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_UNRECOGNIZED',
      found.length === 0
        ? `no authored declaration under ${backendDirectory} calls defineAuth`
        : `${found.length} authored files under ${backendDirectory} call defineAuth; snapback auth edits exactly one`,
      { backendDirectory, candidates, found: found.map((path) => relative(backendDirectory, path)) },
    );
  }
  return found[0];
}

/**
 * Enable one or more providers in the app's declaration.
 *
 * Stale-safe: the digest read before the edit is re-read and compared before the
 * write, so a concurrent edit refuses instead of being overwritten.
 */
export function runAuthEnable({ backendDirectory = 'snapback', providers, cwd = process.cwd() }) {
  const root = resolve(cwd);
  const backend = resolve(root, backendDirectory);
  if (!Array.isArray(providers) || providers.length === 0) {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
      `snapback auth enable requires at least one provider (${AUTH_SETUP_PROVIDERS.join(', ')})`,
      { supported: AUTH_SETUP_PROVIDERS },
    );
  }
  const requested = [...new Set(providers)].sort();
  const path = declarationFileFor(backend);
  const before = readFileSync(path, 'utf8');
  const beforeDigest = digestOf(before);
  const after = enableProvidersInDeclaration(before, requested);
  const observed = digestOf(readFileSync(path, 'utf8'));
  if (observed !== beforeDigest) {
    throw refuse(
      'SNAPBACK_AUTH_DECLARATION_STALE',
      `${relative(root, path)} changed while snapback auth enable was preparing its edit; nothing was written`,
      { path: relative(root, path), expected: beforeDigest, observed },
    );
  }
  writeAtomically(path, after);
  return Object.freeze({
    schemaVersion: 'snapback.auth-enable.v1',
    ok: true,
    root,
    declaration: relative(root, path),
    providers: Object.freeze([...requested]),
    beforeDigest,
    afterDigest: digestOf(after),
    // Everything the declaration change does not by itself accomplish.
    next: Object.freeze([
      `${backendDirectory === 'snapback' ? 'snapback generate' : `snapback generate ${backendDirectory}`}`,
      'snapback auth status',
    ]),
    nonclaims: Object.freeze([
      'The shared development profile uses hermetic rehearsal identities. It is not an Apple or Google login.',
      'Rehearsal identities cannot enter a staging or production deployment.',
    ]),
  });
}

export function authProviderConfigPath(backendDirectory) {
  return join(backendDirectory, AUTH_PROVIDER_CONFIG_FILE);
}

export function readAuthProviderConfig(backendDirectory) {
  const path = authProviderConfigPath(backendDirectory);
  if (!existsSync(path)) return { path, config: null };
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_CONFIG_INVALID',
      `${path} is not valid JSON`,
      { path, reason: cause?.message ?? null },
    );
  }
  if (config?.format !== AUTH_PROVIDER_CONFIG_FORMAT || typeof config.providers !== 'object') {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_CONFIG_INVALID',
      `${path} must be a ${AUTH_PROVIDER_CONFIG_FORMAT} record with a providers object`,
      { path },
    );
  }
  // A secret value in this file is a mistake worth refusing loudly: the file is
  // tracked, and its whole contract is that it holds none.
  const leaked = JSON.stringify(config).match(/"[^"]*(?:secret|privateKey|clientSecret)[^"]*"\s*:\s*"[^"]+"/giu);
  if (leaked !== null) {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_CONFIG_SECRET_PRESENT',
      `${path} carries what looks like a literal secret; it must hold only public identifiers and secret references`,
      { path },
    );
  }
  return { path, config };
}

/**
 * The provider-console work that cannot be automated, with this app's own
 * values already filled in.
 *
 * @ref LLP 0151#credential-ownership — Apple and Google expose no
 * client-registration API, so this is a deterministic walkthrough rather than a
 * pretend automation.
 */
export function providerConsoleWalkthrough(provider, { appScheme, bundleIdentifier, returnUrl }) {
  if (provider === 'apple') {
    return Object.freeze({
      provider: 'apple',
      console: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
      automatable: Object.freeze([]),
      steps: Object.freeze([
        'Open Certificates, Identifiers & Profiles → Identifiers.',
        `Enable the Sign in with Apple capability on the App ID ${bundleIdentifier ?? '<your bundle identifier>'}.`,
        'Create a Services ID for the web/return half and note its identifier.',
        `Register the exact return URL ${returnUrl} on that Services ID. Apple does not accept wildcards.`,
        'Create a Sign in with Apple key, download the .p8 once, and note its Key ID and your Team ID.',
        'Configure the production revocation endpoint for the Services ID.',
      ]),
      record: PROVIDER_CONFIG_FIELDS.apple.public,
      secretReferences: PROVIDER_CONFIG_FIELDS.apple.secretReferences,
    });
  }
  return Object.freeze({
    provider: 'google',
    console: 'https://console.cloud.google.com/apis/credentials',
    automatable: Object.freeze([]),
    steps: Object.freeze([
      'Open APIs & Services → Credentials and configure the OAuth consent screen.',
      'Create an iOS OAuth client. Its bundle identifier must be '
        + `${bundleIdentifier ?? '<your bundle identifier>'}, and its reversed client id becomes the iOS return scheme.`,
      'Create an Android OAuth client bound to your release signing-certificate SHA-1 fingerprint.',
      'Create a Web OAuth client; its client id is the server audience the native SDKs verify against.',
      `Register the exact redirect URI ${returnUrl}. Google is exact-match with no wildcards.`,
      `Set the app scheme ${appScheme ?? '<your app scheme>'} on the iOS client so the native return resolves.`,
    ]),
    record: PROVIDER_CONFIG_FIELDS.google.public,
    secretReferences: PROVIDER_CONFIG_FIELDS.google.secretReferences,
  });
}

/**
 * Record public identifiers and secret references for one app-owned provider.
 *
 * Passing no identifiers is the ordinary first call: it prints the walkthrough
 * and writes nothing. A secret *value* is never a valid input here.
 */
export function runAuthConfigure({
  backendDirectory = 'snapback',
  provider,
  identifiers = {},
  cwd = process.cwd(),
  appScheme = null,
  bundleIdentifier = null,
  returnUrl = null,
}) {
  const root = resolve(cwd);
  const backend = resolve(root, backendDirectory);
  if (!AUTH_SETUP_PROVIDERS.includes(provider)) {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_UNSUPPORTED',
      `snapback auth configure supports ${AUTH_SETUP_PROVIDERS.join(' and ')}`,
      { provider, supported: AUTH_SETUP_PROVIDERS },
    );
  }
  const fields = PROVIDER_CONFIG_FIELDS[provider];
  for (const name of Object.keys(identifiers)) {
    if (!fields.public.includes(name)) {
      throw refuse(
        'SNAPBACK_AUTH_PROVIDER_IDENTIFIER_UNKNOWN',
        `${provider} configuration accepts only ${fields.public.join(', ')}`,
        { provider, name, accepted: fields.public },
      );
    }
    if (/secret|privatekey|password/iu.test(name)) {
      throw refuse(
        'SNAPBACK_AUTH_PROVIDER_SECRET_REFUSED',
        'snapback auth configure never accepts a secret value; set it with snapback config set --value-stdin',
        { provider, name },
      );
    }
  }
  const walkthrough = providerConsoleWalkthrough(provider, {
    appScheme,
    bundleIdentifier,
    returnUrl: returnUrl ?? `${appScheme ?? '<your app scheme>'}://auth/provider`,
  });
  const secretCommands = fields.secretReferences.map((entry) => (
    `snapback config set --entry ${entry} --value-stdin`
  ));
  if (Object.keys(identifiers).length === 0) {
    return Object.freeze({
      schemaVersion: 'snapback.auth-configure.v1',
      ok: true,
      operation: 'walkthrough',
      provider,
      root,
      walkthrough,
      secretCommands: Object.freeze(secretCommands),
      next: Object.freeze([
        `snapback auth configure ${provider} ${fields.public.map((name) => `--${name} <value>`).join(' ')}`,
      ]),
    });
  }
  const { path, config } = readAuthProviderConfig(backend);
  const current = config ?? { format: AUTH_PROVIDER_CONFIG_FORMAT, providers: {} };
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const merged = {
    ...current,
    providers: {
      ...current.providers,
      [provider]: {
        ...(current.providers[provider] ?? {}),
        ...identifiers,
        secretReferences: fields.secretReferences,
      },
    },
  };
  // A configuration generation makes the auth-profile generation move when
  // identifiers change, so custody bound to the previous configuration is not
  // reinterpreted as belonging to the new one.
  merged.providers[provider].configGeneration = digestOf(
    JSON.stringify([provider, merged.providers[provider]]),
  ).slice(0, 23);
  const contents = `${JSON.stringify(merged, null, 2)}\n`;
  const observed = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (observed !== before) {
    throw refuse(
      'SNAPBACK_AUTH_PROVIDER_CONFIG_STALE',
      `${relative(root, path)} changed while snapback auth configure was preparing its write; nothing was written`,
      { path: relative(root, path) },
    );
  }
  writeAtomically(path, contents);
  const missing = fields.public.filter((name) => (
    typeof merged.providers[provider][name] !== 'string'
      || merged.providers[provider][name].length === 0
  ));
  const nativeIntegration = missing.length === 0
    ? installNativeConfigPlugin(root, provider)
    : Object.freeze({
        ...AUTH_PROVIDER_NATIVE_INTEGRATIONS[provider],
        pluginConfigured: false,
        reason: 'configuration-incomplete',
      });
  return Object.freeze({
    schemaVersion: 'snapback.auth-configure.v1',
    ok: true,
    operation: 'record',
    provider,
    root,
    configFile: relative(root, path),
    recorded: Object.freeze(Object.keys(identifiers).sort()),
    missing: Object.freeze(missing),
    configGeneration: merged.providers[provider].configGeneration,
    secretCommands: Object.freeze(secretCommands),
    nativeIntegration,
    walkthrough,
    next: Object.freeze([
      ...(missing.length === 0 ? [] : [`snapback auth configure ${provider} ${missing.map((name) => `--${name} <value>`).join(' ')}`]),
      ...secretCommands,
      ...(nativeIntegration.pluginConfigured
        ? [`npx expo install ${nativeIntegration.dependency}`, 'Rebuild the client so it carries the native integration.']
        : []),
      'snapback auth status',
    ]),
    nonclaims: Object.freeze([
      'Recorded configuration is not provider readiness. The installed client must also carry the matching native integration.',
      'This command wrote no secret value. Secrets live only in LLP 0036 deployment state.',
    ]),
  });
}

/**
 * Add the provider's Expo config plugin, once its app-owned configuration is
 * complete.
 *
 * @ref LLP 0151#native-readiness-requires-both-halves — the native integration
 * is installed only when app-owned configuration exists. An app on the shared
 * development profile is a browser flow and needs none of it, so nothing is
 * added until `configure` has recorded a complete provider.
 */
function installNativeConfigPlugin(root, provider) {
  const integration = AUTH_PROVIDER_NATIVE_INTEGRATIONS[provider];
  const path = join(root, 'app.json');
  if (!existsSync(path)) {
    return Object.freeze({ ...integration, pluginConfigured: false, reason: 'no-app-json' });
  }
  const source = readFileSync(path, 'utf8');
  let appConfig;
  try {
    appConfig = JSON.parse(source);
  } catch {
    throw refuse(
      'SNAPBACK_AUTH_APP_CONFIG_INVALID',
      `${path} is not valid JSON, so the ${provider} config plugin was not added`,
      { path, provider },
    );
  }
  if (!isRecord(appConfig?.expo)) {
    throw refuse(
      'SNAPBACK_AUTH_APP_CONFIG_INVALID',
      `${path} has no expo object, so the ${provider} config plugin was not added`,
      { path, provider },
    );
  }
  const plugins = appConfig.expo.plugins;
  if (plugins !== undefined && (!Array.isArray(plugins) || plugins.some((entry) => (
    typeof entry !== 'string' && !(Array.isArray(entry) && typeof entry[0] === 'string')
  )))) {
    throw refuse(
      'SNAPBACK_AUTH_APP_CONFIG_INVALID',
      `${path} expo.plugins must be plugin-name strings or [name, options] tuples; add ${integration.plugin} by hand`,
      { path, provider, plugin: integration.plugin },
    );
  }
  const present = (plugins ?? []).some((entry) => (
    (Array.isArray(entry) ? entry[0] : entry) === integration.plugin
  ));
  if (present) return Object.freeze({ ...integration, pluginConfigured: true, reason: 'already-present' });
  const next = {
    ...appConfig,
    expo: { ...appConfig.expo, plugins: [...(plugins ?? []), integration.plugin] },
  };
  const observed = readFileSync(path, 'utf8');
  if (observed !== source) {
    throw refuse(
      'SNAPBACK_AUTH_APP_CONFIG_STALE',
      `${path} changed while snapback auth configure was preparing its edit; nothing was written`,
      { path, provider },
    );
  }
  writeAtomically(path, `${JSON.stringify(next, null, 2)}\n`);
  return Object.freeze({ ...integration, pluginConfigured: true, reason: 'added' });
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function appManifestNativeIntegration(root, provider) {
  const integration = AUTH_PROVIDER_NATIVE_INTEGRATIONS[provider];
  const manifest = readJsonIfPresent(join(root, 'package.json'));
  const appConfig = readJsonIfPresent(join(root, 'app.json'));
  const dependencies = {
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  };
  const plugins = Array.isArray(appConfig?.expo?.plugins) ? appConfig.expo.plugins : [];
  return Object.freeze({
    dependency: integration.dependency,
    dependencyInstalled: typeof dependencies[integration.dependency] === 'string',
    plugin: integration.plugin,
    pluginConfigured: plugins.some((entry) => (
      (Array.isArray(entry) ? entry[0] : entry) === integration.plugin
    )),
  });
}

/**
 * Report the resolved Adapter, readiness, and one next action per provider.
 *
 * The CLI cannot observe an *installed* build, so it never claims native
 * readiness. It reports what it can verify — the declaration, recorded
 * configuration, and whether this project is configured to produce a build that
 * carries the integration — and says plainly that the installed client reports
 * its own build receipt.
 *
 * @ref LLP 0151#native-readiness-requires-both-halves — configuration readiness
 * alone never selects native auth, so a status that inferred it from
 * configuration would be lying.
 */
export function runAuthStatus({
  backendDirectory = 'snapback',
  cwd = process.cwd(),
  deployment = 'development',
  platform = 'ios',
  sharedAvailable = false,
  nowMs = Date.now(),
}) {
  const root = resolve(cwd);
  const backend = resolve(root, backendDirectory);
  const descriptorPath = join(backend, 'generated', 'app.descriptor.json');
  const descriptor = readJsonIfPresent(descriptorPath);
  if (descriptor === null) {
    throw refuse(
      'SNAPBACK_AUTH_STATUS_UNGENERATED',
      `no generated application descriptor at ${relative(root, descriptorPath)}; run snapback generate first`,
      { path: relative(root, descriptorPath) },
    );
  }
  const bootstrap = descriptor.authBootstrap ?? null;
  const declared = bootstrap?.providers ?? [];
  const { config } = readAuthProviderConfig(backend);
  const providers = declared.map((declaration) => {
    const recorded = config?.providers?.[declaration.provider] ?? null;
    const fields = PROVIDER_CONFIG_FIELDS[declaration.provider];
    const missing = fields.public.filter((name) => typeof recorded?.[name] !== 'string');
    const configReady = recorded !== null && missing.length === 0;
    const native = appManifestNativeIntegration(root, declaration.provider);
    const entry = resolveProviderEntry({
      appId: bootstrap.appId,
      declaration,
      deployment,
      platform,
      sharedAvailable,
      appOwned: {
        configReady,
        ...(recorded?.configGeneration ? { configGeneration: recorded.configGeneration } : {}),
      },
      // The installed client owns this fact; from here it is unobserved, so the
      // projection treats it as not ready rather than assuming it.
      nativeBuild: { ready: false },
    }, nowMs);
    return Object.freeze({
      provider: declaration.provider,
      declaredCredentials: declaration.credentials,
      resolvedAdapter: entry.adapter,
      identityRealm: entry.identityRealm,
      readiness: entry.readiness,
      authProfileGeneration: entry.authProfileGeneration,
      configuration: Object.freeze({
        recorded: recorded !== null,
        ready: configReady,
        missing: Object.freeze(missing),
        secretReferences: fields.secretReferences,
      }),
      nativeBuild: Object.freeze({
        observedHere: false,
        note: 'The installed client reports its own build receipt; the CLI cannot observe it.',
        ...native,
      }),
      nextAction: entry.nextAction
        ?? (configReady && !native.dependencyInstalled
          ? `Install ${native.dependency} and add its config plugin, then rebuild the client.`
          : entry.readiness === 'ready'
            ? null
            : `Run snapback auth configure ${declaration.provider}.`),
    });
  });
  return Object.freeze({
    schemaVersion: 'snapback.auth-status.v1',
    ok: true,
    root,
    appId: bootstrap?.appId ?? null,
    deployment,
    platform,
    sharedAvailable,
    entryMechanisms: Object.freeze([...(bootstrap?.entryMechanisms ?? [])]),
    providers: Object.freeze(providers),
    next: Object.freeze(
      providers.map(({ nextAction }) => nextAction).filter((action) => action !== null),
    ),
    nonclaims: Object.freeze([
      'The shared development profile issues hermetic rehearsal identities, not Apple or Google logins.',
      'Configuration readiness is not native readiness; the installed build must carry the matching integration.',
    ]),
  });
}

export const __authSetupTest = { declarationProperties, digestOf };
