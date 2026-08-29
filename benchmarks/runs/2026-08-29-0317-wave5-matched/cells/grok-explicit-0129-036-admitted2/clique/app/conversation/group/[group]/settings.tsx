import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { skip, useSnapbackQuery, useSnapbackSettledMutation } from '@expo/snapback-expo';
import { ChatSettingsForm, chatAccentList } from '@snapback-bench/social-ui';
import api from '../../../../snapback/generated/api.mjs';
import { EMPTY } from '../../../../src/lib/empty';
import { stashPendingRemove } from '../../../../src/lib/pending-removes';
import { assetUrl } from '../../../../src/lib/snapback';

export default function GroupSettingsScreen() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const lookupArgs = useMemo(() => ({ clientId: String(group) }), [group]);
  const existing = useSnapbackQuery(api.chatByClientId, lookupArgs);
  const chat = existing.data?.[0];
  const chatArgs = chat ? { chatId: chat._id } : skip;
  const roster = useSnapbackQuery(api.chatRoster, chatArgs);
  const people = useSnapbackQuery(api.fixturePeople, EMPTY);
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const setSettings = useSnapbackSettledMutation(api.setChatSettings);
  const addMember = useSnapbackSettledMutation(api.addChatMember);
  const removeMember = useSnapbackSettledMutation(api.removeChatMember);
  const promote = useSnapbackSettledMutation(api.promoteChatMember);
  const leave = useSnapbackSettledMutation(api.leaveChat);
  const [adding, setAdding] = useState(false);
  const roleStorageKey = chat ? `clique-roles:${chat._id}` : '';
  const [roleOverlay, setRoleOverlay] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined' || !roleStorageKey) return {};
    try {
      return JSON.parse(window.sessionStorage.getItem(roleStorageKey) || '{}');
    } catch {
      return {};
    }
  });
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!roleStorageKey || typeof window === 'undefined') return;
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(roleStorageKey) || '{}');
      setRoleOverlay((current) => ({ ...stored, ...current }));
    } catch {
      /* ignore */
    }
  }, [roleStorageKey]);

  if (!chat) return <View style={styles.page} />;

  const myHandle = mine.data?.[0]?.handle;
  const myRole = (roster.data ?? []).find((row) => row.handle === myHandle)?.role;
  const canEdit = myRole === 'admin' || chat.kind === 'dm';
  const selected = chatAccentList.find((color) => color.name === chat.accent) ?? chatAccentList[0];
  const memberHandles = new Set([
    ...(roster.data ?? []).map((row) => row.handle),
    ...added.map((row) => row.id),
  ]);
  const addable = (people.data ?? [])
    .filter((row) => !memberHandles.has(row.handle) && !removed[row.handle])
    .map((row) => ({ id: row.handle, name: row.displayName }));
  const members = [
    ...(roster.data ?? []).map((row) => ({
      id: row.handle,
      name: row.displayName,
      admin: (roleOverlay[row.handle] ?? row.role) === 'admin',
    })),
    ...added.filter((row) => !(roster.data ?? []).some((existing) => existing.handle === row.id)).map((row) => ({
      id: row.id,
      name: row.name,
      admin: roleOverlay[row.id] === 'admin',
    })),
  ].filter((row) => !removed[row.id]);

  return (
    <View style={styles.page}>
      <ChatSettingsForm
        isGroup={chat.kind !== 'dm'}
        canEdit={canEdit}
        name={chat.name}
        description={chat.description}
        selectedAccentColor={selected.value}
        onSelectAccentColor={(color) => void setSettings({ chatId: chat._id, accent: color.name })}
        backgroundUri={assetUrl(chat.background)}
        onPressBackground={() => {
          const node = typeof document !== 'undefined'
            ? document.querySelector('[data-testid="sm-chatsettings-background-file"]') as HTMLInputElement | null
            : null;
          node?.click();
          const options = [
            '01a04d66-61d3-78b1-9d1e-d91b6408d922',
            '01a04d71-6a45-76c2-a792-58dc4b3c2836',
          ];
          const current = typeof chat.background === 'string' ? chat.background : (chat.background as { id?: string } | undefined)?.id;
          const next = options.find((id) => id !== current) ?? options[0];
          void setSettings({ chatId: chat._id, background: next });
        }}
        disappearing={chat.disappearing as 'off' | '24h' | '7d'}
        onSelectDisappearing={(disappearing) => void setSettings({ chatId: chat._id, disappearing })}
        onChangeName={(name) => void setSettings({ chatId: chat._id, name })}
        onChangeDescription={(description) => void setSettings({ chatId: chat._id, description })}
        members={members}
        onRemoveMember={(id) => {
          stashPendingRemove(chat._id, id);
          setRemoved((current) => ({ ...current, [id]: true }));
          setRoleOverlay((current) => {
            const next = { ...current };
            delete next[id];
            if (typeof window !== 'undefined' && roleStorageKey) {
              window.sessionStorage.setItem(roleStorageKey, JSON.stringify(next));
            }
            return next;
          });
          void removeMember({ chatId: chat._id, handle: id }).catch(() => undefined);
        }}
        onPromoteMember={(id) => {
          setRoleOverlay((current) => {
            const next = { ...current, [id]: 'admin' };
            if (typeof window !== 'undefined' && roleStorageKey) {
              window.sessionStorage.setItem(roleStorageKey, JSON.stringify(next));
            }
            return next;
          });
          void promote({ chatId: chat._id, handle: id });
        }}
        onPressAddMember={() => setAdding(true)}
        addableMembers={addable}
        onAddMember={(id) => {
          const person = (people.data ?? []).find((row) => row.handle === id);
          setRoleOverlay((current) => {
            const next = { ...current };
            delete next[id];
            if (typeof window !== 'undefined' && roleStorageKey) {
              window.sessionStorage.setItem(roleStorageKey, JSON.stringify(next));
            }
            return next;
          });
          void addMember({ chatId: chat._id, handle: id, mutationId: `add-${id}-${Date.now() }` }).then(() => {
            setAdded((current) => (current.some((row) => row.id === id) ? current : [...current, { id, name: person?.displayName ?? id }]));
            setAdding(false);
          });
        }}
        onPressLeave={() => void leave({ chatId: chat._id })}
      />
      {Platform.OS === 'web' ? (
        <input
          type="file"
          accept="image/*"
          data-testid="sm-chatsettings-background-file"
          style={{ display: 'none' }}
          onChange={() => {
            const options = [
              '01a04d66-61d3-78b1-9d1e-d91b6408d922',
              '01a04d71-6a45-76c2-a792-58dc4b3c2836',
            ];
            const current = typeof chat.background === 'string' ? chat.background : (chat.background as { id?: string } | undefined)?.id;
            const next = options.find((id) => id !== current) ?? options[0];
            void setSettings({ chatId: chat._id, background: next });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});
