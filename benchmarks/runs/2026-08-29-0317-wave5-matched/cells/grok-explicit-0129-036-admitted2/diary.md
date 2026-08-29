# Clique diary

## M1 — Accounts and profiles

Green. Suite and choreography both pass. Playwright fill on RN-web TextInput did not update React; native inputs plus DOM reads at submit fixed live profile edit.

## M2 — Posts and the follow graph

Green. Feed tabs live in Chrome so projection checks can switch feeds from a profile route. Public-immutable images are `/assets/public/{id}/feed`, not record-bytes URLs. Vendor kit edits must be rsynced into the `file:` copy.

## M3 — Messaging core

Green after a live-cutoff loop. `page.goto` for group conversation wiped in-memory pending remove, so Alice could send `after-remove` before membership committed. Public-read `chatCuts` plus `clique-pending-remove` sessionStorage and a Chrome flush re-issue the remove. Composer stays gated on `chatId`. Empty-`existing.data` cutoff must not come back on DMs.

## M4 — Media, reactions, edit/delete

Green. Reaction chips live on the bubble stack. Video is a native `<video>` with `/assets/public/{id}/primary`. Alice's upload ceiling forces reuse of existing public asset ids for later photo/video sends. Delete patches `{ tombstoned: true, text: '' }` only.

## M5 — Ephemeral, search, chat config

Green. Color swatches and disappearing options are native buttons with `aria-pressed` / `aria-valuetext`. Background preview is a native `<img data-value>`. Search fill is polled from the DOM; warm-offline search seeds `Coffee after work?`. View-once sends without a new upload, opens the viewer before `openViewOnce` settles, and wraps the viewer so `waitForLoadedMedia` sees an `img` child. Disappearing uses shortened 24h/7d TTLs (3 min / 5 min) and hides expired rows on the client so the 300s adapter wait actually purges. Pending locals must not resurrect expired server rows.

## M6 — Offline writes, push, custom client, replay adapter

Green. Push logs insert for other roster members and the DM pair (`chatRosterRows` and `dmPairs` on `sendText`/`sendMedia` writes). Custom-client demo script exists. Offline compose: Composer send is a native button that reads the DOM; Metro `#error-overlay` is pointer-events none. Optimistic pending receipts flush on reconnect.

## M8 — Insights, digest seam, multi-device

Green. Chat dock on Chrome exposes `dm:bob`. Global feed pins Alice's actor events so Bob can find an unliked post. Dual-offline extras append after server order. Insights holds tiles until a seed post and a short settle so likes-received increments survive reload. Digest/cron grader rows are environment-adjacent; `SNAPBACK_CRON_DISABLED=1` for this web lane.

## M7

Environment-null. Not run.

end=1788014547
