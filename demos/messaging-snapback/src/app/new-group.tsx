import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/avatar';
import { api } from '@/lib/snapback';
import { PERSONAS, useIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';

export default function NewGroupScreen() {
  const { client, self } = useIdentity();
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const others = PERSONAS.filter((p) => p.handle !== self.handle);

  function toggle(handle: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle); else next.add(handle);
      return next;
    });
  }

  async function submit() {
    if (!title.trim() || picked.size === 0 || creating) return;
    setCreating(true);
    try {
      const created = await client.mutate(api.createGroup, {
        userId: self.handle,
        queue: false,
        args: {
          title,
          creatorHandle: self.handle,
          creatorName: self.name,
          memberHandles: Array.from(picked),
        },
      });
      if (created.status !== 'settled') throw new Error('group bootstrap unexpectedly queued');
      router.replace({ pathname: '/conversation/[id]', params: { id: created.result } });
    } finally {
      setCreating(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
      <TextInput
        accessibilityLabel="Group name"
        autoFocus
        value={title}
        onChangeText={setTitle}
        placeholder="Group name"
        placeholderTextColor={colors.secondary}
        style={{ borderBottomColor: colors.border, borderBottomWidth: 1, color: colors.label, fontSize: 22, paddingVertical: 8 }}
      />
      <Text style={{ color: colors.secondary, fontSize: 13, fontWeight: '700' }}>ADD MEMBERS</Text>
      <View style={{ gap: 2 }}>
        {others.map((person) => {
          const isPicked = picked.has(person.handle);
          return (
            <Pressable
              key={person.handle}
              onPress={() => toggle(person.handle)}
              style={{
                alignItems: 'center',
                borderRadius: 12,
                flexDirection: 'row',
                gap: 12,
                paddingHorizontal: 8,
                paddingVertical: 8,
                backgroundColor: isPicked ? colors.accentSoft : 'transparent',
              }}
            >
              <Avatar handle={person.handle} size={36} />
              <Text style={{ color: colors.label, flex: 1, fontSize: 15.5 }}>{person.name}</Text>
              <Text style={{ color: isPicked ? colors.accent : colors.faint, fontSize: 18 }}>
                {isPicked ? '✓' : '○'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!title.trim() || picked.size === 0 || creating}
        onPress={submit}
        style={{
          alignItems: 'center',
          backgroundColor: colors.accent,
          borderRadius: 14,
          opacity: !title.trim() || picked.size === 0 || creating ? 0.45 : 1,
          paddingVertical: 13,
        }}
      >
        <Text style={{ color: colors.white, fontSize: 16, fontWeight: '800' }}>
          {creating ? 'Creating…' : 'Create group'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
