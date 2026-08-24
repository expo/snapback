import { useCallback, useEffect } from 'react';

import {
  positiveDevelopmentEnvironment,
  projectAppRefusal,
} from '@expo/snapback-client';
import {
  asSnapbackDiagnosticError,
  SnapbackDiagnosticError,
} from '@expo/snapback-client/diagnostic-error';
import { assertClientReferenceKind } from '@expo/snapback-client/reference-kinds';

import { SnapbackProvider } from './index.mjs';
import {
  skip,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackProviderClient,
  useSnapbackQuery as canonicalUseQueryState,
  useSnapbackSettledMutation,
} from './implementation.mjs';
import { classifyFamiliarQueryState } from './familiar-error-classes.mjs';

const FAMILIAR_AUTHORING_PROFILE = 'snapback-familiar-ts-v1';
const FAMILIAR_PROFILE = Object.freeze([FAMILIAR_AUTHORING_PROFILE]);

export {
  SnapbackProvider,
  canonicalUseQueryState as useQueryState,
  projectAppRefusal,
  skip,
  useSnapbackAuth as useAuth,
  useSnapbackCurrentPrincipal as useCurrentPrincipal,
};

const diagnosticsChannelFor = (client) => {
  try {
    return client?.diagnosticsChannel?.() ?? null;
  } catch {
    return null;
  }
};

function assertFamiliarReference(client, reference, acceptedKinds, invokedVerb) {
  assertClientReferenceKind({
    reference,
    acceptedKinds,
    invokedVerb,
    diagnosticsChannel: diagnosticsChannelFor(client),
    acceptedAuthoringProfiles: FAMILIAR_PROFILE,
  });
}

function routingDiagnostic(state) {
  const code = state.error?.code ?? 'SNAPBACK_AUTH_REQUIRED';
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v2',
    code,
    severity: 'warning',
    subsystem: 'react',
    message: `useQuery projects ${state.status} as undefined; use useQueryState for canonical connection, freshness, and diagnostic facts`,
    details: Object.freeze({
      hook: 'useQuery',
      route: 'useQueryState',
      status: state.status,
      connection: state.connection,
      freshness: state.freshness,
    }),
    site: 'useQuery',
  });
}

function emitRoutingDiagnostic(client, state) {
  const event = routingDiagnostic(state);
  try {
    const channel = diagnosticsChannelFor(client);
    if (typeof channel?.emit === 'function') {
      channel.emit(event);
      return;
    }
  } catch { /* observation cannot own rendering */ }
  console.warn(`${event.code}: ${event.message}`);
}

// @ref LLP 0253#s63-usemutation — a raw pre-custody transport refusal is
// hardened to the existing typed carrier and names the canonical offline path.
// @ref LLP 0144#axis-d--generation-and-client-typing-cv-16 — Familiar keeps
// the shared declared-refusal carrier intact before adding generic route help.
function settledMutationError(error) {
  const normalized = asSnapbackDiagnosticError(error, {
    operation: 'mutation',
    refKind: 'Mutation',
  });
  if (
    projectAppRefusal(normalized) !== null
    || (error?.diagnostic && typeof error.diagnostic.code === 'string')
  ) return normalized;
  const diagnostic = Object.freeze({
    ...normalized.diagnostic,
    message: `${normalized.diagnostic.message}; offline custody uses useSnapbackMutation with useSnapbackOutbox().mutationStatus`,
    details: Object.freeze({
      ...normalized.diagnostic.details,
      route: Object.freeze({
        dispatch: 'useSnapbackMutation',
        status: 'useSnapbackOutbox().mutationStatus',
      }),
    }),
  });
  return new SnapbackDiagnosticError(diagnostic, {
    operation: 'mutation',
    refKind: 'Mutation',
    cause: error,
  });
}

// @ref LLP 0253#s62-usequery — the familiar spelling is a total projection
// over the one canonical full-state hook. Only live/current data is exposed.
export function useQuery(reference, args) {
  const client = useSnapbackProviderClient();
  assertFamiliarReference(client, reference, ['LiveQuery'], 'useQuery');
  const loweredArgs = args === 'skip' ? skip : args;
  const state = canonicalUseQueryState(reference, loweredArgs);
  const projection = classifyFamiliarQueryState(state);

  useEffect(() => {
    if (projection === 'route' && positiveDevelopmentEnvironment()) {
      emitRoutingDiagnostic(client, state);
    }
  }, [client, projection, state]);

  if (projection === 'data') return state.data;
  if (projection === 'throw') {
    throw new SnapbackDiagnosticError(state.error, {
      operation: 'query',
      refKind: 'LiveQuery',
    });
  }
  return undefined;
}

// @ref LLP 0253#s63-usemutation — queue:false is the settled-only path; the
// wrapper only normalizes pre-custody transport failures to the one existing
// public refusal carrier.
export function useMutation(reference) {
  const client = useSnapbackProviderClient();
  assertFamiliarReference(client, reference, ['Mutation'], 'useMutation');
  const mutate = useSnapbackSettledMutation(reference);
  return useCallback(async (args) => {
    try {
      return await mutate(args);
    } catch (error) {
      throw settledMutationError(error);
    }
  }, [mutate]);
}

// @ref LLP 0253#s64-useaction — actions use the provider's existing client at
// call time and allocate no process-local task owner.
export function useAction(reference) {
  const client = useSnapbackProviderClient();
  assertFamiliarReference(client, reference, ['Action'], 'useAction');
  return useCallback((args) => client.run(reference, { args }), [client, reference]);
}
