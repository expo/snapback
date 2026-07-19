declare module '*/generated/api.mjs' {
  export interface EphemeralCollectionRef {
    artifactKind: 'ephemeralCollectionReference';
    name: string;
    keyMode: 'Connection' | 'Session' | 'User' | 'Custom';
    scopeFields: readonly string[];
    routingFields: readonly string[];
    defaultTtlMs: number;
    maxTtlMs: number;
    maxValueBytes: number;
  }
  export const ephemeral: { webCursors: EphemeralCollectionRef };
  const api: { ephemeral: { webCursors: EphemeralCollectionRef } };
  export default api;
}
