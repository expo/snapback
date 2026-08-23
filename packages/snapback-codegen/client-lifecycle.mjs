// Generated client-reference lifecycle vocabulary for LLP 0238 rollout 1.
//
// This module is the executable source for both client-lifecycle.v1.json and
// generated reference JSDoc. Keeping the prose projection beside the artifact
// prevents the declaration surface from acquiring a second lifecycle table.

export const CLIENT_LIFECYCLE_MANIFEST_FILE = 'client-lifecycle.v1.json';
export const CLIENT_LIFECYCLE_MANIFEST_VERSION = 'snapback.client-lifecycle.v1';
export const CLIENT_REFERENCE_GUIDE = '/_snapback/guide/clients/headless.md#generated-reference-kinds-and-legal-verbs';
export const CLIENT_REFERENCE_KIND_MISMATCH_CODE = 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH';
export const AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE =
  'SNAPBACK_AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED';

// This maintained expectation mirrors the shipped SnapbackAppClientPlatform
// declaration plus the Expo provider's explicit native refusal sentinel. A
// cross-package test opens both declarations so this gate is independent from
// the D9 rows it audits.
export const APPLICATION_AUTH_PLATFORM_KINDS = Object.freeze([
  'browser',
  'expo-web',
  'memory',
  'expo-native-phase-2-evidence-required',
]);

