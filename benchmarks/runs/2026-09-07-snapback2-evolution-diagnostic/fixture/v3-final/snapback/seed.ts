import { seed } from "snapback2";
export default seed({
  "personas": [
    "alice",
    "bob"
  ],
  "rows": {
    "rooms": [
      {
        "id": "room-1",
        "title": "Room 1",
        "ownerId": "dev:alice",
        "category": "general"
      },
      {
        "id": "room-2",
        "title": "Room 2",
        "ownerId": "dev:alice",
        "category": "general"
      },
      {
        "id": "room-3",
        "title": "Room 3",
        "ownerId": "dev:bob",
        "category": "general"
      }
    ],
    "messages": [
      {
        "id": "message-1",
        "roomId": "room-1",
        "body": "Preserve message 1 — café",
        "at": 1,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-2",
        "roomId": "room-1",
        "body": "Preserve message 2 — café",
        "at": 2,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-3",
        "roomId": "room-1",
        "body": "Preserve message 3 — café",
        "at": 3,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-4",
        "roomId": "room-1",
        "body": "Preserve message 4 — café",
        "at": 4,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-5",
        "roomId": "room-2",
        "body": "Preserve message 5 — café",
        "at": 5,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-6",
        "roomId": "room-2",
        "body": "Preserve message 6 — café",
        "at": 6,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-7",
        "roomId": "room-2",
        "body": "Preserve message 7 — café",
        "at": 7,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-8",
        "roomId": "room-2",
        "body": "Preserve message 8 — café",
        "at": 8,
        "ownerId": "dev:alice"
      },
      {
        "id": "message-9",
        "roomId": "room-3",
        "body": "Preserve message 9 — café",
        "at": 9,
        "ownerId": "dev:bob"
      },
      {
        "id": "message-10",
        "roomId": "room-3",
        "body": "Preserve message 10 — café",
        "at": 10,
        "ownerId": "dev:bob"
      },
      {
        "id": "message-11",
        "roomId": "room-3",
        "body": "Preserve message 11 — café",
        "at": 11,
        "ownerId": "dev:bob"
      },
      {
        "id": "message-12",
        "roomId": "room-3",
        "body": "Preserve message 12 — café",
        "at": 12,
        "ownerId": "dev:bob"
      }
    ],
    "reactions": [
      {
        "id": "reaction-2",
        "messageId": "message-2",
        "emoji": "👍",
        "ownerId": "dev:alice"
      },
      {
        "id": "reaction-4",
        "messageId": "message-4",
        "emoji": "👍",
        "ownerId": "dev:alice"
      },
      {
        "id": "reaction-6",
        "messageId": "message-6",
        "emoji": "👍",
        "ownerId": "dev:alice"
      },
      {
        "id": "reaction-8",
        "messageId": "message-8",
        "emoji": "👍",
        "ownerId": "dev:alice"
      },
      {
        "id": "reaction-10",
        "messageId": "message-10",
        "emoji": "👍",
        "ownerId": "dev:bob"
      },
      {
        "id": "reaction-12",
        "messageId": "message-12",
        "emoji": "👍",
        "ownerId": "dev:bob"
      }
    ],
    "receipts": [
      {
        "id": "receipt-1",
        "messageId": "message-1",
        "readAt": 101,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-2",
        "messageId": "message-2",
        "readAt": 102,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-3",
        "messageId": "message-3",
        "readAt": 103,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-4",
        "messageId": "message-4",
        "readAt": 104,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-5",
        "messageId": "message-5",
        "readAt": 105,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-6",
        "messageId": "message-6",
        "readAt": 106,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-7",
        "messageId": "message-7",
        "readAt": 107,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-8",
        "messageId": "message-8",
        "readAt": 108,
        "ownerId": "dev:alice"
      },
      {
        "id": "receipt-9",
        "messageId": "message-9",
        "readAt": 109,
        "ownerId": "dev:bob"
      },
      {
        "id": "receipt-10",
        "messageId": "message-10",
        "readAt": 110,
        "ownerId": "dev:bob"
      },
      {
        "id": "receipt-11",
        "messageId": "message-11",
        "readAt": 111,
        "ownerId": "dev:bob"
      },
      {
        "id": "receipt-12",
        "messageId": "message-12",
        "readAt": 112,
        "ownerId": "dev:bob"
      }
    ]
  }
});
