import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, VideoAsset } from 'snapback3';
import type { Channel, Op } from 'snapback3/client';

type ConnectedRow = {
  id: string;
  principal: Principal;
  value: number;
};
type ConversationsRow = {
  id: string;
  messageCount?: number | null;
  name: string;
  kind: string;
  owner: Principal;
};
type FollowsRow = {
  id: string;
  userId: Principal;
  targetId: Principal;
};
type LikesRow = {
  id: string;
  day?: number | null;
  userId: Principal;
  postId: string;
  authorId: Principal;
};
type MembersRow = {
  id: string;
  addedBy: Principal;
  conversationId: string;
  userId: Principal;
};
type MessagesRow = {
  id: string;
  type?: string | null;
  conversationId: string;
  senderId: Principal;
  text: string;
  serverTimestamp: number;
  replyTo?: string | null;
  edited: boolean;
  tombstone: boolean;
};
type PollTalliesRow = {
  id: string;
  conversationId: string;
  pollId: string;
  optionId: string;
  value: number;
};
type PollsRow = {
  id: string;
  messageId: string;
  conversationId: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC?: string | null;
  optionD?: string | null;
};
type PostsRow = {
  id: string;
  authorId: Principal;
  text: string;
  parentId?: string | null;
  parentAuthor?: Principal | null;
  serverTimestamp: number;
  day: number;
};
type ProfilesRow = {
  id: string;
  owner: Principal;
  displayName: string;
  handle: string;
  bio: string;
  location: string;
  link?: string | null;
};
type ReactionsRow = {
  id: string;
  messageId: string;
  conversationId: string;
  userId: Principal;
  emoji: string;
};
type ReadsRow = {
  id: string;
  conversationId: string;
  userId: Principal;
  viewedThrough?: number | null;
  fetchedThrough: number;
};
type RepostsRow = {
  id: string;
  userId: Principal;
  postId: string;
  authorId: Principal;
};
type VotesRow = {
  id: string;
  pollId: string;
  conversationId: string;
  userId: Principal;
  optionId: string;
};

declare module 'snapback3/client' {
  interface Api {
    readonly conversations: {
      readonly add: Op<{ conversationId: string; userId: Principal }, boolean, { members: "create" }>;
      readonly backfillCount: Op<{ conversationId: string }, ConversationsRow | null, { conversations: "update" }>;
      readonly create: Op<{ id: string; other: Principal; name: string; kind: string }, ConversationsRow | null, { conversations: "create"; members: "create" }>;
      readonly inbox: Op<{ c?: Cursor | null }, { id: string; name: string | null; kind: string | null }[]>;
      readonly settings: Op<{ conversationId: string }, ConversationsRow | null>;
      readonly unavailable: Op<{ conversationId: string }, { unread: number }>;
      readonly unread: Op<{ conversationId: string }, { viewedThrough: number | null; recent: Page<MessagesRow> }>;
    };
    readonly messages: {
      readonly fetched: Op<{ conversationId: string; through: number }, boolean, { reads: "create" | "update" }>;
      readonly latest: Op<{ conversationId: string }, Page<MessagesRow>>;
      readonly page: Op<{ conversationId: string; c?: Cursor | null }, Page<MessagesRow>>;
      readonly react: Op<{ messageId: string; emoji: string; active: boolean }, boolean, { reactions: "create" | "remove" | "update" }>;
      readonly reactions: Op<{ conversationId: string; messageId: string }, Page<ReactionsRow>>;
      readonly receipts: Op<{ conversationId: string }, Page<ReadsRow>>;
      readonly send: Op<{ id: string; conversationId: string; text: string; replyTo?: string | null }, MessagesRow | null, { conversations: "update"; messages: "create" }>;
      readonly setReaction: Op<{ messageId: string; emoji?: string | null }, boolean, { reactions: "create" | "remove" | "update" }>;
      readonly viewed: Op<{ conversationId: string; through: number }, boolean, { reads: "create" | "update" }>;
    };
    readonly polls: {
      readonly create: Op<{ id: string; conversationId: string; question: string; optionA: string; optionB: string; optionC?: string | null; optionD?: string | null }, MessagesRow | null, { conversations: "update"; messages: "create"; polls: "create" }>;
      readonly get: Op<{ conversationId: string; pollId: string }, { poll: PollsRow; mine: string | null; a: number; b: number; c: number; d: number }>;
      readonly vote: Op<{ pollId: string; optionId: string }, boolean, { votes: "create" | "update" }>;
    };
    readonly profiles: {
      readonly get: Op<{ handle: string }, ProfilesRow | null>;
      readonly mine: Op<{}, ProfilesRow | null>;
      readonly save: Op<{ displayName: string; handle: string; bio: string; location: string; link?: string | null }, ProfilesRow | null, { profiles: "create" | "update" }>;
    };
    readonly social: {
      readonly follow: Op<{ targetId: Principal }, boolean, { follows: "create" | "update" }>;
      readonly insights: Op<{ today: number }, { posts: number; likesReceived: number; repostsReceived: number; repliesReceived: number; followers: number; following: number; d0: number; d1: number; d2: number; d3: number; d4: number; d5: number; d6: number; l0: number; l1: number; l2: number; l3: number; l4: number; l5: number; l6: number }>;
      readonly likes: Op<{ postId: string; active: boolean }, boolean, { likes: "create" | "remove" | "update" }>;
      readonly post: Op<{ id: string; text: string; parentId?: string | null }, PostsRow | null, { posts: "create" }>;
      readonly reposts: Op<{ postId: string; active: boolean }, boolean, { reposts: "create" | "remove" | "update" }>;
    };
  }
}

export {};
