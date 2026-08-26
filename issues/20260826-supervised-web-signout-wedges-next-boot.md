# Signing out on supervised Expo web wedges the next boot on `SNAPBACK_AUTH_SESSION_EXPIRED`

- Status: Open
- Date: 2026-08-26
- Systems: `packages/snapback-expo` (supervised boot / adopted authority),
  `packages/snapback-cli` (`snapback dev --expo`)
- Found by: driving the `expo-chat` provider buttons in a real browser against
  `snapback dev --expo --expo-platform web`

## What happens

Under the supervised web loop the app boots already authenticated — it adopts
the session the supervisor minted. Sign out, then reload, and the app does not
come back anonymous; it fails to boot:

```
Chat couldn't start
error
SNAPBACK_AUTH_SESSION_EXPIRED: SNAPBACK_AUTH_SESSION_EXPIRED: authentication
session is expired or revoked
```

The browser console shows a `401 (Unauthorized)` behind it. The app is then
stuck for every subsequent reload until the supervisor is restarted; clearing
`localStorage`, `sessionStorage`, and every IndexedDB database does not help,
because the credential being replayed is the supervisor's published mint rather
than anything the page stored.

Reproduced repeatedly with a single supervisor and a freshly scaffolded
`expo-chat` app (`create-snapback-app` → `bun run dev:supervised`).

## Why it matters

Sign-out is an ordinary thing to do while developing auth — it is the first
thing you do to get back to the provider buttons. Doing it once makes the app
unbootable until you restart `snapback dev --expo`, and the diagnostic points at
an expired session rather than at the supervised mint that produced it, so the
recovery ("restart the dev loop") is not discoverable from the message.

It also makes the provider flow awkward to exercise: each attempt needs a
supervisor restart if a reload happened after a sign-out.

## Suggested direction

Two candidate layers, and the choice needs an owner:

- The supervised boot could treat a revoked adopted authority as *absent*
  rather than fatal — fall back to anonymous `ready`, which is what the app
  shows before any session exists, instead of refusing to start.
- Or sign-out could drop the adoption itself, so the next boot does not replay
  a session the user explicitly ended.

Either way the refusal should name the supervised mint and the restart, not
just the expired session.
