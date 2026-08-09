# Clique — screen wireframes (kit composition notes)

Wireframe notes for the brief's pinned screens
(`benchmarks/briefs/social-messenger.md`, "Screens (pinned)"). Each
entry lists the kit components that compose the screen, an ASCII
layout sketch, and the contract testIDs that appear
(`benchmarks/tools/social-messenger/CONTRACT.md`). The kit is purely
presentational (LLP 0201 D6): lanes wire all data, navigation,
scrolling/virtualized lists, and screen chrome (headers, back
buttons, tab bars). Sketches show intent, not pixels.

Legend: `[...]` interactive element · `#id` = contract testID on that
element · `(#id)` = extra kit testID (non-contract, stable).

---

## 1. Auth (sign up / sign in)

Components: **AuthForm**

```
+--------------------------------------+
|                                      |
|               Clique                 |
|                                      |
|  [ email                ] #sm-auth-email
|  [ password             ] #sm-auth-password
|  ( error text, if any )   (#sm-auth-error)
|  [       Sign up        ] #sm-auth-submit
|   Already have an account? Sign in   |  (#sm-auth-toggle)
+--------------------------------------+
```

Contract IDs: `sm-auth-email`, `sm-auth-password`, `sm-auth-submit`.

## 2. Feed (Following / Global tabs)

Components: **FeedTabs**, **FeedCard** (per post), **Avatar** (inside
FeedCard). The lane provides the scrolling list, 20-per-page infinite
scroll, and tab state.

```
+--------------------------------------+
| [ Following ]      [ Global ]        | #sm-feed-tab-following / #sm-feed-tab-global
|=====────────           ─────────     |
| +----------------------------------+ |
| | (o) Alice @alice · 2h            | | #sm-feed-item (card)
| |     Coffee time https://…        | |
| |     [img][img]                   | |
| |  [◗ 3]     [↻ 1]     [♡ 12]      | | #sm-post-reply / #sm-post-repost / #sm-post-like
| +----------------------------------+ |
| | ↻ Reposted by Bob                | | (#sm-feed-repost-attribution)
| | (o) Carol @carol · 5h  …         | | #sm-feed-item
| +----------------------------------+ |
+--------------------------------------+
```

Contract IDs: `sm-feed-tab-following`, `sm-feed-tab-global`,
`sm-feed-item`, `sm-post-like`, `sm-post-repost`, `sm-post-reply`.

## 3. Post thread

Components: **FeedCard** (parent, then each direct reply,
chronological). The lane supplies the screen and ordering.

```
+--------------------------------------+
| < Thread                             |  (lane chrome)
| +----------------------------------+ |
| | (o) Alice — parent post          | | #sm-feed-item
| |  [◗ 2] [↻] [♡]                   | | #sm-post-reply / -repost / -like
| +----------------------------------+ |
| |  (o) Bob — reply 1               | | #sm-feed-item
| |  (o) Carol — reply 2             | | #sm-feed-item
| +----------------------------------+ |
+--------------------------------------+
```

Contract IDs: `sm-feed-item`, `sm-post-like`, `sm-post-repost`,
`sm-post-reply` (same FeedCard set; replies are posts).

## 4. Compose post

Components: **Composer** (`variant="post"`). Attachment picking (1–4
fixture images or exactly one video, per brief M2) is lane logic; the
kit previews whatever `attachments` it is handed.

```
+--------------------------------------+
| < Cancel                             |  (lane chrome)
|  [thumb][thumb]  ✕                   |  (#sm-compose-attachment-remove)
|  [＋] [ What's happening?      ][Post]| (#sm-compose-attach) #sm-compose-input #sm-compose-submit
+--------------------------------------+
```

Contract IDs: `sm-compose-input`, `sm-compose-submit`.

## 5. Own profile (view + edit)

Components: **ProfileForm** (`mode="view-own"` then `mode="edit"`),
**Avatar**, **FeedCard** for the user's posts below (lane list).

```
View:                                Edit:
+---------------------------+       +---------------------------+
| (O)          [Edit profile]|#sm-profile-edit | (O) Change photo (#sm-profile-avatar)
| Alice                     |       | Display name [        ]   | (#sm-profile-field-displayname)
| @alice                    |       | Handle       [        ]   | (#sm-profile-field-handle)
| bio…  link                |       | Bio          [        ]   | (#sm-profile-field-bio)
| 12 Followers · 34 Following|      | Location     [        ]   | (#sm-profile-field-location)
| (#sm-profile-follower-count|      | Link         [        ]   | (#sm-profile-field-link)
|  #sm-profile-following-count)     | [        Save         ]   | #sm-profile-save
| ── posts (FeedCard list) ──|      +---------------------------+
+---------------------------+
```

Contract IDs: `sm-profile-edit`, `sm-profile-save` (+ FeedCard IDs in
the posts list).

## 6. Other-user profile

Components: **ProfileForm** (`mode="view-other"`), **Avatar**,
**FeedCard** list below.

```
+--------------------------------------+
| (O)                  [ Follow ]      | #sm-profile-follow (toggle)
| Bob  @bob                            |
| 8 Followers · 21 Following           |
| ── posts (FeedCard list) ──          |
+--------------------------------------+
```

Contract IDs: `sm-profile-follow` (+ FeedCard IDs).

