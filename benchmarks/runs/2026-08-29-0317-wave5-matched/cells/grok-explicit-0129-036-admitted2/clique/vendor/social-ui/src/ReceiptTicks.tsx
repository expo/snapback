import React from 'react';
import { Text } from 'react-native';
import { palette } from './tokens';

/** Monotonic receipt states per the brief (M3). */
export type ReceiptState = 'sent' | 'delivered' | 'read';

export interface ReceiptTicksProps {
  state: ReceiptState;
  /** Offline-queued, not yet accepted by the backend (M6 pending state). */
  pending?: boolean;
  size?: number;
  /** Tick color for sent/delivered. */
  color?: string;
  /** Tick color for read. */
  readColor?: string;
  /** Contract testID. Default `sm-convo-receipt`. */
  testID?: string;
}

/**
 * Single check = sent, double check = delivered, colored double check =
 * read (brief M3). A pending glyph covers M6's queued-offline state.
 */
export function ReceiptTicks({
  state,
  pending = false,
  size = 13,
  color = palette.textFaint,
  readColor = palette.readTick,
  testID = 'sm-convo-receipt',
}: ReceiptTicksProps): React.JSX.Element {
  let glyph: string;
  let glyphColor: string;
  let label: string;
  if (pending) {
    glyph = '◷';
    glyphColor = color;
    label = 'pending';
  } else {
    switch (state) {
      case 'sent':
        glyph = '✓';
        glyphColor = color;
        label = 'sent';
        break;
      case 'delivered':
        glyph = '✓✓';
        glyphColor = color;
        label = 'delivered';
        break;
      case 'read':
        glyph = '✓✓';
        glyphColor = readColor;
        label = 'read';
        break;
    }
  }
  if (typeof document !== 'undefined') {
    return (
      <span
        data-testid={testID}
        data-value={label}
        data-state={label}
        aria-valuetext={label}
        aria-label={label}
        style={{ color: glyphColor, fontSize: size, letterSpacing: -2 }}
      >
        {glyph}
      </span>
    );
  }
  return (
    <Text
      accessibilityLabel={label}
      accessibilityValue={{ text: label }}
      style={{ color: glyphColor, fontSize: size, letterSpacing: -2 }}
      testID={testID}
    >
      {glyph}
    </Text>
  );
}
