import type { ReleaseSnapshot } from "snapback4/contract";

// A conservative signature check; a switch can still race execution (E_OP/E_INPUT).
function operationAvailable(release: ReleaseSnapshot, name: string, kind: string, args: Record<string, unknown>): boolean {
  if (!("generation" in release)) return false;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => object(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const op = release.operations[name];
  return !!op && op.kind === kind
    && Object.entries(args).every(([name, type]) => canonical(op.args[name]) === canonical(type))
    && Object.entries(op.args).every(([name, type]) => Object.hasOwn(args, name) || (object(type) && Object.hasOwn(type, "Optional")));
}

