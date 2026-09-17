# Merge-on-read Following with the public tables synced (compile-only, snapback4 0.2.27)

`snapback4 check --residency` on `snapback/schema.q` (posts and follows `public` + `sync public`):

```
residency (facts)
  follows: sync public; cap 1000 by followerId
  posts: sync public
operations (facts)
  follow: predicts: eligible
    Held: insert if absent into follows: predicts only when the key, insert image and constraint groups are held and readable; otherwise queues without a row
  following: runs: device
    Held: scan posts by byAuthorTime: held, no horizon (site posts[viewer])
    Held: scan follows by byPair: held, no horizon (site follows[viewer])
    Held: scan posts by byAuthorTime: held, no horizon (site posts[f.followedId])
  post: predicts: eligible
```

Notes emitted: `N_NO_HORIZON` on `posts` (rewrite: `sync public last 500 by byAuthorTime`) and `N_WIDE_MERGE` on
`following` (rewrite: `snapback4 init --recipe feeds --prefix feed`).

Reading: the six-line merge already answers on the device, and `follow`/`post` predict — the installed recipe's
`follow` never predicts (it reads the online-only `feedPullCounts`). Ruling 21 (public subset sync) is therefore an
acquisition-cost lever, not a prerequisite for Following on both hosts.
