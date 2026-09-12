import { seed } from "snapback3";

// Fictional local-development conversations, fixed for reproducible comparisons.
export default seed({
  "personas": [
    "alice",
    "bob",
    "erin"
  ],
  "rows": {
    "conversations": [
      {
        "id": "studio",
        "title": "Design studio",
        "topic": "A little space for thoughtful work. Share what you're making, ask a good question, and leave room for a better idea.",
        "kind": "group",
        "color": "sage",
        "updatedAt": 1789231140000
      },
      {
        "id": "notes",
        "title": "Product notes",
        "topic": "Small observations, rough ideas, and things worth coming back to.",
        "kind": "group",
        "color": "clay",
        "updatedAt": 1789229520000
      },
      {
        "id": "weekend",
        "title": "The weekend club",
        "topic": "Good walks, good food, and the occasional very ambitious plan.",
        "kind": "group",
        "color": "lavender",
        "updatedAt": 1789229340000
      },
      {
        "id": "alice-bob",
        "title": "Alice & Bob",
        "topic": "A direct conversation. Only the two of you can see these messages.",
        "kind": "direct",
        "color": "sky",
        "updatedAt": 1789229160000
      },
      {
        "id": "alice-erin",
        "title": "Alice & Erin",
        "topic": "A direct conversation. A good place to think something through.",
        "kind": "direct",
        "color": "clay",
        "updatedAt": 1789229160000
      },
      {
        "id": "side-room",
        "title": "Bob & Erin",
        "topic": "A private conversation Alice is not a member of.",
        "kind": "direct",
        "color": "lavender",
        "updatedAt": 1789228980000
      }
    ],
    "memberships": [
      {
        "id": "member-studio-alice",
        "conversationId": "studio",
        "principal": "dev:alice",
        "displayName": "Alice Kim",
        "role": "Product design"
      },
      {
        "id": "member-studio-bob",
        "conversationId": "studio",
        "principal": "dev:bob",
        "displayName": "Bob Chen",
        "role": "Engineering"
      },
      {
        "id": "member-studio-erin",
        "conversationId": "studio",
        "principal": "dev:erin",
        "displayName": "Erin Walsh",
        "role": "Words & ideas"
      },
      {
        "id": "member-notes-alice",
        "conversationId": "notes",
        "principal": "dev:alice",
        "displayName": "Alice Kim",
        "role": "Product design"
      },
      {
        "id": "member-notes-bob",
        "conversationId": "notes",
        "principal": "dev:bob",
        "displayName": "Bob Chen",
        "role": "Engineering"
      },
      {
        "id": "member-notes-erin",
        "conversationId": "notes",
        "principal": "dev:erin",
        "displayName": "Erin Walsh",
        "role": "Words & ideas"
      },
      {
        "id": "member-weekend-alice",
        "conversationId": "weekend",
        "principal": "dev:alice",
        "displayName": "Alice Kim",
        "role": "Product design"
      },
      {
        "id": "member-weekend-erin",
        "conversationId": "weekend",
        "principal": "dev:erin",
        "displayName": "Erin Walsh",
        "role": "Words & ideas"
      },
      {
        "id": "member-alice-bob-alice",
        "conversationId": "alice-bob",
        "principal": "dev:alice",
        "displayName": "Alice Kim",
        "role": "Product design"
      },
      {
        "id": "member-alice-bob-bob",
        "conversationId": "alice-bob",
        "principal": "dev:bob",
        "displayName": "Bob Chen",
        "role": "Engineering"
      },
      {
        "id": "member-alice-erin-alice",
        "conversationId": "alice-erin",
        "principal": "dev:alice",
        "displayName": "Alice Kim",
        "role": "Product design"
      },
      {
        "id": "member-alice-erin-erin",
        "conversationId": "alice-erin",
        "principal": "dev:erin",
        "displayName": "Erin Walsh",
        "role": "Words & ideas"
      },
      {
        "id": "member-side-room-bob",
        "conversationId": "side-room",
        "principal": "dev:bob",
        "displayName": "Bob Chen",
        "role": "Engineering"
      },
      {
        "id": "member-side-room-erin",
        "conversationId": "side-room",
        "principal": "dev:erin",
        "displayName": "Erin Walsh",
        "role": "Words & ideas"
      }
    ],
    "messages": [
      {
        "id": "message-studio-1",
        "conversationId": "studio",
        "author": "dev:erin",
        "body": "Morning, team. A small reminder for today: a little breathing room usually makes the whole thing better.",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-studio-2",
        "conversationId": "studio",
        "author": "dev:bob",
        "body": "I took another pass at the welcome screen. The simpler version feels much more like us.",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      },
      {
        "id": "message-studio-3",
        "conversationId": "studio",
        "author": "dev:alice",
        "body": "Yes. Less to figure out, more room to settle in.",
        "ordinal": 3,
        "at": 1789229160000,
        "editedAt": null
      },
      {
        "id": "message-studio-4",
        "conversationId": "studio",
        "author": "dev:bob",
        "body": "Exactly. I kept the first step to one choice, and gave the illustration a little more space.",
        "ordinal": 4,
        "at": 1789229340000,
        "editedAt": null
      },
      {
        "id": "message-studio-5",
        "conversationId": "studio",
        "author": "dev:erin",
        "body": "Love that. I have a few words to go with it:\n\nA little space to make good things together.",
        "ordinal": 5,
        "at": 1789229520000,
        "editedAt": null
      },
      {
        "id": "message-studio-6",
        "conversationId": "studio",
        "author": "dev:alice",
        "body": "That line stays. ☀️",
        "ordinal": 6,
        "at": 1789229700000,
        "editedAt": null
      },
      {
        "id": "message-studio-7",
        "conversationId": "studio",
        "author": "dev:erin",
        "body": "It also feels nice out loud. I tried it on the train, quietly.",
        "ordinal": 7,
        "at": 1789229880000,
        "editedAt": null
      },
      {
        "id": "message-studio-8",
        "conversationId": "studio",
        "author": "dev:bob",
        "body": "Important field research.",
        "ordinal": 8,
        "at": 1789230060000,
        "editedAt": null
      },
      {
        "id": "message-studio-9",
        "conversationId": "studio",
        "author": "dev:alice",
        "body": "Here's what I'm thinking for the afternoon:\n• Finish the conversation view\n• Take a proper walk\n• Look at it again with fresh eyes",
        "ordinal": 9,
        "at": 1789230240000,
        "editedAt": null
      },
      {
        "id": "message-studio-10",
        "conversationId": "studio",
        "author": "dev:bob",
        "body": "The walk is doing a lot of work in that plan.",
        "ordinal": 10,
        "at": 1789230420000,
        "editedAt": null
      },
      {
        "id": "message-studio-11",
        "conversationId": "studio",
        "author": "dev:erin",
        "body": "Can we keep this same feeling in the empty states? Helpful, but not too eager.",
        "ordinal": 11,
        "at": 1789230600000,
        "editedAt": null
      },
      {
        "id": "message-studio-12",
        "conversationId": "studio",
        "author": "dev:alice",
        "body": "Absolutely. A gentle invitation, then get out of the way.",
        "ordinal": 12,
        "at": 1789230780000,
        "editedAt": null
      },
      {
        "id": "message-studio-13",
        "conversationId": "studio",
        "author": "dev:bob",
        "body": "I have the next pass ready whenever you'd like a look.",
        "ordinal": 13,
        "at": 1789230960000,
        "editedAt": null
      },
      {
        "id": "message-studio-14",
        "conversationId": "studio",
        "author": "dev:erin",
        "body": "I'll bring coffee. Let's make it a good one.",
        "ordinal": 14,
        "at": 1789231140000,
        "editedAt": null
      },
      {
        "id": "message-notes-1",
        "conversationId": "notes",
        "author": "dev:alice",
        "body": "Putting our little observations here so they don't get lost.",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-notes-2",
        "conversationId": "notes",
        "author": "dev:erin",
        "body": "Mine: the best introductions feel like someone pulled out a chair for you.",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      },
      {
        "id": "message-notes-3",
        "conversationId": "notes",
        "author": "dev:bob",
        "body": "And the best settings are the ones you don't need to change.",
        "ordinal": 3,
        "at": 1789229160000,
        "editedAt": null
      },
      {
        "id": "message-notes-4",
        "conversationId": "notes",
        "author": "dev:alice",
        "body": "Both of these belong on the wall.",
        "ordinal": 4,
        "at": 1789229340000,
        "editedAt": null
      },
      {
        "id": "message-notes-5",
        "conversationId": "notes",
        "author": "dev:erin",
        "body": "One more: save people's work before asking them to do anything else.",
        "ordinal": 5,
        "at": 1789229520000,
        "editedAt": null
      },
      {
        "id": "message-weekend-1",
        "conversationId": "weekend",
        "author": "dev:erin",
        "body": "Does a Saturday walk along the water sound good?",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-weekend-2",
        "conversationId": "weekend",
        "author": "dev:alice",
        "body": "Always. The long way, with a stop for pastries?",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      },
      {
        "id": "message-weekend-3",
        "conversationId": "weekend",
        "author": "dev:erin",
        "body": "The long way is the only way. 10:30?",
        "ordinal": 3,
        "at": 1789229160000,
        "editedAt": null
      },
      {
        "id": "message-weekend-4",
        "conversationId": "weekend",
        "author": "dev:alice",
        "body": "Perfect. I'll bring the thermos.",
        "ordinal": 4,
        "at": 1789229340000,
        "editedAt": null
      },
      {
        "id": "message-alice-bob-1",
        "conversationId": "alice-bob",
        "author": "dev:bob",
        "body": "Thanks for the thoughtful feedback yesterday.",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-alice-bob-2",
        "conversationId": "alice-bob",
        "author": "dev:alice",
        "body": "Thanks for making time to work through it together.",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      },
      {
        "id": "message-alice-bob-3",
        "conversationId": "alice-bob",
        "author": "dev:bob",
        "body": "I think we're getting somewhere good.",
        "ordinal": 3,
        "at": 1789229160000,
        "editedAt": null
      },
      {
        "id": "message-alice-erin-1",
        "conversationId": "alice-erin",
        "author": "dev:erin",
        "body": "The little notebook you recommended arrived.",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-alice-erin-2",
        "conversationId": "alice-erin",
        "author": "dev:alice",
        "body": "The green one?",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      },
      {
        "id": "message-alice-erin-3",
        "conversationId": "alice-erin",
        "author": "dev:erin",
        "body": "Of course. Already filled three pages.",
        "ordinal": 3,
        "at": 1789229160000,
        "editedAt": null
      },
      {
        "id": "message-side-room-1",
        "conversationId": "side-room",
        "author": "dev:bob",
        "body": "The surprise lunch is still a secret, right?",
        "ordinal": 1,
        "at": 1789228800000,
        "editedAt": null
      },
      {
        "id": "message-side-room-2",
        "conversationId": "side-room",
        "author": "dev:erin",
        "body": "Completely. I booked the table.",
        "ordinal": 2,
        "at": 1789228980000,
        "editedAt": null
      }
    ],
    "readCursors": [
      {
        "id": "cursor-studio-alice",
        "conversationId": "studio",
        "principal": "dev:alice",
        "seen": 12
      },
      {
        "id": "cursor-studio-bob",
        "conversationId": "studio",
        "principal": "dev:bob",
        "seen": 11
      },
      {
        "id": "cursor-studio-erin",
        "conversationId": "studio",
        "principal": "dev:erin",
        "seen": 11
      },
      {
        "id": "cursor-notes-alice",
        "conversationId": "notes",
        "principal": "dev:alice",
        "seen": 3
      },
      {
        "id": "cursor-notes-bob",
        "conversationId": "notes",
        "principal": "dev:bob",
        "seen": 2
      },
      {
        "id": "cursor-notes-erin",
        "conversationId": "notes",
        "principal": "dev:erin",
        "seen": 2
      },
      {
        "id": "cursor-weekend-alice",
        "conversationId": "weekend",
        "principal": "dev:alice",
        "seen": 2
      },
      {
        "id": "cursor-weekend-erin",
        "conversationId": "weekend",
        "principal": "dev:erin",
        "seen": 1
      },
      {
        "id": "cursor-alice-bob-alice",
        "conversationId": "alice-bob",
        "principal": "dev:alice",
        "seen": 1
      },
      {
        "id": "cursor-alice-bob-bob",
        "conversationId": "alice-bob",
        "principal": "dev:bob",
        "seen": 0
      },
      {
        "id": "cursor-alice-erin-alice",
        "conversationId": "alice-erin",
        "principal": "dev:alice",
        "seen": 1
      },
      {
        "id": "cursor-alice-erin-erin",
        "conversationId": "alice-erin",
        "principal": "dev:erin",
        "seen": 0
      },
      {
        "id": "cursor-side-room-bob",
        "conversationId": "side-room",
        "principal": "dev:bob",
        "seen": 0
      },
      {
        "id": "cursor-side-room-erin",
        "conversationId": "side-room",
        "principal": "dev:erin",
        "seen": 0
      }
    ]
  }
});
