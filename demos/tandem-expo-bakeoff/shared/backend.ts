import type { ComponentType, PropsWithChildren } from 'react';

export type BackendKind = 'snapback' | 'convex';

export type QueryState<T> =
  | { status: 'loading'; data: T; connection: string; error: null }
  | { status: 'ready'; data: T; connection: string; error: null }
  | { status: 'error'; data: T; connection: string; error: string };

export type ConversationSummary = {
  id: string;
  name: string;
  isGroup: boolean;
  memberCount: number;
  memberNames: string[];
  avatarColor: string;
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
};

export type ConversationDetail = {
  id: string;
  name: string;
  isGroup: boolean;
  memberCount: number;
  memberNames: string[];
  avatarColor: string;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  createdAt: number;
  imageUrl?: string;
  replyTo?: {
    id: string;
    senderName: string;
    preview: string;
  };
  reactions: ReactionSummary[];
};

export type TypingPerson = {
  userId: string;
  name: string;
  color: string;
};

export type UploadState = {
  status: 'idle' | 'uploading' | 'error';
  progress: number;
  error: string | null;
};

export type SendMessageInput = {
  conversationId: string;
  senderId: string;
  text: string;
  replyToId?: string;
  imageRef?: string;
};

export type BackendHooks = {
  kind: BackendKind;
  label: string;
  Root: ComponentType<PropsWithChildren>;
  useInbox(viewerId: string): QueryState<ConversationSummary[]>;
  useConversation(conversationId: string, viewerId: string): QueryState<ConversationDetail | null>;
  useMessages(conversationId: string, viewerId: string): QueryState<ChatMessage[]>;
  useTyping(
    conversationId: string,
    viewer: { id: string; name: string; color: string },
    isTyping: boolean,
  ): QueryState<TypingPerson[]>;
  useSendMessage(): (input: SendMessageInput) => Promise<void>;
  useToggleReaction(): (input: {
    conversationId: string;
    messageId: string;
    userId: string;
    emoji: string;
  }) => Promise<void>;
  useImageUpload(): {
    state: UploadState;
    upload(input: { uri: string; mimeType: string; fileName: string }): Promise<string>;
  };
};

export const DEMO_VIEWER = {
  id: 'user_ada',
  name: 'Ada',
  color: '#7C5CFC',
} as const;
