// @ref LLP 1002#4-the-wire — a channel handle publishes over HTTP and subscribes as one fenced logical SSE stream.
import { SnapbackRefusal, copyRefusal, isTerminalSession, wireChannelDelivery, wireChannelPublish } from "./client-wire.js";
import { referenceName, type Channel as ChannelRef } from "./api.js";
import { ReconnectingSse } from "./sse.js";
import type { SseResponse } from "./sse-parser.js";
import type { ChannelDelivery, ChannelHandle, ClientSnapshot, RefusalEnvelope, Subscription } from "./types.js";

/** What a channel needs from the client: authority custody, the wire, and the snapshot. */
export interface ChannelHost<Authority, Expiration> {
  operationAuthority(): Promise<Authority>;
  trackWrite<Result>(run: () => Promise<Result>): Promise<Result>;
  json(path: string, init: RequestInit, authority: Authority, options: { terminalSession: "typed-result" }): Promise<unknown>;
  stream(path: string, lastEventId: string | undefined, signal: AbortSignal, authority: Authority): Promise<SseResponse>;
  authorityCurrent(authority: Authority | undefined): boolean;
  ensureAuthority(authority: Authority | undefined): void;
  validated(authority: Authority): void;
  expireSession(authority: Authority): Promise<Expiration>;
  expirationCurrent(expiration: Expiration): boolean;
  supersededRefusal(): SnapbackRefusal;
  recordRefusal(refusal: RefusalEnvelope): void;
  patchSnapshot(patch: Partial<ClientSnapshot>): void;
  transportFailureState(): "reconnecting" | "offline";
  subscriptionError(error: unknown, authority: Authority | undefined, origin: Subscription<unknown>):
    Promise<{ event?: unknown; retry: boolean; refusal?: SnapbackRefusal }>;
  track<Event>(subscription: Subscription<Event>): Subscription<Event>;
}

export function createChannel<Authority, Expiration, Args, Payload>(
  host: ChannelHost<Authority, Expiration>,
  ref: ChannelRef<Args, Payload>,
  args: Args,
): ChannelHandle<Payload> {
  const path = referenceName(ref);
  const name = encodeURIComponent(path.startsWith("channels.") ? path.slice("channels.".length) : path);
  return {
    publish: async (payload: Payload) => {
      const authority = await host.operationAuthority();
      return host.trackWrite(async () => {
        const result = wireChannelPublish(await host.json(`/api/channel/${name}/publish`, {
          method: "POST",
          body: JSON.stringify({ args, payload }),
        }, authority, { terminalSession: "typed-result" }));
        if ("state" in result) {
          if (isTerminalSession(result)) {
            const wasCurrent = host.authorityCurrent(authority);
            const expiration = await host.expireSession(authority);
            if (!wasCurrent || !host.expirationCurrent(expiration)) throw host.supersededRefusal();
          }
          host.recordRefusal(result);
        } else {
          host.validated(authority);
        }
        return result;
      });
    },
    subscribe: (callback: (event: ChannelDelivery<Payload>) => void) => {
      const subscribePath = `/api/channel/${name}/subscribe?args=${encodeURIComponent(JSON.stringify(args))}`;
      let authority: Authority | undefined;
      let subscription: Subscription<ChannelDelivery<Payload>>;
      subscription = new ReconnectingSse<ChannelDelivery<Payload>>({
        open: async (lastEventId, signal) => {
          authority ??= await host.operationAuthority();
          return host.stream(subscribePath, lastEventId, signal, authority);
        },
        decode: ({ data }) => {
          const value = wireChannelDelivery<Payload>(data);
          if ("state" in value && value.state === "refused" && isTerminalSession(value)) {
            throw new SnapbackRefusal(copyRefusal(value));
          }
          host.ensureAuthority(authority);
          host.patchSnapshot({
            connection: "connected",
            lastRefusal: "state" in value && value.state === "refused"
              ? copyRefusal(value)
              : undefined,
          });
          return value;
        },
        bufferedTerminal: ({ data }) => {
          const value = wireChannelDelivery<Payload>(data);
          return "state" in value && value.state === "refused" && isTerminalSession(value)
            ? new SnapbackRefusal(copyRefusal(value))
            : undefined;
        },
        onError: async (error) => {
          const decision = await host.subscriptionError(error, authority, subscription);
          return { retry: decision.retry, event: decision.event as ChannelDelivery<Payload> | undefined, failure: decision.refusal };
        },
        onLoss: () => {
          if (!host.authorityCurrent(authority)) return undefined;
          host.patchSnapshot({ connection: host.transportFailureState() });
          return undefined;
        },
        terminal: (event) => "state" in event && event.state === "refused"
          ? new SnapbackRefusal(copyRefusal(event))
          : undefined,
        onEvent: callback,
      });
      return host.track(subscription);
    },
  };
}
