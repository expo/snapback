# Firebase Chat primary documentation snapshot

Captured 2026-07-28/29 from Firebase's official documentation:

- Local Emulator Suite: <https://firebase.google.com/docs/emulator-suite>
- Connect the Firestore emulator and inspect rule evaluation: <https://firebase.google.com/docs/emulator-suite/connect_firestore>
- Cursor pagination with `orderBy`, `startAfter`, and `limit`: <https://firebase.google.com/docs/firestore/query-data/query-cursors>
- Offline persistence and network disable/enable: <https://firebase.google.com/docs/firestore/manage-data/enable-offline>
- Firestore presence solution using Realtime Database native `onDisconnect`: <https://firebase.google.com/docs/firestore/solutions/presence>

The last page is unusually candid and useful: Cloud Firestore has no native
presence primitive, and Firebase's recommended solution composes Realtime
Database presence with Cloud Functions when a Firestore mirror is wanted.
This arm uses RTDB directly for ephemeral channel typing/presence and labels
the app-authored typing expiry policy as glue.
