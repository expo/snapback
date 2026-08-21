import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: Platform.select({ ios: Color.ios.systemBackground, android: Color.android.dynamic.surface, default: '#ffffff' })!,
  elevated: Platform.select({ ios: Color.ios.secondarySystemBackground, android: Color.android.dynamic.surfaceContainer, default: '#f7f9f9' })!,
  label: Platform.select({ ios: Color.ios.label, android: Color.android.dynamic.onSurface, default: '#0f1419' })!,
  secondary: Platform.select({ ios: Color.ios.secondaryLabel, android: Color.android.dynamic.onSurfaceVariant, default: '#536471' })!,
  tertiary: Platform.select({ ios: Color.ios.tertiaryLabel, android: Color.android.dynamic.outline, default: '#70757a' })!,
  separator: Platform.select({ ios: Color.ios.separator, android: Color.android.dynamic.outlineVariant, default: '#eff3f4' })!,
  accent: '#6d3df5',
  blue: '#6d3df5',
  pink: '#f91880',
  danger: '#d92d20',
  white: '#ffffff',
};
