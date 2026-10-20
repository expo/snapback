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
  const matched = new Set<string>();
  for (const [expected, type] of Object.entries(args)) {
    const resolve = (name: string) => Object.hasOwn(op.args, name) ? name : servedAliases[name];
    const target = resolve(expected);
    const names = [expected, ...Object.entries(aliases).filter(([, name]) => name === expected).map(([alias]) => alias)];
    if (!target || !Object.hasOwn(op.args, target) || canonical(op.args[target]) !== canonical(type)
      || names.some(name => resolve(name) !== target)) return false;
    matched.add(target);
  }
  return Object.entries(op.args).every(([name, type]) => matched.has(name) || (object(type) && Object.hasOwn(type, "Optional")));

}

