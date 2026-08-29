import { emit, query } from "snapback2";
import { badGrant } from "./bad-grant";

export const queryEmit = query({}, () => {
  emit(badGrant, { value: "query" });
});
