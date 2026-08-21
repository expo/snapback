declare module 'virtual:snapback/dev' {
  import type {
    SnapbackAppBindingV1,
    SnapbackApplicationDescriptorV1,
  } from '@expo/snapback-client';

  export const snapbackBasePath: string;
  export const snapbackDevState: Readonly<{
    mode: 'off' | 'external' | 'attach' | 'managed' | 'auto';
    shape: string | null;
    ready: boolean;
    basePath: string;
  }>;
  export function createSnapbackDevAppBinding(
    app: SnapbackApplicationDescriptorV1,
  ): SnapbackAppBindingV1;
}
