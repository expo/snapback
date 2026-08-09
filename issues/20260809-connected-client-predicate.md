# Server-side connected-client predicate for push seams

All three Clique pilot lanes (Snapback, Convex, Supabase) hand-built
the same thing for the push milestone: a heartbeat table + freshness
threshold to answer "does this user have a connected client right
now?" — because no platform exposes it. Snapback already tracks live
connections server-side for live queries/presence; exposing a
queryable connection predicate (or a connectedness fact on principals)
would make the notification seam ~zero-plumbing and is a genuine
differentiator since neither competitor has it. B7 scored 58/58/55 —
a three-way tie waiting to be broken. Related rows:
backend.notifications, backend.expo-push-seam, realtime.ephemeral.
