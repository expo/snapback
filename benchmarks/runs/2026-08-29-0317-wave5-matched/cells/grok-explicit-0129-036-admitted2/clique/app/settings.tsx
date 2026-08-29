import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSnapbackAuth, useSnapbackQuery } from '@expo/snapback-expo';
import { palette, spacing, typeScale } from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';

const EMPTY = {};

export default function SettingsScreen() {
  const auth = useSnapbackAuth();
  const router = useRouter();
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const me = mine.data?.[0];
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Settings</Text>
      {me ? (
        <Pressable onPress={() => router.push(`/profile/${me.handle}`)} style={styles.row}>
          <Text style={styles.name}>{me.displayName}</Text>
          <Text style={styles.handle}>@{me.handle}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/insights')} style={styles.row}>
        <Text style={styles.label}>Insights</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signOut()}
        style={styles.row}
        testID="sm-settings-logout"
      >
        <Text style={styles.logout}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg },
  title: { ...typeScale.title, color: palette.text, marginBottom: spacing.lg },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  name: { ...typeScale.headline, color: palette.text },
  handle: { ...typeScale.footnote, color: palette.textMuted },
  label: { ...typeScale.body, color: palette.text },
  logout: { ...typeScale.body, color: palette.danger, fontWeight: '700' },
});
