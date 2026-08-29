export function extractAssetId(ref: unknown): string | null {
  if (typeof ref === 'string' && ref.length > 0) return ref;
  if (ref && typeof ref === 'object' && 'id' in ref && typeof (ref as { id: unknown }).id === 'string') {
    return (ref as { id: string }).id;
  }
  return null;
}
