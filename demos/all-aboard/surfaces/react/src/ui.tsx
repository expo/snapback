// Tiny inline-style kit shared by the All Aboard React components.
//
// The Contract arm styles nodes with per-attr props (gap/padding/radius/...);
// the faithful React mirror is inline style objects. `Press` is the analogue of
// the Contract `button` node: an unstyled, resettable <button> that carries the
// press handler, the accessibility label, and the data-testid handle.
//
// The palette is the redesigned poster-board surface (ENG-22450 re-baseline):
// full-bleed artwork with white typography at graded alphas, glass rows, and
// per-service tinted pills — the same literals app.contract inlines.

import type { CSSProperties, ReactNode } from 'react';

export const mono = 'ui-monospace, Menlo, monospace';

export const palette = {
  page: '#05070f',
  sheet: '#05070fe6',
  glass: '#0d1322b8',
  glassRow: '#0d1322a8',
  glassFaint: '#0d13227d',
  hairline: '#ffffff14',
  hairlineRow: '#ffffff12',
  hairlineFaint: '#ffffff0f',
  pillBg: '#ffffff1c',
  pillBorder: '#ffffff24',
  ink: '#ffffff',
  inkStrong: '#ffffffe6',
  inkBody: '#ffffffd9',
  inkSoft: '#ffffffb8',
  inkMeta: '#ffffffa6',
  inkMono: '#ffffff96',
  inkDim: '#ffffff8a',
  inkFaint: '#ffffff73',
  inkGhost: '#ffffff66',
  inkCredit: '#ffffff4d',
  inkDisabled: '#ffffff1f',
  amber: '#fbbf24',
  amberTint: '#fbbf2422',
  amberBorder: '#fbbf2447',
} as const;

export const column: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 };
export const row: CSSProperties = { display: 'flex', flexDirection: 'row', minWidth: 0 };

/** The rounded translucent pill used for Change station / Flip / Refresh / Done. */
export function pill(extra?: CSSProperties): CSSProperties {
  return {
    padding: '6px 13px',
    borderRadius: 999,
    background: palette.pillBg,
    border: `1px solid ${palette.pillBorder}`,
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
  disabled?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      aria-label={props.label}
      data-testid={props.testId}
      disabled={props.disabled}
      style={{ ...pressReset, ...props.style }}
    >
      {props.children}
    </button>
  );
}

/** The service-class pill (Local / Limited / Baby Bullet). */
export function ServicePill(props: {
  service: string;
  color: string;
  tint: string;
  size?: number;
  paddingX?: number;
  paddingY?: number;
  testId?: string;
}) {
  return (
    <div
      style={{
        ...row,
        borderRadius: 999,
        padding: `${props.paddingY ?? 4}px ${props.paddingX ?? 11}px`,
        background: props.tint,
      }}
    >
      <div data-testid={props.testId} style={{ fontSize: props.size ?? 12, fontWeight: 700, color: props.color }}>
        {props.service}
      </div>
    </div>
  );
}
