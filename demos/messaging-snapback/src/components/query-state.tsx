import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

export function QueryState({ message, error }: { message: string; error?: unknown }) {
  return (
    <View style={styles.wrap}>
      {error ? (
        <Text selectable style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>
      ) : (
        <>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.message}>{message}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, padding: 32 },
  message: { color: colors.secondary, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
});
