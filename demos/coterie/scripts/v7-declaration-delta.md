# Coterie provider declaration v7 delta

This file is the machine-appliable replay record for the quoted-replies,
message-reactions, and provider-claims slice. The checked-out declaration was
v5 while this slice was authored. The concurrent M2 slice owns v6, whose
declared digest is `2b035e0c69068f02`.

Reapply this delta only after starting from the landed v6 declaration. Do not
copy this branch's whole declaration over v6. The delta below is additive to
v6 and deliberately does not change or repeat the v6 M2 operations or the
`coterie.m2CompatibilityTokens` extension.

## 1. Declaration version

Replace the top-level declaration version with:

```json
"declarationVersion": "7"
```

## 2. Queries

In the top-level `queries` array, replace the complete `listMessages` object
with this object. Its insertion point remains the existing `listMessages`
position.

```json
{
  "name": "listMessages",
  "descriptorId": "listMessages",
  "compatibilityToken": "3",
  "reads": ["messages"],
  "params": [
    { "name": "chatId", "type": { "kind": "string" }, "nullable": false }
  ],
  "result": {
    "kind": "list",
    "row": {
      "kind": "shape",
      "name": "Message",
      "excessFields": "project",
      "fields": [
        { "name": "id", "type": { "kind": "string" }, "nullable": false },
        { "name": "chatId", "type": { "kind": "string" }, "nullable": false },
        { "name": "senderId", "type": { "kind": "string" }, "nullable": false },
        { "name": "senderName", "type": { "kind": "string" }, "nullable": false },
        { "name": "body", "type": { "kind": "string" }, "nullable": false },
        { "name": "createdAt", "type": { "kind": "string" }, "nullable": false },
        { "name": "mine", "type": { "kind": "boolean" }, "nullable": false },
        { "name": "status", "type": { "kind": "string" }, "nullable": false },
        { "name": "quotedMessageId", "type": { "kind": "string" }, "nullable": true },
        { "name": "quotedSenderName", "type": { "kind": "string" }, "nullable": true },
        { "name": "quotedBodySnippet", "type": { "kind": "string" }, "nullable": true },
        { "name": "quoteText", "type": { "kind": "string" }, "nullable": true },
        {
          "name": "reactions",
          "type": {
            "kind": "array",
            "element": {
              "kind": "object",
              "fields": [
                { "name": "emoji", "type": { "kind": "string" }, "nullable": false },
                { "name": "count", "type": { "kind": "number" }, "nullable": false },
                { "name": "reactedByMe", "type": { "kind": "boolean" }, "nullable": false }
              ]
            }
          },
          "nullable": false
        },
        { "name": "edited", "type": { "kind": "boolean" }, "nullable": false },
        { "name": "deleted", "type": { "kind": "boolean" }, "nullable": false }
      ]
    }
  },
  "liveness": { "mode": "live", "livePush": true, "initialSnapshot": true },
  "errors": [],
  "receipts": "none"
}
```

Immediately after `listMessages`, insert this complete new query object:

```json
{
  "name": "listProviderClaims",
  "descriptorId": "listProviderClaims",
  "compatibilityToken": "1",
  "reads": ["providerClaims"],
  "params": [],
  "result": {
    "kind": "list",
    "row": {
      "kind": "shape",
      "name": "ProviderClaim",
      "excessFields": "project",
      "fields": [
        { "name": "name", "type": { "kind": "string" }, "nullable": false },
        { "name": "kind", "type": { "kind": "string" }, "nullable": false },
        { "name": "token", "type": { "kind": "string" }, "nullable": false }
      ]
    }
  },
  "liveness": { "mode": "snapshot", "livePush": false, "initialSnapshot": true },
  "errors": [],
  "receipts": "none"
}
```

## 3. Mutations

In the top-level `mutations` array, replace the complete `sendMessage` object
with this object. Its insertion point remains the existing `sendMessage`
position.

