export interface Op<Args, Result> {
  readonly op: string;
  readonly __args?: (args: Args) => void;
  readonly __result?: Result;
}

export interface Api {}

export type AnyOp = Op<any, any>;

export interface ApiProxy {
  readonly op: any;
  readonly [name: string]: ApiProxy;
}

const proxies = new Map<string, ApiProxy>();

function proxy(path: string[]): ApiProxy {
  const op = path.join(".");
  const existing = proxies.get(op);
  if (existing) return existing;

  const target = { op } as ApiProxy;
  const value = new Proxy(target, {
    get(current, property, receiver) {
      if (property === "then") return undefined;
      if (property === "toJSON") return () => ({ op });
      if (property === Symbol.toStringTag) return "SnapbackOp";
      if (Reflect.has(current, property)) return Reflect.get(current, property, receiver);
      return typeof property === "string" ? proxy([...path, property]) : undefined;
    },
  });
  proxies.set(op, value);
  return value;
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — generated Api augmentation types the inert operation proxy.
export const api: Api & ApiProxy = proxy([]);
