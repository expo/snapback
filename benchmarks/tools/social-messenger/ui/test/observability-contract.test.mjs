import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (name) => readFile(new URL(`../src/${name}.tsx`, import.meta.url), 'utf8');

test('0.3.3 exposes native and web semantic actor, receipt, media, membership, profile, and poll state', async () => {
  const [avatar, chatRow, composer, feed, message, receipt, settings, profile, poll] = await Promise.all([
    source('Avatar'),
    source('ChatListRow'),
    source('Composer'),
    source('FeedCard'),
    source('MessageBubble'),
    source('ReceiptTicks'),
    source('ChatSettingsForm'),
    source('ProfileForm'),
    source('PollDisplay'),
  ]);
  assert.match(avatar, /accessibilityValue:\s*\{ text: identity \}/u);
  assert.match(avatar, /'aria-valuetext': identity/u);
  assert.match(chatRow, /accessibilityValue=\{\{ text: identity \}\}/u);
  assert.match(feed, /testID="sm-feed-author-avatar"/u);
  assert.match(feed, /accessibilityValue=\{\{ text: 'video' \}\}/u);
  assert.match(feed, /accessibilityValue=\{\{ text: 'image' \}\}/u);
  assert.match(feed, /aria-valuetext="video"/u);
  assert.match(feed, /aria-valuetext="image"/u);
  assert.match(feed, /aria-pressed=\{active\}/u);
  assert.match(feed, /webSourceUriProps\(videoPosterUri\)/u);
  assert.match(feed, /accessibilityValue=\{repostedByIdentity \? \{ text: repostedByIdentity \} : undefined\}/u);
  assert.match(message, /testID="sm-convo-sender-avatar"/u);
  assert.match(message, /!isMine && showSender/u);
  assert.match(message, /accessibilityValue=\{\{ text: viewOnceOpened \? 'opened' : 'unopened' \}\}/u);
  assert.match(message, /aria-valuetext=\{viewOnceOpened \? 'opened' : 'unopened'\}/u);
  assert.match(message, /webSourceUriProps\(mediaUri\)/u);
  assert.match(composer, /testID="sm-compose-attachment"/u);
  assert.match(composer, /accessibilityValue=\{\{ text: att\.kind \}\}/u);
  assert.match(composer, /posterUri: string/u);
  assert.match(composer, /att\.kind === 'video' \? att\.posterUri : att\.uri/u);
  assert.doesNotMatch(composer, /source=\{\{ uri: att\.uri \}\}/u);
  assert.match(composer, /variant === 'post' \? 'sm-compose-attach' : 'sm-convo-attach'/u);
  assert.doesNotMatch(composer, /testID="sm-compose-file"/u);
  assert.match(receipt, /accessibilityValue=\{\{ text: label \}\}/u);
  assert.match(receipt, /aria-valuetext=\{label\}/u);
  for (const id of [
    'sm-chatsettings-member',
    'sm-chatsettings-member-candidate',
    'sm-chatsettings-member-promote',
    'sm-chatsettings-member-remove',
    'sm-chatsettings-leave',
  ]) assert.match(settings, new RegExp(`testID="${id}"`, 'u'));
  assert.match(profile, /testID="sm-profile-heading"/u);
  assert.match(profile, /testID="sm-profile-nav-feed"/u);
  assert.match(profile, /aria-pressed=\{props\.following\}/u);
  assert.match(poll, /accessibilityValue=\{\{ text: option\.id \}\}/u);
  assert.match(poll, /busy: !!option\.pending/u);
  assert.match(poll, /aria-selected=\{!!option\.mine\}/u);
});
