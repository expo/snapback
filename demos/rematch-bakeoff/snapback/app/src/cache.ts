// App-level offline history cache.
//
// Why this exists: the published Snapback packages (0.1.10) refuse the
// experimental `single_table_v1` capability that `authorityIndependent`
// live queries need for framework-native cold retention ("public packages
// remain structured GAPs" per the capability index). So the app persists its
// own last-known query snapshots and renders them read-only when the backend
// is unreachable at cold start.

const KEY = 'rematch.offline.v1';

type CacheShape = {
  savedAt: number;
  users: any[];
  conversations: any[];
  membersByConversation: Record<string, any[]>;
  messagesByConversation: Record<string, any[]>;
  reactionsByConversation: Record<string, any[]>;
};

function storage(): Storage | null {
  try {
    const candidate = (globalThis as any).localStorage;
    if (candidate && typeof candidate.getItem === 'function') return candidate;
  } catch {}
  return null;
}

export function readCache(): CacheShape | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    return raw ? (JSON.parse(raw) as CacheShape) : null;
  } catch {
    return null;
  }
}

function writeCache(update: (cache: CacheShape) => void) {
  const store = storage();
  if (!store) return;
  const cache: CacheShape = readCache() ?? {
    savedAt: 0,
    users: [],
    conversations: [],
    membersByConversation: {},
    messagesByConversation: {},
    reactionsByConversation: {},
  };
  update(cache);
  cache.savedAt = Date.now();
  try {
    store.setItem(KEY, JSON.stringify(cache));
  } catch {}
}

export function cacheDirectory(users: any[], conversations: any[]) {
  writeCache((cache) => {
    cache.users = users;
    cache.conversations = conversations;
  });
}

export function cacheConversation(
  conversationId: string,
  members: any[],
  messages: any[],
  reactions: any[],
) {
  writeCache((cache) => {
    cache.membersByConversation[conversationId] = members;
    cache.messagesByConversation[conversationId] = messages;
    cache.reactionsByConversation[conversationId] = reactions;
  });
}
