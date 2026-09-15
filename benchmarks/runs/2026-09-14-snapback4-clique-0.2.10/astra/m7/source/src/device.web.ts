import { webDevice } from "snapback4/web";
export const device = () => webDevice({ wasm: "/snapback4_device_bg.wasm" });
export const sessionStore = {
  get: async (k: string) => localStorage.getItem(k),
  set: async (k: string, v: string) => {
    localStorage.setItem(k, v);
  },
  delete: async (k: string) => {
    localStorage.removeItem(k);
  },
};
