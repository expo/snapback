import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';

import {
  ChatListRow,
  ChatSettingsForm,
  FeedCard,
  FeedTabs,
  MessageBubble,
  ProfileForm,
  ReceiptTicks,
} from '../index';

const IMAGE_ONE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%235B5CE2"/%3E%3C/svg%3E';
const IMAGE_TWO =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%2317A673"/%3E%3C/svg%3E';
const VIDEO_URI = 'https://example.invalid/video.mp4';

function Consumer(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'following' | 'global' | 'trending'>('following');
  const [following, setFollowing] = useState(true);
  const [accent, setAccent] = useState('#5B5CE2');
  const [background, setBackground] = useState(IMAGE_ONE);
  const [viewOnceOpened, setViewOnceOpened] = useState(false);

  return (
    <View>
      <FeedTabs active={activeTab} onChange={setActiveTab} />
      <ProfileForm
        bio="Profile used by the RN Web consumer proof"
        displayName="Alice Alvarez"
        followerCount={2}
        following={following}
        followingCount={3}
        handle="alice"
        mode="view-other"
        onPressFollow={() => setFollowing((value) => !value)}
      />
      <FeedCard
        authorAvatarUri={IMAGE_ONE}
        authorIdentity="alice"
        authorName="Alice Alvarez"
        imageUris={[IMAGE_ONE]}
        likeCount={1}
        liked
        onPressLike={() => {}}
        onPressReply={() => {}}
        onPressRepost={() => {}}
        replyCount={0}
        repostCount={1}
        reposted
        repostedByIdentity="carol"
        repostedByName="Carol Chen"
        text="M2 semantic feed card"
      />
      <FeedCard
        authorIdentity="bob"
        authorName="Bob Brown"
        likeCount={0}
        liked={false}
        onPressLike={() => {}}
        onPressReply={() => {}}
        onPressRepost={() => {}}
        replyCount={0}
        repostCount={0}
        reposted={false}
        text="Video poster"
        videoPosterUri={IMAGE_TWO}
        videoUri={VIDEO_URI}
      />
      <ChatListRow identity="dm:bob" onPress={() => {}} title="Bob Brown" />
      <ReceiptTicks state="read" />
      <ChatSettingsForm
        accentColors={[
          { name: 'indigo', value: '#5B5CE2' },
          { name: 'emerald', value: '#17A673' },
        ]}
        backgroundUri={background}
        canEdit
        disappearing="24h"
        isGroup={false}
        onPressBackground={() => setBackground((value) => value === IMAGE_ONE ? IMAGE_TWO : IMAGE_ONE)}
        onSelectAccentColor={(value) => setAccent(value.value)}
        onSelectDisappearing={() => {}}
        selectedAccentColor={accent}
      />
      <MessageBubble
        isMine={false}
        onPressMedia={() => setViewOnceOpened(true)}
        text="M5 view once"
        viewOnce
        viewOnceOpened={viewOnceOpened}
      />
    </View>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('RN Web consumer fixture is missing #root');
createRoot(root).render(<Consumer />);
