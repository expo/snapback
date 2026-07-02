// Tiny inline-style kit shared by the All Aboard React components.
//
// The Contract arm styles nodes with per-attr props (gap/padding/radius/...);
// the faithful React mirror is inline style objects. `Press` is the analogue of
// the Contract `button` node: an unstyled, resettable <button> that carries the
// press handler, the accessibility label, and the data-testid handle.

import type { CSSProperties, ReactNode } from 'react';

export const palette = {
  page: '#f4f6fb',
  card: '#ffffff',
  hairline: '#e6e9f2',
  hairlineStrong: '#d7dce8',
  chipBg: '#eef1f8',
  ink: '#10152b',
  inkSoft: '#5a6480',
  inkFaint: '#8b93ad',
  inkFaintest: '#9aa2b8',
  accent: '#2f5fe0',
  photoFallback: '#dbe3f4',
  photoFallbackInk: '#6b7495',
  track: '#c7cee0',
} as const;

export const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const column: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 };
export const row: CSSProperties = { display: 'flex', flexDirection: 'row', minWidth: 0 };

export function hairlineCard(extra?: CSSProperties): CSSProperties {
  return {
    ...column,
    background: palette.card,
    border: `1px solid ${palette.hairline}`,
    ...extra,
  };
}

const pressReset: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'start',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  display: 'block',
};

export function Press(props: {
  onPress: () => void;
  label: string;
  testId: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      aria-label={props.label}
      data-testid={props.testId}
      style={{ ...pressReset, ...props.style }}
    >
      {props.children}
    </button>
  );
}

/** A small bordered chip-style press target (the ◀ ▶ / Change station look). */
export function chip(extra?: CSSProperties): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 8,
    background: palette.chipBg,
    border: `1px solid ${palette.hairline}`,
    ...extra,
  };
}

/** The service-class pill (Local / Limited / Baby Bullet). */
export function ServicePill(props: { service: string; color: string; tint: string; size?: number; testId?: string }) {
  return (
    <div style={{ borderRadius: 6, padding: `${props.size === 11 ? 2 : 3}px 8px`, background: props.tint }}>
      <div
        data-testid={props.testId}
        style={{ fontSize: props.size ?? 12, fontWeight: 700, color: props.color }}
      >
        {props.service}
      </div>
    </div>
  );
}
