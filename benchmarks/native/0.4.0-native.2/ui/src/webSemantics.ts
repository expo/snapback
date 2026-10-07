import { Platform } from 'react-native';

// @ref LLP 0201#d6--ui-kit — renderer adaptation may expose existing plain
// kit state, but must not introduce a backend-shaped prop or data dependency.
/**
 * React Native Web forwards `dataSet` to DOM `data-*` attributes, but the
 * React Native 0.86 public prop types do not declare it. Keep this adapter
 * web-only so native renderers continue to receive only native props.
 */
export function webSourceUriProps(uri: string | undefined): {} {
  if (Platform.OS !== 'web' || uri == null) return {};
  return { dataSet: { 'source-uri': uri } };
}
