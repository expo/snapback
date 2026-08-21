import { Tabs } from 'expo-router';
import { useSnapbackAuth } from '@knockoff/snapback-react';
import { Text } from 'react-native';
import { colors } from '@/theme/colors';

const Icon = ({ value, color }: { value: string; color: string }) => <Text style={{ color, fontSize: 22 }}>{value}</Text>;

export default function TabLayout() {
  const auth = useSnapbackAuth();
  return <Tabs screenOptions={{ tabBarActiveTintColor: colors.blue, headerShadowVisible: false }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Icon value="⌂" color={String(color)} /> }} />
    <Tabs.Screen name="search" options={{ title: 'Explore', tabBarIcon: ({ color }) => <Icon value="⌕" color={String(color)} /> }} />
    <Tabs.Screen name="profile" options={{
      title: 'Profile',
      tabBarIcon: ({ color }) => <Icon value="◉" color={String(color)} />,
      headerRight: () => <Text accessibilityRole="button" onPress={() => void auth.signOut()} style={{ color: colors.accent, paddingRight: 16 }}>Sign out</Text>,
    }} />
  </Tabs>;
}
