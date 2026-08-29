import { effect } from "snapback2";

declare function require(name: string): unknown;
export const badImport = effect({
  grants: ["https://example.com"],
  run: async (payload: { value: string }) => {
    require("forbidden");
    return payload;
  },
});
