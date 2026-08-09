// Internal helper: render http(s) URLs inside text as tappable spans.
// Brief global ruling: links are auto-detected tappable text opening the
// system browser — no unfurling, no previews. The kit only detects and
// styles; the lane supplies onPressLink (e.g. Linking.openURL).

import React from 'react';
import { Text } from 'react-native';
import { palette } from './tokens';

const URL_RE = /(https?:\/\/[^\s]+)/g;

export function renderLinkifiedText(
  text: string,
  onPressLink?: (url: string) => void,
): React.ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) {
    return text;
  }
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <Text
          key={i}
          accessibilityRole="link"
          style={{ color: palette.link, textDecorationLine: 'underline' }}
          onPress={onPressLink ? () => onPressLink(part) : undefined}
          testID="sm-text-link"
        >
          {part}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}
