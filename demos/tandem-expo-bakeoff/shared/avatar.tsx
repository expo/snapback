import { Text, View } from 'react-native';
import { initials } from './format';

export function Avatar({
  name,
  color,
  size = 52,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <View
      accessibilityLabel={`${name} avatar`}
      style={{
        alignItems: 'center',
        backgroundColor: color,
        borderCurve: 'continuous',
        borderRadius: size * 0.36,
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      <Text
        selectable
        style={{ color: '#FFFFFF', fontSize: size * 0.32, fontWeight: '800' }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}
