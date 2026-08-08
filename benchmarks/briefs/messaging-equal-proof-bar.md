# Brief: messaging — equal proof bar (offline semantics)

**Status:** authored 2026-08-08 under the W1 harness formalization
(`issues/closed/20260808-w1-benchmark-harness-formalization.md`); no run yet;
not calibrated.

## Why this variant exists

The standing messaging runs let each lane prove its own offline story, so the
proof bars were **not equal**. Snapback lanes proved platform retention with
honest freshness and durability facts. Convex lanes shipped an app-owned
roughly 60-line cache that their own reports call "not a real sync story";
offline writes would be lost (diary 0068). Diary 0058's Convex arm disabled
sends and reactions outright while offline.

The standing ratios therefore **understate** the gap in guaranteed-offline
terms. The scoring rubric, not the wall/token ratchet, is where that asymmetry
currently gets credited (diary 0068). This variant raises every lane to the
identical bar so the wall/token numbers themselves carry the comparison. As
the bar rises to what a local-first app actually needs, a platform without
owned offline contracts must build them in-run. That is the asymmetry that
makes the equal-bar comparison the most defensible one to publish
(`issues/closed/20260808-w1-benchmark-harness-formalization.md`).

**OPEN (LLP 0186 OQ5):** publication disclosure remains the owning Plan's
decision; this brief does not decide it.

## The equal bar

Every lane must prove both requirements with identical semantics, whatever
machinery that requires:

1. **Retained cold-start reads.** With the backend stopped, a freshly
   restarted client process (not a warm reload) renders previously synced
   history.
2. **Surviving offline writes.** A message composed while the backend is down
   survives a client restart while still offline and is delivered exactly
   once after the backend returns, observable by a second client.

## Lane-prompt block

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
stopped still shows history); an offline-write survival proof (a message
composed while the backend is stopped survives a client restart while still
offline, and is delivered exactly once after the backend returns, observed by
a second client); and scripted acceptance checks for the core flows.
```

## Notes for lane fairness

- Building the required machinery in-run is permitted and is precisely what
  this variant measures.
- The run record must still label what is a platform contract versus what the
  app builds, applying fairness rule 1's labeling discipline to offline
  semantics.
- A lane that cannot reach the bar records a DNF for the offline proofs rather
  than silently lowering the bar.
