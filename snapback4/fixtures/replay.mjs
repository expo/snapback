import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtureRoot, parseAction } from './grammar.mjs';

export const tables = ['users', 'profiles', 'follows', 'posts', 'likes', 'reposts', 'replies',
  'reactions', 'conversations', 'memberships', 'messages'];
export const logs = { scale: ['scale.log'], starter: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'], sample: ['sample-50.log'] };
const mediaSizes = new Map();
const memberKey = (conversationId, userId) => `${conversationId}:${userId}`;
const require = (ok, message) => { if (!ok) throw new Error(message); };

export class State {
  constructor(limit = Infinity) {
    for (const table of tables) this[table] = new Map();
    this.limit = limit;
    this.registrations = new Set();
    this.receipts = new Map();
    this.dmPairs = new Map();
    this.aliases = new Map();
  }
  post(id) { return this.posts.get(id) ?? this.replies.get(id); }
  media(path) {
    if (!mediaSizes.has(path)) mediaSizes.set(path, statSync(new URL(path, fixtureRoot)).size);
    return { path, byteSize: mediaSizes.get(path) };
  }
  apply({ actorId, verb, at, args: a }, filtered = false) {
    if (verb === 'register') this.registrations.add(actorId);
    if (filtered && (verb === 'register' ? this.registrations.size > this.limit : !this.users.has(actorId))) return;
    const conversationId = this.aliases.get(a.conversationId) ?? a.conversationId;
    const refs = [];
    if (verb !== 'register') refs.push([this.users.has(actorId), `user ${actorId}`]);
    for (const key of ['targetUserId', 'otherUserId', 'secondMemberUserId', 'memberUserId']) {
      if (a[key]) refs.push([this.users.has(a[key]), `user ${a[key]}`]);
    }
    if (['like', 'repost', 'reply'].includes(verb)) {
      const id = a.parentPostId ?? a.postId;
      refs.push([this.post(id), `post ${id}`]);
    }
    if (['member-add', 'send', 'send-media'].includes(verb)) refs.push([this.conversations.has(conversationId), `conversation ${conversationId}`]);
    if (a.quote) refs.push([this.messages.has(a.quote), `quote ${a.quote}`]);
    if (verb === 'react') refs.push([this.messages.has(a.messageId), `message ${a.messageId}`]);
    for (const [exists, label] of refs) {
      if (!exists && filtered) return;
      require(exists, `missing ${label}`);
    }
    // Explicit create and mutation IDs are retry keys; timestamp is documentary.
    const createId = ({ register: actorId, post: a.postId, reply: a.replyId,
      'dm-create': a.conversationId, 'group-create': a.conversationId, send: a.messageId,
      'send-media': a.messageId })[verb];
    const receiptKey = a.mutationId ? `mutation:${actorId}:${a.mutationId}` : createId ? `create:${verb}:${createId}` : null;
    if (receiptKey) {
      const signature = JSON.stringify([actorId, verb, a]);
      if (this.receipts.has(receiptKey)) {
        require(this.receipts.get(receiptKey) === signature, `conflicting retry ${receiptKey}`);
        return;
      }
      this.receipts.set(receiptKey, signature);
    }
    const edge = (table, targetField, targetId, clear, extra = {}) => {
      const key = `${actorId}:${targetId}`;
      if (clear) this[table].delete(key);
      else if (!this[table].has(key) || verb === 'react') this[table].set(key,
        { id: a.mutationId, userId: actorId, [targetField]: targetId, ...extra, at });
    };
    const membership = (id, userId, role) => {
      const key = memberKey(conversationId, userId);
      if (!this.memberships.has(key)) this.memberships.set(key, { id, conversationId, userId, role, at });
    };
    switch (verb) {
      case 'register': this.users.set(actorId, { id: actorId, email: a.email, at }); break;
      case 'profile-set': this.profiles.set(actorId, { id: actorId, ...a, at }); break;
      case 'follow': edge('follows', 'targetUserId', a.targetUserId, a.state === 'clear'); break;
      case 'like': case 'repost': edge(`${verb}s`, 'postId', a.postId, a.state === 'clear'); break;
      case 'post': case 'reply': {
        const id = a.postId ?? a.replyId;
        require(!this.post(id), `duplicate post ${id}`);
        this[verb === 'post' ? 'posts' : 'replies'].set(id, { id, authorId: actorId,
          postType: a.postType ?? 'reply', text: a.text, media: (a.images ?? a.video)?.split(',') ?? [],
          parentPostId: a.parentPostId ?? null, at });
        break;
      }
      case 'dm-create': case 'group-create': {
        const dm = verb === 'dm-create';
        const other = a.otherUserId ?? a.secondMemberUserId;
        require(other !== actorId, 'conversation requires two distinct members');
        const pair = [actorId, other].sort().join(':');
        if (dm && this.dmPairs.has(pair)) {
          require(!this.conversations.has(a.conversationId) || this.dmPairs.get(pair) === a.conversationId, 'DM id collision');
          this.aliases.set(a.conversationId, this.dmPairs.get(pair));
          break;
        }
        require(!this.conversations.has(conversationId), `duplicate conversation ${conversationId}`);
        this.conversations.set(conversationId, { id: conversationId, kind: dm ? 'dm' : 'group',
          creatorId: actorId, name: a.name ?? null, description: a.description ?? null, at });
        if (dm) this.dmPairs.set(pair, conversationId);
        membership(memberKey(conversationId, actorId), actorId, dm ? 'member' : 'admin');
        membership(memberKey(conversationId, other), other, 'member');
        break;
      }
      case 'member-add':
        require(this.conversations.get(conversationId).kind === 'group' &&
          this.memberships.get(memberKey(conversationId, actorId))?.role === 'admin', 'member-add requires group admin');
        membership(a.mutationId, a.memberUserId, 'member');
        break;
      case 'send': case 'send-media': {
        require(this.memberships.has(memberKey(conversationId, actorId)), 'send requires membership');
        require(!a.quote || this.messages.get(a.quote).conversationId === conversationId, 'quote must be in the same conversation');
        require(!this.messages.has(a.messageId), `duplicate message ${a.messageId}`);
        this.messages.set(a.messageId, { id: a.messageId, conversationId, senderId: actorId,
          messageType: a.mediaType ?? 'text', text: a.text ?? null, media: a.media ? this.media(a.media) : null,
          caption: a.caption ?? null, viewOnce: a.mode === 'view-once', quoteId: a.quote ?? null, at });
        break;
      }
      case 'react': {
        const message = this.messages.get(a.messageId);
        require(this.memberships.has(memberKey(message.conversationId, actorId)), 'react requires membership');
        edge('reactions', 'messageId', a.messageId, a.emojiOrNone === 'none', { emoji: a.emojiOrNone });
        break;
      }
      default: throw new Error(`unimplemented verb ${verb}`);
    }
  }
}

// @ref LLP 3000#3-the-bakeoff-protocol — replay the frozen fixture, never regenerate it.
export function replayFiles(names, { state = new State(), scale = Infinity, checkpoint = () => {} } = {}) {
  const selected = scale === Infinity ? state : new State(scale);
  const artifacts = {};
  for (const name of names) {
    const bytes = readFileSync(new URL(name, fixtureRoot));
    const content = bytes.toString('utf8');
    const lines = content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const hash = createHash('sha256');
    const facts = { name, committed: true, byteCount: bytes.length, lineCount: lines.length,
      actionCount: 0, checkpointMarkerCount: 0, checkpointLineNumbers: {} };
    for (const [index, line] of lines.entries()) {
      hash.update(line + (index < lines.length - 1 || content.endsWith('\n') ? '\n' : ''));
      try {
        const action = parseAction(line);
        if (action.checkpoint) {
          facts.checkpointMarkerCount++;
          require(!Object.hasOwn(facts.checkpointLineNumbers, action.checkpoint), 'duplicate checkpoint');
          facts.checkpointLineNumbers[action.checkpoint] = index + 1;
          checkpoint(action.checkpoint, state, { marker: line, scaleActionsApplied: facts.actionCount,
            scaleLinesConsumedIncludingMarker: index + 1, scalePrefixSha256: hash.copy().digest('hex') });
        } else {
          state.apply(action);
          if (selected !== state) selected.apply(action, true);
          facts.actionCount++;
        }
      } catch (error) { throw new Error(`${name}:${index + 1}: ${error.message}`); }
    }
    artifacts[name] = { ...facts, sha256: hash.digest('hex') };
  }
  return { state: selected, artifacts };
}

export function replay(log = 'scale', scale = Infinity) {
  if (!Object.hasOwn(logs, log)) throw new Error(`unknown log ${log}`);
  return replayFiles(logs[log], { scale }).state;
}
