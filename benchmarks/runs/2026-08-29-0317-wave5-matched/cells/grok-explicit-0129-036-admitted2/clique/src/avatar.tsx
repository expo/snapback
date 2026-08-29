import { StyleSheet, Text, View } from 'react-native';

export function Avatar({ name, color, size = 40 }: Readonly<{ name: string; color: string; size?: number }>) {
  return (
    <View style={[styles.avatar, { backgroundColor: color, borderRadius: size / 2, height: size, width: size }]}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '900' },
});
