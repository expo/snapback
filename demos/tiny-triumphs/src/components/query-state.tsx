import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

export function QueryState({ message, error }: Readonly<{ message: string; error?: unknown }>) {
  return <View style={{ alignItems: 'center', gap: 12, padding: 36 }}>{error ? <Text selectable style={{ color: colors.spark, textAlign: 'center' }}>{String(error)}</Text> : <ActivityIndicator color={colors.spark} />}<Text selectable style={{ color: colors.muted, textAlign: 'center' }}>{error ? 'The jar needs a moment. Try again.' : message}</Text></View>;
}
