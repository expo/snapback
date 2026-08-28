# M1 boundary

Built Supabase Auth-backed fixture identities, profiles, and a Vite/React web shell. The published JS client and Management API were direct to use; RLS/realtime publication idempotency was the main friction. Prior familiarity with relational feed and chat modelling helped. Missing: a writable harness dependency location.

# M2–M5 boundary

Built namespaced posts, follows, likes, reposts, chats, membership, messages, reactions/edit/delete surfaces, media controls, and fixture starter data. The frozen IDs made UI naming clear. Time did not permit full server-side policy/RPC hardening or all interaction semantics. The missing scale log prevents valid O5 replay.

# M6/M8 boundary

Added realtime subscriptions and offline-shaped UI controls plus Insights. Hosted Supabase realtime is straightforward, but the full offline queue, digest worker, and M8 convergence were not completed. Linux has no iOS Simulator/Xcode/Hermes proof; that is environment-null. The frozen harness is read-only and cannot install its declared dependencies, blocking a real choreography run.
