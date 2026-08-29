import { Platform } from 'react-native';

export function snapbackOrigin(): string {
  return process.env.EXPO_PUBLIC_SNAPBACK_URL ?? 'http://127.0.0.1:63200';
}

export function assetUrl(ref: unknown, variant = 'feed'): string | undefined {
  if (ref == null) return undefined;
  const id = typeof ref === 'string' ? ref : (typeof ref === 'object' && ref && 'id' in ref ? String((ref as { id: string }).id) : null);
  if (!id) return undefined;
  return variant ? `${snapbackOrigin()}/assets/public/${id}/${variant}` : `${snapbackOrigin()}/assets/public/${id}`;
}

export function videoUrl(ref: unknown): string | undefined {
  return assetUrl(ref, 'primary');
}

export function newClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTime(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function isWeb(): boolean {
  return Platform.OS === 'web';
}

export function diagnosticText(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
