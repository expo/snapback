import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.surface,
    default: '#F3F1F8',
  })!,
  surface: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: '#FFFFFF',
  })!,
  elevated: Platform.select({
    ios: Color.ios.tertiarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainerHigh,
    default: '#F8F7FB',
  })!,
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: '#1B1823',
  })!,
  secondary: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#6E687A',
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: '#DDD9E5',
  })!,
  accent: Platform.select({
    ios: Color.ios.systemIndigo,
    android: Color.android.dynamic.primary,
    default: '#6955D9',
  })!,
  green: Platform.select({
    ios: Color.ios.systemGreen,
    android: '#2E7D32',
    default: '#1C9A62',
  })!,
  destructive: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: '#D23B53',
  })!,
  white: '#FFFFFF',
  outgoingBubble: '#6C56E7',
  incomingBubble: '#FFFFFF',
  replyStripe: '#A79AF2',
  composer: '#FFFFFF',
};
