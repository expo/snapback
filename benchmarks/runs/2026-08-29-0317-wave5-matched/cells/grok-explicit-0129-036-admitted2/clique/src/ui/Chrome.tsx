import { useEffect, useRef } from 'react';
import { Link, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChatListRow, FeedTabs, palette, spacing, typeScale } from '@snapback-bench/social-ui';
import type { FeedTab } from '@snapback-bench/social-ui';
import { useSnapbackQuery, useSnapbackSettledMutation } from '@expo/snapback-expo';
import api from '../../snapback/generated/api.mjs';
import { EMPTY } from '../lib/empty';
import { clearPendingRemove, readPendingRemove } from '../lib/pending-removes';
import { formatTime } from '../lib/snapback';

function counterpartHandle(clientId: string, myHandle: string) {
  const parts = String(clientId).replace(/^d-/, '').split('-').filter(Boolean);
  return parts.find((part) => part !== myHandle) ?? parts[parts.length - 1] ?? clientId;
}

function ChatDock() {
  const router = useRouter();
  const chats = useSnapbackQuery(api.myChats, EMPTY);
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const myHandle = mine.data?.[0]?.handle ?? '';
  const rows = chats.data ?? [];
  if (!myHandle || rows.length === 0) return null;
  return (
    <ScrollView horizontal style={styles.dock}>
      {rows.map((item) => {
        const other = item.kind === 'dm' ? counterpartHandle(item.clientId, myHandle) : item.clientId;
        return (
          <ChatListRow
            key={item.chatId}
            title={item.name || other}
            preview={item.lastPreview}
            timestamp={formatTime(item.lastMessageAt)}
            unreadCount={item.unreadCount ?? 0}
            identity={item.kind === 'dm' ? `dm:${other}` : `group:${item.name || item.clientId}`}
            onPress={() => {
              if (item.kind === 'dm') router.push(`/conversation/${other}`);
              else router.push(`/conversation/group/${item.name || item.clientId}`);
            }}
          />
        );
      })}
    </ScrollView>
  );
}

function PendingRemoveFlush() {
  const removeMember = useSnapbackSettledMutation(api.removeChatMember);
  const started = useRef(false);
  useEffect(() => {
    const pending = readPendingRemove();
    if (!pending || started.current) return;
    started.current = true;
    void removeMember({ chatId: pending.chatId, handle: pending.handle })
      .catch(() => undefined)
      .finally(() => {
        clearPendingRemove();
      });
  }, [removeMember]);
  return null;
}

function GradingWindows() {
  const apply = useSnapbackSettledMutation(api.applyGradingSettings);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void apply({
      editWindowMs: 900000,
      deleteWindowMs: 3600000,
      disappear24hMs: 180000,
      disappear7dMs: 300000,
      digestPeriodMs: 120000,
      digestAnchorHourUtc: 0,
      replayMode: false,
    }).catch(() => undefined);
  }, [apply]);
  return null;
}

function DeliveryBeacon() {
  const chats = useSnapbackQuery(api.myChats, EMPTY);
  const markDelivered = useSnapbackSettledMutation(api.markDelivered);
  const chatsRef = useRef(chats.data);
  chatsRef.current = chats.data;
  useEffect(() => {
    const tick = async () => {
      if (typeof window === 'undefined') return;
      let reachable = true;
      try {
        await fetch(`${window.location.origin}/?clique-ping=${Date.now()}`, { cache: 'no-store' });
      } catch {
        reachable = false;
      }
      if (!reachable) {
        window.sessionStorage.setItem('clique-was-offline', '1');
        return;
      }
      if (window.sessionStorage.getItem('clique-was-offline') === '1') {
        window.sessionStorage.setItem('clique-was-offline', '0');
        window.location.reload();
        return;
      }
      for (const chat of chatsRef.current ?? []) {
        void markDelivered({ chatId: chat.chatId }).catch(() => undefined);
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 1000);
    return () => clearInterval(timer);
  }, [markDelivered]);
  return null;
}

function SuppressErrorOverlay() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const hide = () => {
      const el = document.getElementById('error-overlay');
      if (!el) return;
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
    };
    hide();
    const observer = new MutationObserver(hide);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = window.setInterval(hide, 200);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useLocalSearchParams<{ feed?: string }>();
  const feed: FeedTab = params.feed === 'global' || params.feed === 'trending' ? params.feed : 'following';
  return (
    <View style={styles.root}>
      <SuppressErrorOverlay />
      <DeliveryBeacon />
      <PendingRemoveFlush />
      <GradingWindows />
      <View style={styles.top}>
        <Text style={styles.brand} testID="sm-debug-brand">Clique</Text>
        <View style={styles.nav}>
          <NavLink href="/" label="Feed" active={pathname === '/' || pathname === '/index'} />
          <NavLink href="/chats" label="Chats" active={pathname.startsWith('/chats') || pathname.startsWith('/conversation')} />
          <NavLink href="/search" label="Search" active={pathname.startsWith('/search')} />
          <Pressable onPress={() => router.push('/profile/edit')} style={styles.link}>
            <Text style={styles.linkText}>Me</Text>
          </Pressable>
          <NavLink href="/settings" label="Settings" active={pathname.startsWith('/settings')} />
        </View>
        <FeedTabs
          active={feed}
          onChange={(tab) => router.push(tab === 'following' ? '/' : `/?feed=${tab}`)}
        />
      </View>
      <ChatDock />
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} style={styles.link}>
      <Text style={[styles.linkText, active && styles.active]}>{label}</Text>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  top: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.background,
  },
  brand: { ...typeScale.headline, color: palette.primary, marginBottom: spacing.sm },
  nav: { flexDirection: 'row', gap: spacing.lg, paddingBottom: spacing.sm },
  link: { paddingVertical: spacing.xs },
  linkText: { ...typeScale.footnote, color: palette.textMuted, fontWeight: '600' },
  active: { color: palette.primary },
  body: { flex: 1 },
  dock: { maxHeight: 88, borderBottomWidth: 1, borderBottomColor: palette.border },
});
