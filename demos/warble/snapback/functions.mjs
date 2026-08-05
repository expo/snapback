// Warble functions — everything the offline surface touches is declarative.
//
// Two rules drove every choice in this file:
//
// 1. A live query cold-retains only when the server can derive `rqsEligible`:
//    public + authorityIndependent + a single-table plan whose filters read no
//    authority or ambient input. `arg(...)` is NOT ambient input, so a
//    viewer-scoped query keyed by an argument still qualifies — which is the
//    only reason the "did I like this?" fact can survive offline at all.
//    @ref LLP 0090#authorization-scope-v1
//
// 2. A mutation replays from the durable outbox only if it carries a generated
//    declarative plan. Plan presence is the replayability predicate, so every
//    write below is an IR plan rather than a JS handler.
//    @ref LLP 0043#milestone-2-queued-mutation-replay

import {
  add,
  arg,
  bindingRef,
  defineLiveQuery,
  defineMutation,
  del,
  desc,
  eq,
  field,
  get,
  insert,
  lit,
  patch,
  record,
  results,
  returnExpr,
  runtimeNow,
  sub,
  v,
} from '../../_kit/define.mjs';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The home timeline, newest first.
 *
 * Public + authorityIndependent is the cold-retention opt-in: the complete
 * result is identical for every caller, so the server mints a resume token and
 * a relaunched client may render these rows with freshness: 'retained' while
 * the backend is unreachable. */
export const timeline = defineLiveQuery({
  table: 'posts',
  args: {},
  filter: [eq('feed', lit('home'))],
  order: [desc('createdAt')],
  index: 'by_feed',
  auth: 'public',
  authorityIndependent: true,
});

/** One author's posts, newest first. Also retainable — same reasoning, and the
 * handle arrives as an argument rather than from authUserId(). */
export const postsByAuthor = defineLiveQuery({
  table: 'posts',
  args: { handle: v.string() },
  filter: [eq('authorHandle', arg('handle'))],
  order: [desc('createdAt')],
  index: 'by_author',
  auth: 'public',
  authorityIndependent: true,
});

/** The viewer's own like rows.
 *
 * Deliberately keyed by an argument, not authUserId(). Filtering on
 * authUserId() would make the plan authority-scoped and the server would refuse
 * retainability with SNAPBACK_RETENTION_NOT_RETAINABLE — the heart would go
 * blank every time the app cold-booted offline. The client derives
 * `liked = likeSet.has(post._id)` from these rows. */
export const myLikes = defineLiveQuery({
  table: 'likes',
  args: { handle: v.string() },
  filter: [eq('userHandle', arg('handle'))],
  index: 'by_user',
  auth: 'public',
  authorityIndependent: true,
});

/** Profiles, for the persona switcher. */
export const profiles = defineLiveQuery({
  table: 'profiles',
  args: {},
  auth: 'public',
  authorityIndependent: true,
});

// ---------------------------------------------------------------------------
// Writes — declarative so the outbox can replay them in order after reconnect
// ---------------------------------------------------------------------------

// NOTE — dev-mode simplification, stated plainly: the author arrives as an
// argument rather than from authUserId(). The React provider owns identity
// custody and exposes no per-call userId, so a dev-mode persona switcher has
// nowhere to assert one. A production app runs in sessions mode and derives
// the author server-side; this demo trades that for a one-tap persona switch.
export const createPost = defineMutation({
  args: { body: v.string(), authorHandle: v.string(), authorName: v.string() },
  plan: insert(
    'posts',
    {
      feed: lit('home'),
      authorHandle: arg('authorHandle'),
      authorName: arg('authorName'),
      body: arg('body'),
      likeCount: lit(0),
      // Minted into the deterministic ctx ledger at enqueue time, so an
      // offline post replays with the timestamp the UI already showed rather
      // than jumping to the reconnect time.
      createdAt: runtimeNow(),
    },
    { bindIdAs: 'postId' },
  ),
  result: results.value(v.object({ postId: v.string() })),
  returns: returnExpr(record({ postId: bindingRef('postId') })),
});

/** Like: insert the viewer's like row and move the denormalized count in one
 * commit, then return the COMPLETE receipt.
 *
 * The complete `{ liked, likeCount }` receipt matters: the optimistic layer
 * retires only on a live delivery matching every field, so a half-receipt would
 * let a partial delivery retire the layer early and visibly dip the count. */
export const likePost = defineMutation({
  args: { postId: v.string(), userHandle: v.string() },
  plan: [
    get('posts', arg('postId'), 'post', { elseError: 'POST_NOT_FOUND' }),
    insert('likes', { postId: arg('postId'), userHandle: arg('userHandle') }),
    patch('posts', arg('postId'), {
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ],
  refusals: ['POST_NOT_FOUND'],
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  returns: returnExpr(
    record({
      liked: lit(true),
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ),
});

export const unlikePost = defineMutation({
  args: { postId: v.string(), userHandle: v.string(), likeId: v.string() },
  plan: [
    get('posts', arg('postId'), 'post', { elseError: 'POST_NOT_FOUND' }),
    del('likes', arg('likeId')),
    patch('posts', arg('postId'), {
      likeCount: sub(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ],
  refusals: ['POST_NOT_FOUND'],
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  returns: returnExpr(
    record({
      liked: lit(false),
      likeCount: sub(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ),
});
