import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@/theme/colors';

const Icon = ({ value, color }: { value: string; color: string }) => <Text style={{ color, fontSize: 20 }}>{value}</Text>;

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.accent, headerShadowVisible: false }}>
      <Tabs.Screen name="index" options={{ title: 'Chats', tabBarIcon: ({ color }) => <Icon value="💬" color={String(color)} /> }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: ({ color }) => <Icon value="👤" color={String(color)} /> }} />
    </Tabs>
  );
}
