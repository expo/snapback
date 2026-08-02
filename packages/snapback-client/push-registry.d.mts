import type { SnapbackClient } from './index.mjs';

export interface PushInstallationStorage {
  read(): Promise<string | null | undefined> | string | null | undefined;
  write(installationId: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface PushTokenRegistration {
  readonly tokenId: string;
  readonly installationId: string;
  readonly registeredAt: number;
  readonly rotated: boolean;
  readonly ownershipTransferred: boolean;
}

export interface PushTokenUnregistration {
  readonly tokenId: string | null;
  readonly retired: boolean;
}

export interface PushRegistrySurface {
  installationId(): Promise<string>;
  registerToken(input: { readonly token: string }): Promise<Readonly<PushTokenRegistration>>;
  unregisterToken(): Promise<Readonly<PushTokenUnregistration>>;
  registerExpoToken(input: {
    readonly getExpoPushTokenAsync: (
      options?: { readonly projectId: string },
    ) => Promise<{ readonly data: string }>;
    readonly projectId?: string;
  }): Promise<Readonly<PushTokenRegistration>>;
}

export type PushRegistryClient<Client extends SnapbackClient = SnapbackClient> = Client & {
  readonly push: Readonly<PushRegistrySurface>;
};

export function attachPushRegistry<Client extends SnapbackClient>(
  client: Client,
  options?: { readonly pushInstallationStorage?: PushInstallationStorage | null },
): PushRegistryClient<Client>;

export function newPushInstallationId(): string;
