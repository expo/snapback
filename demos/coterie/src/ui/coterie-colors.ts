type Rgb = readonly [number, number, number];

// @ref LLP 0266#d3-presentation-port-rule — message roles use app-owned
// neutral and brand tints instead of Facet's status-feedback palette.
const MESSAGE_BUBBLE_PALETTE = {
  light: {
    highlighted: '#c7d2fe',
    mine: '#dde7ff',
    theirs: '#f1f2f4',
  },
  dark: {
    highlighted: '#312e81',
    mine: '#202654',
    theirs: '#27272a',
  },
} as const;

const LIGHT_ACCENT_SURFACES = [
  '#ffffff',
  '#fafafa',
  '#f4f4f5',
  '#e4e4e7',
  '#eff6ff',
  '#fffbeb',
  ...Object.values(MESSAGE_BUBBLE_PALETTE.light),
] as const;
const DARK_ACCENT_SURFACES = [
  '#09090b',
  '#18181b',
  '#27272a',
  '#3f3f46',
  '#162456',
  '#461901',
  ...Object.values(MESSAGE_BUBBLE_PALETTE.dark),
] as const;

const LIGHT_TEXT = '#09090b';
const DARK_TEXT = '#fafafa';

const SEARCH_AVATAR_PALETTE = {
  light: {
    person: { background: '#dbeafe', foreground: '#1e3a8a' },
    chat: { background: '#d1fae5', foreground: '#065f46' },
  },
  dark: {
    person: { background: '#172554', foreground: '#bfdbfe' },
    chat: { background: '#052e16', foreground: '#a7f3d0' },
  },
} as const;

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match) return null;
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(color: string, target: string, amount: number): string {
  const sourceRgb = parseHex(color);
  const targetRgb = parseHex(target);
  if (!sourceRgb || !targetRgb) return target;
  return rgbToHex(sourceRgb.map((channel, index) => (
    channel + (targetRgb[index]! - channel) * amount
  )) as unknown as Rgb);
}

// @ref LLP 0266#d3-presentation-port-rule — frozen chat accents stay data;
// the portable presentation derives a readable foreground per resolved scheme.
export function coterieAccentForeground(accent: string, scheme: string): string {
  const dark = scheme === 'dark';
  const surfaces = dark ? DARK_ACCENT_SURFACES : LIGHT_ACCENT_SURFACES;
  const target = dark ? DARK_TEXT : LIGHT_TEXT;
  if (!parseHex(accent)) return target;

  for (let step = 0; step <= 100; step += 1) {
    const candidate = mix(accent, target, step / 100);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= 4.5)) {
      return candidate;
    }
  }
  return target;
}

/** Chooses the higher-contrast Facet text pole for a pinned accent swatch. */
export function coterieSwatchForeground(accent: string): string {
  return contrastRatio(LIGHT_TEXT, accent) >= contrastRatio(DARK_TEXT, accent)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

export function coterieMessageBubbleFill(role: string, scheme: string): string {
  const palette = scheme === 'dark' ? MESSAGE_BUBBLE_PALETTE.dark : MESSAGE_BUBBLE_PALETTE.light;
  if (role === 'highlighted') return palette.highlighted;
  if (role === 'mine') return palette.mine;
  return palette.theirs;
}

export function coterieAvatarBackground(kind: string, accent: string, scheme: string): string {
  const palette = scheme === 'dark' ? SEARCH_AVATAR_PALETTE.dark : SEARCH_AVATAR_PALETTE.light;
  if (kind === 'person') return palette.person.background;
  if (kind === 'chat') return palette.chat.background;
  return accent;
}

export function coterieAvatarForeground(kind: string, accent: string, scheme: string): string {
  const palette = scheme === 'dark' ? SEARCH_AVATAR_PALETTE.dark : SEARCH_AVATAR_PALETTE.light;
  if (kind === 'person') return palette.person.foreground;
  if (kind === 'chat') return palette.chat.foreground;
  return coterieSwatchForeground(accent);
}
