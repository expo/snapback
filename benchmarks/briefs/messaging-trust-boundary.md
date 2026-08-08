<!-- @ref LLP 0198#ii3-phases —
     the trust-boundary brief: vendor-neutral security outcomes with
     negative proofs, replacing the withdrawn "idiomatic production
     auth" framing that would have mixed trust-boundary quality with
     identity-provider ceremony. -->

# Brief: messaging — trust boundary (server-derived identity)

**Status:** authored 2026-08-08 under LLP 0198 P3; no run yet; not
calibrated. Preregistration cells (per LLP 0197 rule 1) freeze with the
first scheduled run.

## Why this brief exists

Every messaging arm in the standing corpus — both platforms — used a
client-supplied test-persona seam, not real authentication. That zeroes
the dimension Snapback is structurally strongest on (server-derived
identity; diary 0057, the corpus's only real-auth run, is also its most
pro-Snapback verdict) exactly as the greenfield-only corpus zeroes its
edit-loop weakness (LLP 0198 §I.6). This brief prices the trust
boundary with **vendor-neutral outcomes**, not provider integrations: a
"use your platform's recommended auth" framing was considered and
rejected because it mixes trust-boundary quality with identity-provider
choice, account setup, and credential ceremony (LLP 0198 revision (c),
after GPT-family review). Identity-provider *onboarding* is out of
scope here (LLP 0198 OQ2's residual).

## The equal bar (outcome requirements, negative proofs mandatory)

The app is the standing WhatsApp-shaped messaging app (see
`messaging.md`), minus the test-persona switcher, plus these outcomes —
each lane meets them via its platform's recommended path, whatever
machinery that requires:

1. **Server-derived identity.** The sender identity stored on a message
   is derived by the backend from the authenticated principal. Negative
   proof: a request that supplies a *different* sender identity in its
   body/args either fails or stores the server-derived identity — the
   client-supplied value must be shown to never reach storage.
2. **Membership isolation (two-principal negative test).** With two
   real principals A and B and a conversation B is not a member of: a
   valid, non-expired credential for B cannot read that conversation's
   messages — proven by an actual denied request, not by absence of UI.
   (Diary 0057's shape: the corpus's only real-auth precedent.)
3. **Unauthenticated refusal.** An unauthenticated request to every
   protected operation (send, read, react, upload) is refused; each
   refusal is captured.
4. **Live revocation.** Revoking principal B's credential takes effect
   on B's live connection: an in-flight session stops receiving updates
   and subsequent requests are refused, observed rather than asserted.

## Construct controls (what stays outside the measured window)

- Principals and credentials are **preprovisioned** before the clock
  starts; minting test principals is setup, not measured work. The
  measured window is clock-bounded per `../protocol.md`.
- No third-party identity provider may enter the measured window. If a
  platform's recommended path *requires* one, its account/setup steps
  are performed pre-clock and disclosed in the record's fairness notes.
- Publication follows LLP 0197 rule 6's publication-safe projection —
  raw transcripts never publish; the negative-proof evidence publishes
  as request/refusal pairs with secrets redacted.

## Lane-prompt block

```text
build a WhatsApp-shaped messaging app: DMs and group chats, text and
image messages, emoji reactions, reply pointers without threads, seeded
data, typing indicators, and offline-readable history. Expo (React
Native) client. Two test principals (A and B) with credentials are
preprovisioned for you. AUTH IS REAL IN THIS BUILD: you must prove (1)
sender identity is derived server-side from the authenticated principal
— demonstrate that a request supplying a forged sender in its arguments
never reaches storage with that forged value; (2) a valid credential
for principal B cannot read a conversation B is not a member of —
capture the denied request; (3) every protected operation refuses
unauthenticated requests — capture each refusal; (4) revoking B's
credential takes effect on B's live connection — show the live session
stop receiving and subsequent requests refused. Also prove the standing
core flows (live backend from the client, seeded conversations, typing
between two clients, an image message end-to-end) and scripted
acceptance checks. Use your platform's recommended way of meeting each
outcome; do not integrate a third-party identity provider inside the
measured build.
```

## Notes for lane fairness

- Each platform's own recommended mechanism is legitimate; the bar is
  the *outcome*, and the record labels what is a platform contract
  versus what the app builds (fairness rule 1's discipline).
- A lane that cannot meet an outcome records a DNF for that proof
  rather than substituting a weaker demonstration (LLP 0197 rule 4b).
- Aid labeling per LLP 0197 rule 4a applies unchanged (skill/template
  use → aid-assisted).
