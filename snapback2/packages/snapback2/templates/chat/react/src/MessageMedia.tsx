import { useState } from "react";
import { AssetImage, AssetVideo, useConnection, type AssetImageProps, type AssetVideoProps } from "snapback2/react";
import type { Refusal } from "snapback2/client";

type State = "loading" | "ready" | "unavailable" | "not-downloaded";
// An offline byte read refuses as transport; only a refusal the server made means the media is unavailable.
const unreachable = (refusal: Refusal) => refusal.family === "transport" || refusal.family === "offline";
const retries = 3;

/**
 * Media that failed to arrive, or began loading without a connection, tries again when the connection
 * returns, a few times per mount. A clip's player URL is minted over the network, so offline it may
 * never report a failure at all; an ordinary slow load that started online is left to finish.
 */
function useAttempt() {
  const connection = useConnection(), connected = connection === "connected";
  const [view, setView] = useState({ state: "loading" as State, attempt: 0, connection, since: connection });
  if (view.connection !== connection) {
    const retry = connected && view.attempt < retries
      && (view.state === "not-downloaded" || (view.state === "loading" && view.since !== "connected"));
    setView({ state: retry ? "loading" : view.state, attempt: view.attempt + (retry ? 1 : 0), connection, since: retry ? connection : view.since });
  }
  const settle = (state: State) => setView((current) => ({ ...current, state }));
  const fail = (refusal?: Refusal) =>
    settle(!connected || (refusal !== undefined && unreachable(refusal)) ? "not-downloaded" : "unavailable");
  const missing = view.state === "not-downloaded" || (view.state === "loading" && connection === "offline");
  return { state: view.state, attempt: view.attempt, missing, settle, fail };
}

export function Photo({ asset }: { asset: AssetImageProps["asset"] }) {
  const media = useAttempt();
  const note = media.state === "unavailable" ? "Photo unavailable" : media.missing ? "Photo not downloaded"
    : media.state === "loading" ? "Loading photo…" : "";
  return <figure className="media" data-media="photo" data-state={media.state}>
    <AssetImage key={media.attempt} asset={asset} width={240} alt="Photo" onLoad={() => media.settle("ready")}
      onError={() => media.fail()} onRefusal={(refusal) => media.fail(refusal)} />
    {note ? <figcaption role="status">{note}</figcaption> : null}
  </figure>;
}

export function Clip({ asset }: { asset: AssetVideoProps["asset"] }) {
  const media = useAttempt();
  const note = media.state === "unavailable" ? "Video unavailable" : media.missing ? "Video not downloaded" : "";
  return <figure className="media" data-media="clip" data-state={media.state}>
    <AssetVideo key={media.attempt} asset={asset} width={240} aria-label="Video" preload="metadata"
      onLoadedMetadata={() => media.settle("ready")} onError={() => media.fail()} onRefusal={(refusal) => media.fail(refusal)} />
    {note ? <figcaption role="status">{note}</figcaption> : null}
  </figure>;
}
