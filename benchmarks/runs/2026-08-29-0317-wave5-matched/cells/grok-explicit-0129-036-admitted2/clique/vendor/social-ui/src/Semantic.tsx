import React from 'react';
import { Platform, View, type ViewStyle } from 'react-native';

export function Semantic(props: {
  testID: string;
  value?: string;
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}): React.JSX.Element {
  const { testID, value, children, style } = props;
  if (Platform.OS === 'web') {
    return (
      <div
        data-testid={testID}
        data-value={value}
        data-state={value}
        aria-valuetext={value}
        style={{ display: 'block' }}
      >
        {children}
      </div>
    );
  }
  return (
    <View
      accessibilityValue={value ? { text: value } : undefined}
      style={style}
      testID={testID}
    >
      {children}
    </View>
  );
}
