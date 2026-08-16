import {
  classifyHostedDevelopmentHostname,
} from '@expo/snapback-client/app-client-internal';

const TARGET_KEYS = ['app', 'functions', 'origin', 'routing', 'schema'];
const GENERATED_HOSTED_DEVELOPMENT_ADMISSION = Symbol.for(
  '@expo/snapback-client/generated-hosted-development-admission.v1',
);
const HOSTED_DEVELOPMENT_ADMISSION = Symbol.for(
  '@expo/snapback-client/hosted-development-admission.v1',
);
const GENERATED_HOSTED_DEVELOPMENT_ADMISSION_KEYS = [
  'format',
  'generatedHostedTargets',
  'verifyHostedTargetAdmission',
];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, expected) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};
const targetTuple = (target) => TARGET_KEYS.map((key) => target?.[key]).join('\u0000');
const exactTarget = (left, right) => isRecord(left)
  && isRecord(right)
  && targetTuple(left) === targetTuple(right);
const canonicalOrigin = (value) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || parsed.origin === 'null'
      || parsed.origin !== value.replace(/\/$/u, '')
    ) return null;
    return parsed;
  } catch {
    return null;
  }
};
const deepFreeze = (value) => {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const frozenPlainSnapshot = (value) => {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    return null;
  }
};
const verified = async (callback, ...args) => {
  if (typeof callback !== 'function') return false;
  try {
    return await callback(...args) === true;
  } catch {
    return false;
  }
};

const generatedHostedDevelopmentEvidence = (binding, generatedApp) => {
  const evidence = generatedApp?.[GENERATED_HOSTED_DEVELOPMENT_ADMISSION];
  if (
    !exactKeys(evidence, GENERATED_HOSTED_DEVELOPMENT_ADMISSION_KEYS)
    || evidence.format !== 'snapback.generated-hosted-development-admission.v1'
    || !Array.isArray(evidence.generatedHostedTargets)
    || typeof evidence.verifyHostedTargetAdmission !== 'function'
    || generatedApp?.format !== 'snapback.app.v1'
    || generatedApp?.identity?.descriptor !== binding?.descriptorIdentity
    || generatedApp?.identity?.app !== binding?.target?.app
    || generatedApp?.identity?.schema !== binding?.target?.schema
    || generatedApp?.identity?.functions !== binding?.target?.functions
  ) return null;
  return evidence;
};

// @ref LLP 0181#hosted-development-binding — the app's generated binding
// module is the trust root for hosted targets and receipt admission. This file
// is intentionally absent from the package exports map: application callers
// reach it only through admitAppBindingV1, while tests may import it relatively.
export async function admitHostedDevelopmentBindingForAppClient(binding, generatedApp) {
  // Snapshot before the verifier can yield. Matching, verification, and the
  // admitted transport binding must all observe one immutable target tuple;
  // never re-read a caller-owned getter after an await.
  const bindingSnapshot = frozenPlainSnapshot(binding);
  const origin = canonicalOrigin(bindingSnapshot?.target?.origin);
  const classification = origin === null
    ? 'invalid'
    : classifyHostedDevelopmentHostname(origin.hostname);
  if (
    bindingSnapshot?.source !== 'hosted-development'
    || bindingSnapshot?.target?.routing !== 'https'
    || origin?.protocol !== 'https:'
    || classification !== null
  ) return Object.freeze({ status: 'target-invalid', classification });
  const evidence = generatedHostedDevelopmentEvidence(bindingSnapshot, generatedApp);
  if (evidence === null) {
    return Object.freeze({ status: 'generated-module-unavailable' });
  }
  if (
    !evidence.generatedHostedTargets.some((target) => exactTarget(target, bindingSnapshot.target))
  ) return Object.freeze({ status: 'target-unadmitted' });
  if (!await verified(
    evidence.verifyHostedTargetAdmission,
    bindingSnapshot.provenance?.hostedTargetReceipt,
    bindingSnapshot,
  )) return Object.freeze({ status: 'integrity-invalid' });

  const admittedBinding = structuredClone(bindingSnapshot);
  Object.defineProperty(admittedBinding, HOSTED_DEVELOPMENT_ADMISSION, {
    value: Object.freeze({
      descriptorIdentity: admittedBinding.descriptorIdentity,
      format: 'snapback.hosted-development-admission.v1',
      targetTuple: targetTuple(admittedBinding.target),
    }),
    enumerable: false,
  });
  return Object.freeze({ status: 'admitted', binding: deepFreeze(admittedBinding) });
}
