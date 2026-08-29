import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { renderLinkifiedText } from './linkify';
import { palette, radii, spacing, typeScale } from './tokens';

export interface FeedCardProps {
  authorName: string;
  /** Stable author identity exposed on the avatar (usually the handle). */
  authorIdentity?: string;
  /** Handle without the leading @ (the kit renders the @). */
  authorHandle?: string;
  authorAvatarUri?: string;
  /** Pre-formatted display timestamp. */
  timestamp?: string;
  /** Post text body (≤500 chars per brief; the kit just renders). */
  text?: string;
  /** 1–4 image URIs (brief M2). A post never mixes images and video. */
  imageUris?: readonly string[];
  /** Video URI; renders `videoPosterUri` (or a placeholder) with a play glyph. */
  videoUri?: string;
  videoPosterUri?: string;
  /** "Reposted by {display name}" attribution line (brief M2). */
  repostedByName?: string;
  /** Stable identity of the reposting actor. */
  repostedByIdentity?: string;
  likeCount: number;
  /** Whether the viewer has liked this post. */
  liked: boolean;
  repostCount: number;
  /** Whether the viewer has reposted this post. */
  reposted: boolean;
  replyCount: number;
  /** Tap the card body → open the thread screen. */
  onPress?: () => void;
  /** Tap like/repost/reply. Toggle set-state intents are the lane's job. */
  onPressLike: () => void;
  onPressRepost: () => void;
  onPressReply: () => void;
  /** Tap the author name/avatar → their profile. */
  onPressAuthor?: () => void;
  /** Tap a detected http(s) link (no preview card renders — brief global ruling). */
  onPressLink?: (url: string) => void;
  /** Tap the media (open viewer / play). */
  onPressMedia?: () => void;
  /** Contract testID. Default `sm-feed-item`. */
  testID?: string;
}

function mediaBlock(props: FeedCardProps): React.JSX.Element | null {
  const { imageUris, videoUri, videoPosterUri, onPressMedia } = props;
  if (videoUri != null) {
    return (
      <Pressable
        accessibilityLabel="Video"
        accessibilityRole="imagebutton"
        accessibilityValue={{ text: 'video' }}
        onPress={onPressMedia}
        style={styles.media}
        testID="sm-feed-media"
        {...({ 'data-value': 'video', 'data-state': 'video', 'aria-valuetext': 'video' } as object)}
      >
        {videoPosterUri ? (
          <Image source={{ uri: videoPosterUri }} style={styles.video} />
        ) : (
          <View style={[styles.video, styles.videoPlaceholder]} />
        )}
        <View pointerEvents="none" style={styles.playOverlay}>
          <Text style={styles.playGlyph}>▶</Text>
        </View>
      </Pressable>
    );
  }
  if (imageUris && imageUris.length > 0) {
    const twoUp = imageUris.length > 1;
    return (
      <Pressable
        accessibilityLabel={`${imageUris.length} ${imageUris.length === 1 ? 'image' : 'images'}`}
        accessibilityRole="imagebutton"
        accessibilityValue={{ text: 'image' }}
        onPress={onPressMedia}
        style={[styles.media, styles.imageGrid]}
        testID="sm-feed-media"
        {...({ 'data-value': 'image', 'data-state': 'image', 'aria-valuetext': 'image' } as object)}
      >
        {imageUris.map((uri, i) => (
          typeof document !== 'undefined' ? (
            <img
              key={`${uri}-${i}`}
              src={uri}
              alt="post"
              style={{ width: twoUp ? '50%' : '100%', height: 220, objectFit: 'cover' }}
            />
          ) : (
          <Image
            key={`${uri}-${i}`}
            source={{ uri }}
            style={[styles.image, twoUp ? styles.imageHalf : styles.imageFull]}
          />
          )
        ))}
      </Pressable>
    );
  }
  return null;
}

interface ActionProps {
  glyph: string;
  label: string;
  count: number;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
  testID: string;
}

