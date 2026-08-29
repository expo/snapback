import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { palette } from './tokens';

export interface AvatarProps {
  /** Image URI. When absent, initials derived from `label` render instead. */
  uri?: string;
  /** Display name — used for the initials fallback and the accessibility label. */
  label: string;
  /** Diameter in px. Default 40. */
  size?: number;
  /** Background color behind the initials fallback. */
  color?: string;
  /** Extra (non-contract) testID. Default `sm-avatar`. */
  testID?: string;
  /** Stable actor identity exposed semantically to automation (usually a handle). */
  identity?: string;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

export function Avatar({
  uri,
  label,
  size = 40,
  color = palette.surfaceStrong,
  testID = 'sm-avatar',
  identity,
}: AvatarProps): React.JSX.Element {
  const frame = { width: size, height: size, borderRadius: size / 2 };
  const semantic = identity
    ? ({
        'data-value': identity,
        'data-state': identity,
        'aria-valuetext': identity,
      } as object)
    : {};
  const web = typeof document !== 'undefined';
  if (uri) {
    if (web) {
      return (
        <img
          alt={`Avatar for ${label}`}
          src={uri}
          data-testid={testID}
          {...semantic}
          style={{ width: size, height: size, borderRadius: size / 2, objectFit: 'cover' }}
        />
      );
    }
    return (
      <Image
        accessibilityLabel={`Avatar for ${label}`}
        {...(identity ? { accessibilityValue: { text: identity } } : {})}
        source={{ uri }}
        style={[styles.image, frame]}
        testID={testID}
      />
    );
  }
  if (web) {
    return (
      <div
        data-testid={testID}
        aria-label={`Avatar for ${label}`}
        {...semantic}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
        }}
      >
        {initials(label)}
      </div>
    );
  }
  return (
    <View
      accessibilityLabel={`Avatar for ${label}`}
      {...(identity ? { accessibilityValue: { text: identity } } : {})}
      style={[styles.fallback, frame, { backgroundColor: color }]}
      testID={testID}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.4) }]}>
        {initials(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: palette.surface,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: palette.textMuted,
    fontWeight: '600',
  },
});
