import { effect } from "snapback2";

const helper = () => "escaped";
export const badClosure = effect({
  grants: ["https://example.com"],
  run: async (payload: { value: string }) => ({ value: `${payload.value}:${helper()}` }),
});
