export const referencePath: unique symbol = Symbol.for("snapback.referencePath");

export interface Op<Args, Result, Targets extends Record<string, "create" | "update" | "remove"> = {}> {
  readonly op: string;
  readonly [referencePath]: string;
  readonly __args?: (args: Args) => void;
  readonly __result?: Result;
  readonly __targets?: Targets;
}

export interface Channel<Args, Payload = unknown> {
  readonly [referencePath]: string;
  readonly __channelArgs?: (args: Args) => void;
  readonly __payload?: Payload;
}

export interface Api {}

export type AnyOp = Op<any, any>;

export interface ApiProxy {
  readonly [referencePath]: string;
}

const proxies = new Map<string, ApiProxy>();

function proxy(path: string[]): ApiProxy {
  const op = path.join(".");
  const existing = proxies.get(op);
  if (existing) return existing;

  const target = Object.assign({}, { op, [referencePath]: op }) as ApiProxy;
  const value = new Proxy(target, {
    get(_current, property) {
      if (property === referencePath) return op;
      if (property === Symbol.toStringTag) return "SnapbackOp";
      if (property === "then") return undefined;
      if (property === "op" && path.length >= 2) return op;
      return typeof property === "string" ? proxy([...path, property]) : undefined;
    },
  });
  proxies.set(op, value);
  return value;
}

export function referenceName(ref: ApiProxy): string {
  return ref[referencePath];
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — generated Api augmentation types the inert operation proxy.
export const api: Api = proxy([]) as Api;
