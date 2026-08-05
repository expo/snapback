import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';
import type { Typer } from '@/lib/useTyping';

export function TypingIndicator({ typers }: { typers: Typer[] }) {
  if (typers.length === 0) return null;
  const label = typers.length === 1
    ? `${typers[0].name} is typing…`
    : `${typers.map((t) => t.name).join(', ')} are typing…`;
  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        <View style={styles.dot} />
        <View style={[styles.dot, styles.dotMid]} />
        <View style={styles.dot} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { backgroundColor: colors.faint, borderRadius: 3, height: 6, width: 6 },
  dotMid: { opacity: 0.6 },
  label: { color: colors.secondary, fontSize: 12.5, fontStyle: 'italic' },
});
