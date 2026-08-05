import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

export type WarbleTheme = Readonly<{
  isDark: boolean;
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  danger: string;
  heart: string;
  banner: string;
  bannerText: string;
}>;

const lightTheme: WarbleTheme = Object.freeze({
  isDark: false,
  background: '#F3F6F7',
  surface: '#FFFFFF',
  surfaceMuted: '#EAF0F1',
  text: '#142326',
  muted: '#68787C',
  border: '#D9E2E4',
  accent: '#347C78',
  onAccent: '#FFFFFF',
  danger: '#C93850',
  heart: '#D9475D',
  banner: '#FFF1C7',
  bannerText: '#634D08',
});

const darkTheme: WarbleTheme = Object.freeze({
  isDark: true,
  background: '#0D1517',
  surface: '#162023',
  surfaceMuted: '#202C30',
  text: '#F1F6F5',
  muted: '#97A8AC',
  border: '#2A393D',
  accent: '#68B9B2',
  onAccent: '#102220',
  danger: '#FF7388',
  heart: '#FF7185',
  banner: '#393119',
  bannerText: '#F5D875',
});

export function useWarbleTheme(): WarbleTheme {
  const scheme = useColorScheme();
  return useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);
}
