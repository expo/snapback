import { id, init } from "@instantdb/react";
import schema from "../instant.schema";

const appId = import.meta.env.VITE_INSTANT_APP_ID;
const apiURI = import.meta.env.VITE_INSTANT_API_URI;
const websocketURI = import.meta.env.VITE_INSTANT_WEBSOCKET_URI;

if (!appId || !apiURI || !websocketURI) {
  throw new Error("InstantDB arm configuration is incomplete");
}

export const db = init({
  appId,
  apiURI,
  websocketURI,
  schema,
  devtool: false,
});

export { id };
