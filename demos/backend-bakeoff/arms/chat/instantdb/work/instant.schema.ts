import { i } from '@instantdb/core';

const schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    channels: i.entity({
      name: i.string(),
      ownerId: i.string().indexed(),
      visibility: i.string().indexed(),
    }),
    messages: i.entity({
      authorId: i.string().indexed(),
      body: i.string(),
      clientNonce: i.string().unique().indexed(),
      clientSentAt: i.date().indexed(),
    }),
    readMarkers: i.entity({
      key: i.string().unique().indexed(),
      lastReadAt: i.date(),
      userId: i.string().indexed(),
    }),
  },
  links: {
    channelAllowedUsers: {
      forward: { on: 'channels', has: 'many', label: 'allowedUsers' },
      reverse: { on: '$users', has: 'many', label: 'allowedChannels' },
    },
    channelMessages: {
      forward: { on: 'channels', has: 'many', label: 'messages' },
      reverse: { on: 'messages', has: 'one', label: 'channel' },
    },
    channelReadMarkers: {
      forward: { on: 'channels', has: 'many', label: 'readMarkers' },
      reverse: { on: 'readMarkers', has: 'one', label: 'channel' },
    },
  },
  rooms: {
    channel: {
      presence: i.entity({
        actorId: i.string(),
        displayName: i.string(),
        state: i.string(),
      }),
      topics: {
        typing: i.entity({
          actorId: i.string(),
          isTyping: i.boolean(),
        }),
      },
    },
  },
});

export default schema;
