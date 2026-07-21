export type PartitimeVariant = 'warm' | 'night';

const palette = {
  warm: {
    background: '#f4f0e8',
    surface: '#faf7f0',
    text: '#171512',
    muted: '#625b52',
    accent: '#ff4d24',
    panel: '#dce3bf',
  },
  night: {
    background: '#15171d',
    surface: '#222630',
    text: '#f9f3e8',
    muted: '#b8b2a8',
    accent: '#ff825f',
    panel: '#273d36',
  },
} as const;

export function backgroundFor(variant: PartitimeVariant): string {
  return palette[variant].background;
}

export function textFor(variant: PartitimeVariant): string {
  return palette[variant].text;
}

export function mutedFor(variant: PartitimeVariant): string {
  return palette[variant].muted;
}

export function accentFor(variant: PartitimeVariant): string {
  return palette[variant].accent;
}

export function surfaceStyle(variant: PartitimeVariant, tone: 'surface' | 'panel' = 'surface') {
  return {
    backgroundColor: tone === 'panel' ? palette[variant].panel : palette[variant].surface,
    borderColor: variant === 'night' ? 'rgba(249,243,232,0.24)' : 'rgba(23,21,18,0.22)',
  };
}

export function fieldStyle(variant: PartitimeVariant, invalid: boolean) {
  return {
    backgroundColor: variant === 'night' ? '#171a21' : '#fffaf2',
    borderColor: invalid ? '#c43b2f' : variant === 'night' ? 'rgba(249,243,232,0.34)' : 'rgba(23,21,18,0.35)',
    color: palette[variant].text,
  };
}

export function requiredMessage(value: string, label: string): string | null {
  return value.trim() === '' ? `${label} is required.` : null;
}
