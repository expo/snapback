import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from './colors';

export function QueryState({
  message,
  error,
}: {
  message: string;
  error?: string | null;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 12, padding: 40 }}>
      {error ? null : <ActivityIndicator color={colors.accent as string} />}
      <Text
        selectable
        style={{
          color: error ? colors.destructive : colors.secondary,
          fontSize: 15,
          lineHeight: 21,
          textAlign: 'center',
        }}
      >
        {error ?? message}
      </Text>
    </View>
  );
}
