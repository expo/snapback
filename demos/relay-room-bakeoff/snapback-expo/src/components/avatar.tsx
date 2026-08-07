import { StyleSheet, Text, View } from 'react-native';

export function Avatar({ name, color, size = 44 }: Readonly<{ name: string; color: string; size?: number }>) {
  return (
    <View style={[styles.avatar, { backgroundColor: color, borderRadius: size / 2, height: size, width: size }]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{name.trim().slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#FFFFFF', fontWeight: '800' },
});
