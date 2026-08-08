# Brief: messaging ("WhatsApp-shaped")

**Status:** calibrated baseline — three prior runs (LLP 0186 W1: "three
prior runs make it the calibrated baseline"): the two relay-room lanes of
`diaries/0058-relay-room-expo-backend-bakeoff.diary.md` and the Tandem
build of `diaries/0059-tandem-expo-messaging-bakeoff.diary.md`. The
calibrated-baseline basis now also includes the instrumented series: diary
0065 (first token-metered run and published-closure basis), diary 0066
(three lanes on 0.1.12), and diary 0068 (four lanes on 0.1.13), the standing
baseline recorded in `benchmarks/records/2026-08-07-messaging-0113.md`.

## The brief

Verbatim from diary 0058's header (the brief actually used, adapted only
from "build the same app twice" to the per-lane form — each benchmark
lane builds it once):

> build the same WhatsApp-shaped messaging app twice: DMs and group
> chats, text and image messages, emoji reactions, reply pointers
> without threads, seeded data, typing indicators, offline-readable
> history, and a fast test-persona switcher. Record the experience and
> compare both current systems and hypothetical very-mature versions.

Per-lane form for the instrument:

Build a WhatsApp-shaped messaging app as an Expo (Expo Router) client on
the lane's backend, with:

- DMs and group chats;
- text and image messages;
- emoji reactions;
- reply pointers without threads (a reply stores only a pointer to the
  message it answers; no thread table, no nested route — diary 0058:
  "Replying stores only `replyToId`; there is no thread table and no
  nested route");
- seeded data (a versioned, idempotent seed with users, conversations,
  memberships, messages, replies, and reactions);
- typing indicators;
- offline-readable history;
- a fast test-persona switcher (a visibly labeled test-only persona
  seam; per the fairness rules this is explicitly not production
  authentication).

Record the experience in a run diary.

## Lane-prompt block (verbatim, runs 0065–0068)

```text
build a WhatsApp-shaped messaging app: DMs and group chats, text and image
messages, emoji reactions, reply pointers without threads, seeded data,
typing indicators, offline-readable history, and a fast test-persona
switcher. Expo (React Native) client. You must prove: a live backend
reachable from the client; the Expo UI working (web is fine for interaction
proof; also produce an iOS Hermes bundle export as a build artifact); seeded
conversations/messages; typing indicators live between two clients; an image
message sent end-to-end from the app (picker → upload → attached message
rendering); an offline cold-start proof (client restarted with the backend
stopped still shows history); and scripted acceptance checks for the core
flows.
```

The native-simulator lane template replaces the "You must prove:" clause with
its own on-simulator proof list — see `benchmarks/lanes/native-simulator.md`.

## Acceptance shape (from the baseline runs)

The proof list above is the operational acceptance bar the 0065–0068 runs
actually held every lane to; it supersedes nothing in this baseline
description.

The baseline runs proved, per lane: live text send, a reply whose
pointer resolves, a reaction toggle, typing appearing and expiring, a
real image uploaded and rendered from a query result, seeded data
installed idempotently, and an offline/cold-start read of previously
synced history. Offline claims must state what is actually guaranteed
(platform contract vs app-owned snapshot; sends enabled or disabled
offline) — the 0058 scoring turned on exactly that distinction.

## Notes for lane fairness

- This brief advantages realtime-native platforms; see LLP 0186 OQ4
  (OPEN) and the `crud.md`/`media.md` briefs.
- Auth posture must be labeled per the fairness rules in
  `../README.md`.
