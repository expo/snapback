const CAPABILITY_FORMAT = 'snapback.declared-dev-capability.v1';
const DEPLOYMENT_IDENTITY_KEYS = [
  'appId',
  'authMode',
  'bundleHash',
  'inputsHash',
  'schemaHash',
  'schemaVersion',
];
const stamps = new WeakMap();
const generatedAppStamps = new WeakMap();

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const exactKeys = (value, expected) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};

export function normalizeDeploymentIdentity(value) {
  if (
    !exactKeys(value, DEPLOYMENT_IDENTITY_KEYS)
    || !DEPLOYMENT_IDENTITY_KEYS.every((key) => nonEmptyString(value[key]))
  ) return null;
  return Object.freeze(Object.fromEntries(
    DEPLOYMENT_IDENTITY_KEYS.map((key) => [key, value[key]]),
  ));
}

export function deploymentIdentitiesEqual(left, right) {
  const normalizedLeft = normalizeDeploymentIdentity(left);
  const normalizedRight = normalizeDeploymentIdentity(right);
  return normalizedLeft !== null
    && normalizedRight !== null
    && DEPLOYMENT_IDENTITY_KEYS.every((key) => normalizedLeft[key] === normalizedRight[key]);
}

// @ref LLP 0302#1-structural-gating-one-stable-module-two-generated-variants
// — only generated development modules call this internal-subpath mint; its
// module-private stamp cannot be reconstructed from public app data.
export function mintDeclaredDevCapability(deploymentIdentity) {
  const normalized = normalizeDeploymentIdentity(deploymentIdentity);
  if (normalized === null) {
    throw new TypeError('declared-dev generation requires a complete DeploymentIdentity');
  }
  const capability = Object.freeze({
    format: CAPABILITY_FORMAT,
    deploymentIdentity: normalized,
  });
  stamps.set(capability, normalized);
  return capability;
}

/**
 * UNSAFE generated-code-only seam, outside the security boundary.
 *
 * An in-process importer already has application-author standing and can call
 * this function successfully. The security boundary is data-borne candidates:
 * admission still requires the exact app/capability pair stamped here.
 */
export function unsafeInstallDeclaredDevCapabilityForGeneratedCode(app, deploymentIdentity) {
  if (!isRecord(app) || Object.hasOwn(app, 'declaredDev')) {
    throw new TypeError('declared-dev generation requires an unbound generated app object');
  }
  const capability = mintDeclaredDevCapability(deploymentIdentity);
  Object.defineProperty(app, 'declaredDev', {
    value: capability,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  generatedAppStamps.set(app, Object.freeze({ capability, deploymentIdentity: stamps.get(capability) }));
  return capability;
}

export function stampedDeclaredDevIdentity(capability) {
  if (
    !isRecord(capability)
    || capability.format !== CAPABILITY_FORMAT
    || !exactKeys(capability, ['deploymentIdentity', 'format'])
  ) return null;
  const stamped = stamps.get(capability);
  if (stamped === undefined || !deploymentIdentitiesEqual(stamped, capability.deploymentIdentity)) {
    return null;
  }
  return stamped;
}

export function declaredDevCapabilityFromApp(app) {
  if (!isRecord(app)) return null;
  const capability = app.declaredDev;
  const appStamp = generatedAppStamps.get(app);
  if (
    appStamp === undefined
    || appStamp.capability !== capability
    || stampedDeclaredDevIdentity(capability) === null
    || !deploymentIdentitiesEqual(appStamp.deploymentIdentity, capability.deploymentIdentity)
  ) return null;
  return capability;
}

export function canonicalDeclaredDevOrigin(value) {
  if (!nonEmptyString(value)) return Object.freeze({ ok: false, rule: 'url-must-be-a-non-empty-string' });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return Object.freeze({ ok: false, rule: 'whatwg-url-parse' });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return Object.freeze({ ok: false, rule: 'credentials-forbidden' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Object.freeze({ ok: false, rule: 'scheme-http-or-https' });
  }
  if (parsed.pathname !== '/') return Object.freeze({ ok: false, rule: 'path-root-only' });
  if (parsed.search !== '') return Object.freeze({ ok: false, rule: 'query-forbidden' });
  if (parsed.hash !== '') return Object.freeze({ ok: false, rule: 'fragment-forbidden' });
  if (parsed.origin === 'null') return Object.freeze({ ok: false, rule: 'tuple-origin-required' });
  if (!new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '10.0.2.2']).has(parsed.hostname.toLowerCase())) {
    return Object.freeze({ ok: false, rule: 'url-surface-host' });
  }
  return Object.freeze({ ok: true, origin: parsed.origin });
}

export const DEPLOYMENT_IDENTITY_FIELDS = Object.freeze([...DEPLOYMENT_IDENTITY_KEYS]);
