# Merge

`merge table [after cursor] first|last N by index:` combines structurally
distinct `[prefix keys]` lanes (named or positional), optionally `for name in`
a bounded range. Prefixes share widths/types and leave a suffix; equal prefixes
and bounds collapse. SQLite streams merge by suffix, deduplicate `id`, and
return N rows; cost is L heads + N advances + 2 lookahead + discovery,
non-uniform lanes keeping per-lane reserves, all priced by retention.
Local merges need a certificate. System reads bypass rule capping, not execution
limits. No lanes yields an empty page. Shapes, `for`, and `count` work
as for ranges. Pageable indexes end in `id`; one cursor applies to every lane.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] authorCard }
```

The recipe admits 50 follows; more is `capped`. `complete` requires exhausted
lanes and at most N rows in their deduplicated union.

See `guide quarry` for related topics.
