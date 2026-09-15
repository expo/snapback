import type { Client, Cursor, Principal } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// Pass your app's client (for Expo, await openClient() from ./client).
// Register during profile creation, before following or creating posts.
export const registerForFollowing = (client: Client) => client.mutate(api.feed.register, {});
export const followAuthor = (client: Client, authorId: Principal) => client.mutate(api.feed.follow, { authorId });
export const unfollowAuthor = (client: Client, authorId: Principal) => client.mutate(api.feed.unfollow, { authorId });

// Render the returned Read's loading/denied/data states; keep complete and fresh visible.
// Pass page.next back as c to continue. A cut has no next: retry after cleanup.
// The local-first client answers from its partition; Expo Go uses the online tier.
export const followingPage = (client: Client, c: Cursor | null = null) => client.query(api.feed.following, { c });