const applicationAuthSource = {
  bootstrapPolicyFields: {
    format: {
      derivation: 'constant:APPLICATION_AUTH_BOOTSTRAP_FORMAT',
      semanticIdentityEffect: 'included-constant',
      familiarDisposition: { disposition: 1, route: 'generated identically' },
    },
    appId: {
      derivation: 'normalized-schema:appId',
      semanticIdentityEffect: 'rotates-semanticId',
      familiarDisposition: {
        disposition: 1,
        route: 'generated from the same normalized application id',
      },
    },
    mode: {
      derivation: 'settled-schema-and-defineAuth:auth.mode',
      semanticIdentityEffect: 'rotates-semanticId',
      familiarDisposition: { disposition: 1, route: 'shared verbatim' },
    },
    custody: {
      derivation: 'normalized-defineAuth:custody(default:durable-required)',
      semanticIdentityEffect: 'rotates-semanticId',
      familiarDisposition: {
        disposition: 2,
        route: 'defaults to durable-required; volatile-explicit is refused',
      },
    },
    entryMechanisms: {
      derivation: 'normalized-defineAuth:mechanisms+externalSessionEntry',
      semanticIdentityEffect: 'rotates-semanticId',
      familiarDisposition: { disposition: 1, route: 'shared auth extension' },
    },
    anonymousPublic: {
      derivation: 'normalized-functions:authRequirement+normalized-schema:table.visibility',
      semanticIdentityEffect: 'rotates-semanticId',
      familiarDisposition: {
        disposition: 1,
        route: 'derived from the same normalized operations and schema',
      },
    },
    lifecycleProtocol: {
      derivation: 'constant:1',
      semanticIdentityEffect: 'included-constant',
      familiarDisposition: { disposition: 1, route: 'generated identically' },
    },
  },
  authProgramFields: {
    version: { disposition: 'semantic-source', bootstrapProjection: [] },
    custody: { disposition: 'bootstrap-source', bootstrapProjection: ['custody'] },
    externalSessionEntry: { disposition: 'bootstrap-source', bootstrapProjection: ['entryMechanisms'] },
    mechanisms: { disposition: 'bootstrap-and-mechanism-source', bootstrapProjection: ['entryMechanisms'] },
    providers: { disposition: 'semantic-source-no-bootstrap-field', bootstrapProjection: [] },
    assuranceRequirements: { disposition: 'semantic-source-no-bootstrap-field', bootstrapProjection: [] },
    recoveryPolicy: { disposition: 'recovery-lifecycle-source', bootstrapProjection: [] },
    guestPolicy: { disposition: 'guest-entry-policy-source', bootstrapProjection: ['entryMechanisms'] },
    abuseBudgets: { disposition: 'auth-abuse-policy-source', bootstrapProjection: [] },
    secretReferences: { disposition: 'semantic-source-no-bootstrap-field', bootstrapProjection: [] },
    verifiedProvisioning: { disposition: 'semantic-source-no-bootstrap-field', bootstrapProjection: [] },
  },
  mechanismKinds: {
    guest: { entryMechanism: 'guest-v1', disposition: 'shipped-policy-gated-entry' },
    password: { entryMechanism: 'password-v1', disposition: 'shipped' },
    'email-code': { entryMechanism: 'email-code-v1', disposition: 'deferred-facade-phase' },
    passkey: { entryMechanism: null, disposition: 'deferred-llp-0151-slot' },
  },
  entryMechanisms: {
    'guest-v1': {
      phase: 'shipped',
      targetCapability: 'auth.guest-sessions',
      reactHook: 'useSnapbackAuth',
      familiarHook: 'useAuth',
      operations: [
        {
          operation: 'enter',
          clientMethod: 'authEnterAsGuest',
          clientNamespaceMethod: 'authEnterAsGuest',
          applicationFacadeMethod: 'enterAsGuest',
          facadeOwner: 'SnapbackAppClient.auth',
          facadeMethod: 'enterAsGuest',
          predecessor: 'settled-anonymous-or-process-local-supervised-adopted',
          resultType: 'Promise<AuthCredentialPublicProjectionV1>',
          recoveryProjection: 'none',
        },
        {
          operation: 'claim-password',
          clientMethod: 'authClaimGuestWithPassword',
          clientNamespaceMethod: 'authClaimGuestWithPassword',
          applicationFacadeMethod: 'claimGuestWithPassword',
          facadeOwner: 'SnapbackAppClient.auth',
          facadeMethod: 'claimGuestWithPassword',
          predecessor: 'settled-active-guest-same-session-and-authority',
          collisionContract: 'different-principal-refuses-without-link-merge-or-switch',
          resultType: 'Promise<AuthRecoveryCredentialPublicProjectionV1>',
          recoveryProjection: 'one-time-response',
          targetCapability: 'auth.guest-sessions',
        },
      ],
    },
    'password-v1': {
      phase: 'shipped',
      targetCapability: 'auth.passwords',
      reactHook: 'useSnapbackAuth',
      familiarHook: 'useAuth',
      operations: [
        {
          operation: 'signup',
          clientMethod: 'authPasswordSignup',
          clientNamespaceMethod: 'authPasswordSignup',
          applicationFacadeMethod: 'signUpWithPassword',
          facadeOwner: 'SnapbackAppClient.auth',
          facadeMethod: 'signUpWithPassword',
          predecessor: 'settled-anonymous-or-process-local-supervised-adopted',
          resultType: 'Promise<AuthRecoveryCredentialPublicProjectionV1>',
          recoveryProjection: 'one-time-response',
        },
        {
          operation: 'signin',
          clientMethod: 'authPasswordSignIn',
          clientNamespaceMethod: 'authPasswordSignIn',
          applicationFacadeMethod: 'signInWithPassword',
          facadeOwner: 'SnapbackAppClient.auth',
          facadeMethod: 'signInWithPassword',
          predecessor: 'settled-anonymous-or-process-local-supervised-adopted',
          resultType: 'Promise<AuthCredentialPublicProjectionV1>',
          recoveryProjection: 'none',
        },
        {
          operation: 'change',
          clientMethod: 'authPasswordChange',
          clientNamespaceMethod: 'authPasswordChange',
          applicationFacadeMethod: 'changePassword',
          facadeOwner: 'SnapbackAppClient.auth',
          facadeMethod: 'changePassword',
          predecessor: 'settled-authenticated-same-authority',
          resultType: 'Promise<AuthCredentialPublicProjectionV1>',
          recoveryProjection: 'none',
        },
      ],
    },
    'email-code-v1': {
      phase: 'deferred-facade-phase',
      targetCapability: null,
      reactHook: null,
      familiarHook: null,
      operations: [
        {
          operation: 'request-code',
          clientMethod: 'authRequestCode',
          clientNamespaceMethod: 'authRequestCode',
          applicationFacadeMethod: null,
          facadeOwner: 'SnapbackClient.auth',
          facadeMethod: 'authRequestCode',
          predecessor: 'none',
          resultType: 'Promise<AuthChallengePublicProjectionV1>',
          recoveryProjection: 'none',
        },
        {
          operation: 'exchange',
          clientMethod: 'authExchange',
          clientNamespaceMethod: 'authExchange',
          applicationFacadeMethod: null,
          facadeOwner: 'SnapbackClient.auth',
          facadeMethod: 'authExchange',
          predecessor: 'settled-anonymous',
          resultType: 'Promise<AuthCredentialPublicProjectionV1>',
          recoveryProjection: 'none',
        },
      ],
    },
    'external-session-explicit-v1': {
      phase: 'advanced-explicit-only',
      targetCapability: 'auth.sessions.v1',
      reactHook: null,
      familiarHook: null,
      operations: [{
        operation: 'construct-external-session-client',
        clientMethod: 'createExternalSessionClient',
        clientNamespaceMethod: null,
        applicationFacadeMethod: null,
        facadeOwner: null,
        facadeMethod: null,
        predecessor: 'explicit-advanced-construction',
        resultType: 'SnapbackClient',
        recoveryProjection: 'none',
      }],
    },
  },
  recoveryOperations: {
    consume: {
      predecessor: 'settled-anonymous-or-process-local-supervised-adopted',
      targetCapability: 'auth.passwords',
      clientMethod: 'authRecoveryConsume',
      clientNamespaceMethod: 'authRecoveryConsume',
      applicationFacadeMethod: 'consumeRecoveryCode',
      facadeOwner: 'SnapbackAppClient.auth',
      facadeMethod: 'consumeRecoveryCode',
      facadeDisposition: 'shipped-ordinary-app-facade-exact-client-contract',
      resultType: 'Promise<AuthRecoveryCredentialPublicProjectionV1>',
      recoveryProjection: 'one-time-response',
    },
    rotate: {
      predecessor: 'settled-authenticated-same-authority-with-recent-auth',
      targetCapability: 'auth.passwords',
      clientMethod: 'authRecoveryRotate',
      clientNamespaceMethod: 'authRecoveryRotate',
      applicationFacadeMethod: 'rotateRecoveryCodes',
      facadeOwner: 'SnapbackAppClient.auth',
      facadeMethod: 'rotateRecoveryCodes',
      facadeDisposition: 'shipped-ordinary-app-facade-exact-client-contract',
      resultType: 'Promise<AuthRecoveryCredentialPublicProjectionV1>',
      recoveryProjection: 'one-time-response',
    },
  },
  platforms: {
    browser: {
      runtimePlatformKind: 'browser',
      adapter: 'createIndexedDbAuthCustodyStorage',
      carriers: ['indexeddb-web-locks', 'indexeddb-fenced-lease'],
      grade: 'durable',
      policy: 'durable-required-or-explicit-memory',
      disposition: 'shipped',
      refusalCode: null,
    },
    'expo-web': {
      runtimePlatformKind: 'expo-web',
      adapter: 'createIndexedDbAuthCustodyStorage',
      carriers: ['indexeddb-web-locks', 'indexeddb-fenced-lease'],
      grade: 'durable',
      policy: 'durable-required-or-explicit-memory',
      disposition: 'shipped',
      refusalCode: null,
    },
    memory: {
      runtimePlatformKind: 'memory',
      adapter: 'createMemoryAuthCustodyStorage',
      carriers: ['memory'],
      grade: 'volatile',
      policy: 'volatile-explicit-only',
      disposition: 'shipped-nonclaim',
      refusalCode: 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
    },
    'expo-native-phase-2-evidence-required': {
      runtimePlatformKind: 'expo-native-phase-2-evidence-required',
      adapter: 'createSecureStoreAuthCustodyStorage',
      carriers: [],
      grade: 'pending-per-os-evidence',
      policy: 'durable-required-refused',
      disposition: 'refused-pending-evidence',
      refusalCode: 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
    },
  },
  profiles: {
    'snapback-explicit-v1': { disposition: 'direct-normalized-auth-program' },
    'snapback-familiar-ts-v1': { disposition: 'same-runtime-with-declared-field-dispositions' },
  },
  bootstrapState: {
    stages: ['binding', 'custody', 'authority', 'client'],
    states: [
      { status: 'starting', fields: ['stage'] },
      { status: 'ready', fields: ['custody', 'authoritySource', 'advisories'] },
      { status: 'authority-required', fields: ['diagnostic', 'remediations'] },
      { status: 'blocked', fields: ['diagnostic', 'remediations'] },
      { status: 'unsupported', fields: ['diagnostic', 'remediations'] },
      { status: 'error', fields: ['diagnostic', 'remediations'] },
    ],
    advisories: [{
      diagnosticCode: 'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
      state: 'ready',
      authorityEffect: 'non-authoritative',
    }],
    diagnostics: [
      { class: 'durable-custody-unavailable', state: 'unsupported', remediations: ['installDurableCustody', 'selectSupportedPlatform'], codes: ['SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE', 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED'] },
      { class: 'custody-owner-key-unavailable', state: 'blocked', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_CUSTODY_OWNER_KEY_UNSUPPORTED'] },
      { class: 'duplicate-ordinary-advanced-owner', state: 'error', remediations: ['disposeAndReconstruct', 'useStoragePartition'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID'] },
      { class: 'storage-partition-invalid', state: 'error', remediations: ['useStoragePartition'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_PARTITION_INVALID'] },
      { class: 'binding-app-profile-mismatch', state: 'error', remediations: ['regenerateAppDescriptor', 'retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_APP_INVALID', 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID', 'SNAPBACK_AUTH_BOOTSTRAP_POLICY_INVALID'] },
      { class: 'binding-capability-unavailable', state: 'error', remediations: ['selectCompatibleBinding'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_CAPABILITY_UNAVAILABLE'] },
      { class: 'binding-owner-conflict', state: 'error', remediations: ['disposeAndReconstruct', 'useStoragePartition'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT'] },
      { class: 'rqs-store-identity-conflict', state: 'error', remediations: ['disposeAndReconstruct'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_RQS_STORE_CONFLICT'] },
      { class: 'live-policy-rotation', state: 'error', remediations: ['disposeAndReconstruct'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_POLICY_ROTATION'] },
      { class: 'stale-or-expired-binding', state: 'error', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE', 'SNAPBACK_APP_BINDING_EXPIRED'] },
      { class: 'hosted-binding-invalid', state: 'error', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_APP_BINDING_TARGET_INVALID', 'SNAPBACK_APP_BINDING_INTEGRITY_INVALID'] },
      { class: 'completeness-unclassified', state: 'error', remediations: ['regenerateAppDescriptor'], codes: [AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE] },
      { class: 'bootstrap-failure-fallback', state: 'error', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_FAILED'] },
      { class: 'custody-corrupt-or-unrecognized', state: 'blocked', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_CUSTODY_CORRUPT', 'SNAPBACK_AUTH_CUSTODY_AMBIGUOUS', 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED', 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'] },
      { class: 'supervised-principal-conflict', state: 'ready', remediations: ['keepCurrentPrincipal', 'signOut'], codes: ['SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT'] },
      { class: 'mechanism-unavailable', state: 'error', remediations: ['regenerateAppDescriptor'], codes: ['SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE'] },
      { class: 'recovery-rotation-predecessor', state: 'error', remediations: [], codes: ['SNAPBACK_AUTH_RECOVERY_ROTATE_REQUIRES_AUTHENTICATED'] },
      { class: 'auth-mode-not-sessions', state: 'authority-required', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_POLICY_UNAVAILABLE', 'SNAPBACK_AUTH_MODE_PENDING'] },
      { class: 'participant-barrier-or-final-confirmation', state: 'error', remediations: ['retryAuthBootstrap'], codes: ['SNAPBACK_AUTH_TRANSITION_FAILED', 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID'] },
    ],
    remediations: [
      { kind: 'retryAuthBootstrap', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: true, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'regenerateAppDescriptor', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: 'context-dependent', requiresApproval: false, authorityEffect: 'none' },
      { kind: 'selectCompatibleBinding', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'selectSupportedPlatform', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'installDurableCustody', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'keepCurrentPrincipal', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'signOut', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'clears-session' },
      { kind: 'useStoragePartition', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
      { kind: 'disposeAndReconstruct', publicType: 'SnapbackAuthRemediation', riskClass: 'mechanical', machineApplicable: false, requiresApproval: false, authorityEffect: 'none' },
    ],
  },
  ownership: {
    ordinaryOwner: 'createSnapbackAppClient',
    ordinaryForms: ['appClient', 'app+binding'],
    advancedForms: ['prepared-binding', 'prepared-provider'],
    exclusive: true,
    duplicateRefusalCode: 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
    sameOwnerKeyDisposition: 'reference-counted-reuse',
    conflictingOwnerKeyDisposition: 'SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT',
  },
  supervisedPrecedence: {
    order: [
      'valid-durable-settled-record',
      'explicit-application-entry',
      'admitted-supervised-development-over-anonymous',
      'explicit-advanced-external-adoption',
    ],
    events: ['binding-remint', 'supervisor-restart', 'refreshAuthority'],
    replacementRule: 'replace-only-process-local-supervised-capture-or-anonymous',
    protectedRule: 'application-entered-or-restored-updates-binding-and-transport-facts-only',
    midEntryRule: 'drop-supervisor-adoption-at-arrival',
    conflictDiagnostic: 'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
    conflictState: 'ready-advisory',
  },
  anchors: {
    capabilityIndex: [
      'auth.passwords',
      'auth.browser-session-custody',
      'auth.application-bootstrap-native-custody',
      'clients.react-expo',
    ],
    guide: [
      'guide/auth/passwords.md#sign-up-then-sign-in',
      'guide/auth/passwords.md#recovery-codes-are-the-recovery-path',
      'guide/auth/targets.md',
      'guide/auth/native-apps.md',
      'guide/clients/headless.md#enter-and-leave-session-authority',
      'guide/clients/react.md',
      'guide/clients/react-expo.md',
    ],
  },
};

const freezeTree = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
};

export const APPLICATION_AUTH_LIFECYCLE_SOURCE = freezeTree(applicationAuthSource);

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sortedUnique = (values) => [...new Set(values)].sort(compareCodeUnits);

function assertExactDispositionSet(label, domain, dispositions) {
  const expected = sortedUnique(domain);
  const actual = Object.keys(dispositions ?? {}).sort(compareCodeUnits);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const missing = expected.filter((entry) => !actual.includes(entry));
    const extra = actual.filter((entry) => !expected.includes(entry));
    const error = new TypeError(
      `${AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE}: client lifecycle ${label} dispositions are incomplete: ${JSON.stringify({ missing, extra })}`,
    );
    error.code = AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE;
    error.details = Object.freeze({
      family: label,
      value: missing[0] ?? extra[0] ?? null,
      missing: Object.freeze(missing),
      extra: Object.freeze(extra),
    });
    throw error;
  }
}

function assertDispositionMembers(label, domain, dispositions) {
  for (const value of domain) {
    if (Object.hasOwn(dispositions ?? {}, value)) continue;
    const error = new TypeError(
      `${AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE}: client lifecycle ${label} ${JSON.stringify(value)} has no disposition`,
    );
    error.code = AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE;
    error.details = Object.freeze({ family: label, value });
    throw error;
  }
}

// @ref LLP 0258#d9-generated-completeness-keeps-mechanisms-and-clients-aligned
// — generation fails closed whenever an authoritative auth-program,
// mechanism, platform, or authoring-profile domain grows without a row.
export function assertApplicationAuthLifecycleCompleteness({
  authProgram,
  applicationAuthBootstrap,
  authProgramFields,
  mechanismKinds,
  entryMechanisms,
  platformKinds,
  authoringProfiles,
  familiarDispositions,
  source = APPLICATION_AUTH_LIFECYCLE_SOURCE,
}) {
  assertExactDispositionSet('auth-program field', authProgramFields, source.authProgramFields);
  assertExactDispositionSet('Familiar auth-program field', authProgramFields, familiarDispositions);
  assertExactDispositionSet('auth mechanism kind', mechanismKinds, source.mechanismKinds);
  assertExactDispositionSet('application entry mechanism', entryMechanisms, source.entryMechanisms);
  assertExactDispositionSet('auth custody platform', platformKinds, source.platforms);
  assertExactDispositionSet('auth authoring profile', authoringProfiles, source.profiles);
  if (authProgram !== undefined && authProgram !== null) {
    assertDispositionMembers(
      'auth-program-mechanism',
      Object.values(authProgram.mechanisms ?? {}).map((mechanism) => mechanism?.kind ?? null),
      source.mechanismKinds,
    );
  }
  if (applicationAuthBootstrap !== undefined && applicationAuthBootstrap !== null) {
    assertDispositionMembers(
      'entry-mechanism',
      applicationAuthBootstrap.entryMechanisms ?? [],
      source.entryMechanisms,
    );
  }
  assertExactDispositionSet(
    'enabled recovery lifecycle',
    ['consume', 'rotate'],
    source.recoveryOperations,
  );
  return true;
}

export function buildApplicationAuthLifecycleRows(input) {
  const source = input.source ?? APPLICATION_AUTH_LIFECYCLE_SOURCE;
  assertApplicationAuthLifecycleCompleteness({ ...input, source });
  const authProgram = input.authProgram ?? null;
  const policy = input.applicationAuthBootstrap ?? null;
  const policyFields = Object.entries(source.bootstrapPolicyFields).map(([field, row]) => ({
    field,
    ...row,
    value: policy?.[field] ?? null,
  }));
  const sourceFields = Object.entries(source.authProgramFields)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([field, row]) => ({
      field,
      ...row,
      semanticIdentityEffect: 'included-in-normalized-auth-program',
      familiarDisposition: { ...input.familiarDispositions[field] },
    }));
  const entryRows = input.entryMechanisms.map((mechanism) => ({
    mechanism,
    configured: policy?.entryMechanisms?.includes(mechanism) ?? false,
    ...source.entryMechanisms[mechanism],
  }));
  return {
    authBootstrapPolicy: {
      configured: policy !== null,
      fields: policyFields,
      sourceFields,
      profiles: input.authoringProfiles.map((profile) => ({
        profile,
        selected: profile === input.authoringProfile,
        ...source.profiles[profile],
      })),
    },
    authEntryMechanisms: {
      sourceMechanisms: input.mechanismKinds.map((kind) => ({
        kind,
        ...source.mechanismKinds[kind],
      })),
      entries: entryRows,
    },
    authRecoveryLifecycle: {
      sourceField: 'recoveryPolicy',
      policy: authProgram?.recoveryPolicy ?? null,
      // Absence retains the shipped password floor: signup provisions
      // one-time codes and consume/rotate remain available. Authored false is
      // refused by defineAuth until an end-to-end disabled policy exists.
      operations: Object.entries(source.recoveryOperations)
        .map(([operation, row]) => ({ operation, ...row })),
    },
    authCustodyPlatforms: {
      selectedPolicy: policy?.custody ?? null,
      platforms: input.platformKinds.map((platform) => ({ platform, ...source.platforms[platform] })),
    },
    authBootstrapState: { ...source.bootstrapState },
    authOwnership: { ...source.ownership },
    authSupervisedPrecedence: { ...source.supervisedPrecedence },
    authAnchors: { ...source.anchors },
  };
}

const compatibilityAlias = (current, plannedCanonical) => Object.freeze({
  current,
  plannedCanonical,
  emittedInRollout1: false,
  removalEpoch: 'declared-major-after-stage-2-measurement',
});

// @ref LLP 0238#d4-react-and-expo-hooks-are-kind-explicit — this data is the
// one rename authority consumed by lifecycle artifacts and familiar JSDoc.
// @ref LLP 0253#s63-usemutation — Phase C completes the dispatch, status,
// task, and read rows so familiar routing follows the planned vocabulary.
export const CLIENT_COMPATIBILITY_ALIASES = Object.freeze([
  compatibilityAlias('useSnapbackQuery', 'useSnapbackLiveQuery'),
  compatibilityAlias('useSnapbackMutation', 'useSnapbackMutationDispatch'),
  compatibilityAlias('useSnapbackOutbox().mutationStatus', 'useSnapbackMutationStatus'),
  compatibilityAlias('useSnapbackCommand', 'useSnapbackTask'),
  compatibilityAlias('client.query', 'client.read'),
]);

const dispositions = Object.freeze([
  'pending',
  'settled',
  'failed',
  'stranded',
  'quarantined',
  'resultGone',
  'unknown',
]);

const lifecycle = ({
  kind,
  runtimeDiscriminant,
  acceptedBy,
  correctVerb,
  auth,
  freshness,
  retention,
  stateCarrier,
  guideAnchor = CLIENT_REFERENCE_GUIDE,
}) => Object.freeze({
  kind,
  runtimeDiscriminant,
  acceptedBy: Object.freeze([...acceptedBy]),
  correctVerb,
  auth,
  freshness,
  retention,
  stateCarrier,
  guideAnchor,
});

// @ref LLP 0238#d1-generated-references-are-nominal-by-operation-kind — this
// closed current-product table drives both the generated artifact and JSDoc.
export const CLIENT_REFERENCE_LIFECYCLES = Object.freeze([
  lifecycle({
    kind: 'Query',
    runtimeDiscriminant: 'Query',
    acceptedBy: ['query', 'liveQuery'],
    correctVerb: 'query',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'one-shot authoritative response or liveQuery snapshot followed by updates',
    retention: 'none',
    stateCarrier: 'Promise<QueryOutput<Result>>',
  }),
  lifecycle({
    kind: 'LiveQuery',
    runtimeDiscriminant: 'LiveQuery',
    acceptedBy: ['query', 'liveQuery', 'useSnapbackQuery', 'useSnapbackQueries'],
    correctVerb: 'liveQuery',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'authoritative initial snapshot followed by live updates',
    retention: 'per-operation retainable/retentionClass declaration',
    stateCarrier: 'LiveQueryHandle or React QueryState',
  }),
  lifecycle({
    kind: 'Mutation',
    runtimeDiscriminant: 'Mutation',
    acceptedBy: ['mutate', 'useSnapbackMutation', 'useSnapbackSettledMutation'],
    correctVerb: 'mutate',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'dispatch result is not durable settlement',
    retention: 'durable outbox identity until terminal disposition/acknowledgement',
    stateCarrier: 'MutationDispatchOutcome plus MutationDisposition',
  }),
  lifecycle({
    kind: 'Action',
    runtimeDiscriminant: 'Action',
    acceptedBy: ['action'],
    correctVerb: 'action',
    auth: 'per-operation authRequirement and requiredCapabilities',
    freshness: 'one-shot online response',
    retention: 'none',
    stateCarrier: 'Promise<ActionOutput<Result>>',
  }),
  lifecycle({
    kind: 'Command',
    runtimeDiscriminant: 'asset-bearing-command.v1',
    acceptedBy: ['commandClient.start', 'useSnapbackCommand'],
    correctVerb: 'commandClient.start',
    auth: 'inherited from the descriptor mutation and asset intent',
    freshness: 'task snapshot is process-local; mutation settlement remains durable',
    retention: 'command task is process-local; constituent mutation follows outbox retention',
    stateCarrier: 'CommandTask',
  }),
]);

const byKind = new Map(CLIENT_REFERENCE_LIFECYCLES.map((entry) => [entry.kind, entry]));

export function lifecycleForReferenceKind(kind) {
  const entry = byKind.get(kind);
  if (!entry) throw new TypeError(`unknown client reference kind ${JSON.stringify(kind)}`);
  return entry;
}

const operationProjection = (fn) => {
  const entry = lifecycleForReferenceKind(fn.kind);
  return {
    semanticIdentity: fn.id,
    name: fn.name,
    kind: fn.kind,
    runtimeDiscriminant: entry.runtimeDiscriminant,
    implementationHash: fn.implementationHash,
    argsContractHash: fn.argsContractHash,
    resultContractHash: fn.resultContractHash,
    authRequirement: fn.authRequirement ?? 'optional-user',
    requiredCapabilities: [...new Set(fn.requiredCapabilities ?? [])].sort(),
    legalVerbs: [...entry.acceptedBy],
    correctVerb: entry.correctVerb,
    freshness: entry.freshness,
    retention: fn.kind === 'LiveQuery'
      ? (fn.retainable === true
          ? fn.retentionClass ?? 'opaque-authorized-snapshot-v1'
          : 'none')
      : entry.retention,
    delivery: ({ Query: 'read', LiveQuery: 'live', Mutation: 'mutation', Action: 'action' })[fn.kind],
    states: fn.kind === 'Mutation'
      ? ['dispatch:settled', 'dispatch:queued', ...dispositions.map((state) => `disposition:${state}`)]
      : fn.kind === 'Query' || fn.kind === 'LiveQuery'
        ? ['connecting', 'live', 'polling', 'stale', 'disconnected']
        : [],
    guideAnchor: entry.guideAnchor,
  };
};

export function buildClientLifecycleManifest({
  appId,
  inputsHash,
  authoredSourceHash,
  targetProfile,
  functions,
  commands = {},
  ordinaryRows,
  applicationAuth,
}) {
  const operations = [...functions]
    .map(operationProjection)
    .sort((left, right) => left.semanticIdentity.localeCompare(right.semanticIdentity));
  const operationsByName = new Map(operations.map((operation) => [operation.name, operation]));
  const generatedCommands = Object.entries(commands)
    .map(([name, command]) => {
      const mutation = operationsByName.get(command.mutation?.name);
      return {
        semanticIdentity: `${appId}:command:${name}`,
        name,
        kind: 'Command',
        runtimeDiscriminant: command.kind,
        mutationIdentity: mutation?.semanticIdentity ?? command.mutation?.id ?? null,
        implementationHash: mutation?.implementationHash ?? command.mutation?.implementationHash ?? null,
        authRequirement: mutation?.authRequirement ?? 'optional-user',
        requiredCapabilities: mutation?.requiredCapabilities ?? [],
        legalVerbs: [...lifecycleForReferenceKind('Command').acceptedBy],
        correctVerb: lifecycleForReferenceKind('Command').correctVerb,
        freshness: lifecycleForReferenceKind('Command').freshness,
        retention: lifecycleForReferenceKind('Command').retention,
        // @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
        // — generated lifecycle metadata projects the actual media task
        // grammar instead of relabeling it as the single-asset command.
        states: command.kind === 'media-command.v1'
          ? [
              'validating', 'uploading', 'committing',
              'committed', 'failed', 'cancelled', 'ambiguous',
            ]
          : [
              'preparing', 'transferring', 'committing',
              'succeeded', 'failed', 'cancelled', 'ambiguous',
            ],
        guideAnchor: CLIENT_REFERENCE_GUIDE,
      };
    })
    .sort((left, right) => left.semanticIdentity.localeCompare(right.semanticIdentity));

  return {
    artifactKind: 'clientLifecycleManifest',
    schemaVersion: CLIENT_LIFECYCLE_MANIFEST_VERSION,
    appId,
    inputsHash,
    authoredSourceHash,
    targetProfile,
    custody: {
      consumer: 'developer-tooling',
      storageClass: 'regenerable-cache',
      committedProjectionRequired: false,
      rationale: 'rollout 1 has no runtime consumer; codegen, generated declarations, tests, and guide checks consume the same source table',
    },
    surfaceFamilies: ['query', 'liveQuery', 'mutate', 'action', 'commands'],
    referenceKinds: CLIENT_REFERENCE_LIFECYCLES.map((entry) => ({ ...entry })),
    handleStates: {
      liveQueryHandle: {
        nonterminalConnection: ['connecting', 'live', 'polling', 'stale'],
        terminalConnection: ['disconnected'],
        disposalMeaning: 'disposed handles publish no further rows and release their subscription resources',
      },
      commandTask: {
        nonterminal: ['preparing', 'transferring', 'committing'],
        terminal: ['succeeded', 'failed', 'cancelled', 'ambiguous'],
      },
    },
    mutationSettlement: {
      // @ref LLP 0218#decision — this is the complete durable public
      // disposition union; process-local promise completion is not another
      // settlement state.
      dispositions: [...dispositions],
      dispatch: 'mutate() resolves to settled or queued dispatch; queued means durably recorded for delivery, not settled',
      settlement: 'mutationStatus()/subscribeMutation() project durable disposition by clientMutationId',
      terminal: ['settled', 'failed', 'stranded', 'quarantined', 'resultGone'],
      nonterminal: ['pending', 'unknown'],
    },
    resourceIdentity: {
      version: 'snapback.client-resource-key.v1',
      ingredients: [
        'reference semantic identity',
        'canonical argument contract and canonical argument bytes',
        'authority partition',
        'normalized lifecycle options',
        'build identity inputsHash',
      ],
    },
    diagnostics: [{
      code: CLIENT_REFERENCE_KIND_MISMATCH_CODE,
      phase: 'client-call-boundary-before-transport',
      receivedField: 'receivedKind',
      acceptedField: 'acceptedKinds',
      remediationField: 'correctVerb',
      guideAnchor: CLIENT_REFERENCE_GUIDE,
    }],
    compatibilityAliases: CLIENT_COMPATIBILITY_ALIASES.map((entry) => ({ ...entry })),
    futureClassM: {
      shippedInRollout1: false,
      snapshotVersionMeaning: 'authorized principal/query viewRevision',
      forbiddenMeaning: 'raw row version, app commit, or storage snapshot',
      note: 'when class-M handles ship, snapshotVersion identifies the authorized principal/query view',
    },
    rows: {
      ...ordinaryRows,
      ...buildApplicationAuthLifecycleRows(applicationAuth),
    },
    operations,
    commands: generatedCommands,
  };
}

const jsdocSafe = (value) => String(value).replaceAll('*/', '*\\/');
const code = (value) => `\`${jsdocSafe(value)}\``;

// @ref LLP 0238#d7-vocabulary-and-state-tables-are-generated-once — declaration
// comments are rendered from the same operation rows as the JSON projection.
export function renderReferenceJSDoc(reference, manifest, authoringProfile = 'snapback-explicit-v1') {
  const entry = lifecycleForReferenceKind(reference.kind);
  const projected = reference.kind === 'Command'
    ? manifest.commands.find(({ name }) => name === reference.name)
    : manifest.operations.find(({ semanticIdentity }) => semanticIdentity === reference.id);
  if (!projected) {
    throw new TypeError(`client lifecycle has no ${reference.kind} reference ${JSON.stringify(reference.name)}`);
  }
  const verbs = projected.legalVerbs.map(code).join(', ');
  const capabilities = projected.requiredCapabilities.length === 0
    ? 'none'
    : projected.requiredCapabilities.map(code).join(', ');
  const states = projected.states.length === 0
    ? 'promise-only (no handle state table)'
    : projected.states.map(code).join(', ');
  const profileRoutes = [];
  if (authoringProfile === 'snapback-familiar-ts-v1' && projected.kind === 'Mutation') {
    const dispatch = CLIENT_COMPATIBILITY_ALIASES.find(
      ({ current }) => current === 'useSnapbackMutation',
    );
    const status = CLIENT_COMPATIBILITY_ALIASES.find(
      ({ current }) => current === 'useSnapbackOutbox().mutationStatus',
    );
    profileRoutes.push(
      ` * Familiar \`useMutation\` is settled-only (\`queue:false\`); offline lifecycle: ${code(dispatch.current)} + ${code(status.current)} (planned ${code(dispatch.plannedCanonical)} + ${code(status.plannedCanonical)}).`,
    );
  }
  if (authoringProfile === 'snapback-familiar-ts-v1' && projected.delivery === 'read') {
    const read = CLIENT_COMPATIBILITY_ALIASES.find(({ current }) => current === 'client.query');
    profileRoutes.push(
      ` * Familiar delivery ${code('read')} has no v1 hook; call ${code(read.current)} (planned ${code(read.plannedCanonical)}).`,
    );
  }
  return [
    '/**',
    ` * ${jsdocSafe(reference.kind)} reference ${code(projected.semanticIdentity)}.`,
    ` * Legal client verbs/hooks: ${verbs}.`,
    ` * Auth: ${code(projected.authRequirement)}; required capabilities: ${capabilities}.`,
    ` * Freshness: ${jsdocSafe(projected.freshness)} Retention: ${jsdocSafe(projected.retention)}.`,
    ` * Dispatch/task states: ${states}.`,
    ...profileRoutes,
    ` * Build identity: ${code(manifest.inputsHash)}. Guide: ${code(entry.guideAnchor)}.`,
    ' */',
  ].join('\n');
}
