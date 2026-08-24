declare module 'virtual:snapback/dev' {
  export const snapbackBasePath: string;
  export const snapbackDevState: Readonly<{
    mode: 'off' | 'external' | 'attach' | 'managed' | 'auto';
    shape: string | null;
    ready: boolean;
    basePath: string;
  }>;
}
