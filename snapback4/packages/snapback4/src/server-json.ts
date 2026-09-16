import type { Refusal } from "./contract.ts";
import { GiveUp } from "./worker.ts";

/** A terminal server-runtime refusal. Messages never contain the rejected value. */
export class ServerError extends GiveUp {
  readonly refusal: Refusal;
  constructor(code: string, message: string, family = "action") {
    super(`${code}: ${message}`);
    this.name = "ServerError";
    this.refusal = Object.freeze({ code, family, message });
  }
}

/** An external step cannot establish its outcome safely. Park it for an operator. */
export class ParkStep extends GiveUp {
  constructor(message = "the provider outcome could not be established") {
    super(message);
    this.name = "ParkStep";
  }
}

// @ref LLP 3000.009#5.1 — step input identity must survive a restart without JSON coercions.
// Canonical text is also a snapshot: callers cannot change the admitted input or
// cached result by mutating an object after handing it to the runtime.
export function strictJson(value: unknown, code: string, limit = 1_048_576): string {
  const ancestors = new Set<object>();
  let bytes = 0;
  const invalid = () => new ServerError(code, "the value must be plain JSON within the 1 MiB bound");
  const charge = (text: string): string => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > limit) throw invalid();
    return text;
  };
  function encode(item: unknown, depth: number): string {
    if (depth > 128) throw invalid();
    if (item === null) return charge("null");
    if (typeof item === "string" || typeof item === "boolean") return charge(JSON.stringify(item));
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw invalid();
      return charge(JSON.stringify(item));
    }
    if (typeof item !== "object" || ancestors.has(item)) throw invalid();
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw invalid();
    ancestors.add(item);
    try {
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== "string")) throw invalid();
      if (array) {
        if (keys.length !== item.length + 1) throw invalid();
        charge("[]" + ",".repeat(Math.max(0, item.length - 1)));
        const values: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
          values.push(encode(descriptor.value, depth + 1));
        }
        return `[${values.join(",")}]`;
      }
      charge("{}" + ",".repeat(Math.max(0, keys.length - 1)));
      const values: string[] = [];
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw invalid();
        values.push(`${charge(JSON.stringify(key) + ":")}${encode(descriptor.value, depth + 1)}`);
      }
      return `{${values.join(",")}}`;
    } finally { ancestors.delete(item); }
  }
  return encode(value, 0);
}

export function label(value: string, code: string): void {
  if (typeof value !== "string" || !/^[\x20-\x7e]{1,128}$/.test(value)) {
    throw new ServerError(code, "a label must be 1–128 printable ASCII characters");
  }
}

export function redactor(values: ReadonlySet<string>): (message: string) => string {
  return message => {
    // Longer values first so a secret that prefixes another does not reveal its tail.
    const variants = new Set<string>();
    for (const value of values) if (value) {
      variants.add(value);
      variants.add(JSON.stringify(value).slice(1, -1));
    }
    for (const value of [...variants].sort((a, b) => b.length - a.length)) message = message.split(value).join("[REDACTED]");
    return message;
  };
}
