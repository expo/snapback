import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSnapbackMutation } from '@knockoff/snapback-react';
import { api } from '@/lib/snapback';
import { colors } from '@/theme/colors';

type PostId = NonNullable<typeof api.toggleLike.__args>['postId'];

export default function ComposeScreen() {
  const { replyToId, replyTo } = useLocalSearchParams<{ replyToId?: PostId; replyTo?: string }>();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const createPost = useSnapbackMutation(api.createPost);
  const submit = async () => { if (!body.trim() || sending) return; setSending(true); try { await createPost({ body, ...(replyToId ? { replyToId } : {}) }); if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); router.back(); } finally { setSending(false); } };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
    <Stack.Title>{replyTo ? 'Reply' : 'New post'}</Stack.Title>
    {replyTo ? <Text selectable style={{ color: colors.secondary }}>Replying to <Text style={{ color: colors.blue }}>@{replyTo}</Text></Text> : null}
    <TextInput accessibilityLabel="Post text" autoFocus multiline maxLength={280} value={body} onChangeText={setBody} placeholder="What’s happening?" placeholderTextColor={colors.secondary} style={{ minHeight: 150, color: colors.label, fontSize: 21, textAlignVertical: 'top' }} />
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text selectable style={{ color: body.length > 260 ? colors.pink : colors.secondary, fontVariant: ['tabular-nums'] }}>{280 - body.length}</Text><Pressable accessibilityRole="button" onPress={submit} disabled={!body.trim() || sending} style={{ backgroundColor: colors.blue, opacity: !body.trim() || sending ? .45 : 1, borderRadius: 22, paddingHorizontal: 22, paddingVertical: 11 }}><Text style={{ color: colors.white, fontWeight: '800' }}>{sending ? 'Posting…' : replyTo ? 'Reply' : 'Post'}</Text></Pressable></View>
  </ScrollView>;
}
