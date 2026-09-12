import { effect } from "snapback2";

export const digest = effect({
  grants: [],
  run: async (payload: {
    to: string;
    period: number;
    periodEnd: number;
    newFollowers: number;
    newPostsInFollowing: number;
    unreadMessages: number;
    unreadChats: number;
  }, { meta }) => ({ accepted: true, idempotencyKey: meta.id, payload }),
});