function Action({
  glyph,
  label,
  count,
  active = false,
  activeColor = palette.primary,
  onPress,
  testID,
}: ActionProps): React.JSX.Element {
  const color = active ? activeColor : palette.textMuted;
  if (typeof document !== 'undefined') {
    return (
      <button
        type="button"
        aria-label={`${label} (${count})`}
        aria-pressed={active}
        aria-selected={active}
        data-selected={active ? 'true' : 'false'}
        data-liked={active ? 'true' : 'false'}
        data-count={String(count)}
        data-testid={testID}
        onClick={(event) => {
          event.stopPropagation();
          onPress();
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color,
          display: 'flex',
          font: 'inherit',
          gap: 4,
          padding: 8,
        }}
      >
        <span>{glyph}</span>
        <span>{count > 0 ? String(count) : ''}</span>
      </button>
    );
  }
  return (
    <Pressable
      accessibilityLabel={`${label} (${count})`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityValue={{ text: String(count) }}
      dataSet={{ count: String(count), selected: active ? 'true' : 'false' }}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={styles.action}
      testID={testID}
      {...({ 'data-count': String(count), 'data-selected': active ? 'true' : 'false' } as object)}
    >
      <Text style={[styles.actionGlyph, { color }]}>{glyph}</Text>
      <Text style={[styles.actionCount, { color }]}>{count > 0 ? String(count) : ''}</Text>
    </Pressable>
  );
}

/**
 * One post in a feed or thread (brief M2): author row, optional repost
 * attribution, text with tappable links, 1–4 images or a video, and the
 * reply / repost / like action bar with counts.
 */
export function FeedCard(props: FeedCardProps): React.JSX.Element {
  const {
    authorName,
    authorIdentity,
    authorHandle,
    authorAvatarUri,
    timestamp,
    text,
    repostedByName,
    repostedByIdentity,
    likeCount,
    liked,
    repostCount,
    reposted,
    replyCount,
    onPress,
    onPressLike,
    onPressRepost,
    onPressReply,
    onPressAuthor,
    onPressLink,
    testID = 'sm-feed-item',
  } = props;

  return (
    <Pressable
      accessibilityLabel={`Post by ${authorName}`}
      onPress={onPress}
      style={styles.card}
      testID={testID}
    >
      {repostedByName ? (
        typeof document !== 'undefined' ? (
          <div
            data-testid="sm-feed-repost-attribution"
            data-value={repostedByIdentity}
            data-state={repostedByIdentity}
            aria-valuetext={repostedByIdentity}
            style={{ fontSize: 13, marginBottom: 4 }}
          >
            ↻ Reposted by {repostedByName}
          </div>
        ) : (
        <Text
          accessibilityValue={repostedByIdentity ? { text: repostedByIdentity } : undefined}
          style={styles.repostAttribution}
          testID="sm-feed-repost-attribution"
        >
          ↻ Reposted by {repostedByName}
        </Text>
        )
      ) : null}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={onPressAuthor} testID="sm-feed-author">
          <Avatar
            identity={authorIdentity ?? authorHandle}
            label={authorName}
            size={40}
            testID="sm-feed-author-avatar"
            {...(authorAvatarUri ? { uri: authorAvatarUri } : {})}
          />
        </Pressable>
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <Text numberOfLines={1} style={styles.author} onPress={onPressAuthor}>
              {authorName}
            </Text>
            {authorHandle ? (
              <Text numberOfLines={1} style={styles.handle}>
                @{authorHandle}
              </Text>
            ) : null}
            {timestamp ? <Text style={styles.timestamp}>· {timestamp}</Text> : null}
          </View>
          {text ? (
            <Text style={styles.text}>{renderLinkifiedText(text, onPressLink)}</Text>
          ) : null}
          {mediaBlock(props)}
          <View style={styles.actions}>
            <Action
              count={replyCount}
              glyph="◗"
              label="Reply"
              onPress={onPressReply}
              testID="sm-post-reply"
            />
            <Action
              active={reposted}
              activeColor={palette.success}
              count={repostCount}
              glyph="↻"
              label={reposted ? 'Undo repost' : 'Repost'}
              onPress={onPressRepost}
              testID="sm-post-repost"
            />
            <Action
              active={liked}
              activeColor={palette.danger}
              count={likeCount}
              glyph={liked ? '♥' : '♡'}
              label={liked ? 'Unlike' : 'Like'}
              onPress={onPressLike}
              testID="sm-post-like"
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.background,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  repostAttribution: {
    ...typeScale.footnote,
    color: palette.textMuted,
    marginBottom: spacing.xs,
    marginLeft: 48,
  },
  row: {
    flexDirection: 'row',
  },
  body: {
    flex: 1,
    marginLeft: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: spacing.xs,
  },
  author: {
    ...typeScale.headline,
    color: palette.text,
  },
  handle: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  timestamp: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
  text: {
    ...typeScale.body,
    color: palette.text,
    marginTop: 2,
  },
  media: {
    marginTop: spacing.sm,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  image: {
    backgroundColor: palette.surfaceStrong,
  },
  imageFull: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  imageHalf: {
    flexBasis: '49%',
    flexGrow: 1,
    aspectRatio: 1,
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: palette.surfaceStrong,
  },
  videoPlaceholder: {
    backgroundColor: '#2B2F36',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    color: palette.textInverse,
    fontSize: 32,
    textShadowColor: palette.overlay,
    textShadowRadius: 8,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    columnGap: spacing.xxl,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
  },
  actionGlyph: {
    fontSize: 16,
  },
  actionCount: {
    ...typeScale.footnote,
  },
});
