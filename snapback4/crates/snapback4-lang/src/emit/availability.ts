import type { ReleaseSnapshot } from "snapback4/contract";

// A conservative signature check; a switch can still race execution (E_OP/E_INPUT).
function operationAvailable(release: ReleaseSnapshot, name: string, kind: string, args: Record<string, unknown>, aliases: Record<string, string> = {}): boolean {
  if (!("generation" in release)) return false;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => object(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const op = release.operations[name];
  if (!op || op.kind !== kind) return false;
  const servedAliases = op.aliases ?? {};
  return Object.entries(args).every(([expected, type]) => {
      const names = [expected,
        ...Object.entries(aliases).filter(([, canonicalName]) => canonicalName === expected).map(([alias]) => alias),
        ...(servedAliases[expected] ? [servedAliases[expected]] : [])];
      return names.some(servedName => Object.hasOwn(op.args, servedName) && canonical(op.args[servedName]) === canonical(type));
    })
    && Object.entries(op.args).every(([servedName, type]) => {
      const names = [servedName,
        ...Object.entries(servedAliases).filter(([, canonicalName]) => canonicalName === servedName).map(([alias]) => alias),
        ...(aliases[servedName] ? [aliases[servedName]] : [])];
      return names.some(expectedName => Object.hasOwn(args, expectedName)) || (object(type) && Object.hasOwn(type, "Optional"));
    });
}

