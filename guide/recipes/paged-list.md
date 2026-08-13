---
title: "Recipe: paginated and load-more lists"
id: recipes.paged-list
order: 4
audience: agent-first
capabilities: [clients.react-paged-list]
authorities: [llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0196-template-and-recipe-portfolio.plan.md, packages/snapback-cli/templates/media-feed/snapback/schema.mjs, packages/snapback-cli/templates/media-feed/snapback/functions.mjs, packages/snapback-cli/templates/media-feed/App.tsx, packages/snapback-cli/templates/media-feed/pagination.mjs, packages/snapback-cli/templates/media-feed/acceptance.mjs, packages/snapback-cli/templates/media-feed/acceptance.static.mjs]
examples: [packages/snapback-cli/templates/media-feed]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:cfa8b56a1cc17fecd9a9c7199933bca32ed9ab24d7610ceca52419d7bc039923
---

# Recipe: paginated and load-more lists

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use a live query for the current window and a second bounded query for rows
strictly before its oldest unique key. In React, keep older whole-result pages
in a small presentation sidecar and deduplicate the combined list by canonical
row id. The `media-feed` template is the complete executable carrier:

```sh
npx create-snapback-app my-feed --template media-feed
cd my-feed
npm run prove
```

This recipe is for a public/shared feed with a raw, application-owned unique
boundary. Owner- and membership-protected generated pages have an opaque
cursor and a different custody contract; [use that path](#use-opaque-cursors-for-protected-pages)
instead of copying this public-feed shape.

## Give every row a unique immutable page key

A display timestamp is not a keyset boundary. Two rows can share one
millisecond, and `createdAt < before` would skip the second row if the page
break landed between them. Keep `createdAt` for display, but order and filter
on an independently unique immutable string. The template combines a
zero-padded server time with a server runtime id:

```js source=packages/snapback-cli/templates/media-feed/snapback/functions.mjs
  handler: async (ctx, args) => {
    const createdAt = ctx.runtime.now();
    return ctx.db.insert('entries', {
      ownerId: ctx.auth.userId,
      authorName: args.authorName,
      caption: args.caption,
      photo: await ctx.assets.attach(args.photo, { upload: 'feedPhotoUpload' }),
      // Time keeps feed order intuitive; the runtime id makes the boundary
      // unique even when two entries share the same millisecond.
      pageKey: `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`,
      createdAt,
    });
  },
```

Declare `pageKey` required and the index unique. If the application permits
editing rows, make `pageKey` immutable explicitly; moving a boundary field
during traversal can legitimately move that row across the boundary. This is
the unique continuation contract in [safe standard patterns](../backend/standard-patterns.md#generate-keyset-pages),
applied here to a public unpartitioned feed.

## Query the current window and one older window

Both queries are bounded and use the same descending index. The older query's
strict comparison means the boundary row cannot repeat:

```js source=packages/snapback-cli/templates/media-feed/snapback/functions.mjs
export const liveFeed = defineLiveQuery({
  table: 'entries',
  args: {},
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});

export const olderFeedPage = defineLiveQuery({
  table: 'entries',
  args: { before: v.string() },
  filter: [ltFilter('pageKey', arg('before'))],
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});
```

These are live queries, so each delivery replaces the complete result for its
exact `(query, args)` identity. Do not append every replacement blindly. The
current window remains query-owned; only the accumulated archive is local
presentation state.

## Accumulate replacements without duplicating rows

Start the older hook as `skip`, then activate it with the oldest rendered
`pageKey`. This feed is append-only. When a newer insert slides the live head,
move rows displaced from the previous head into the archive; otherwise the
old boundary excludes that row from the older page and it briefly vanishes.
Merge whole older-page replacements through the same helper, deduplicate by
canonical id, and sort by the immutable page key:

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  const first = useSnapbackQuery(api.liveFeed, {});
  const [before, setBefore] = useState<string | null>(null);
  const [archive, setArchive] = useState<readonly Entry[]>([]);
  const previousFirstRows = useRef<readonly Entry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const older = useSnapbackQuery(api.olderFeedPage, before === null ? skip : { before });
```

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  useEffect(() => {
    if (!firstReady) return;
    setArchive((current) => mergePagedArchive({
      archive: current,
      head: firstRows,
      previousHead: previousFirstRows.current,
    }));
    previousFirstRows.current = firstRows;
  }, [firstReady, firstRows]);

  useEffect(() => {
    if (older.status !== 'ready' && older.status !== 'refreshing') return;
    setArchive((current) => mergePagedArchive({ archive: current, head: firstRows, page: older.data }));
    setExhausted(older.data.length < 6);
  }, [firstRows, older]);

  const entries = useMemo(() => {
    const seen = new Set<string>();
    return [...firstRows, ...archive].filter((entry) => {
      if (seen.has(entry._id)) return false;
      seen.add(entry._id);
      return true;
    });
  }, [firstRows, archive]);
```

Advance only when there is a row and the boundary actually changed. A short
page is terminal; a full final page needs one more request to observe the
empty terminal page:

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  const loadOlder = () => {
    if (exhausted || older.status === 'pending') return;
    const oldest = entries.at(-1);
    if (oldest && oldest.pageKey !== before) setBefore(oldest.pageKey);
  };
```

`FlatList.onEndReached` calls `loadOlder`; a button can call the same function.
Keep `_id` as the render key. The template's live acceptance deliberately puts
equal `createdAt` values on opposite sides of the page break, proves twelve
unique rows, inserts a newer row, and proves the historical page did not
shift. Its executable static acceptance also slides the live head and proves
the displaced boundary row remains in the merged list. If rows can be deleted,
do not use append-only rollover unchanged: carry deletion/tombstone semantics
into the presentation merge so a removed head row is not archived forever.

## Treat retention and the archive as different things

The provider may render a retained snapshot for an eligible exact
`(query, args)` registration and reports that fact through
`QueryState.freshness`/`retention`. The `archive` array above is ordinary React
state. It is **not** part of the retained query store and disappears on reload.
Do not label the assembled infinite list offline-complete merely because the
current window or one previously registered page can render retained.

For protected data, also clear every caller-owned accumulated page at the
same authorization cut that blanks the protected current window. Retaining an
archive past logout or membership removal would turn presentation state into
an ungoverned cache.

## Use opaque cursors for protected pages

`defineOwnedKeysetPages` and `defineMembershipKeysetPages` return an envelope
with `rows` and an opaque custody-bound cursor. The membership pair is
callable-only by design. That envelope is not the array-shaped generated live
query accepted by `useSnapbackQuery`, and the React `QueryState` does not
surface a hidden cursor. Invoke those pages with the
[headless client's `query`](../clients/headless.md) from an application-owned
control, thread the returned cursor verbatim, and clear accumulated rows on an
authority cut. Do not substitute the raw `pageKey` or cast the callable page
into a live hook.

This is an honest API boundary: the public media-feed recipe needs no new
platform primitive, while a first-class React hook for opaque callable pages
would be a separate client feature.

## Anti-patterns

- Do not paginate on a non-unique timestamp or offset.
- Do not append every live replacement; merge by canonical `_id`.
- Do not claim the React archive is retained or offline-complete.
- Do not feed a raw boundary to a standard-pattern cursor argument.
- Do not keep protected accumulated rows across logout, membership loss, or
  another authority partition change.
