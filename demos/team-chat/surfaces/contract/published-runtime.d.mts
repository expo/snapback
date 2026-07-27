export type MountHandle = {
  dispose(): void;
};

export type ContractWebHostHandle = {
  dispose(): void;
};

export type OnlineSnapbackContractSurface = {
  links: unknown;
  dispose?(): void | Promise<void>;
};

export const createBoundaryContractDataProvider: (...args: unknown[]) => unknown;
export const createContractMockQueryBoundary: (...args: unknown[]) => unknown;
export const createProviderQueryHandle: (...args: unknown[]) => unknown;

export function mount(
  component: unknown,
  options: { props: Record<string, unknown> },
): MountHandle;

export function reset(): void;

export function installContractWebHost(options: {
  container: HTMLElement;
}): ContractWebHostHandle | null;

export class SnapbackClient {
  constructor(origin: string);
  health(): Promise<unknown>;
  ensureApp(options: {
    schema: unknown;
    functions: unknown;
  }): Promise<unknown>;
}

export function createOnlineSnapbackContractSurface(options: {
  runtime: {
    createBoundaryContractDataProvider: (...args: unknown[]) => unknown;
    createContractMockQueryBoundary: (...args: unknown[]) => unknown;
    createProviderQueryHandle: (...args: unknown[]) => unknown;
  };
  client: SnapbackClient;
  userId: string;
  manifest: unknown;
  artifactIndex: unknown;
  schemaManifest: unknown;
  functionManifest: unknown;
  liveQueries: readonly unknown[];
  requiredQueries: readonly unknown[];
  liveFallbackToPoll: false;
}): Promise<OnlineSnapbackContractSurface>;
