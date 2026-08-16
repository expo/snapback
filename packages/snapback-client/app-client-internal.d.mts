import type {
  AuthBootstrapSnapshot,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
} from './app-client.mjs';

export function createSnapbackAppClientWithBootstrapObserver(
  input: Readonly<{
    app: SnapbackApplicationDescriptorV1;
    binding: SnapbackAppBindingV1;
    platform: SnapbackAppClientPlatform;
    storagePartition?: string;
  }>,
  observer: (snapshot: AuthBootstrapSnapshot) => void,
): Promise<SnapbackAppClient>;

export function applicationDescriptorForAppClient(
  appClient: SnapbackAppClient,
): SnapbackApplicationDescriptorV1;

export function adoptSupervisedBootstrapAuthority(
  appClient: SnapbackAppClient,
  input: Readonly<{
    bearer: string;
    binding: SnapbackAppBindingV1;
    refreshAfterMs?: number;
  }>,
): Promise<Readonly<{
  status: 'adopted' | 'rebound' | 'conflict' | 'dropped';
}>>;
