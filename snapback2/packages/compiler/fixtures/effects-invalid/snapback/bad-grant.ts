import { effect } from "snapback2";

export const badGrant = effect({
  grants: ["http://example.com"],
  run: async (payload: { value: string }) => ({ value: payload.value }),
});
