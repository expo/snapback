import { useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/snapback';
import { PERSONAS, useIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';

export default function PeopleScreen() {
  const { client, self, setSelf } = useIdentity();
  const [opening, setOpening] = useState<string | null>(null);

  async function openDm(otherHandle: string) {
    const other = PERSONAS.find((p) => p.handle === otherHandle);
    if (!other || opening) return;
    setOpening(otherHandle);
    try {
      const result = await client.mutate(api.startDirectMessage, {
        userId: self.handle,
        queue: false,
        args: {
          selfHandle: self.handle,
          selfName: self.name,
          otherHandle: other.handle,
          otherName: other.name,
        },
      });
      if (result.status !== 'settled') throw new Error('DM bootstrap unexpectedly queued');
      router.push({ pathname: '/conversation/[id]', params: { id: result.result } });
    } finally {
      setOpening(null);
    }
  }

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={PERSONAS}
      keyExtractor={(item) => item.handle}
      ListHeaderComponent={
        <View style={styles.introBlock}>
          <Text style={styles.introTitle}>Switch who you are</Text>
          <Text style={styles.introBody}>
            This demo uses dev-mode identity — tap a persona to become them, or
            tap another row to start a DM with them as {self.name}.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const isSelf = item.handle === self.handle;
        return (
          <View style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => (isSelf ? undefined : openDm(item.handle))}>
              <Avatar handle={item.handle} size={44} />
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.handle}>@{item.handle}</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel={isSelf ? `${item.name} is you` : `Become ${item.name}`}
              onPress={() => setSelf(item.handle)}
              style={[styles.becomeButton, isSelf && styles.becomeButtonActive]}
            >
              <Text style={[styles.becomeText, isSelf && styles.becomeTextActive]}>
                {isSelf ? 'You' : 'Become'}
              </Text>
            </Pressable>
          </View>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  introBlock: { gap: 6, paddingHorizontal: 16, paddingVertical: 14 },
  introTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
  introBody: { color: colors.secondary, fontSize: 13.5, lineHeight: 19 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12 },
  rowText: { gap: 2 },
  name: { color: colors.label, fontSize: 16, fontWeight: '700' },
  handle: { color: colors.secondary, fontSize: 13 },
  becomeButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  becomeButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  becomeText: { color: colors.label, fontSize: 12.5, fontWeight: '700' },
  becomeTextActive: { color: colors.white },
  separator: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginLeft: 72 },
});
