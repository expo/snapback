// Keep these literals in parity with DEFAULT_PORT_RANGE_START/END in
// crates/snapback-cli/src/cli.rs. LLP 0299 makes one range the cross-runtime
// default for every snapback dev listener owner.
export const DEFAULT_DEV_PORT_RANGE = Object.freeze({ lo: 4287, hi: 4387 });

export const DEV_PORT_ENVIRONMENT = Object.freeze({
  backend: 'SNAPBACK_DEV_PORT',
  client: 'SNAPBACK_DEV_CLIENT_PORT',
  bootstrap: 'SNAPBACK_DEV_BOOTSTRAP_PORT',
  range: 'SNAPBACK_DEV_PORT_RANGE',
});

const FLAG_FIELDS = Object.freeze({
  backend: 'port',
  client: 'clientPort',
  bootstrap: 'bootstrapPort',
});

function argumentError(message, details = undefined) {
  const error = new Error(message);
  error.code = 'SNAPBACK_CLI_ARGUMENT_INVALID';
  error.diagnostic = {
    code: error.code,
    severity: 'error',
    subsystem: 'cli',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function parsePort(value, label) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/u.test(value))) {
    throw argumentError(
      `${label} must be an integer from 1 through 65535`,
      { value },
    );
  }
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw argumentError(
      `${label} must be an integer from 1 through 65535`,
      { value },
    );
  }
  return port;
}

function parseRange(value, label) {
  if (typeof value !== 'string' || !/^\d+-\d+$/u.test(value)) {
    throw argumentError(
      `${label} must have the form <lo>-<hi> using ports from 1 through 65535`,
      { value },
    );
  }
  const [rawLo, rawHi] = value.split('-');
  const lo = parsePort(rawLo, `${label} lower bound`);
  const hi = parsePort(rawHi, `${label} upper bound`);
  if (lo > hi) {
    throw argumentError(
      `${label} lower bound must not exceed its upper bound`,
      { value, lo, hi },
    );
  }
  return { lo, hi };
}

function ownersForProfile(profile, platform) {
  if (profile === 'expo') {
    if (!['ios', 'android', 'web'].includes(platform)) {
      throw argumentError('the Expo port plan platform must be ios, android, or web', {
        profile,
        platform,
      });
    }
    return platform === 'web'
      ? ['backend', 'client', 'bootstrap', 'metro']
      : ['backend', 'client', 'bootstrap'];
  }
  if (['plain', 'external-client', 'client-command'].includes(profile)) {
    return ['backend'];
  }
  throw argumentError('the dev port plan profile is unknown', { profile });
}

function declaredValue(owner, flags, env) {
  const flagField = FLAG_FIELDS[owner];
  if (hasValue(flags?.[flagField])) {
    return { value: flags[flagField], declaredBy: 'flag' };
  }
  const environmentName = DEV_PORT_ENVIRONMENT[owner];
  if (hasValue(env?.[environmentName])) {
    return { value: env[environmentName], declaredBy: 'env' };
  }
  return null;
}

function absentOwnerDeclarations(activeOwners, flags, env) {
  const active = new Set(activeOwners);
  return Object.keys(FLAG_FIELDS).filter((owner) => (
    !active.has(owner)
      && (hasValue(flags?.[FLAG_FIELDS[owner]]) || hasValue(env?.[DEV_PORT_ENVIRONMENT[owner]]))
  ));
}

/**
 * Resolve caller intent without touching the network or filesystem.
 * Ranged owners intentionally retain `port: null` until their listener is
 * actually allocated.
 */
export function resolveDevPortPlan({
  profile = 'plain',
  platform = 'ios',
  flags = {},
  env = {},
} = {}) {
  const ownerNames = ownersForProfile(profile, platform);
  const absent = absentOwnerDeclarations(ownerNames, flags, env);
  if (absent.length > 0) {
    throw argumentError(
      `port pins for ${absent.join(', ')} are not available in the active ${profile} profile; this profile has owners: ${ownerNames.join(', ')}`,
      { profile, absentOwners: absent, activeOwners: ownerNames },
    );
  }

  const flagRange = hasValue(flags?.portRange) ? flags.portRange : null;
  const envRange = hasValue(env?.[DEV_PORT_ENVIRONMENT.range])
    ? env[DEV_PORT_ENVIRONMENT.range]
    : null;
  const selectedRange = flagRange !== null
    ? { value: flagRange, source: 'flag' }
    : envRange !== null
      ? { value: envRange, source: 'env' }
      : null;
  const parsedRange = selectedRange === null
    ? DEFAULT_DEV_PORT_RANGE
    : parseRange(selectedRange.value, selectedRange.source === 'flag'
      ? '--port-range'
      : DEV_PORT_ENVIRONMENT.range);
  const range = Object.freeze({
    lo: parsedRange.lo,
    hi: parsedRange.hi,
    source: selectedRange?.source ?? 'default',
  });

  const pins = new Map();
  const owners = ownerNames.map((owner) => {
    const declaration = declaredValue(owner, flags, env);
    if (declaration === null) {
      return Object.freeze({ owner, port: null, source: 'range', declaredBy: null });
    }
    const label = declaration.declaredBy === 'flag'
      ? `--${FLAG_FIELDS[owner].replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`
      : DEV_PORT_ENVIRONMENT[owner];
    const port = parsePort(declaration.value, label);
    const duplicate = pins.get(port);
    if (duplicate !== undefined) {
      throw argumentError(
        `listener owners ${duplicate} and ${owner} cannot pin the same port ${port}`,
        { port, owners: [duplicate, owner] },
      );
    }
    pins.set(port, owner);
    return Object.freeze({
      owner,
      port,
      source: 'pinned',
      declaredBy: declaration.declaredBy,
    });
  });

  const unpinned = owners.filter(({ source }) => source === 'range');
  const pinsInsideRange = [...pins.keys()].filter((port) => (
    port >= range.lo && port <= range.hi
  )).length;
  const availableSlots = range.hi - range.lo + 1 - pinsInsideRange;
  if (availableSlots < unpinned.length) {
    throw argumentError(
      `port range ${range.lo}-${range.hi} has ${availableSlots} allocatable slots but the active ${profile} profile has ${unpinned.length} unpinned owners`,
      {
        profile,
        range: { lo: range.lo, hi: range.hi },
        unpinnedOwners: unpinned.map(({ owner }) => owner),
        pinnedPortsInsideRange: pinsInsideRange,
      },
    );
  }

  return Object.freeze({ range, owners: Object.freeze(owners) });
}

export function materializeDevPortPlan(plan, assignedPorts = {}, ownerProvenance = {}) {
  return Object.freeze({
    range: plan.range,
    owners: Object.freeze(plan.owners.map((entry) => {
      const provenance = ownerProvenance[entry.owner] ?? null;
      return Object.freeze({
        ...entry,
        port: assignedPorts[entry.owner] ?? entry.port ?? null,
        ...(provenance === null ? {} : {
          source: provenance.source,
          declaredBy: provenance.declaredBy,
        }),
      });
    })),
  });
}

export function devPortPlanOwner(plan, owner) {
  return plan?.owners?.find((entry) => entry.owner === owner) ?? null;
}
