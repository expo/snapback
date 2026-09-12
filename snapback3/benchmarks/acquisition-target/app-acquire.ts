import * as sdk from 'snapback3/client';

import { client } from './client';
import { acquire as retainedSerialAcquire } from './retained-serial-walker';

type JsonObject = Record<string, unknown>;

type PageResult<T> = {
  data: T;
  status: string;
  complete: boolean;
  fresh: boolean;
  seq?: number;
  next: string | null;
};

const EXPECTED = Object.freeze({
  principal: 'u0500',
  principalId: 'dev:u0500',
  conversations: 100,
  messages: 10_000,
  pages: 151,
  chains: 101,
  idsSha256: 'ba91d208c55f77a1a4b792e2eb09407fe774a9814b1358981bbad7950ec984ac',
  canonicalRowsSha256: '86cc3d45609124219c7a74101015da00a96568e06d9b1341b418129fed5a38f2',
  messageFields: ['conversationId', 'edited', 'id', 'replyTo', 'senderId', 'serverTimestamp', 'text', 'tombstone'],
});

const SEARCH = 'busy';

const mark = (state: JsonObject, name: string): number => {
  const value = performance.now();
  state[name] = value;
  return value;
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
};

const nextPaint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function offlinePage<T>(operation: string, args: JsonObject): Promise<PageResult<T>> {
  const resource = client.watch<T>(operation, args);
  const snapshot = await resource.refresh();
  if (snapshot.status !== 'ready' || snapshot.data === undefined) {
    throw new Error(`${operation} ${canonical(args)} was unavailable offline: ${snapshot.status} ${snapshot.error?.code ?? ''}`);
  }
  return {
    data: snapshot.data,
    status: snapshot.status,
    complete: snapshot.complete,
    fresh: snapshot.fresh,
    seq: snapshot.seq,
    next: snapshot.next ?? null,
  };
}

async function firstOfflineUse(): Promise<JsonObject> {
  const page = await offlinePage<JsonObject[]>('messages.page', { conversationId: 'g0001', c: null });
  const matching = page.data.filter(message => String(message.text ?? '').toLowerCase().includes(SEARCH));
  return {
    conversationId: 'g0001',
    historyRows: page.data.length,
    search: SEARCH,
    searchRows: matching.length,
    firstSearchId: matching[0]?.id ?? null,
    complete: page.complete,
    fresh: page.fresh,
    seq: page.seq,
    next: page.next,
  };
}

