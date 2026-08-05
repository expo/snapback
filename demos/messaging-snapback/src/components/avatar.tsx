import { StyleSheet, Text, View } from 'react-native';
import { avatarFor } from '@/lib/identity';

export function Avatar({ handle, size = 40 }: { handle: string; size?: number }) {
  const persona = avatarFor(handle);
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: persona.avatarColor },
      ]}
    >
      <Text style={{ fontSize: size * 0.5 }}>{persona.avatarEmoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
