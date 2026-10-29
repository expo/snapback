# Changelog

## 0.4.50

### Guide changes


- A successful generated `npm run check` points to the verify batch and its initial tool wait; it starts no proofs implicitly. Starter verification batches checks and proofs with 5-second progress and one bounded final summary; use an initial tool wait of 30000ms. Basic password browser proofs reuse `signInUI`/`signOutUI` to handle restored sessions and await screen readiness. Keep exact accessible labels and assert receipts before rendered results. `src/on-write.ts` includes SDK-typed `onWrite`/`refusalOf` handling; nullable/private-field and ordered-exists errors name safe repairs. Proof drafts remain opt-in.
