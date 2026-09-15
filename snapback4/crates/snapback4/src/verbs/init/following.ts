import type { Client, Cursor, Principal } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// Pass your app's client (for Expo, await openClient() from ./client).
// Register during profile creation, before following or creating posts.
// Existing app with media/reposts: `snapback4 guide feeds`, "Wire into an app".
// In the app's createPost/repost, insert a recipe reference event (postId is
// the app post id) and call its deliver helper in the same mutation. Following
// joins the app's postCard and repost attribution; it copies no body or asset.
// Bridge the app's follow/unfollow with the recipe's addFollow/dropFollow
// helpers in ONE mutation; call those app operations instead of these wrappers.
// Backfill existing authors, events and edges before switching Following.
// With --prefix feed, helpers are feedDeliver/feedAddFollow/feedDropFollow;
// the module stays feed.q. With that prefix, the Quarry seams are:
//   a = feedAuthors[viewer] ! else AUTHOR_NOT_FOUND
//   event = insert feedPosts { id: postId, postId, actorId: viewer, authorId: p.authorId, repost: false, at: p.at, shared: a.shared }
//   feedDeliver(event)
// For repost, after creating the app attribution row r and reading original:
//   event = insert feedPosts { postId, actorId: viewer, authorId: original.authorId, repost: true, at: r.at, shared: a.shared }
//   feedDeliver(event)
// After the app's merge, join its card and attribution:
//   return entries { *, post: posts[.postId] postCard, attribution: reposts[.actorId, .postId] }
// The app edge insert/delete and feedAddFollow(authorId)/feedDropFollow(authorId)
// share one mutation. The card includes registration, guards and removal too.
export const registerForFollowing = (client: Client) => client.mutate(api.feed.register, {});
export const followAuthor = (client: Client, authorId: Principal) => client.mutate(api.feed.follow, { authorId });
export const unfollowAuthor = (client: Client, authorId: Principal) => client.mutate(api.feed.unfollow, { authorId });

// Render the returned Read's loading/denied/data states; keep complete and fresh visible.
// Pass page.next back as c to continue. A cut has no next: retry after cleanup.
// The local-first client answers from its partition; Expo Go uses the online tier.
export const followingPage = (client: Client, c: Cursor | null = null) => client.query(api.feed.following, { c });