```json
{
  "name": "sendMessage",
  "params": [
    { "name": "chatId", "type": { "kind": "string" }, "nullable": false },
    { "name": "body", "type": { "kind": "string" }, "nullable": false },
    { "name": "quotedMessageId", "type": { "kind": "string" }, "nullable": true }
  ],
  "writes": ["messages", "chats"],
  "optimistic": false,
  "receipts": "none",
  "errors": [
    { "name": "ChatNotFoundError", "code": "chat_not_found", "message": "Conversation was not found." },
    { "name": "MessageBodyInvalidError", "code": "message_body_invalid", "message": "Message text must contain 1-2000 characters." },
    { "name": "QuotedMessageInvalidError", "code": "quoted_message_invalid", "message": "Quoted message must exist in this conversation." },
    { "name": "SessionRequiredError", "code": "session_required", "message": "An active session is required." }
  ]
}
```

Immediately after `sendMessage`, insert this complete new mutation object:

```json
{
  "name": "setMessageReaction",
  "params": [
    { "name": "chatId", "type": { "kind": "string" }, "nullable": false },
    { "name": "messageId", "type": { "kind": "string" }, "nullable": false },
    { "name": "emoji", "type": { "kind": "string" }, "nullable": false },
    { "name": "reacted", "type": { "kind": "boolean" }, "nullable": false },
    { "name": "mutationId", "type": { "kind": "string" }, "nullable": false }
  ],
  "writes": ["messages"],
  "optimistic": false,
  "receipts": "none",
  "errors": [
    { "name": "ChatNotFoundError", "code": "chat_not_found", "message": "Conversation was not found." },
    { "name": "EmojiInvalidError", "code": "emoji_invalid", "message": "Reaction must be one emoji grapheme." },
    { "name": "MessageNotFoundError", "code": "message_not_found", "message": "Message was not found in this conversation." },
    { "name": "SessionRequiredError", "code": "session_required", "message": "An active session is required." }
  ]
}
```

## 4. Compatibility-token extensions

Inside the top-level `extensions` object, insert these sibling members after
the landed `coterie.m2CompatibilityTokens` member. Query tokens remain in the
core query declarations; these extensions carry mutation tokens and retain
the chat-era query tokens as an explicit milestone record.

```json
"coterie.m3CompatibilityTokens": {
  "listChats": "2",
  "listMessages": "3",
  "sendMessage": "3"
},
"coterie.m4CompatibilityTokens": {
  "setMessageReaction": "1"
},
"coterie.m5CompatibilityTokens": {
  "searchSocial": "2",
  "setChatAccent": "1",
  "setDisappearing": "1"
}
```

## 5. Regeneration and post-rebase verification

From `demos/coterie`:

```sh
bun run generate:provider
bun run check:provider
bun run verify:coterie
bun run test:snapback-provider
```

Post-rebase checks that cannot be completed against the pre-M2 v5 base:

1. Confirm `coterie.m1CompatibilityTokens.setAvatar` remains `"2"`, the v6
   `setAvatar` writes still include `chats`, and the complete
   `coterie.m2CompatibilityTokens` object remains byte-for-byte semantically
   unchanged.
2. Confirm `src/data/avatar-refs.ts` remains the sole avatar-reference constant
   module used by both picker options and provider admission. The expected
   values in its single `COTERIE_AVATARS` table are the eight
   `media/avatar-{alice,bob,carol,dave,erin,frank,grace,henry}.png` refs; if
   the vocabulary changes, edit that table rather than adding another map.
3. Tighten the tolerant avatar-picker seam assertion temporarily to prove all
   eight refs are accepted by the landed v6 memory provider, then restore the
   tolerant assertion if the test must remain replayable on the pre-v6 base.
4. Regenerate every `coterie.*` artifact from the merged v7 declaration. The
   pre-rebase generated digest `ff04bef1dd23f934` is local evidence only and
   must not be treated as the final v7 digest.
5. Re-run both requested verification commands above against the merged v7
   tree. Run the Snapback integration path separately with
   `COTERIE_SNAPBACK_INTEGRATION=1` when a live server is available.

## 6. Merged v7 result

Replaying this delta onto the landed v6 declaration with inputs hash
`2b035e0c69068f02` produces the final v7 inputs hash
`61fcaaa7b60092b4`.

The review-corrected replay deliberately bumps `listMessages` and
`sendMessage` from `@2` to `@3`: v6 already assigned `@2`, while v7 changes
their shapes. It also declares `MessageBodyInvalidError` for empty or
over-2,000-character sends, gives `setMessageReaction` a required
`mutationId`, and records search/accent/disappearing operations under the M5
namespace fixed by the brief rather than M3.