## 7. Chats list

Components: **ChatListRow** (per chat), **Avatar** (inside).

```
+--------------------------------------+
| Chats                                |  (lane chrome)
| (o) • Design gang        12:04   (3) | #sm-chats-item  (#sm-chats-unread)
|      Bob: on my way                  |
| (o) Bob                  11:30       | #sm-chats-item
|      typing…                         |  (#sm-chats-typing)
+--------------------------------------+
```

Contract IDs: `sm-chats-item`.

## 8. Conversation

Components: **MessageBubble** (per message; embeds **Avatar**,
**QuotedReply**, **ReceiptTicks**), **TypingIndicator**,
**ReactionPicker** (on long-press), **Composer**
(`variant="message"`), **PollDisplay** for poll messages (M7).
Background image + accent come from chat settings; the lane paints
the background.

```
+--------------------------------------+
| < Design gang               (⚙)      |  (lane chrome → chat settings)
|  (o) | Bob                        |  | #sm-convo-bubble
|      | > Alice: Coffee time?     |  | #sm-convo-quote (tap → jump)
|      | on my way                 |  |
|      [👍 2][❤️ 1]                  |  | (#sm-convo-reaction-chip)
|              | sure! (edited) ✓✓ |  | #sm-convo-bubble + #sm-convo-receipt
|  (…)                                 | #sm-convo-typing
|  ( [👍][❤️][😂][😮][😢][🙏] )          | #sm-convo-reaction (picker options)
|  [＋] [ Message           ]  [ ↑ ]   | (#sm-convo-attach) #sm-convo-input #sm-convo-send
+--------------------------------------+
```

Contract IDs: `sm-convo-bubble`, `sm-convo-quote`, `sm-convo-typing`,
`sm-convo-receipt`, `sm-convo-reaction`, `sm-convo-input`,
`sm-convo-send` (+ `sm-poll-option`, `sm-poll-tally` when a poll
message renders).

## 9. Chat settings

Components: **ChatSettingsForm** (embeds **Avatar** for members).
Groups: name, description, members, admin actions; DMs: color and
background only. Message count row appears at M7.

```
+--------------------------------------+
| < Chat settings                      |  (lane chrome)
| GROUP NAME    [ Design gang    ]     | (#sm-chatsettings-name)
| DESCRIPTION   [ …              ]     | (#sm-chatsettings-description)
| ACCENT COLOR  ●●●●●●●●               | #sm-chatsettings-color (each swatch)
| BACKGROUND    [thumb] Choose…        | #sm-chatsettings-background
| DISAPPEARING  [Off|24 hours|7 days]  | (#sm-chatsettings-disappearing-*)
| MESSAGES      1,204                  | (#sm-chatsettings-messagecount, M7)
| 3 MEMBERS                            |
|  (o) Alice  admin                    | (#sm-chatsettings-member)
|  (o) Carol   [Make admin] [Remove]   | (#sm-chatsettings-member-promote/-remove)
|  ＋ Add member                       | (#sm-chatsettings-member-add)
| Leave group                          | (#sm-chatsettings-leave)
+--------------------------------------+
```

Contract IDs: `sm-chatsettings-color`, `sm-chatsettings-background`.

## 10. New chat / new group

Components: **SearchBar** (people picking), **Avatar**; group
name/description inputs may reuse the lane's own fields or
**ChatSettingsForm** in creation mode. Mostly lane-composed — member
selection state, the create action, and DM-dedupe live in the lane.

```
+--------------------------------------+
| < New chat                           |  (lane chrome)
| [⌕ Search people          ]          | #sm-search-input
|  (o) Carol  @carol                   | #sm-search-result
|  (o) Dave   @dave                    | #sm-search-result
|  selected: [Carol ✕][Dave ✕]         |  (lane)
|  [ Create group ]                    |  (lane)
+--------------------------------------+
```

Contract IDs: `sm-search-input`, `sm-search-result`.

## 11. Search (people / this chat / all messages)

Components: **SearchBar** (input + results, grouped rows for
all-messages scope), **Avatar**. Scope switching is lane chrome.

```
+--------------------------------------+
| [⌕ cof                    ] ✕        | #sm-search-input (#sm-search-clear)
| ( People | This chat | All )         |  (lane scope control)
| DESIGN GANG                          | (#sm-search-group)
|  Coffee time?          Alice · 12:01 | #sm-search-result
| BOB                                  | (#sm-search-group)
|  coffee run in 5       Bob · 09:14   | #sm-search-result
+--------------------------------------+
```

Contract IDs: `sm-search-input`, `sm-search-result`.

## 12. Settings (account, log out)

No dedicated kit component — plain rows built by the lane with the
kit's tokens (spacing/typeScale/palette); profile bits reuse
**Avatar**. No contract testIDs are pinned for this screen.

```
+--------------------------------------+
| Settings                             |
|  (o) Alice  @alice        >          |  (→ own profile)
|  Account                             |
|  Log out                             |  (lane; server-side revocation per M1)
+--------------------------------------+
```

---

Compose-a-poll (M7) is reached from the Conversation screen
(**PollCompose**; extra `sm-poll-compose-*` IDs). Poll messages render
via **PollDisplay** inside the conversation with the contract's
`sm-poll-option` / `sm-poll-tally`.
