import {useMemo, useSyncExternalStore} from 'react';
import {SnapbackClient} from '@expo/snapback-client';
import {
  AuthCoordinator,
  createIndexedDbAuthCustodyStorage,
} from '@expo/snapback-contract';
import {createSnapbackReactProvider} from '@expo/snapback-react';
import {nanoid} from 'nanoid';
import {snapbackBasePath} from 'virtual:snapback/dev';

import capabilityManifest from '../../snapback/generated/capability.manifest.json';
import functions from '../../snapback/generated/functions.manifest.json';
import schema from '../../snapback/generated/schema.manifest.json';
import {getSessionController, useSession} from '../auth/session';
import {
  createMutationAdapter,
  MutationPresentationController,
  type MutationArgs,
  type MutationName,
  type ReducerContext,
} from './mutations';
import {createZerobugsDataAdapter} from './queries';
import type {User} from './types';

// @ref LLP 0059#durable-custody-record — one coordinator owns browser custody
// in the shipped IndexedDB/Web Locks store, so reloads adopt the exact durable
// session before the React/session/data adapters publish its fenced authority.
export const authCoordinator = new AuthCoordinator({
  appId: 'zerobugs-control',
  storage: createIndexedDbAuthCustodyStorage(),
});

export const client = new SnapbackClient(snapbackBasePath, {
  authCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'zerobugs_control_web',
});

const binding = await client.prepareReactBinding({
  generatedManifest: {schema, functions, capabilityManifest},
});

export const snapbackProvider = createSnapbackReactProvider(binding);
export const sessionController = getSessionController({client: client as never});
export const dataAdapter = createZerobugsDataAdapter(client as never);
export const mutationPresentation = new MutationPresentationController();
export const mutationAdapter = createMutationAdapter(client, mutationPresentation);
let mutationSequence = 0;
let currentMutationPresentation = mutationPresentation.snapshot();
mutationPresentation.subscribe(() => {
  currentMutationPresentation = mutationPresentation.snapshot();
});

export function useMutationPresentation() {
  return useSyncExternalStore(
    listener => mutationPresentation.subscribe(listener),
    () => currentMutationPresentation,
    () => currentMutationPresentation,
  );
}

function actorFromSession(): User | null {
  const current = sessionController.getSnapshot().current;
  if (!current) return null;
  return Object.freeze({
    id: current.sourceUserID,
    login: current.login,
    name: current.login,
    avatar: '',
    role: current.role,
  });
}

export function useZerobugsMutation<Name extends MutationName>(name: Name) {
  const {snapshot} = useSession();
  return useMemo(() => async (
    args: MutationArgs<Name>,
    context: Omit<ReducerContext, 'actor'> = {},
  ) => mutationAdapter.invoke({
    name,
    args,
    clientMutationId: `zbugs-${name}-${++mutationSequence}-${nanoid()}`,
    context: {...context, actor: actorFromSession()},
  }), [name, snapshot.current?.principal]);
}
