import assert from 'node:assert/strict';
import api from '../snapback/generated/api.mjs';
import { mutate, query, sessionClient } from './client.mjs';

const email = process.env.CLIQUE_EMAIL ?? 'alice@example.com';
const password = process.env.CLIQUE_PASSWORD ?? 'Alice!Clique2026';
const appClient = await sessionClient({ email, password, databaseName: `clique-custom-client-${process.pid}` });
try {
  const conversations = await query(appClient, api.myInbox);
  assert(conversations.length > 0, 'authenticated user has no conversations');
  const conversation = conversations.find((row) => row.kind === 'dm') ?? conversations[0];
  const before = await query(appClient, api.messagesForConversation, { conversationExternalId: conversation.conversationExternalId });
  const externalId = `custom-client-${Date.now()}`;
  await mutate(appClient, api.sendMessage, { externalId, conversationExternalId: conversation.conversationExternalId, text: 'Hello from the documented custom client', mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: '' });
  const after = await query(appClient, api.messagesForConversation, { conversationExternalId: conversation.conversationExternalId });
  assert(after.some((message) => message.externalId === externalId));
  process.stdout.write(`${JSON.stringify({ ok: true, auth: 'password-session', conversationCount: conversations.length, selectedConversation: conversation.conversationExternalId, historyBefore: before.length, historyAfter: after.length, receiveMode: 'polling' })}\n`);
} finally { await appClient.dispose(); }
