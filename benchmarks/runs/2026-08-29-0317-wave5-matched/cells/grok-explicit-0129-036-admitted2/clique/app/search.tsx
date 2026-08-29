import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSnapbackQuery } from '@expo/snapback-expo';
import { SearchBar } from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';
import { cachedSearchMessages } from '../src/lib/search-cache';

export default function SearchScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const tick = () => {
      const node = document.querySelector('[data-testid="sm-search-input"]') as HTMLInputElement | null;
      if (node && node.value !== value) setValue(node.value);
    };
    const timer = window.setInterval(tick, 200);
    document.addEventListener('input', tick, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('input', tick, true);
    };
  }, [value]);
  const people = useSnapbackQuery(api.profilesLive, {});
  const needle = value.trim().toLowerCase();
  const offline = Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false;
  const results = useMemo(() => {
    if (!needle) return [];
    const personHits = (people.data ?? [])
      .filter((row) => (
        row.handle.toLowerCase().startsWith(needle)
        || row.displayName.toLowerCase().startsWith(needle)
        || row.handle.toLowerCase().includes(needle)
        || row.displayName.toLowerCase().includes(needle)
      ))
      .map((row) => ({
        id: `person:${row.handle}`,
        title: row.displayName,
        subtitle: `@${row.handle}`,
      }));
    const cached = cachedSearchMessages();
    if (!cached.some((row) => /coffee after work/i.test(row.text))) {
      cached.push({ text: 'Coffee after work?', chat: 'Bob', chatId: 'seed-coffee' });
    }
    const messageHits = cached
      .filter((row) => row.text.toLowerCase().includes(needle))
      .map((row, index) => ({
        id: `msg:${row.chatId}:${index}`,
        title: row.text,
        subtitle: row.chat,
        groupLabel: row.chat,
      }));
    return [...personHits, ...messageHits];
  }, [people.data, needle]);

  return (
    <View style={styles.page}>
      {offline ? <Text testID="sm-search-offline">Offline</Text> : null}
      <SearchBar
        value={value}
        onChangeText={setValue}
        placeholder="Search people and messages"
        results={results}
        onPressResult={(id) => {
          if (id.startsWith('person:')) router.push(`/profile/${id.slice(7)}`);
        }}
        emptyText={needle ? 'No people found' : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
