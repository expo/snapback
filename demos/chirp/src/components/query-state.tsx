import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

export function QueryState({ message, error }: { message: string; error?: unknown }) {
  return <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
    {!error ? <ActivityIndicator color={colors.blue} /> : null}
    <Text selectable style={{ color: error ? '#d92d20' : colors.secondary, textAlign: 'center' }}>{error ? `${message}\n${error instanceof Error ? error.message : String(error)}` : message}</Text>
  </View>;
}
