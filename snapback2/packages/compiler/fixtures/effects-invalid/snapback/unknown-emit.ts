import { emit, mutation } from "snapback2";

export const unknownEmit = mutation({}, () => {
  emit(missingEffect, { value: "unknown" });
});
