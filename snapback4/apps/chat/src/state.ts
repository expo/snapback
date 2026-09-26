export { ViewState, type Intent } from "./intents.ts";

export function routeFromUrl() { return new URLSearchParams(location.hash.slice(1)).get("room") ?? undefined; }
export function setRoute(room?: string) {
  const url = new URL(location.href);
  url.hash = room ? new URLSearchParams({ room }).toString() : "";
  history.replaceState(null, "", url);
}
