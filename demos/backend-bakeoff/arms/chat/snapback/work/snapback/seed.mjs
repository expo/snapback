export const CHAT_FIXTURE = Object.freeze({
  channels: Object.freeze([
    Object.freeze({ slug: 'general', name: 'General', visibility: 'public' }),
    Object.freeze({ slug: 'random', name: 'Random', visibility: 'public' }),
    Object.freeze({ slug: 'project-alpha', name: 'Project Alpha', visibility: 'private' }),
    Object.freeze({ slug: 'leadership', name: 'Leadership', visibility: 'private' }),
  ]),
  messagesPerChannel: 125,
  pageSize: 25,
});