/** Derive non-vacuous search expectations from the exact acquired SDK page. */
async function deriveSearchControl(): Promise<JsonObject> {
  client.setOnline(false);
  const page = await offlinePage<JsonObject[]>('messages.page', { conversationId: 'g0001', c: null });
  const tokens = new Set(page.data.flatMap(message => String(message.text ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
  const candidates = [...tokens].map(term => ({
    term,
    ids: page.data.filter(message => String(message.text ?? '').toLowerCase().includes(term)).map(message => String(message.id)).sort(),
  })).filter(candidate => candidate.ids.length > 0 && candidate.ids.length < page.data.length)
    .sort((a, b) => a.ids.length - b.ids.length || a.term.localeCompare(b.term));
  const selected = candidates[0];
  if (!selected) throw new Error('The exact acquired page has no non-vacuous substring-search term.');
  let negative = '__snapback3_no_match__';
  while (page.data.some(message => String(message.text ?? '').toLowerCase().includes(negative))) negative += 'x';
  return { term: selected.term, expectedIds: selected.ids, negative, pageRows: page.data.length };
}

/**
 * Timed candidate path. The controller starts its outer clock before navigation;
 * this hook performs fixture persona authentication and uses the production app's
 * singleton SDK client for both declared acquisition and the first offline use.
 */
async function runIntegratedAcquisition(persona = EXPECTED.principal): Promise<JsonObject> {
  if (persona !== EXPECTED.principal) throw new Error(`This fixture-only harness accepts only ${EXPECTED.principal}.`);
  const state: JsonObject = { version: 1, persona, pageTimeOrigin: performance.timeOrigin, hookInvoked: performance.now() };
  (window as any).__acquisitionTargetState = state;

  await client.ready;
  mark(state, 'clientReady');
  const session = await client.auth.persona(persona);
  if (session.principal.id !== EXPECTED.principalId) {
    throw new Error(`Expected fixture principal ${EXPECTED.principalId}; received ${session.principal.id}.`);
  }
  mark(state, 'authenticated');
  await nextPaint();
  mark(state, 'reactPaintAfterAuth');

  const snapshots: JsonObject[] = [];
  let completed: any;
  if (typeof (client as any).acquire === 'function' && typeof (sdk as any).pages === 'function') {
    const pages = (sdk as any).pages;
    const handle = (client as any).acquire({
      id: 'clique-u0500-full-history',
      revision: 'exact-100-conversations-10000-messages-v1',
      root: pages('conversations.inbox', { c: null }, { key: 'u0500-inbox', cursor: 'c' }),
      expand: (conversations: JsonObject[]) => conversations.map(conversation => pages(
        'messages.page',
        { conversationId: conversation.id, c: null },
        { key: String(conversation.id), cursor: 'c' },
      )),
    });
    const unsubscribe = handle.subscribe(() => {
      const snapshot = handle.getSnapshot();
      snapshots.push({ at: performance.now(), status: snapshot.status, pages: snapshot.pages,
        chains: snapshot.chains, seq: snapshot.seq, error: snapshot.error?.code });
    });
    completed = await handle.completed.finally(unsubscribe);
    completed = { ...completed, mode: 'public-sdk-acquire' };
  } else {
    const retained = await retainedSerialAcquire();
    if (retained.status !== 'complete' || retained.conversations.length !== EXPECTED.conversations
      || retained.ids.length !== EXPECTED.messages || retained.pages.length !== EXPECTED.pages) {
      throw new Error(`Retained serial walker count mismatch: ${canonical({ status: retained.status,
        conversations: retained.conversations.length, messages: retained.ids.length, pages: retained.pages.length })}`);
    }
    completed = { status: 'ready', pages: retained.pages.length, chains: EXPECTED.chains,
      seq: retained.pages.at(-1)?.seq, waits: retained.resourceWaits.length, mode: 'verbatim-retained-serial-walker' };
  }
  if (completed.status !== 'ready') throw new Error(`Acquisition completed with status ${completed.status}.`);
  mark(state, 'acquisitionCompleted');

  client.setOnline(false);
  mark(state, 'sdkForcedOffline');
  const firstOffline = await firstOfflineUse();
  mark(state, 'primaryCompleted');

  Object.assign(state, {
    session: { principal: session.principal, authEpoch: session.authEpoch },
    acquisition: { status: completed.status, pages: completed.pages, chains: completed.chains,
      seq: completed.seq, mode: completed.mode },
    acquisitionSnapshots: snapshots,
    firstOffline,
  });
  return state;
}

/** Binding post-timer audit through ordinary offline SDK resources. */
async function runOfflineAudit(): Promise<JsonObject> {
  const started = performance.now();
  client.setOnline(false);
  const conversations: JsonObject[] = [];
  const messages: JsonObject[] = [];
  const pageEvidence: JsonObject[] = [];
  const finalPages: JsonObject[] = [];
  let auditSeq: number | undefined;
  const admitPage = (page: PageResult<JsonObject[]>, evidence: JsonObject): void => {
    if (!Number.isSafeInteger(page.seq)) throw new Error(`Offline audit page has no safe sequence: ${canonical(evidence)}`);
    auditSeq ??= page.seq;
    if (page.seq !== auditSeq) throw new Error(`Offline audit mixed sequences ${auditSeq} and ${page.seq}.`);
    pageEvidence.push(evidence);
    if (pageEvidence.length > EXPECTED.pages) throw new Error(`Offline audit exceeded ${EXPECTED.pages} declared pages.`);
    if (page.next === null) finalPages.push(evidence);
  };

  let inboxCursor: string | null = null;
  const inboxCursors = new Set<string>();
  do {
    const identity = inboxCursor ?? '<null>';
    if (inboxCursors.has(identity)) throw new Error(`Inbox repeated cursor ${identity}.`);
    inboxCursors.add(identity);
    const page: PageResult<JsonObject[]> = await offlinePage<JsonObject[]>('conversations.inbox', { c: inboxCursor });
    conversations.push(...page.data);
    admitPage(page, { op: 'conversations.inbox', c: inboxCursor, rows: page.data.length,
      complete: page.complete, fresh: page.fresh, seq: page.seq, next: page.next });
    inboxCursor = page.next;
  } while (inboxCursor !== null);

  for (const conversation of conversations) {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      const identity = cursor ?? '<null>';
      if (cursors.has(identity)) throw new Error(`Messages ${conversation.id} repeated cursor ${identity}.`);
      cursors.add(identity);
      const page: PageResult<JsonObject[]> = await offlinePage<JsonObject[]>('messages.page', { conversationId: conversation.id, c: cursor });
      messages.push(...page.data);
      admitPage(page, { op: 'messages.page', conversationId: conversation.id, c: cursor,
        rows: page.data.length, complete: page.complete, fresh: page.fresh, seq: page.seq, next: page.next });
      cursor = page.next;
    } while (cursor !== null);
  }

  const uniqueConversationIds = new Set(conversations.map(row => row.id));
  const uniqueMessageIds = new Set(messages.map(row => row.id));
  const observedFieldSets = [...new Set(messages.map(row => Object.keys(row).sort().join(',')))];
  const sortedMessages = [...messages].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const messageIds = sortedMessages.map(row => row.id);
  const completePages = pageEvidence.filter(page => page.complete).length;
  const completeFinalPages = finalPages.filter(page => page.complete).length;
  const audit = {
    elapsedMs: performance.now() - started,
    conversations: conversations.length,
    uniqueConversations: uniqueConversationIds.size,
    messages: messages.length,
    uniqueMessages: uniqueMessageIds.size,
    pages: pageEvidence.length,
    chains: finalPages.length,
    completePages,
    incompletePages: pageEvidence.length - completePages,
    completeFinalPages,
    seq: auditSeq,
    observedFieldSets,
    idsSha256: await sha256(JSON.stringify(messageIds)),
    canonicalRowsSha256: await sha256(canonical(sortedMessages)),
    pageEvidence,
  };
  if (audit.conversations !== EXPECTED.conversations || audit.uniqueConversations !== EXPECTED.conversations
    || audit.messages !== EXPECTED.messages || audit.uniqueMessages !== EXPECTED.messages
    || audit.pages !== EXPECTED.pages || audit.chains !== EXPECTED.chains || audit.completeFinalPages !== audit.chains
    || audit.observedFieldSets.length !== 1 || audit.observedFieldSets[0] !== EXPECTED.messageFields.join(',')) {
    throw new Error(`Binding offline audit failed: ${canonical(audit)}`);
  }
  if (audit.idsSha256 !== EXPECTED.idsSha256 || audit.canonicalRowsSha256 !== EXPECTED.canonicalRowsSha256) {
    throw new Error(`Binding offline audit digest mismatch: ${canonical(audit)}`);
  }
  return audit;
}

/** Separate control after the controller closes and reopens the persistent browser while network-offline. */
async function runOfflineReopenControl(): Promise<JsonObject> {
  const started = performance.now();
  await client.ready;
  const snapshot = client.getSnapshot();
  if (snapshot.principal?.id !== EXPECTED.principalId) throw new Error('The persisted fixture persona did not restore offline.');
  client.setOnline(false);
  const firstOffline = await firstOfflineUse();
  return { elapsedMs: performance.now() - started, client: client.getSnapshot(), firstOffline };
}

(window as any).acquisitionTarget = Object.freeze({
  expected: EXPECTED,
  runIntegratedAcquisition,
  runOfflineAudit,
  runOfflineReopenControl,
  deriveSearchControl,
});

export { runIntegratedAcquisition as acquire };
