# Offline interaction state: measure the summary's audience

A missing interaction proves absence only when its whole key domain is acquired.
A public summary can supply that coverage, at the cost of every viewer's keys on every device.

```quarry
table posts:
  author: principal
  public 'public posts'
  online only
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at
view ownLikes: count likes by .principal, .post
query postState(post: posts):
  return { liked: ownLikes[viewer, post] > 0 }
```

This example deliberately emits N_MAINTAIN_SYNCED. At the `view` declaration,
`ownLikes` inherits public sync from `likes`, **without a horizon**. The name
does not make it private. Once the whole aggregate partition is acquired,
an absent group is zero and this query can answer false offline. The raw
`exists likes[post, viewer]` cannot prove a missing key below the public window;
an unknown Boolean must stay unavailable, never become false.

Calibration #24's full builder uses this view and the corresponding repost
summary. Its initial replica census was 5,008 like groups / 1,121,792 logical
row bytes plus 1,004 repost groups / 220,880 bytes: 6,012 rows / 1,342,672
bytes per device, including other viewers' keys. These are stored row bytes,
excluding indexes, transfer framing and database allocation. Measure your own
program with `snapback4 test --residency --fixture dir --as alice`, or inspect
an already adopted store with `check --residency`; `client.residency()` measures
the actual replica. No pre-adoption row count is a compiler estimate.

An explicit `read <- .principal = viewer` conflicts with that inherited
audience (E_SYNC). Adding `sync to .principal` to the view is also refused
(E_QUARRY_SYNTAX): a maintained view cannot declare a separate sync audience.
Remove the view's sync line, then keep `read <- allow` or omit read to retain
the public offline summary and its replica cost. Alternatively, add `online
only` and keep the owner read on the server; this loses offline aggregate
and absence coverage. Do not narrow the public source to make this view private.
See `guide maintains` for the inheritance rules.

The planned source owner-key policy in LLP 3000.028 is not available yet.
It would keep the public window and supply a separate complete viewer-key
partition for ordinary `exists` expressions. A private-table pilot on the
same corpus held three like keys and one repost key for u0500: 568 logical
row bytes. That pilot does not implement source maintenance or adoption,
and its four-key size is not a lifetime bound or a supported schema repair.
Until that policy ships, use the census to decide whether this public summary
fits, or accept server-only interaction state.
