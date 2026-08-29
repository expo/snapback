import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSnapbackMutation, useSnapbackQuery } from '@expo/snapback-expo';
import { SearchBar, palette, spacing, typeScale } from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';
import { newClientId } from '../src/lib/snapback';

export default function NewChatScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const people = useSnapbackQuery(api.profilesLive, {});
  const createDm = useSnapbackMutation(api.createDm);
  const createGroup = useSnapbackMutation(api.createGroup);
  const needle = value.trim().toLowerCase();
  const results = useMemo(() => {
    return (people.data ?? [])
      .filter((row) => !needle || row.handle.includes(needle) || row.displayName.toLowerCase().includes(needle))
      .map((row) => ({ id: row.handle, title: row.displayName, subtitle: `@${row.handle}` }));
  }, [people.data, needle]);

  return (
    <View style={styles.page}>
      <SearchBar
        value={value}
        onChangeText={setValue}
        results={results}
        onPressResult={(id) => {
          setSelected((current) => (current.includes(id) ? current : [...current, id]));
        }}
      />
      <Text style={styles.selected}>Selected: {selected.join(', ')}</Text>
      <Pressable
        style={styles.button}
        onPress={async () => {
          if (selected.length === 1) {
            await createDm({ clientId: newClientId('dm'), handle: selected[0] });
            router.push(`/conversation/${selected[0]}`);
            return;
          }
          if (selected.length >= 2) {
            const clientId = newClientId('g');
            await createGroup({
              clientId,
              name: 'New group',
              description: '',
              memberHandles: selected,
            });
            router.push(`/conversation/group/${clientId}`);
          }
        }}
      >
        <Text style={styles.buttonText}>{selected.length > 1 ? 'Create group' : 'Start DM'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.md },
  selected: { ...typeScale.footnote, color: palette.textMuted, marginVertical: spacing.md },
  button: { backgroundColor: palette.primary, padding: spacing.md, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: palette.textInverse, fontWeight: '700' },
});
