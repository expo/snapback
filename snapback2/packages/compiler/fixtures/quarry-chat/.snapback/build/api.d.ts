import type { Bytes, Decimal, Json, Money, Page, Principal } from 'snapback2';
import type { Channel, Op } from 'snapback2/client';

type ConversationsRow = {
  id: string;
  title: string;
  creatorId: Principal;
};
type FollowsRow = {
  id: string;
  follower: Principal;
  followed: Principal;
  at: number;
};
type MembershipsRow = {
  id: string;
  conversationId: string;
  principal: Principal;
  role: "member" | "admin";
  joinedAt: number;
};
type MessageCountsRow = {
  id: string;
  conversationId: string;
  value: number;
};
type MessagesRow = {
  id: string;
  conversationId: string;
  authorId: Principal;
  body: string;
  at: number;
};
type NotificationsRow = {
  id: string;
  outboxId: string;
  effect: string;
  providerId: string;
};
type PostsRow = {
  id: string;
  author: Principal;
  body: string;
  at: number;
};
type ProfilesRow = {
  id: string;
  principal: Principal;
  displayName: string;
  handle: string;
  avatarUrl?: string;
  bio: string;
  location: string;
  link?: string;
};

declare module 'snapback2/client' {
  interface Api {
    readonly feeds: {
      readonly followingFeed: Op<{}, any[]>;
      readonly globalFeed: Op<{}, any[]>;
    };
    readonly follows: {
      readonly setFollow: Op<{ target: Principal; following: boolean }, import("snapback2").RowOfColumns<{ readonly follower: import("snapback2").Column<import("snapback2").Principal, false>; readonly followed: import("snapback2").Column<import("snapback2").Principal, false>; readonly at: import("snapback2").Column<number, false>; }> | null>;
    };
    readonly groups: {
      readonly groupCreate: Op<{ title: string; members: Principal[] }, { id: string; creatorMembershipId: string; }>;
      readonly memberAdd: Op<{ conversationId: string; principal: Principal }, { id: string; }>;
      readonly memberLeave: Op<{ conversationId: string; membershipId: string }, null>;
      readonly memberPromote: Op<{ conversationId: string; membershipId: string }, null>;
      readonly memberRemove: Op<{ conversationId: string; membershipId: string }, null>;
    };
    readonly messages: {
      readonly send: Op<{ conversationId: string; recipientId: string; body: string }, { id: string; }>;
      readonly summary: Op<{ conversationId: string }, { conversation: ConversationsRow | null; messageCount: MessageCountsRow | null }>;
      readonly thread: Op<{ conversationId: string }, Page<MessagesRow>>;
    };
    readonly notifications: {
      readonly recordNotified: Op<{ outboxId: string; effect: string; result: any }, boolean>;
    };
    readonly posts: {
      readonly createPost: Op<{ body: string }, { id: string; author: import("snapback2").Principal; body: string; at: number; }>;
    };
    readonly profiles: {
      readonly byHandle: Op<{ handle: string }, ProfilesRow | null>;
      readonly createMyProfile: Op<{ displayName: string; handle: string; avatarUrl?: string | null; bio: string; location: string; link?: string | null }, { id: string; principal: string & { readonly __snapbackPrincipal: "Principal"; }; displayName: string; handle: string; avatarUrl: string | undefined; bio: string; location: string; link: string | undefined }>;
      readonly mine: Op<{}, ProfilesRow | null>;
      readonly updateMyProfile: Op<{ displayName: string; handle: string; avatarUrl?: string | null; bio: string; location: string; link?: string | null }, { id: string; principal: string & { readonly __snapbackPrincipal: "Principal"; }; displayName: string; handle: string; avatarUrl: string | undefined; bio: string; location: string; link: string | undefined }>;
    };
    readonly channels: { typing: Channel<{ conversationId: string }, unknown> };
    readonly typing: Channel<{ conversationId: string }, unknown>;
  }
}

export {};
