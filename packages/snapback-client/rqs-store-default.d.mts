export interface DefaultRqsStoreResolution {
  readonly store: unknown;
  readonly source: 'default' | 'explicit' | 'disabled' | string;
  readonly durable: boolean;
  readonly degradation?: { readonly code: string; readonly detail?: string };
}

export declare function resolveDefaultRqsStore(options?: {
  baseUrl?: string;
}): DefaultRqsStoreResolution;
