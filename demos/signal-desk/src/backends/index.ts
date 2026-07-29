import type { BackendAdapter, BackendKind } from '../types';

export async function createBackend(kind: BackendKind): Promise<BackendAdapter> {
  if (kind === 'snapback') {
    const { SnapbackAdapter } = await import('./snapback');
    return new SnapbackAdapter();
  }
  if (kind === 'convex') {
    const { ConvexAdapter } = await import('./convex');
    return new ConvexAdapter();
  }
  const { SupabaseAdapter } = await import('./supabase');
  return new SupabaseAdapter();
}
