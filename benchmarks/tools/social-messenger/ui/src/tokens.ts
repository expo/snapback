// Design tokens for the Clique (social-messenger) benchmark UI kit.
// Frozen with the kit version (see ../VERSION); governing design: LLP 0201 D6.
// Tokens are plain values only — no theme context, no providers.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  bubble: 18,
  pill: 999,
} as const;

export const typeScale = {
  caption: { fontSize: 12, lineHeight: 16 },
  footnote: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
} as const;

export const palette = {
  background: '#FFFFFF',
  surface: '#F4F5F7',
  surfaceStrong: '#E8EAEE',
  border: '#E2E4E8',
  text: '#17191C',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  textInverse: '#FFFFFF',
  primary: '#4F46E5',
  danger: '#DC2626',
  success: '#16A34A',
  link: '#2563EB',
  bubbleMine: '#DDE7FF',
  bubbleTheirs: '#F1F2F4',
  readTick: '#2F80ED',
  overlay: 'rgba(0, 0, 0, 0.55)',
} as const;

/**
 * The 8 pinned per-chat accent colors the brief requires
 * (chat customization, M5). Names are stable identifiers; values are
 * frozen with the kit version.
 */
export const chatAccents = {
  indigo: '#4F46E5',
  teal: '#0D9488',
  coral: '#EF6351',
  amber: '#D97706',
  violet: '#7C3AED',
  emerald: '#059669',
  rose: '#E11D48',
  slate: '#475569',
} as const;

export type ChatAccentName = keyof typeof chatAccents;

export interface ChatAccent {
  name: ChatAccentName;
  value: string;
}

/** The pinned accents as an ordered list (stable order, frozen with the kit). */
export const chatAccentList: readonly ChatAccent[] = (
  Object.keys(chatAccents) as ChatAccentName[]
).map((name) => ({ name, value: chatAccents[name] }));
