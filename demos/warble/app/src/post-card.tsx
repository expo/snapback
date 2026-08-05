import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  projectRecordFields,
  useSnapbackMutation,
} from '@expo/snapback-react';
import api from '@warble/generated-api';
import type { GeneratedDataModel } from '@warble/generated-api';

import { useWarbleTheme, type WarbleTheme } from './theme';

type Post = GeneratedDataModel['posts'];

type PostCardProps = Readonly<{
  post: Post;
  liked: boolean;
  likeId: string | null;
  likesReady: boolean;
  viewerHandle: string;
  onSelectAuthor: (handle: string) => void;
  /** The canonical query/args pair of the surface that rendered this card. */
  surface: Readonly<{ query: unknown; args: Readonly<Record<string, unknown>> }>;
}>;

function relativeTime(createdAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1_000));
  if (elapsedSeconds < 60) return 'now';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

function authorColor(handle: string, theme: WarbleTheme): string {
  if (handle === 'grace') return theme.isDark ? '#A995E8' : '#7157B7';
  if (handle === 'alan') return theme.isDark ? '#E0A660' : '#A86116';
  return theme.accent;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PostCard({
  post,
  liked,
  likeId,
  likesReady,
  viewerHandle,
  onSelectAuthor,
  surface,
}: PostCardProps) {
  const theme = useWarbleTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Project ONLY likeCount. `liked` is deliberately not a column on `posts` —
  // it lives in the separate retainable `myLikes` query, because a per-viewer
  // field would break the timeline's authorityIndependent retention opt-in.
  // Adding it here anyway makes the projected row violate the generated result
  // contract and the layer is refused with
  // SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED.
  //
  // The consequence is real and worth naming: the count moves instantly, but
  // the heart itself fills only when myLikes delivers, because flipping it
  // optimistically would mean appending a row to that query — an optimistic
  // create, which has no paved path in v1.
  //
  // Capture the outcome now; the projection replays over newer authoritative
  // bases, so it sets this value rather than incrementing whatever it receives.
  const intended = { likeCount: Math.max(0, post.likeCount + (liked ? -1 : 1)) };
  const toggle = useSnapbackMutation(liked ? api.unlikePost : api.likePost, {
    optimistic: {
      // The projection targets exactly one canonical store in v1: the surface
      // the user actually touched.
      query: surface.query as never,
      args: surface.args as never,
      ...projectRecordFields(post._id, intended),
    },
  });

  const disabled = toggling || !likesReady || (liked && likeId === null);

  const toggleLike = async () => {
    if (disabled) return;
    setToggling(true);
    setToggleError(null);
    try {
      if (liked) {
        await toggle({ postId: post._id, userHandle: viewerHandle, likeId: likeId! });
      } else {
        await toggle({ postId: post._id, userHandle: viewerHandle });
      }
    } catch (error) {
      setToggleError(message(error));
    } finally {
      setToggling(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.authorRow}>
        <View style={[styles.avatar, { backgroundColor: authorColor(post.authorHandle, theme) }]}>
          <Text style={styles.avatarText}>{post.authorName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Pressable
          accessibilityLabel={`Show posts by ${post.authorName}`}
          accessibilityRole="button"
          onPress={() => onSelectAuthor(post.authorHandle)}
          style={({ pressed }) => [styles.authorButton, pressed && styles.pressed]}
        >
          <View style={styles.authorLine}>
            <Text selectable numberOfLines={1} style={styles.authorName}>{post.authorName}</Text>
            <Text selectable style={styles.handle}>@{post.authorHandle}</Text>
            <Text style={styles.dot}>·</Text>
            <Text selectable style={styles.time}>{relativeTime(post.createdAt)}</Text>
          </View>
        </Pressable>
      </View>

      <Text selectable style={styles.body}>{post.body}</Text>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityLabel={liked ? `Unlike post with ${post.likeCount} likes` : `Like post with ${post.likeCount} likes`}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => void toggleLike()}
          style={({ pressed }) => [
            styles.likeButton,
            liked && styles.likeButtonActive,
            pressed && !disabled && styles.pressed,
            disabled && styles.disabled,
          ]}
        >
          <Text style={[styles.heart, liked && styles.heartActive]}>{liked ? '♥' : '♡'}</Text>
          <Text style={[styles.likeCount, liked && styles.likeCountActive]}>{post.likeCount}</Text>
        </Pressable>
        {toggleError ? <Text selectable style={styles.inlineError}>{toggleError}</Text> : null}
      </View>
    </View>
  );
}

function createStyles(theme: WarbleTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 20,
      borderWidth: 1,
      gap: 14,
      padding: 18,
    },
    authorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 11,
    },
    avatar: {
      alignItems: 'center',
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    avatarText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    authorButton: {
      flex: 1,
      minWidth: 0,
    },
    authorLine: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: 5,
    },
    authorName: {
      color: theme.text,
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    handle: {
      color: theme.muted,
      fontSize: 14,
    },
    dot: {
      color: theme.muted,
      fontSize: 14,
    },
    time: {
      color: theme.muted,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
    },
    body: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 23,
    },
    actionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 32,
    },
    likeButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: theme.surfaceMuted,
      borderRadius: 16,
      flexDirection: 'row',
      gap: 6,
      minHeight: 32,
      paddingHorizontal: 11,
    },
    likeButtonActive: {
      backgroundColor: theme.isDark ? '#352127' : '#FCE8EC',
    },
    heart: {
      color: theme.muted,
      fontSize: 18,
      lineHeight: 21,
    },
    heartActive: {
      color: theme.heart,
    },
    likeCount: {
      color: theme.muted,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
    },
    likeCountActive: {
      color: theme.heart,
    },
    inlineError: {
      color: theme.danger,
      flex: 1,
      fontSize: 12,
      lineHeight: 16,
    },
    pressed: {
      opacity: 0.68,
    },
    disabled: {
      opacity: 0.48,
    },
  });
}
