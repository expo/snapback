import { effect, mutation, t } from "snapback2";

export const wrongThen = mutation({ value: t.text(100) }, ({ args }) => args.value);
export const badThen = effect({
  grants: ["https://example.com"],
  run: async (payload: { value: string }) => payload,
  then: wrongThen,
});
